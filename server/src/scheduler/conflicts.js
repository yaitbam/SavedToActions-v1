// Conflict detection from event level reads (events.list). Pure functions.
//
// Never subtract our block from an aggregated FreeBusy interval: FreeBusy merges overlapping
// busy periods, so a meeting inside our own block would vanish. We look at each event instead.
import { wallToUtc } from "../tz.js";
import { APP_ID, readTags } from "./blocks.js";
import { overlaps, toIso } from "./time.js";

/**
 * Event start/end as epoch ms. dateTime events carry an explicit offset from Google, so Date.parse is exact.
 * All-day events (date only, end exclusive) are interpreted as whole local days in `tz`.
 * Returns null if the event has no usable times.
 */
export function eventInterval(event, tz) {
  const s = event?.start;
  const e = event?.end;
  if (s?.dateTime && e?.dateTime) {
    const start = Date.parse(s.dateTime);
    const end = Date.parse(e.dateTime);
    return Number.isFinite(start) && Number.isFinite(end) && end > start ? { start, end } : null;
  }
  if (s?.date && e?.date) {
    const a = wallToUtc(`${s.date}T00:00`, tz);
    const b = wallToUtc(`${e.date}T00:00`, tz);
    return a.ok && b.ok && b.ms > a.ms ? { start: a.ms, end: b.ms } : null;
  }
  return null;
}

/**
 * Events that do not block time. Same rules Google applies to free/busy:
 * cancelled, marked transparent ("free"), or declined by the calendar owner.
 */
export function ignoredReason(event, { ignoreAllDay = false } = {}) {
  if (event?.status === "cancelled") return "cancelled";
  if (event?.transparency === "transparent") return "transparent";
  // All-day events have a date and no dateTime. Only an event level read can tell, FreeBusy cannot.
  if (ignoreAllDay && event?.start?.date && !event?.start?.dateTime) return "all_day";
  const self = (event?.attendees ?? []).find((a) => a.self);
  if (self?.responseStatus === "declined") return "declined";
  return null;
}

function classify(event, block, { appId, supersededKeys }) {
  const { app, key } = readTags(event);
  const tagged = app === appId;
  if (block.googleEventId && event.id === block.googleEventId) return "own";
  if (tagged && key && key === block.idempotencyKey) return "own";
  if (tagged && key && supersededKeys.has(key)) return "stale";
  if (tagged) return "other_block";
  return "foreign";
}

/**
 * block: { startMs, endMs, googleEventId, idempotencyKey }
 * events: events.list items covering at least the block window.
 * Any event other than our own block that overlaps it is a conflict. That includes our other active
 * blocks (double booking) and excludes superseded leftovers, cancelled, transparent and declined events.
 *
 * Returns { conflicts, ownEventFound, ignored }.
 */
export function detectConflicts({ block, events, tz, appId = APP_ID, supersededKeys = new Set(), ignoreAllDay = false }) {
  const win = { start: block.startMs, end: block.endMs };
  const conflicts = [];
  const ignored = [];
  let ownEventFound = false;

  for (const event of events) {
    const kind = classify(event, block, { appId, supersededKeys });
    if (kind === "own") {
      if (event.status !== "cancelled") ownEventFound = true;
      continue;
    }
    const why = kind === "stale" ? "superseded_block" : ignoredReason(event, { ignoreAllDay });
    if (why) {
      ignored.push({ eventId: event.id, reason: why });
      continue;
    }
    const iv = eventInterval(event, tz);
    if (!iv || !overlaps(win, iv)) continue;
    conflicts.push({
      eventId: event.id,
      summary: event.summary ?? null,
      kind: kind === "other_block" ? "other_block" : "foreign",
      startUtc: toIso(iv.start),
      endUtc: toIso(iv.end),
    });
  }
  return { conflicts, ownEventFound, ignored };
}

/**
 * Busy intervals for searching an alternative slot, built from events and excluding our own block
 * (it is the thing being moved) and superseded leftovers. Includes our other active blocks.
 */
export function busyFromEvents({ block, events, tz, appId = APP_ID, supersededKeys = new Set(), ignoreAllDay = false }) {
  const busy = [];
  for (const event of events) {
    const kind = classify(event, block ?? {}, { appId, supersededKeys });
    if (kind === "own" || kind === "stale" || ignoredReason(event, { ignoreAllDay })) continue;
    const iv = eventInterval(event, tz);
    if (iv) busy.push(iv);
  }
  return busy;
}
