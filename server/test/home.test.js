import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { insertCheck } from "../src/blockStore.js";
import { getGoogleEmail, openDb, saveSettings } from "../src/db.js";
import { CalendarError } from "../src/google/calendar.js";
import { runSelfTest } from "../src/tz.js";
import { createFakeCalendar } from "./fakeCalendar.js";

// Monday 2 Nov 2026, 12:00 UTC.
const NOW = Date.parse("2026-11-02T12:00:00Z");
const iso = (s) => new Date(Date.parse(s)).toISOString();
const NOW_ISO = new Date(NOW).toISOString();

let counter = 0;
const addSave = (db, { note = "note", importedAt = NOW_ISO, isDemo = 0 } = {}) =>
  Number(db.prepare("INSERT INTO saves (note, imported_at, is_demo) VALUES (?, ?, ?)").run(note, importedAt, isDemo).lastInsertRowid);

function addAction(db, o = {}) {
  const saveId = o.saveId ?? addSave(db, { importedAt: o.importedAt, isDemo: o.isDemo });
  const deadlineWall = "deadline" in o ? o.deadline && o.deadline.replace(/:\d\d\.\d{3}Z$/, "").replace(/Z$/, "") : null;
  const id = Number(
    db
      .prepare(
        `INSERT INTO actions (save_id, goal_id, kind, title, deadline_wall, deadline_tz, deadline_utc, deliverables_json,
           suggested_effort_min, confirmed_effort_min, status, created_at, updated_at)
         VALUES (?, ?, 'opportunity', ?, ?, ?, ?, '[]', 15, ?, ?, ?, ?)`,
      )
      .run(
        saveId,
        "goalId" in o ? o.goalId : 1,
        o.title ?? `Action ${++counter}`,
        o.deadlineWall ?? deadlineWall,
        o.deadlineWall || o.deadline ? "UTC" : null,
        o.deadline ? iso(o.deadline) : null,
        "effort" in o ? o.effort : 30,
        o.status ?? "open",
        NOW_ISO,
        NOW_ISO,
      ).lastInsertRowid,
  );
  return { id, saveId };
}

function addBlock(db, actionId, { start, end, superseded = null, cancelled = null, readback = "ok", drift = [] }) {
  return Number(
    db
      .prepare(
        `INSERT INTO blocks (action_id, google_event_id, idempotency_key, start_utc, end_utc, tz, superseded_by, cancelled_at,
           readback_status, readback_at, readback_json, created_at) VALUES (?, ?, ?, ?, ?, 'UTC', ?, ?, ?, ?, ?, ?)`,
      )
      .run(actionId, `sta${++counter}`, `key${counter}`, iso(start), iso(end), superseded, cancelled, readback, NOW_ISO, JSON.stringify({ drift, error: null }), NOW_ISO).lastInsertRowid,
  );
}

const addCheck = (db, actionId, blockId, state, reason = state, explanation = []) =>
  insertCheck(db, {
    actionId,
    blockId,
    checkedAt: NOW_ISO,
    source: "manual",
    payload: { state, reason, tz: "UTC", explanation, conflicts: [], problems: [], alternative: null, hints: null, latestFeasibleStart: null, ownEventFound: true, deadline: null },
  });

async function withApp(fn, { connected = false } = {}) {
  const db = openDb(":memory:");
  saveSettings(db, { workStart: "09:00", workEnd: "21:00", tz: "UTC", ignoreAllDay: false });
  const cal = createFakeCalendar();
  const app = createApp({
    db,
    config: { frontendOrigin: "http://localhost:5173", screenshotDir: "unused", maxUploadBytes: 1024 },
    googleAuth: { status: () => ({ connected, missingScopes: [] }) },
    selfTest: runSelfTest(),
    provider: null,
    calendar: cal,
    clock: () => NOW,
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (p) => {
    const res = await fetch(base + p);
    return { status: res.status, json: await res.json() };
  };
  try {
    return await fn({ db, cal, get });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("goal metrics on an empty database: zeros, a null action rate, and the old shape is kept", async () => {
  await withApp(async ({ get }) => {
    const { status, json } = await get("/api/goals");
    assert.equal(status, 200);
    assert.deepEqual(json.map(({ id, name }) => ({ id, name })), [
      { id: 1, name: "Make money" },
      { id: 2, name: "Level up as a dev" },
      { id: 3, name: "Join events and opportunities" },
    ]);
    for (const g of json) {
      assert.deepEqual(g.metrics, {
        importedSaves: 0,
        demoSaves: 0,
        planned: 0,
        markedDone: 0,
        savesWithDoneAction: 0,
        deadlinePassedWithoutCompletion: 0,
        actionRate: null,
        timeScheduledMin: 0,
      });
    }
  });
});

test("goal metrics follow the exact definitions", async () => {
  await withApp(async ({ db, get }) => {
    // Save A (imported demo history): two done actions, one with a 30 minute active block.
    const a1 = addAction(db, { status: "done", isDemo: 1 });
    const a2 = addAction(db, { saveId: a1.saveId, status: "done" });
    addBlock(db, a1.id, { start: "2026-10-30T10:00:00Z", end: "2026-10-30T10:30:00Z" });
    assert.ok(a2.id);
    // Save B: planned, moved once. The old 30 minute block is superseded, the new 60 minute block is active.
    const b = addAction(db, { status: "planned" });
    const bNew = addBlock(db, b.id, { start: "2026-11-03T09:00:00Z", end: "2026-11-03T10:00:00Z" });
    addBlock(db, b.id, { start: "2026-11-03T08:00:00Z", end: "2026-11-03T08:30:00Z", superseded: bNew });
    // Save C: open, deadline already passed -> counts as missed.
    addAction(db, { status: "open", deadline: "2026-11-01T10:00:00Z" });
    // Save D: skipped, deadline passed, its block was cancelled -> not missed, not scheduled.
    const d = addAction(db, { status: "skipped", deadline: "2026-11-01T10:00:00Z" });
    addBlock(db, d.id, { start: "2026-10-31T10:00:00Z", end: "2026-10-31T10:45:00Z", cancelled: NOW_ISO });
    // Save E: open, deadline exactly now -> passed (at or before now).
    addAction(db, { status: "open", deadline: NOW_ISO });
    // Save F: deadline given but never resolved to a UTC instant (timezone missing) -> not counted as missed.
    addAction(db, { status: "open", deadlineWall: "2026-10-01T10:00" });
    // Save G: extraction failed, no action, no goal -> not counted anywhere.
    addSave(db);
    // Save H: an action with no goal -> not counted in any goal.
    addAction(db, { goalId: null, status: "done" });
    // Goal 2: one open action.
    addAction(db, { goalId: 2 });

    const goals = (await get("/api/goals")).json;
    assert.deepEqual(goals[0].metrics, {
      importedSaves: 6, // A, B, C, D, E, F (distinct saves, A counted once although it has two actions)
      demoSaves: 1,
      planned: 1,
      markedDone: 2,
      savesWithDoneAction: 1,
      deadlinePassedWithoutCompletion: 2, // C and E. Not D (skipped), not A (done), not F (unresolved)
      actionRate: 1 / 6, // distinct saves with a done action / distinct imported saves
      timeScheduledMin: 90, // 30 (done action, still on the calendar) + 60 (active). Superseded 30 and cancelled 45 excluded
    });
    assert.equal(goals[1].metrics.importedSaves, 1);
    assert.equal(goals[1].metrics.actionRate, 0, "a goal with saves and no completions has rate 0, not null");
    assert.equal(goals[2].metrics.actionRate, null);
    assert.equal(goals[2].metrics.importedSaves, 0);
  });
});

test("home on an empty database: nothing is invented, the clock is server formatted", async () => {
  await withApp(async ({ get, cal }) => {
    const { status, json } = await get("/api/home");
    assert.equal(status, 200);
    assert.deepEqual(json.now, { utc: NOW_ISO, tz: "UTC", display: "Mon 2 Nov 2026, 12:00 (+00:00)" });
    assert.deepEqual([json.next_up, json.upcoming, json.needs_attention, json.recent_saves], [null, [], [], []]);
    assert.deepEqual([json.inbox_count, json.alerts_count], [0, 0]);
    assert.deepEqual([json.google_connected, json.connected_email], [false, null]);
    assert.match(json.metric_definitions.actionRate, /divided by distinct imported saves/);
    assert.deepEqual(cal.calls, [], "no Google call when not connected");
  });
});

test("home: the connected email is looked up once, cached, never guessed, and a failure is not cached", async () => {
  await withApp(
    async ({ get, cal, db }) => {
      cal.failNext("accountEmail", new CalendarError("google_unavailable", "down"));
      let r = (await get("/api/home")).json;
      assert.deepEqual([r.google_connected, r.connected_email], [true, null]);
      assert.equal(getGoogleEmail(db), null);

      r = (await get("/api/home")).json;
      assert.equal(r.connected_email, "owner@example.test");
      assert.equal(getGoogleEmail(db), "owner@example.test");
      const lookups = () => cal.calls.filter((c) => c === "accountEmail").length;
      const before = lookups();
      await get("/api/home");
      assert.equal(lookups(), before, "the second read uses the cache");
    },
    { connected: true },
  );
  await withApp(
    async ({ get, cal }) => {
      cal.accountEmailValue = null; // the calendar gave no usable email
      assert.equal((await get("/api/home")).json.connected_email, null);
    },
    { connected: true },
  );
});

test("home: populated", async () => {
  await withApp(async ({ db, get }) => {
    // P1: planned, its block is already over. Never next up.
    const p1 = addAction(db, { status: "planned", title: "P1 past block" });
    addCheck(db, p1.id, addBlock(db, p1.id, { start: "2026-11-02T10:00:00Z", end: "2026-11-02T10:30:00Z" }), "green");
    // P2: planned Nov 3, latest check green. An older check of a superseded block said red and must be ignored.
    const p2 = addAction(db, { status: "planned", title: "P2", deadline: "2026-11-06T18:00:00Z" });
    const p2New = addBlock(db, p2.id, { start: "2026-11-03T09:00:00Z", end: "2026-11-03T09:30:00Z" });
    const p2Old = addBlock(db, p2.id, { start: "2026-11-03T08:00:00Z", end: "2026-11-03T08:30:00Z", superseded: p2New });
    addCheck(db, p2.id, p2Old, "red");
    addCheck(db, p2.id, p2New, "green");
    // P3: planned today at 13:00, the earliest block not over yet, latest check amber.
    const p3 = addAction(db, { status: "planned", title: "P3", deadline: "2026-11-04T18:00:00Z" });
    addCheck(db, p3.id, addBlock(db, p3.id, { start: "2026-11-02T13:00:00Z", end: "2026-11-02T13:30:00Z" }), "amber", "calendar_conflict", ['"Sync" overlaps your block.']);
    // P4: planned, latest check red.
    const p4 = addAction(db, { status: "planned", title: "P4", deadline: "2026-11-05T18:00:00Z" });
    addCheck(db, p4.id, addBlock(db, p4.id, { start: "2026-11-04T09:00:00Z", end: "2026-11-04T09:30:00Z" }), "red", "no_slot_before_deadline");
    // P5: planned, check green but the read-back drifted.
    const p5 = addAction(db, { status: "planned", title: "P5" });
    const b5 = addBlock(db, p5.id, { start: "2026-11-05T09:00:00Z", end: "2026-11-05T09:30:00Z", readback: "drift", drift: [{ field: "start_offset", expected: "+00:00", actual: "+01:00" }] });
    addCheck(db, p5.id, b5, "green");
    // O1: open, deadline passed. O2 and O3: open, effort not confirmed. O4: open, effort confirmed.
    const o1 = addAction(db, { title: "O1", deadline: "2026-11-01T10:00:00Z" });
    const o2 = addAction(db, { title: "O2", deadline: "2026-11-10T10:00:00Z", effort: null });
    addAction(db, { title: "O3", effort: null });
    addAction(db, { title: "O4", effort: 30 });
    // Closed ones never show up as upcoming or attention.
    addAction(db, { status: "done", deadline: "2026-11-09T10:00:00Z" });
    addAction(db, { status: "skipped", deadline: "2026-11-01T09:00:00Z" });
    // A save whose extraction failed. Same timestamp as the rest, but the highest id, so it is the newest.
    const failedSave = addSave(db, { note: "failed one" });

    const { json } = await get("/api/home");

    assert.equal(json.next_up.id, p3.id);
    assert.equal(json.next_up.block.startDisplay, "Mon 2 Nov 2026, 13:00 (+00:00)");
    assert.equal(json.next_up.check.state, "amber");
    assert.equal("transcription" in json.next_up, false, "list items are compact");

    assert.deepEqual(json.upcoming.map((a) => [a.id, a.state]), [[p3.id, "amber"], [p4.id, "red"], [p2.id, "green"], [o2.id, null]]);
    assert.equal(json.upcoming[0].deadline.display, "Wed 4 Nov 2026, 18:00 (+00:00)");

    assert.deepEqual(json.needs_attention.map((i) => [i.action.id, i.state, i.reason]), [
      [o1.id, "red", "deadline_passed"],
      [p4.id, "red", "no_slot_before_deadline"],
      [p3.id, "amber", "calendar_conflict"],
      [p5.id, "readback_drift", "readback_drift"],
    ]);
    assert.match(json.needs_attention[0].text, /deadline .*has passed and this is not marked done/);
    assert.equal(json.needs_attention[2].text, '"Sync" overlaps your block.');
    assert.match(json.needs_attention[3].text, /start_offset/);
    assert.equal(json.alerts_count, 2, "only Recheck alerts: P3 amber and P4 red");

    assert.deepEqual(json.inbox, { needs_effort: 2, failed_extractions: 1 });
    assert.equal(json.inbox_count, 3);

    assert.equal(json.recent_saves.length, 10);
    assert.deepEqual([json.recent_saves[0].saveId, json.recent_saves[0].extraction, json.recent_saves[0].action], [failedSave, "failed", null]);
    assert.equal(json.recent_saves[0].importedAtDisplay, "Mon 2 Nov 2026, 12:00 (+00:00)");
    assert.equal(json.recent_saves[1].extraction, "done");
    assert.ok(json.recent_saves[1].action.id);
    assert.match(json.recent_saves[0].screenshotUrl, /^\/api\/saves\/\d+\/screenshot$/);
  });
});
