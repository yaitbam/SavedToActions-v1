import test from "node:test";
import assert from "node:assert/strict";
import {
  APP_ID,
  TAG_APP,
  TAG_KEY,
  activeBlocks,
  blockTags,
  eventIdFromKey,
  makeIdempotencyKey,
  planMove,
  readTags,
  scheduledMinutes,
  supersededKeys,
} from "../src/scheduler/index.js";

const slot = { startUtc: "2026-11-05T14:00:00.000Z", endUtc: "2026-11-05T15:00:00.000Z" };

test("idempotency key is deterministic and ignores ISO formatting differences", () => {
  const a = makeIdempotencyKey({ actionId: 7, ...slot });
  const b = makeIdempotencyKey({ actionId: 7, startUtc: "2026-11-05T14:00:00Z", endUtc: "2026-11-05T15:00:00Z" });
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{32}$/);
});

test("idempotency key changes with the action or the slot", () => {
  const a = makeIdempotencyKey({ actionId: 7, ...slot });
  assert.notEqual(a, makeIdempotencyKey({ actionId: 8, ...slot }));
  assert.notEqual(a, makeIdempotencyKey({ actionId: 7, startUtc: "2026-11-05T14:15:00Z", endUtc: "2026-11-05T15:15:00Z" }));
});

test("event id derived from the key fits Google's base32hex rule (a-v, 0-9, 5 to 1024 chars)", () => {
  assert.match(eventIdFromKey(makeIdempotencyKey({ actionId: 1, ...slot })), /^[a-v0-9]{5,1024}$/);
});

test("tags round trip through extendedProperties.private", () => {
  const tags = blockTags("abc");
  assert.deepEqual(tags, { [TAG_APP]: APP_ID, [TAG_KEY]: "abc" });
  assert.deepEqual(readTags({ extendedProperties: { private: tags } }), { app: APP_ID, key: "abc" });
  assert.deepEqual(readTags({}), { app: null, key: null });
});

const blocks = [
  { id: 1, action_id: 7, idempotency_key: "old", start_utc: "2026-11-05T14:00:00Z", end_utc: "2026-11-05T15:00:00Z", superseded_by: 2 },
  { id: 2, action_id: 7, idempotency_key: "new", start_utc: "2026-11-05T16:00:00Z", end_utc: "2026-11-05T17:00:00Z", superseded_by: null },
];

test("superseded blocks are not active and never counted twice", () => {
  assert.deepEqual(activeBlocks(blocks).map((b) => b.id), [2]);
  assert.deepEqual([...supersededKeys(blocks)], ["old"]);
  assert.equal(scheduledMinutes(blocks), 60);
  assert.equal(scheduledMinutes([]), 0);
});

test("planMove describes the new block and what to supersede, without side effects", () => {
  const old = { id: 2, action_id: 7, idempotency_key: "new" };
  const frozen = Object.freeze({ ...old });
  const r = planMove({ oldBlock: frozen, newSlot: slot, tz: "Africa/Casablanca" });
  assert.equal(r.ok, true);
  assert.equal(r.supersedeBlockId, 2);
  assert.equal(r.newBlock.action_id, 7);
  assert.equal(r.newBlock.tz, "Africa/Casablanca");
  assert.equal(r.newBlock.superseded_by, null);
  assert.equal(r.newBlock.idempotency_key, makeIdempotencyKey({ actionId: 7, ...slot }));
  assert.equal(r.newBlock.google_event_id, eventIdFromKey(r.newBlock.idempotency_key));
  assert.equal(r.tags[TAG_KEY], r.newBlock.idempotency_key);
});

test("attempt: a repeat at the same slot gets a new key, the same attempt always gets the same key", () => {
  const base = { actionId: 7, ...slot };
  const first = makeIdempotencyKey(base);
  assert.equal(makeIdempotencyKey({ ...base, attempt: 0 }), first, "attempt 0 is the original key");
  const second = makeIdempotencyKey({ ...base, attempt: 1 });
  assert.notEqual(second, first);
  assert.equal(makeIdempotencyKey({ ...base, attempt: 1 }), second);
  assert.notEqual(makeIdempotencyKey({ ...base, attempt: 2 }), second);
  assert.match(eventIdFromKey(second), /^[a-v0-9]{5,1024}$/);
});

test("cancelled blocks are not active, not counted, and their keys are stale", () => {
  const list = [
    { id: 1, idempotency_key: "a", start_utc: "2026-11-05T14:00:00Z", end_utc: "2026-11-05T15:00:00Z", superseded_by: null, cancelled_at: "2026-11-05T10:00:00Z" },
    { id: 2, idempotency_key: "b", start_utc: "2026-11-05T16:00:00Z", end_utc: "2026-11-05T17:00:00Z", superseded_by: null, cancelled_at: null },
    { id: 3, idempotency_key: "c", start_utc: "2026-11-05T18:00:00Z", end_utc: "2026-11-05T19:30:00Z", superseded_by: 4, cancelled_at: null },
  ];
  assert.deepEqual(activeBlocks(list).map((b) => b.id), [2]);
  assert.deepEqual([...supersededKeys(list)].sort(), ["a", "c"]);
  assert.equal(scheduledMinutes(list), 60);
});

test("planMove carries the attempt into the new key, so a move back to an old slot is allowed", () => {
  const key0 = makeIdempotencyKey({ actionId: 7, ...slot });
  const old = { id: 2, action_id: 7, idempotency_key: key0 };
  assert.equal(planMove({ oldBlock: old, newSlot: slot, tz: "UTC" }).reason, "same_slot");
  const again = planMove({ oldBlock: old, newSlot: slot, tz: "UTC", attempt: 1 });
  assert.equal(again.ok, true);
  assert.notEqual(again.newBlock.idempotency_key, key0);
  assert.equal(again.newBlock.google_event_id, eventIdFromKey(again.newBlock.idempotency_key));
});

test("planMove refuses a move to the same slot", () => {
  const old = { id: 2, action_id: 7, idempotency_key: makeIdempotencyKey({ actionId: 7, ...slot }) };
  assert.deepEqual(planMove({ oldBlock: old, newSlot: slot, tz: "UTC" }), { ok: false, reason: "same_slot" });
});
