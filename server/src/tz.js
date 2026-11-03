// All wall time to UTC conversion and offset math goes through moment-timezone.
// Do NOT use Intl, Luxon or date-fns-tz here: Node 22.21 ships tzdata 2025b and
// reports Africa/Casablanca as GMT+01:00 on 2026-11-05, which is wrong.
import moment from "moment-timezone";

const WALL_FORMAT = "YYYY-MM-DDTHH:mm";

export const SELF_TEST = Object.freeze({
  tz: "Africa/Casablanca",
  instantUtc: "2026-11-05T10:00:00Z",
  expectedOffset: "+00:00",
});

export function dataVersion() {
  return moment.tz.dataVersion;
}

export function isValidTimezone(tz) {
  return typeof tz === "string" && tz.length > 0 && moment.tz.zone(tz) !== null;
}

/**
 * Local wall time + IANA tz -> UTC.
 * Strict: wall must be exactly "YYYY-MM-DDTHH:mm". Date-only or partial input is rejected
 * (we never fill in a time the source did not give us).
 * Returns { ok: true, utc: "<ISO>", ms } or { ok: false, reason }.
 */
export function wallToUtc(wall, tz) {
  if (tz == null || tz === "") return { ok: false, reason: "missing_timezone" };
  if (!isValidTimezone(tz)) return { ok: false, reason: "invalid_timezone" };
  if (typeof wall !== "string") return { ok: false, reason: "invalid_wall_time" };
  const m = moment.tz(wall, WALL_FORMAT, true, tz);
  if (!m.isValid()) return { ok: false, reason: "invalid_wall_time" };
  return { ok: true, utc: m.toISOString(), ms: m.valueOf() };
}

/** Offset like "+00:00" for an instant in a zone. Throws on a bad zone. */
export function offsetAt(instant, tz) {
  if (!isValidTimezone(tz)) throw new Error(`invalid timezone: ${tz}`);
  return moment.utc(instant).tz(tz).format("Z");
}

/** Local calendar date "YYYY-MM-DD" of an instant in a zone. */
export function localDate(instant, tz) {
  return moment.utc(instant).tz(tz).format("YYYY-MM-DD");
}

/** "YYYY-MM-DD" plus n days, calendar arithmetic only (no zone involved). */
export function addDays(dateStr, n) {
  return moment.utc(dateStr, "YYYY-MM-DD", true).add(n, "days").format("YYYY-MM-DD");
}

/** Server side display string, e.g. "Thu 5 Nov 2026, 18:00 (+00:00)". The browser must never redo this. */
export function formatForDisplay(instant, tz) {
  if (!isValidTimezone(tz)) throw new Error(`invalid timezone: ${tz}`);
  return moment.utc(instant).tz(tz).format("ddd D MMM YYYY, HH:mm (Z)");
}

/**
 * Startup self test. Throws if moment-timezone does not give the expected offset.
 * `check` is injectable so the failure path can be unit tested.
 */
export function runSelfTest(check = SELF_TEST) {
  const actual = offsetAt(check.instantUtc, check.tz);
  const result = {
    ok: actual === check.expectedOffset,
    tz: check.tz,
    instantUtc: check.instantUtc,
    expected: check.expectedOffset,
    actual,
    momentTimezoneDataVersion: moment.tz.dataVersion,
    // Informational only. Node's Intl is known to be stale and is never used for math.
    nodeIntlOffset: intlOffsetFor(check.instantUtc, check.tz),
  };
  if (!result.ok) {
    throw new Error(
      `Timezone self test failed: ${check.tz} at ${check.instantUtc} gave ${actual}, expected ${check.expectedOffset} (tzdata ${moment.tz.dataVersion})`,
    );
  }
  return result;
}

function intlOffsetFor(instant, tz) {
  try {
    const part = new Intl.DateTimeFormat("en", { timeZone: tz, timeZoneName: "longOffset" })
      .formatToParts(new Date(instant))
      .find((p) => p.type === "timeZoneName");
    return part ? part.value : null;
  } catch {
    return null;
  }
}
