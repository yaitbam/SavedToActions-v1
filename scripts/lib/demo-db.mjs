// Shared by seed-demo.mjs and demo-reset.mjs. Local database only. Nothing here talks to Google.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const BACKUP_DIR = path.join(ROOT, "server", "data", "backups");
export const SEEDED_SNAPSHOT = path.join(BACKUP_DIR, "seeded.db");
export const MANIFEST = path.join(ROOT, "fixtures", "demo", "manifest.json");

// Same ids as the old presets, new names (rebuild plan section 2). Matched by position, ids are kept.
export const GOAL_NAMES = ["Earn more", "Learn a skill", "Don't miss deadlines"];

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

/** Consistent copy of a live database, WAL included. Returns the file path. */
export function backupDb(db, label) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const file = path.join(BACKUP_DIR, `${label}-${stamp()}.db`);
  db.prepare("VACUUM INTO ?").run(file);
  return file;
}

/** The snapshot demo-reset restores. Overwrites the previous one. */
export function writeSeededSnapshot(db) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  fs.rmSync(SEEDED_SNAPSHOT, { force: true });
  db.prepare("VACUUM INTO ?").run(SEEDED_SNAPSHOT);
  return SEEDED_SNAPSHOT;
}

/** Rename the three goals by position and keep their ids. Returns the goals after. */
export function renameGoalsToPresets(db) {
  const rows = db.prepare("SELECT id FROM goals ORDER BY position").all();
  if (rows.length !== GOAL_NAMES.length) throw new Error(`Expected ${GOAL_NAMES.length} goals, found ${rows.length}. Not renaming.`);
  const set = db.prepare("UPDATE goals SET name = ? WHERE id = ?");
  db.transaction(() => rows.forEach((r, i) => set.run(GOAL_NAMES[i], r.id)))();
  return db.prepare("SELECT id, name FROM goals ORDER BY position").all();
}

/** True when a server answers on the port. A running server holds the database open, so the scripts refuse then. */
export async function serverIsRunning(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(800) });
    return res.ok;
  } catch {
    return false;
  }
}
