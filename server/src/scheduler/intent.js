// What the user's short note asked for, as a small closed set: when to do it and for how long. Nothing else.
// The model proposes these values, code checks them, and code (not the model) turns them into a search window.
// A note is not a prompt: anything outside this set is ignored.
import moment from "moment-timezone";
import { addDays, localDate, wallToUtc } from "../tz.js";

export const DAYS = ["today", "tomorrow", "weekend"];
export const PARTS = ["morning", "afternoon", "evening"];
// Part of the day as local hours. A search never leaves the user's own working hours, so these are intersected.
const PART_HOURS = { morning: ["06:00", "12:00"], afternoon: ["12:00", "17:00"], evening: ["17:00", "22:00"] };
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS_AHEAD = 180;

const text = (value, max) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);

/**
 * Cleans what the model returned. `matches(haystack, needle)` says whether a phrase is in the user's note.
 * Every part must quote words that are really in the note, otherwise it is dropped. Returns null if nothing is left.
 */
export function cleanIntent(raw, { note, today, matches }) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  let when = null;
  const w = raw.when;
  if (w && typeof w === "object") {
    const quote = text(w.quote, 80);
    const day = DAYS.includes(w.day) ? w.day : null;
    const part = PARTS.includes(w.part) ? w.part : null;
    let date = typeof w.date === "string" && ISO_DATE.test(w.date) ? w.date : null;
    if (date && (!moment.utc(date, "YYYY-MM-DD", true).isValid() || date < today || date > addDays(today, MAX_DAYS_AHEAD))) date = null;
    if (quote && matches(note, quote) && (day || date || part)) when = { day: date ? null : day, date, part, quote };
  }
  let minutes = null;
  let minutesQuote = null;
  const mins = typeof raw.minutes === "number" ? Math.round(raw.minutes) : null;
  const mq = text(raw.minutes_quote, 80);
  if (mins !== null && mins >= 1 && mins <= 1440 && mq && matches(note, mq)) {
    minutes = mins;
    minutesQuote = mq;
  }
  return when || minutes ? { when, minutes, minutesQuote } : null;
}

const cap = (word) => word.charAt(0).toUpperCase() + word.slice(1);

/** "Tonight", "Tomorrow morning", "This weekend", "22 Nov evening". */
export function intentLabel(when, tz, nowMs) {
  if (!when) return null;
  const part = when.part ?? null;
  if (when.date) {
    const date = moment.utc(when.date, "YYYY-MM-DD", true);
    const sameYear = tz && Number.isFinite(nowMs) ? date.year() === Number(localDate(nowMs, tz).slice(0, 4)) : true;
    return [date.format(sameYear ? "D MMM" : "D MMM YYYY"), part].filter(Boolean).join(" ");
  }
  if (when.day === "today") return part === "evening" ? "Tonight" : part ? `Today ${part}` : "Today";
  if (when.day === "tomorrow") return part ? `Tomorrow ${part}` : "Tomorrow";
  if (when.day === "weekend") return part ? `This weekend ${part}` : "This weekend";
  return part ? cap(part) : null;
}

/**
 * Turns an intent into search limits: do not start before, do not go past, and the hours to search in.
 * Returns { ok: true, notBeforeMs, untilMs, hours, label } or { ok: false, reason, label }.
 */
export function resolveWhen(when, { nowMs, tz, workStart, workEnd }) {
  const label = intentLabel(when, tz, nowMs);
  const today = localDate(nowMs, tz);
  let start;
  let end;
  if (when.date) {
    start = when.date;
    end = when.date;
  } else if (when.day === "today") {
    start = end = today;
  } else if (when.day === "tomorrow") {
    start = end = addDays(today, 1);
  } else if (when.day === "weekend") {
    const dow = moment.tz(nowMs, tz).isoWeekday();
    start = dow >= 6 ? today : addDays(today, 6 - dow);
    end = dow === 7 ? today : addDays(start, 1);
  } else {
    // Only a part of the day, such as "in the morning": the next few days.
    start = today;
    end = addDays(today, 2);
  }
  const first = wallToUtc(`${start}T00:00`, tz);
  const last = wallToUtc(`${addDays(end, 1)}T00:00`, tz);
  if (!first.ok || !last.ok) return { ok: false, reason: "invalid_window", label };
  if (last.ms <= nowMs) return { ok: false, reason: "in_the_past", label };
  let hours = null;
  if (when.part) {
    const [from, to] = PART_HOURS[when.part];
    const s = from > workStart ? from : workStart;
    const e = to < workEnd ? to : workEnd;
    if (s >= e) return { ok: false, reason: "outside_working_hours", label };
    hours = { workStart: s, workEnd: e };
  }
  return { ok: true, notBeforeMs: Math.max(nowMs, first.ms), untilMs: last.ms, hours, label };
}
