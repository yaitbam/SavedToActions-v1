// Turns the model's raw JSON into fields we trust enough to show. Pure functions.
//
// Rules from CLAUDE.md:
// - Missing means null. Nothing is invented. A deadline needs a quote that appears in the note or the
//   model's transcription, otherwise it is dropped and kept only as a warning.
// - Badges are precise: "Matched text in note", "Matched model transcription", "Edited by you".
//   Never "Verified". Matching the model's own transcription proves consistency, not correct reading.
// - UTC is computed here with moment-timezone from wall time + IANA tz. A UTC offset from the model is ignored.
import { isValidTimezone, localDate, wallToUtc, offsetAt } from "../tz.js";

export const KINDS = ["try", "opportunity", "other"];
export const LABELS = ["claim", "validate", "read", "someday"];
export const VERBATIM_TYPES = ["prompt", "link", "keyword"];

export const BADGE_LABELS = Object.freeze({
  matched_note: "Matched text in note",
  matched_transcription: "Matched model transcription",
  edited: "Edited by you",
});
export const NO_MATCH_LABEL = "No match in note or model transcription";

const MIN_MATCH_LEN = 3;
const WALL_RE = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

export function normalizeText(s) {
  return String(s ?? "")
    .normalize("NFKC")
    .replace(/[​-‍﻿]/g, "")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Does `needle` appear in `haystack` after light normalization (case, spaces, quote and dash styles)? */
export function textMatches(haystack, needle) {
  const n = normalizeText(needle);
  if (n.length < MIN_MATCH_LEN) return false;
  return normalizeText(haystack).includes(n);
}

export function matchSources(text, { note, transcription }) {
  return { note: textMatches(note, text), transcription: textMatches(transcription, text) };
}

/** Strongest honest badge. The note is the user's own text, so it outranks the model's transcription. */
export function badgeFor(matches, { edited = false } = {}) {
  if (edited) return "edited";
  if (matches.note) return "matched_note";
  if (matches.transcription) return "matched_transcription";
  return null;
}

export function badgeLabel(badge) {
  return badge ? BADGE_LABELS[badge] : NO_MATCH_LABEL;
}

function str(v, max) {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

function warn(warnings, code, field, message, proposed) {
  warnings.push(proposed ? { code, field, message, proposed } : { code, field, message });
}

/**
 * raw: parsed model JSON. ctx: { note, goals: [{id, name}], settingsTz, nowMs }.
 * Returns { fields, warnings }. Warnings are { code, field, message, proposed? }.
 */
export function normalizeExtraction(raw, { note = "", goals = [], settingsTz = null, nowMs }) {
  const warnings = [];
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const transcription = str(obj.transcription, 20000) ?? "";
  const sources = { note, transcription };

  let goalId = null;
  const rawGoal = typeof obj.goal_id === "string" && /^\d+$/.test(obj.goal_id) ? Number(obj.goal_id) : obj.goal_id;
  if (Number.isInteger(rawGoal) && goals.some((g) => g.id === rawGoal)) goalId = rawGoal;
  else warn(warnings, "goal_not_chosen", "goal", "The model did not pick one of your goals. Choose one.");

  let kind = obj.kind;
  if (!KINDS.includes(kind)) {
    kind = "other";
    warn(warnings, "kind_defaulted", "kind", 'The model gave no valid kind. Set to "other". Change it if needed.');
  }

  const label = LABELS.includes(obj.label) ? obj.label : null;

  const deliverables = [];
  const seen = new Set();
  for (const d of Array.isArray(obj.deliverables) ? obj.deliverables : []) {
    const t = str(d, 500);
    if (t && !seen.has(normalizeText(t))) {
      seen.add(normalizeText(t));
      deliverables.push(t);
    }
  }

  const verbatimItems = [];
  for (const item of Array.isArray(obj.verbatim_items) ? obj.verbatim_items : []) {
    const text = str(item?.text, 2000);
    if (!text) continue;
    const type = VERBATIM_TYPES.includes(item.type) ? item.type : "keyword";
    const matches = matchSources(text, sources);
    verbatimItems.push({ type, text, matches, badge: badgeFor(matches) });
  }
  const unmatchedItems = verbatimItems.filter((i) => !i.badge).length;
  if (unmatchedItems) {
    warn(
      warnings,
      "verbatim_unmatched",
      "verbatim_items",
      `${unmatchedItems} item${unmatchedItems > 1 ? "s were" : " was"} not found in your note or the model's transcription. Check against the screenshot.`,
    );
  }

  const evidenceQuote = str(obj.evidence_quote, 1000);
  const evidenceMatches = evidenceQuote ? matchSources(evidenceQuote, sources) : { note: false, transcription: false };
  if (evidenceQuote && !badgeFor(evidenceMatches)) {
    warn(warnings, "evidence_unmatched", "evidence_quote", "The evidence quote was not found in your note or the model's transcription.");
  }

  let suggestedEffortMin = null;
  if (typeof obj.suggested_effort_min === "number" && Number.isFinite(obj.suggested_effort_min)) {
    const m = Math.round(obj.suggested_effort_min);
    if (m >= 1 && m <= 1440) suggestedEffortMin = m;
  }

  const deadline = normalizeDeadline(obj.deadline, { sources, settingsTz, nowMs }, warnings);
  const eventDates = normalizeEventDates(obj.event_dates, { sources, today: localDate(nowMs, settingsTz ?? "UTC") }, warnings);

  return {
    fields: {
      eventDates,
      transcription,
      title: str(obj.title, 200),
      goalId,
      kind,
      label,
      deadline,
      deliverables: deliverables.slice(0, 10),
      verbatimItems: verbatimItems.slice(0, 30),
      evidenceQuote,
      evidenceMatches,
      suggestedEffortMin,
    },
    warnings,
  };
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const realDate = (d) => typeof d === "string" && ISO_DATE_RE.test(d) && wallToUtc(`${d}T00:00`, "UTC").ok;

/**
 * Event dates as written on the post (text, verbatim) plus the model's reading as YYYY-MM-DD.
 * "Event already happened" is judged only from dates whose text is found in the note or the transcription,
 * and only when every such date is before today. Date only comparison, no timezone needed.
 */
function normalizeEventDates(list, { sources, today }, warnings) {
  const items = [];
  for (const item of Array.isArray(list) ? list : []) {
    const text = str(item?.text, 200);
    if (!text) continue;
    let start = realDate(item.start) ? item.start : null;
    let end = realDate(item.end) ? item.end : null;
    if (start && end && end < start) {
      start = null;
      end = null;
    }
    const matches = matchSources(text, sources);
    items.push({ text, start, end: end ?? start, matches, badge: badgeFor(matches) });
  }
  const pastWarning=eventDateWarning(items,today);
  if(pastWarning)warnings.push(pastWarning);
  return items.slice(0, 10);
}

export function eventDateWarning(items,today) {
  const dated = items.filter((i) => i.badge && i.start);
  if (dated.length && dated.every((i) => (i.end ?? i.start) < today)) {
    const warnings=[];
    warn(
      warnings,
      "event_already_happened",
      "event_dates",
      `The dates on this post (${dated.map((i) => i.text).join(", ")}) are already in the past. This looks like a past edition, not the next one. Check for a newer announcement.`,
      { dates: dated.map(({ text, start, end }) => ({ text, start, end })), today },
    );
    return warnings[0];
  }
  return null;
}

function normalizeDeadline(d, { sources, settingsTz, nowMs }, warnings) {
  if (!d || typeof d !== "object") return null;
  const quote = str(d.quote, 500);
  const label = str(d.label, 200);
  const date = str(d.date, 20);
  let wall = str(d.wall, 40);
  let tz = str(d.tz, 80);
  const yearAssumed = d.year_assumed === true;
  if (!wall && !date) return null;

  let offsetDropped = false;
  let modelOffset = null;
  if (wall) {
    const m = wall.match(WALL_RE);
    if (!m) {
      warn(warnings, "deadline_invalid", "deadline", `The deadline "${wall}" is not a local wall time. Dropped.`, { wall, tz, quote });
      return null;
    }
    wall = `${m[1]}T${m[2]}`;
    offsetDropped = Boolean(m[3]);
    modelOffset = m[3] === 'Z' ? '+00:00' : m[3]?.replace(/^([+-]\d{2})(\d{2})$/, '$1:$2') ?? null;
  }
  const proposed = { wall, date, tz, quote, label };

  // No supporting text, no deadline. The proposal stays visible as a warning.
  if (!quote || !(textMatches(sources.note, quote) || textMatches(sources.transcription, quote))) {
    warn(
      warnings,
      "deadline_unsupported",
      "deadline",
      "The model proposed a deadline but its supporting text was not found in your note or the model's transcription. Not used.",
      proposed,
    );
    return null;
  }

  // A date with no time still is a deadline. The user has until the end of that day, so 23:59 is used and
  // flagged as assumed, so it is never shown as if the post had said it.
  let timeAssumed = false;
  if (!wall) {
    if (!realDate(date)) {
      warn(warnings, "deadline_invalid", "deadline", `The deadline date "${date}" is not a real date. Dropped.`, proposed);
      return null;
    }
    wall = `${date}T23:59`;
    timeAssumed = true;
    warn(
      warnings,
      "deadline_time_assumed",
      "deadline",
      `The post gives a date (${date}) but no time. Using the end of that day (23:59). Change the time if the post says otherwise.`,
      proposed,
    );
  }

  let tzSource = null;
  if (tz && !isValidTimezone(tz)) {
    warn(warnings, "deadline_timezone_invalid", "deadline", `"${tz}" is not a valid timezone. Ignored.`);
    tz = null;
  }
  if (tz) {
    tzSource = "model";
  } else if (settingsTz) {
    tz = settingsTz;
    tzSource = "settings_fallback";
    warn(warnings, "deadline_timezone_fallback", "deadline", `The post does not state a timezone. Using your settings timezone (${settingsTz}).`);
  } else {
    warn(warnings, "deadline_timezone_missing", "deadline", "The post does not state a timezone and none is set in settings. Set one before scheduling.");
  }

  const resolved = wallToUtc(wall, tz);
  if (!resolved.ok && resolved.reason === "invalid_wall_time") {
    warn(warnings, "deadline_invalid", "deadline", `The deadline "${wall}" is not a real date and time. Dropped.`, proposed);
    return null;
  }

  // A deadline that is already over when the save is imported is almost always a past edition.
  if (resolved.ok && resolved.ms <= nowMs) {
    warn(
      warnings,
      "deadline_in_past",
      "deadline",
      "The only date found is already in the past, so it was not used as a deadline. Add one if the post gives a new date.",
      proposed,
    );
    return null;
  }

  if (offsetDropped) {
    const computedOffset=resolved.ok ? offsetAt(resolved.utc,tz) : null;
    warn(warnings, "deadline_offset_ignored", "deadline", "The model included a UTC offset. It was ignored. UTC is computed from the wall time and timezone.", {wall,tz,modelOffset,computedOffset,corrected:computedOffset!==null && modelOffset!==computedOffset});
  }
  if (yearAssumed) {
    warn(warnings, "deadline_year_assumed", "deadline", `The year is not written in the post. Assumed ${wall.slice(0, 4)}. Check it.`);
  }

  return { wall, tz, tzSource, utc: resolved.ok ? resolved.utc : null, label, quote, yearAssumed, timeAssumed };
}
