// Read-back comparison. After every write we fetch the event again and compare what Google stored with
// what we asked for. Pure function. Drift is flagged, never silently fixed.
//
// Google's handling of the Casablanca rule change is unverified, so besides start, end and timezone we also
// compare the UTC offset Google puts on the returned dateTime with the offset our own tz data computes.
import { isValidTimezone, offsetAt } from "../tz.js";
import { APP_ID, TAG_APP, TAG_KEY } from "./blocks.js";
import { toIso, toMs } from "./time.js";

const OFFSET_RE = /(Z|[+-]\d{2}:\d{2})$/;

/** "2026-11-05T15:00:00+01:00" -> "+01:00", "...Z" -> "+00:00", no offset -> null. */
export function offsetOfDateTime(s) {
  const m = typeof s === "string" ? OFFSET_RE.exec(s) : null;
  if (!m) return null;
  return m[1] === "Z" ? "+00:00" : m[1];
}

/**
 * block: { startUtc, endUtc, tz, idempotencyKey } (snake case accepted). event: the event as read back, or null.
 * Returns { status: "ok" | "drift", drift: [{ field, expected, actual }] }.
 */
export function compareReadback({ block, event }) {
  const drift = [];
  const add = (field, expected, actual) => drift.push({ field, expected, actual });
  if (!event) {
    add("event", "present", "missing");
    return { status: "drift", drift };
  }

  const tz = block.tz;
  const key = block.idempotencyKey ?? block.idempotency_key;
  const parts = [
    ["start", toMs(block.startUtc ?? block.start_utc), event.start],
    ["end", toMs(block.endUtc ?? block.end_utc), event.end],
  ];

  if (event.status === "cancelled") add("status", "confirmed", "cancelled");

  for (const [name, expectedMs, got] of parts) {
    const actualMs = got?.dateTime ? Date.parse(got.dateTime) : NaN;
    if (!Number.isFinite(actualMs)) {
      add(name, toIso(expectedMs), got?.date ? `all-day ${got.date}` : "missing");
      continue;
    }
    if (actualMs !== expectedMs) add(name, toIso(expectedMs), toIso(actualMs));
    if (isValidTimezone(tz)) {
      const expectedOffset = offsetAt(expectedMs, tz);
      const actualOffset = offsetOfDateTime(got.dateTime);
      if (actualOffset !== expectedOffset) add(`${name}_offset`, expectedOffset, actualOffset);
    }
  }

  const tzStart = event.start?.timeZone ?? null;
  const tzEnd = event.end?.timeZone ?? null;
  if (tzStart !== tz) add("tz", tz, tzStart);
  else if (tzEnd !== tz) add("end_tz", tz, tzEnd);

  const tags = event.extendedProperties?.private ?? {};
  if (tags[TAG_APP] !== APP_ID) add("tag_app", APP_ID, tags[TAG_APP] ?? null);
  if (tags[TAG_KEY] !== key) add("tag_key", key, tags[TAG_KEY] ?? null);

  return { status: drift.length ? "drift" : "ok", drift };
}
