// Recheck: is the approved block still good? ONE function, recheckAction, used by both the "Recheck now"
// button and the background watcher. Only the `source` label differs, so the demo button shows exactly what
// the watcher would have found. It reads the calendar (events.list, event level) and never writes to it.
//
// Result states: green (block fits), amber (conflict, another valid slot exists before the deadline),
// red (no slot fits), needs_input (timezone, effort or deadline timezone missing), error (calendar unreachable).
// Moving to the amber alternative is a separate, approved POST /move.
import { getActionView } from "../actions.js";
import { allSupersededKeys, checkView, decorateSlot, getActiveBlock, getCheck, insertCheck, listChecks } from "../blockStore.js";
import { getSettings } from "../db.js";
import { CalendarError, calendarErrorStatus } from "../google/calendar.js";
import { DEFAULT_HORIZON_DAYS, MIN, evaluateBlock, resolveDeadline, toIso, validateSearchInput } from "../scheduler/index.js";
import { formatForDisplay } from "../tz.js";

const DAY_MS = 24 * 60 * MIN;
const fail = (status, error, extra = {}) => ({ ok: false, status, error, ...extra });

/** The stored, API ready shape of an evaluation. Every time in it is formatted by the server. */
export function checkPayload(evaluation, { tz, durationMin }) {
  const slot = (s) => (s && tz ? decorateSlot(s, tz, durationMin) : null);
  const latest = evaluation.latestFeasibleStart;
  return {
    state: evaluation.state,
    reason: evaluation.reason,
    tz,
    explanation: evaluation.explanation,
    conflicts: (evaluation.conflicts ?? []).map((c) => ({
      ...c,
      startDisplay: formatForDisplay(c.startUtc, tz),
      endDisplay: formatForDisplay(c.endUtc, tz),
    })),
    problems: (evaluation.problems ?? []).map((p) => p.type),
    alternative: slot(evaluation.alternative),
    hints: evaluation.hints
      ? { ...evaluation.hints, fitsIfWorkingHoursExtended: slot(evaluation.hints.fitsIfWorkingHoursExtended) }
      : null,
    latestFeasibleStart: latest ? { ...slot(latest), label: latest.label } : null,
    ownEventFound: evaluation.ownEventFound ?? null,
    deadline: evaluation.deadline?.present ? { utc: evaluation.deadline.utc, display: formatForDisplay(evaluation.deadline.utc, tz) } : null,
  };
}

export function createRecheckService({ db, calendar, clock = Date.now, canRun = () => true, logger = console }) {
  const getRow = (id) => db.prepare("SELECT * FROM actions WHERE id = ?").get(id);

  /**
   * Recheck one planned action. source is "manual" (button) or "watcher". Always stores the check.
   * Returns { ok: true, check } or { ok: false, status, error, check? } (check present when it was stored).
   */
  async function recheckAction({ actionId, source = "manual" }) {
    const row = getRow(actionId);
    if (!row) return fail(404, "not_found");
    if (row.status === "done" || row.status === "skipped") return fail(409, "action_closed");
    const block = getActiveBlock(db, actionId);
    if (row.status !== "planned" || !block) return fail(409, "not_planned", { detail: "Only an approved block can be rechecked." });

    const settings = getSettings(db);
    const nowMs = clock();
    const durationMin = row.confirmed_effort_min;
    const deadline = resolveDeadline({ wall: row.deadline_wall, tz: row.deadline_tz });
    const inputsOk = validateSearchInput({ durationMin, tz: settings.tz, workStart: settings.workStart, workEnd: settings.workEnd }).ok && deadline.ok;
    const blockStartMs = Date.parse(block.start_utc);
    const blockEndMs = Date.parse(block.end_utc);

    const store = (payload) => {
      const id = insertCheck(db, { actionId, blockId: block.id, checkedAt: toIso(nowMs), source, payload });
      return checkView(getCheck(db, id));
    };

    let events = [];
    try {
      // Read only what evaluateBlock needs: the block window, and the window from now to the deadline (or the
      // search horizon) for the alternative. Nothing to read if the inputs are incomplete or the deadline is over.
      if (inputsOk && !(deadline.present && deadline.ms <= nowMs)) {
        const until = deadline.present ? deadline.ms : nowMs + DEFAULT_HORIZON_DAYS * DAY_MS;
        events = await calendar.listEvents({ fromMs: Math.min(nowMs, blockStartMs), toMs: Math.max(until, blockEndMs) });
      }
    } catch (err) {
      if (!(err instanceof CalendarError)) throw err;
      const check = store({ state: "error", reason: err.code, tz: settings.tz, explanation: [err.message], conflicts: [], problems: [], alternative: null, hints: null, latestFeasibleStart: null, ownEventFound: null, deadline: null });
      return fail(calendarErrorStatus(err.code), err.code, { detail: err.message, check });
    }

    const evaluation = evaluateBlock({
      block: { start_utc: block.start_utc, end_utc: block.end_utc, google_event_id: block.google_event_id, idempotency_key: block.idempotency_key },
      events,
      now: nowMs,
      durationMin,
      tz: settings.tz,
      workStart: settings.workStart,
      workEnd: settings.workEnd,
      deadlineWall: row.deadline_wall,
      deadlineTz: row.deadline_tz,
      supersededKeys: allSupersededKeys(db),
      ignoreAllDay: settings.ignoreAllDay,
    });
    const check = store(checkPayload(evaluation, { tz: settings.tz, durationMin }));
    return { ok: true, check, action: getActionView(db, actionId, {nowMs:clock()}) };
  }

  /** The watcher's job: recheck every planned action with an active block, one after another. */
  async function recheckAll({ source = "watcher" } = {}) {
    if (!canRun()) return { skipped: "google_not_connected", checked: 0, results: [] };
    const ids = db
      .prepare(
        `SELECT a.id FROM actions a
         WHERE a.status = 'planned'
           AND EXISTS (SELECT 1 FROM blocks b WHERE b.action_id = a.id AND b.superseded_by IS NULL AND b.cancelled_at IS NULL)
         ORDER BY a.id`,
      )
      .all()
      .map((r) => r.id);
    const results = [];
    for (const actionId of ids) {
      const r = await recheckAction({ actionId, source });
      results.push({ actionId, state: r.ok ? r.check.state : (r.check?.state ?? "error"), error: r.ok ? null : r.error });
    }
    if (ids.length) logger.log(`recheck (${source}): ${results.map((r) => `#${r.actionId} ${r.state}`).join(", ")}`);
    return { skipped: null, checked: ids.length, results };
  }

  /** Past checks of an action, newest first. */
  function history({ actionId, limit = 20 }) {
    if (!getRow(actionId)) return fail(404, "not_found");
    return { ok: true, checks: listChecks(db, actionId, Math.min(Number(limit) || 20, 100)).map(checkView) };
  }

  return { recheckAction, recheckAll, history };
}
