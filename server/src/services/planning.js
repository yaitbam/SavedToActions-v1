// Planning: propose a slot, approve a block (write), move it, read it back, mark done or skip.
//
// Rules from CLAUDE.md:
// - Writes only after approval. Every write path requires `approved: true`.
// - Only confirmed effort is scheduled. Never outside working hours. One contiguous block per action.
// - Initial slot search uses FreeBusy. Before committing, a fresh event level availability check.
// - Moving replaces the block: new event written, old block marked superseded (never counted twice).
// - Idempotency key per block, deterministic event id, read-back after every write, drift is flagged.
//
// The calendar is injected, so the same code runs against Google and against a fake in tests.
import { getActionView } from "../actions.js";
import {
  allSupersededKeys,
  blockView,
  cancelBlock,
  countBlocksWithSlot,
  decorateSlot,
  getActiveBlock,
  getBlock,
  insertBlock,
  markEventDeleted,
  saveReadback,
  supersedeBlock,
} from "../blockStore.js";
import { getSettings } from "../db.js";
import { CalendarError, buildEventBody, calendarErrorStatus } from "../google/calendar.js";
import {
  latestFeasibleStart,
  DEFAULT_HORIZON_DAYS,
  MIN,
  blockTags,
  busyFromEvents,
  compareReadback,
  detectConflicts,
  eventIdFromKey,
  insideWorkingHours,
  makeIdempotencyKey,
  mergeIntervals,
  planMove,
  proposeSlot,
  readTags,
  resolveDeadline,
  toIso,
} from "../scheduler/index.js";

import { formatForDisplay } from "../tz.js";
import { updateCompletionTitle } from "./completionCalendar.js";

const DAY_MS = 24 * 60 * MIN;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

const fail = (status, error, extra = {}) => ({ ok: false, status, error, ...extra });

export function createPlanningService({ db, calendar, clock = Date.now }) {
  const getRow = (id) => db.prepare("SELECT * FROM actions WHERE id = ?").get(id);
  const isClosed = (row) => row.status === "done" || row.status === "skipped";

  /** Calendar failures become API errors with a stable code. Anything else is a bug and propagates. */
  async function guard(fn) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof CalendarError) return fail(calendarErrorStatus(err.code), err.code, { detail: err.message });
      throw err;
    }
  }

  /** Everything scheduling needs. Missing timezone, unconfirmed effort or a broken deadline stops here. */
  function planContext(row) {
    const settings = getSettings(db);
    if (!settings.tz) return fail(409, "missing_timezone", { detail: "Set your timezone in settings first." });
    if (row.confirmed_effort_min == null) {
      return fail(409, "effort_not_confirmed", { detail: "Confirm your effort first. Only confirmed effort is scheduled." });
    }
    const deadline = resolveDeadline({ wall: row.deadline_wall, tz: row.deadline_tz });
    if (!deadline.ok) return fail(409, deadline.reason, { detail: "Fix the deadline before scheduling." });
    return { ok: true, settings, durationMin: row.confirmed_effort_min, deadline };
  }

  /** The slot must be exact instants with an explicit offset. A bare local time would be read in the server's zone. */
  function parseSlot(slot) {
    if (!slot || typeof slot.startUtc !== "string" || typeof slot.endUtc !== "string") return null;
    if (!ISO_INSTANT.test(slot.startUtc) || !ISO_INSTANT.test(slot.endUtc)) return null;
    const startMs = Date.parse(slot.startUtc);
    const endMs = Date.parse(slot.endUtc);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
    return { startMs, endMs, startUtc: toIso(startMs), endUtc: toIso(endMs) };
  }

  function checkSlot(parsed, ctx, nowMs) {
    const { settings, durationMin, deadline } = ctx;
    if (parsed.endMs - parsed.startMs !== durationMin * MIN) {
      return fail(422, "slot_length_mismatch", { detail: `The block must be exactly your confirmed effort, ${durationMin} minutes.` });
    }
    if (parsed.startMs < nowMs) return fail(422, "slot_in_past", { detail: "The block starts in the past." });
    const inside = insideWorkingHours({ ...parsed, tz: settings.tz, workStart: settings.workStart, workEnd: settings.workEnd });
    if (!inside) {
      return fail(422, "outside_working_hours", { detail: `Blocks stay inside your working hours (${settings.workStart} to ${settings.workEnd}).` });
    }
    if (deadline.present && parsed.endMs > deadline.ms) return fail(422, "after_deadline", { detail: "The block would end after the deadline." });
    return { ok: true };
  }

  // Slots carry relative strings ("Thu 14:00") computed from the injected clock.
  const decorate = (slot, tz, durationMin) => decorateSlot(slot, tz, durationMin, clock());

  const blockShape = (row) => ({
    startMs: Date.parse(row.start_utc),
    endMs: Date.parse(row.end_utc),
    googleEventId: row.google_event_id,
    idempotencyKey: row.idempotency_key,
  });

  /**
   * Find the earliest valid slot. First placement reads FreeBusy. When a block already exists (a move) or when we
   * are re-searching after a conflict, it reads events instead, so our own block is never subtracted from an
   * aggregated interval. A move prefers the nearest slot at or after the old one.
   */
  async function search({ row, ctx, nowMs, activeBlock = null, useEvents = false, notBeforeMs = 0 }) {
    const { settings, durationMin, deadline } = ctx;
    const untilMs = deadline.present ? deadline.ms : nowMs + DEFAULT_HORIZON_DAYS * DAY_MS;
    if (deadline.present && deadline.ms <= nowMs) {
      return { found: false, reason: "deadline_passed", hints: null, explanation: ["The deadline has passed."], source: "none" };
    }
    // The agent may ask for a later start. Never earlier than now.
    const fromMs = Math.max(nowMs, notBeforeMs);
    if (fromMs >= untilMs) {
      return { found: false, reason: "not_before_after_deadline", hints: null, explanation: ["That start time is after the deadline."], source: "none" };
    }
    let busy;
    let source;
    // Ignoring all-day events needs the event level read: FreeBusy only returns merged intervals.
    if (activeBlock || useEvents || settings.ignoreAllDay) {
      const events = await calendar.listEvents({ fromMs, toMs: untilMs });
      busy = busyFromEvents({ block: activeBlock ? blockShape(activeBlock) : {}, events, tz: settings.tz, supersededKeys: allSupersededKeys(db), ignoreAllDay: settings.ignoreAllDay });
      source = "events";
    } else {
      busy = await calendar.freeBusy({ fromMs, toMs: untilMs });
      source = "freebusy";
    }
    const common = {
      durationMin,
      busy,
      tz: settings.tz,
      workStart: settings.workStart,
      workEnd: settings.workEnd,
      deadlineWall: row.deadline_wall,
      deadlineTz: row.deadline_tz,
    };
    let result = activeBlock ? proposeSlot({ ...common, now: Math.max(fromMs, Date.parse(activeBlock.start_utc)) }) : null;
    if (!result?.ok) result = proposeSlot({ ...common, now: fromMs });
    if (result.ok) {
      const latest = latestFeasibleStart({ now: fromMs, durationMin, busy, tz:settings.tz, workStart:settings.workStart, workEnd:settings.workEnd, deadlineMs:deadline.present ? deadline.ms : null });
      return { found:true, slot:decorate(result.slot,settings.tz,durationMin), source, latestFeasibleStart:latest.ok ? {...decorate(latest.slot,settings.tz,durationMin),label:latest.label} : null };
    }
    const extended = result.hints?.fitsIfWorkingHoursExtended;
    return {
      found: false,
      reason: result.reason,
      hints: result.hints
        ? { ...result.hints, fitsIfWorkingHoursExtended: extended ? decorate(extended, settings.tz, durationMin) : null }
        : null,
      explanation: result.explanation ?? [],
      source,
    };
  }

  /** Insert the event. If the id already exists it may be our own earlier write (crash before the database commit). */
  async function writeEvent(body, eventId, key) {
    try {
      return await calendar.insertEvent(body);
    } catch (err) {
      if (!(err instanceof CalendarError) || err.code !== "event_exists") throw err;
      const existing = await calendar.getEvent(eventId);
      if (existing && existing.status !== "cancelled" && readTags(existing).key === key) return existing;
      throw new CalendarError("event_id_collision", "An event with this id already exists and is not our block.", { status: 409 });
    }
  }

  /** Fetch the event again and compare. A failed fetch is recorded as "failed", the write itself already happened. */
  async function readBack(eventId, block) {
    try {
      const event = await calendar.getEvent(eventId);
      const cmp = compareReadback({ block, event });
      return { status: cmp.status, drift: cmp.drift, error: null };
    } catch (err) {
      if (err instanceof CalendarError) return { status: "failed", drift: [], error: err.code };
      throw err;
    }
  }

  /** Delete an event and read back that it is gone (deleted events stay readable as cancelled). */
  async function removeEvent(eventId) {
    await calendar.deleteEvent(eventId);
    const after = await calendar.getEvent(eventId);
    return after === null || after.status === "cancelled";
  }

  const describe = (row) => {
    const deliverables = JSON.parse(row.deliverables_json ?? "[]");
    return ["Planned with SavedToAction.", ...(deliverables.length ? ["", ...deliverables.map((d) => `- ${d}`)] : [])].join("\n");
  };

  const summary = (row) => ({ action: getActionView(db, row.id, {nowMs:clock()}) });

  /**
   * Fresh availability check, event level, right before committing (or before the agent proposes). Our old block
   * (a move) and a leftover event from an earlier crashed attempt at this same key are ours, not conflicts.
   * Read only. Also derives the idempotency key and event id this slot would get.
   */
  async function freshCheck({ row, ctx, parsed, oldBlock = null }) {
    const attempt = countBlocksWithSlot(db, row.id, parsed.startUtc, parsed.endUtc);
    const key = makeIdempotencyKey({ actionId: row.id, startUtc: parsed.startUtc, endUtc: parsed.endUtc, attempt });
    const eventId = eventIdFromKey(key);
    const events = (await calendar.listEvents({ fromMs: parsed.startMs, toMs: parsed.endMs })).filter(
      (e) => e.id !== eventId && !(oldBlock && e.id === oldBlock.google_event_id),
    );
    const { conflicts } = detectConflicts({
      block: { startMs: parsed.startMs, endMs: parsed.endMs, googleEventId: oldBlock?.google_event_id ?? null, idempotencyKey: oldBlock?.idempotency_key ?? null },
      events,
      tz: ctx.settings.tz,
      supersededKeys: allSupersededKeys(db),
      ignoreAllDay: ctx.settings.ignoreAllDay,
    });
    return { attempt, key, eventId, conflicts };
  }

  /** Shared by approve and move: fresh check, write, read back. Returns the pieces or a failure. */
  async function writeBlock({ row, ctx, parsed, nowMs, oldBlock = null }) {
    const { settings } = ctx;
    const { attempt, key, eventId, conflicts } = await freshCheck({ row, ctx, parsed, oldBlock });
    if (conflicts.length) {
      const alternative = await search({ row, ctx, nowMs, activeBlock: oldBlock, useEvents: true });
      return fail(409, "slot_no_longer_available", {
        detail: "Your calendar changed since this slot was proposed.",
        conflicts,
        alternative,
      });
    }

    const body = buildEventBody({
      eventId,
      summary: row.title ?? "Saved action",
      description: describe(row),
      startUtc: parsed.startUtc,
      endUtc: parsed.endUtc,
      tz: settings.tz,
      tags: blockTags(key),
    });
    await writeEvent(body, eventId, key);
    const readback = await readBack(eventId, { startUtc: parsed.startUtc, endUtc: parsed.endUtc, tz: settings.tz, idempotencyKey: key });
    return { ok: true, key, eventId, attempt, readback };
  }

  // Read only helpers for the agent step. They share planContext, search, checkSlot and freshCheck with the write
  // paths above, so the agent can never be looser than approval is. None of them writes anything.
  async function agentContext(actionId) {
    const row = getRow(actionId);
    if (!row) return fail(404, "not_found");
    if (isClosed(row)) return fail(409, "action_closed");
    const ctx = planContext(row);
    if (!ctx.ok) return ctx;
    const active = row.status === "planned" ? getActiveBlock(db, actionId) : null;
    return { ok: true, row, ctx, active };
  }

  return {
    /** Read only. Everything the agent is told about the action. */
    agentFacts({ actionId }) {
      return guard(async () => {
        const c = await agentContext(actionId);
        if (!c.ok) return c;
        const { row, ctx, active } = c;
        const { tz, workStart, workEnd } = ctx.settings;
        const nowMs = clock();
        return {
          ok: true,
          facts: {
            actionId,
            title: row.title,
            deliverables: JSON.parse(row.deliverables_json ?? "[]"),
            durationMin: ctx.durationMin,
            tz,
            workStart,
            workEnd,
            deadline: ctx.deadline.present ? { utc: ctx.deadline.utc, display: formatForDisplay(ctx.deadline.utc, tz) } : null,
            nowUtc: toIso(nowMs),
            nowDisplay: formatForDisplay(nowMs, tz),
            mode: active ? "move" : "new",
            currentBlock: active ? { startDisplay: formatForDisplay(active.start_utc, tz), endDisplay: formatForDisplay(active.end_utc, tz) } : null,
          },
        };
      });
    },

    /** Read only. Busy intervals (no event titles) in a window. FreeBusy for a new block, events for a move. */
    readAvailability({ actionId, fromMs, toMs }) {
      return guard(async () => {
        const c = await agentContext(actionId);
        if (!c.ok) return c;
        const { ctx, active } = c;
        const tz = ctx.settings.tz;
        let busy;
        let source;
        if (active || ctx.settings.ignoreAllDay) {
          const events = await calendar.listEvents({ fromMs, toMs });
          busy = busyFromEvents({ block: active ? blockShape(active) : {}, events, tz, supersededKeys: allSupersededKeys(db), ignoreAllDay: ctx.settings.ignoreAllDay });
          source = "events";
        } else {
          busy = await calendar.freeBusy({ fromMs, toMs });
          source = "freebusy";
        }
        const merged = mergeIntervals(busy.map((b) => ({ start: Math.max(b.start, fromMs), end: Math.min(b.end, toMs) })));
        const list = merged.slice(0, 60).map((b) => decorateSlot({ startUtc: toIso(b.start), endUtc: toIso(b.end) }, tz, (b.end - b.start) / MIN));
        return { ok: true, source, tz, busy: list.map(({ startUtc, endUtc, startDisplay, endDisplay }) => ({ startUtc, endUtc, startDisplay, endDisplay })), truncated: merged.length > 60 };
      });
    },

    /** Read only. The earliest slot that satisfies every rule, optionally not before an instant. */
    findCandidate({ actionId, notBeforeMs = 0 }) {
      return guard(async () => {
        const c = await agentContext(actionId);
        if (!c.ok) return c;
        const found = await search({ row: c.row, ctx: c.ctx, nowMs: clock(), activeBlock: c.active, notBeforeMs });
        return { ok: true, mode: c.active ? "move" : "new", ...found };
      });
    },

    /** Read only. Everything approve or move would check before writing, without writing. */
    validateCandidate({ actionId, slot }) {
      return guard(async () => {
        const c = await agentContext(actionId);
        if (!c.ok) return c;
        const parsed = parseSlot(slot);
        if (!parsed) return fail(400, "invalid_slot", { detail: "Not a valid pair of ISO instants." });
        const checked = checkSlot(parsed, c.ctx, clock());
        if (!checked.ok) return checked;
        const { conflicts } = await freshCheck({ row: c.row, ctx: c.ctx, parsed, oldBlock: c.active });
        if (conflicts.length) return fail(409, "slot_no_longer_available", { detail: "Your calendar changed.", conflicts });
        return { ok: true, mode: c.active ? "move" : "new", slot: decorate({ startUtc: parsed.startUtc, endUtc: parsed.endUtc }, c.ctx.settings.tz, c.ctx.durationMin) };
      });
    },

    /** Read only. Proposes the earliest valid slot, or says what would change a red outcome. */
    propose({ actionId }) {
      return guard(async () => {
        const row = getRow(actionId);
        if (!row) return fail(404, "not_found");
        if (isClosed(row)) return fail(409, "action_closed");
        const ctx = planContext(row);
        if (!ctx.ok) return ctx;
        const active = row.status === "planned" ? getActiveBlock(db, actionId) : null;
        const found = await search({ row, ctx, nowMs: clock(), activeBlock: active });
        return { ok: true, mode: active ? "move" : "new", ...found };
      });
    },

    /** Write the first block. Needs approved: true. Replaying the same approved slot returns the existing block. */
    approve({ actionId, slot, approved }) {
      return guard(async () => {
        if (approved !== true) return fail(400, "approval_required", { detail: "Nothing is written to your calendar without approval." });
        const row = getRow(actionId);
        if (!row) return fail(404, "not_found");
        if (isClosed(row)) return fail(409, "action_closed");
        const parsed = parseSlot(slot);
        if (!parsed) return fail(400, "invalid_slot", { detail: "Send startUtc and endUtc as ISO instants with Z or an offset." });

        const active = getActiveBlock(db, actionId);
        if (row.status === "planned" || active) {
          if (active && active.start_utc === parsed.startUtc && active.end_utc === parsed.endUtc) {
            return { ok: true, replayed: true, ...summary(row), block: blockView(active, { nowMs: clock() }) };
          }
          return fail(409, "already_planned", { detail: "This action already has a block. Move it instead." });
        }

        const ctx = planContext(row);
        if (!ctx.ok) return ctx;
        const nowMs = clock();
        const checked = checkSlot(parsed, ctx, nowMs);
        if (!checked.ok) return checked;

        const written = await writeBlock({ row, ctx, parsed, nowMs });
        if (!written.ok) return written;

        const nowIso = toIso(nowMs);
        const blockId = db.transaction(() => {
          const id = insertBlock(db, {
            actionId,
            googleEventId: written.eventId,
            idempotencyKey: written.key,
            startUtc: parsed.startUtc,
            endUtc: parsed.endUtc,
            tz: ctx.settings.tz,
            readback: written.readback,
            nowIso,
          });
          db.prepare("UPDATE actions SET status = 'planned', updated_at = ? WHERE id = ?").run(nowIso, actionId);
          return id;
        })();
        return { ok: true, replayed: false, ...summary(row), block: blockView(getBlock(db, blockId), { nowMs: clock() }) };
      });
    },

    /** Replace the active block with a new one the user approved. The old block is superseded, its event removed. */
    move({ actionId, slot, approved, restore = false }) {
      return guard(async () => {
        if (approved !== true) return fail(400, "approval_required", { detail: "Nothing is written to your calendar without approval." });
        const row = getRow(actionId);
        if (!row) return fail(404, "not_found");
        if (isClosed(row)) return fail(409, "action_closed");
        const old = getActiveBlock(db, actionId);
        if (row.status !== "planned" || !old) return fail(409, "not_planned", { detail: "There is no block to move. Approve one first." });
        const parsed = parseSlot(slot);
        if (!parsed) return fail(400, "invalid_slot", { detail: "Send startUtc and endUtc as ISO instants with Z or an offset." });
        const ctx = planContext(row);
        if (!ctx.ok) return ctx;
        const nowMs = clock();
        const checked = checkSlot(parsed, ctx, nowMs);
        if (!checked.ok) return checked;

        // Same slot is only allowed to re-create an event that was deleted from the calendar.
        const sameSlot = old.start_utc === parsed.startUtc && old.end_utc === parsed.endUtc;
        if (sameSlot && !restore) {
          const oldEvent = await calendar.getEvent(old.google_event_id);
          if (oldEvent && oldEvent.status !== "cancelled") return fail(409, "same_slot", { detail: "The block is already at that time." });
        }

        if(restore && old.readback_status!=='drift' && old.readback_status!=='failed')return fail(409,'restore_not_needed',{detail:'The current block has no recorded read-back problem.'});
        const written = await writeBlock({ row, ctx, parsed, nowMs, oldBlock: old });
        if (!written.ok) return written;
        const plan = planMove({ oldBlock: old, newSlot: parsed, tz: ctx.settings.tz, attempt: written.attempt });
        if (!plan.ok) return fail(409, plan.reason);

        const nowIso = toIso(nowMs);
        const newId = db.transaction(() => {
          const id = insertBlock(db, {
            actionId,
            googleEventId: plan.newBlock.google_event_id,
            idempotencyKey: plan.newBlock.idempotency_key,
            startUtc: parsed.startUtc,
            endUtc: parsed.endUtc,
            tz: ctx.settings.tz,
            readback: written.readback,
            nowIso,
          });
          supersedeBlock(db, old.id, id);
          db.prepare("UPDATE actions SET updated_at = ? WHERE id = ?").run(nowIso, actionId);
          return id;
        })();

        // Only after the new block is committed: remove the old event. If that fails the old event is a stale
        // leftover (its key is superseded, so conflict detection ignores it) and is reported, not hidden.
        let eventDeleted = false;
        let deleteError = null;
        try {
          eventDeleted = await removeEvent(old.google_event_id);
          if (eventDeleted) markEventDeleted(db, old.id, nowIso);
        } catch (err) {
          if (!(err instanceof CalendarError)) throw err;
          deleteError = err.code;
        }
        return {
          ok: true,
          ...summary(row),
          block: blockView(getBlock(db, newId), { nowMs: clock() }),
          previous: { id: old.id, eventDeleted, deleteError },
        };
      });
    },

    currentSlot({actionId}) {
      const block=getActiveBlock(db,actionId);
      return block?{ok:true,slot:{startUtc:block.start_utc,endUtc:block.end_utc}}:fail(409,'no_active_block');
    },
    undo({actionId, approved}) {
      return guard(async () => {
        const row=getRow(actionId);if(!row)return fail(404,'not_found');
        const transition=db.prepare('SELECT * FROM action_transitions WHERE action_id=? AND undone_at IS NULL ORDER BY id DESC LIMIT 1').get(actionId);
        if(!transition || !['done','skipped'].includes(row.status) || row.status!==transition.next_status || row.updated_at!==transition.changed_at)return fail(409,'nothing_to_undo',{detail:'Only the latest unchanged done or skip transition can be undone.'});
        const block=getActiveBlock(db,actionId);
        if(transition.previous_status==='planned'&&!block)return fail(409,'calendar_restore_required',{detail:'The calendar block was removed. A new explicitly approved plan is required.'});
        let calendarChanged = false;
        if (row.status === 'done' && block) {
          const result = await updateCompletionTitle({ db, calendar, block, done: false, approved, clock });
          if (!result.ok) return result;
          calendarChanged = result.updated;
        }
        const nowIso=toIso(clock());
        db.transaction(()=>{db.prepare('UPDATE actions SET status=?,done_at=?,updated_at=? WHERE id=?').run(transition.previous_status,transition.previous_done_at,nowIso,actionId);db.prepare('UPDATE action_transitions SET undone_at=? WHERE id=?').run(nowIso,transition.id)})();
        return {ok:true,...summary(row),calendarUnchanged:!calendarChanged};
      });
    },
    /** Re-fetch the active block's event and compare again. */
    readback({ actionId }) {
      return guard(async () => {
        const row = getRow(actionId);
        if (!row) return fail(404, "not_found");
        const block = getActiveBlock(db, actionId);
        if (!block) return fail(409, "no_active_block");
        const result = await readBack(block.google_event_id, block);
        saveReadback(db, block.id, result, toIso(clock()));
        return { ok: true, block: blockView(getBlock(db, block.id), { nowMs: clock() }) };
      });
    },

    /** User reports it done and approves the completion title on the active calendar event. */
    markDone({ actionId, approved }) {
      return guard(async () => {
        const row = getRow(actionId);
        if (!row) return fail(404, "not_found");
        if (isClosed(row)) return fail(409, "action_closed");
        const block = getActiveBlock(db, actionId);
        if (block) {
          const result = await updateCompletionTitle({ db, calendar, block, done: true, approved, clock });
          if (!result.ok) return result;
        }
        const nowIso = toIso(clock());
        db.transaction(()=>{
          db.prepare('INSERT INTO action_transitions(action_id,previous_status,next_status,previous_done_at,changed_at) VALUES (?,?,?,?,?)').run(actionId,row.status,'done',row.done_at,nowIso);
          db.prepare("UPDATE actions SET status = 'done', done_at = ?, updated_at = ? WHERE id = ?").run(nowIso, nowIso, actionId);
        })();
        return { ok: true, ...summary(row) };
      });
    },

    /** Skip. The calendar block is only removed if the user asks for it (removeFromCalendar: true). */
    skip({ actionId, removeFromCalendar = false }) {
      return guard(async () => {
        const row = getRow(actionId);
        if (!row) return fail(404, "not_found");
        if (isClosed(row)) return fail(409, "action_closed");
        const nowIso = toIso(clock());
        const block = getActiveBlock(db, actionId);
        let removed = false;
        let removeError = null;
        if (block && removeFromCalendar === true) {
          try {
            removed = await removeEvent(block.google_event_id);
          } catch (err) {
            if (!(err instanceof CalendarError)) throw err;
            removeError = err.code;
          }
          if (removed) {
            markEventDeleted(db, block.id, nowIso);
            cancelBlock(db, block.id, nowIso);
          }
        }
        db.transaction(()=>{
          db.prepare('INSERT INTO action_transitions(action_id,previous_status,next_status,previous_done_at,changed_at) VALUES (?,?,?,?,?)').run(actionId,row.status,'skipped',row.done_at,nowIso);
          db.prepare("UPDATE actions SET status = 'skipped', updated_at = ? WHERE id = ?").run(nowIso, actionId);
        })();
        return { ok: true, ...summary(row), calendar: { hadBlock: Boolean(block), removed, removeError } };
      });
    },
  };
}
