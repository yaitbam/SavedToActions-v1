import express from "express";
import { openAccounts, findSession, newSession, upsertAccount, cookies, cookie, hash, random } from "./store.js";
import { createIdentity } from "./oauth.js";
import { createRegistry } from "./registry.js";
import { createVault } from "./vault.js";
import { createUsage } from "./usage.js";
import { setGoogleEmail } from "../db.js";
import { modelInfo } from "../model/provider.js";
import { findDemoAccount } from "../demo/loadDemo.js";

export function createAuthenticatedApp({ config, provider, selfTest, clock = Date.now, clientFactory, workspaceFactory }) {
  const db = openAccounts(config.dataDir), vault = createVault(config.dataDir, config.tokenEncKey);
  db.exec("CREATE TABLE IF NOT EXISTS auth_failures(id INTEGER PRIMARY KEY, stage TEXT NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL)");
  const recordFailure = error => {
    const stage = error.authStage ?? "account_setup", reason = error.authReason ?? "request_failed";
    db.prepare("INSERT INTO auth_failures(stage,reason,created_at) VALUES (?,?,?)").run(stage, reason, clock());
    console.warn("Google authorization failed", { stage, reason });
  };
  const identity = createIdentity({ db, config, clock, clientFactory });
  const usage = createUsage({ db, config, provider, clock });
  const registry = createRegistry({ config, provider: usage.provider, selfTest, vault, clock, workspaceFactory });
  const app = express(), limits = new Map();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use((req, res, next) => {
    res.set("Cache-Control", "no-store"); res.set("X-Content-Type-Options", "nosniff");
    if (req.get("Origin") && req.get("Origin") !== config.frontendOrigin) return res.status(403).json({ error: "origin_not_allowed" });
    req.account = findSession(db, req, clock());
    if (req.path.startsWith("/auth/")) {
      const key = req.ip, now = clock();
      const entry = limits.get(key);
      if (!entry || entry.until < now) limits.set(key, { count: 1, until: now + 60000 });
      else if (++entry.count > 120) return res.status(429).json({ error: "rate_limited" });
      if (limits.size > 10000) for (const [ip, value] of limits) if (value.until < now) limits.delete(ip);
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const expected = req.account?.csrf_token ?? cookies(req).sta_csrf;
      if (!expected || req.get("X-CSRF-Token") !== expected || req.get("Origin") !== config.frontendOrigin) return res.status(403).json({ error: "csrf_invalid" });
    }
    next();
  });
  app.get("/health", (_req, res) => res.json({ ok: true, timezone: selfTest.ok }));
  app.get("/ready", (_req, res) => res.json({ ready: selfTest.ok, database: true, externalCallsPerformed: false }));
  app.get("/auth/session", (req, res) => {
    const account = req.account;
    if (!account) {
      const csrf = cookies(req).sta_csrf || random(); cookie(res, config, "sta_csrf", csrf, 3600);
      return res.json({ authenticated: false, kind: null, profile_complete: false, name: null, email: null, csrf_token: csrf, credits: null, calendar_email: null, demo_available: !!findDemoAccount(db), model: modelInfo(provider) });
    }
    res.json({ authenticated: true, kind: account.kind, profile_complete: !!account.profile_completed_at,
      name: account.name, email: account.email, csrf_token: account.csrf_token, credits: usage.credits(account),
      calendar_email: account.calendar_sub ? account.email : null, model: modelInfo(provider) });
  });
  app.get("/auth/login/google", (req, res) => {
    if (!config.google.clientId || !config.google.clientSecret) return res.redirect(`${config.frontendOrigin}/login?error=unavailable`);
    identity.start(req, res, "login");
  });
  const completeLogin = async (req, res) => {
    try {
      const { profile } = await identity.finish(req, "login");
      const account = upsertAccount(db, profile, config.ownerEmail, clock());
      if (req.account) db.prepare("DELETE FROM sessions WHERE token_hash=?").run(req.account.token_hash);
      newSession(db, res, config, account.id, clock());
      res.redirect(`${config.frontendOrigin}${account.profile_completed_at ? "/app" : "/complete-profile"}`);
    } catch (error) { recordFailure(error); res.redirect(`${config.frontendOrigin}/login?error=signin_failed`); }
  };
  app.get("/auth/login/google/callback", completeLogin);
  app.get("/auth/google/callback", (req, res, next) => {
    // Route by the stored attempt. finish still validates purpose, browser binding and expiry.
    const attempt = typeof req.query.state === "string"
      ? db.prepare("SELECT purpose FROM oauth_requests WHERE state_hash=?").get(hash(req.query.state)) : null;
    if (attempt?.purpose === "login") return completeLogin(req, res);
    next();
  });
  app.post("/auth/logout", (req, res) => {
    if (req.account) db.prepare("DELETE FROM sessions WHERE token_hash=?").run(req.account.token_hash);
    cookie(res, config, "sta_session", "", 0); res.json({ signed_out: true });
  });
  // The shared read only demo. It exists once scripts/load-demo.mjs has filled it, and needs no Google account.
  app.post("/auth/demo", (req, res) => {
    const demo = findDemoAccount(db);
    if (!demo) return res.status(503).json({ error: "demo_unavailable" });
    if (req.account) db.prepare("DELETE FROM sessions WHERE token_hash=?").run(req.account.token_hash);
    newSession(db, res, config, demo.id, clock());
    res.json({ demo: true });
  });
  // Account deletion. Needs a typed confirmation. The Google grant is revoked best effort, the workspace folder and the
  // account row are removed, which also ends every session. Events already on Google Calendar are kept.
  const deleteAccount = async (req, res) => {
    const account = req.account;
    if (!account) return res.status(401).json({ error: "unauthenticated" });
    if (account.kind === "demo") return res.status(403).json({ error: "demo_readonly" });
    if (req.body?.approved !== true || req.body?.confirmation !== "DELETE MY ACCOUNT") {
      return res.status(400).json({ error: "confirmation_required", detail: "Send approved: true and confirmation: DELETE MY ACCOUNT." });
    }
    const ws = registry.get(account);
    const busy = () => ws.references || ws.app.locals.workspaceBusy?.();
    const busyReply = () => res.status(409).json({ error: "operations_in_progress", detail: "Wait for active extraction and calendar operations to finish, then try again." });
    if (busy()) return busyReply();
    const google = typeof ws.googleAuth?.revoke === "function" ? await ws.googleAuth.revoke() : { revoked: false };
    // Everything below is synchronous, so no request can slip in between the checks and the removal.
    if (busy()) return busyReply();
    registry.destroy(account);
    db.transaction(() => {
      db.prepare("DELETE FROM oauth_requests WHERE account_id=?").run(account.id);
      db.prepare("DELETE FROM accounts WHERE id=?").run(account.id);
    })();
    cookie(res, config, "sta_session", "", 0);
    // null means there was no Google grant to revoke.
    res.json({ deleted: true, google_revoked: google.reason === "not_connected" ? null : google.revoked, calendarUnchanged: true, detail: "Your account, saves, screenshots and settings were removed. Existing Google Calendar events were kept." });
  };
  app.delete("/api/me", (req, res, next) => deleteAccount(req, res).catch(next));
  app.use((req, res, next) => {
    if (!req.account && req.path.startsWith("/auth/google")) return res.redirect(`${config.frontendOrigin}/login?error=session_expired`);
    if (!req.account) return res.status(401).json({ error: "unauthenticated" });
    if (req.path === "/api/me" && ["GET", "PATCH"].includes(req.method)) return next();
    if (!req.account.profile_completed_at) return res.status(403).json({ error: "profile_incomplete" });
    next();
  });
  app.get("/api/me", (req, res) => res.json({ name: req.account.name, email: req.account.email }));
  app.patch("/api/me", (req, res) => {
    // The demo account is shared by every visitor, so nobody can rename it.
    if (req.account.kind === "demo") return res.status(403).json({ error: "demo_readonly" });
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!name || name.length > 80) return res.status(400).json({ error: "invalid_name" });
    db.prepare("UPDATE accounts SET name=?,profile_completed_at=COALESCE(profile_completed_at,?) WHERE id=?").run(name, clock(), req.account.id);
    res.json({ name, email: req.account.email });
  });
  app.get("/auth/google", (req, res) => req.account.kind === "demo" ? res.redirect(`${config.frontendOrigin}/app`) : identity.start(req, res, "calendar", req.account.id));
  app.get("/auth/google/callback", async (req, res) => {
    try {
      const { profile, tokens } = await identity.finish(req, "calendar", req.account.id);
      if (profile.sub !== req.account.google_sub) return res.redirect(`${config.frontendOrigin}/app/settings?google=wrong_account`);
      const ws = registry.get(req.account);
      ws.googleAuth.saveVerifiedTokens(tokens); setGoogleEmail(ws.db, profile.email);
      db.prepare("UPDATE accounts SET calendar_sub=? WHERE id=?").run(profile.sub, req.account.id);
      res.redirect(`${config.frontendOrigin}/app?google=connected`);
    } catch (error) { recordFailure(error); res.redirect(`${config.frontendOrigin}/app/settings?google=error`); }
  });
  app.use((req, res, next) => {
    if (!req.path.startsWith("/api/") && !["/auth/status", "/auth/disconnect"].includes(req.path)) return res.status(404).json({ error: "not_found" });
    if (req.account.kind === "demo" && !["GET", "HEAD"].includes(req.method)) return res.status(403).json({ error: "demo_readonly" });
    const muse = req.method === "POST" && (/^\/api\/saves(?:\?|$)/.test(req.path) || /\/(extract|retry|agent-plan)$/.test(req.path));
    if (muse) {
      const key = `muse:${req.account.id}`, now = clock(), entry = limits.get(key);
      if (!entry || entry.until < now) limits.set(key, { count: 1, until: now + 60000 });
      else if (++entry.count > 30) return res.status(429).json({ error: "rate_limited" });
    }
    if (muse && usage.credits(req.account).remaining === 0) return res.status(429).json({ error: "daily_limit_reached" });
    const ws = registry.get(req.account);
    req.ws = ws; ws.references = (ws.references ?? 0) + 1;
    let released = false;
    const release = () => { if (!released) { released = true; ws.references--; } };
    res.once("finish", release); res.once("close", release);
    if (req.path === "/auth/disconnect") db.prepare("UPDATE accounts SET calendar_sub=NULL WHERE id=?").run(req.account.id);
    usage.run(req.account, () => ws.app(req, res, next));
  });
  app.use((err, _req, res, _next) => {
    console.error("Account request failed", { name: err.name, code: err.code, status: err.status });
    res.status(err.status ?? 500).json({ error: "request_failed" });
  });
  const backoff = new Map();
  let checking = false;
  const watcher = setInterval(async () => {
    if (checking) return;
    checking = true;
    const accounts = db.prepare("SELECT * FROM accounts WHERE calendar_sub IS NOT NULL").all();
    let index = 0;
    const worker = async () => {
      while (index < accounts.length) {
        const account = accounts[index++];
        if ((backoff.get(account.id) ?? 0) > clock()) continue;
        if (!db.prepare("SELECT 1 FROM accounts WHERE id=?").get(account.id)) continue; // deleted while this pass was running
        let ws;
        try {
          ws = registry.get(account); ws.references = (ws.references ?? 0) + 1;
          let timer;
          const work = ws.recheck.recheckAll({ source: "watcher" });
          const released = work.finally(() => { ws.references--; });
          try { await Promise.race([released, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("workspace_timeout")), 30000); })]); }
          finally { clearTimeout(timer); }
          backoff.delete(account.id);
        } catch { backoff.set(account.id, clock() + 10 * 60000); console.warn("Workspace recheck delayed"); }
      }
    };
    try { await Promise.all([worker(), worker(), worker()]); } finally { checking = false; }
  }, config.watcher?.intervalMs || 300000); watcher.unref();
  if (config.watcher?.enabled === false) clearInterval(watcher);
  const cleanup = setInterval(() => {
    db.prepare("DELETE FROM sessions WHERE expires_at<?").run(clock());
    db.prepare("DELETE FROM oauth_requests WHERE expires_at<?").run(clock());
  }, 60000); cleanup.unref();
  return { app, db, registry, close() { clearInterval(cleanup); clearInterval(watcher); registry.close(); db.close(); } };
}
