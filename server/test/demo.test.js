import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { createAuthenticatedApp } from "../src/auth/app.js";
import { openAccounts } from "../src/auth/store.js";
import { createRecordingProvider, createReplayProvider, findDemoAccount, listDemoImages, loadDemoSaves, removeDemo } from "../src/demo/loadDemo.js";
import { openDb } from "../src/db.js";
import { ModelError } from "../src/model/provider.js";
import { runSelfTest } from "../src/tz.js";

// A model that answers with a small valid extraction, and counts its calls.
function fakeModel({ fail = false } = {}) {
  let current = null;
  const provider = {
    name: "fake",
    model: "fake-model",
    calls: 0,
    configured: () => true,
    use(file) { current = file; },
    async chat() {
      provider.calls += 1;
      if (fail) throw new ModelError("model_unreachable", "down");
      const content = JSON.stringify({
        saved_post: true, transcription: `Text of ${current}`, title: `Post ${current}`, goal_id: null, kind: "try", label: null,
        deadline: null, event_dates: [], deliverables: ["Look at it"], verbatim_items: [], evidence_quote: null, suggested_effort_min: 20, intent: null,
      });
      return { content, toolCalls: [], finishReason: "stop", usage: { total_tokens: 10 }, model: "fake-model", ms: 7 };
    },
  };
  return provider;
}

async function setup(names = ["a-1.png", "x-2.png"]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sta-demo-"));
  const images = path.join(dir, "images");
  fs.mkdirSync(images);
  for (const [i, name] of names.entries()) {
    await sharp({ create: { width: 48, height: 64, channels: 3, background: { r: 40 * i, g: 90, b: 160 } } }).png().toFile(path.join(images, name));
  }
  const config = { dataDir: path.join(dir, "data"), frontendOrigin: "http://localhost:5173", maxUploadBytes: 8 * 1024 * 1024 };
  return { dir, images, config, files: listDemoImages(images), done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test("the loader fills one read only demo account, marks every save as demo data, and is safe to run again", async () => {
  const t = await setup();
  try {
    const model = fakeModel();
    const first = await loadDemoSaves({ config: t.config, provider: model, files: t.files });
    assert.deepEqual(first.results.map((r) => [r.file, r.status, r.title]), [["a-1.png", "loaded", "Post a-1.png"], ["x-2.png", "loaded", "Post x-2.png"]]);
    assert.equal(model.calls, 2);

    const central = openAccounts(t.config.dataDir);
    const demo = central.prepare("SELECT * FROM accounts WHERE kind = 'demo'").all();
    assert.equal(demo.length, 1);
    assert.deepEqual([demo[0].google_sub, demo[0].calendar_sub, demo[0].email], [null, null, "demo@savedtoaction.invalid"]);
    assert.ok(demo[0].profile_completed_at);
    central.close();

    const db = openDb(path.join(t.config.dataDir, "workspaces", demo[0].workspace_key, "db.sqlite"));
    assert.deepEqual(db.prepare("SELECT COUNT(*) AS n, SUM(is_demo) AS d FROM saves").get(), { n: 2, d: 2 });
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM blocks").get().n, 0, "nothing is ever booked");
    db.close();
    assert.equal(fs.readdirSync(path.join(first.folder, "screenshots")).length, 2);

    // A second run adds nothing and does not call the model.
    const again = await loadDemoSaves({ config: t.config, provider: model, files: t.files });
    assert.deepEqual(again.results.map((r) => r.status), ["already loaded", "already loaded"]);
    assert.equal(model.calls, 2);
    assert.equal(again.account.id, first.account.id);
  } finally { t.done(); }
});

test("a recorded run can be replayed with no model, and reset removes the demo so it loads again from nothing", async () => {
  const t = await setup();
  try {
    const recorder = createRecordingProvider(fakeModel());
    await loadDemoSaves({ config: t.config, provider: recorder, files: t.files });
    assert.deepEqual(Object.keys(recorder.answers).sort(), ["a-1.png", "x-2.png"]);
    const recording = { model: recorder.model, files: recorder.answers };

    assert.equal(removeDemo(t.config), true);
    assert.equal(removeDemo(t.config), false, "nothing left to remove");
    const central = openAccounts(t.config.dataDir);
    assert.equal(findDemoAccount(central), null);
    central.close();

    const replay = createReplayProvider(recording);
    const out = await loadDemoSaves({ config: t.config, provider: replay, files: t.files });
    assert.deepEqual(out.results.map((r) => [r.status, r.title]), [["loaded", "Post a-1.png"], ["loaded", "Post x-2.png"]]);

    // A file with no recorded answer fails clearly and the other still loads.
    await removeDemo(t.config);
    const partial = createReplayProvider({ model: "m", files: { "a-1.png": recording.files["a-1.png"] } });
    const mixed = await loadDemoSaves({ config: t.config, provider: partial, files: t.files });
    assert.deepEqual(mixed.results.map((r) => r.status), ["loaded", "failed"]);
  } finally { t.done(); }
});

test("a model failure is reported per file, and the loader can be run again to retry it", async () => {
  const t = await setup(["a-1.png"]);
  try {
    const bad = await loadDemoSaves({ config: t.config, provider: fakeModel({ fail: true }), files: t.files });
    assert.equal(bad.results[0].status, "failed");
    const retry = await loadDemoSaves({ config: t.config, provider: fakeModel(), files: t.files });
    assert.deepEqual(retry.results.map((r) => [r.status, r.title]), [["loaded", "Post a-1.png"]]);
    const db = openDb(path.join(retry.folder, "db.sqlite"));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM saves").get().n, 1, "the retry reuses the same save");
    db.close();
  } finally { t.done(); }
});

// ---- the demo through the signed in app ----------------------------------------------------------------------------
async function withApp(run) {
  const t = await setup();
  const config = { ...t.config, cookieSecure: false, ownerEmail: "", freeDailyCredits: 20, loginRedirectUri: "http://localhost:3000/auth/login/google/callback",
    watcher: { enabled: false }, google: { clientId: "id", clientSecret: "secret", redirectUri: "http://localhost:3000/auth/google/callback", scopes: ["calendar"] } };
  const provider = { name: "fake", model: "fake-model", configured: () => true, chat: async () => ({}) };
  const instance = createAuthenticatedApp({ config, provider, selfTest: runSelfTest(), clientFactory: () => ({ generateAuthUrl: () => "https://accounts.example.test/" }) });
  const server = await new Promise((resolve) => { const s = instance.app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const jar = new Map();
  const request = async (url, { method = "GET", body, csrf } = {}) => {
    const res = await fetch(base + url, { method, redirect: "manual", headers: { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "), Origin: config.frontendOrigin,
      ...(body ? { "Content-Type": "application/json" } : {}), ...(csrf ? { "X-CSRF-Token": csrf } : {}) }, body: body ? JSON.stringify(body) : undefined });
    for (const value of res.headers.getSetCookie()) { const pair = value.split(";")[0], i = pair.indexOf("="); jar.set(pair.slice(0, i), pair.slice(i + 1)); }
    return res;
  };
  try { await run({ t, config, request }); }
  finally { await new Promise((resolve) => server.close(resolve)); instance.close(); t.done(); }
}

test("Explore the demo: unavailable until the demo is loaded, then a read only session that nobody can change", async () => {
  await withApp(async ({ t, config, request }) => {
    const before = await (await request("/auth/session")).json();
    assert.equal(before.demo_available, false);
    assert.equal((await request("/auth/demo", { method: "POST", csrf: before.csrf_token })).status, 503);

    await loadDemoSaves({ config: t.config, provider: fakeModel(), files: t.files });
    const anonymous = await (await request("/auth/session")).json();
    assert.equal(anonymous.demo_available, true);

    const entered = await request("/auth/demo", { method: "POST", csrf: anonymous.csrf_token });
    assert.equal(entered.status, 200);
    const session = await (await request("/auth/session")).json();
    assert.deepEqual([session.authenticated, session.kind, session.profile_complete, session.calendar_email], [true, "demo", true, null]);
    assert.deepEqual([session.credits.remaining, session.credits.max], [0, 0]);

    // The demo can read everything in its workspace, including the screenshots.
    const list = await (await request("/api/saves")).json();
    assert.equal(list.total, 2);
    assert.ok(list.items.every((item) => item.isDemo));
    const shot = await request(`/api/saves/${list.items[0].saveId}/screenshot`);
    assert.equal(shot.status, 200);
    assert.match(shot.headers.get("content-type"), /image\/png/);

    // And it can change nothing: no upload, no edit, no rename, no delete, no calendar, no model call.
    const csrf = session.csrf_token;
    const id = list.items[0].saveId;
    const writes = [
      ["POST", "/api/saves"], ["POST", `/api/saves/${id}/extract`], ["PATCH", `/api/saves/${id}`], ["DELETE", `/api/saves/${id}`],
      ["PATCH", "/api/me", { name: "Hacked" }], ["DELETE", "/api/me", { approved: true, confirmation: "DELETE MY ACCOUNT" }],
      ["PUT", "/api/settings", { tz: "UTC" }], ["POST", "/api/actions/recheck", { ids: [1] }],
    ];
    for (const [method, url, body] of writes) {
      const res = await request(url, { method, body: body ?? {}, csrf });
      assert.equal(res.status, 403, `${method} ${url}`);
      assert.equal((await res.json()).error, "demo_readonly", `${method} ${url}`);
    }
    // Starting a Google Calendar connection just goes back to the app.
    const connect = await request("/auth/google");
    assert.equal(connect.status, 302);
    assert.equal(connect.headers.get("location"), `${config.frontendOrigin}/app`);

    // Nothing above changed the shared account or its saves.
    const central = openAccounts(config.dataDir);
    assert.equal(findDemoAccount(central).name, "Demo workspace");
    central.close();
    assert.equal((await (await request("/api/saves")).json()).total, 2);

    // Signing out ends only that visitor's session.
    await request("/auth/logout", { method: "POST", csrf });
    assert.equal((await (await request("/auth/session")).json()).authenticated, false);
  });
});

test("each screenshot is saved with its note, the recording keeps the note, and a replay flags answers made for another note", async () => {
  const t = await setup();
  try {
    const notes = { "a-1.png": "Try it tonight. 20 min", "x-2.png": "Read it this weekend" };
    const recorder = createRecordingProvider(fakeModel());
    const first = await loadDemoSaves({ config: t.config, provider: recorder, files: t.files, notes });
    assert.deepEqual(Object.fromEntries(Object.entries(recorder.answers).map(([k, v]) => [k, v.note])), notes);

    const central = openAccounts(t.config.dataDir);
    const demo = central.prepare("SELECT * FROM accounts WHERE kind = 'demo'").get();
    central.close();
    const db = openDb(path.join(t.config.dataDir, "workspaces", demo.workspace_key, "db.sqlite"));
    assert.deepEqual(db.prepare("SELECT note FROM saves ORDER BY id").all().map((r) => r.note), ["Try it tonight. 20 min", "Read it this weekend"]);
    db.close();
    assert.equal(first.results.every((r) => r.status === "loaded"), true);

    removeDemo(t.config);
    const recording = { model: "fake-model", files: recorder.answers };
    const same = createReplayProvider(recording);
    await loadDemoSaves({ config: t.config, provider: same, files: t.files, notes });
    assert.deepEqual(same.stale, []);

    removeDemo(t.config);
    const other = createReplayProvider(recording);
    await loadDemoSaves({ config: t.config, provider: other, files: t.files, notes: { ...notes, "x-2.png": "Another note" } });
    assert.deepEqual(other.stale, ["x-2.png"]);
  } finally { t.done(); }
});

test("saves can be loaded into a signed in account by email, and the demo account is never matched", async () => {
  const t = await setup();
  try {
    const central = openAccounts(t.config.dataDir);
    central.prepare("INSERT INTO accounts(google_sub,email,name,kind,workspace_key,profile_completed_at,created_at) VALUES ('sub-1','Me@Example.com','Me','user','11111111-1111-4111-8111-111111111111',1,1)").run();
    central.close();
    const model = fakeModel();
    const first = await loadDemoSaves({ config: t.config, provider: model, files: t.files, notes: { "a-1.png": "Try it tonight" }, email: "me@example.com" });
    assert.deepEqual(first.results.map((r) => r.status), ["loaded", "loaded"]);
    assert.equal(first.account.email, "Me@Example.com");
    const db = openDb(path.join(t.config.dataDir, "workspaces", first.account.workspace_key, "db.sqlite"));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM saves").get().n, 2);
    assert.deepEqual(db.prepare("SELECT note FROM saves ORDER BY id").all().map((r) => r.note), ["Try it tonight", ""]);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM blocks").get().n, 0);
    db.close();
    const again = await loadDemoSaves({ config: t.config, provider: model, files: t.files, notes: { "a-1.png": "Try it tonight" }, email: "me@example.com" });
    assert.deepEqual(again.results.map((r) => r.status), ["already loaded", "already loaded"]);
    assert.equal(model.calls, 2);

    await assert.rejects(loadDemoSaves({ config: t.config, provider: model, files: t.files, email: "nobody@example.com" }), /No account with the email/);
    await loadDemoSaves({ config: t.config, provider: fakeModel(), files: t.files });
    await assert.rejects(loadDemoSaves({ config: t.config, provider: model, files: t.files, email: "demo@savedtoaction.invalid" }), /No account with the email/);
  } finally { t.done(); }
});
