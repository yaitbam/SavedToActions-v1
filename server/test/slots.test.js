import test from "node:test";
import assert from "node:assert/strict";
import moment from "moment-timezone";
import {
  LATEST_START_LABEL,
  explainRed,
  findSlot,
  latestFeasibleStart,
  mergeIntervals,
  resolveDeadline,
  subtractIntervals,
  validateWorkingHours,
  workingWindows,
} from "../src/scheduler/index.js";

const t = (iso) => Date.parse(iso);
const iv = (a, b) => ({ start: t(a), end: t(b) });
const base = { tz: "UTC", workStart: "09:00", workEnd: "21:00", durationMin: 60 };
const NOW = t("2026-11-05T07:00:00Z");

test("validateWorkingHours", () => {
  assert.equal(validateWorkingHours({ workStart: "09:00", workEnd: "21:00" }).ok, true);
  assert.equal(validateWorkingHours({ workStart: "00:00", workEnd: "24:00" }).ok, true);
  for (const bad of [
    { workStart: "9:00", workEnd: "21:00" },
    { workStart: "09:00", workEnd: "9pm" },
    { workStart: "21:00", workEnd: "09:00" },
    { workStart: "09:00", workEnd: "09:00" },
    { workStart: "24:00", workEnd: "24:00" },
    { workStart: "09:00", workEnd: "25:00" },
    {},
  ]) {
    assert.equal(validateWorkingHours(bad).ok, false, JSON.stringify(bad));
  }
});

test("workingWindows: one window per local day, clipped to the range", () => {
  const w = workingWindows({ fromMs: t("2026-11-05T12:00:00Z"), toMs: t("2026-11-06T10:00:00Z"), ...base });
  assert.deepEqual(w, [iv("2026-11-05T12:00:00Z", "2026-11-05T21:00:00Z"), iv("2026-11-06T09:00:00Z", "2026-11-06T10:00:00Z")]);
});

test("workingWindows: Africa/Casablanca on 2026-11-05 is 09:00Z to 21:00Z (the Intl bug would give 08:00Z to 20:00Z)", () => {
  const w = workingWindows({
    fromMs: t("2026-11-05T00:00:00Z"),
    toMs: t("2026-11-06T00:00:00Z"),
    tz: "Africa/Casablanca",
    workStart: "09:00",
    workEnd: "21:00",
  });
  assert.deepEqual(w, [iv("2026-11-05T09:00:00Z", "2026-11-05T21:00:00Z")]);
});

test("workingWindows: DST fall back in America/New_York shifts the UTC edges", () => {
  const w = workingWindows({
    fromMs: t("2026-10-31T12:00:00Z"),
    toMs: t("2026-11-02T12:00:00Z"),
    tz: "America/New_York",
    workStart: "09:00",
    workEnd: "21:00",
  });
  assert.deepEqual(w, [
    iv("2026-10-31T13:00:00Z", "2026-11-01T01:00:00Z"), // EDT, UTC-4
    iv("2026-11-01T14:00:00Z", "2026-11-02T02:00:00Z"), // EST, UTC-5
  ]);
});

test("workingWindows: DST spring forward in America/New_York", () => {
  const w = workingWindows({
    fromMs: t("2026-03-07T12:00:00Z"),
    toMs: t("2026-03-09T12:00:00Z"),
    tz: "America/New_York",
    workStart: "09:00",
    workEnd: "21:00",
  });
  assert.deepEqual(w, [
    iv("2026-03-07T14:00:00Z", "2026-03-08T02:00:00Z"), // EST
    iv("2026-03-08T13:00:00Z", "2026-03-09T01:00:00Z"), // EDT
  ]);
});

test("workingWindows: 24:00 end runs to local midnight", () => {
  const w = workingWindows({ fromMs: t("2026-11-05T00:00:00Z"), toMs: t("2026-11-07T00:00:00Z"), ...base, workStart: "00:00", workEnd: "24:00" });
  assert.deepEqual(w, [iv("2026-11-05T00:00:00Z", "2026-11-06T00:00:00Z"), iv("2026-11-06T00:00:00Z", "2026-11-07T00:00:00Z")]);
});

test("mergeIntervals and subtractIntervals", () => {
  assert.deepEqual(
    mergeIntervals([iv("2026-11-05T10:00:00Z", "2026-11-05T11:00:00Z"), iv("2026-11-05T09:00:00Z", "2026-11-05T10:00:00Z"), iv("2026-11-05T12:00:00Z", "2026-11-05T12:00:00Z")]),
    [iv("2026-11-05T09:00:00Z", "2026-11-05T11:00:00Z")],
  );
  assert.deepEqual(
    subtractIntervals([iv("2026-11-05T09:00:00Z", "2026-11-05T21:00:00Z")], [iv("2026-11-05T10:00:00Z", "2026-11-05T11:00:00Z"), iv("2026-11-05T08:00:00Z", "2026-11-05T09:30:00Z")]),
    [iv("2026-11-05T09:30:00Z", "2026-11-05T10:00:00Z"), iv("2026-11-05T11:00:00Z", "2026-11-05T21:00:00Z")],
  );
});

test("resolveDeadline: none, resolved, and every missing-input case", () => {
  assert.deepEqual(resolveDeadline({}), { ok: true, present: false, ms: null, utc: null });
  // A zone with no wall time is not a deadline.
  assert.equal(resolveDeadline({ tz: "UTC" }).present, false);
  const ok = resolveDeadline({ wall: "2026-11-05T18:00", tz: "Africa/Casablanca" });
  assert.equal(ok.present, true);
  assert.equal(ok.utc, "2026-11-05T18:00:00.000Z");
  assert.deepEqual(resolveDeadline({ wall: "2026-11-05T18:00" }), { ok: false, reason: "deadline_missing_timezone" });
  assert.deepEqual(resolveDeadline({ wall: "2026-11-05T18:00", tz: "Nope/Nowhere" }), { ok: false, reason: "deadline_invalid_timezone" });
  assert.deepEqual(resolveDeadline({ wall: "2026-11-05", tz: "UTC" }), { ok: false, reason: "invalid_deadline" });
});

test("findSlot: earliest slot at the start of working hours", () => {
  const r = findSlot({ ...base, now: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.slot.startUtc, "2026-11-05T09:00:00.000Z");
  assert.equal(r.slot.endUtc, "2026-11-05T10:00:00.000Z");
});

test("findSlot: starts on the 15 minute grid, never in the past", () => {
  const r = findSlot({ ...base, now: t("2026-11-05T10:07:00Z") });
  assert.equal(r.slot.startUtc, "2026-11-05T10:15:00.000Z");
});

test("findSlot: skips busy time and rounds up to the grid after it", () => {
  assert.equal(findSlot({ ...base, now: NOW, busy: [iv("2026-11-05T09:00:00Z", "2026-11-05T11:00:00Z")] }).slot.startUtc, "2026-11-05T11:00:00.000Z");
  assert.equal(findSlot({ ...base, now: NOW, busy: [iv("2026-11-05T09:00:00Z", "2026-11-05T10:10:00Z")] }).slot.startUtc, "2026-11-05T10:15:00.000Z");
});

test("findSlot: a gap that is too small is skipped, next day is used", () => {
  const r = findSlot({
    ...base,
    now: NOW,
    busy: [iv("2026-11-05T09:00:00Z", "2026-11-05T10:00:00Z"), iv("2026-11-05T10:30:00Z", "2026-11-05T22:00:00Z")],
  });
  assert.equal(r.slot.startUtc, "2026-11-06T09:00:00.000Z");
});

test("findSlot: never schedules outside working hours (any zone, any effort, any start)", () => {
  for (const tz of ["UTC", "Africa/Casablanca", "America/New_York", "Asia/Kathmandu", "Australia/Sydney"]) {
    for (const nowIso of ["2026-11-05T00:10:00Z", "2026-11-05T08:59:00Z", "2026-11-05T17:31:00Z", "2026-11-05T23:50:00Z"]) {
      for (let durationMin = 15; durationMin <= 720; durationMin += 45) {
        const r = findSlot({ now: t(nowIso), tz, workStart: "09:00", workEnd: "21:00", durationMin });
        assert.equal(r.ok, true, `${tz} ${nowIso} ${durationMin}`);
        const s = moment.utc(r.slot.startMs).tz(tz);
        const e = moment.utc(r.slot.endMs).tz(tz);
        assert.equal(s.format("YYYY-MM-DD"), e.format("YYYY-MM-DD"), `same local day ${tz} ${nowIso} ${durationMin}`);
        assert.ok(s.format("HH:mm") >= "09:00" && e.format("HH:mm") <= "21:00", `${tz} ${nowIso} ${durationMin}: ${s.format()} to ${e.format()}`);
        assert.ok(r.slot.startMs >= t(nowIso));
      }
    }
  }
});

test("findSlot: effort longer than the working day never fits", () => {
  assert.equal(findSlot({ ...base, now: NOW, durationMin: 720 }).ok, true);
  const r = findSlot({ ...base, now: NOW, durationMin: 735 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no_slot_in_search_window");
});

test("findSlot: deadline bounds the slot, ending exactly at the deadline is allowed", () => {
  const busy = [iv("2026-11-05T09:00:00Z", "2026-11-05T11:30:00Z")];
  const deadlineMs = t("2026-11-05T12:00:00Z");
  const tooLong = findSlot({ ...base, now: NOW, busy, deadlineMs });
  assert.equal(tooLong.ok, false);
  assert.equal(tooLong.reason, "no_slot_before_deadline");
  assert.equal(tooLong.longestFreeMin, 30);
  const fits = findSlot({ ...base, now: NOW, busy, deadlineMs, durationMin: 30 });
  assert.equal(fits.slot.startUtc, "2026-11-05T11:30:00.000Z");
  assert.equal(fits.slot.endUtc, "2026-11-05T12:00:00.000Z");
});

test("findSlot: deadline passed", () => {
  assert.equal(findSlot({ ...base, now: NOW, deadlineMs: NOW }).reason, "deadline_passed");
  assert.equal(findSlot({ ...base, now: NOW, deadlineMs: NOW - 1 }).reason, "deadline_passed");
});

test("findSlot: no deadline uses a search window, not an invented deadline", () => {
  const busy = [iv("2026-11-05T00:00:00Z", "2026-11-20T00:00:00Z")];
  const r = findSlot({ ...base, now: NOW, busy, horizonDays: 14 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no_slot_in_search_window");
});

test("findSlot: missing or invalid inputs are reported", () => {
  assert.equal(findSlot({ ...base, now: NOW, tz: null }).reason, "missing_timezone");
  assert.equal(findSlot({ ...base, now: NOW, tz: "Nope/Nowhere" }).reason, "invalid_timezone");
  assert.equal(findSlot({ ...base, now: NOW, durationMin: null }).reason, "missing_effort");
  assert.equal(findSlot({ ...base, now: NOW, durationMin: 0 }).reason, "invalid_effort");
  assert.equal(findSlot({ ...base, now: NOW, durationMin: 12.5 }).reason, "invalid_effort");
  assert.equal(findSlot({ ...base, now: NOW, workStart: "21:00", workEnd: "09:00" }).reason, "invalid_working_hours");
});

test("latestFeasibleStart: latest start that still ends by the deadline", () => {
  const deadlineMs = t("2026-11-05T18:00:00Z");
  const r = latestFeasibleStart({ ...base, now: NOW, deadlineMs });
  assert.equal(r.slot.startUtc, "2026-11-05T17:00:00.000Z");
  assert.equal(r.label, LATEST_START_LABEL);
  assert.match(r.label, /^latest feasible start, given your current availability and confirmed effort$/);
  assert.doesNotMatch(r.label, /point of no return/i);
});

test("latestFeasibleStart: works backwards around busy time and the grid", () => {
  const deadlineMs = t("2026-11-05T18:00:00Z");
  assert.equal(latestFeasibleStart({ ...base, now: NOW, deadlineMs, busy: [iv("2026-11-05T16:30:00Z", "2026-11-05T18:00:00Z")] }).slot.startUtc, "2026-11-05T15:30:00.000Z");
  assert.equal(latestFeasibleStart({ ...base, now: NOW, deadlineMs, busy: [iv("2026-11-05T17:10:00Z", "2026-11-05T18:00:00Z")] }).slot.startUtc, "2026-11-05T16:00:00.000Z");
});

test("latestFeasibleStart: a deadline after working hours is capped by working hours", () => {
  const r = latestFeasibleStart({ ...base, now: NOW, deadlineMs: t("2026-11-05T23:00:00Z") });
  assert.equal(r.slot.startUtc, "2026-11-05T20:00:00.000Z");
});

test("latestFeasibleStart: no deadline, deadline passed, no room", () => {
  assert.equal(latestFeasibleStart({ ...base, now: NOW }).reason, "no_deadline");
  assert.equal(latestFeasibleStart({ ...base, now: NOW, deadlineMs: NOW }).reason, "deadline_passed");
  const none = latestFeasibleStart({ ...base, now: NOW, deadlineMs: t("2026-11-05T10:00:00Z"), busy: [iv("2026-11-05T09:00:00Z", "2026-11-05T10:00:00Z")] });
  assert.equal(none.reason, "no_slot_before_deadline");
});

test("explainRed: names the real levers, nothing invented", () => {
  const params = {
    ...base,
    now: NOW,
    durationMin: 120,
    busy: [iv("2026-11-05T09:00:00Z", "2026-11-05T11:00:00Z")],
    deadlineMs: t("2026-11-05T12:00:00Z"),
  };
  const failed = findSlot(params);
  assert.equal(failed.reason, "no_slot_before_deadline");
  const hints = explainRed(params, failed);
  assert.equal(hints.fitsIfEffortAtMost, 60);
  assert.equal(hints.fitsIfWorkingHoursExtended.startUtc, "2026-11-05T07:00:00.000Z");
});

test("explainRed: no lever works", () => {
  const params = {
    ...base,
    now: t("2026-11-05T09:00:00Z"),
    durationMin: 120,
    busy: [iv("2026-11-05T09:00:00Z", "2026-11-05T09:30:00Z")],
    deadlineMs: t("2026-11-05T10:00:00Z"),
  };
  const failed = findSlot(params);
  const hints = explainRed(params, failed);
  assert.equal(hints.fitsIfEffortAtMost, 30);
  assert.equal(hints.fitsIfWorkingHoursExtended, null);
});
