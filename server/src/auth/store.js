import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
export const hash = value => crypto.createHash("sha256").update(value).digest("hex");
export const random = () => crypto.randomBytes(32).toString("base64url");
export function openAccounts(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const db = new Database(path.join(dir, "central.sqlite"));
  db.pragma("journal_mode = WAL"); db.pragma("foreign_keys = ON");
  db.exec(`CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY, google_sub TEXT UNIQUE, email TEXT NOT NULL, email_verified INTEGER NOT NULL DEFAULT 1,
    name TEXT, profile_completed_at INTEGER, kind TEXT NOT NULL DEFAULT 'user', workspace_key TEXT NOT NULL UNIQUE,
    calendar_sub TEXT, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    csrf_token TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS oauth_requests (state_hash TEXT PRIMARY KEY, nonce TEXT NOT NULL, code_verifier TEXT NOT NULL,
    browser_binding_hash TEXT NOT NULL, purpose TEXT NOT NULL, account_id INTEGER, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS usage (account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, day TEXT NOT NULL,
    muse_calls INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(account_id,day));`);
  return db;
}
export function cookies(req) {
  const out = {};
  for (const pair of (req.headers.cookie ?? "").split(";")) {
    const split = pair.indexOf("=");
    if (split < 0) continue;
    try { out[pair.slice(0, split).trim()] = decodeURIComponent(pair.slice(split + 1)); } catch { /* Ignore malformed cookies. */ }
  }
  return out;
}
export function cookie(res, config, name, value, maxAge) {
  res.append("Set-Cookie", `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${config.cookieSecure ? "; Secure" : ""}`);
}
export function findSession(db, req, now) {
  const token = cookies(req).sta_session;
  if (!token) return null;
  return db.prepare(`SELECT a.*, s.token_hash, s.csrf_token FROM sessions s JOIN accounts a ON a.id=s.account_id
    WHERE s.token_hash=? AND s.expires_at>?`).get(hash(token), now) ?? null;
}
export function newSession(db, res, config, accountId, now) {
  const token = random();
  db.prepare("INSERT INTO sessions VALUES (?,?,?,?,?)").run(hash(token), accountId, random(), now + 7 * 86400000, now);
  cookie(res, config, "sta_session", token, 7 * 86400);
}
export function upsertAccount(db, profile, ownerEmail, now) {
  let account = db.prepare("SELECT * FROM accounts WHERE google_sub=?").get(profile.sub);
  if (!account && ownerEmail && profile.email.toLowerCase() === ownerEmail.toLowerCase()) {
    account = db.prepare("SELECT * FROM accounts WHERE kind='owner' AND google_sub IS NULL AND lower(email)=lower(?)").get(ownerEmail);
    if (account) db.prepare("UPDATE accounts SET google_sub=? WHERE id=?").run(profile.sub, account.id);
  }
  if (!account) {
    const info = db.prepare("INSERT INTO accounts(google_sub,email,name,kind,workspace_key,created_at) VALUES (?,?,?,?,?,?)")
      .run(profile.sub, profile.email, profile.name ?? null, ownerEmail && profile.email.toLowerCase() === ownerEmail.toLowerCase() ? "owner" : "user", crypto.randomUUID(), now);
    account = db.prepare("SELECT * FROM accounts WHERE id=?").get(info.lastInsertRowid);
  }
  db.prepare("UPDATE accounts SET email=? WHERE id=?").run(profile.email, account.id);
  return db.prepare("SELECT * FROM accounts WHERE id=?").get(account.id);
}
