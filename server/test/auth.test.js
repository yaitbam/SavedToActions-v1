import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAuthenticatedApp } from '../src/auth/app.js';
import { runSelfTest } from '../src/tz.js';
import { createVault } from '../src/auth/vault.js';
import { createUsage } from '../src/auth/usage.js';
import { openAccounts, upsertAccount } from '../src/auth/store.js';

async function withApp(run, sharedCallback = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sta-auth-'));
  let now = Date.parse('2026-11-04T10:00:00Z'), nonce, sub = 'account-a';
  const config = { dataDir: dir, frontendOrigin: 'http://localhost:5173', cookieSecure: false, ownerEmail: '', freeDailyCredits: 20,
    loginRedirectUri: sharedCallback ? 'http://localhost:3000/auth/google/callback' : 'http://localhost:3000/auth/login/google/callback', maxUploadBytes: 1024,
    watcher: { enabled: false }, google: { clientId: 'test-client', clientSecret: 'test-secret', redirectUri: 'http://localhost:3000/auth/google/callback', scopes: ['calendar'] } };
  const clientFactory = () => ({
    generateAuthUrl(options) { nonce = options.nonce; assert.equal(options.code_challenge_method, 'S256'); return 'https://accounts.example.test/?state=' + options.state; },
    async getToken(options) { assert.ok(options.codeVerifier); return { tokens: { id_token: 'test-id', refresh_token: 'test-refresh', scope: 'calendar' } }; },
    async verifyIdToken() { return { getPayload: () => ({ sub, name: 'Test name', email: sub + '@example.test', email_verified: true, nonce, iss: 'https://accounts.google.com', exp: now / 1000 + 3600 }) }; },
  });
  const instance = createAuthenticatedApp({ config, provider: { configured: () => true, chat: async () => ({}) }, selfTest: runSelfTest(), clock: () => now, clientFactory });
  const server = await new Promise(resolve => { const s = instance.app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  function browser() {
    const jar = new Map();
    return {
      async request(url, { method = 'GET', body, csrf, origin = config.frontendOrigin } = {}) {
        const response = await fetch(base + url, { method, redirect: 'manual', headers: { Cookie: [...jar].map(([k,v]) => `${k}=${v}`).join('; '), Origin: origin,
          ...(body ? { 'Content-Type': 'application/json' } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}) }, body: body ? JSON.stringify(body) : undefined });
        for (const value of response.headers.getSetCookie()) { const pair = value.split(';')[0], i = pair.indexOf('='); jar.set(pair.slice(0,i), pair.slice(i+1)); }
        return response;
      },
    };
  }
  async function login(client, account = 'account-a') {
    sub = account;
    const redirect = await client.request('/auth/login/google');
    const state = new URL(redirect.headers.get('location')).searchParams.get('state');
    const result = await client.request(new URL(config.loginRedirectUri).pathname + '?state=' + state + '&code=test');
    assert.equal(result.status, 302); assert.ok(result.headers.get('location').endsWith('/complete-profile'));
    return (await client.request('/auth/session')).json();
  }
  try { await run({ ...instance, dir, config, browser, login, advance: value => { now += value; }, setSub: value => { sub = value; } }); }
  finally { await new Promise(resolve => server.close(resolve)); instance.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}

test('anonymous session, verified login, profile validation and sign-out', () => withApp(async ({ browser, login }) => {
  const client = browser();
  const anonymous = await (await client.request('/auth/session')).json();
  assert.equal(anonymous.authenticated, false); assert.ok(anonymous.csrf_token);
  assert.equal((await client.request('/api/saves')).status, 401);
  const signedIn = await login(client);
  assert.equal(signedIn.authenticated, true); assert.equal(signedIn.profile_complete, false);
  assert.equal((await client.request('/api/saves')).status, 403);
  assert.equal((await client.request('/api/me', { method: 'PATCH', body: { name: 'Name' } })).status, 403);
  assert.equal((await client.request('/api/me', { method: 'PATCH', body: { name: 'Name' }, csrf: signedIn.csrf_token, origin: 'https://evil.test' })).status, 403);
  assert.equal((await client.request('/api/me', { method: 'PATCH', body: { name: '  Name  ', email: 'ignored' }, csrf: signedIn.csrf_token })).status, 200);
  const current = await (await client.request('/auth/session')).json();
  assert.equal(current.name, 'Name'); assert.equal(current.email, 'account-a@example.test'); assert.equal(current.profile_complete, true);
  assert.equal((await client.request('/api/saves')).status, 200);
  await client.request('/auth/logout', { method: 'POST', csrf: current.csrf_token });
  assert.equal((await (await client.request('/auth/session')).json()).authenticated, false);
}));

test('two accounts isolate overlapping IDs and calendar credentials; wrong Google identity is rejected', () => withApp(async ({ browser, login, registry, db, setSub }) => {
  const a = browser(), b = browser(); const sa = await login(a), sb = await login(b, 'account-b');
  for (const [client, session] of [[a, sa], [b, sb]]) await client.request('/api/me', { method: 'PATCH', body: { name: 'User' }, csrf: session.csrf_token });
  await a.request('/api/goals/1', { method: 'PUT', body: { name: 'Private goal A' }, csrf: sa.csrf_token });
  const goalsB = await (await b.request('/api/goals')).json(); assert.notEqual(goalsB[0].name, 'Private goal A');
  const accountA = db.prepare("SELECT * FROM accounts WHERE google_sub='account-a'").get();
  const ws = registry.get(accountA);
  ws.db.prepare("INSERT INTO saves(note,imported_at) VALUES ('Private note', '2026-11-04T10:00:00Z')").run();
  assert.equal((await a.request('/api/saves/1')).status, 200);
  for (const url of ['/api/saves/1', '/api/saves/1/screenshot', '/api/actions/1', '/api/extractions/1', '/api/traces/1']) assert.equal((await b.request(url)).status, 404, url);
  const start = await a.request('/auth/google');
  const state = new URL(start.headers.get('location')).searchParams.get('state'); setSub('account-b');
  const mismatch = await a.request('/auth/google/callback?state=' + state + '&code=test');
  assert.ok(mismatch.headers.get('location').includes('wrong_account'));
  assert.equal(ws.db.prepare('SELECT COUNT(*) n FROM oauth_tokens').get().n, 0);
  const retry = await a.request('/auth/google'); setSub('account-a');
  await a.request('/auth/google/callback?state=' + new URL(retry.headers.get('location')).searchParams.get('state') + '&code=test');
  assert.equal(ws.googleAuth.status().connected, true);
  const stored = ws.db.prepare('SELECT tokens_json FROM oauth_tokens').get().tokens_json;
  assert.ok(!stored.includes('test-refresh')); assert.ok(stored.includes('encrypted'));
  assert.equal((await (await b.request('/auth/status')).json()).connected, false);
}));

test('OAuth state is browser-bound, single-use and expires; sessions expire', () => withApp(async ({ browser, login, advance }) => {
  const a = browser(), b = browser();
  let result = await a.request('/auth/login/google');
  let state = new URL(result.headers.get('location')).searchParams.get('state');
  result = await b.request('/auth/login/google/callback?state=' + state + '&code=test'); assert.ok(result.headers.get('location').includes('error='));
  result = await a.request('/auth/login/google/callback?state=' + state + '&code=test'); assert.ok(result.headers.get('location').includes('error='));
  result = await a.request('/auth/login/google'); state = new URL(result.headers.get('location')).searchParams.get('state'); advance(600001);
  result = await a.request('/auth/login/google/callback?state=' + state + '&code=test'); assert.ok(result.headers.get('location').includes('error='));
  await login(a); advance(8 * 86400000);
  assert.equal((await (await a.request('/auth/session')).json()).authenticated, false);
}));

test('credits charge once per operation, refund failed calls and reset in GMT; encryption detects tampering', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sta-usage-')), db = openAccounts(dir);
  let now = Date.parse('2026-11-04T23:59:00Z'), fail = false;
  try {
    const account = upsertAccount(db, { sub: 'x', email: 'x@example.test' }, '', now);
    const usage = createUsage({ db, provider: { chat: async () => { if (fail) throw new Error('failed'); return {}; } }, config: { freeDailyCredits: 1 }, clock: () => now });
    fail = true; await assert.rejects(usage.run(account, () => usage.provider.chat())); assert.equal(usage.credits(account).remaining, 1);
    fail = false; await usage.run(account, async () => { await usage.provider.chat(); await usage.provider.chat(); }); assert.equal(usage.credits(account).remaining, 0);
    await assert.rejects(usage.run(account, () => usage.provider.chat()), error => error.status === 429);
    now += 60000; assert.equal(usage.credits(account).remaining, 1);
    const vault = createVault(dir, 'ab'.repeat(32)), sealed = vault.seal({ token: 'secret' }); assert.deepEqual(vault.open(sealed), { token: 'secret' });
    sealed.tag = Buffer.alloc(16).toString('base64'); assert.throws(() => vault.open(sealed));
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('login can use the registered Calendar callback without an existing session', () => withApp(async ({ browser, login }) => {
  const client = browser();
  const session = await login(client);
  assert.equal(session.authenticated, true);
  assert.equal(session.profile_complete, false);
}, true));
