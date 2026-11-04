# SavedToAction: Google login and private workspaces (strong version)

Written Wed Nov 4. All times GMT+0. Hard close Thu Nov 5, 02:00.
Approved by Youssef. This file overrides the scope freeze for this feature only.
Built Nov 4, inside the hackathon window.

## 0. Session rules

1. First edit root CLAUDE.md (local only). Change the scope line to: "SCOPE FROZEN except docs/AUTH_PLAN.md (approved Nov 4)". Change nothing else. All hard rules, timezone rules, calendar rules and git rules stay.
2. Before any code: git tag pre-auth, copy the DB and screenshots to data/backup-pre-auth/. This is the rollback.
3. Server session (Claude Code) owns server/. Web session (Codex) works in web/ only and reads docs/API_MAP.md. Missing endpoints go to docs/BACKEND_GAPS.md.
4. One phase per session, /clear between. Targeted tests while working, full suite once per phase. Commit per phase. Report in max 6 lines.
5. No folder moves in server/. Refactor in place, smallest diff.
6. New server dependencies allowed: express-rate-limit, cookie-parser. Nothing else. No new web dependencies.
7. Say verified versus assumed. Never invent API details.

## 1. What makes it ours (the touch)

1. **Free credits.** Every account is on the free tier: 20 credits per day, refilled at 00:00. One credit per Muse Spark Open read (one extraction or one agent plan). Shown in Settings and in the New save dialog: "Free credits left today: 14 of 20". It is also the abuse guard for our Baseten usage. Server sends the display string. Default FREE_DAILY_CREDITS=20, owner 100, demo 0. The count comes from the usage table only. No payments, no paid tier, no purchase button in this version.
2. **Trust ledger.** A read only page of everything the app did on the user's behalf: each calendar write, who approved it and when, idempotency key, read back result, drift flags, moves, supersessions. Built from existing records, add a table only if none exists. Export as JSON. Fits "Code checks every write. You approve."
3. **Explore the demo.** A button on the login screen opens a shared read only demo workspace (the fixtures/demo seed, labelled "Imported demo data") with no Google needed. All writes return 403 demo_readonly, no Calendar connect, no Muse calls. Judges and testers can see the product without being added as Google test users.
4. **Privacy receipt** on the login screen, three lines that must match real behavior: what we store (name, email, screenshots you upload, calendar blocks we create), what we never do (no scraping, no reading your other calendar data beyond availability), and "Delete everything any time".

## 2. Architecture

**Central DB** (data/central.sqlite, WAL, foreign keys on)
- accounts: id, google_sub unique, email, email_verified, name, profile_completed_at, kind (owner, user, demo), workspace_key (random id, never the sub), calendar_sub (nullable), created_at
- sessions: id, token_hash (sha256), account_id, csrf_token, created_at, expires_at, last_seen_at, revoked_at
- oauth_requests: state_hash, nonce, code_verifier, browser_binding_hash, purpose (login or calendar), account_id (calendar only), expires_at (10 min), used_at
- usage: account_id, day (GMT), muse_calls
- Cleanup job for expired sessions and oauth requests.

**Workspaces.** data/workspaces/<workspace_key>/db.sqlite plus screenshots/. Everything private lives inside: saves, actions, settings, goals, tokens, jobs, traces, metrics.

**WorkspaceRegistry.** get(accountId) returns one ctx: db, calendar client, services, watcher state. Cached with an LRU cap (default 20) and idle close. Schema migration runs when a workspace DB opens. Never a global db or global calendar client. Route handlers only use req.ws.

**AUTH_MODE.** off means middleware injects the owner workspace and skips login (localhost dev, existing tests, emergency fallback). on means sessions are required. Same code path afterwards. The existing 250 tests must pass unchanged in off mode.

**Watcher.** One scheduler loop over connected workspaces. Each workspace check runs in its own try/catch with a timeout and per workspace backoff. Concurrency 3. Same 5 minute cadence. Recheck now calls the same function as before.

## 3. Auth and API

**Login flow**
- GET /auth/login/google: scopes openid email profile. State, nonce, PKCE (S256), stored hashed with the initiating browser binding (short lived cookie). Expires in 10 min, single use.
- GET /auth/login/google/callback: verify state and binding, exchange code with the verifier, verify the ID token server side (signature, iss, aud, exp, nonce, email_verified must be true). Identify by sub. Create or find the account. Rotate to a new session. Redirect to /app or /complete-profile. Denied consent returns to /login with a plain message.
- Redirect targets come from a fixed allowlist. No open redirects.

**Session**
- Opaque random token, only the hash is stored. Cookie sta_session: HttpOnly, SameSite=Lax, Path=/, Secure when COOKIE_SECURE=true (production). Lifetime 7 days, survives restarts.
- GET /auth/session returns: authenticated, kind, profile_complete, name, email, csrf_token, calendar status (connected account email or null), credits display string.
- POST /auth/logout revokes the session and clears the cookie.
- PATCH /api/me updates the display name only (1 to 80 chars, trimmed). Email is read only.
- DELETE /api/me with typed confirmation: revoke Google tokens at Google, delete workspace folder and rows, revoke all sessions. Optional checkbox "Also remove future blocks we created from my calendar" (reuse the existing removeFromCalendar logic).
- Demo session: POST /auth/demo creates a session for the demo account (rate limited).

**Protection**
- Every private route requires a session: 401 if missing or expired, 403 if profile incomplete. This includes screenshot downloads, extraction polling, trace streams, exports and deletion.
- State changing requests need X-CSRF-Token matching the session and an Origin in APP_ORIGIN allowlist.
- Rate limit all /auth routes and the Muse backed routes. Muse routes return 429 with a display string when the daily budget is spent.
- IDs resolve only inside req.ws. Another user's ID returns 404, never 403.
- Server SSE streams use the cookie (same origin), re-check the session on connect.
- Logs never contain cookies, tokens, codes or authorization headers.

**Calendar binding**
- Existing /auth/google stays, now requires a session and creates an oauth_request bound to the account. The authorized Google identity (sub) must equal the signed in account's sub. Mismatch rejects before saving tokens, with a clear message. Check whether the current flow requests openid and email scopes. Add them if not so identity can be read. (Unverified, read the code.)
- Disconnect Calendar removes tokens only. The login stays active.
- Tokens at rest: AES-256-GCM with TOKEN_ENC_KEY from env, key id prefix for rotation. Never in browser storage.
- Preserve approval, idempotency key, read back, timezone (moment-timezone only), completion title behavior. The startup timezone self-test stays.

## 4. Migration

scripts/migrate-multiuser.mjs, dry run first on a copy.
1. Back up DB and screenshots (timestamped).
2. Move the existing DB and screenshots into data/workspaces/<new key>/. Preserve all record IDs, settings, history.
3. Create the owner account with OWNER_EMAIL from env and no sub. First login with that verified email binds the sub. Nobody else can claim it, never the first random login.
4. Mark old Calendar tokens as needing reconnect (identity unknown). One time reconnect sets calendar_sub.
5. Print row counts per table before and after. Any mismatch aborts.
Rollback: restore backup, checkout tag pre-auth.

## 5. Web (Codex, web/ only)

Design system v2 and text rules from REBUILD_PLAN apply (tokens, Bricolage and Inter, no purple, no gradients, no banned words, buttons say the result, sentence case).

**Routes added:** /login, /complete-profile, /privacy (static, short). Rest unchanged.

**Copy (exact)**
| Place | Text |
|---|---|
| Login title | Saved is not done. Sign in to start |
| Primary | Continue with Google |
| Secondary | Explore the demo |
| Complete profile title | Confirm your details |
| Name field | Name |
| Email field | Email (from Google) |
| Complete profile button | Continue |
| Settings account | Account |
| Sign out | Sign out |
| Calendar connected | Connected as {email} |
| Wrong account | This calendar belongs to {other}. Connect the Google account you signed in with |
| Demo banner | Demo workspace. Read only. Imported demo data |
| Demo disabled hint | Sign in to do this |
| Credits | Free credits left today: {n} of {max} |
| Credits hint | 1 credit per Muse Spark Open read. Resets at 00:00 |
| Credits empty | No free credits left today. They reset at 00:00 |
| Ledger title | What the app did for you |
| Ledger export | Export JSON |
| Delete button | Delete my account and data |

**Behavior**
- Route guard renders nothing until /auth/session resolves. No flash of previous user data.
- api/client.ts adds the CSRF header, on 401 clears every in memory cache and navigates to /login.
- Sign out clears all state and hard navigates to /login. Nothing private in localStorage or sessionStorage.
- Dev: Vite proxies /api and /auth to :3000 so cookies stay same origin.
- Settings sections: Account (shows name and email, only the name is editable, email read only, Sign out button, delete), Calendar, Credits, Ledger link.
- Users can upload and review before connecting Calendar. Scheduling needs Calendar and working hours.
- Screenshots at 1440 and 390 for login, complete profile, settings, demo banner, empty credits.

## 6. Tests (all must pass before the gate)

1. Existing 250 server tests pass in AUTH_MODE=off, unchanged.
2. Two accounts with overlapping resource IDs: neither can read, change or delete the other's saves, screenshots, jobs, traces, exports, tokens, calendar operations.
3. First login, returning login, profile confirm, denied consent, replayed state, expired state, state from another browser.
4. Wrong Google account on Calendar connect is rejected and no tokens saved.
5. CSRF missing, CSRF wrong, bad Origin all rejected. 401 on expired session, 403 on incomplete profile.
6. Logout revokes. Session survives server restart. Expired session redirects without data flash.
7. Watcher: one workspace throwing does not stop the others.
8. Credits: limit reached returns 429 and only successful model calls cost a credit. Demo account makes no model calls. Credits reset at 00:00 GMT.
9. Demo account: every write endpoint returns 403 demo_readonly.
10. Account deletion removes only that user's data.
11. Registry LRU eviction and reopen loses no data.
12. Migration dry run on a DB copy, counts match.
13. Final: two real Google accounts, sign in, connect Calendar, one booking each, confirm no cross visibility.

## 7. Env and docs

.env.example adds: AUTH_MODE, APP_ORIGIN, GOOGLE_LOGIN_REDIRECT_URI, TOKEN_ENC_KEY, OWNER_EMAIL, DATA_DIR, COOKIE_SECURE, FREE_DAILY_CREDITS.
Google console (Youssef): add redirect http://localhost:3000/auth/login/google/callback. Keep the app in Testing mode and add test users.
docs/AUTH_SETUP.md: env vars, console steps, Testing versus Published, what Google verification needs for the Calendar scope (privacy policy, homepage, justification, possible review). State plainly that Google approval is a separate release step and not done.
README: short Auth section with honest limits.

## 8. Schedule (assumes it is about 06:30 now, shift if not)

| Time | Work | Gate |
|---|---|---|
| 06:30 to 06:45 | Phase 0: rules, tag, backup | tag exists |
| 06:45 to 09:15 | Phase 1: central DB, registry, req.ws refactor, AUTH_MODE | 250 tests green in off mode |
| 09:15 to 11:00 | Phase 2: login, session, CSRF, calendar binding. Freeze API contract at 09:45 | contract in docs/API_MAP.md |
| 09:45 to 14:00 | Web (parallel): login, profile, guard, settings, demo banner | screenshots |
| 11:00 to 12:30 | Phase 3: isolation, watcher, quotas, ledger, demo account | tests 2 to 11 green |
| 12:30 to 14:30 | Phase 4: migration dry run, then real migration, web finish | counts match |
| 14:30 to 15:30 | Real two account test | test 13 passes |
| **15:30** | **HARD GATE** | not green: checkout pre-auth, ship the frozen app |
| 15:30 to 17:30 | README, AUTH_SETUP, re-run the full demo flow, fix regressions | demo flow passes |
| 17:30 to 20:00 | Record demo (login max 10 seconds, or start signed in), edit | 3 min video |
| 20:00 to 22:00 | Repo public, submit, claim credits | submitted |
| 22:00 to 02:00 | Buffer only | |

## 9. Cut order

Cut first: /privacy page, ledger export, delete checkbox for calendar blocks, credits polish, mobile polish beyond basic layout.
Cut next: Explore the demo.
Never cut: pre-auth tag, isolation tests, CSRF, session checks, off mode parity, wrong account Calendar check, free credits limit.

## 10. Unverified

- Whether Google Testing mode expires refresh tokens after 7 days for this app (affects the watcher).
- Whether the current Calendar flow already requests openid and email.
- Google Testing mode test user cap (believed 100).
- Baseten rate limits under several concurrent users.
- Whether commits after submission count for judging.
