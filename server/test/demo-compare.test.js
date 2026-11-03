import test from "node:test";
import assert from "node:assert/strict";
import { compareToManifest, parseExpectedDeadline } from "../../scripts/lib/demo-compare.mjs";

const goals = [
  { id: 1, name: "Earn more" },
  { id: 2, name: "Learn a skill" },
  { id: 3, name: "Don't miss deadlines" },
];
const deadline = (wall, tz = "UTC") => ({ wall, tz, utc: `${wall}:00.000Z` });

test("parseExpectedDeadline: date, time and UTC mark, null stays null", () => {
  assert.deepEqual(parseExpectedDeadline("2026-11-20 23:59 GMT"), { date: "2026-11-20", time: "23:59", utcStated: true });
  assert.deepEqual(parseExpectedDeadline("2026-12-01 23:59 UTC"), { date: "2026-12-01", time: "23:59", utcStated: true });
  assert.deepEqual(parseExpectedDeadline("2026-11-24 (RSVP)"), { date: "2026-11-24", time: null, utcStated: false });
  assert.equal(parseExpectedDeadline(null), null);
  assert.deepEqual(parseExpectedDeadline("soon"), { unreadable: "soon" });
});

test("compare: matching goal and deadline is ok", () => {
  const entry = { file: "01.png", expected_goal: "Don't miss deadlines", deadline_in_image: "2026-11-20 23:59 GMT" };
  const r = compareToManifest(entry, { goalId: 3, deadline: deadline("2026-11-20T23:59"), warnings: [] }, goals);
  assert.equal(r.ok, true);
  assert.equal(r.deadline.got, "2026-11-20 23:59 UTC");
});

test("compare: wrong goal, Missing deadline and wrong timezone are mismatches", () => {
  const entry = { expected_goal: "Earn more", deadline_in_image: "2026-11-20 23:59 GMT" };
  const wrongGoal = compareToManifest(entry, { goalId: 2, deadline: deadline("2026-11-20T23:59"), warnings: [] }, goals);
  assert.equal(wrongGoal.goal.ok, false);
  assert.equal(wrongGoal.deadline.ok, true);
  const missing = compareToManifest(entry, { goalId: 1, deadline: null, warnings: [] }, goals);
  assert.equal(missing.deadline.note, "deadline Missing");
  const shifted = { wall: "2026-11-20T23:59", tz: "Africa/Casablanca", utc: "2026-11-21T00:59:00.000Z" };
  const tz = compareToManifest(entry, { goalId: 1, deadline: shifted, warnings: [] }, goals);
  assert.equal(tz.deadline.ok, false);
  assert.match(tz.deadline.note, /wrong timezone/);
});

test("compare: a date without a time stays Missing by design, an invented time is a mismatch", () => {
  const entry = { expected_goal: "Earn more", deadline_in_image: "2026-11-30" };
  const warned = { goalId: 1, deadline: null, warnings: [{ code: "deadline_time_missing", proposed: { date: "2026-11-30" } }] };
  assert.equal(compareToManifest(entry, warned, goals).ok, true);
  assert.equal(compareToManifest(entry, { goalId: 1, deadline: null, warnings: [] }, goals).deadline.note, "date not read");
  const invented = compareToManifest(entry, { goalId: 1, deadline: deadline("2026-11-30T23:59"), warnings: [] }, goals);
  assert.equal(invented.deadline.note, "time invented");
});

test("compare: no deadline in the image means none may be invented, no goal means Missing", () => {
  const entry = { expected_goal: null, deadline_in_image: null };
  assert.equal(compareToManifest(entry, { goalId: null, deadline: null, warnings: [] }, goals).ok, true);
  const invented = compareToManifest(entry, { goalId: 2, deadline: deadline("2026-11-20T10:00"), warnings: [] }, goals);
  assert.equal(invented.goal.ok, false);
  assert.equal(invented.deadline.note, "deadline not in the image");
});
