// The shared demo account and the loader that fills it.
//
// The demo account (kind "demo") is what the "Explore the demo" button opens. Its workspace is read only for visitors:
// every write answers 403 demo_readonly and its credit limit is 0, so it can never reach the model or a calendar.
// Nothing is written by hand here. Screenshots go through the app's own POST /api/saves, so extraction, normalization
// and the stored records are exactly what a signed in user would get. The model call is either a live one or a
// replay of an answer that was recorded from a live run.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createApp } from "../app.js";
import { openAccounts } from "../auth/store.js";
import { openDb } from "../db.js";
import { ModelError } from "../model/provider.js";
import { runSelfTest } from "../tz.js";

export const DEMO_EMAIL = "demo@savedtoaction.invalid";

export const findDemoAccount = (db) => db.prepare("SELECT * FROM accounts WHERE kind = 'demo'").get() ?? null;

/** The one shared demo account. Created on first use, never given a Google identity or a calendar. */
export function ensureDemoAccount(db, now = Date.now()) {
  const existing = findDemoAccount(db);
  if (existing) return existing;
  const info = db
    .prepare("INSERT INTO accounts(google_sub,email,name,kind,workspace_key,profile_completed_at,created_at) VALUES (NULL,?,?,?,?,?,?)")
    .run(DEMO_EMAIL, "Demo workspace", "demo", crypto.randomUUID(), now, now);
  return db.prepare("SELECT * FROM accounts WHERE id = ?").get(info.lastInsertRowid);
}

export const demoWorkspaceDir = (config, account) => path.join(config.dataDir, "workspaces", account.workspace_key);

/**
 * Answers a model call with a recorded answer, so the demo can be loaded with no key and no credits.
 * recording: { model, files: { "<file name>": { content, finishReason, usage, model, ms } } }
 */
export function createReplayProvider(recording) {
  let current = null;
  return {
    name: "replay",
    model: recording.model ?? "recorded",
    configured: () => true,
    use(file) { current = file; },
    async chat() {
      const answer = recording.files?.[current];
      if (!answer?.content) throw new ModelError("model_failed", `No recorded answer for ${current}`);
      return {
        content: answer.content,
        toolCalls: [],
        assistantMessage: { role: "assistant", content: answer.content },
        reasoning: null,
        finishReason: answer.finishReason ?? "stop",
        usage: answer.usage ?? null,
        model: answer.model ?? recording.model ?? "recorded",
        ms: answer.ms ?? 0,
      };
    },
  };
}

/** Wraps a live provider and keeps each file's answer, so a good run can be saved as a recording. */
export function createRecordingProvider(live) {
  let current = null;
  const answers = {};
  return {
    name: live.name,
    model: live.model,
    configured: () => live.configured(),
    answers,
    use(file) { current = file; live.use?.(file); },
    async chat(args) {
      const out = await live.chat(args);
      answers[current] = { content: out.content, finishReason: out.finishReason, usage: out.usage, model: out.model, ms: out.ms };
      return out;
    },
  };
}

const IMAGE_FILE = /\.(png|jpe?g|webp)$/i;
export const listDemoImages = (dir) =>
  fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => IMAGE_FILE.test(name)).sort().map((name) => path.join(dir, name)) : [];

/**
 * Imports the given screenshots into the demo account's workspace. Safe to run again: a file that is already
 * loaded is skipped by its import key and the model is not called for it. Never touches a calendar.
 * provider may have use(fileName), which is told which file is being read.
 */
export async function loadDemoSaves({ config, provider, files, now = Date.now() }) {
  const central = openAccounts(config.dataDir);
  let workspaceDb = null;
  let server = null;
  try {
    const account = ensureDemoAccount(central, now);
    const folder = demoWorkspaceDir(config, account);
    fs.mkdirSync(folder, { recursive: true });
    workspaceDb = openDb(path.join(folder, "db.sqlite"));
    // Any calendar call is a bug in the loader. It throws and is never swallowed.
    const calendar = new Proxy({}, { get: (_t, name) => () => { throw new Error(`calendar.${String(name)} called by the demo loader`); } });
    const googleAuth = { configured: () => false, status: () => ({ connected: false, missingScopes: [] }) };
    const workspaceConfig = { ...config, screenshotDir: path.join(folder, "screenshots") };
    const app = createApp({ db: workspaceDb, config: workspaceConfig, googleAuth, selfTest: runSelfTest(), provider, calendar });
    server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
    const base = `http://127.0.0.1:${server.address().port}`;

    const results = [];
    for (const file of files) {
      const name = path.basename(file);
      provider.use?.(name);
      const form = new FormData();
      form.append("image", new Blob([fs.readFileSync(file)], { type: "image/png" }), name);
      const headers = { "Idempotency-Key": `demo-${name}` };
      let res = await fetch(`${base}/api/saves`, { method: "POST", body: form, headers });
      let body = await res.json();
      // A save whose model call failed earlier is retried on the same save, the screenshot is not uploaded again.
      if (res.status === 409 && body.error === "previous_extraction_failed") {
        res = await fetch(`${base}/api/saves/${body.saveId}/extract`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        body = await res.json();
      }
      const saveId = body.saveId ?? null;
      if (res.ok && saveId) {
        workspaceDb.prepare("UPDATE saves SET is_demo = 1 WHERE id = ?").run(saveId);
        const view = await (await fetch(`${base}/api/saves/${saveId}`)).json();
        results.push({ file: name, saveId, status: body.replayed ? "already loaded" : "loaded", title: view.action?.title ?? null });
      } else {
        results.push({ file: name, saveId, status: "failed", error: body.error ?? `http_${res.status}` });
      }
    }
    return { account, folder, results };
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    workspaceDb?.close();
    central.close();
  }
}

/** Removes the demo account, its sessions and its workspace folder, so the demo can be loaded again from nothing. */
export function removeDemo(config) {
  const central = openAccounts(config.dataDir);
  try {
    const account = findDemoAccount(central);
    if (!account) return false;
    const root = path.resolve(config.dataDir, "workspaces");
    const folder = path.resolve(root, String(account.workspace_key));
    // The folder name must be the generated uuid and stay inside workspaces/.
    if (/^[0-9a-f-]{36}$/.test(String(account.workspace_key)) && folder.startsWith(root + path.sep)) fs.rmSync(folder, { recursive: true, force: true });
    central.prepare("DELETE FROM accounts WHERE id = ?").run(account.id);
    return true;
  } finally {
    central.close();
  }
}
