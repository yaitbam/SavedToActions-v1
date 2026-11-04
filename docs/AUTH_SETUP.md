# Account login setup

The server entry point now enables Google account login by default. The browser and API use the Vite proxy on the same origin during development.

1. Login uses the existing Calendar callback by default: `http://localhost:3000/auth/google/callback`. Keep that exact URL registered on the existing Google OAuth client. The server securely dispatches login and Calendar callbacks using their stored OAuth attempt. If you explicitly set `GOOGLE_LOGIN_REDIRECT_URI` to a different URL, register that exact URL too.
2. Keep Google consent in Testing mode and add each tester's Google account. For public hosting configure exact HTTPS callback URLs, `FRONTEND_ORIGIN`, `GOOGLE_LOGIN_REDIRECT_URI`, and `GOOGLE_REDIRECT_URI` for that deployment.
3. Set `AUTH_MODE=on`. `DATA_DIR` defaults to the root `data/` directory. It must be persistent and private. The account database is `central.sqlite`; random workspace directories contain each user's separate database and screenshots.
4. Set `COOKIE_SECURE=true` in HTTPS production. Set `TOKEN_ENC_KEY` to 32 random bytes encoded as 64 hexadecimal characters. Keep it secret and back it up. Local development without this variable creates a private `data/token.key` file. Do not replace the encryption key while stored tokens still use it.
5. `FREE_DAILY_CREDITS` defaults to 20. Owner accounts get 100. Set `OWNER_EMAIL` before the first owner login. Only Google's verified identity can bind that account. Existing local saves remain in the legacy database until an explicit migration.

Restart the backend after configuring these values. A user signs in with Google, confirms their name and verified email, then separately connects Calendar using the same Google account. Back on Overview, a new user confirms their timezone and chooses their goals before the first screenshot. No passwords or Google tokens are stored in browser storage. Sessions survive server restarts.

`AUTH_MODE=off` keeps the legacy local workspace for development and old tests. It is refused with `NODE_ENV=production`. Do not expose off mode through a public proxy.

Production uses one server process and persistent local disk. Horizontal scaling is not supported. The registry retains active work and evicts idle contexts when its 20-workspace cap is reached. The watcher checks connected accounts with three workers, timeouts, and per-workspace backoff.

Google publishing/verification is a separate release step and has not been completed here. Calendar scope verification can require a public homepage, privacy policy and a scope justification. Check Google's current consent configuration before admitting public users.

This phase implements login, sessions, private workspaces, CSRF, Calendar identity binding, encrypted tokens, usage limits, account deletion and safe UI error handling. The shared demo, trust-ledger API and owner-data migration remain separate work. No real Google sign-in or Calendar writes were performed by the automated auth tests.
