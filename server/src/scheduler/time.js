// Pure time helpers for the scheduler. Instants are epoch milliseconds internally.
// Every wall time to UTC conversion goes through ../tz.js (moment-timezone).
import { addDays, localDate, wallToUtc } from "../tz.js";

export const MIN = 60_000;

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Date | number | ISO string -> epoch ms (NaN if unparseable). Only for absolute instants that carry an offset or Z. */
export function toMs(t) {
  if (t instanceof Date) return t.getTime();
  if (typeof t === "number") return t;
  return Date.parse(t);
}

export function toIso(ms) {
  return new Date(ms).toISOString();
}

export function ceilToGrid(ms, gridMin) {
  const g = gridMin * MIN;
  return Math.ceil(ms / g) * g;
}

export function floorToGrid(ms, gridMin) {
  const g = gridMin * MIN;
  return Math.floor(ms / g) * g;
}

/** workStart "HH:mm", workEnd "HH:mm" or "24:00", end strictly after start. */
export function validateWorkingHours({ workStart, workEnd } = {}) {
  if (typeof workStart !== "string" || !HHMM.test(workStart)) return { ok: false, reason: "invalid_working_hours" };
  if (typeof workEnd !== "string" || !(HHMM.test(workEnd) || workEnd === "24:00")) {
    return { ok: false, reason: "invalid_working_hours" };
  }
  if (workEnd <= workStart) return { ok: false, reason: "invalid_working_hours" };
  return { ok: true };
}

function wallMs(date, hhmm, tz) {
  const r = wallToUtc(`${date}T${hhmm}`, tz);
  if (!r.ok) throw new Error(`cannot resolve ${date}T${hhmm} in ${tz}: ${r.reason}`);
  return r.ms;
}

/**
 * Working windows (local workStart to workEnd on each local day) clipped to [fromMs, toMs].
 * Window edges are computed per local day, so DST changes shift the UTC edges correctly.
 * Caller must validate tz and hours first.
 */
export function workingWindows({ fromMs, toMs: untilMs, tz, workStart, workEnd }) {
  const out = [];
  if (!(untilMs > fromMs)) return out;
  const lastDay = localDate(untilMs, tz);
  for (let day = localDate(fromMs, tz); day <= lastDay; day = addDays(day, 1)) {
    const start = wallMs(day, workStart, tz);
    const end = workEnd === "24:00" ? wallMs(addDays(day, 1), "00:00", tz) : wallMs(day, workEnd, tz);
    const s = Math.max(start, fromMs);
    const e = Math.min(end, untilMs);
    if (e > s) out.push({ start: s, end: e });
  }
  return out;
}

/** Sort and merge overlapping or touching intervals. Drops empty ones. */
export function mergeIntervals(list) {
  const sorted = list
    .filter((i) => i.end > i.start)
    .map((i) => ({ start: i.start, end: i.end }))
    .sort((a, b) => a.start - b.start);
  const out = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push(i);
  }
  return out;
}

/** windows minus busy -> free intervals. */
export function subtractIntervals(windows, busy) {
  const blockers = mergeIntervals(busy);
  const out = [];
  for (const w of mergeIntervals(windows)) {
    let cursor = w.start;
    for (const b of blockers) {
      if (b.end <= cursor) continue;
      if (b.start >= w.end) break;
      if (b.start > cursor) out.push({ start: cursor, end: b.start });
      cursor = Math.max(cursor, b.end);
      if (cursor >= w.end) break;
    }
    if (cursor < w.end) out.push({ start: cursor, end: w.end });
  }
  return out;
}

/** Half open overlap: touching intervals do not overlap. */
export function overlaps(a, b) {
  return a.start < b.end && b.start < a.end;
}
