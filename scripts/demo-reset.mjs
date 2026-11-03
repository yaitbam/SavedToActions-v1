// Puts the local database back to the state seed-demo.mjs left it in (server/data/backups/seeded.db).
//
// Run: node scripts/demo-reset.mjs [snapshot.db]   (stop the server first, it holds the database)
// With no argument it restores the seeded snapshot. Pass a backup file to restore that one instead.
//
// What it does:
// - Backs up the current database first to server/data/backups/before-reset-<time>.db.
// - Replaces goals, saves, actions, blocks, checks, traces, extraction jobs and transitions with the snapshot rows.
// - Keeps settings, the Google connection and the connected account as they are.
// - Deletes screenshot files of saves made after the snapshot, and nothing else.
// What it never does: talk to Google Calendar. Events a demo run created stay on the calendar, delete them by hand.
import fs from "node:fs";
import path from "node:path";
import { config } from "../server/src/config.js";
import { openDb, schemaVersion } from "../server/src/db.js";
import { ROOT, SEEDED_SNAPSHOT, backupDb, serverIsRunning } from "./lib/demo-db.mjs";

const SNAPSHOT = process.argv[2] ? path.resolve(process.argv[2]) : SEEDED_SNAPSHOT;

const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

if (!fs.existsSync(SNAPSHOT)) fail(`No snapshot at ${SNAPSHOT}. Run node scripts/seed-demo.mjs first. Nothing was changed.`);
if (await serverIsRunning(config.port)) fail(`A server is running on port ${config.port}. Stop it first. Nothing was changed.`);

// Children first when deleting, parents first when inserting.
const TABLES = ["action_transitions", "checks", "agent_traces", "blocks", "extraction_jobs", "actions", "saves", "goals"];

const db = openDb(config.dbPath);
db.prepare("ATTACH DATABASE ? AS snap").run(SNAPSHOT);
if (db.pragma("snap.user_version", { simple: true }) !== schemaVersion(db)) fail("The snapshot was made by another schema version. Run seed-demo.mjs again. Nothing was changed.");

console.log(`Backup: ${path.relative(ROOT, backupDb(db, "before-reset"))}`);
const before = new Set(db.prepare("SELECT screenshot_path AS f FROM saves").all().map((r) => r.f));
const kept = new Set(db.prepare("SELECT screenshot_path AS f FROM snap.saves").all().map((r) => r.f));

db.pragma("foreign_keys = OFF");
try {
  db.transaction(() => {
    for (const t of TABLES) db.prepare(`DELETE FROM main.${t}`).run();
    for (const t of [...TABLES].reverse()) db.prepare(`INSERT INTO main.${t} SELECT * FROM snap.${t}`).run();
  })();
  const broken = db.pragma("foreign_key_check");
  if (broken.length) fail(`Foreign key problems after reset: ${JSON.stringify(broken)}`);
} finally {
  db.pragma("foreign_keys = ON");
}

let removed = 0;
for (const f of before) {
  if (!f || kept.has(f) || !/^[0-9a-f-]{36}\.(png|jpg|webp)$/.test(f)) continue;
  fs.rmSync(path.join(config.screenshotDir, f), { force: true });
  removed += 1;
}

const count = (t) => db.prepare(`SELECT COUNT(*) AS n FROM main.${t}`).get().n;
console.log(`Goals: ${db.prepare("SELECT id, name FROM goals ORDER BY position").all().map((g) => `${g.id} ${g.name}`).join(", ")}`);
console.log(`Restored: ${count("saves")} saves (${db.prepare("SELECT COUNT(*) AS n FROM saves WHERE is_demo = 1").get().n} demo), ${count("actions")} actions, ${count("blocks")} blocks. Removed ${removed} screenshot files.`);
console.log("Google Calendar was not touched. Events from a demo run stay on the calendar, delete them by hand.");
db.close();
