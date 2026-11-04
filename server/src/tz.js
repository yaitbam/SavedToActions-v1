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

const CHOOSABLE_ZONE = /^(Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific)\//;

/**
 * Zones a user can pick in Settings: canonical region names plus UTC, each with its offset at `instant`.
 * Offsets come from moment-timezone, never from Intl, so Africa/Casablanca is right. Sorted by offset, then name.
 * Legacy aliases such as US/Eastern are left out. They stay valid when sent, they are just not offered.
 */
export function listTimezones(instant) {
  const at = moment.utc(instant);
  return moment.tz
    .names()
    .filter((id) => id === "UTC" || CHOOSABLE_ZONE.test(id))
    .map((id) => ({ id, offset: at.clone().tz(id).format("Z"), minutes: at.clone().tz(id).utcOffset() }))
    .sort((a, b) => a.minutes - b.minutes || a.id.localeCompare(b.id))
    .map(({ id, offset }) => ({ id, offset }));
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
 * Short display relative to now, in the zone's own calendar days: "Today 18:30", "Tomorrow 09:00",
 * "Yesterday 22:00", "Thu 14:00" (2 to 6 days ahead), else "Thu 12 Nov 14:00" (year added when it differs).
 * Seven days ahead is never a bare weekday, it would read as today. Days are compared as calendar dates in
 * `tz`, so DST changes and midnight cannot shift them. It goes stale, compute it per response, never store it.
 */
export function formatRelative(instant, tz, nowMs) {
  if (!isValidTimezone(tz)) throw new Error(`invalid timezone: ${tz}`);
  const at = moment.utc(instant).tz(tz);
  const now = moment.utc(nowMs).tz(tz);
  const days = moment.utc(at.format("YYYY-MM-DD")).diff(moment.utc(now.format("YYYY-MM-DD")), "days");
  const time = at.format("HH:mm");
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Tomorrow ${time}`;
  if (days === -1) return `Yesterday ${time}`;
  if (days >= 2 && days <= 6) return `${at.format("ddd")} ${time}`;
  return `${at.format(at.year() === now.year() ? "ddd D MMM" : "ddd D MMM YYYY")} ${time}`;
}

/**
 * "22 Nov", or "22 Nov 2027" when it is not this year. The date only, in the zone of the instant.
 * Like formatRelative it goes stale, so compute it per response.
 */
export function formatShortDate(instant, tz, nowMs) {
  if (!isValidTimezone(tz)) throw new Error(`invalid timezone: ${tz}`);
  const at = moment.utc(instant).tz(tz);
  const now = moment.utc(nowMs).tz(tz);
  return at.format(at.year() === now.year() ? "D MMM" : "D MMM YYYY");
}

/** "Thu 14:00 to 15:00". The end repeats its day only when it falls on another local day. */
export function formatRelativeRange(startInstant, endInstant, tz, nowMs) {
  const start = formatRelative(startInstant, tz, nowMs);
  const sameDay = localDate(startInstant, tz) === localDate(endInstant, tz);
  const end = sameDay ? moment.utc(endInstant).tz(tz).format("HH:mm") : formatRelative(endInstant, tz, nowMs);
  return `${start} to ${end}`;
}

/** Adds the relative strings next to a slot-like object ({ startUtc, endUtc }). Unchanged without a clock. */
export const withRelativeSlot = (slot, tz, nowMs) =>
  slot && tz && Number.isFinite(nowMs)
    ? {
        ...slot,
        startRelative: formatRelative(slot.startUtc, tz, nowMs),
        endRelative: formatRelative(slot.endUtc, tz, nowMs),
        rangeRelative: formatRelativeRange(slot.startUtc, slot.endUtc, tz, nowMs),
      }
    : slot;

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
