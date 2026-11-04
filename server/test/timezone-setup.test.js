import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { createApp } from "../src/app.js";
import { MIGRATIONS, getSettings, openDb, timezoneConfirmed } from "../src/db.js";
import { runSelfTest } from "../src/tz.js";

const google = {
  configured: () => true,
  authUrl: () => "https://accounts.google.test/consent",
  handleCallback: async () => ({ connected: true, missingScopes: [] }),
  status: () => ({ configured: true, connected: false, hasRefreshToken: false, missingScopes: [] }),
  disconnect: () => ({ configured: true, connected: false, hasRefreshToken: false, missingScopes: [] }),
};

async function withServer(fn) {
  const db = openDb(":memory:");
  const app = createApp({ db, config: { frontendOrigin: "http://localhost:5173" }, googleAuth: google, selfTest: runSelfTest() });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`, db);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const send = (url, method, body) =>
  fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("a new workspace has the default timezone but has not confirmed it", async () => {
  await withServer(async (base, db) => {
    assert.deepEqual(await (await fetch(`${base}/api/timezone/setup`)).json(), { done: false, tz: "America/New_York" });
    assert.equal(timezoneConfirmed(db), false);
  });
});

test("the first login step validates and saves the timezone, then marks it confirmed", async () => {
  await withServer(async (base, db) => {
    for (const body of [{}, { tz: "" }, { tz: "Mars/Olympus" }, { tz: 5 }]) {
      const bad = await send(`${base}/api/timezone/setup`, "POST", body);
      assert.equal(bad.status, 400);
      assert.equal((await bad.json()).error, "invalid_timezone");
    }
    assert.equal(timezoneConfirmed(db), false);
    const ok = await send(`${base}/api/timezone/setup`, "POST", { tz: "Africa/Casablanca" });
    assert.deepEqual(await ok.json(), { done: true, tz: "Africa/Casablanca" });
    assert.equal(getSettings(db).tz, "Africa/Casablanca");
    assert.equal(getSettings(db).workStart, "09:00");
    assert.deepEqual(await (await fetch(`${base}/api/timezone/setup`)).json(), { done: true, tz: "Africa/Casablanca" });
  });
});

test("choosing a timezone in Settings confirms it, other settings do not", async () => {
  await withServer(async (base, db) => {
    await send(`${base}/api/settings`, "PUT", { workStart: "08:00" });
    assert.equal(timezoneConfirmed(db), false);
    await send(`${base}/api/settings`, "PUT", { tz: "Europe/Paris" });
    assert.equal(timezoneConfirmed(db), true);
  });
});

test("migration v10 only trusts a timezone that is not the default", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tz-confirm-"));
  try {
    const make = (name, tz) => {
      const file = path.join(dir, name);
      const old = new Database(file);
      for (let i = 0; i < 9; i++) old.exec(MIGRATIONS[i]);
      old.pragma("user_version = 9");
      old.prepare("INSERT INTO settings (key, value) VALUES ('tz', ?)").run(tz);
      old.close();
      return file;
    };
    const chosen = openDb(make("chosen.sqlite", "Africa/Casablanca"));
    assert.equal(timezoneConfirmed(chosen), true);
    const def = openDb(make("default.sqlite", "America/New_York"));
    assert.equal(timezoneConfirmed(def), false);
    const unset = openDb(make("unset.sqlite", null));
    assert.equal(timezoneConfirmed(unset), false);
    for (const db of [chosen, def, unset]) db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
