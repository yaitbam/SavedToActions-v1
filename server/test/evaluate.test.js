import test from "node:test";
import assert from "node:assert/strict";
import { APP_ID, LATEST_START_LABEL, TAG_APP, TAG_KEY, evaluateBlock, proposeSlot } from "../src/scheduler/index.js";

const t = (iso) => Date.parse(iso);
const NOW = t("2026-11-05T08:00:00Z");

const block = {
  start_utc: "2026-11-05T14:00:00.000Z",
  end_utc: "2026-11-05T15:00:00.000Z",
  google_event_id: "stablock1",
  idempotency_key: "key1",
};

const ev = (id, start, end, extra = {}) => ({
  id,
  status: "confirmed",
  summary: `event ${id}`,
  start: { dateTime: start },
  end: { dateTime: end },
  ...extra,
});
const tagged = (key) => ({ extendedProperties: { private: { [TAG_APP]: APP_ID, [TAG_KEY]: key } } });
const ownEvent = () => ev("stablock1", block.start_utc, block.end_utc, tagged("key1"));

const base = {
  block,
  now: NOW,
  durationMin: 60,
  tz: "UTC",
  workStart: "09:00",
  workEnd: "21:00",
  deadlineWall: "2026-11-06T18:00",
  deadlineTz: "UTC",
};
const evalWith = (events, extra = {}) => evaluateBlock({ ...base, events, ...extra });

test("green: the current block fits, with the latest feasible start under the exact wording", () => {
  const r = evalWith([ownEvent(), ev("early", "2026-11-05T09:00:00Z", "2026-11-05T10:00:00Z")]);
  assert.equal(r.state, "green");
  assert.equal(r.reason, "block_fits");
  assert.deepEqual(r.conflicts, []);
  assert.equal(r.alternative, null);
  assert.equal(r.latestFeasibleStart.startUtc, "2026-11-06T17:00:00.000Z");
  assert.equal(r.latestFeasibleStart.label, LATEST_START_LABEL);
});

test("green without a deadline: no latest start is invented", () => {
  const r = evalWith([ownEvent()], { deadlineWall: null, deadlineTz: null });
  assert.equal(r.state, "green");
  assert.equal(r.latestFeasibleStart, null);
});

test("amber: a meeting overlaps the block, the nearest later slot is offered and explained", () => {
  const r = evalWith([ownEvent(), ev("m1", "2026-11-05T14:30:00Z", "2026-11-05T15:30:00Z", { summary: "Team sync" })]);
  assert.equal(r.state, "amber");
  assert.equal(r.reason, "calendar_conflict");
  assert.equal(r.alternative.startUtc, "2026-11-05T15:30:00.000Z");
  assert.equal(r.alternative.endUtc, "2026-11-05T16:30:00.000Z");
  assert.match(r.explanation[0], /"Team sync" overlaps your block/);
  assert.match(r.explanation.at(-1), /Next valid slot: .*15:30.*16:30.*working hours \(09:00 to 21:00\).*before your deadline/);
});

test("amber: the alternative may reuse part of the old window, because our own block is not busy", () => {
  const r = evalWith([ownEvent(), ev("m1", "2026-11-05T14:00:00Z", "2026-11-05T14:30:00Z")]);
  assert.equal(r.state, "amber");
  assert.equal(r.alternative.startUtc, "2026-11-05T14:30:00.000Z");
});

test("amber: a meeting inside the block is detected (FreeBusy would have merged it with our block)", () => {
  const r = evalWith([ownEvent(), ev("inside", "2026-11-05T14:10:00Z", "2026-11-05T14:40:00Z")]);
  assert.equal(r.state, "amber");
  assert.equal(r.conflicts[0].eventId, "inside");
});

test("amber falls back to an earlier slot only when nothing later fits", () => {
  // Deadline right after the block start leaves no later slot, earlier in the day is free.
  const r = evalWith([ownEvent(), ev("m1", "2026-11-05T14:00:00Z", "2026-11-05T14:30:00Z")], {
    deadlineWall: "2026-11-05T14:30",
    deadlineTz: "UTC",
  });
  assert.equal(r.state, "amber");
  assert.equal(r.alternative.startUtc, "2026-11-05T09:00:00.000Z");
});

test("amber: block ends after a deadline that was edited earlier", () => {
  const r = evalWith([ownEvent()], { deadlineWall: "2026-11-05T14:30", deadlineTz: "UTC" });
  assert.equal(r.state, "amber");
  assert.equal(r.reason, "after_deadline");
  assert.equal(r.alternative.startUtc, "2026-11-05T09:00:00.000Z");
});

test("amber: block now sits outside edited working hours", () => {
  const late = { ...block, start_utc: "2026-11-05T20:30:00.000Z", end_utc: "2026-11-05T21:30:00.000Z" };
  const r = evalWith([ev("stablock1", late.start_utc, late.end_utc, tagged("key1"))], { block: late });
  assert.equal(r.state, "amber");
  assert.equal(r.reason, "outside_working_hours");
  assert.equal(r.alternative.startUtc, "2026-11-06T09:00:00.000Z");
});

test("amber: our calendar event was deleted", () => {
  const r = evalWith([]);
  assert.equal(r.state, "amber");
  assert.equal(r.reason, "block_event_missing");
  assert.equal(r.ownEventFound, false);
  assert.match(r.explanation[0], /not found/);
});

test("amber: another active SavedToAction block overlaps ours", () => {
  const r = evalWith([ownEvent(), ev("stablock2", "2026-11-05T14:30:00Z", "2026-11-05T15:30:00Z", tagged("key2"))]);
  assert.equal(r.state, "amber");
  assert.equal(r.reason, "other_block_overlap");
  assert.match(r.explanation[0], /Another SavedToAction block/);
});

test("a superseded leftover event does not turn a green block amber", () => {
  const r = evalWith([ownEvent(), ev("old", "2026-11-05T14:30:00Z", "2026-11-05T15:30:00Z", tagged("oldkey"))], {
    supersededKeys: new Set(["oldkey"]),
  });
  assert.equal(r.state, "green");
});

test("red: no slot under working hours, effort and deadline, and what would change it", () => {
  const tight = { ...block, start_utc: "2026-11-05T14:00:00.000Z", end_utc: "2026-11-05T16:00:00.000Z" };
  const r = evalWith(
    [
      ev("stablock1", tight.start_utc, tight.end_utc, tagged("key1")),
      ev("morning", "2026-11-05T09:00:00Z", "2026-11-05T14:00:00Z"),
      ev("conflict", "2026-11-05T15:00:00Z", "2026-11-05T16:00:00Z"),
    ],
    { block: tight, durationMin: 120, deadlineWall: "2026-11-05T16:00", deadlineTz: "UTC" },
  );
  assert.equal(r.state, "red");
  assert.equal(r.reason, "no_slot_before_deadline");
  assert.equal(r.alternative, null);
  assert.equal(r.hints.fitsIfEffortAtMost, 60);
  assert.equal(r.hints.fitsIfWorkingHoursExtended, null);
  assert.match(r.explanation.join(" "), /No 120 minute slot fits under your working hours \(09:00 to 21:00\)/);
  assert.match(r.explanation.join(" "), /effort were 60 minutes or less/);
});

test("red: it would fit outside working hours, and says so as a lever", () => {
  const r = evalWith([ownEvent(), ev("allday", "2026-11-05T09:00:00Z", "2026-11-05T16:00:00Z")], {
    deadlineWall: "2026-11-05T16:00",
    deadlineTz: "UTC",
  });
  assert.equal(r.state, "red");
  assert.equal(r.hints.fitsIfWorkingHoursExtended.startUtc, "2026-11-05T08:00:00.000Z");
  assert.match(r.explanation.join(" "), /outside your working hours at .*08:00/);
});

test("red: deadline passed", () => {
  const r = evalWith([ownEvent()], { now: t("2026-11-07T09:00:00Z") });
  assert.equal(r.state, "red");
  assert.equal(r.reason, "deadline_passed");
});

test("needs_input instead of a color when something required is missing", () => {
  assert.equal(evalWith([ownEvent()], { tz: null }).reason, "missing_timezone");
  assert.equal(evalWith([ownEvent()], { tz: "Nope/Nowhere" }).reason, "invalid_timezone");
  assert.equal(evalWith([ownEvent()], { durationMin: null }).reason, "missing_effort");
  assert.equal(evalWith([ownEvent()], { deadlineTz: null }).reason, "deadline_missing_timezone");
  assert.equal(evalWith([ownEvent()], { deadlineWall: "2026-11-06" }).reason, "invalid_deadline");
  for (const r of [evalWith([], { tz: null }), evalWith([], { durationMin: null })]) {
    assert.equal(r.state, "needs_input");
    assert.equal(r.alternative, null);
  }
});

test("Casablanca end to end: wall deadline, +01:00 event offsets, working hours all use moment data", () => {
  const r = evaluateBlock({
    ...base,
    tz: "Africa/Casablanca",
    deadlineWall: "2026-11-05T18:00",
    deadlineTz: "Africa/Casablanca",
    // 15:30+01:00 is 14:30Z. The meeting overlaps the 14:00Z to 15:00Z block.
    events: [ownEvent(), ev("m1", "2026-11-05T15:30:00+01:00", "2026-11-05T16:30:00+01:00")],
  });
  assert.equal(r.state, "amber");
  assert.equal(r.deadline.utc, "2026-11-05T18:00:00.000Z");
  assert.equal(r.alternative.startUtc, "2026-11-05T15:30:00.000Z");
  assert.equal(r.latestFeasibleStart.startUtc, "2026-11-05T17:00:00.000Z");
  assert.match(r.explanation.at(-1), /\(\+00:00\)/);
});

test("same inputs give the same answer (button and watcher share one function) and inputs are not mutated", () => {
  const events = [ownEvent(), ev("m1", "2026-11-05T14:30:00Z", "2026-11-05T15:30:00Z")];
  const before = JSON.stringify(events);
  assert.deepEqual(evalWith(events), evalWith(events));
  assert.equal(JSON.stringify(events), before);
});

test("proposeSlot: first slot for an action with no block yet", () => {
  const ok = proposeSlot({ now: NOW, durationMin: 90, busy: [], tz: "UTC", workStart: "09:00", workEnd: "21:00", deadlineWall: "2026-11-06T18:00", deadlineTz: "UTC" });
  assert.equal(ok.ok, true);
  assert.equal(ok.slot.startUtc, "2026-11-05T09:00:00.000Z");
});

test("proposeSlot: red carries an explanation, missing deadline tz is reported", () => {
  const red = proposeSlot({
    now: NOW,
    durationMin: 120,
    busy: [{ start: t("2026-11-05T09:00:00Z"), end: t("2026-11-05T11:00:00Z") }],
    tz: "UTC",
    workStart: "09:00",
    workEnd: "21:00",
    deadlineWall: "2026-11-05T12:00",
    deadlineTz: "UTC",
  });
  assert.equal(red.ok, false);
  assert.equal(red.hints.fitsIfEffortAtMost, 60);
  assert.ok(red.explanation.length >= 2);
  const missing = proposeSlot({ now: NOW, durationMin: 60, busy: [], tz: "UTC", workStart: "09:00", workEnd: "21:00", deadlineWall: "2026-11-05T12:00" });
  assert.equal(missing.reason, "deadline_missing_timezone");
});
