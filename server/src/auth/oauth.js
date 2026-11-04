import crypto from "node:crypto";
import { google } from "googleapis";
import { random, hash, cookies, cookie } from "./store.js";
export function createIdentity({ db, config, clock, clientFactory = uri => new google.auth.OAuth2(config.google.clientId, config.google.clientSecret, uri) }) {
  function client(purpose) { return clientFactory(purpose === "login" ? config.loginRedirectUri : config.google.redirectUri); }
  return {
    start(req, res, purpose, accountId = null) {
      const state = random(), nonce = random(), verifier = random();
      const binding = cookies(req).sta_oauth ?? random();
      cookie(res, config, "sta_oauth", binding, 600);
      db.prepare("INSERT INTO oauth_requests VALUES (?,?,?,?,?,?,?)").run(hash(state), nonce, verifier, hash(binding), purpose, accountId, clock() + 600000);
      const scope = ["openid", "email", "profile", ...(purpose === "calendar" ? config.google.scopes : [])];
      res.redirect(client(purpose).generateAuthUrl({ scope, state, nonce, code_challenge: hashBase64(verifier), code_challenge_method: "S256",
        ...(purpose === "calendar" ? { access_type: "offline", prompt: "consent" } : { prompt: "select_account" }) }));
    },
    async finish(req, purpose, accountId = null) {
      if (typeof req.query.state !== "string") throw failure("state", "missing_state");
      const state = db.prepare("SELECT * FROM oauth_requests WHERE state_hash=?").get(hash(req.query.state));
      db.prepare("DELETE FROM oauth_requests WHERE state_hash=?").run(hash(req.query.state));
      if (!state) throw failure("state", "unknown_or_replayed_state");
      if (state.expires_at <= clock()) throw failure("state", "expired_state");
      if (state.purpose !== purpose || state.account_id !== accountId) throw failure("state", "wrong_flow");
      if (state.browser_binding_hash !== hash(cookies(req).sta_oauth ?? "")) throw failure("state", "browser_cookie_missing_or_changed");
      if (req.query.error || typeof req.query.code !== "string") throw failure("consent", "consent_denied");
      const oauth = client(purpose);
      const { tokens } = await checked("code_exchange", () => oauth.getToken({ code: req.query.code, codeVerifier: state.code_verifier }));
      const ticket = await checked("token_verification", () => oauth.verifyIdToken({ idToken: tokens.id_token, audience: config.google.clientId }));
      const profile = ticket.getPayload();
      if (!profile?.sub || !profile.email || profile.email_verified !== true || profile.nonce !== state.nonce ||
          !["accounts.google.com", "https://accounts.google.com"].includes(profile.iss) || profile.exp * 1000 <= clock()) throw failure("identity", "invalid_identity");
      return { profile, tokens };
    },
  };
}
function hashBase64(value) { return crypto.createHash("sha256").update(value).digest("base64url"); }

function failure(stage, reason) { return Object.assign(new Error(reason), { authStage: stage, authReason: reason }); }
async function checked(stage, work) {
  try { return await work(); }
  catch (error) {
    const code = error.response?.data?.error ?? error.code;
    const allowed = ["invalid_grant", "invalid_client", "invalid_request", "redirect_uri_mismatch", "ENOTFOUND", "ECONNRESET", "ETIMEDOUT", "ECONNREFUSED"];
    let reason = allowed.includes(code) ? code : "request_failed";
    if (stage === "token_verification") {
      if (/used too early/i.test(error.message)) reason = "clock_before_token";
      if (/used too late|expired/i.test(error.message)) reason = "token_expired";
      if (/wrong recipient|audience/i.test(error.message)) reason = "wrong_audience";
      if (/signature/i.test(error.message)) reason = "signature_rejected";
    }
    throw failure(stage, reason);
  }
}
