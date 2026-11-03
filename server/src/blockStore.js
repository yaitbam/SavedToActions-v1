// Block persistence. A block is one contiguous calendar block for an action. Moving a block marks the old
// row superseded_by the new one, skipping with removal marks it cancelled. Active means neither.
import { supersededKeys } from "./scheduler/blocks.js";
import { MIN, toMs } from "./scheduler/time.js";
import { formatForDisplay, formatRelative, withRelativeSlot } from "./tz.js";

export const getBlock = (db, id) => db.prepare("SELECT * FROM blocks WHERE id = ?").get(id);
export const getBlockByKey = (db, key) => db.prepare("SELECT * FROM blocks WHERE idempotency_key = ?").get(key);
export const listBlocks = (db, actionId) => db.prepare("SELECT * FROM blocks WHERE action_id = ? ORDER BY id").all(actionId);

export const getActiveBlock = (db, actionId) =>
  db
    .prepare("SELECT * FROM blocks WHERE action_id = ? AND superseded_by IS NULL AND cancelled_at IS NULL ORDER BY id DESC LIMIT 1")
    .get(actionId);

/** Earlier blocks of this action at exactly this slot. Feeds the idempotency key so a move back never collides. */
export const countBlocksWithSlot = (db, actionId, startUtc, endUtc) =>
  db.prepare("SELECT COUNT(*) AS n FROM blocks WHERE action_id = ? AND start_utc = ? AND end_utc = ?").get(actionId, startUtc, endUtc).n;

/** Keys of every superseded or cancelled block, across all actions. A leftover event with one is stale. */
export const allSupersededKeys = (db) =>
  supersededKeys(db.prepare("SELECT idempotency_key, superseded_by, cancelled_at FROM blocks").all());

export function insertBlock(db, b) {
  const info = db
    .prepare(
      `INSERT INTO blocks (
         action_id, google_event_id, idempotency_key, start_utc, end_utc, tz, superseded_by,
         readback_status, readback_at, readback_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
    )
    .run(
      b.actionId,
      b.googleEventId,
      b.idempotencyKey,
      b.startUtc,
      b.endUtc,
      b.tz,
      b.readback.status,
      b.nowIso,
      JSON.stringify({ drift: b.readback.drift, error: b.readback.error }),
      b.nowIso,
    );
  return Number(info.lastInsertRowid);
}

export const supersedeBlock = (db, oldId, newId) => db.prepare("UPDATE blocks SET superseded_by = ? WHERE id = ?").run(newId, oldId);
export const markEventDeleted = (db, id, nowIso) => db.prepare("UPDATE blocks SET event_deleted_at = ? WHERE id = ?").run(nowIso, id);
export const cancelBlock = (db, id, nowIso) => db.prepare("UPDATE blocks SET cancelled_at = ? WHERE id = ?").run(nowIso, id);

export function saveReadback(db, id, { status, drift, error }, nowIso) {
  db.prepare("UPDATE blocks SET readback_status = ?, readback_at = ?, readback_json = ? WHERE id = ?").run(
    status,
    nowIso,
    JSON.stringify({ drift, error }),
    id,
  );
}

/** A slot for the API: instants plus server formatted times. The browser must never convert them. */
export const decorateSlot = (slot, tz, durationMin, nowMs) =>
  withRelativeSlot(
    {
      startUtc: slot.startUtc,
      endUtc: slot.endUtc,
      tz,
      durationMin,
      startDisplay: formatForDisplay(slot.startUtc, tz),
      endDisplay: formatForDisplay(slot.endUtc, tz),
    },
    tz,
    nowMs,
  );

/** One Recheck result (button or watcher). `payload` is the already formatted result stored as JSON. */
export function insertCheck(db, { actionId, blockId, checkedAt, source, payload }) {
  const info = db
    .prepare("INSERT INTO checks (action_id, block_id, checked_at, source, state, reason, result_json) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(actionId, blockId, checkedAt, source, payload.state, payload.reason ?? null, JSON.stringify(payload));
  return Number(info.lastInsertRowid);
}

export const getCheck = (db, id) => db.prepare("SELECT * FROM checks WHERE id = ?").get(id);
export const listChecks = (db, actionId, limit = 20) =>
  db.prepare("SELECT * FROM checks WHERE action_id = ? ORDER BY id DESC LIMIT ?").all(actionId, limit);

/** Latest check for the block that is active now. A check of a block that was since moved is stale and ignored. */
export const getLatestCheck = (db, actionId, blockId) =>
  db.prepare("SELECT * FROM checks WHERE action_id = ? AND block_id = ? ORDER BY id DESC LIMIT 1").get(actionId, blockId);

export function checkView(row, { nowMs = Date.now() } = {}) {
  if (!row) return null;
  const payload = JSON.parse(row.result_json);
  const tz = payload.tz;
  // The stored payload keeps absolute strings only. Relative ones go stale, so they are added on every read.
  const slot = (s) => withRelativeSlot(s, tz, nowMs);
  return {
    id: row.id,
    blockId: row.block_id,
    checkedAt: row.checked_at,
    checkedAtDisplay: tz ? formatForDisplay(row.checked_at, tz) : null,
    checkedAtRelative: tz ? formatRelative(row.checked_at, tz, nowMs) : null,
    source: row.source,
    ...payload,
    conflicts: payload.conflicts?.map(slot),
    alternative: slot(payload.alternative),
    hints: payload.hints && { ...payload.hints, fitsIfWorkingHoursExtended: slot(payload.hints.fitsIfWorkingHoursExtended) },
    latestFeasibleStart: slot(payload.latestFeasibleStart),
    deadline: payload.deadline && tz ? { ...payload.deadline, relative: formatRelative(payload.deadline.utc, tz, nowMs) } : payload.deadline,
  };
}

/** API shape. Times are formatted here, the browser must never convert them. */
export function blockView(row, { nowMs = Date.now() } = {}) {
  if (!row) return null;
  const rb = row.readback_json ? JSON.parse(row.readback_json) : { drift: [], error: null };
  return {
    id: row.id,
    actionId: row.action_id,
    googleEventId: row.google_event_id,
    idempotencyKey: row.idempotency_key,
    startUtc: row.start_utc,
    endUtc: row.end_utc,
    tz: row.tz,
    durationMin: (toMs(row.end_utc) - toMs(row.start_utc)) / MIN,
    startDisplay: formatForDisplay(row.start_utc, row.tz),
    endDisplay: formatForDisplay(row.end_utc, row.tz),
    startRelative: formatRelative(row.start_utc, row.tz, nowMs),
    endRelative: formatRelative(row.end_utc, row.tz, nowMs),
    rangeRelative: withRelativeSlot({ startUtc: row.start_utc, endUtc: row.end_utc }, row.tz, nowMs).rangeRelative,
    supersededBy: row.superseded_by,
    cancelledAt: row.cancelled_at,
    eventDeletedAt: row.event_deleted_at,
    readback: { status: row.readback_status, at: row.readback_at, atDisplay:row.readback_at?formatForDisplay(row.readback_at,row.tz):null, drift: rb.drift, driftDisplay:(rb.drift??[]).map(d=>{
      const display=v=>v===null?null:typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(v)&&Number.isFinite(Date.parse(v))?formatForDisplay(v,row.tz):String(v);
      return {field:d.field,expectedDisplay:display(d.expected),actualDisplay:display(d.actual)};
    }), error: rb.error },
  };
}
