// Imports fixtures/demo/01.png to 14.png through the real pipeline (the app's own POST /api/saves, the real
// Muse Spark Open call) and marks every save as demo data. Then it prints a report against manifest.json.
//
// Run: node scripts/seed-demo.mjs        (stop the server first, it holds the database)
//
// Safety:
// - Backs up the database first to server/data/backups/before-seed-<time>.db (gitignored).
// - Renames the three goals to the new presets and keeps their ids.
// - Never touches Google Calendar: the calendar given to the app is a stub that throws and counts any call.
//   Nothing is confirmed, proposed, approved or scheduled. Effort stays unconfirmed.
// - flyer.png is skipped on purpose. Only files named NN.png in the manifest are imported.
// - Saves are idempotent by key (demo-seed-NN.png), so a second run replays instead of calling the model again.
// - When all 14 extracted, the result is saved as server/data/backups/seeded.db for scripts/demo-reset.mjs.
import fs from "node:fs";
import path from "node:path";
import { config } from "../server/src/config.js";
import { createApp } from "../server/src/app.js";
import { openDb } from "../server/src/db.js";
import { createProvider } from "../server/src/model/provider.js";
import { runSelfTest } from "../server/src/tz.js";
import { compareToManifest } from "./lib/demo-compare.mjs";
import { MANIFEST, ROOT, backupDb, renameGoalsToPresets, serverIsRunning, writeSeededSnapshot } from "./lib/demo-db.mjs";

const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

if (!config.model.baseten.apiKey) fail("BASETEN_API_KEY is not set in .env. Nothing was changed.");
if (await serverIsRunning(config.port)) fail(`A server is running on port ${config.port}. Stop it first. Nothing was changed.`);
runSelfTest();

const entries = JSON.parse(fs.readFileSync(MANIFEST, "utf8")).filter((e) => /^\d\d\.png$/.test(e.file));
if (entries.length !== 14) fail(`Expected 14 numbered files in the manifest, found ${entries.length}.`);
for (const e of entries) if (!fs.existsSync(path.join(ROOT, "fixtures", "demo", e.file))) fail(`Missing fixtures/demo/${e.file}.`);

const db = openDb(config.dbPath);
console.log(`Backup: ${path.relative(ROOT, backupDb(db, "before-seed"))}`);
const goals = renameGoalsToPresets(db);
console.log(`Goals: ${goals.map((g) => `${g.id} ${g.name}`).join(", ")}`);
const blocksBefore = db.prepare("SELECT COUNT(*) AS n FROM blocks").get().n;

// Any calendar call is a bug in this script. It throws and is counted.
let calendarCalls = 0;
const calendar = new Proxy({}, { get: (_t, name) => () => { calendarCalls += 1; throw new Error(`calendar.${String(name)} called by the seed script`); } });
const googleAuth = { configured: () => false, status: () => ({ connected: false, missingScopes: [] }) };
const app = createApp({ db, config, googleAuth, selfTest: { ok: true }, provider: createProvider(config.model), calendar });
const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
const base = `http://127.0.0.1:${server.address().port}`;

async function importOne(file) {
  const form = new FormData();
  form.append("image", new Blob([fs.readFileSync(path.join(ROOT, "fixtures", "demo", file))], { type: "image/png" }), file);
  const headers = { "Idempotency-Key": `demo-seed-${file}` };
  let res = await fetch(`${base}/api/saves`, { method: "POST", body: form, headers });
  let body = await res.json();
  // A save whose model call failed earlier is retried on the same save, the screenshot is not uploaded again.
  if (res.status === 409 && body.error === "previous_extraction_failed") {
    res = await fetch(`${base}/api/saves/${body.saveId}/extract`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    body = await res.json();
  }
  return { ok: res.ok, status: res.status, body };
}

const rows = [];
for (const entry of entries) {
  const t0 = performance.now();
  const out = await importOne(entry.file);
  const wallMs = Math.round(performance.now() - t0);
  let action = null;
  const saveId = out.body.saveId ?? null;
  if (out.ok && saveId) {
    db.prepare("UPDATE saves SET is_demo = 1 WHERE id = ?").run(saveId);
    action = await (await fetch(`${base}/api/saves/${saveId}`)).json().then((s) => s.action);
  }
  const cmp = out.ok ? compareToManifest(entry, action, goals) : null;
  rows.push({ entry, saveId, wallMs, modelMs: out.body.extraction?.ms ?? null, replayed: Boolean(out.body.replayed), error: out.ok ? null : (out.body.error ?? `http_${out.status}`), cmp });
  console.log(`${entry.file} ${out.ok ? "done" : `FAILED ${rows.at(-1).error}`} in ${(wallMs / 1000).toFixed(1)} s`);
}
await new Promise((resolve) => server.close(resolve));

// Report.
const pad = (v, n) => String(v ?? "").padEnd(n).slice(0, n);
console.log("\nfile   time    goal (expected | got)                         deadline (expected | got)                          result");
for (const r of rows) {
  const c = r.cmp;
  const time = `${(r.wallMs / 1000).toFixed(1)} s${r.replayed ? " r" : ""}`;
  if (!c) {
    console.log(`${pad(r.entry.file, 6)} ${pad(time, 7)} ${pad("", 44)}  ${pad("", 48)}  FAILED ${r.error}`);
    continue;
  }
  const goal = `${c.goal.expected ?? "Missing"} | ${c.goal.got ?? "Missing"}`;
  const deadline = `${c.deadline.expected} | ${c.deadline.got}`;
  console.log(`${pad(r.entry.file, 6)} ${pad(time, 7)} ${pad(goal, 44)}  ${pad(deadline, 48)}  ${c.ok ? "ok" : "MISMATCH"}${c.deadline.note ? ` (${c.deadline.note})` : ""}`);
}
const failed = rows.filter((r) => r.error);
const mismatched = rows.filter((r) => r.cmp && !r.cmp.ok);
const goalWrong = rows.filter((r) => r.cmp && !r.cmp.goal.ok).length;
const deadlineWrong = rows.filter((r) => r.cmp && !r.cmp.deadline.ok).length;
const live = rows.filter((r) => !r.replayed && r.modelMs != null);
const sum = (list, key) => list.reduce((a, r) => a + r[key], 0);
console.log(`\nImported ${rows.length - failed.length} of ${rows.length}. Failed ${failed.length}. Goal mismatches ${goalWrong}. Deadline mismatches ${deadlineWrong}.`);
if (live.length) console.log(`Time per file: wall ${(sum(live, "wallMs") / live.length / 1000).toFixed(1)} s on average, model ${(sum(live, "modelMs") / live.length / 1000).toFixed(1)} s. Total wall ${(sum(live, "wallMs") / 1000).toFixed(0)} s. "r" marks a replay (no model call).`);
if (mismatched.length) console.log(`Mismatched files: ${mismatched.map((r) => r.entry.file).join(", ")}`);

const blocksAfter = db.prepare("SELECT COUNT(*) AS n FROM blocks").get().n;
console.log(`Calendar calls: ${calendarCalls}. Blocks before ${blocksBefore}, after ${blocksAfter}. Demo saves in database: ${db.prepare("SELECT COUNT(*) AS n FROM saves WHERE is_demo = 1").get().n}.`);
if (calendarCalls || blocksAfter !== blocksBefore) fail("Unexpected calendar call or block. Do not use this database.");
if (failed.length) {
  console.log("Seeded snapshot NOT written because some files failed. Run the script again to retry them.");
} else {
  console.log(`Seeded snapshot: ${path.relative(ROOT, writeSeededSnapshot(db))}`);
}
db.close();
