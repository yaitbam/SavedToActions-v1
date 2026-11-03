import test from "node:test";
import assert from "node:assert/strict";
import { APP_ID, TAG_APP, TAG_KEY, busyFromEvents, detectConflicts, eventInterval, ignoredReason } from "../src/scheduler/index.js";

const t = (iso) => Date.parse(iso);
const TZ = "UTC";
const block = {
  startMs: t("2026-11-05T14:00:00Z"),
  endMs: t("2026-11-05T15:00:00Z"),
  googleEventId: "stablock1",
  idempotencyKey: "key1",
};

const ev = (id, start, end, extra = {}) => ({
  id,
  status: "confirmed",
  summary: `event ${id}`,
  start: { dateTime: start },
  end: { dateTime: end },
  ...extra,
});
const tagged = (key, appId = APP_ID) => ({ extendedProperties: { private: { [TAG_APP]: appId, [TAG_KEY]: key } } });
const detect = (events, extra = {}) => detectConflicts({ block, events, tz: TZ, ...extra });

test("a foreign event overlapping the block is a conflict", () => {
  const r = detect([ev("m1", "2026-11-05T14:30:00Z", "2026-11-05T15:30:00Z", { summary: "Team sync" })]);
  assert.equal(r.conflicts.length, 1);
  assert.deepEqual(r.conflicts[0], {
    eventId: "m1",
    summary: "Team sync",
    kind: "foreign",
    startUtc: "2026-11-05T14:30:00.000Z",
    endUtc: "2026-11-05T15:30:00.000Z",
  });
});

test("events that only touch the block edges are not conflicts", () => {
  const r = detect([ev("a", "2026-11-05T13:00:00Z", "2026-11-05T14:00:00Z"), ev("b", "2026-11-05T15:00:00Z", "2026-11-05T16:00:00Z")]);
  assert.deepEqual(r.conflicts, []);
});

test("a meeting fully inside our block is still found (aggregated FreeBusy would merge it away)", () => {
  const own = ev("stablock1", "2026-11-05T14:00:00Z", "2026-11-05T15:00:00Z", tagged("key1"));
  const inside = ev("m2", "2026-11-05T14:10:00Z", "2026-11-05T14:40:00Z", { summary: "Quick call" });
  const r = detect([own, inside]);
  assert.equal(r.ownEventFound, true);
  assert.deepEqual(r.conflicts.map((c) => c.eventId), ["m2"]);
});

test("a meeting that fully covers our block is a conflict", () => {
  assert.equal(detect([ev("big", "2026-11-05T13:00:00Z", "2026-11-05T16:00:00Z")]).conflicts.length, 1);
});

test("our own event is never a conflict: matched by event id", () => {
  const r = detect([ev("stablock1", "2026-11-05T14:00:00Z", "2026-11-05T15:00:00Z")]);
  assert.deepEqual(r.conflicts, []);
  assert.equal(r.ownEventFound, true);
});

test("our own event is never a conflict: matched by app tag and idempotency key", () => {
  const r = detect([ev("renamed-id", "2026-11-05T14:00:00Z", "2026-11-05T15:00:00Z", tagged("key1"))]);
  assert.deepEqual(r.conflicts, []);
  assert.equal(r.ownEventFound, true);
});

test("a cancelled own event does not count as found", () => {
  const r = detect([ev("stablock1", "2026-11-05T14:00:00Z", "2026-11-05T15:00:00Z", { status: "cancelled" })]);
  assert.equal(r.ownEventFound, false);
});

test("an event tagged by a different app is foreign", () => {
  const r = detect([ev("x", "2026-11-05T14:00:00Z", "2026-11-05T15:00:00Z", tagged("key1", "some-other-app"))]);
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.conflicts[0].kind, "foreign");
});

test("another active SavedToAction block overlapping ours is a conflict (double booking)", () => {
  const r = detect([ev("stablock2", "2026-11-05T14:30:00Z", "2026-11-05T15:30:00Z", tagged("key2"))]);
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.conflicts[0].kind, "other_block");
});

test("a superseded leftover of ours is ignored, not a conflict", () => {
  const r = detect([ev("stablock0", "2026-11-05T14:00:00Z", "2026-11-05T15:00:00Z", tagged("oldkey"))], { supersededKeys: new Set(["oldkey"]) });
  assert.deepEqual(r.conflicts, []);
  assert.deepEqual(r.ignored, [{ eventId: "stablock0", reason: "superseded_block" }]);
});

test("cancelled, transparent and declined-by-owner events do not block time", () => {
  const window = ["2026-11-05T14:00:00Z", "2026-11-05T15:00:00Z"];
  const r = detect([
    ev("c", ...window, { status: "cancelled" }),
    ev("f", ...window, { transparency: "transparent" }),
    ev("d", ...window, { attendees: [{ self: true, responseStatus: "declined" }] }),
  ]);
  assert.deepEqual(r.conflicts, []);
  assert.deepEqual(r.ignored.map((i) => i.reason).sort(), ["cancelled", "declined", "transparent"]);
});

test("declined by someone else still blocks, accepted by owner blocks", () => {
  const window = ["2026-11-05T14:00:00Z", "2026-11-05T15:00:00Z"];
  const r = detect([
    ev("o", ...window, { attendees: [{ self: false, responseStatus: "declined" }] }),
    ev("a", ...window, { attendees: [{ self: true, responseStatus: "accepted" }] }),
  ]);
  assert.equal(r.conflicts.length, 2);
});

test("all-day events block the whole local day unless transparent", () => {
  const allDay = { id: "ad", status: "confirmed", summary: "Conference", start: { date: "2026-11-05" }, end: { date: "2026-11-06" } };
  assert.equal(detect([allDay]).conflicts.length, 1);
  assert.equal(detect([{ ...allDay, transparency: "transparent" }]).conflicts.length, 0);
  assert.equal(detect([{ ...allDay, start: { date: "2026-11-06" }, end: { date: "2026-11-07" } }]).conflicts.length, 0);
});

test("eventInterval: offsets in dateTime are respected, malformed events give null", () => {
  assert.deepEqual(eventInterval(ev("x", "2026-11-05T15:00:00+01:00", "2026-11-05T16:00:00+01:00"), TZ), {
    start: t("2026-11-05T14:00:00Z"),
    end: t("2026-11-05T15:00:00Z"),
  });
  assert.equal(eventInterval({ id: "bad", start: {}, end: {} }, TZ), null);
  assert.equal(eventInterval(ev("zero", "2026-11-05T15:00:00Z", "2026-11-05T15:00:00Z"), TZ), null);
});

const allDayEvent = (extra = {}) => ({ id: "ad", status: "confirmed", summary: "Conference", start: { date: "2026-11-05" }, end: { date: "2026-11-06" }, ...extra });

test("ignoreAllDay: all-day events are skipped when on, and still block when off", () => {
  assert.equal(ignoredReason(allDayEvent()), null);
  assert.equal(ignoredReason(allDayEvent(), { ignoreAllDay: true }), "all_day");
  assert.equal(detect([allDayEvent()]).conflicts.length, 1, "off by default in the pure function");
  const on = detect([allDayEvent()], { ignoreAllDay: true });
  assert.deepEqual([on.conflicts, on.ignored], [[], [{ eventId: "ad", reason: "all_day" }]]);

  // A timed event that spans days is not all-day.
  const trip = ev("trip", "2026-11-04T09:00:00Z", "2026-11-07T18:00:00Z");
  assert.equal(detect([trip], { ignoreAllDay: true }).conflicts.length, 1);

  const meeting = ev("m", "2026-11-05T09:00:00Z", "2026-11-05T10:00:00Z");
  assert.deepEqual(busyFromEvents({ block, events: [allDayEvent(), meeting], tz: TZ, ignoreAllDay: true }), [{ start: t("2026-11-05T09:00:00Z"), end: t("2026-11-05T10:00:00Z") }]);
  assert.equal(busyFromEvents({ block, events: [allDayEvent()], tz: TZ }).length, 1);
});

test("ignoredReason", () => {
  assert.equal(ignoredReason({ status: "confirmed" }), null);
  assert.equal(ignoredReason({ transparency: "opaque" }), null);
});

test("busyFromEvents: excludes our block and stale leftovers, keeps foreign events and our other blocks", () => {
  const events = [
    ev("stablock1", "2026-11-05T14:00:00Z", "2026-11-05T15:00:00Z", tagged("key1")),
    ev("stale", "2026-11-05T16:00:00Z", "2026-11-05T17:00:00Z", tagged("oldkey")),
    ev("foreign", "2026-11-05T09:00:00Z", "2026-11-05T10:00:00Z"),
    ev("otherblock", "2026-11-05T11:00:00Z", "2026-11-05T12:00:00Z", tagged("key2")),
    ev("free", "2026-11-05T12:00:00Z", "2026-11-05T13:00:00Z", { transparency: "transparent" }),
  ];
  const busy = busyFromEvents({ block, events, tz: TZ, supersededKeys: new Set(["oldkey"]) });
  assert.deepEqual(busy, [
    { start: t("2026-11-05T09:00:00Z"), end: t("2026-11-05T10:00:00Z") },
    { start: t("2026-11-05T11:00:00Z"), end: t("2026-11-05T12:00:00Z") },
  ]);
});
