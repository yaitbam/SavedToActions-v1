import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export const PRESET_GOALS = [
  "Earn more",
  "Learn a skill",
  "Don't miss deadlines",
];

export const DEFAULT_SETTINGS = Object.freeze({
  work_start: "09:00",
  work_end: "21:00",
  // No default timezone. Missing means missing: the scheduler refuses to run without one.
  tz: null,
  // All-day events (conferences, birthdays, "out" markers) do not block time. Read at event level, FreeBusy can't skip them.
  ignore_all_day: "1",
});

// Append only. Each entry runs once, in order, tracked by PRAGMA user_version.
export const MIGRATIONS = [
  `
  CREATE TABLE goals (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    position   INTEGER NOT NULL
  );

  -- save: screenshot, user note, imported_at. is_demo marks imported demo history (labeled in the UI).
  CREATE TABLE saves (
    id              INTEGER PRIMARY KEY,
    screenshot_path TEXT,
    note            TEXT,
    imported_at     TEXT NOT NULL,
    is_demo         INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1))
  );

  -- action: one per save in this build. kind and deadline are independent.
  -- Deadline is stored as the model or user gave it (wall time + IANA tz). deadline_utc is computed by code.
  -- Missing values stay NULL. Nothing is invented.
  CREATE TABLE actions (
    id                    INTEGER PRIMARY KEY,
    save_id               INTEGER NOT NULL REFERENCES saves(id),
    goal_id               INTEGER NOT NULL REFERENCES goals(id),
    kind                  TEXT NOT NULL CHECK (kind IN ('try', 'opportunity', 'other')),
    label                 TEXT,
    title                 TEXT,
    deadline_wall         TEXT,
    deadline_tz           TEXT,
    deadline_utc          TEXT,
    deliverables_json     TEXT,
    verbatim_items_json   TEXT,
    evidence_quote        TEXT,
    edited_fields_json    TEXT,
    suggested_effort_min  INTEGER,
    confirmed_effort_min  INTEGER,
    status                TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'planned', 'done', 'skipped')),
    done_at               TEXT,
    created_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL
  );
  CREATE INDEX idx_actions_goal ON actions(goal_id);
  CREATE INDEX idx_actions_save ON actions(save_id);

  -- block: one contiguous calendar block per action. Moving marks the old row superseded_by the new one.
  -- Active block = superseded_by IS NULL.
  CREATE TABLE blocks (
    id               INTEGER PRIMARY KEY,
    action_id        INTEGER NOT NULL REFERENCES actions(id),
    google_event_id  TEXT,
    idempotency_key  TEXT NOT NULL UNIQUE,
    start_utc        TEXT NOT NULL,
    end_utc          TEXT NOT NULL,
    tz               TEXT NOT NULL,
    superseded_by    INTEGER REFERENCES blocks(id),
    created_at       TEXT NOT NULL
  );
  CREATE INDEX idx_blocks_action ON blocks(action_id);

  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  -- Single user, local only. Tokens sit in a gitignored database file.
  CREATE TABLE oauth_tokens (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    tokens_json   TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  );
  `,
  // v2, extraction. Rebuild actions so goal_id can be NULL (the model may not pick a goal and we
  // never default one for the user) and add the extraction columns. Existing rows are copied over.
  `
  CREATE TABLE actions_new (
    id                    INTEGER PRIMARY KEY,
    save_id               INTEGER NOT NULL REFERENCES saves(id),
    goal_id               INTEGER REFERENCES goals(id),
    kind                  TEXT NOT NULL CHECK (kind IN ('try', 'opportunity', 'other')),
    label                 TEXT CHECK (label IS NULL OR label IN ('claim', 'validate', 'read', 'someday')),
    title                 TEXT,
    deadline_wall         TEXT,
    deadline_tz           TEXT,
    deadline_tz_source    TEXT CHECK (deadline_tz_source IS NULL OR deadline_tz_source IN ('model', 'settings_fallback', 'user')),
    deadline_utc          TEXT,
    deadline_label        TEXT,
    deadline_quote        TEXT,
    deadline_year_assumed INTEGER NOT NULL DEFAULT 0 CHECK (deadline_year_assumed IN (0, 1)),
    deliverables_json     TEXT,
    verbatim_items_json   TEXT,
    evidence_quote        TEXT,
    transcription         TEXT,
    warnings_json         TEXT,
    model_output_json     TEXT,
    model_name            TEXT,
    edited_fields_json    TEXT,
    suggested_effort_min  INTEGER,
    confirmed_effort_min  INTEGER,
    status                TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'planned', 'done', 'skipped')),
    done_at               TEXT,
    created_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL
  );
  INSERT INTO actions_new (
    id, save_id, goal_id, kind, label, title, deadline_wall, deadline_tz, deadline_utc,
    deliverables_json, verbatim_items_json, evidence_quote, edited_fields_json,
    suggested_effort_min, confirmed_effort_min, status, done_at, created_at, updated_at
  ) SELECT
    id, save_id, goal_id, kind, label, title, deadline_wall, deadline_tz, deadline_utc,
    deliverables_json, verbatim_items_json, evidence_quote, edited_fields_json,
    suggested_effort_min, confirmed_effort_min, status, done_at, created_at, updated_at
  FROM actions;
  DROP TABLE actions;
  ALTER TABLE actions_new RENAME TO actions;
  CREATE INDEX idx_actions_goal ON actions(goal_id);
  CREATE INDEX idx_actions_save ON actions(save_id);
  `,
  // v3. event_dates: the dates of the event itself, as written on the post (separate from the deadline).
  // Block columns for step 4: read-back result after every write, and calendar cleanup timestamps.
  // cancelled_at: the user removed the block from the calendar (skip). event_deleted_at: the Google event is gone.
  `
  ALTER TABLE actions ADD COLUMN event_dates_json TEXT;
  ALTER TABLE blocks ADD COLUMN readback_status TEXT CHECK (readback_status IS NULL OR readback_status IN ('ok', 'drift', 'failed'));
  ALTER TABLE blocks ADD COLUMN readback_at TEXT;
  ALTER TABLE blocks ADD COLUMN readback_json TEXT;
  ALTER TABLE blocks ADD COLUMN cancelled_at TEXT;
  ALTER TABLE blocks ADD COLUMN event_deleted_at TEXT;
  `,
  // v4. checks: every Recheck (button or watcher) is kept, newest wins in the UI, history is the audit trail.
  // agent_traces: one row per agent run with every step the model and the tools took.
  `
  CREATE TABLE checks (
    id          INTEGER PRIMARY KEY,
    action_id   INTEGER NOT NULL REFERENCES actions(id),
    block_id    INTEGER REFERENCES blocks(id),
    checked_at  TEXT NOT NULL,
    source      TEXT NOT NULL CHECK (source IN ('manual', 'watcher')),
    state       TEXT NOT NULL CHECK (state IN ('green', 'amber', 'red', 'needs_input', 'error')),
    reason      TEXT,
    result_json TEXT NOT NULL
  );
  CREATE INDEX idx_checks_action ON checks(action_id, id);

  CREATE TABLE agent_traces (
    id           INTEGER PRIMARY KEY,
    action_id    INTEGER NOT NULL REFERENCES actions(id),
    created_at   TEXT NOT NULL,
    finished_at  TEXT,
    instruction  TEXT,
    outcome      TEXT,
    model        TEXT,
    steps_json   TEXT NOT NULL,
    result_json  TEXT
  );
  CREATE INDEX idx_agent_traces_action ON agent_traces(action_id, id);
  `,

  // v5. Persist extraction work and reversible local lifecycle transitions.
  `
  CREATE TABLE extraction_jobs (
    id INTEGER PRIMARY KEY,
    save_id INTEGER NOT NULL REFERENCES saves(id),
    state TEXT NOT NULL CHECK (state IN ('queued','running','done','failed')),
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    result_json TEXT,
    error_json TEXT
  );
  CREATE INDEX idx_extraction_jobs_save ON extraction_jobs(save_id,id);
  CREATE TABLE action_transitions (
    id INTEGER PRIMARY KEY,
    action_id INTEGER NOT NULL REFERENCES actions(id),
    previous_status TEXT NOT NULL,
    next_status TEXT NOT NULL,
    previous_done_at TEXT,
    changed_at TEXT NOT NULL,
    undone_at TEXT
  );
  `,


  // v6. Optional idempotent screenshot imports, scoped to this local workspace.
  `
  ALTER TABLE saves ADD COLUMN import_key TEXT;
  ALTER TABLE saves ADD COLUMN import_hash TEXT;
  CREATE UNIQUE INDEX idx_saves_import_key ON saves(import_key) WHERE import_key IS NOT NULL;
  `,

];

export const SCHEMA_VERSION = MIGRATIONS.length;

export function openDb(dbPath) {
  if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  seed(db);
  return db;
}

function migrate(db) {
  const current = db.pragma("user_version", { simple: true });
  if (current >= MIGRATIONS.length) return;
  // Table rebuilds need foreign keys off. They are switched back on after a foreign_key_check.
  db.pragma("foreign_keys = OFF");
  try {
    for (let v = current; v < MIGRATIONS.length; v++) {
      db.transaction(() => {
        db.exec(MIGRATIONS[v]);
        db.pragma(`user_version = ${v + 1}`);
      })();
    }
    const violations = db.pragma("foreign_key_check");
    if (violations.length) throw new Error(`foreign key violations after migration: ${JSON.stringify(violations)}`);
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

function seed(db) {
  const hasGoals = db.prepare("SELECT COUNT(*) AS n FROM goals").get().n > 0;
  if (!hasGoals) {
    const insert = db.prepare("INSERT INTO goals (name, position) VALUES (?, ?)");
    PRESET_GOALS.forEach((name, i) => insert.run(name, i));
  }
  const upsert = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) upsert.run(k, v);
}

export function schemaVersion(db) {
  return db.pragma("user_version", { simple: true });
}

export function getSettings(db) {
  const out = {};
  for (const row of db.prepare("SELECT key, value FROM settings").all()) out[row.key] = row.value;
  return {
    workStart: out.work_start,
    workEnd: out.work_end,
    tz: out.tz ?? null,
    ignoreAllDay: out.ignore_all_day !== "0",
  };
}

export function saveSettings(db, { workStart, workEnd, tz, ignoreAllDay }) {
  const set = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  db.transaction(() => {
    set.run("work_start", workStart);
    set.run("work_end", workEnd);
    set.run("tz", tz ?? null);
    if (typeof ignoreAllDay === "boolean") set.run("ignore_all_day", ignoreAllDay ? "1" : "0");
  })();
  return getSettings(db);
}

export function listGoals(db) {
  return db.prepare("SELECT id, name FROM goals ORDER BY position").all();
}

export function renameGoal(db, id, name) {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) return null;
  const res = db.prepare("UPDATE goals SET name = ? WHERE id = ?").run(trimmed, id);
  return res.changes ? { id, name: trimmed } : null;
}

export function loadTokens(db) {
  const row = db.prepare("SELECT tokens_json FROM oauth_tokens WHERE id = 1").get();
  return row ? JSON.parse(row.tokens_json) : null;
}

export function storeTokens(db, tokens) {
  db.prepare(
    `INSERT INTO oauth_tokens (id, tokens_json, updated_at) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET tokens_json = excluded.tokens_json, updated_at = excluded.updated_at`,
  ).run(JSON.stringify(tokens), new Date().toISOString());
}

export function clearTokens(db) {
  db.prepare("DELETE FROM oauth_tokens WHERE id = 1").run();
}

// The connected Google account's email. The token has no profile scope, so it is read once from the primary
// calendar and cached here. Cleared on disconnect and on reconnect, because another account may sign in.
export const getGoogleEmail = (db) => db.prepare("SELECT value FROM settings WHERE key = 'google_email'").get()?.value ?? null;
export const setGoogleEmail = (db, email) =>
  db.prepare("INSERT INTO settings (key, value) VALUES ('google_email', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(email);
export const clearGoogleEmail = (db) => db.prepare("DELETE FROM settings WHERE key = 'google_email'").run();
