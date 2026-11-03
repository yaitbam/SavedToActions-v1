// Green / amber / red evaluation of an approved block. Pure function: the caller supplies
// the clock and the events, so the button and the 5 minute watcher run exactly the same code.
import { formatForDisplay } from "../tz.js";
import { APP_ID } from "./blocks.js";
import { busyFromEvents, detectConflicts } from "./conflicts.js";
import {
  DEFAULT_GRID_MIN,
  DEFAULT_HORIZON_DAYS,
  explainRed,
  findSlot,
  latestFeasibleStart,
  resolveDeadline,
  validateSearchInput,
} from "./slots.js";
import { MIN, toMs, workingWindows } from "./time.js";

/** Is [startMs, endMs] entirely inside one working window? */
export function insideWorkingHours({ startMs, endMs, tz, workStart, workEnd }) {
  const wins = workingWindows({ fromMs: startMs, toMs: endMs, tz, workStart, workEnd });
  return wins.length === 1 && wins[0].start === startMs && wins[0].end === endMs;
}

function fmt(ms, tz) {
  return formatForDisplay(ms, tz);
}

/**
 * Propose a slot for an action that has no block yet (initial search, from FreeBusy busy intervals
 * or event intervals). Returns { ok: true, slot } or { ok: false, reason, hints, explanation }.
 */
export function proposeSlot({ now, durationMin, busy, tz, workStart, workEnd, deadlineWall = null, deadlineTz = null, horizonDays, gridMin }) {
  const deadline = resolveDeadline({ wall: deadlineWall, tz: deadlineTz });
  if (!deadline.ok) return { ok: false, reason: deadline.reason, hints: null, explanation: [] };
  const params = { now, durationMin, busy, tz, workStart, workEnd, deadlineMs: deadline.ms, horizonDays, gridMin };
  const found = findSlot(params);
  if (found.ok) return found;
  const hints = explainRed(params, found);
  return { ...found, hints, explanation: redExplanation({ failed: found, hints, durationMin, tz, workStart, workEnd, deadline }) };
}

function redExplanation({ failed, hints, durationMin, tz, workStart, workEnd, deadline }) {
  if (failed.reason === "deadline_passed") return ["The deadline has passed."];
  if (failed.reason !== "no_slot_before_deadline" && failed.reason !== "no_slot_in_search_window") return [];
  const lines = [
    `No ${durationMin} minute slot fits under your working hours (${workStart} to ${workEnd})${
      deadline.present ? ` before the deadline (${fmt(deadline.ms, tz)})` : " in the search window"
    }.`,
  ];
  if (hints.fitsIfEffortAtMost) lines.push(`It would fit if the effort were ${hints.fitsIfEffortAtMost} minutes or less.`);
  if (hints.fitsIfWorkingHoursExtended) {
    lines.push(`It would fit outside your working hours at ${fmt(hints.fitsIfWorkingHoursExtended.startMs, tz)}.`);
  }
  if (!hints.fitsIfEffortAtMost && !hints.fitsIfWorkingHoursExtended) {
    lines.push("More free time before the deadline would be needed.");
  }
  return lines;
}

/**
 * Evaluate the current block against the calendar.
 *
 * block:  { startMs|start_utc, endMs|end_utc, googleEventId, idempotencyKey }  (active, approved block)
 * events: events.list items (singleEvents) covering from `now` to the deadline, or to the search horizon
 *         when there is no deadline. Must include the block window.
 * Returns { state, reason, ... } where state is 'green' | 'amber' | 'red', or 'needs_input'
 * when something required is missing (timezone, effort). We never color a state we cannot compute.
 */
export function evaluateBlock({
  block,
  events,
  now,
  durationMin,
  tz,
  workStart,
  workEnd,
  deadlineWall = null,
  deadlineTz = null,
  appId = APP_ID,
  supersededKeys = new Set(),
  ignoreAllDay = false,
  horizonDays = DEFAULT_HORIZON_DAYS,
  gridMin = DEFAULT_GRID_MIN,
}) {
  const valid = validateSearchInput({ durationMin, tz, workStart, workEnd, gridMin });
  if (!valid.ok) return needsInput(valid.reason);
  const deadline = resolveDeadline({ wall: deadlineWall, tz: deadlineTz });
  if (!deadline.ok) return needsInput(deadline.reason);

  const nowMs = toMs(now);
  const b = {
    startMs: block.startMs ?? toMs(block.start_utc),
    endMs: block.endMs ?? toMs(block.end_utc),
    googleEventId: block.googleEventId ?? block.google_event_id ?? null,
    idempotencyKey: block.idempotencyKey ?? block.idempotency_key ?? null,
  };

  if (deadline.present && deadline.ms <= nowMs) {
    return base("red", "deadline_passed", { deadline, explanation: [`The deadline has passed (${fmt(deadline.ms, tz)}).`] });
  }

  const { conflicts, ownEventFound } = detectConflicts({ block: b, events, tz, appId, supersededKeys, ignoreAllDay });

  // Reasons the current block no longer fits, besides calendar conflicts.
  const problems = [];
  for (const c of conflicts) problems.push({ type: c.kind === "other_block" ? "other_block_overlap" : "calendar_conflict", conflict: c });
  if (b.googleEventId && !ownEventFound) problems.push({ type: "block_event_missing" });
  // Planned but the time is over and it is not marked done: it needs a decision, not a green light.
  if (b.endMs <= nowMs) problems.push({ type: "block_in_past" });
  const blockMin = (b.endMs - b.startMs) / MIN;
  if (blockMin !== durationMin) problems.push({ type: "effort_changed", blockMin });
  if (deadline.present && b.endMs > deadline.ms) problems.push({ type: "after_deadline" });
  if (!insideWorkingHours({ startMs: b.startMs, endMs: b.endMs, tz, workStart, workEnd })) {
    problems.push({ type: "outside_working_hours" });
  }

  const busy = busyFromEvents({ block: b, events, tz, appId, supersededKeys, ignoreAllDay });
  const latest = deadline.present
    ? latestFeasibleStart({ now: nowMs, durationMin, busy, tz, workStart, workEnd, deadlineMs: deadline.ms, gridMin })
    : null;
  const extras = {
    deadline,
    conflicts,
    problems,
    ownEventFound,
    latestFeasibleStart: latest?.ok ? { ...latest.slot, label: latest.label } : null,
  };

  if (problems.length === 0) {
    return base("green", "block_fits", { ...extras, explanation: ["The current block fits your calendar."] });
  }

  const params = { now: nowMs, durationMin, busy, tz, workStart, workEnd, deadlineMs: deadline.ms, horizonDays, gridMin };
  // Prefer the nearest valid slot at or after the original block. Only look earlier if nothing later fits.
  const later = findSlot({ ...params, now: Math.max(nowMs, b.startMs) });
  const found = later.ok ? later : findSlot(params);
  const why = problems.map((p) => describeProblem(p, tz, workStart, workEnd, deadline, durationMin));

  if (found.ok) {
    const where = `${fmt(found.slot.startMs, tz)} to ${fmt(found.slot.endMs, tz)}`;
    return base("amber", problems[0].type, {
      ...extras,
      alternative: found.slot,
      explanation: [
        ...why,
        `Next valid slot: ${where}, inside your working hours (${workStart} to ${workEnd})${
          deadline.present ? " and before your deadline" : ""
        }.`,
      ],
    });
  }

  const hints = explainRed(params, found);
  return base("red", found.reason, {
    ...extras,
    hints,
    explanation: [...why, ...redExplanation({ failed: found, hints, durationMin, tz, workStart, workEnd, deadline })],
  });
}

function base(state, reason, rest) {
  return { state, reason, alternative: null, hints: null, ...rest };
}

function needsInput(reason) {
  return { state: "needs_input", reason, alternative: null, hints: null, conflicts: [], problems: [], explanation: [] };
}

function describeProblem(p, tz, workStart, workEnd, deadline, durationMin) {
  switch (p.type) {
    case "block_in_past":
      return "The planned time has already passed and this is not marked done. Mark it done, or move it.";
    case "effort_changed":
      return `The block is ${p.blockMin} minutes but your confirmed effort is now ${durationMin} minutes.`;
    case "calendar_conflict":
    case "other_block_overlap": {
      const c = p.conflict;
      const name = c.summary ? `"${c.summary}"` : "Another event";
      const prefix = p.type === "other_block_overlap" ? "Another SavedToAction block" : name;
      return `${prefix} overlaps your block (${fmt(toMs(c.startUtc), tz)} to ${fmt(toMs(c.endUtc), tz)}).`;
    }
    case "block_event_missing":
      return "The calendar event for this block was not found. It may have been deleted.";
    case "after_deadline":
      return `The block ends after the deadline (${fmt(deadline.ms, tz)}).`;
    case "outside_working_hours":
      return `The block is outside your working hours (${workStart} to ${workEnd}).`;
    default:
      return "The current block no longer fits.";
  }
}
