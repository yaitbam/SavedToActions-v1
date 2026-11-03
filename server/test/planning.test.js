import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { getActiveBlock, listBlocks } from "../src/blockStore.js";
import { openDb, saveSettings } from "../src/db.js";
import { CalendarError } from "../src/google/calendar.js";
import { APP_ID, TAG_APP, TAG_KEY, eventIdFromKey, makeIdempotencyKey, scheduledMinutes } from "../src/scheduler/index.js";
import { runSelfTest } from "../src/tz.js";
import { createFakeCalendar } from "./fakeCalendar.js";

// Fixed clock: Monday 2 Nov 2026, 12:00 UTC. Working hours 09:00 to 21:00.
const NOW = Date.parse("2026-11-02T12:00:00Z");
const MIN = 60_000;
const at = (hhmm, day = "2026-11-02") => `${day}T${hhmm}:00.000Z`;
const slot = (hhmm, minutes = 60, day) => {
  const startUtc = at(hhmm, day);
  return { startUtc, endUtc: new Date(Date.parse(startUtc) + minutes * MIN).toISOString() };
};

function seedAction(db, tz, o = {}) {
  const effort = "effort" in o ? o.effort : 60;
  const deadlineTz = "deadlineTz" in o ? o.deadlineTz : tz;
  const nowIso = new Date(NOW).toISOString();
  const saveId = Number(db.prepare("INSERT INTO saves (note, imported_at) VALUES ('n', ?)").run(nowIso).lastInsertRowid);
  return Number(
    db
      .prepare(
        `INSERT INTO actions (save_id, goal_id, kind, title, deadline_wall, deadline_tz, deliverables_json,
           suggested_effort_min, confirmed_effort_min, status, created_at, updated_at)
         VALUES (?, 3, 'opportunity', ?, ?, ?, ?, 15, ?, 'open', ?, ?)`,
      )
      .run(saveId, o.title ?? "Check registration", o.deadlineWall ?? "2026-11-06T18:00", deadlineTz, JSON.stringify(o.deliverables ?? ["Open the page"]), effort, nowIso, nowIso)
      .lastInsertRowid,
  );
}

async function withApp(opts, fn) {
  const tz = "tz" in opts ? opts.tz : "UTC";
  const db = openDb(":memory:");
  // The older tests exercise the FreeBusy path, so the all-day setting is off unless a test asks for it.
  if (tz) saveSettings(db, { workStart: "09:00", workEnd: "21:00", tz, ignoreAllDay: opts.ignoreAllDay ?? false });
  const cal = createFakeCalendar();
  const app = createApp({
    db,
    config: { frontendOrigin: "http://localhost:5173", screenshotDir: "unused", maxUploadBytes: 1024 },
    googleAuth: { status: () => ({}) },
    selfTest: runSelfTest(),
    provider: null,
    calendar: cal,
    clock: () => NOW,
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
    get: (path) => request("GET", path),
    post: (path, body) => request("POST", path, body),
    propose: (id) => request("POST", `/api/actions/${id}/propose`),
    approve: (id, s, extra = {}) => request("POST", `/api/actions/${id}/approve`, { ...s, approved: true, ...extra }),
    move: (id, s, extra = {}) => request("POST", `/api/actions/${id}/move`, { ...s, approved: true, ...extra }),
  };
  try {
    return await fn({ db, cal, api, seed: (o) => seedAction(db, tz, o) });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const writes = (cal) => cal.calls.filter((c) => c === "insertEvent" || c === "deleteEvent");

test("propose: stops with a clear reason when something required is missing, and reads nothing", async () => {
  await withApp({}, async ({ api, db, seed, cal }) => {
    const noEffort = seed({ effort: null });
    let r = await api.propose(noEffort);
    assert.deepEqual([r.status, r.json.error], [409, "effort_not_confirmed"]);
    const noDeadlineTz = seed({ deadlineTz: null });
    r = await api.propose(noDeadlineTz);
    assert.deepEqual([r.status, r.json.error], [409, "deadline_missing_timezone"]);
    assert.equal((await api.propose(999)).status, 404);
    db.prepare("UPDATE actions SET status = 'done' WHERE id = ?").run(noDeadlineTz);
    assert.deepEqual([(await api.propose(noDeadlineTz)).status, (await api.propose(noDeadlineTz)).json.error], [409, "action_closed"]);
    assert.equal(cal.calls.length, 0);
  });
  await withApp({ tz: null }, async ({ api, seed }) => {
    const r = await api.propose(seed());
    assert.deepEqual([r.status, r.json.error], [409, "missing_timezone"]);
  });
});

test("propose: Google problems surface as clear errors", async () => {
  await withApp({}, async ({ api, seed, cal }) => {
    const id = seed();
    for (const [code, status] of [["google_not_connected", 409], ["google_missing_scopes", 409], ["google_auth_error", 401], ["google_unavailable", 502], ["google_unreachable", 502]]) {
      cal.failNext("freeBusy", new CalendarError(code, `problem ${code}`));
      const r = await api.propose(id);
      assert.deepEqual([r.status, r.json.error], [status, code]);
      assert.match(r.json.detail, /problem/);
    }
  });
});

test("propose: first slot comes from FreeBusy, earliest valid, formatted by the server, nothing written", async () => {
  await withApp({}, async ({ api, seed, cal }) => {
    const id = seed();
    cal.addEvent({ id: "m1", summary: "Standup", start: at("12:00"), end: at("13:30") });
    const r = await api.propose(id);
    assert.equal(r.status, 200);
    assert.equal(r.json.found, true);
    assert.equal(r.json.mode, "new");
    assert.equal(r.json.source, "freebusy");
    assert.deepEqual(r.json.slot, {
      startUtc: at("13:30"),
      endUtc: at("14:30"),
      tz: "UTC",
      durationMin: 60,
      startDisplay: "Mon 2 Nov 2026, 13:30 (+00:00)",
      endDisplay: "Mon 2 Nov 2026, 14:30 (+00:00)",
      startRelative: "Today 13:30",
      endRelative: "Today 14:30",
      rangeRelative: "Today 13:30 to 14:30",
    });
    assert.ok(cal.calls.includes("freeBusy"));
    assert.deepEqual(writes(cal), []);
    assert.ok(!cal.calls.includes("listEvents"), "the first search uses FreeBusy, not events");
  });
});

test("propose: red says what would change it, deadline passed is explained", async () => {
  await withApp({}, async ({ api, seed }) => {
    const tight = seed({ effort: 120, deadlineWall: "2026-11-02T13:00" });
    const r = await api.propose(tight);
    assert.equal(r.status, 200);
    assert.equal(r.json.found, false);
    assert.equal(r.json.reason, "no_slot_before_deadline");
    assert.match(r.json.explanation[0], /No 120 minute slot fits under your working hours \(09:00 to 21:00\)/);
    assert.equal(r.json.hints.fitsIfEffortAtMost, 60);
    const late = seed({ deadlineWall: "2026-11-01T10:00" });
    const p = await api.propose(late);
    assert.deepEqual([p.json.found, p.json.reason], [false, "deadline_passed"]);
  });
});

test("approve: nothing is written without approved: true", async () => {
  await withApp({}, async ({ api, seed, cal }) => {
    const id = seed();
    for (const extra of [{}, { approved: "yes" }, { approved: false }, { approved: 1 }]) {
      const r = await api.post(`/api/actions/${id}/approve`, { ...slot("13:00"), ...extra });
      assert.deepEqual([r.status, r.json.error], [400, "approval_required"]);
    }
    assert.deepEqual(cal.calls, []);
    assert.equal((await api.get(`/api/actions/${id}`)).json.status, "open");
  });
});

test("approve: fresh check, one write, read-back ok, block saved, action planned", async () => {
  await withApp({}, async ({ api, seed, cal, db }) => {
    const id = seed({ title: "Check registration", deliverables: ["Open the page"] });
    const r = await api.approve(id, slot("13:00"));
    assert.equal(r.status, 201);
    assert.equal(r.json.replayed, false);
    const { block, action } = r.json;
    assert.equal(action.status, "planned");
    assert.deepEqual([block.startUtc, block.endUtc, block.tz], [at("13:00"), at("14:00"), "UTC"]);
    assert.equal(block.startDisplay, "Mon 2 Nov 2026, 13:00 (+00:00)");
    assert.deepEqual([block.readback.status, block.readback.drift], ["ok", []]);

    const key = makeIdempotencyKey({ actionId: id, startUtc: at("13:00"), endUtc: at("14:00") });
    assert.equal(block.idempotencyKey, key);
    assert.equal(block.googleEventId, eventIdFromKey(key));
    assert.match(block.googleEventId, /^sta[0-9a-f]{32}$/);

    const body = cal.bodies[0];
    assert.equal(body.id, block.googleEventId);
    assert.equal(body.summary, "Check registration");
    assert.match(body.description, /Planned with SavedToAction\.\n\n- Open the page/);
    assert.deepEqual(body.start, { dateTime: at("13:00"), timeZone: "UTC" });
    assert.deepEqual(body.end, { dateTime: at("14:00"), timeZone: "UTC" });
    assert.equal(body.transparency, "opaque");
    assert.deepEqual(body.extendedProperties.private, { [TAG_APP]: APP_ID, [TAG_KEY]: key });

    // Order: fresh availability check, then the write, then the read-back.
    const order = cal.calls;
    assert.ok(order.indexOf("listEvents") < order.indexOf("insertEvent"));
    assert.ok(order.indexOf("insertEvent") < order.indexOf("getEvent"));

    assert.equal(listBlocks(db, id).length, 1);
    const view = (await api.get(`/api/actions/${id}`)).json;
    assert.equal(view.status, "planned");
    assert.equal(view.block.id, block.id);
  });
});

test("approve: replaying the same approved slot is idempotent, no second event", async () => {
  await withApp({}, async ({ api, seed, cal, db }) => {
    const id = seed();
    const first = await api.approve(id, slot("13:00"));
    const second = await api.approve(id, { startUtc: "2026-11-02T13:00:00Z", endUtc: "2026-11-02T14:00:00Z" });
    assert.equal(second.status, 200);
    assert.equal(second.json.replayed, true);
    assert.equal(second.json.block.id, first.json.block.id);
    assert.equal(cal.calls.filter((c) => c === "insertEvent").length, 1);
    assert.equal(listBlocks(db, id).length, 1);
    // A different slot is not a replay.
    const other = await api.approve(id, slot("15:00"));
    assert.deepEqual([other.status, other.json.error], [409, "already_planned"]);
  });
});

test("approve: the slot is checked against effort, the clock, working hours and the deadline", async () => {
  await withApp({}, async ({ api, seed, cal }) => {
    const id = seed({ deadlineWall: "2026-11-02T18:00" });
    const expect = async (s, status, error) => {
      const r = await api.approve(id, s);
      assert.deepEqual([r.status, r.json.error], [status, error], JSON.stringify(s));
    };
    await expect(slot("13:00", 90), 422, "slot_length_mismatch");
    await expect(slot("13:00", 30), 422, "slot_length_mismatch");
    await expect(slot("11:00"), 422, "slot_in_past");
    await expect(slot("21:00"), 422, "outside_working_hours");
    await expect(slot("08:30", 60, "2026-11-03"), 422, "outside_working_hours");
    await expect(slot("17:30"), 422, "after_deadline");
    await expect({ startUtc: "2026-11-02T13:00", endUtc: "2026-11-02T14:00" }, 400, "invalid_slot");
    await expect({ startUtc: at("13:00") }, 400, "invalid_slot");
    await expect({ startUtc: at("14:00"), endUtc: at("13:00") }, 400, "invalid_slot");
    await expect({ startUtc: "tomorrow", endUtc: "later" }, 400, "invalid_slot");
    assert.deepEqual(writes(cal), []);
    assert.equal((await api.get(`/api/actions/${id}`)).json.status, "open");
  });
});

test("approve: unconfirmed effort, missing timezone and closed actions are refused", async () => {
  await withApp({}, async ({ api, seed, db }) => {
    assert.equal((await api.approve(seed({ effort: null }), slot("13:00"))).json.error, "effort_not_confirmed");
    const closed = seed();
    db.prepare("UPDATE actions SET status = 'skipped' WHERE id = ?").run(closed);
    assert.equal((await api.approve(closed, slot("13:00"))).json.error, "action_closed");
    assert.equal((await api.approve(999, slot("13:00"))).status, 404);
  });
  await withApp({ tz: null }, async ({ api, seed }) => {
    assert.equal((await api.approve(seed(), slot("13:00"))).json.error, "missing_timezone");
  });
});

test("approve: the fresh check catches a meeting added after the slot was proposed, and offers an alternative", async () => {
  await withApp({}, async ({ api, seed, cal, db }) => {
    const id = seed();
    const proposed = (await api.propose(id)).json.slot;
    assert.equal(proposed.startUtc, at("12:00"));
    cal.addEvent({ id: "late", summary: "Dentist", start: at("12:30"), end: at("13:30") });
    const r = await api.approve(id, proposed);
    assert.deepEqual([r.status, r.json.error], [409, "slot_no_longer_available"]);
    assert.equal(r.json.conflicts[0].summary, "Dentist");
    assert.equal(r.json.alternative.found, true);
    assert.equal(r.json.alternative.source, "events");
    assert.equal(r.json.alternative.slot.startUtc, at("13:30"));
    assert.deepEqual(writes(cal), []);
    assert.equal(listBlocks(db, id).length, 0);
    assert.equal((await api.get(`/api/actions/${id}`)).json.status, "open");
  });
});

test("read-back: drift is flagged and saved, the block itself is kept (Casablanca offset worry)", async () => {
  await withApp({ tz: "Africa/Casablanca" }, async ({ api, seed, cal }) => {
    const id = seed({ deadlineTz: "Africa/Casablanca" });
    cal.sim.offset = "+01:00";
    const r = await api.approve(id, slot("13:00"));
    assert.equal(r.status, 201);
    assert.equal(r.json.action.status, "planned");
    assert.equal(r.json.block.readback.status, "drift");
    assert.deepEqual(r.json.block.readback.drift, [
      { field: "start_offset", expected: "+00:00", actual: "+01:00" },
      { field: "end_offset", expected: "+00:00", actual: "+01:00" },
    ]);
    // The user can re-verify later. Google now answers consistently.
    cal.sim.offset = null;
    const again = await api.post(`/api/actions/${id}/readback`);
    assert.equal(again.json.block.readback.status, "ok");
    assert.deepEqual(again.json.block.readback.drift, []);
  });
});

test("read-back: shifted instants, a changed timezone and stripped tags are all drift", async () => {
  await withApp({}, async ({ api, seed, cal }) => {
    const cases = [
      ["shiftMs", 15 * MIN, ["start", "end"]],
      ["tzOverride", "Europe/Paris", ["tz"]],
      ["dropTags", true, ["tag_app", "tag_key"]],
    ];
    for (const [i, [key, value, fields]] of cases.entries()) {
      cal.sim.shiftMs = 0;
      cal.sim.tzOverride = null;
      cal.sim.dropTags = false;
      cal.sim[key] = value;
      const r = await api.approve(seed(), slot("13:00", 60, `2026-11-0${3 + i}`));
      assert.equal(r.json.block.readback.status, "drift", key);
      assert.deepEqual(r.json.block.readback.drift.map((d) => d.field), fields, key);
    }
  });
});

test("read-back: if the read-back call itself fails the block is kept and marked failed, then can be re-verified", async () => {
  await withApp({}, async ({ api, seed, cal }) => {
    const id = seed();
    cal.failNext("getEvent", new CalendarError("google_unavailable", "down"));
    const r = await api.approve(id, slot("13:00"));
    assert.equal(r.status, 201);
    assert.equal(r.json.block.readback.status, "failed");
    assert.equal(r.json.block.readback.error, "google_unavailable");
    assert.equal(r.json.action.status, "planned");
    assert.equal((await api.post(`/api/actions/${id}/readback`)).json.block.readback.status, "ok");
    assert.equal((await api.post(`/api/actions/${seed()}/readback`)).json.error, "no_active_block");
    assert.equal((await api.post("/api/actions/999/readback")).status, 404);
  });
});

test("idempotency across a crash: an event we already wrote is reused, a foreign event with our id is refused", async () => {
  await withApp({}, async ({ api, seed, cal, db }) => {
    const id = seed();
    const s = slot("13:00");
    const key = makeIdempotencyKey({ actionId: id, startUtc: s.startUtc, endUtc: s.endUtc });
    cal.addEvent({ id: eventIdFromKey(key), summary: "Check registration", start: s.startUtc, end: s.endUtc, extendedProperties: { private: { [TAG_APP]: APP_ID, [TAG_KEY]: key } } });
    const r = await api.approve(id, s);
    assert.equal(r.status, 201);
    assert.equal(r.json.block.googleEventId, eventIdFromKey(key));
    assert.equal(cal.count(), 1, "no duplicate event");
    assert.equal(r.json.block.readback.status, "ok");

    const id2 = seed();
    const s2 = slot("15:00");
    const key2 = makeIdempotencyKey({ actionId: id2, startUtc: s2.startUtc, endUtc: s2.endUtc });
    cal.addEvent({ id: eventIdFromKey(key2), summary: "Someone else", start: s2.startUtc, end: s2.endUtc });
    const clash = await api.approve(id2, s2);
    assert.deepEqual([clash.status, clash.json.error], [502, "event_id_collision"]);
    assert.equal(listBlocks(db, id2).length, 0);
    assert.equal((await api.get(`/api/actions/${id2}`)).json.status, "open");
  });
});

test("move: propose excludes our own block, the approved move supersedes the old block and removes its event", async () => {
  await withApp({}, async ({ api, seed, cal, db }) => {
    const id = seed();
    const first = (await api.approve(id, slot("13:00"))).json.block;
    cal.addEvent({ id: "sync", summary: "Team sync", start: at("13:30"), end: at("14:30") });

    const p = await api.propose(id);
    assert.equal(p.json.mode, "move");
    assert.equal(p.json.source, "events");
    assert.equal(p.json.slot.startUtc, at("14:30"), "nearest valid slot after the old one");

    const r = await api.move(id, p.json.slot);
    assert.equal(r.status, 201);
    assert.equal(r.json.block.startUtc, at("14:30"));
    assert.equal(r.json.block.readback.status, "ok");
    assert.deepEqual(r.json.previous, { id: first.id, eventDeleted: true, deleteError: null });
    assert.equal(r.json.action.status, "planned");
    assert.equal(r.json.action.block.id, r.json.block.id);

    const rows = listBlocks(db, id);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].superseded_by, r.json.block.id);
    assert.ok(rows[0].event_deleted_at);
    assert.equal(getActiveBlock(db, id).id, r.json.block.id);
    assert.equal(scheduledMinutes(rows), 60, "never count both");
    assert.equal(cal.raw(first.googleEventId).status, "cancelled");
    assert.equal(cal.raw(r.json.block.googleEventId).status, "confirmed");
  });
});

test("move: needs approval, a planned block, a real change, and a free slot", async () => {
  await withApp({}, async ({ api, seed, cal, db }) => {
    const id = seed();
    assert.equal((await api.move(id, slot("15:00"))).json.error, "not_planned");
    await api.approve(id, slot("13:00"));
    const noApproval = await api.post(`/api/actions/${id}/move`, slot("15:00"));
    assert.deepEqual([noApproval.status, noApproval.json.error], [400, "approval_required"]);
    assert.equal((await api.move(id, slot("13:00"))).json.error, "same_slot");
    assert.equal((await api.move(id, slot("15:00", 30))).json.error, "slot_length_mismatch");

    cal.addEvent({ id: "busy", summary: "Workshop", start: at("15:00"), end: at("16:00") });
    const blocked = await api.move(id, slot("15:00"));
    assert.deepEqual([blocked.status, blocked.json.error], [409, "slot_no_longer_available"]);
    assert.equal(blocked.json.conflicts[0].summary, "Workshop");
    assert.equal(blocked.json.alternative.found, true);
    assert.equal(listBlocks(db, id).length, 1, "the old block is untouched");
    assert.equal(getActiveBlock(db, id).superseded_by, null);
    assert.ok(!cal.calls.includes("deleteEvent"));
  });
});

test("move: a new slot that overlaps the old window is fine, our own block is not a conflict", async () => {
  await withApp({}, async ({ api, seed }) => {
    const id = seed();
    await api.approve(id, slot("13:00"));
    const r = await api.move(id, slot("13:30"));
    assert.equal(r.status, 201);
    assert.equal(r.json.block.startUtc, at("13:30"));
  });
});

test("move away and back: the block returns to an old slot with a fresh key and event id", async () => {
  await withApp({}, async ({ api, seed, cal, db }) => {
    const id = seed();
    const a1 = (await api.approve(id, slot("13:00"))).json.block;
    const b = (await api.move(id, slot("15:00"))).json.block;
    const r = await api.move(id, slot("13:00"));
    assert.equal(r.status, 201);
    const a2 = r.json.block;
    assert.equal(a2.startUtc, a1.startUtc);
    assert.notEqual(a2.idempotencyKey, a1.idempotencyKey);
    assert.notEqual(a2.googleEventId, a1.googleEventId);
    assert.equal(a2.idempotencyKey, makeIdempotencyKey({ actionId: id, startUtc: a1.startUtc, endUtc: a1.endUtc, attempt: 1 }));
    assert.equal(new Set([a1.idempotencyKey, b.idempotencyKey, a2.idempotencyKey]).size, 3);
    const rows = listBlocks(db, id);
    assert.equal(rows.length, 3);
    assert.equal(scheduledMinutes(rows), 60);
    assert.deepEqual([a1, b, a2].map((x) => cal.raw(x.googleEventId).status), ["cancelled", "cancelled", "confirmed"]);
  });
});

test("move: if removing the old event fails, the move stands, it is reported, and the leftover is never a conflict", async () => {
  await withApp({}, async ({ api, seed, cal }) => {
    const id = seed();
    const a = (await api.approve(id, slot("13:00"))).json.block;
    cal.failNext("deleteEvent", new CalendarError("google_unavailable", "down"));
    const r = await api.move(id, slot("15:00"));
    assert.equal(r.status, 201);
    assert.deepEqual(r.json.previous, { id: a.id, eventDeleted: false, deleteError: "google_unavailable" });
    assert.equal(cal.raw(a.googleEventId).status, "confirmed", "the old event is still on the calendar");

    // Moving next to a slot that overlaps that stale event works: its key is superseded, so it is ignored.
    const next = await api.move(id, slot("13:30"));
    assert.equal(next.status, 201);
  });
});

test("move: a block whose calendar event was deleted can be re-created at the same time", async () => {
  await withApp({}, async ({ api, seed, cal, db }) => {
    const id = seed();
    const a = (await api.approve(id, slot("13:00"))).json.block;
    cal.cancel(a.googleEventId);
    const r = await api.move(id, slot("13:00"));
    assert.equal(r.status, 201);
    assert.notEqual(r.json.block.googleEventId, a.googleEventId);
    assert.equal(r.json.previous.eventDeleted, true);
    assert.equal(listBlocks(db, id).length, 2);
    assert.equal(scheduledMinutes(listBlocks(db, id)), 60);
  });
});

test("done: self reported, works with or without a block, leaves the calendar alone, closes the action", async () => {
  await withApp({}, async ({ api, seed, cal, db }) => {
    const planned = seed();
    const block = (await api.approve(planned, slot("13:00"))).json.block;
    const r = await api.post(`/api/actions/${planned}/done`);
    assert.equal(r.status, 200);
    assert.equal(r.json.action.status, "done");
    assert.equal(r.json.action.doneAt, new Date(NOW).toISOString());
    assert.equal(cal.raw(block.googleEventId).status, "confirmed");
    assert.equal(getActiveBlock(db, planned).id, block.id, "the block still counts as time scheduled");

    assert.equal((await api.post(`/api/actions/${planned}/done`)).json.error, "action_closed");
    assert.equal((await api.propose(planned)).json.error, "action_closed");
    assert.equal((await api.approve(planned, slot("15:00"))).json.error, "action_closed");
    assert.equal((await api.move(planned, slot("15:00"))).json.error, "action_closed");

    const openOne = seed();
    assert.equal((await api.post(`/api/actions/${openOne}/done`)).json.action.status, "done");
    assert.equal((await api.post("/api/actions/999/done")).status, 404);
  });
});

test("skip: leaves the calendar block unless asked to remove it, and removal is read back", async () => {
  await withApp({}, async ({ api, seed, cal, db }) => {
    const plain = seed();
    const r0 = await api.post(`/api/actions/${plain}/skip`);
    assert.deepEqual([r0.json.action.status, r0.json.calendar.hadBlock], ["skipped", false]);

    const keep = seed();
    const kept = (await api.approve(keep, slot("13:00"))).json.block;
    const r1 = await api.post(`/api/actions/${keep}/skip`, {});
    assert.deepEqual(r1.json.calendar, { hadBlock: true, removed: false, removeError: null });
    assert.equal(cal.raw(kept.googleEventId).status, "confirmed");

    const remove = seed();
    const gone = (await api.approve(remove, slot("15:00"))).json.block;
    const rejected = await api.post(`/api/actions/${remove}/skip`, { removeFromCalendar: true });
    assert.equal(rejected.json.error, 'approval_required');
    assert.equal(cal.raw(gone.googleEventId).status, 'confirmed');
    assert.equal(getActiveBlock(db, remove).cancelled_at, null);
    const r2 = await api.post(`/api/actions/${remove}/skip`, { removeFromCalendar: true, approved: true });
    assert.deepEqual(r2.json.calendar, { hadBlock: true, removed: true, removeError: null });
    assert.equal(r2.json.action.status, "skipped");
    assert.equal(r2.json.action.block, null);
    assert.equal(cal.raw(gone.googleEventId).status, "cancelled");
    const rows = listBlocks(db, remove);
    assert.ok(rows[0].cancelled_at && rows[0].event_deleted_at);
    assert.equal(scheduledMinutes(rows), 0);

    const stuck = seed();
    await api.approve(stuck, slot("17:00"));
    cal.failNext("deleteEvent", new CalendarError("google_unavailable", "down"));
    const r3 = await api.post(`/api/actions/${stuck}/skip`, { removeFromCalendar: true, approved: true });
    assert.deepEqual(r3.json.calendar, { hadBlock: true, removed: false, removeError: "google_unavailable" });
    assert.equal(r3.json.action.status, "skipped");
    assert.equal(getActiveBlock(db, stuck).cancelled_at, null, "not cancelled because the event is still there");

    assert.equal((await api.post(`/api/actions/${plain}/skip`)).json.error, "action_closed");
  });
});

test("ignore all-day events (on): the first search reads events, skips all-day ones, and approval does not count them as conflicts", async () => {
  await withApp({ ignoreAllDay: true }, async ({ api, seed, cal }) => {
    cal.addEvent({ id: "conf", summary: "Conference", start: "2026-11-02T00:00:00Z", end: "2026-11-04T00:00:00Z", allDay: true });
    cal.addEvent({ id: "m1", summary: "Standup", start: at("12:00"), end: at("13:30") });
    const id = seed();
    const p = await api.propose(id);
    assert.equal(p.json.source, "events", "FreeBusy cannot skip all-day events, so the event level read is used");
    assert.equal(p.json.slot.startUtc, at("13:30"));
    assert.ok(!cal.calls.includes("freeBusy"));
    assert.equal((await api.approve(id, p.json.slot)).status, 201);
  });
});

test("ignore all-day events (off): FreeBusy is used and an all-day event blocks the whole day", async () => {
  await withApp({ ignoreAllDay: false }, async ({ api, seed, cal }) => {
    cal.addEvent({ id: "conf", summary: "Conference", start: "2026-11-02T00:00:00Z", end: "2026-11-04T00:00:00Z", allDay: true });
    const id = seed();
    const p = await api.propose(id);
    assert.equal(p.json.source, "freebusy");
    assert.equal(p.json.slot.startUtc, at("09:00", "2026-11-04"));
    const r = await api.approve(id, slot("13:00"));
    assert.deepEqual([r.status, r.json.error, r.json.conflicts[0].summary], [409, "slot_no_longer_available", "Conference"]);
  });
});

test("the action view carries the block, and none before approval", async () => {
  await withApp({}, async ({ api, seed }) => {
    const id = seed();
    assert.equal((await api.get(`/api/actions/${id}`)).json.block, null);
    await api.approve(id, slot("13:00"));
    const view = (await api.get(`/api/actions/${id}`)).json;
    assert.equal(view.block.durationMin, 60);
    assert.equal(view.block.readback.status, "ok");
    assert.equal(view.effort.scheduledMin, 60);
  });
});
