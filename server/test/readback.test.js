import test from "node:test";
import assert from "node:assert/strict";
import { APP_ID, TAG_APP, TAG_KEY, compareReadback, offsetOfDateTime } from "../src/scheduler/index.js";

const block = { startUtc: "2026-11-05T14:00:00.000Z", endUtc: "2026-11-05T15:00:00.000Z", tz: "Africa/Casablanca", idempotencyKey: "key1" };
const goodEvent = () => ({
  id: "stax",
  status: "confirmed",
  start: { dateTime: "2026-11-05T14:00:00+00:00", timeZone: "Africa/Casablanca" },
  end: { dateTime: "2026-11-05T15:00:00+00:00", timeZone: "Africa/Casablanca" },
  extendedProperties: { private: { [TAG_APP]: APP_ID, [TAG_KEY]: "key1" } },
});
const fields = (r) => r.drift.map((d) => d.field);

test("offsetOfDateTime", () => {
  assert.equal(offsetOfDateTime("2026-11-05T15:00:00+01:00"), "+01:00");
  assert.equal(offsetOfDateTime("2026-11-05T15:00:00-05:00"), "-05:00");
  assert.equal(offsetOfDateTime("2026-11-05T15:00:00Z"), "+00:00");
  assert.equal(offsetOfDateTime("2026-11-05T15:00:00"), null);
  assert.equal(offsetOfDateTime(undefined), null);
});

test("an event stored exactly as asked reads back ok", () => {
  assert.deepEqual(compareReadback({ block, event: goodEvent() }), { status: "ok", drift: [] });
});

test("Z formatted times with the right zone are fine (same offset)", () => {
  const e = goodEvent();
  e.start.dateTime = "2026-11-05T14:00:00Z";
  e.end.dateTime = "2026-11-05T15:00:00Z";
  assert.equal(compareReadback({ block, event: e }).status, "ok");
});

test("snake case blocks (database rows) are accepted", () => {
  const row = { start_utc: block.startUtc, end_utc: block.endUtc, tz: block.tz, idempotency_key: "key1" };
  assert.equal(compareReadback({ block: row, event: goodEvent() }).status, "ok");
});

test("the Casablanca worry: Google reports +01:00 for the same instant, flagged against our own +00:00", () => {
  const e = goodEvent();
  e.start.dateTime = "2026-11-05T15:00:00+01:00";
  e.end.dateTime = "2026-11-05T16:00:00+01:00";
  const r = compareReadback({ block, event: e });
  assert.equal(r.status, "drift");
  assert.deepEqual(r.drift, [
    { field: "start_offset", expected: "+00:00", actual: "+01:00" },
    { field: "end_offset", expected: "+00:00", actual: "+01:00" },
  ]);
});

test("a shifted instant is flagged for start and end", () => {
  const e = goodEvent();
  e.start.dateTime = "2026-11-05T14:15:00+00:00";
  e.end.dateTime = "2026-11-05T15:30:00+00:00";
  const r = compareReadback({ block, event: e });
  assert.deepEqual(r.drift.filter((d) => d.field === "start" || d.field === "end"), [
    { field: "start", expected: "2026-11-05T14:00:00.000Z", actual: "2026-11-05T14:15:00.000Z" },
    { field: "end", expected: "2026-11-05T15:00:00.000Z", actual: "2026-11-05T15:30:00.000Z" },
  ]);
});

test("timezone drift, on start or on end only", () => {
  const a = goodEvent();
  a.start.timeZone = "Europe/Paris";
  assert.deepEqual(compareReadback({ block, event: a }).drift, [{ field: "tz", expected: "Africa/Casablanca", actual: "Europe/Paris" }]);
  const b = goodEvent();
  b.end.timeZone = undefined;
  assert.deepEqual(compareReadback({ block, event: b }).drift, [{ field: "end_tz", expected: "Africa/Casablanca", actual: null }]);
});

test("missing, cancelled, all-day and untagged events are drift", () => {
  assert.deepEqual(compareReadback({ block, event: null }), { status: "drift", drift: [{ field: "event", expected: "present", actual: "missing" }] });
  const cancelled = { ...goodEvent(), status: "cancelled" };
  assert.deepEqual(fields(compareReadback({ block, event: cancelled })), ["status"]);
  const allDay = { ...goodEvent(), start: { date: "2026-11-05" }, end: { date: "2026-11-06" } };
  const r = compareReadback({ block, event: allDay });
  assert.equal(r.drift[0].actual, "all-day 2026-11-05");
  const untagged = { ...goodEvent(), extendedProperties: undefined };
  assert.deepEqual(fields(compareReadback({ block, event: untagged })), ["tag_app", "tag_key"]);
  const wrongKey = goodEvent();
  wrongKey.extendedProperties.private[TAG_KEY] = "other";
  assert.deepEqual(compareReadback({ block, event: wrongKey }).drift, [{ field: "tag_key", expected: "key1", actual: "other" }]);
});
