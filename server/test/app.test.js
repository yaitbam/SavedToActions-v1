import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { SCHEMA_VERSION, openDb } from "../src/db.js";
import { runSelfTest } from "../src/tz.js";

const config = { frontendOrigin: "http://localhost:5173" };

function stubGoogle(overrides = {}) {
  return {
    configured: () => true,
    authUrl: () => "https://accounts.google.test/consent?state=abc",
    handleCallback: async () => ({ connected: true, missingScopes: [] }),
    status: () => ({ configured: true, connected: false, hasRefreshToken: false, missingScopes: [] }),
    disconnect: () => ({ configured: true, connected: false, hasRefreshToken: false, missingScopes: [] }),
    ...overrides,
  };
}

async function withServer(googleAuth, fn) {
  const app = createApp({ db: openDb(":memory:"), config, googleAuth, selfTest: runSelfTest() });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const put = (url, body) =>
  fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("GET /health reports the timezone self test, schema version and google status", async () => {
  await withServer(stubGoogle(), async (base) => {
    const res = await fetch(`${base}/health`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.timezoneSelfTest.actual, "+00:00");
    assert.equal(body.timezoneSelfTest.tz, "Africa/Casablanca");
    assert.ok(body.timezoneSelfTest.momentTimezoneDataVersion);
    assert.equal(body.schemaVersion, SCHEMA_VERSION);
    assert.equal(body.google.connected, false);
    assert.equal(res.headers.get("access-control-allow-origin"), "http://localhost:5173");
  });
});

test("OPTIONS preflight answers 204", async () => {
  await withServer(stubGoogle(), async (base) => {
    const res = await fetch(`${base}/api/settings`, { method: "OPTIONS" });
    assert.equal(res.status, 204);
  });
});

test("settings: defaults, validation, partial update", async () => {
  await withServer(stubGoogle(), async (base) => {
    assert.deepEqual(await (await fetch(`${base}/api/settings`)).json(), { workStart: "09:00", workEnd: "21:00", tz: null, ignoreAllDay: true });

    assert.equal((await put(`${base}/api/settings`, { workStart: "21:00", workEnd: "09:00" })).status, 400);
    assert.equal((await put(`${base}/api/settings`, { workStart: "9am" })).status, 400);
    const badTz = await put(`${base}/api/settings`, { tz: "Mars/Olympus" });
    assert.equal(badTz.status, 400);
    assert.equal((await badTz.json()).error, "invalid_timezone");

    const ok = await put(`${base}/api/settings`, { tz: "Africa/Casablanca" });
    assert.deepEqual(await ok.json(), { workStart: "09:00", workEnd: "21:00", tz: "Africa/Casablanca", ignoreAllDay: true });
    const hours = await put(`${base}/api/settings`, { workStart: "08:00", workEnd: "24:00" });
    assert.deepEqual(await hours.json(), { workStart: "08:00", workEnd: "24:00", tz: "Africa/Casablanca", ignoreAllDay: true });
    assert.deepEqual(await (await fetch(`${base}/api/settings`)).json(), { workStart: "08:00", workEnd: "24:00", tz: "Africa/Casablanca", ignoreAllDay: true });

    // Ignore all-day events: on by default, switchable, must be a real boolean, other settings are kept.
    const off = await put(`${base}/api/settings`, { ignoreAllDay: false });
    assert.deepEqual(await off.json(), { workStart: "08:00", workEnd: "24:00", tz: "Africa/Casablanca", ignoreAllDay: false });
    for (const bad of ["no", 0, null]) {
      const r = await put(`${base}/api/settings`, { ignoreAllDay: bad });
      if (bad === null) assert.equal(r.status, 200, "null means leave it unchanged");
      else assert.deepEqual([r.status, (await r.json()).error], [400, "invalid_ignore_all_day"]);
    }
    assert.equal((await (await put(`${base}/api/settings`, { ignoreAllDay: true })).json()).ignoreAllDay, true);
  });
});

test("goals: three presets, names editable", async () => {
  await withServer(stubGoogle(), async (base) => {
    const goals = await (await fetch(`${base}/api/goals`)).json();
    assert.deepEqual(goals.map((g) => g.name), ["Earn more", "Learn a skill", "Events and opportunities"]);
    const renamed = await put(`${base}/api/goals/2`, { name: "Get better at React" });
    assert.deepEqual(await renamed.json(), { id: 2, name: "Get better at React" });
    assert.equal((await put(`${base}/api/goals/2`, { name: "" })).status, 400);
    assert.equal((await put(`${base}/api/goals/99`, { name: "Nope" })).status, 400);
  });
});

test("GET /auth/google redirects to Google when configured, 503 when not", async () => {
  await withServer(stubGoogle(), async (base) => {
    const res = await fetch(`${base}/auth/google`, { redirect: "manual" });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "https://accounts.google.test/consent?state=abc");
  });
  await withServer(stubGoogle({ configured: () => false }), async (base) => {
    const res = await fetch(`${base}/auth/google`, { redirect: "manual" });
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error, "google_not_configured");
  });
});

test("GET /auth/google/callback sends the browser back to the frontend with the outcome", async () => {
  const back = async (google, query) =>
    withServer(google, async (base) => {
      const res = await fetch(`${base}/auth/google/callback${query}`, { redirect: "manual" });
      assert.equal(res.status, 302);
      return res.headers.get("location");
    });

  let location;
  await withServer(stubGoogle(), async (base) => {
    const res = await fetch(`${base}/auth/google/callback?code=c&state=s`, { redirect: "manual" });
    location = res.headers.get("location");
  });
  assert.equal(location, "http://localhost:5173/?google=connected");

  const denied = await back(stubGoogle(), "?error=access_denied");
  assert.equal(denied, "http://localhost:5173/?google=denied");

  const partial = await back(stubGoogle({ handleCallback: async () => ({ connected: true, missingScopes: ["x"] }) }), "?code=c&state=s");
  assert.equal(partial, "http://localhost:5173/?google=partial");

  const origError = console.error;
  console.error = () => {};
  try {
    const failed = await back(stubGoogle({ handleCallback: async () => { throw new Error("invalid_state"); } }), "?code=c&state=s");
    assert.equal(failed, "http://localhost:5173/?google=error");
  } finally {
    console.error = origError;
  }
});

test("auth status and disconnect", async () => {
  await withServer(stubGoogle(), async (base) => {
    assert.equal((await (await fetch(`${base}/auth/status`)).json()).connected, false);
    const res = await fetch(`${base}/auth/disconnect`, { method: "POST" });
    assert.equal((await res.json()).connected, false);
  });
});
