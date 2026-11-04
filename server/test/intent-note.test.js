import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { openDb, saveSettings } from "../src/db.js";
import { cleanIntent, intentLabel, resolveWhen } from "../src/scheduler/intent.js";
import { textMatches } from "../src/extraction/normalize.js";
import { cleanPostLink, linkView } from "../src/postLink.js";
import { runSelfTest } from "../src/tz.js";
import { createFakeCalendar } from "./fakeCalendar.js";

// Monday 2 Nov 2026, 12:00 UTC. Working hours 09:00 to 21:00 in UTC.
const NOW = Date.parse("2026-11-02T12:00:00Z");
const MIN = 60_000;
const NYC = "America/New_York";

// ---- the post link ----------------------------------------------------------------------------------------------
test("post link: only plain web addresses, tidied, with the platform worked out", () => {
  const x = cleanPostLink("https://x.com/someone/status/123?s=20&t=abc&utm_source=share#frag");
  assert.deepEqual(x, { ok: true, url: "https://x.com/someone/status/123", host: "x.com", platform: "x" });
  assert.equal(cleanPostLink("linkedin.com/posts/abc-123?utm_medium=member_ios").url, "https://linkedin.com/posts/abc-123");
  assert.equal(cleanPostLink("https://www.instagram.com/p/XYZ/?igsh=abc").platform, "instagram");
  assert.equal(cleanPostLink("https://example.org/a?keep=1&fbclid=zz").url, "https://example.org/a?keep=1");
  assert.equal(cleanPostLink("https://example.org/a").platform, "web");
  // Empty means no link. Anything that is not a plain web address is refused.
  for (const empty of [undefined, null, "", "   "]) assert.deepEqual(cleanPostLink(empty), { ok: true, url: null });
  for (const bad of ["javascript:alert(1)", "ftp://x.com/a", "https://user:pw@x.com/a", "not a link", "https://localhost/a", "https://x.com/" + "a".repeat(2100), 42, {}]) {
    assert.equal(cleanPostLink(bad).ok, false, String(bad));
  }
  assert.equal(linkView("https://x.com/a/status/1").platform, "x");
  assert.equal(linkView(null), null);
  assert.equal(linkView("javascript:alert(1)"), null);
});

// ---- reading the note ---------------------------------------------------------------------------------------------
const note = "tonight, 30 min";
const clean = (raw, n = note) => cleanIntent(raw, { note: n, today: "2026-11-02", matches: textMatches });

test("intent: only what the note really says is kept", () => {
  const ok = clean({ when: { day: "today", part: "evening", quote: "tonight" }, minutes: 30, minutes_quote: "30 min" });
  assert.deepEqual(ok, { when: { day: "today", date: null, part: "evening", quote: "tonight" }, minutes: 30, minutesQuote: "30 min" });
  // A quote that is not in the note is dropped, so nothing can come from the image or be made up.
  assert.equal(clean({ when: { day: "today", part: "evening", quote: "this weekend" }, minutes: null }), null);
  assert.deepEqual(clean({ when: { day: "today", quote: "tonight" }, minutes: 45, minutes_quote: "45 min" }).minutes, null);
  // Out of range, wrong types and unknown words are ignored.
  assert.equal(clean({ minutes: 0, minutes_quote: "30 min" }), null);
  assert.equal(clean({ minutes: 5000, minutes_quote: "30 min" }), null);
  assert.equal(clean({ when: { day: "someday", part: "midnight", quote: "tonight" } }), null);
  assert.equal(clean("tonight"), null);
  assert.equal(clean(null), null);
  assert.equal(clean([]), null);
  // A date must be real, not in the past and not far away.
  assert.equal(clean({ when: { date: "2026-02-31", quote: "tonight" } }), null);
  assert.equal(clean({ when: { date: "2026-10-01", quote: "tonight" } }), null);
  assert.equal(clean({ when: { date: "2030-01-01", quote: "tonight" } }), null);
  assert.equal(clean({ when: { date: "2026-11-20", quote: "tonight" } }).when.date, "2026-11-20");
});

test("intent: labels read like the user's own words", () => {
  const label = (when) => intentLabel(when, "UTC", NOW);
  assert.equal(label({ day: "today", part: "evening" }), "Tonight");
  assert.equal(label({ day: "today", part: "morning" }), "Today morning");
  assert.equal(label({ day: "today" }), "Today");
  assert.equal(label({ day: "tomorrow", part: "morning" }), "Tomorrow morning");
  assert.equal(label({ day: "weekend" }), "This weekend");
  assert.equal(label({ date: "2026-11-20", part: "evening" }), "20 Nov evening");
  assert.equal(label({ date: "2027-01-05" }), "5 Jan 2027");
  assert.equal(label({ part: "afternoon" }), "Afternoon");
  assert.equal(label(null), null);
});

test("intent: turned into search limits by code, inside the user's working hours", () => {
  const ctx = { nowMs: NOW, tz: "UTC", workStart: "09:00", workEnd: "21:00" };
  const tonight = resolveWhen({ day: "today", part: "evening" }, ctx);
  assert.equal(tonight.ok, true);
  assert.equal(new Date(tonight.notBeforeMs).toISOString(), "2026-11-02T12:00:00.000Z");
  assert.equal(new Date(tonight.untilMs).toISOString(), "2026-11-03T00:00:00.000Z");
  assert.deepEqual(tonight.hours, { workStart: "17:00", workEnd: "21:00" });
  assert.equal(tonight.label, "Tonight");

  const tomorrow = resolveWhen({ day: "tomorrow", part: "morning" }, ctx);
  assert.equal(new Date(tomorrow.notBeforeMs).toISOString(), "2026-11-03T00:00:00.000Z");
  assert.deepEqual(tomorrow.hours, { workStart: "09:00", workEnd: "12:00" });

  // Monday: the weekend is Saturday and Sunday. On a Sunday it is what is left of today.
  const weekend = resolveWhen({ day: "weekend" }, ctx);
  assert.equal(new Date(weekend.notBeforeMs).toISOString(), "2026-11-07T00:00:00.000Z");
  assert.equal(new Date(weekend.untilMs).toISOString(), "2026-11-09T00:00:00.000Z");
  const sunday = resolveWhen({ day: "weekend" }, { ...ctx, nowMs: Date.parse("2026-11-08T10:00:00Z") });
  assert.equal(new Date(sunday.notBeforeMs).toISOString(), "2026-11-08T10:00:00.000Z");
  assert.equal(new Date(sunday.untilMs).toISOString(), "2026-11-09T00:00:00.000Z");

  // The evening is outside hours that end at 16:00, so the part is refused and the caller falls back.
  const early = resolveWhen({ day: "today", part: "evening" }, { ...ctx, workEnd: "16:00" });
  assert.deepEqual([early.ok, early.reason], [false, "outside_working_hours"]);
  const past = resolveWhen({ date: "2026-11-01" }, ctx);
  assert.deepEqual([past.ok, past.reason], [false, "in_the_past"]);

  // Days are the user's local days: 22:00 New York time on 2 Nov is already 3 Nov in UTC.
  const local = resolveWhen({ day: "today" }, { nowMs: Date.parse("2026-11-03T03:00:00Z"), tz: NYC, workStart: "09:00", workEnd: "21:00" });
  assert.equal(new Date(local.untilMs).toISOString(), "2026-11-03T05:00:00.000Z");
});

// ---- planning with the note ---------------------------------------------------------------------------------------
async function withApp(fn, { workEnd = "21:00", intent = null, effort = null, link = null } = {}) {
  const db = openDb(":memory:");
  saveSettings(db, { workStart: "09:00", workEnd, tz: "UTC", ignoreAllDay: false });
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
  const nowIso = new Date(NOW).toISOString();
  const saveId = Number(db.prepare("INSERT INTO saves (note, imported_at, source_url) VALUES ('tonight', ?, ?)").run(nowIso, link).lastInsertRowid);
  const id = Number(
    db
      .prepare(
        `INSERT INTO actions (save_id, goal_id, kind, title, deliverables_json, suggested_effort_min, confirmed_effort_min, intent_json, status, created_at, updated_at)
         VALUES (?, 3, 'opportunity', 'Read the guide', '["Open the page"]', 30, ?, ?, 'open', ?, ?)`,
      )
      .run(saveId, effort, intent ? JSON.stringify(intent) : null, nowIso, nowIso).lastInsertRowid,
  );
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const post = async (path, body) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
    return { status: res.status, json: await res.json() };
  };
  try {
    return await fn({ db, cal, id, post, propose: (body) => post(`/api/actions/${id}/propose`, body), approve: (slot, extra) => post(`/api/actions/${id}/approve`, { ...slot, approved: true, ...extra }) });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const tonight = { when: { day: "today", date: null, part: "evening", quote: "tonight" }, minutes: null, minutesQuote: null };
const slotAt = (iso, minutes) => ({ startUtc: iso, endUtc: new Date(Date.parse(iso) + minutes * MIN).toISOString() });

test("propose: the minutes on screen are enough to look for a time, and nothing is saved", async () => {
  await withApp(async ({ db, id, propose }) => {
    assert.equal((await propose({})).json.error, "effort_not_confirmed");
    const r = await propose({ effortMin: 45 });
    assert.equal(r.status, 200);
    assert.equal(r.json.found, true);
    assert.equal(r.json.slot.durationMin, 45);
    assert.equal(db.prepare("SELECT confirmed_effort_min FROM actions WHERE id = ?").get(id).confirmed_effort_min, null);
    assert.equal((await propose({ effortMin: 0 })).json.error, "effort_not_confirmed");
  });
});

test("propose: a note that said tonight is tried first, and the answer says it was met", async () => {
  await withApp(async ({ propose }) => {
    const r = await propose({ effortMin: 30 });
    assert.equal(r.json.slot.startUtc, "2026-11-02T17:00:00.000Z");
    assert.deepEqual(r.json.intent, { applied: true, label: "Tonight" });
  }, { intent: tonight });
});

test("propose: when the evening is full it falls back to the next free time and says so", async () => {
  await withApp(async ({ cal, propose }) => {
    cal.addEvent({ id: "busy1", start: "2026-11-02T12:00:00Z", end: "2026-11-02T21:00:00Z" });
    const r = await propose({ effortMin: 30 });
    assert.equal(r.json.found, true);
    assert.equal(r.json.slot.startUtc, "2026-11-03T09:00:00.000Z");
    assert.deepEqual(r.json.intent, { applied: false, label: "Tonight", reason: "nothing_fits" });
  }, { intent: tonight });
});

test("propose: a part of the day outside the working hours is explained, not guessed", async () => {
  await withApp(async ({ propose }) => {
    const r = await propose({ effortMin: 30 });
    assert.equal(r.json.found, true);
    assert.equal(r.json.intent.applied, false);
    assert.equal(r.json.intent.reason, "outside_working_hours");
  }, { intent: tonight, workEnd: "16:00" });
});

test("propose: another time ignores the note and starts no earlier than asked", async () => {
  await withApp(async ({ propose }) => {
    const first = await propose({ effortMin: 30 });
    const next = await propose({ effortMin: 30, notBeforeUtc: first.json.slot.endUtc });
    assert.ok(Date.parse(next.json.slot.startUtc) >= Date.parse(first.json.slot.endUtc));
    assert.equal(next.json.intent, undefined);
    assert.equal((await propose({ effortMin: 30, notBeforeUtc: "soon" })).status, 400);
  }, { intent: tonight });
});

test("approve: the minutes shown with the time are confirmed by approving, and the post link goes on the event", async () => {
  await withApp(async ({ cal, db, id, propose, approve }) => {
    const proposed = (await propose({ effortMin: 45 })).json.slot;
    // Without minutes there is nothing confirmed yet, so nothing is written.
    assert.equal((await approve(proposed)).json.error, "effort_not_confirmed");
    assert.equal(cal.calls.filter((c) => c === "insertEvent").length, 0);
    // A block that is not as long as the minutes is refused.
    assert.equal((await approve(slotAt(proposed.startUtc, 30), { effortMin: 45 })).json.error, "slot_length_mismatch");
    assert.equal((await approve(proposed, { effortMin: 2000 })).json.error, "invalid_effort");
    const ok = await approve(proposed, { effortMin: 45 });
    assert.equal(ok.status, 201);
    const row = db.prepare("SELECT status, confirmed_effort_min FROM actions WHERE id = ?").get(id);
    assert.deepEqual({ ...row }, { status: "planned", confirmed_effort_min: 45 });
    assert.equal(ok.json.action.effort.confirmedMin, 45);
    const description = cal.bodies.at(-1).description;
    assert.match(description, /Original post: https:\/\/x\.com\/someone\/status\/123/);
  }, { link: "https://x.com/someone/status/123" });
});

test("approve: the event description links to the save page when the save has a screenshot", async () => {
  await withApp(async ({ cal, db, id, propose, approve }) => {
    const saveId = db.prepare("SELECT save_id FROM actions WHERE id = ?").get(id).save_id;
    db.prepare("UPDATE saves SET screenshot_path = ? WHERE id = ?").run("11111111-1111-1111-1111-111111111111.png", saveId);
    const proposed = (await propose({ effortMin: 30 })).json.slot;
    assert.equal((await approve(proposed, { effortMin: 30 })).status, 201);
    const description = cal.bodies.at(-1).description;
    assert.match(description, new RegExp(`Screenshot and details: http://localhost:5173/app/saves/${saveId}(\\n|$)`));
  }, { effort: 30 });
});

test("approve: no screenshot means no screenshot line in the event description", async () => {
  await withApp(async ({ cal, propose, approve }) => {
    const proposed = (await propose({ effortMin: 30 })).json.slot;
    assert.equal((await approve(proposed, { effortMin: 30 })).status, 201);
    assert.doesNotMatch(cal.bodies.at(-1).description, /Screenshot and details/);
  }, { effort: 30 });
});

test("approve: minutes shown again can replace minutes confirmed earlier, as long as the block matches", async () => {
  await withApp(async ({ db, id, propose, approve }) => {
    const proposed = (await propose({ effortMin: 60 })).json.slot;
    assert.equal((await approve(proposed)).json.error, "slot_length_mismatch");
    assert.equal((await approve(proposed, { effortMin: 60 })).status, 201);
    assert.equal(db.prepare("SELECT confirmed_effort_min FROM actions WHERE id = ?").get(id).confirmed_effort_min, 60);
  }, { effort: 30 });
});

test("the view carries the link and what the note asked for", async () => {
  await withApp(async ({ db, id }) => {
    const { getActionView } = await import("../src/actions.js");
    const view = getActionView(db, id, { nowMs: NOW });
    assert.equal(view.link.platform, "linkedin");
    assert.deepEqual(view.intent, { when: tonight.when, minutes: 20, minutesQuote: "20 min", label: "Tonight" });
    assert.equal(view.effort.statedMin, 20);
  }, { intent: { ...tonight, minutes: 20, minutesQuote: "20 min" }, link: "https://www.linkedin.com/posts/abc" });
});
