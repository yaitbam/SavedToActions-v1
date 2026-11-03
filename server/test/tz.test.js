import test from "node:test";
import assert from "node:assert/strict";
import { SELF_TEST, addDays, dataVersion, formatForDisplay, isValidTimezone, offsetAt, runSelfTest, wallToUtc } from "../src/tz.js";

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
