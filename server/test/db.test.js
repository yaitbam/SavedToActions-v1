import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { SERVER_ROOT } from "../src/config.js";
import {
  DEFAULT_SETTINGS,
  MIGRATIONS,
  PRESET_GOALS,
  SCHEMA_VERSION,
  clearTokens,
  getSettings,
  listGoals,
  loadTokens,
  openDb,
  renameGoal,
  saveSettings,
  schemaVersion,
  storeTokens,
} from "../src/db.js";

const now = "2026-11-05T10:00:00.000Z";

function seedSave(db, extra = {}) {
  return db.prepare("INSERT INTO saves (note, imported_at, is_demo) VALUES (?, ?, ?)").run(extra.note ?? "note", now, extra.isDemo ?? 0).lastInsertRowid;
}

function seedAction(db, saveId, extra = {}) {
  const cols = { save_id: saveId, goal_id: 1, kind: "try", status: "open", created_at: now, updated_at: now, ...extra };
  const names = Object.keys(cols);
  return db
    .prepare(`INSERT INTO actions (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`)
    .run(...Object.values(cols)).lastInsertRowid;
}

test("fresh database: schema version, 6 starting goals in order, default settings with a US Eastern timezone", () => {
  const db = openDb(":memory:");
  assert.equal(schemaVersion(db), SCHEMA_VERSION);
  assert.deepEqual(listGoals(db).map((g) => g.name), PRESET_GOALS);
  assert.equal(listGoals(db).length, 6);
  assert.deepEqual(getSettings(db), { workStart: "09:00", workEnd: "21:00", tz: "America/New_York", ignoreAllDay: true });
  assert.equal(DEFAULT_SETTINGS.tz, "America/New_York");
  assert.equal(db.pragma("foreign_keys", { simple: true }), 1);
});

test("goal names are editable, blank names are rejected", () => {
  const db = openDb(":memory:");
  assert.deepEqual(renameGoal(db, 1, "  Earn income  "), { id: 1, name: "Earn income" });
  assert.equal(listGoals(db)[0].name, "Earn income");
  assert.equal(renameGoal(db, 1, "   "), null);
  assert.equal(renameGoal(db, 99, "Nope"), null);
});

test("settings round trip", () => {
  const db = openDb(":memory:");
  const saved = saveSettings(db, { workStart: "08:30", workEnd: "20:00", tz: "Africa/Casablanca" });
  assert.deepEqual(saved, { workStart: "08:30", workEnd: "20:00", tz: "Africa/Casablanca", ignoreAllDay: true });
  assert.deepEqual(getSettings(db), saved);
  // The all-day setting is only written when it is given, and survives a save that leaves it out.
  assert.equal(saveSettings(db, { workStart: "08:30", workEnd: "20:00", tz: "Africa/Casablanca", ignoreAllDay: false }).ignoreAllDay, false);
  assert.equal(saveSettings(db, { workStart: "09:00", workEnd: "21:00", tz: "Africa/Casablanca" }).ignoreAllDay, false);
});

test("action kind and deadline are independent, missing values stay NULL", () => {
  const db = openDb(":memory:");
  const save = seedSave(db);
  const tryWithDeadline = seedAction(db, save, { kind: "try", deadline_wall: "2026-11-05T18:00", deadline_tz: "Africa/Casablanca" });
  const opportunityNoDeadline = seedAction(db, save, { kind: "opportunity" });
  const rows = db.prepare("SELECT id, kind, deadline_wall, deadline_tz, deadline_utc, suggested_effort_min, confirmed_effort_min FROM actions ORDER BY id").all();
  assert.equal(rows[0].id, tryWithDeadline);
  assert.equal(rows[0].deadline_wall, "2026-11-05T18:00");
  assert.equal(rows[1].id, opportunityNoDeadline);
  assert.equal(rows[1].deadline_wall, null);
  assert.equal(rows[1].confirmed_effort_min, null);
});

test("constraints: kind, status, is_demo, unique idempotency key, foreign keys", () => {
  const db = openDb(":memory:");
  const save = seedSave(db);
  assert.throws(() => seedAction(db, save, { kind: "claim" }), /CHECK/);
  assert.throws(() => seedAction(db, save, { status: "archived" }), /CHECK/);
  assert.throws(() => seedSave(db, { isDemo: 2 }), /CHECK/);
  assert.throws(() => seedAction(db, 9999), /FOREIGN KEY/);

  const action = seedAction(db, save);
  const insertBlock = (key) =>
    db
      .prepare("INSERT INTO blocks (action_id, idempotency_key, start_utc, end_utc, tz, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(action, key, "2026-11-05T14:00:00.000Z", "2026-11-05T15:00:00.000Z", "UTC", now);
  insertBlock("k1");
  assert.throws(() => insertBlock("k1"), /UNIQUE/);
});

test("a move marks the old block superseded_by the new one", () => {
  const db = openDb(":memory:");
  const action = seedAction(db, seedSave(db));
  const insert = db.prepare("INSERT INTO blocks (action_id, idempotency_key, start_utc, end_utc, tz, created_at) VALUES (?, ?, ?, ?, ?, ?)");
  const oldId = insert.run(action, "old", "2026-11-05T14:00:00.000Z", "2026-11-05T15:00:00.000Z", "UTC", now).lastInsertRowid;
  const newId = insert.run(action, "new", "2026-11-05T16:00:00.000Z", "2026-11-05T17:00:00.000Z", "UTC", now).lastInsertRowid;
  db.prepare("UPDATE blocks SET superseded_by = ? WHERE id = ?").run(newId, oldId);
  const active = db.prepare("SELECT id FROM blocks WHERE action_id = ? AND superseded_by IS NULL").all(action);
  assert.deepEqual(active.map((b) => b.id), [Number(newId)]);
});

test("oauth tokens: store, merge on overwrite, clear", () => {
  const db = openDb(":memory:");
  assert.equal(loadTokens(db), null);
  storeTokens(db, { access_token: "a", refresh_token: "r", scope: "s" });
  assert.deepEqual(loadTokens(db), { access_token: "a", refresh_token: "r", scope: "s" });
  storeTokens(db, { access_token: "b", refresh_token: "r" });
  assert.equal(loadTokens(db).access_token, "b");
  clearTokens(db);
  assert.equal(loadTokens(db), null);
});

test("migration v1 to v2 keeps rows, tokens and block links, and allows a NULL goal", () => {
  fs.mkdirSync(path.join(SERVER_ROOT, "data"), { recursive: true });
  const dir = fs.mkdtempSync(path.join(SERVER_ROOT, "data", "test-"));
  try {
    const file = path.join(dir, "v1.db");
    const old = new Database(file);
    old.pragma("foreign_keys = ON");
    old.exec(MIGRATIONS[0]);
    old.pragma("user_version = 1");
    old.prepare("INSERT INTO goals (name, position) VALUES ('Make money', 0)").run();
    old.prepare("INSERT INTO saves (note, imported_at) VALUES ('n', ?)").run(now);
    old
      .prepare(
        "INSERT INTO actions (save_id, goal_id, kind, title, deadline_wall, deadline_tz, status, created_at, updated_at) VALUES (1, 1, 'try', 'T', '2026-11-05T18:00', 'Africa/Casablanca', 'planned', ?, ?)",
      )
      .run(now, now);
    old
      .prepare("INSERT INTO blocks (action_id, idempotency_key, start_utc, end_utc, tz, created_at) VALUES (1, 'k', '2026-11-05T14:00:00.000Z', '2026-11-05T15:00:00.000Z', 'UTC', ?)")
      .run(now);
    old.prepare("INSERT INTO oauth_tokens (id, tokens_json, updated_at) VALUES (1, '{\"refresh_token\":\"r\"}', ?)").run(now);
    old.close();

    const db = openDb(file);
    assert.equal(schemaVersion(db), SCHEMA_VERSION);
    const action = db.prepare("SELECT * FROM actions WHERE id = 1").get();
    assert.equal(action.title, "T");
    assert.equal(action.deadline_wall, "2026-11-05T18:00");
    assert.equal(action.status, "planned");
    assert.equal(action.deadline_tz_source, null);
    assert.equal(action.deadline_year_assumed, 0);
    assert.deepEqual(loadTokens(db), { refresh_token: "r" });
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM blocks WHERE action_id = 1").get().n, 1);
    assert.deepEqual(db.pragma("foreign_key_check"), []);
    assert.equal(db.pragma("foreign_keys", { simple: true }), 1);

    // goal_id can now be NULL, and blocks still enforce their foreign key to actions.
    db.prepare("INSERT INTO actions (save_id, goal_id, kind, created_at, updated_at) VALUES (1, NULL, 'other', ?, ?)").run(now, now);
    assert.throws(
      () => db.prepare("INSERT INTO blocks (action_id, idempotency_key, start_utc, end_utc, tz, created_at) VALUES (999, 'k2', 'a', 'b', 'UTC', ?)").run(now),
      /FOREIGN KEY/,
    );
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
