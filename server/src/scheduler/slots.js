// Slot search as pure functions. No clock, no network, no database.
import { isValidTimezone, wallToUtc } from "../tz.js";
import {
  MIN,
  ceilToGrid,
  floorToGrid,
  subtractIntervals,
  toIso,
  toMs,
  validateWorkingHours,
  workingWindows,
} from "./time.js";

export const DEFAULT_GRID_MIN = 15;
// Search bound when an action has no deadline. It is a search limit, not an invented deadline.
export const DEFAULT_HORIZON_DAYS = 14;

export const LATEST_START_LABEL = "latest feasible start, given your current availability and confirmed effort";

/**
 * Deadline as stored: local wall time + IANA tz. Both missing means no deadline.
 * A wall time without a usable tz is an error. We never guess the zone.
 * Returns { ok: true, present, ms, utc } or { ok: false, reason }.
 */
export function resolveDeadline({ wall = null, tz = null } = {}) {
  if (wall == null) return { ok: true, present: false, ms: null, utc: null };
  const r = wallToUtc(wall, tz);
  if (!r.ok) return { ok: false, reason: r.reason === "invalid_wall_time" ? "invalid_deadline" : `deadline_${r.reason}` };
  return { ok: true, present: true, ms: r.ms, utc: r.utc };
}

/** Shared input checks. Returns { ok: true } or { ok: false, reason }. */
export function validateSearchInput({ durationMin, tz, workStart, workEnd, gridMin = DEFAULT_GRID_MIN }) {
  if (tz == null || tz === "") return { ok: false, reason: "missing_timezone" };
  if (!isValidTimezone(tz)) return { ok: false, reason: "invalid_timezone" };
  const hours = validateWorkingHours({ workStart, workEnd });
  if (!hours.ok) return hours;
  // Only confirmed effort is scheduled. Null means the user has not confirmed one yet.
  if (durationMin == null) return { ok: false, reason: "missing_effort" };
  if (!Number.isInteger(durationMin) || durationMin <= 0) return { ok: false, reason: "invalid_effort" };
  if (!Number.isInteger(gridMin) || gridMin <= 0) return { ok: false, reason: "invalid_grid" };
  return { ok: true };
}

function slotOf(startMs, durationMin) {
  const endMs = startMs + durationMin * MIN;
  return { startMs, endMs, startUtc: toIso(startMs), endUtc: toIso(endMs) };
}

function freeIntervals({ nowMs, untilMs, tz, workStart, workEnd, busy, gridMin }) {
  const from = ceilToGrid(nowMs, gridMin);
  const windows = workingWindows({ fromMs: from, toMs: untilMs, tz, workStart, workEnd });
  return subtractIntervals(windows, busy);
}

/**
 * Earliest slot of durationMin inside working hours, outside every busy interval, ending by the deadline.
 * busy: [{ start, end }] in epoch ms. Block starts land on the grid (default 15 min).
 *
 * Returns { ok: true, slot } or { ok: false, reason, longestFreeMin }.
 * reason: missing_timezone | invalid_timezone | invalid_working_hours | missing_effort | invalid_effort |
 *         invalid_grid | deadline_passed | no_slot_before_deadline | no_slot_in_search_window
 */
export function findSlot({
  now,
  durationMin,
  busy = [],
  tz,
  workStart,
  workEnd,
  deadlineMs = null,
  horizonDays = DEFAULT_HORIZON_DAYS,
  gridMin = DEFAULT_GRID_MIN,
}) {
  const valid = validateSearchInput({ durationMin, tz, workStart, workEnd, gridMin });
  if (!valid.ok) return valid;

  const nowMs = toMs(now);
  if (deadlineMs != null && deadlineMs <= nowMs) return { ok: false, reason: "deadline_passed", longestFreeMin: 0 };

  const untilMs = deadlineMs ?? nowMs + horizonDays * 24 * 60 * MIN;
  const free = freeIntervals({ nowMs, untilMs, tz, workStart, workEnd, busy, gridMin });

  for (const f of free) {
    const start = ceilToGrid(f.start, gridMin);
    if (start + durationMin * MIN <= f.end) return { ok: true, slot: slotOf(start, durationMin) };
  }
  return {
    ok: false,
    reason: deadlineMs != null ? "no_slot_before_deadline" : "no_slot_in_search_window",
    longestFreeMin: longestFreeMin(free, gridMin),
  };
}

/**
 * Latest start that still fits before the deadline, same constraints as findSlot.
 * Say it as: "latest feasible start, given your current availability and confirmed effort" (LATEST_START_LABEL).
 * Never "point of no return".
 */
export function latestFeasibleStart({
  now,
  durationMin,
  busy = [],
  tz,
  workStart,
  workEnd,
  deadlineMs,
  gridMin = DEFAULT_GRID_MIN,
}) {
  const valid = validateSearchInput({ durationMin, tz, workStart, workEnd, gridMin });
  if (!valid.ok) return valid;
  if (deadlineMs == null) return { ok: false, reason: "no_deadline" };

  const nowMs = toMs(now);
  if (deadlineMs <= nowMs) return { ok: false, reason: "deadline_passed", longestFreeMin: 0 };

  const free = freeIntervals({ nowMs, untilMs: deadlineMs, tz, workStart, workEnd, busy, gridMin });
  const earliest = ceilToGrid(nowMs, gridMin);
  for (let i = free.length - 1; i >= 0; i--) {
    const f = free[i];
    const start = floorToGrid(f.end - durationMin * MIN, gridMin);
    if (start >= f.start && start >= earliest) return { ok: true, slot: slotOf(start, durationMin), label: LATEST_START_LABEL };
  }
  return { ok: false, reason: "no_slot_before_deadline", longestFreeMin: longestFreeMin(free, gridMin) };
}

/** Longest contiguous free stretch, in whole minutes, usable from a grid aligned start. */
export function longestFreeMin(free, gridMin = DEFAULT_GRID_MIN) {
  let best = 0;
  for (const f of free) {
    const usable = f.end - ceilToGrid(f.start, gridMin);
    if (usable > best) best = usable;
  }
  return Math.floor(best / MIN);
}

/**
 * Failed search plus the levers that would change it. Both levers come from real data:
 * - fitsIfEffortAtMost: the longest free stretch under the current rules (minutes, grid aligned)
 * - fitsIfWorkingHoursExtended: earliest slot if the whole local day were allowed (null if still none)
 * Nothing here is advice to work outside hours. It only says what would change the outcome.
 */
export function explainRed(params, failed) {
  const gridMin = params.gridMin ?? DEFAULT_GRID_MIN;
  const hints = { fitsIfEffortAtMost: null, fitsIfWorkingHoursExtended: null };
  if (failed.reason !== "no_slot_before_deadline" && failed.reason !== "no_slot_in_search_window") return hints;

  const shorter = Math.floor((failed.longestFreeMin ?? 0) / gridMin) * gridMin;
  if (shorter > 0 && shorter < params.durationMin) hints.fitsIfEffortAtMost = shorter;

  const wide = findSlot({ ...params, workStart: "00:00", workEnd: "24:00" });
  if (wide.ok) hints.fitsIfWorkingHoursExtended = wide.slot;
  return hints;
}
