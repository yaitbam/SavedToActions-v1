import test from "node:test";
import assert from "node:assert/strict";
import { openDb, saveSettings } from "../src/db.js";
import { createPlanningService } from "../src/services/planning.js";
import { CalendarError } from "../src/google/calendar.js";
import { getActiveBlock } from "../src/blockStore.js";
import { TAG_APP } from "../src/scheduler/index.js";
import { createFakeCalendar } from "./fakeCalendar.js";

async function withPlanned(run) {
  const db = openDb(":memory:");
  const now = "2026-11-04T08:00:00.000Z";
  saveSettings(db, { tz: "Africa/Casablanca", workStart: "09:00", workEnd: "21:00", ignoreAllDay: true });
  const saveId = db.prepare("INSERT INTO saves(note,imported_at) VALUES ('test',?)").run(now).lastInsertRowid;
  const id = Number(db.prepare("INSERT INTO actions(save_id,kind,title,confirmed_effort_min,status,created_at,updated_at) VALUES (?,'try','Check registration',30,'open',?,?)").run(saveId, now, now).lastInsertRowid);
  const calendar = createFakeCalendar();
  const planning = createPlanningService({ db, calendar, clock: () => Date.parse(now) });
  try {
    const result = await planning.approve({ actionId: id, approved: true, slot: { startUtc: "2026-11-04T10:00:00Z", endUtc: "2026-11-04T10:30:00Z" } });
    assert.equal(result.ok, true);
    calendar.calls.length = 0;
    await run({ db, id, calendar, planning, block: result.block, event: calendar.raw(result.block.googleEventId) });
  } finally { db.close(); }
}

test("completion requires approval, preserves event details and reads the title back", () => withPlanned(async ({ db, id, calendar, planning, block, event }) => {
  event.summary = "My calendar title";
  const original = structuredClone(event);
  assert.equal((await planning.markDone({ actionId: id })).error, "approval_required");
  assert.deepEqual(calendar.calls, []);
  const done = await planning.markDone({ actionId: id, approved: true });
  assert.equal(done.action.status, "done");
  assert.equal(done.action.block.readback.status, "ok");
  assert.equal(event.summary, "Done · My calendar title");
  assert.equal(event.startMs, original.startMs);
  assert.equal(event.endMs, original.endMs);
  assert.equal(event.description, original.description);
  assert.equal(event.tz, original.tz);
  assert.equal(event.extendedProperties.private.stDone, "1");
  assert.equal(getActiveBlock(db, id).id, block.id);
  assert.deepEqual(calendar.calls, ["getEvent", "patchEvent", "getEvent"]);
  assert.equal((await planning.markDone({ actionId: id, approved: true })).error, "action_closed");
}));

test("undo restores exactly one prefix, needs approval and preserves an originally prefixed title", () => withPlanned(async ({ id, calendar, planning, event }) => {
  event.summary = "Done · An earlier title";
  await planning.markDone({ actionId: id, approved: true });
  assert.equal(event.summary, "Done · Done · An earlier title");
  assert.equal((await planning.undo({ actionId: id })).error, "approval_required");
  const result = await planning.undo({ actionId: id, approved: true });
  assert.equal(result.action.status, "planned");
  assert.equal(result.calendarUnchanged, false);
  assert.equal(event.summary, "Done · An earlier title");
  assert.equal(event.extendedProperties.private.stDone, undefined);
  assert.equal(calendar.calls.filter(call => call === "patchEvent").length, 2);
}));

test("undo preserves a title manually replaced after completion", () => withPlanned(async ({ id, planning, event }) => {
  await planning.markDone({ actionId: id, approved: true });
  event.summary = "A new manual title";
  assert.equal((await planning.undo({ actionId: id, approved: true })).action.status, "planned");
  assert.equal(event.summary, "A new manual title");
}));

test("completion failures leave the task planned and never touch a missing or foreign event", async () => {
  for (const kind of ["missing", "foreign", "patch"]) await withPlanned(async ({ db, id, calendar, planning, block, event }) => {
    if (kind === "missing") calendar.cancel(block.googleEventId);
    if (kind === "foreign") event.extendedProperties.private[TAG_APP] = "another-app";
    if (kind === "patch") calendar.failNext("patchEvent", new CalendarError("google_unavailable", "Try again"));
    const result = await planning.markDone({ actionId: id, approved: true });
    assert.equal(result.ok, false);
    assert.equal(db.prepare("SELECT status FROM actions WHERE id=?").get(id).status, "planned");
    assert.equal(event.summary, "Check registration");
    if (kind !== "patch") assert.ok(!calendar.calls.includes("patchEvent"));
  });
});

test("failed readback retries without duplicating the completion prefix", () => withPlanned(async ({ db, id, calendar, planning, block, event }) => {
  const patch = calendar.patchEvent.bind(calendar);
  calendar.patchEvent = async (...args) => {
    const result = await patch(...args);
    calendar.failNext("getEvent", new CalendarError("google_unavailable", "Read failed"));
    return result;
  };
  assert.equal((await planning.markDone({ actionId: id, approved: true })).ok, false);
  assert.equal(getActiveBlock(db, id).readback_status, "failed");
  assert.equal(event.summary, "Done · Check registration");
  assert.equal((await planning.markDone({ actionId: id, approved: true })).action.status, "done");
  assert.equal(calendar.calls.filter(call => call === "patchEvent").length, 1);
  assert.equal(getActiveBlock(db, id).id, block.id);
}));

test("readback detects an unchanged title and records drift instead of marking the task done", () => withPlanned(async ({ db, id, calendar, planning, event }) => {
  const patch = calendar.patchEvent.bind(calendar);
  calendar.patchEvent = async (...args) => { await patch(...args); event.summary = "Check registration"; };
  assert.equal((await planning.markDone({ actionId: id, approved: true })).error, "calendar_completion_unverified");
  assert.equal(getActiveBlock(db, id).readback_status, "drift");
  assert.equal(db.prepare("SELECT status FROM actions WHERE id=?").get(id).status, "planned");
}));

test("completion refuses a concurrent calendar edit using the fetched event version", () => withPlanned(async ({ id, calendar, planning, event }) => {
  const patch = calendar.patchEvent.bind(calendar);
  calendar.patchEvent = async (...args) => { event.revision = 1; return patch(...args); };
  assert.equal((await planning.markDone({ actionId: id, approved: true })).error, "calendar_event_changed");
  assert.equal(event.summary, "Check registration");
}));
