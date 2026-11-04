import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

// General goals offered to every user. Broad on purpose, so most saves match one of them.
// The first three are what a new workspace starts with.
export const STARTER_GOALS = Object.freeze([
  { name: "Earn more", description: "Freelance work, side income, grants, prizes" },
  { name: "Learn a skill", description: "Courses, tutorials, tools and prompts to try" },
  { name: "Events and opportunities", description: "Hackathons, programs, applications, meetups" },
  { name: "Career growth", description: "Jobs, networking, portfolio, professional development" },
  { name: "Health and wellbeing", description: "Fitness, nutrition, sleep, mental health" },
  { name: "Create and build", description: "Content, projects, writing, design" },
  { name: "Travel and experiences", description: "Trips, places, things to do" },
  { name: "Home and family", description: "Household, relationships, personal errands" },
].map((goal) => Object.freeze(goal)));

export const PRESET_GOALS = STARTER_GOALS.slice(0, 3).map((goal) => goal.name);

export const MAX_ACTIVE_GOALS = 6;
// Colors are palette slots, matched by the goal color classes in the web app.
export const GOAL_COLOR_SLOTS = 6;
const GOAL_NAME_MAX = 40;
const GOAL_DESCRIPTION_MAX = 120;

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

  // v7. Goals belong to the user: a description that guides extraction, a color slot, and archiving
  // instead of deleting, so past saves and progress keep their goal. Existing goals keep their look.
  `
  ALTER TABLE goals ADD COLUMN description TEXT;
  ALTER TABLE goals ADD COLUMN color INTEGER;
  ALTER TABLE goals ADD COLUMN archived_at TEXT;
  UPDATE goals SET color = (id - 1) % 6 WHERE color IS NULL;
  UPDATE goals SET description = 'Freelance work, side income, grants, prizes' WHERE name = 'Earn more' AND description IS NULL;
  UPDATE goals SET description = 'Courses, tutorials, tools and prompts to try' WHERE name = 'Learn a skill' AND description IS NULL;
  UPDATE goals SET description = 'Hackathons, programs, applications, meetups' WHERE name = 'Events and opportunities' AND description IS NULL;
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

/** Gives an empty workspace the three starting goals. Does nothing when goals already exist. */
export function seedGoals(db) {
  if (db.prepare("SELECT COUNT(*) AS n FROM goals").get().n > 0) return;
  const insert = db.prepare("INSERT INTO goals (name, description, color, position) VALUES (?, ?, ?, ?)");
  STARTER_GOALS.slice(0, 3).forEach((goal, i) => insert.run(goal.name, goal.description, i, i));
}

function seed(db) {
  seedGoals(db);
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

export class GoalError extends Error {
  constructor(status, code, detail) {
    super(code);
    this.name = "GoalError";
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

function goalRow(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    color: row.color ?? (row.id - 1) % GOAL_COLOR_SLOTS,
    archived: row.archived_at != null,
    position: row.position,
  };
}

/** Active goals in the user's order. With includeArchived, archived goals follow, so old saves still resolve a name. */
export function listGoals(db, { includeArchived = false } = {}) {
  const rows = db.prepare(
    `SELECT id, name, description, color, archived_at, position FROM goals
     ${includeArchived ? "" : "WHERE archived_at IS NULL"}
     ORDER BY archived_at IS NOT NULL, position, id`,
  ).all();
  return rows.map(goalRow);
}

function cleanText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function checkName(db, name, exceptId = null) {
  const clean = cleanText(name);
  if (!clean) throw new GoalError(400, "invalid_goal_or_name", "Give the goal a name.");
  if (clean.length > GOAL_NAME_MAX) throw new GoalError(400, "goal_name_too_long", `Use ${GOAL_NAME_MAX} characters or fewer.`);
  const clash = db.prepare("SELECT id, archived_at FROM goals WHERE LOWER(name) = LOWER(?) AND id IS NOT ?").get(clean, exceptId);
  if (clash) {
    throw new GoalError(409, "goal_name_exists", clash.archived_at ? "An archived goal has this name. Restore it instead." : "You already have a goal with this name.");
  }
  return clean;
}

function checkDescription(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new GoalError(400, "invalid_goal_description", "Use plain text.");
  const clean = cleanText(value);
  if (clean.length > GOAL_DESCRIPTION_MAX) throw new GoalError(400, "goal_description_too_long", `Use ${GOAL_DESCRIPTION_MAX} characters or fewer.`);
  return clean || null;
}

function activeCount(db) {
  return db.prepare("SELECT COUNT(*) AS n FROM goals WHERE archived_at IS NULL").get().n;
}

function nextColor(db) {
  const used = new Set(db.prepare("SELECT color FROM goals WHERE archived_at IS NULL").all().map((r) => r.color));
  for (let slot = 0; slot < GOAL_COLOR_SLOTS; slot++) if (!used.has(slot)) return slot;
  return 0;
}

function loadGoal(db, id) {
  const row = db.prepare("SELECT id, name, description, color, archived_at, position FROM goals WHERE id = ?").get(id);
  return row ? goalRow(row) : null;
}

export function createGoal(db, { name, description } = {}) {
  const clean = checkName(db, name);
  const desc = checkDescription(description);
  if (activeCount(db) >= MAX_ACTIVE_GOALS) {
    throw new GoalError(409, "goal_limit_reached", `You can have ${MAX_ACTIVE_GOALS} active goals. Archive one to add another.`);
  }
  const position = (db.prepare("SELECT MAX(position) AS p FROM goals WHERE archived_at IS NULL").get().p ?? -1) + 1;
  const res = db.prepare("INSERT INTO goals (name, description, color, position) VALUES (?, ?, ?, ?)").run(clean, desc, nextColor(db), position);
  return loadGoal(db, Number(res.lastInsertRowid));
}

/** Changes the fields that are present. Returns null for an unknown goal. */
export function updateGoal(db, id, patch = {}) {
  const current = loadGoal(db, id);
  if (!current) return null;
  const set = {};
  if ("name" in patch) set.name = checkName(db, patch.name, id);
  if ("description" in patch) set.description = checkDescription(patch.description);
  if ("color" in patch) {
    if (!Number.isInteger(patch.color) || patch.color < 0 || patch.color >= GOAL_COLOR_SLOTS) {
      throw new GoalError(400, "invalid_goal_color", "Choose one of the colors.");
    }
    set.color = patch.color;
  }
  const keys = Object.keys(set);
  if (!keys.length) throw new GoalError(400, "invalid_goal_or_name", "Send a name, description or color.");
  db.prepare(`UPDATE goals SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...keys.map((k) => set[k]), id);
  return loadGoal(db, id);
}

/** Archived goals keep their saves and history. Open actions are not reassigned. */
export function archiveGoal(db, id) {
  const goal = loadGoal(db, id);
  if (!goal) return null;
  if (goal.archived) return goal;
  if (activeCount(db) <= 1) throw new GoalError(409, "last_active_goal", "Keep at least one active goal.");
  db.prepare("UPDATE goals SET archived_at = ? WHERE id = ?").run(new Date().toISOString(), id);
  return loadGoal(db, id);
}

export function restoreGoal(db, id) {
  const goal = loadGoal(db, id);
  if (!goal) return null;
  if (!goal.archived) return goal;
  if (activeCount(db) >= MAX_ACTIVE_GOALS) {
    throw new GoalError(409, "goal_limit_reached", `You can have ${MAX_ACTIVE_GOALS} active goals. Archive one to restore this one.`);
  }
  const position = (db.prepare("SELECT MAX(position) AS p FROM goals WHERE archived_at IS NULL").get().p ?? -1) + 1;
  db.prepare("UPDATE goals SET archived_at = NULL, position = ?, color = ? WHERE id = ?").run(position, nextColor(db), id);
  return loadGoal(db, id);
}

/** ids must be exactly the active goals, in the new order. */
export function reorderGoals(db, ids) {
  const active = db.prepare("SELECT id FROM goals WHERE archived_at IS NULL").all().map((r) => r.id);
  const valid = Array.isArray(ids) && ids.length === active.length && new Set(ids).size === ids.length && ids.every((id) => active.includes(id));
  if (!valid) throw new GoalError(400, "invalid_goal_order", "Send every active goal once.");
  const set = db.prepare("UPDATE goals SET position = ? WHERE id = ?");
  db.transaction(() => ids.forEach((id, position) => set.run(position, id)))();
  return listGoals(db);
}

/** Kept for older callers that only rename. */
export function renameGoal(db, id, name) {
  try {
    const goal = updateGoal(db, id, { name });
    return goal ? { id: goal.id, name: goal.name } : null;
  } catch (err) {
    if (err instanceof GoalError) return null;
    throw err;
  }
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
