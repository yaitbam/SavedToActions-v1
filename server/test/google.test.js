import test from "node:test";
import assert from "node:assert/strict";
import { getGoogleEmail, loadTokens, openDb, setGoogleEmail, storeTokens } from "../src/db.js";
import { createGoogleAuth } from "../src/google/auth.js";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
];

const config = (overrides = {}) => ({
  google: {
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    redirectUri: "http://localhost:3000/auth/google/callback",
    scopes: SCOPES,
    ...overrides,
  },
});

test("auth URL: offline access, forced consent, both scopes, redirect URI and a random state", () => {
  const auth = createGoogleAuth({ db: openDb(":memory:"), config: config() });
  const url = new URL(auth.authUrl());
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(url.searchParams.get("client_id"), "test-client-id");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(url.searchParams.get("redirect_uri"), "http://localhost:3000/auth/google/callback");
  assert.deepEqual(url.searchParams.get("scope").split(" "), SCOPES);
  assert.match(url.searchParams.get("state"), /^[0-9a-f]{32}$/);
  const other = new URL(auth.authUrl());
  assert.notEqual(url.searchParams.get("state"), other.searchParams.get("state"));
});

test("callback rejects unknown state, and a state can be used only once", async () => {
  const auth = createGoogleAuth({ db: openDb(":memory:"), config: config() });
  await assert.rejects(auth.handleCallback({ code: "c", state: "forged" }), /invalid_state/);
  const state = new URL(auth.authUrl()).searchParams.get("state");
  await assert.rejects(auth.handleCallback({ code: "", state }), /missing_code/);
  await assert.rejects(auth.handleCallback({ code: "c", state }), /invalid_state/);
});

test("not configured: no client, not connected", () => {
  const auth = createGoogleAuth({ db: openDb(":memory:"), config: config({ clientId: "", clientSecret: "" }) });
  assert.equal(auth.configured(), false);
  assert.equal(auth.authorizedClient(), null);
  assert.deepEqual(auth.status(), { configured: false, connected: false, hasRefreshToken: false, missingScopes: [] });
});

test("status reports scopes the user unticked on the consent screen", () => {
  const db = openDb(":memory:");
  const auth = createGoogleAuth({ db, config: config() });
  storeTokens(db, { access_token: "a", refresh_token: "r", scope: SCOPES[0] });
  const status = auth.status();
  assert.equal(status.connected, true);
  assert.equal(status.hasRefreshToken, true);
  assert.deepEqual(status.missingScopes, [SCOPES[1]]);
  storeTokens(db, { access_token: "a", refresh_token: "r", scope: SCOPES.join(" ") });
  assert.deepEqual(auth.status().missingScopes, []);
});

test("authorized client loads stored credentials and persists refreshed tokens without losing the refresh token", () => {
  const db = openDb(":memory:");
  const auth = createGoogleAuth({ db, config: config() });
  storeTokens(db, { access_token: "old", refresh_token: "keep-me", scope: SCOPES.join(" ") });
  const client = auth.authorizedClient();
  assert.equal(client.credentials.refresh_token, "keep-me");
  client.emit("tokens", { access_token: "new", expiry_date: 123 });
  assert.deepEqual(loadTokens(db), {
    access_token: "new",
    refresh_token: "keep-me",
    scope: SCOPES.join(" "),
    expiry_date: 123,
  });
});

test("disconnect also clears the cached account email, so another account is never shown under the old address", () => {
  const db = openDb(":memory:");
  const auth = createGoogleAuth({ db, config: config() });
  storeTokens(db, { access_token: "a", refresh_token: "r", scope: SCOPES.join(" ") });
  setGoogleEmail(db, "me@example.test");
  assert.equal(getGoogleEmail(db), "me@example.test");
  auth.disconnect();
  assert.equal(getGoogleEmail(db), null);
});

test("disconnect clears stored tokens locally", () => {
  const db = openDb(":memory:");
  const auth = createGoogleAuth({ db, config: config() });
  storeTokens(db, { access_token: "a", refresh_token: "r", scope: SCOPES.join(" ") });
  assert.equal(auth.disconnect().connected, false);
  assert.equal(loadTokens(db), null);
});
