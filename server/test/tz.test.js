import test from "node:test";
import assert from "node:assert/strict";
import { SELF_TEST, addDays, dataVersion, formatForDisplay, formatRelative, formatRelativeRange, isValidTimezone, listTimezones, offsetAt, runSelfTest, wallToUtc, withRelativeSlot } from "../src/tz.js";

test("listTimezones: moment-timezone offsets, Casablanca is +00:00, aliases left out, sorted by offset", () => {
  const zones = listTimezones(SELF_TEST.instantUtc);
  const offsets = Object.fromEntries(zones.map((zone) => [zone.id, zone.offset]));
  assert.equal(offsets["Africa/Casablanca"], "+00:00");
  assert.equal(offsets.UTC, "+00:00");
  assert.equal(offsets["America/New_York"], "-05:00");
  assert.equal(offsets["US/Eastern"], undefined);
  assert.equal(offsets["Etc/GMT+5"], undefined);
  assert.ok(zones.every((zone) => isValidTimezone(zone.id)));
  const minutes = zones.map((zone) => (zone.offset[0] === "-" ? -1 : 1) * (Number(zone.offset.slice(1, 3)) * 60 + Number(zone.offset.slice(4))));
  assert.deepEqual(minutes, [...minutes].sort((a, b) => a - b));
});

test("self test: Africa/Casablanca is +00:00 on 2026-11-05 (moment-timezone data, not Node Intl)", () => {
  assert.equal(offsetAt(SELF_TEST.instantUtc, SELF_TEST.tz), "+00:00");
  const result = runSelfTest();
  assert.equal(result.ok, true);
  assert.equal(result.actual, "+00:00");
  assert.ok(dataVersion(), "tzdata version is logged");
  assert.equal(result.momentTimezoneDataVersion, dataVersion());
});

test("self test throws when the offset is wrong, so the server stops", () => {
  assert.throws(
    () => runSelfTest({ ...SELF_TEST, expectedOffset: "+01:00" }),
    /Timezone self test failed.*Africa\/Casablanca.*gave \+00:00, expected \+01:00/,
  );
});

test("wallToUtc: Casablanca wall time converts with +00:00 on 2026-11-05", () => {
  const r = wallToUtc("2026-11-05T18:00", "Africa/Casablanca");
  assert.equal(r.ok, true);
  assert.equal(r.utc, "2026-11-05T18:00:00.000Z");
});

test("wallToUtc: America/New_York after the 2026-11-01 fall back is UTC-5", () => {
  assert.equal(wallToUtc("2026-11-05T09:00", "America/New_York").utc, "2026-11-05T14:00:00.000Z");
  assert.equal(wallToUtc("2026-10-30T09:00", "America/New_York").utc, "2026-10-30T13:00:00.000Z");
});

test("wallToUtc: missing and invalid inputs are reported, never guessed", () => {
  assert.deepEqual(wallToUtc("2026-11-05T18:00", null), { ok: false, reason: "missing_timezone" });
  assert.deepEqual(wallToUtc("2026-11-05T18:00", ""), { ok: false, reason: "missing_timezone" });
  assert.deepEqual(wallToUtc("2026-11-05T18:00", "Mars/Olympus"), { ok: false, reason: "invalid_timezone" });
  assert.deepEqual(wallToUtc("2026-11-05", "UTC"), { ok: false, reason: "invalid_wall_time" });
  assert.deepEqual(wallToUtc("tomorrow evening", "UTC"), { ok: false, reason: "invalid_wall_time" });
  assert.deepEqual(wallToUtc("2026-13-45T10:00", "UTC"), { ok: false, reason: "invalid_wall_time" });
  assert.deepEqual(wallToUtc(null, "UTC"), { ok: false, reason: "invalid_wall_time" });
});

test("isValidTimezone", () => {
  assert.equal(isValidTimezone("Africa/Casablanca"), true);
  assert.equal(isValidTimezone("UTC"), true);
  assert.equal(isValidTimezone("Nope/Nowhere"), false);
  assert.equal(isValidTimezone(undefined), false);
});

test("formatForDisplay is server formatted with the offset", () => {
  assert.equal(formatForDisplay("2026-11-05T18:00:00Z", "Africa/Casablanca"), "Thu 5 Nov 2026, 18:00 (+00:00)");
  assert.equal(formatForDisplay("2026-11-05T18:00:00Z", "America/New_York"), "Thu 5 Nov 2026, 13:00 (-05:00)");
});

test("addDays does calendar arithmetic across month and year ends", () => {
  assert.equal(addDays("2026-11-30", 1), "2026-12-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
});

// Now is Wed 4 Nov 2026 22:30 in Africa/Casablanca (+00:00).
const NOW = Date.parse("2026-11-04T22:30:00Z");
const CASA = "Africa/Casablanca";

test("formatRelative: today, tomorrow, yesterday, weekday within a week, then dates", () => {
  assert.equal(formatRelative("2026-11-04T18:30:00Z", CASA, NOW), "Today 18:30");
  assert.equal(formatRelative("2026-11-05T09:00:00Z", CASA, NOW), "Tomorrow 09:00");
  assert.equal(formatRelative("2026-11-03T22:00:00Z", CASA, NOW), "Yesterday 22:00");
  assert.equal(formatRelative("2026-11-06T14:00:00Z", CASA, NOW), "Fri 14:00");
  assert.equal(formatRelative("2026-11-10T14:00:00Z", CASA, NOW), "Tue 14:00");
  // 7 days ahead is the same weekday as today, so it gets a date.
  assert.equal(formatRelative("2026-11-11T14:00:00Z", CASA, NOW), "Wed 11 Nov 14:00");
  assert.equal(formatRelative("2026-11-01T10:00:00Z", CASA, NOW), "Sun 1 Nov 10:00");
});

test("formatRelative: midnight is judged in the target zone, not in UTC", () => {
  // 23:59 and 00:00 local on either side of midnight.
  assert.equal(formatRelative("2026-11-04T23:59:00Z", CASA, NOW), "Today 23:59");
  assert.equal(formatRelative("2026-11-05T00:00:00Z", CASA, NOW), "Tomorrow 00:00");
  // Auckland is +13:00 in November. 2026-11-04T22:30Z is Thu 5 Nov 11:30 there.
  const auckland = "Pacific/Auckland";
  assert.equal(formatRelative("2026-11-04T22:30:00Z", auckland, NOW), "Today 11:30");
  assert.equal(formatRelative("2026-11-04T10:59:00Z", auckland, NOW), "Yesterday 23:59");
  assert.equal(formatRelative("2026-11-04T11:00:00Z", auckland, NOW), "Today 00:00");
});

test("formatRelative: week edges, year change and DST", () => {
  // Sunday now, next Saturday is 6 days ahead.
  const sunday = Date.parse("2026-11-08T12:00:00Z");
  assert.equal(formatRelative("2026-11-14T09:00:00Z", CASA, sunday), "Sat 09:00");
  assert.equal(formatRelative("2026-11-15T09:00:00Z", CASA, sunday), "Sun 15 Nov 09:00");
  // Year differs, so the year is shown.
  const newYearEve = Date.parse("2026-12-31T20:00:00Z");
  assert.equal(formatRelative("2027-01-01T09:00:00Z", CASA, newYearEve), "Tomorrow 09:00");
  assert.equal(formatRelative("2027-01-20T09:00:00Z", CASA, newYearEve), "Wed 20 Jan 2027 09:00");
  // Paris leaves DST on Sun 25 Oct 2026. The calendar day count is not 24 hour based.
  const paris = "Europe/Paris";
  const beforeShift = Date.parse("2026-10-24T20:00:00Z");
  assert.equal(formatRelative("2026-10-25T08:00:00Z", paris, beforeShift), "Tomorrow 09:00");
  assert.equal(formatRelative("2026-10-26T08:00:00Z", paris, beforeShift), "Mon 09:00");
});

test("formatRelative: Casablanca stays +00:00 and a bad zone throws", () => {
  assert.equal(formatRelative("2026-11-05T10:00:00Z", CASA, NOW), "Tomorrow 10:00");
  assert.throws(() => formatRelative("2026-11-05T10:00:00Z", "Mars/Olympus", NOW), /invalid timezone/);
});

test("formatRelativeRange: end drops its day when it is the same local day", () => {
  assert.equal(formatRelativeRange("2026-11-05T14:00:00Z", "2026-11-05T15:00:00Z", CASA, NOW), "Tomorrow 14:00 to 15:00");
  assert.equal(formatRelativeRange("2026-11-04T23:00:00Z", "2026-11-05T01:00:00Z", CASA, NOW), "Today 23:00 to Tomorrow 01:00");
});

test("withRelativeSlot: unchanged without a clock or a zone", () => {
  const slot = { startUtc: "2026-11-05T14:00:00Z", endUtc: "2026-11-05T15:00:00Z" };
  assert.equal(withRelativeSlot(slot, CASA, undefined), slot);
  assert.equal(withRelativeSlot(null, CASA, NOW), null);
  assert.equal(withRelativeSlot(slot, CASA, NOW).startRelative, "Tomorrow 14:00");
});
