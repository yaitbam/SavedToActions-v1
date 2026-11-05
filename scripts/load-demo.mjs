// Fills the shared demo account that the "Explore the demo" button opens, with the screenshots in fixtures/demo/.
//
// Run:  node scripts/load-demo.mjs          load the demo (replays the recorded answers when fixtures/demo/extracted.json exists)
//       node scripts/load-demo.mjs live     read the screenshots with the configured model and record the answers
//       node scripts/load-demo.mjs reset    remove the demo account and its saves, to load it again from nothing
//       node scripts/load-demo.mjs account you@gmail.com [live]
//                                           put the same saves into your own signed in account instead of the shared demo
//
// How it works:
// - Each screenshot goes through the app's own POST /api/saves, so extraction and validation are the real ones.
// - With a recording, the model call is answered from fixtures/demo/extracted.json. No key, no credits, no network.
//   Without one, the configured model reads the screenshots (needs BASETEN_API_KEY, or META_API_KEY with MODEL_PROVIDER=meta),
//   and the answers are saved to fixtures/demo/extracted.json so the next run needs no key.
// - It uses the same DATA_DIR as the server (from .env). Loading twice does not duplicate saves.
// - It never touches Google Calendar and never charges a credit. The demo account is read only for visitors.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../server/src/config.js";
import { createRecordingProvider, createReplayProvider, listDemoImages, loadDemoSaves, removeDemo } from "../server/src/demo/loadDemo.js";
import { createProvider } from "../server/src/model/provider.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "fixtures", "demo");
const RECORDING = path.join(DIR, "extracted.json");
const NOTES = path.join(DIR, "notes.json");
const args = process.argv.slice(2);
const target = args[0] === "account" ? "account" : "demo";
const email = target === "account" ? args[1] : null;
const mode = target === "account" ? (args[2] ?? "") : (args[0] ?? "");

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

if (mode === "reset") {
  console.log(removeDemo(config) ? `Removed the demo account and its saves from ${config.dataDir}.` : "There is no demo account to remove.");
  process.exit(0);
}
if (target === "account" && !email) fail("Give the email of the account: node scripts/load-demo.mjs account you@gmail.com");
if (mode && mode !== "live") fail(`Unknown option "${mode}". Use no option, live or reset. For your own account use: account you@gmail.com [live].`);

const files = listDemoImages(DIR);
if (!files.length) fail(`No screenshots found in ${path.relative(ROOT, DIR)}.`);

const replay = mode !== "live" && fs.existsSync(RECORDING);
let provider;
if (replay) {
  const recording = JSON.parse(fs.readFileSync(RECORDING, "utf8"));
  provider = createReplayProvider(recording);
  console.log(`Replaying recorded answers from ${path.relative(ROOT, RECORDING)} (model ${recording.model}). No key and no credits are used.`);
} else {
  const live = createProvider(config.model);
  if (!live.configured()) {
    const key = live.name === "meta" ? "META_API_KEY (or MODEL_API_KEY)" : "BASETEN_API_KEY";
    fail(`${mode === "live" ? "A live read was requested" : "There is no recording at fixtures/demo/extracted.json"}, so the model must read the screenshots, and ${key} is not set. Set it in .env and run again.`);
  }
  provider = createRecordingProvider(live);
  console.log(`Reading ${files.length} screenshots with ${live.name} ${live.model}. This takes a few seconds each.`);
}

const notes = fs.existsSync(NOTES) ? JSON.parse(fs.readFileSync(NOTES, "utf8")) : {};
const { results } = await loadDemoSaves({ config, provider, files, notes, email }).catch((error) => fail(error.message));
if (replay && provider.stale.length) {
  console.log(`\nThe recording was made with different notes for: ${provider.stale.join(", ")}.\nTo record answers that use fixtures/demo/notes.json, ${target === "account" ? "load into an account that does not have these saves yet, adding" : 'run "node scripts/load-demo.mjs reset" and then'} "live".`);
}

const pad = (value, n) => String(value ?? "").padEnd(n).slice(0, n);
for (const r of results) console.log(`${pad(r.file, 12)} ${pad(r.status, 15)} ${r.status === "failed" ? r.error : r.title ?? "(no title)"}`);
const failed = results.filter((r) => r.status === "failed");
const loaded = results.filter((r) => r.status === "loaded");
console.log(`\n${results.length - failed.length} of ${results.length} saves are in ${target === "account" ? "your" : "the demo"} account (${loaded.length} added now).`);

if (!replay) {
  const answers = provider.answers;
  if (Object.keys(answers).length === files.length && !failed.length) {
    fs.writeFileSync(RECORDING, JSON.stringify({ recordedAt: new Date().toISOString(), provider: provider.name, model: provider.model, files: answers }, null, 2) + "\n");
    console.log(`Saved the model answers to ${path.relative(ROOT, RECORDING)}. Commit it so others can load the demo without a key.`);
  } else if (!failed.length) {
    console.log("Some screenshots were already loaded and were not read again, so nothing was recorded. Run reset, then live, to record.");
  }
}
if (failed.some((r) => r.error === "idempotency_conflict")) fail("Some screenshots were loaded earlier with a different note. Run \"node scripts/load-demo.mjs reset\" and load again.");
if (failed.length) fail(`${failed.length} screenshot(s) failed. Run the command again to retry them.`);
console.log(target === "account" ? `Start the app and sign in as ${email}. The saves are in Saved, labeled as imported demo data.` : "Start the app and choose Explore the demo on the login page.");
