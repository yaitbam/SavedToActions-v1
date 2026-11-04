// Google OAuth for a single local user. Tokens live in SQLite (gitignored file).
import crypto from "node:crypto";
import { google } from "googleapis";
import { clearGoogleEmail, clearTokens, loadTokens, storeTokens } from "../db.js";

const STATE_TTL_MS = 10 * 60 * 1000;

export function createGoogleAuth({ db, config, vault }) {
  const { clientId, clientSecret, redirectUri, scopes } = config.google;
  const readStored = () => { const raw = loadTokens(db); return raw && vault ? vault.open(raw) : raw; };
  const writeStored = value => storeTokens(db, vault ? vault.seal(value) : value);
  const pendingStates = new Map();

  const configured = () => Boolean(clientId && clientSecret);
  const newClient = () => new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  function authUrl() {
    const now = Date.now();
    for (const [s, t] of pendingStates) if (now - t > STATE_TTL_MS) pendingStates.delete(s);
    const state = crypto.randomBytes(16).toString("hex");
    pendingStates.set(state, now);
    return newClient().generateAuthUrl({
      access_type: "offline",
      // consent forces a refresh token even if the user connected before.
      prompt: "consent",
      scope: scopes,
      state,
    });
  }

  /** Exchange the code, keep the refresh token if Google omits it this time. */
  async function handleCallback({ code, state }) {
    const issuedAt = pendingStates.get(state);
    pendingStates.delete(state);
    if (!issuedAt || Date.now() - issuedAt > STATE_TTL_MS) throw new Error("invalid_state");
    if (!code) throw new Error("missing_code");
    const { tokens } = await newClient().getToken(code);
    const previous = readStored() ?? {};
    writeStored({ ...previous, ...tokens, refresh_token: tokens.refresh_token ?? previous.refresh_token });
    clearGoogleEmail(db); // a different account may have signed in
    return status();
  }

  /** OAuth client with stored credentials. Refreshed tokens are persisted automatically. Null if not connected. */
  function authorizedClient() {
    const tokens = readStored();
    if (!tokens || !configured()) return null;
    const client = newClient();
    client.setCredentials(tokens);
    client.on("tokens", (fresh) => {
      const current = readStored() ?? {};
      writeStored({ ...current, ...fresh, refresh_token: fresh.refresh_token ?? current.refresh_token });
    });
    return client;
  }

  function status() {
    const tokens = readStored();
    // Google lets users untick individual scopes on the consent screen, so check what was granted.
    const granted = new Set((tokens?.scope ?? "").split(" ").filter(Boolean));
    const missingScopes = tokens ? scopes.filter((s) => !granted.has(s)) : [];
    return {
      configured: configured(),
      connected: Boolean(tokens),
      hasRefreshToken: Boolean(tokens?.refresh_token),
      missingScopes,
    };
  }

  /** Local disconnect only. Does not revoke the grant at Google. */
  function disconnect() {
    clearTokens(db);
    clearGoogleEmail(db);
    return status();
  }

  function saveVerifiedTokens(tokens) {
    const previous = readStored() ?? {};
    writeStored({ ...previous, ...tokens, refresh_token: tokens.refresh_token ?? previous.refresh_token });
  }

  /** Asks Google to revoke the grant. Never throws. Local tokens are not touched here. */
  async function revoke() {
    const tokens = readStored();
    const token = tokens?.refresh_token ?? tokens?.access_token;
    if (!token) return { revoked: false, reason: "not_connected" };
    try {
      await newClient().revokeToken(token);
      return { revoked: true };
    } catch {
      return { revoked: false, reason: "revoke_failed" };
    }
  }
  return { saveVerifiedTokens, configured, authUrl, handleCallback, authorizedClient, status, disconnect, revoke };
}
