// Loads the 14 illustrative demo saves (fixtures/demo/01.png to 14.png) into one account workspace.
// No model call and no credits: it copies the already extracted saves from server/data/backups/seeded.db.
// Make that snapshot once with: node scripts/seed-demo.mjs
//
// Run:   node scripts/load-demo-saves.mjs                      (the only account, or pick one below)
//        node scripts/load-demo-saves.mjs --email you@gmail.com
//        node scripts/load-demo-saves.mjs --workspace <workspace_key>
//        node scripts/load-demo-saves.mjs --remove             (takes the demo saves out again)
// Stop the server first, it holds the workspace database.
//
// Safety:
// - Only rows with is_demo = 1 and a demo-seed-NN.png key are copied. Any other save in the snapshot is ignored.
// - Saves are marked as demo data. Effort stays unconfirmed, nothing is done, planned or scheduled.
// - Never touches Google Calendar. Saves already loaded are skipped, so a second run changes nothing.
// - Backs up the workspace database first to server/data/backups/before-demo-load-<time>.db.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { config } from "../server/src/config.js";
import { openDb } from "../server/src/db.js";
import { ROOT, SEEDED_SNAPSHOT, backupDb, serverIsRunning } from "./lib/demo-db.mjs";

const Database = createRequire(path.join(ROOT, "server", "package.json"))("better-sqlite3");
const fail = (msg) => { console.error(msg); process.exit(1); };
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : null; };
const remove = process.argv.includes("--remove");

if (await serverIsRunning(config.port)) fail(`A server is running on port ${config.port}. Stop it first. Nothing was changed.`);

// 1. Find the workspace.
const centralFile = path.join(config.dataDir, "central.sqlite");
if (!fs.existsSync(centralFile)) fail(`No accounts yet (${path.relative(ROOT, centralFile)} is missing). Sign in once in the app first.`);
const central = new Database(centralFile, { readonly: true });
const accounts = central.prepare("SELECT email, name, workspace_key FROM accounts WHERE kind != 'demo' ORDER BY id").all();
central.close();
const wanted = accounts.filter((a) => (arg("workspace") ? a.workspace_key === arg("workspace") : arg("email") ? a.email.toLowerCase() === arg("email").toLowerCase() : true));
if (wanted.length !== 1) {
  fail(`${wanted.length ? "Several accounts" : "No matching account"}. Pick one with --email or --workspace:\n${accounts.map((a) => `  ${a.email}  ${a.workspace_key}`).join("\n")}`);
}
const account = wanted[0];
const folder = path.join(config.dataDir, "workspaces", account.workspace_key);
if (!fs.existsSync(path.join(folder, "db.sqlite"))) fail(`Workspace ${account.workspace_key} has no database yet. Open the app once as ${account.email}, then retry.`);
const shotDir = path.join(folder, "screenshots");
console.log(`Account: ${account.email} (${account.workspace_key})`);

const db = openDb(path.join(folder, "db.sqlite"));
console.log(`Backup: ${path.relative(ROOT, backupDb(db, "before-demo-load"))}`);

// 2. Remove mode.
if (remove) {
  const demo = db.prepare("SELECT s.id, s.screenshot_path, (SELECT COUNT(*) FROM blocks b JOIN actions a ON a.id = b.action_id WHERE a.save_id = s.id) AS blocks FROM saves s WHERE s.is_demo = 1").all();
  const booked = demo.filter((s) => s.blocks > 0);
  if (booked.length) fail(`${booked.length} demo save(s) have calendar blocks. Not removing anything. Cancel those blocks in the app first.`);
  db.transaction(() => {
    for (const s of demo) { db.prepare("DELETE FROM actions WHERE save_id = ?").run(s.id); db.prepare("DELETE FROM saves WHERE id = ?").run(s.id); }
  })();
  for (const s of demo) fs.rmSync(path.join(shotDir, s.screenshot_path), { force: true });
  console.log(`Removed ${demo.length} demo saves.`);
  db.close();
  process.exit(0);
}

// 3. Read the demo saves from the snapshot.
if (!fs.existsSync(SEEDED_SNAPSHOT)) fail(`${path.relative(ROOT, SEEDED_SNAPSHOT)} is missing. Create it once with: node scripts/seed-demo.mjs`);
const src = new Database(SEEDED_SNAPSHOT, { readonly: true });
const saves = src.prepare("SELECT * FROM saves WHERE is_demo = 1 AND import_key GLOB 'demo-seed-[0-9][0-9].png' ORDER BY import_key").all();
if (saves.length !== 14) fail(`Expected 14 demo saves in the snapshot, found ${saves.length}. Nothing was changed.`);
const srcGoals = new Map(src.prepare("SELECT id, name FROM goals").all().map((g) => [g.id, g.name]));
const dstGoals = new Map(db.prepare("SELECT id, name FROM goals").all().map((g) => [g.name, g.id]));
const actionCols = db.prepare("PRAGMA table_info(actions)").all().map((c) => c.name).filter((c) => c !== "id");

// 4. Copy them.
fs.mkdirSync(shotDir, { recursive: true });
const have = new Set(db.prepare("SELECT import_key FROM saves WHERE import_key IS NOT NULL").all().map((r) => r.import_key));
const insertSave = db.prepare("INSERT INTO saves (screenshot_path, note, imported_at, is_demo, import_key, import_hash) VALUES (?, ?, ?, 1, ?, ?)");
const insertAction = db.prepare(`INSERT INTO actions (${actionCols.join(", ")}) VALUES (${actionCols.map((c) => `@${c}`).join(", ")})`);
const now = Date.now();
let added = 0;
db.transaction(() => {
  saves.forEach((s, i) => {
    if (have.has(s.import_key)) return;
    const action = src.prepare("SELECT * FROM actions WHERE save_id = ?").get(s.id);
    if (!action) return;
    // Screenshot: the stored file from the seed run, else the original fixture.
    const stored = path.join(ROOT, "server", "data", "screenshots", s.screenshot_path);
    const fixture = path.join(ROOT, "fixtures", "demo", s.import_key.replace("demo-seed-", ""));
    const from = [stored, fixture].find((f) => fs.existsSync(f));
    if (!from) throw new Error(`No screenshot found for ${s.import_key}`);
    const file = `${path.basename(s.screenshot_path, path.extname(s.screenshot_path))}${path.extname(from)}`;
    fs.copyFileSync(from, path.join(shotDir, file));
    // Imported oldest first, a few seconds apart, so the list keeps the fixture order.
    const savedAt = new Date(now - (saves.length - i) * 5000).toISOString();
    const saveId = insertSave.run(file, s.note ?? "", savedAt, s.import_key, s.import_hash).lastInsertRowid;
    const row = { ...action, save_id: saveId, goal_id: dstGoals.get(srcGoals.get(action.goal_id)) ?? null, status: "open", done_at: null, confirmed_effort_min: null, created_at: savedAt, updated_at: savedAt };
    insertAction.run(Object.fromEntries(actionCols.map((c) => [c, row[c] ?? null])));
    added += 1;
  });
})();
src.close();

const total = db.prepare("SELECT COUNT(*) AS n FROM saves WHERE is_demo = 1").get().n;
const blocks = db.prepare("SELECT COUNT(*) AS n FROM blocks").get().n;
console.log(`Added ${added} demo saves, ${saves.length - added} were already there. Demo saves in this workspace: ${total}. Calendar blocks: ${blocks}. Calendar calls: 0.`);
db.close();
