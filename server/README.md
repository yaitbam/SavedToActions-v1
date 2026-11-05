# SavedToAction server

The backend of [SavedToAction](../README.md), built for the Meta Global AI Developer Hackathon (Indie track). It turns a saved screenshot plus a note into a calendar block, protects that block when the calendar changes, and keeps the records the dashboard needs.

Where to look next: the [HTTP API contract](docs/API.md), the [web guide](../web/README.md), and the measured results in [docs/TEST_RESULTS.md](../docs/TEST_RESULTS.md). Project times are GMT+0. Scheduling uses each workspace's own IANA timezone.

## Rules the code follows

- **Approval first.** Nothing is written to a user's Google Calendar without an explicit approval in the request body (`approved: true`), checked in the service, not the UI. The model has no path to it.
- **No invented data.** No deadlines, efforts, dates, links, prompts or urgency that the post or the user did not state. Missing means null and is shown as missing.
- **moment-timezone for every wall time and offset**, in `src/tz.js` only. Never Intl, Luxon or date-fns-tz. See [Timezones](#timezones).
- **Every write is read back**, and drift is flagged, never silently fixed.
- **Tests stay green.** Run `npm test` after every change, and add the test with the change.

## Quick start

Needs Node 22 or newer.

```sh
npm install
npm start
npm test
```

From the repository root, copy `.env.example` to `.env` first and fill in the credentials (see the table below). The server reads that root `.env`, binds to `127.0.0.1:3000`, and the web app runs separately (`npm --prefix ../web run dev`). `GET /ready` is a public read only health check. Register `http://localhost:3000/auth/google/callback` as the OAuth redirect URI and add each tester as a test user while the client is in Testing mode.

Account mode stores the central database in `data/central.sqlite` and each workspace in `data/workspaces/<workspace_key>/`. The older single workspace in `server/data/` is only used with `AUTH_MODE=off`, and new accounts never inherit it. Sign-out ends the app session. Disconnecting Calendar removes only that workspace's tokens. `DELETE /api/me` with `{approved:true,confirmation:"DELETE MY ACCOUNT"}` asks Google to revoke the grant and removes the workspace, the account and its sessions. Events already on Google Calendar are kept.

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `MODEL_PROVIDER` | `baseten` | `baseten` or `meta` |
| `BASETEN_API_KEY` | none | Key when the provider is baseten |
| `BASETEN_BASE_URL`, `BASETEN_MODEL` | `https://inference.baseten.co/v1`, `meta-models/muse-spark-open-1026` | Endpoint and model id |
| `BASETEN_REASONING_EFFORT` | `low` | minimal, low, medium or high. `off` sends nothing |
| `META_API_KEY`, `MODEL_API_KEY` | none | Key when the provider is meta. `META_API_KEY` wins |
| `META_BASE_URL`, `META_MODEL` | `https://api.meta.ai/v1`, `muse-spark-1.3` | Endpoint (trailing slash removed) and model id. An id ending in contributor is refused for either provider |
| `META_REASONING_EFFORT` | `low` | Same values. `off` or `none` sends nothing |
| `META_FORCED_TOOL_CHOICE` | `auto` | `auto` (strict instruction) or `required`, once the smoke check shows Meta accepts it |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | none | OAuth web client |
| `GOOGLE_REDIRECT_URI` | `http://localhost:3000/auth/google/callback` | Must match the Google console exactly |
| `GOOGLE_LOGIN_REDIRECT_URI` | the value above | Optional dedicated login callback, also registered at Google |
| `AUTH_MODE` | `on` | `off` is local development only and is refused in production |
| `PORT`, `FRONTEND_ORIGIN` | `3000`, `http://localhost:5173` | Server port, allowed CORS origin and OAuth redirect target |
| `DATA_DIR` | `data/` at the repo root | Central database, workspaces and the dev encryption key |
| `OWNER_EMAIL` | empty | Verified email eligible for the owner account kind, set before its first login |
| `COOKIE_SECURE` | false locally, true in production | Secure cookies for HTTPS |
| `TOKEN_ENC_KEY` | a local key file in development | 64 hex characters for AES-256-GCM. Required in production |
| `FREE_DAILY_CREDITS` | `20` | Model operations per user per GMT day. Owners get 100 |
| `WATCHER`, `WATCHER_INTERVAL_MS` | on, `300000` | `WATCHER=off` disables background rechecks |
| `DB_PATH`, `SCREENSHOT_DIR` | `server/data/...` | The older single workspace, used only with `AUTH_MODE=off` |

## Code map

```
src/
  index.js              Entry. Timezone self test (exits on failure), wires the app, starts the watcher.
  app.js                Workspace Express app: CORS, health, settings, goals, routes, error handler. Dependencies are injected.
  config.js             Loads ../.env, exports config.
  db.js                 SQLite schema as append-only migrations (PRAGMA user_version), settings, goals.
  tz.js                 The only place for wall time <-> UTC and offsets. Startup self test.
  actions.js            Saves and actions: create from extraction, API view, validated PATCH.
  auth/                 Sessions, OIDC login, workspace registry, encrypted credentials, usage budgets.
  demo/loadDemo.js      The shared read only demo account and its loader.
  extraction/           extract.js (prompt, model call), normalize.js (raw JSON to trusted fields), image.js (downscale).
  model/provider.js     Provider switch (baseten, meta). Chat with optional tools.
  google/               auth.js (OAuth, tokens) and calendar.js (FreeBusy, events, CalendarError codes).
  scheduler/            PURE functions. No clock, network or database: slots, conflicts, blocks, evaluate, readback, intent.
  services/             planning.js (propose, approve, move, done, skip), recheck.js, home.js.
  agent/agent.js        The read only agent step and its trace log.
  routes/               saves.js, planning.js and the workspace, goals and timeline routes.
test/                   node:test. fakeCalendar.js is an in memory Google stand in.
```

Pure logic goes in `scheduler/`, orchestration in `services/`, HTTP in `routes/`. Services take the calendar, model provider and clock as injected dependencies, so tests run against fakes with a fixed clock.

## The core flow

```
screenshot + note
  POST /api/saves                 store original, downscale a copy, call the model, normalize, create an action (open)
  PATCH /api/actions/:id          edit any field, confirm effort
  POST /api/actions/:id/propose   read only: earliest valid slot, or why none and what would change it
  POST /api/actions/:id/approve   approved:true -> confirms the minutes shown, fresh check, write event, read back, status planned
  POST /api/actions/:id/recheck   read only: green, amber or red against the real calendar (same code as the watcher)
  POST /api/actions/:id/move      approved:true -> new event, old block superseded, old event deleted and verified
  POST /api/actions/:id/done      approved:true for a booked task -> verified Done prefix, status done
```

Status: `open` then `planned` (an active block exists) then `done` or `skipped`, which are closed. A block is active while `superseded_by` and `cancelled_at` are both null. The full routes, bodies and responses are in [docs/API.md](docs/API.md). Errors are `{ error, detail?, field? }` with stable codes (for example `approval_required`, `slot_length_mismatch`, `slot_no_longer_available`, `effort_not_confirmed`, `action_closed`, `model_*`, `google_*`). The UI maps codes to approved messages and never shows raw codes.

## Data model

SQLite via better-sqlite3. Migrations are an append-only array in `db.js`, and `PRAGMA user_version` is the workspace schema version.

| Table | Purpose |
|---|---|
| `goals` | name, description (sent to the model), color slot, archived, position. Six general starters, up to six active |
| `saves` | screenshot filename, note (at most 160 chars), `source_url` (a reference only), `imported_at`, `is_demo` |
| `actions` | one per save: kind, label, title, nullable `goal_id` (never defaulted), deadline wall plus tz plus computed UTC, deliverables, evidence quote, warnings, raw model output, `suggested_effort_min` (model) and `confirmed_effort_min` (user), status, `intent_json`, `deadline_time_assumed` |
| `blocks` | `google_event_id`, unique `idempotency_key`, start and end UTC, tz, `superseded_by`, `cancelled_at`, read back status and drift |
| `settings` | work hours, tz (default `America/New_York`), `ignore_all_day`, whether the timezone was confirmed |
| `oauth_tokens` | one row per workspace, AES-256-GCM encrypted in account mode |
| `checks`, `agent_traces`, `extraction_jobs`, `action_transitions` | recheck history, agent runs, persisted extraction state, undo support |

A separate central database holds `accounts`, `sessions`, `oauth_requests`, `usage` and sanitized `auth_failures`. Accounts are identified by the verified Google `sub`. Session tokens are stored hashed, and workspace paths use random keys, never the Google id.

## Scheduling rules and states

Implemented in `scheduler/` (pure) and `services/planning.js`.

- Working hours default to 09:00 to 21:00 local and are editable. Windows are computed per local day, so DST shifts the UTC edges correctly.
- One contiguous block per action, exactly as long as the confirmed effort. Only confirmed effort is ever scheduled. Starts land on a 15 minute grid. With no deadline the search window is 14 days (a search bound, not an invented deadline).
- The first search reads events (`events.list`) while "Ignore all-day events" is on (default), because FreeBusy cannot exclude them. Before any write, a fresh event level check runs. Our own old block is not a conflict. Never subtract our block from an aggregated FreeBusy interval, because it can hide a meeting inside our block.
- Events that do not block time: cancelled, marked free, declined by the calendar owner, all-day events when the setting is on, and stale leftovers of our own superseded blocks.

| State | Meaning |
|---|---|
| green | the current block fits |
| amber | it has a problem and another valid slot exists before the deadline. The alternative and the reason are returned |
| red | no slot fits working hours, confirmed effort and deadline. It says what would change it |
| needs_input | timezone, confirmed effort or deadline timezone is missing. No color is claimed |
| error | stored by Recheck when the calendar could not be read |

Problem types include `calendar_conflict`, `other_block_overlap`, `block_event_missing`, `after_deadline`, `outside_working_hours`, `block_in_past`, `effort_changed` and `deadline_passed`. The wording is fixed: "latest feasible start, given your current availability and confirmed effort".

## Timezones

- Node 22 ships tzdata whose Intl says Africa/Casablanca on 2026-11-05 is GMT+01:00. That is wrong. moment-timezone 0.6.6 (pinned, tzdata 2026f) says +00:00, which is right.
- The startup self test requires Casablanca at 2026-11-05T10:00Z to be +00:00, or the server exits.
- The model returns a wall time plus an IANA name only. Code computes UTC. An offset the model adds is ignored, which is how the captured +01:00 model mistake cannot leak in.
- The UI shows times formatted by the server and never converts in the browser.
- Checked against Google: events sent as local wall time with no offset were converted exactly as our data predicts on 4 dates.

## Extraction

`POST /api/saves` keeps the original, sends a copy downscaled to 1280 px, builds the prompt (the goals as `id: name (description)`), parses and normalizes the answer, and stores the action with the raw output for audit.

- Every quote must appear in the note or the model's transcription, or the deadline is dropped and kept only as a warning. Badges say exactly what matched ("Matched text in note", "Matched model transcription", "Edited by you"), never a general "Verified".
- A deadline already in the past at import is dropped (almost always a past edition). A date with no time becomes 23:59 that day, flagged as assumed until the user sets a time. A missing year is assumed only with a warning.
- The timezone is used only if stated. Otherwise the workspace timezone is used and labeled `settings_fallback`.
- `event_dates` are the event's own dates, separate from the deadline. If every supported date is past, the warning `event_already_happened` is raised.
- The note is read for two things, when and how long, each kept only if its quote is in the note itself. `scheduler/intent.js` turns it into a search window inside the user's working hours. The prompt tells the model to ignore any other request in the note.
- The goal is never defaulted. If the model gives none, or only a catch-all such as "Others", the user picks one.
- A screenshot the model judges not to be a saved post is refused with `not_a_post`, nothing is kept and the credit is given back.

## Google Calendar

- OAuth web client in Testing mode. A Calendar connection must match the app login identity. The app writes to the connected account's primary calendar only.
- Scopes: `calendar.events` and `calendar.freebusy`, enough for events and FreeBusy but not `calendarList.get`, so the account email is read from the calendar title.
- Our events: id `sta` plus the 32 hex idempotency key, `extendedProperties.private` with `stApp` and `stIdempotencyKey`, `transparency: opaque`, and exact UTC instants plus a `timeZone`.
- Idempotency: the key hashes action id, start, end and an attempt number, so a retry never duplicates and a move back to an old slot gets a new key and event id.
- Read back after every write compares start, end, timezone, offset and tags. Drift is stored and shown. Deleting an event is verified by reading it back as cancelled.
- A move writes the new event, supersedes the old block, then deletes the old event. If that delete fails, the move still stands and conflict detection ignores the stale event.
- The event description links to the post and to the save in the app. The screenshot itself is never sent to Google.

## Recheck and the watcher

`services/recheck.js` has one function, `recheckAction`. The "Recheck now" button and the watcher call the same code, and a test proves they give identical results. It reads events up to the deadline, runs `evaluateBlock`, stores the result and never writes to the calendar. Moving to an amber alternative is a separate approved `POST /move`. Account mode runs one scheduler over connected workspaces every five minutes with three workers, per workspace timeouts and backoff, so one workspace failing does not stop the rest.

## The agent step

`POST /api/actions/:id/agent-plan { instruction }`, for example "afternoon, not before tomorrow".

- The model gets two read only tools: `get_availability` (busy intervals, no event titles) and `find_slot`. It has no write tool.
- Its answer must be a slot `find_slot` returned in that run. Code revalidates it with the same checks as approval. Otherwise the outcome is `rejected` with a deterministic fallback (the earliest valid slot). Outcomes: `proposed`, `rejected`, `no_slot`, `max_turns` (6) and `failed`.
- Text from the screenshot is passed to the model labeled as data, and a slot invented because a post told the model to is rejected by code.
- Every run is stored in `agent_traces` (prompts, each model turn, each tool call, the validation and the outcome) and read with `GET /api/traces/:id`.

## Model providers

`model/provider.js` has two providers behind `MODEL_PROVIDER` on one OpenAI compatible core: `POST {base}/chat/completions` with a Bearer key and images as base64 data URLs. The UI takes the model name from `GET /auth/session` (`model`), so it always names the model actually used and never calls a non open model open weights.

- **Baseten (default).** Muse Spark Open is a reasoning model, so extraction uses `max_tokens` 8000. `reasoning_effort` is accepted and defaults to `low`. Tool calling and image input are verified. JSON mode is not used because it was never verified.
- **Meta (built, partly verified).** Same request shape. A 400 that mentions reasoning is retried once without `reasoning_effort`. Meta answered 400 to a forced `tool_choice` object, so a forced tool is asked for with `auto`, only that tool and a strict instruction. No tool call means one retry, then the error `model_no_tool_call`. `scripts/meta-smoke.mjs` checks all of this, and `--provider baseten` runs the same checks on Baseten.

Reasoning effort, measured on 5 screenshots (4 synthetic with known answers, 1 real flyer), 2 runs each:

| Config | Mean time | Mean reasoning tokens | Checks passed |
|---|---|---|---|
| default | 13.7 s | 2450 | 69/70 |
| low | 7.5 s | 520 | 69/70 |

The one miss in each config was the same transcription check on the same screenshot, so the setting did not cause it. It is a small sample, and synthetic posts are cleaner than real ones.

## Demo account

The shared demo account (`kind` demo) is what "Explore the demo" opens. `scripts/load-demo.mjs` creates it and imports the screenshots in `fixtures/demo/` through the normal `POST /api/saves`, with a live model call or by replaying answers recorded in `fixtures/demo/extracted.json`. `POST /auth/demo` opens a session for it. Every write by the demo answers 403 `demo_readonly` (including renaming it), its credit limit is 0, and it has no calendar. The loader is in `src/demo/loadDemo.js`.

## Tests

`npm test` runs `node --test "test/*.test.js"` with no external Google or model calls. The suite uses an in memory calendar that mimics Google where it matters (unique ids, deleted events readable as cancelled, FreeBusy merging, all-day events, injectable failures such as a wrong offset or shifted instants), a fixed clock, a scripted fake model and `:memory:` SQLite. It covers auth and account isolation, scheduling, conflicts, read back, recheck, the agent, extraction and normalization, goals, timezones, the model providers and the demo. Keep tests deterministic: inject the clock, calendar and provider.

## Scripts

In `../scripts`, run from the repo root with `node scripts/<name>.mjs`. Scripts marked WRITES create events on a real calendar and delete them again, so only run them against your own calendar.

| Script | What it does | Writes to Google? |
|---|---|---|
| `load-demo.mjs` | Loads the demo screenshots into the demo account | no |
| `meta-smoke.mjs` | Checks a model provider: text, JSON, tool calls, image input, timezone probe | no |
| `prepublish-check.mjs` | Scans the tree and history for secrets and unapproved images before publishing | no |
| `live-flow.mjs` | Full flow on a real calendar: propose, approve, recheck, conflict, move, read back, cleanup | WRITES |
| `live-calendar-check.mjs` | One 15 minute event, read back and deleted | WRITES |
| `live-timezone-probe.mjs` | Compares Google's instant with ours on 4 dates, deletes each | WRITES |
| `effort-quality.mjs`, `reasoning-effort.mjs` | Compare `reasoning_effort` settings on a real extraction (about 20 and 8 model calls) | no |
| `smoke.mjs`, `debug.mjs` | Early Baseten smoke tests | no |

## Verified and not verified

Verified by running it: the timezone self test and Google's agreement on 4 dates, the OAuth flow with both scopes, FreeBusy, events.list, insert, get, delete and tag round trips with no read back drift, the full live flow on a real calendar (8 of 8 steps, cleaned up), an agent run against the real model and a real calendar (read only), and Baseten text, JSON, tool calling and image input.

Not verified: a live two account login, booking and isolation run (automated auth tests use a fake Google provider), the background watcher against real Google over real time, the agent in move mode against a real calendar, how the Google Calendar web UI renders the blocks, `response_format` JSON mode, most of the Meta provider, and extraction quality on a broad set of real screenshots.

## Known limits

- One server process with persistent disk. Use an HTTPS reverse proxy for hosting. Horizontal scaling, the trust ledger API and migration of the older single workspace are not built.
- Primary calendar only, one contiguous block per action. Editing confirmed effort or the deadline after planning is allowed, and Recheck then reports `effort_changed` or `after_deadline` as amber.
- A new workspace starts in `America/New_York`. Someone who never confirms their timezone and works elsewhere gets blocks in Eastern time.
- Not built: suggesting a new goal when a screenshot fits none, extraction in the background with a quick Book, Later or Skip triage, and a phone share target.

## Design decisions

- **The scheduler is pure.** No clock, network or database, so the button and the watcher share one function and most behavior is tested without mocks.
- **Event level reads for conflicts.** FreeBusy merges overlapping busy periods, so a meeting inside our own block would disappear. A test pins this.
- **Deadlines need evidence.** No supporting quote means no deadline, and dates without times are never given times.
- **Goal and effort are never defaulted.** Only confirmed effort is scheduled.
- **Move is replace, not update.** New event, supersede the old block, then delete the old event with verification.
- **Read back flags, it does not fix.** Drift is shown to the user.
- **Needs input is its own state.** The scheduler never colors a state it cannot compute.
- **Reasoning effort is low by default.** Same measured accuracy at about half the time. Set `BASETEN_REASONING_EFFORT=off` if quality ever drops.
- **Only the model's copy of the image is downscaled.** The stored original is untouched.
- **Traces are first class.** Every agent run is stored with all its steps, so an odd proposal can always be explained.
