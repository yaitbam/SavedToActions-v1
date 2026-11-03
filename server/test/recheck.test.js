import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { openDb, saveSettings } from "../src/db.js";
import { CalendarError } from "../src/google/calendar.js";
import { createRecheckService } from "../src/services/recheck.js";
import { runSelfTest } from "../src/tz.js";
import { createWatcher } from "../src/watcher.js";
import { createFakeCalendar } from "./fakeCalendar.js";

// Monday 2 Nov 2026, 12:00 UTC. Working hours 09:00 to 21:00. The clock can be moved with state.now.
const NOW = Date.parse("2026-11-02T12:00:00Z");
const MIN = 60_000;
const at = (hhmm, day = "2026-11-02") => `${day}T${hhmm}:00.000Z`;
const slot = (hhmm, minutes = 60, day) => {
  const startUtc = at(hhmm, day);
  return { startUtc, endUtc: new Date(Date.parse(startUtc) + minutes * MIN).toISOString() };
};
const silent = { log() {}, warn() {}, error() {} };

function seedAction(db, o = {}) {
  const nowIso = new Date(NOW).toISOString();
  const saveId = Number(db.prepare("INSERT INTO saves (note, imported_at) VALUES ('n', ?)").run(nowIso).lastInsertRowid);
  return Number(
    db
      .prepare(
        `INSERT INTO actions (save_id, goal_id, kind, title, deadline_wall, deadline_tz, deliverables_json,
           suggested_effort_min, confirmed_effort_min, status, created_at, updated_at)
         VALUES (?, 3, 'opportunity', ?, ?, 'UTC', '[]', 15, ?, 'open', ?, ?)`,
      )
      .run(saveId, o.title ?? "Check registration", o.deadlineWall ?? "2026-11-06T18:00", "effort" in o ? o.effort : 60, nowIso, nowIso).lastInsertRowid,
  );
}

async function withApp(fn, { canRun = () => true, ignoreAllDay = false } = {}) {
  const db = openDb(":memory:");
  saveSettings(db, { workStart: "09:00", workEnd: "21:00", tz: "UTC", ignoreAllDay });
  const cal = createFakeCalendar();
  const state = { now: NOW };
  const clock = () => state.now;
  const recheck = createRecheckService({ db, calendar: cal, clock, canRun, logger: silent });
  const app = createApp({
    db,
    config: { frontendOrigin: "http://localhost:5173", screenshotDir: "unused", maxUploadBytes: 1024 },
    googleAuth: { status: () => ({}) },
    selfTest: runSelfTest(),
    provider: null,
    calendar: cal,
    clock,
    recheck,
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, json: await res.json() };
  };
  const api = {
    get: (p) => request("GET", p),
    post: (p, b) => request("POST", p, b),
    patch: (p, b) => request("PATCH", p, b),
    approve: (id, s) => request("POST", `/api/actions/${id}/approve`, { ...s, approved: true }),
    move: (id, s) => request("POST", `/api/actions/${id}/move`, { ...s, approved: true }),
    recheck: (id) => request("POST", `/api/actions/${id}/recheck`),
  };
  try {
    return await fn({ db, cal, api, state, recheck, seed: (o) => seedAction(db, o) });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const planned = async (ctx, hhmm = "13:00", o = {}) => {
  const id = ctx.seed(o);
  const r = await ctx.api.approve(id, slot(hhmm));
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return { id, block: r.json.block };
};

test("green: the block fits, the check is stored, shown on the action, and nothing is written", async () => {
  await withApp(async (ctx) => {
    const { api, cal } = ctx;
    const { id } = await planned(ctx);
    const writesBefore = cal.calls.filter((c) => c === "insertEvent" || c === "deleteEvent").length;
    const r = await api.recheck(id);
    assert.equal(r.status, 200);
    const c = r.json.check;
    assert.deepEqual([c.state, c.reason, c.source], ["green", "block_fits", "manual"]);
    assert.equal(c.checkedAtDisplay, "Mon 2 Nov 2026, 12:00 (+00:00)");
    assert.equal(c.latestFeasibleStart.startUtc, at("17:00", "2026-11-06"));
    assert.equal(c.latestFeasibleStart.label, "latest feasible start, given your current availability and confirmed effort");
    assert.equal(c.latestFeasibleStart.startDisplay, "Fri 6 Nov 2026, 17:00 (+00:00)");
    assert.equal(r.json.action.check.id, c.id);
    assert.equal(cal.calls.filter((x) => x === "insertEvent" || x === "deleteEvent").length, writesBefore);
  });
});

test("amber: a new meeting overlaps, the alternative is explained, and the approved move turns it green", async () => {
  await withApp(async (ctx) => {
    const { api, cal } = ctx;
    const { id } = await planned(ctx);
    cal.addEvent({ id: "sync", summary: "Team sync", start: at("13:30"), end: at("14:30") });
    const r = await api.recheck(id);
    const c = r.json.check;
    assert.deepEqual([c.state, c.reason], ["amber", "calendar_conflict"]);
    assert.equal(c.conflicts[0].summary, "Team sync");
    assert.equal(c.conflicts[0].startDisplay, "Mon 2 Nov 2026, 13:30 (+00:00)");
    assert.deepEqual(c.problems, ["calendar_conflict"]);
    assert.equal(c.alternative.startUtc, at("14:30"));
    assert.equal(c.alternative.startDisplay, "Mon 2 Nov 2026, 14:30 (+00:00)");
    assert.match(c.explanation[0], /"Team sync" overlaps your block/);
    assert.match(c.explanation.at(-1), /Next valid slot: .*14:30.*15:30.*working hours \(09:00 to 21:00\).*before your deadline/);

    // Recheck never moves anything. The user approves the move with the alternative it offered.
    assert.equal((await api.get(`/api/actions/${id}`)).json.block.startUtc, at("13:00"));
    const moved = await api.move(id, c.alternative);
    assert.equal(moved.status, 201);
    assert.equal(moved.json.action.check, null, "a check of the old block is stale after a move");
    assert.equal((await api.recheck(id)).json.check.state, "green");
  });
});

test("amber: a meeting inside the block, a deleted event, a changed effort, and a block whose time has passed", async () => {
  await withApp(async (ctx) => {
    const { api, cal, state } = ctx;
    const a = await planned(ctx, "13:00");
    cal.addEvent({ id: "inside", summary: "Quick call", start: at("13:10"), end: at("13:40") });
    assert.deepEqual([(await api.recheck(a.id)).json.check.state, (await api.recheck(a.id)).json.check.reason], ["amber", "calendar_conflict"]);

    const b = await planned(ctx, "15:00");
    cal.cancel(b.block.googleEventId);
    const gone = (await api.recheck(b.id)).json.check;
    assert.deepEqual([gone.state, gone.reason, gone.ownEventFound], ["amber", "block_event_missing", false]);

    const c = await planned(ctx, "17:00");
    assert.equal((await api.patch(`/api/actions/${c.id}`, { confirmedEffortMin: 90 })).status, 200);
    const changed = (await api.recheck(c.id)).json.check;
    assert.deepEqual([changed.state, changed.reason], ["amber", "effort_changed"]);
    assert.equal(changed.alternative.durationMin, 90);
    assert.match(changed.explanation[0], /The block is 60 minutes but your confirmed effort is now 90 minutes/);

    const d = await planned(ctx, "19:00");
    state.now = Date.parse("2026-11-02T20:30:00Z");
    const past = (await api.recheck(d.id)).json.check;
    assert.equal(past.state, "amber");
    assert.ok(past.problems.includes("block_in_past"));
    assert.match(past.explanation[0], /already passed and this is not marked done/);
  });
});

test("red: nothing fits before the deadline, and it says what would change that", async () => {
  await withApp(async (ctx) => {
    const { api, cal } = ctx;
    const { id } = await planned(ctx, "13:00", { deadlineWall: "2026-11-02T14:30" });
    cal.addEvent({ id: "all", summary: "Workshop", start: at("12:00"), end: at("14:30") });
    const c = (await api.recheck(id)).json.check;
    assert.deepEqual([c.state, c.reason, c.alternative], ["red", "no_slot_before_deadline", null]);
    assert.match(c.explanation.join(" "), /No 60 minute slot fits under your working hours \(09:00 to 21:00\)/);
    assert.ok(c.hints);
  });
});

test("red: deadline passed, and the calendar is not even read", async () => {
  await withApp(async (ctx) => {
    const { api, cal, state } = ctx;
    const { id } = await planned(ctx);
    state.now = Date.parse("2026-11-07T09:00:00Z");
    const reads = cal.calls.filter((c) => c === "listEvents").length;
    const c = (await api.recheck(id)).json.check;
    assert.deepEqual([c.state, c.reason], ["red", "deadline_passed"]);
    assert.equal(cal.calls.filter((x) => x === "listEvents").length, reads);
  });
});

test("a superseded leftover event is never a conflict", async () => {
  await withApp(async (ctx) => {
    const { api, cal } = ctx;
    const { id, block } = await planned(ctx, "13:00");
    cal.failNext("deleteEvent", new CalendarError("google_unavailable", "down"));
    assert.equal((await api.move(id, slot("13:30"))).json.previous.eventDeleted, false);
    assert.equal(cal.raw(block.googleEventId).status, "confirmed", "the old event is still there and overlaps");
    const c = (await api.recheck(id)).json.check;
    assert.deepEqual([c.state, c.conflicts], ["green", []]);
  });
});

test("needs_input instead of a color when timezone, effort or the deadline timezone is missing", async () => {
  await withApp(async (ctx) => {
    const { api, cal, db } = ctx;
    const { id } = await planned(ctx);
    const reads = () => cal.calls.filter((c) => c === "listEvents").length;
    const before = reads();

    db.prepare("UPDATE actions SET deadline_tz = NULL WHERE id = ?").run(id);
    let c = (await api.recheck(id)).json.check;
    assert.deepEqual([c.state, c.reason], ["needs_input", "deadline_missing_timezone"]);
    db.prepare("UPDATE actions SET deadline_tz = 'UTC' WHERE id = ?").run(id);

    db.prepare("UPDATE actions SET confirmed_effort_min = NULL WHERE id = ?").run(id);
    c = (await api.recheck(id)).json.check;
    assert.deepEqual([c.state, c.reason], ["needs_input", "missing_effort"]);
    db.prepare("UPDATE actions SET confirmed_effort_min = 60 WHERE id = ?").run(id);

    db.prepare("UPDATE settings SET value = NULL WHERE key = 'tz'").run();
    c = (await api.recheck(id)).json.check;
    assert.deepEqual([c.state, c.reason], ["needs_input", "missing_timezone"]);
    assert.equal(reads(), before, "no calendar read for incomplete inputs");
  });
});

test("ignore all-day events: an all-day event over the block is green when on, amber when off", async () => {
  const conference = { id: "conf", summary: "Conference", start: "2026-11-02T00:00:00Z", end: "2026-11-03T00:00:00Z", allDay: true };
  await withApp(
    async (ctx) => {
      const { id } = await planned(ctx);
      ctx.cal.addEvent(conference);
      assert.equal((await ctx.api.recheck(id)).json.check.state, "green");
    },
    { ignoreAllDay: true },
  );
  await withApp(
    async (ctx) => {
      const { id } = await planned(ctx);
      ctx.cal.addEvent(conference);
      const c = (await ctx.api.recheck(id)).json.check;
      assert.deepEqual([c.state, c.conflicts[0].summary], ["amber", "Conference"]);
    },
    { ignoreAllDay: false },
  );
});

test("refused when there is nothing to recheck", async () => {
  await withApp(async ({ api, seed, db }) => {
    const open = seed();
    assert.deepEqual([(await api.recheck(open)).status, (await api.recheck(open)).json.error], [409, "not_planned"]);
    assert.equal((await api.recheck(999)).status, 404);
    db.prepare("UPDATE actions SET status = 'done' WHERE id = ?").run(open);
    assert.equal((await api.recheck(open)).json.error, "action_closed");
  });
});

test("a calendar failure is reported, stored as an error check, and the next recheck recovers", async () => {
  await withApp(async (ctx) => {
    const { api, cal } = ctx;
    const { id } = await planned(ctx);
    cal.failNext("listEvents", new CalendarError("google_unavailable", "Google is down"));
    const r = await api.recheck(id);
    assert.deepEqual([r.status, r.json.error, r.json.check.state, r.json.check.reason], [502, "google_unavailable", "error", "google_unavailable"]);
    const history = (await api.get(`/api/actions/${id}/checks`)).json.checks;
    assert.equal(history[0].state, "error");
    assert.equal((await api.recheck(id)).json.check.state, "green");
    cal.failNext("listEvents", new CalendarError("google_not_connected", "x"));
    assert.equal((await api.recheck(id)).status, 409);
  });
});

test("history keeps every check, newest first, labeled manual or watcher", async () => {
  await withApp(async (ctx) => {
    const { api, recheck } = ctx;
    const { id } = await planned(ctx);
    assert.equal((await api.get(`/api/actions/${id}`)).json.check, null);
    await api.recheck(id);
    await recheck.recheckAll({ source: "watcher" });
    const { checks } = (await api.get(`/api/actions/${id}/checks`)).json;
    assert.deepEqual(checks.map((c) => c.source), ["watcher", "manual"]);
    assert.equal((await api.get(`/api/actions/${id}/checks?limit=1`)).json.checks.length, 1);
    assert.equal((await api.get("/api/actions/999/checks")).status, 404);
  });
});

test("the button and the watcher run the same function: identical results apart from the source label", async () => {
  await withApp(async (ctx) => {
    const { api, cal, recheck } = ctx;
    const { id } = await planned(ctx);
    cal.addEvent({ id: "sync", summary: "Team sync", start: at("13:30"), end: at("14:30") });
    const manual = (await api.recheck(id)).json.check;
    const all = await recheck.recheckAll({ source: "watcher" });
    assert.deepEqual(all.results, [{ actionId: id, state: "amber", error: null }]);
    const watcher = (await api.get(`/api/actions/${id}/checks`)).json.checks[0];
    assert.equal(watcher.source, "watcher");
    const strip = ({ id: _id, source: _source, ...rest }) => rest;
    assert.deepEqual(strip(watcher), strip(manual));
  });
});

test("recheckAll: only planned actions with an active block, one failure does not stop the rest", async () => {
  await withApp(async (ctx) => {
    const { api, cal, recheck, seed, db } = ctx;
    const a = await planned(ctx, "13:00");
    const b = await planned(ctx, "15:00");
    seed(); // open, never planned
    const closed = await planned(ctx, "17:00");
    db.prepare("UPDATE actions SET status = 'done' WHERE id = ?").run(closed.id);
    cal.addEvent({ id: "clash", summary: "Clash", start: at("15:10"), end: at("15:30") });

    const run = await recheck.recheckAll();
    assert.equal(run.checked, 2);
    assert.deepEqual(run.results.map((r) => [r.actionId, r.state]), [[a.id, "green"], [b.id, "amber"]]);

    cal.failNext("listEvents", new CalendarError("google_unavailable", "down"));
    const run2 = await recheck.recheckAll();
    assert.deepEqual(run2.results.map((r) => [r.actionId, r.state]), [[a.id, "error"], [b.id, "amber"]]);
    assert.equal(run2.results[0].error, "google_unavailable");
    assert.ok(api);
  });
});

test("recheckAll does nothing while Google is not connected", async () => {
  await withApp(
    async (ctx) => {
      await planned(ctx);
      const before = ctx.cal.calls.length;
      assert.deepEqual(await ctx.recheck.recheckAll(), { skipped: "google_not_connected", checked: 0, results: [] });
      assert.equal(ctx.cal.calls.length, before, "no calendar reads, no stored checks");
    },
    { canRun: () => false },
  );
});

test("watcher: ticks call run, never overlap, never throw, and start and stop cleanly", async () => {
  const logs = { warn: [], error: [] };
  const logger = { log() {}, warn: (m) => logs.warn.push(m), error: (m) => logs.error.push(m) };
  let release;
  let calls = 0;
  const watcher = createWatcher({
    run: () => {
      calls++;
      return new Promise((resolve) => (release = () => resolve({ ok: calls })));
    },
    logger,
  });
  const first = watcher.tick();
  assert.deepEqual(await watcher.tick(), { skipped: "busy" });
  assert.equal(logs.warn.length, 1);
  release();
  assert.deepEqual(await first, { ok: 1 });
  const second = watcher.tick();
  release();
  assert.deepEqual(await second, { ok: 2 });

  const failing = createWatcher({ run: async () => { throw new Error("boom"); }, logger });
  assert.deepEqual(await failing.tick(), { error: "boom" });
  assert.match(logs.error[0], /boom/);
  assert.deepEqual(await failing.tick(), { error: "boom" }, "a failed run does not block the next tick");

  const timers = [];
  const cleared = [];
  const w = createWatcher({
    run: async () => ({}),
    setIntervalImpl: (fn, ms) => (timers.push({ fn, ms }), { unref() {} }),
    clearIntervalImpl: (t) => cleared.push(t),
  });
  assert.equal(w.intervalMs, 300_000, "default is 5 minutes");
  w.start();
  w.start();
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 300_000);
  assert.equal(w.isStarted(), true);
  w.stop();
  w.stop();
  assert.equal(cleared.length, 1);
  assert.equal(w.isStarted(), false);
});
