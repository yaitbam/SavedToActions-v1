// Block identity, tagging and supersede rules. Pure functions.
import crypto from "node:crypto";
import { MIN, toIso, toMs } from "./time.js";

export const APP_ID = "savedtoaction";

// extendedProperties.private keys on every event we write.
export const TAG_APP = "stApp";
export const TAG_KEY = "stIdempotencyKey";

/**
 * Deterministic key per (action, start, end). Same action and same slot always gives the same key,
 * so a retried write cannot create a second block. A different slot gives a different key.
 */
export function makeIdempotencyKey({ actionId, startUtc, endUtc, attempt = 0 }) {
  const start = toIso(toMs(startUtc));
  const end = toIso(toMs(endUtc));
  // attempt counts earlier blocks of this action at the exact same slot (superseded or cancelled). It keeps a
  // move back to an old slot from reusing that block's key (UNIQUE) and its deleted Google event id.
  // A retried request sees the same count, so it still gets the same key.
  const salt = attempt > 0 ? `|${attempt}` : "";
  return crypto.createHash("sha256").update(`${actionId}|${start}|${end}${salt}`).digest("hex").slice(0, 32);
}

/**
 * Google event id derived from the key, so a retried insert collides (409) instead of duplicating.
 * Assumption to verify at build step 4: Google requires ids of lowercase a-v and 0-9, length 5 to 1024.
 * "sta" plus hex satisfies that.
 */
export function eventIdFromKey(key) {
  return `sta${key}`;
}

export function blockTags(key) {
  return { [TAG_APP]: APP_ID, [TAG_KEY]: key };
}

export function readTags(event) {
  const p = event?.extendedProperties?.private ?? {};
  return { app: p[TAG_APP] ?? null, key: p[TAG_KEY] ?? null };
}

/** Active means not superseded and not cancelled. Never count a superseded block. */
export function activeBlocks(blocks) {
  return blocks.filter((b) => b.superseded_by == null && b.cancelled_at == null);
}

/** Keys of blocks that are no longer ours to protect. A leftover Google event with one of these keys is stale. */
export function supersededKeys(blocks) {
  return new Set(blocks.filter((b) => b.superseded_by != null || b.cancelled_at != null).map((b) => b.idempotency_key));
}

/** Sum of active block minutes. Superseded blocks are excluded so a move never counts twice. */
export function scheduledMinutes(blocks) {
  return activeBlocks(blocks).reduce((sum, b) => sum + (toMs(b.end_utc) - toMs(b.start_utc)) / MIN, 0);
}

/**
 * Describe a move without touching anything. The caller writes the new event, reads it back,
 * inserts newBlock, then sets oldBlock.superseded_by to the new block id.
 */
export function planMove({ oldBlock, newSlot, tz, attempt = 0 }) {
  const startUtc = newSlot.startUtc ?? toIso(newSlot.startMs);
  const endUtc = newSlot.endUtc ?? toIso(newSlot.endMs);
  const key = makeIdempotencyKey({ actionId: oldBlock.action_id, startUtc, endUtc, attempt });
  if (key === oldBlock.idempotency_key) return { ok: false, reason: "same_slot" };
  return {
    ok: true,
    supersedeBlockId: oldBlock.id,
    newBlock: {
      action_id: oldBlock.action_id,
      idempotency_key: key,
      google_event_id: eventIdFromKey(key),
      start_utc: startUtc,
      end_utc: endUtc,
      tz,
      superseded_by: null,
    },
    tags: blockTags(key),
  };
}
