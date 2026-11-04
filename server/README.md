# SavedToAction server

Backend for SavedToAction, built for the Meta Global AI Developer Hackathon (Indie track). It turns a saved screenshot plus a note into a calendar block, protects that block when the calendar changes, and keeps the records the dashboard needs.

This file is the single hand-over document for the server. If you are new to the project, read it top to bottom once. Scope and product rules come from the project brief kept by the owner, and the brief wins if the two ever disagree.

Status on Nov 4 2026: Google login, persistent sessions, profile confirmation and private workspaces are enabled by default. Calendar connections are bound to the signed-in Google account. The backend also provides scheduling, extraction, metrics, lifecycle undo, completion titles and usage limits. Account deletion, the shared demo, trust ledger and legacy owner-data migration remain unavailable. Historical live-calendar evidence below predates the multiuser auth layer. See [account setup](../docs/AUTH_SETUP.md) and the [core API reference](docs/API.md).

Project reporting times are GMT+0. Scheduling uses each workspace's configured IANA timezone. The startup self-test requires Africa/Casablanca to be +00:00 at 2026-11-05T10:00Z.

## Contents

1. [Ground rules](#ground-rules)
2. [Quick start](#quick-start)
3. [Environment variables](#environment-variables)
4. [Code map](#code-map)
5. [The core flow](#the-core-flow)
6. [Data model](#data-model)
7. [API reference](#api-reference)
8. [Scheduling rules and states](#scheduling-rules-and-states)
9. [Timezones](#timezones)
10. [Extraction](#extraction)
11. [Google Calendar](#google-calendar)
12. [Recheck and the watcher](#recheck-and-the-watcher)
13. [The agent step and its trace log](#the-agent-step-and-its-trace-log)
14. [The model provider](#the-model-provider)
15. [Tests](#tests)
16. [Scripts](#scripts)
17. [What is verified, what is assumed](#what-is-verified-what-is-assumed)
18. [Known gaps and what to build next](#known-gaps-and-what-to-build-next)
19. [Design decisions and why](#design-decisions-and-why)

## Ground rules

- Preserve the scheduling, approval, timezone and data-isolation rules when extending the app.
- No invented deadlines, efforts, dates, links, prompts, metrics or urgency. Missing means null and is shown as missing.
- Writes to the user's real Google Calendar happen only after approval. Never create, change or delete an event on the real calendar unless the owner agreed to that specific action. Scripts under `../scripts` that write say so at the top.
- State clearly what is verified and what is assumed. Do not guess API details.
- Use moment-timezone for every wall time conversion and offset. Never Intl, Luxon or date-fns-tz. See [Timezones](#timezones).
- Run `npm test` after every change. The suite must stay green.
- Docs and messages: short and direct, no double hyphens, no semicolons, times in GMT+0.

## Quick start

Needs Node 22 or newer (developed on v22.21.0) and npm.

```sh
npm install
# New checkout only: copy ../.env.example to ../.env and fill in credentials.
npm start
npm test
```

The server loads the repository-root `.env`. Configure Google and Baseten credentials there, then start the web app with `npm --prefix ../web run dev`. Open **http://localhost:5173** to sign in and confirm your details. Connect Calendar separately in Settings with the same Google account, then set your timezone and working hours.

Register `http://localhost:3000/auth/google/callback` exactly as an authorized redirect URI on the OAuth web client. Login shares this existing Calendar callback by default. A custom `GOOGLE_LOGIN_REDIRECT_URI` must also be registered exactly. Add each account to Google's consent-screen test users while the client is in Testing mode.

Account mode stores the central database in `../data/central.sqlite` and each workspace under `../data/workspaces/<workspace_key>/`. The legacy local workspace remains in `server/data/`. New accounts do not inherit its saves or credentials. Back up private data and encryption keys outside Git.

For a public read-only health check, use `curl http://localhost:3000/ready`. Resource routes require a signed-in browser session and a complete profile. Writes additionally require the session's `X-CSRF-Token` and the configured Origin. The old `npm run smoke` script assumes the legacy API and is intended for an isolated `AUTH_MODE=off` development server.

Sign-out revokes the current app session. Disconnect Calendar in Settings to remove only that workspace's stored Calendar tokens. Neither operation deletes existing Calendar events. `DELETE /api/me` with `{approved:true,confirmation:"DELETE MY ACCOUNT"}` asks Google to revoke the Calendar grant, then removes that account's workspace folder, its account row and every session. Existing Calendar events are kept.

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `BASETEN_API_KEY` | none, required for extraction and agent when the provider is baseten | Baseten key for Muse Spark Open |
| `META_API_KEY`, `MODEL_API_KEY` | none, required when the provider is meta | Meta Model API key. `META_API_KEY` wins if both are set |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | none, required | OAuth web client. Add each tester while consent is in Testing mode |
| `GOOGLE_REDIRECT_URI` | `http://localhost:3000/auth/google/callback` | Must match the Google console exactly |
| `PORT` | `3000` | Server port. Binds to 127.0.0.1 only |
| `FRONTEND_ORIGIN` | `http://localhost:5173` | Allowed CORS origin, and where the OAuth callback redirects |
| `DB_PATH` | `server/data/savedtoaction.db` | Legacy local workspace, used only with `AUTH_MODE=off` |
| `SCREENSHOT_DIR` | `server/data/screenshots` | Legacy local screenshot directory |
| `MODEL_PROVIDER` | `baseten` | Provider switch: `baseten` or `meta` |
| `BASETEN_BASE_URL` | `https://inference.baseten.co/v1` | OpenAI compatible endpoint |
| `BASETEN_MODEL` | `meta-models/muse-spark-open-1026` | Model id |
| `BASETEN_REASONING_EFFORT` | `low` | One of minimal, low, medium, high. `off` or `default` sends nothing |
| `META_BASE_URL` | `https://api.meta.ai/v1` | Meta endpoint, OpenAI compatible. A trailing slash is removed |
| `META_MODEL` | `muse-spark-1.3` | Meta model id. An id ending in contributor is refused, for either provider |
| `META_FORCED_TOOL_CHOICE` | `auto` | How a forced tool call is asked for on Meta: `auto` with a strict instruction, or `required` once the smoke check shows it is accepted |
| `META_REASONING_EFFORT` | `low` | Same values as Baseten. `off` or `none` sends nothing, `none` is never sent as a value |
| `WATCHER` | on | `WATCHER=off` disables the background recheck |
| `WATCHER_INTERVAL_MS` | `300000` | Watcher period, 5 minutes |
| `AUTH_MODE` | `on` | Google login and per-account workspaces. `off` is local development only and is refused in production |
| `DATA_DIR` | repository-root `data/` | Persistent central database, per-account workspaces and local development encryption key |
| `GOOGLE_LOGIN_REDIRECT_URI` | `GOOGLE_REDIRECT_URI` or the default Calendar callback | Optional dedicated login callback, which must also be registered at Google |
| `OWNER_EMAIL` | empty | Verified email eligible for the owner account kind. Set before its first login |
| `COOKIE_SECURE` | false locally, true in production | Secure cookies for HTTPS |
| `TOKEN_ENC_KEY` | local key file in development | 64 hex characters for AES-256-GCM. Required in production |
| `FREE_DAILY_CREDITS` | `20` | Successful model operations per user per GMT day. Owners receive 100 |

## Code map

```
src/
  index.js              Entry point. Timezone self test (exit on failure), account or legacy app wiring, starts the watcher.
  auth/                 Account HTTP boundary, OIDC, sessions, workspace registry, encrypted credentials and usage budgets.
  app.js                Workspace Express app factory. CORS, health, settings, goals, auth routes, error handler. Dependencies are injected.
  config.js             Loads ../.env, exports config and APP_ID.
  db.js                 SQLite schema as append-only migrations (PRAGMA user_version), settings, token helpers and goal management (starter goals, add, edit, reorder, archive, first login setup).
  tz.js                 The ONLY place for wall time <-> UTC and offsets (moment-timezone). Self test.
  postLink.js           The link to the original post, kept as a reference: checks it, removes tracking, names the platform. Never fetches it.
  actions.js            Saves and actions: create from extraction, API view (badges, labels), validated PATCH.
  blockStore.js         Block and check persistence, block and check views, shared slot formatter (decorateSlot).
  stats.js              Goal metrics with the exact definitions (importedSaves, planned, markedDone, action rate, time scheduled...).
  watcher.js            Interval scheduler for the background recheck. Never overlaps, never throws.
  extraction/
    extract.js          Prompt, model call, JSON parsing, failure codes.
    normalize.js        Raw model JSON to trusted fields: badges, deadline rules, event dates, the note's intent, warnings.
    image.js            Downscale to 1280 px for the model call. Original is never touched.
  model/provider.js     Provider switch (baseten, meta). Chat with optional tools. Error codes.
  google/
    auth.js             OAuth flow, token storage and refresh persistence, status.
    calendar.js         Calendar client: FreeBusy, events.list, insert, patch, get, delete. CalendarError codes. buildEventBody.
  scheduler/            PURE functions. No clock, network or database.
    time.js             Working windows, interval math, grid, validation.
    slots.js            findSlot, latestFeasibleStart, resolveDeadline, red hints.
    conflicts.js        Event level conflict detection, busy from events, ignore rules.
    blocks.js           Idempotency keys, event ids, tags, active/superseded rules, planMove.
    evaluate.js         evaluateBlock (green/amber/red), proposeSlot, working hours check.
    readback.js         compareReadback (start, end, tz, offset, tags).
    intent.js           What the note asked for (when, how long): cleaning, labels, and the search window code builds from it.
    index.js            Re-exports.
  services/
    planning.js         propose, approve, move, readback, done, skip, plus read only agent helpers.
    recheck.js          recheckAction (button AND watcher), recheckAll, history.
    home.js             GET /api/home: next up, upcoming, needs attention, recent saves, inbox and alert counts, connected email.
  agent/agent.js        The agent step: read only tools, validation, trace log.
  routes/
    saves.js            Upload (note and post link) and extract, screenshot, action get and patch.
    planning.js         Propose, approve, move, recheck, agent, readback, done, skip, traces.
test/                   node:test. fakeCalendar.js is an in memory Google stand in.
../scripts/             Manual tools: live checks and experiments. See Scripts.
```

Rule of thumb: pure logic goes in `scheduler/`, orchestration in `services/`, HTTP in `routes/`. Services take the calendar, model provider and clock as injected dependencies so tests run against fakes with a fixed clock.

## The core flow

```
screenshot + note
  POST /api/saves                    store original, downscale copy, call model, normalize, create action (status open)
  PATCH /api/actions/:id             edit any field, confirm effort (confirmedEffortMin)
  POST /api/actions/:id/propose      read only: earliest valid slot, or why none (red) and what would change it. Takes the minutes on screen
                                     (effortMin, never saved) and tries the time the note asked for first
  POST /api/actions/:id/approve      approved:true (+ effortMin) -> approving confirms those minutes, fresh check, write event, read back,
                                     block saved, status planned
  POST /api/actions/:id/recheck      read only: green / amber / red against the real calendar (same code as the watcher)
  POST /api/actions/:id/move         approved:true -> new event, old block superseded, old event deleted and verified
  POST /api/actions/:id/done         approved:true for a booked task -> verified Done prefix, self-reported status done
```

Action status: `open` -> `planned` (an active block exists) -> `done` or `skipped`. `done` and `skipped` are closed: no edits, no planning. A block is active while `superseded_by` and `cancelled_at` are both null.

## Data model

SQLite via better-sqlite3. Migrations are an append-only array in `db.js`. `PRAGMA user_version` is the workspace schema version (currently 12). Table rebuilds run with foreign keys off, then `foreign_key_check` must be empty.

| Table | Purpose |
|---|---|
| `goals` | `name`, `description` (sent to the model with the name), `color` slot 0 to 5, `archived_at`, `position`. A new workspace starts with 6 general goals (Earn more, Learn a skill, Events and opportunities, Career growth, Health and wellbeing, Create and build). Users add, edit, reorder and archive up to 6 active goals. Two more general starters are offered (Travel and experiences, Home and family) |
| `saves` | screenshot filename, note (at most 160 characters), `source_url` (the post link, a reference only), `imported_at`, `is_demo` (imported demo history, labeled in the UI) |
| `actions` | one per save. kind (try, opportunity, other), label (claim, validate, read, someday, label only), title, goal_id (nullable, never defaulted), deadline wall plus tz plus `deadline_tz_source` (model, settings_fallback, user) plus computed `deadline_utc`, deliverables, verbatim items, `event_dates_json`, evidence quote, transcription, warnings, raw model output, `suggested_effort_min` (model) and `confirmed_effort_min` (user), status, `edited_fields_json`, done_at |
| `blocks` | action_id, `google_event_id`, `idempotency_key` (unique), start_utc, end_utc, tz, `superseded_by`, `cancelled_at`, `event_deleted_at`, read-back status and drift |
| `settings` | work_start, work_end, tz (defaults to `America/New_York`, migration v9 fills workspaces that had none and never changes a chosen one), `ignore_all_day` ("1" default) |
| `oauth_tokens` | one row per workspace. AES-256-GCM encrypted in account mode. Legacy off mode retains its original local JSON storage |
| `checks` | every Recheck result, newest wins in the view, kept as history. source manual or watcher |
| `agent_traces` | one row per agent run with all steps as JSON |
| `extraction_jobs` | persisted queued/running/completed extraction state |
| `action_transitions` | lifecycle changes supporting undo |

Also on `actions`: `intent_json` (what the note asked for, kept only if its words are in the note) and `deadline_time_assumed` (a date given with no time, so the deadline runs to 23:59 and is flagged).

Migration history: v1 base schema. v2 rebuilds `actions` (nullable goal_id, extraction columns). v3 adds `event_dates_json` and block read-back and cleanup columns. v4 adds `checks` and `agent_traces`. v5 adds extraction jobs and lifecycle transitions. v6 adds optional idempotent imports. v7 adds goal description, color and archiving. v8 shortens the default goal descriptions. v9 fills a missing timezone with the default. v10 records whether the user confirmed their timezone (`tz_confirmed`), trusting only a zone other than the default. v11 adds `deadline_time_assumed` for deadlines given as a date with no time. v12 adds `saves.source_url` and `actions.intent_json`. The historical v1-to-v4 migration retained tokens on a database copy.

The separate central database contains `accounts`, `sessions`, `oauth_requests`, `usage` and sanitized `auth_failures`. Accounts are identified by verified Google `sub`. Session tokens are hashed, and only random workspace keys appear in workspace paths. A cached context contains that account's database and Calendar client. Live jobs and requests prevent its eviction.

## API reference

Base `http://localhost:3000`. JSON everywhere, uploads are multipart. In account mode, private resource endpoints require a valid session cookie and complete profile. Writes require exact Origin and `X-CSRF-Token`. Errors retain machine-readable `{ error, detail?, field? }` for client decisions and diagnostics. The UI uses approved messages or a general fallback and never displays raw codes or details.

Account endpoints: `GET /auth/session`, `GET /auth/login/google`, `PATCH /api/me` with `{name}`, and `POST /auth/logout`. `/auth/session` returns identity, profile completeness, CSRF token, Calendar email and server-computed credits. Anonymous sessions return 200 with a CSRF bootstrap cookie. OIDC state is browser-bound, single-use and expires after ten minutes. Login and Calendar callbacks share the registered callback by default. Sessions last seven days and survive restarts.

**Health and setup**

| Route | Notes |
|---|---|
| `GET /health` | Account mode: service and timezone status. Legacy mode also returns workspace schema and Google status |
| `GET /api/timezones` | `{ zones: [{ id, offset }] }`. Canonical IANA names plus UTC with the current offset, computed by moment-timezone. Settings uses it for the timezone list. Aliases such as `US/Eastern` are not listed but stay valid in `PUT /api/settings` |
| `GET /api/timezone/setup`, `POST /api/timezone/setup` | `{ done, tz }`: whether the user confirmed their timezone. The POST takes `{ tz }`, saves it and marks it confirmed. Choosing a timezone with `PUT /api/settings` confirms it too |
| `GET /api/settings`, `PUT /api/settings` | `workStart`, `workEnd` (HH:mm, end may be 24:00), `tz` (IANA), `ignoreAllDay` (boolean). Partial updates. `tz: null` clears the timezone |
| `GET /api/goals` | active goals in the user's order, then archived ones. Each goal is `{ id, name, description, color, archived, position, metrics }`. `metrics` has `importedSaves`, `demoSaves`, `planned`, `markedDone`, `savesWithDoneAction`, `deadlinePassedWithoutCompletion`, `actionRate` (null with no saves), `timeScheduledMin`. Definitions are in `src/stats.js` and returned as `metric_definitions` by `/api/home` |
| `GET /api/goals/starters`, `GET /api/goals/setup`, `POST /api/goals/setup`, `POST /api/goals`, `PUT /api/goals/:id`, `PUT /api/goals/order`, `POST /api/goals/:id/archive`, `POST /api/goals/:id/restore` | goal management, see [API.md](docs/API.md) |
| `GET /api/home` | one read for the Home screen: `now` (server formatted), `google_connected`, `connected_email`, `next_up`, `upcoming`, `needs_attention`, `recent_saves`, `inbox_count` (+ `inbox` breakdown), `alerts_count`, `metric_definitions`. Top level keys are snake_case, items inside use the usual camelCase. Database records only, no model call |
| `GET /auth/google` | redirect to Google consent (offline access, forced consent) |
| `GET /auth/google/callback` | Dispatches login or Calendar using stored OAuth state. A successful Calendar connection redirects to Overview, so the first login steps show, and failures redirect to Settings. Mismatched Google identity is rejected before tokens are saved |
| `GET /auth/status`, `POST /auth/disconnect` | connection state, local disconnect |

**Saves and actions**

| Route | Notes |
|---|---|
| `POST /api/saves` | multipart: `image` (PNG, JPEG or WebP, checked by bytes, max 8 MB), `note` (max 160 chars, optional), `link` (the post link, optional, 400 `invalid_link` if it is not a web address). Returns `{ saveId, action, extraction: { ms, usage, image } }`. On a model failure: 502 and the save is kept |
| `POST /api/saves/:id/extract` | retry extraction for a save that has no action (409 if it already has one) |
| `GET /api/saves/:id/screenshot` | the stored original |
| `PATCH /api/saves/:id` | `{ note }` and/or `{ link }` (null or empty removes the link). Returns `{ saveId, note, link, action }`. Blocked during extraction |
| `GET /api/actions/:id` | full view, see below |
| `PATCH /api/actions/:id` | any of: `title`, `goalId`, `kind`, `label`, `deliverables`, `verbatimItems`, `eventDates`, `evidenceQuote`, `deadline` (`{wall, tz?, label?}` or `null`), `confirmedEffortMin` (1 to 1440 or null). 409 once done or skipped |

The action view also carries `link` (`{ url, host, platform }` or null), `intent` (`{ when, minutes, minutesQuote, label }` or null), `effort.statedMin` (minutes written in the note) and, on `deadline`, `short` (the date alone, such as `22 Nov`) and `timeAssumed`.

The action view includes: fields, `evidence` (quote, matches, badge, badgeLabel), `effort` (suggestedMin, confirmedMin, label "Model estimate" or "Your estimate", scheduledMin = confirmed only), `deadline` (wall, tz, tzSource, utc, display formatted by the server), `eventDates` with badges, `verbatimItems` with badges, `edited` (field names the user changed), `warnings` (hidden for fields the user has edited), `block` (active block with server formatted times and read-back), `check` (latest Recheck of the active block), `screenshotUrl`, `isDemo`.

**Planning (all times in responses are formatted by the server)**

| Route | Body | Notes |
|---|---|---|
| `POST /api/actions/:id/propose` | `{ effortMin?, notBeforeUtc? }` | read only. `effortMin` is the minutes on screen, used for this search only. `notBeforeUtc` asks for another time. If the note asked for a time it is tried first and `intent: { applied, label, reason? }` says whether it was met. `{ found, mode: new or move, source: freebusy or events, slot }` or `{ found: false, reason, explanation[], hints }` |
| `POST /api/actions/:id/approve` | `{ startUtc, endUtc, approved: true, effortMin? }` | `effortMin` is the minutes shown with the time and approving confirms them, and the block must be exactly that long. 201 with `{ action, block }`. The event description holds a link to the original post. Same slot again returns 200 `replayed: true` |
| `POST /api/actions/:id/move` | same | replaces the active block. `previous: { eventDeleted, deleteError }` |
| `POST /api/actions/:id/readback` | none | re-fetch the event and compare |
| `POST /api/actions/:id/recheck` | none | read only. `{ check, action }` |
| `GET /api/actions/:id/checks` | `?limit=` | check history, newest first |
| `POST /api/actions/:id/done` | `{ approved: true }` for a booked action | Adds and verifies `Done ·` on the active event, then marks the action done. Unbooked actions need no Calendar write |
| `POST /api/actions/:id/skip` | `{ removeFromCalendar?: true, approved?: true }` | calendar block removed only if asked |
| `POST /api/actions/:id/agent-plan` | `{ instruction? }` | the agent step, proposes only |
| `GET /api/actions/:id/traces`, `GET /api/traces/:id` | | agent runs and one full trace |

Instants in request bodies must be ISO 8601 with `Z` or an offset. A bare local time is rejected, because it would be read in the server's zone.

Error codes you will meet: `approval_required`, `invalid_slot`, `slot_length_mismatch` (block must equal confirmed effort exactly), `slot_in_past`, `outside_working_hours`, `after_deadline`, `already_planned`, `not_planned`, `same_slot`, `slot_no_longer_available` (carries `conflicts` and a fresh `alternative`), `action_closed`, `no_active_block`, `effort_not_confirmed`, `missing_timezone`, `deadline_missing_timezone`, `deadline_invalid_timezone`, `invalid_deadline`, `event_id_collision`, upload errors (`image_required`, `unsupported_image`, `file_too_large`, `note_too_long`, `image_unreadable`), model errors (`model_http_error`, `model_timeout`, `model_unreachable`, `model_truncated`, `model_empty`, `model_bad_json`, `model_not_configured`, `model_failed`), Google errors (`google_not_connected` 409, `google_missing_scopes` 409, `google_auth_error` 401, `google_forbidden`, `google_unavailable`, `google_unreachable`, `google_error`, `google_freebusy_error`, all 502 unless noted).

## Scheduling rules and states

Implemented in `scheduler/` (pure) and `services/planning.js`.

- Working hours default 09:00 to 21:00 local, editable. Never schedule outside them. Windows are computed per local day, so DST shifts the UTC edges correctly.
- One contiguous block per action. Block length equals confirmed effort exactly. Only confirmed effort is ever scheduled.
- Starts land on a 15 minute grid. With no deadline the search window is 14 days (a search bound, not an invented deadline).
- First slot search: event level read (`events.list`) while "Ignore all-day events" is on (default), because FreeBusy cannot exclude all-day events. FreeBusy only when that setting is off. A move always uses events.
- Before any write: fresh event level availability check. Our own old block and a leftover event from a crashed earlier attempt are not conflicts.
- Never subtract our block from an aggregated FreeBusy interval, it can hide a meeting inside our block.
- Events that do not block time: cancelled, marked free (`transparency: transparent`), declined by the calendar owner, all-day when the setting is on, and stale leftovers of our own superseded blocks.

States from `evaluateBlock`:

| State | Meaning |
|---|---|
| green | the current block fits |
| amber | the block has a problem and another valid slot exists before the deadline. The alternative and the reason are returned |
| red | no slot fits under working hours, confirmed effort and deadline. Says what would change it: `fitsIfEffortAtMost` and `fitsIfWorkingHoursExtended` |
| needs_input | timezone, confirmed effort or deadline timezone missing. No color is claimed |
| error | stored by Recheck when the calendar could not be read |

Problem types: `calendar_conflict`, `other_block_overlap` (another of our active blocks), `block_event_missing` (deleted from the calendar), `after_deadline`, `outside_working_hours`, `block_in_past` (time over, not marked done), `effort_changed` (block length differs from confirmed effort), `deadline_passed` (red).

An amber alternative prefers the nearest valid slot at or after the old block and only looks earlier if nothing later fits. The alternative search treats our own block as movable, so it may overlap the old window.

Wording is fixed: "latest feasible start, given your current availability and confirmed effort". Never "point of no return".

## Timezones

- Node 22.21 ships tzdata 2025b. Its Intl says Africa/Casablanca on 2026-11-05 is GMT+01:00. That is wrong.
- moment-timezone 0.6.6 (pinned, tzdata 2026f) says +00:00. That is right. Use it for every wall time to UTC conversion and every offset, in `tz.js` only.
- Startup self test: Casablanca at 2026-11-05T10:00Z must be +00:00 or the server exits. The log shows the tzdata version and, for information, what Node's Intl says.
- The model returns wall time plus an IANA name only. Code computes UTC. A UTC offset the model adds is ignored, so the captured +01:00 model mistake cannot leak in.
- The UI must show times formatted by the server. Never convert in the browser.
- Verified against Google on Nov 2: events sent as local wall time with no offset were converted by Google exactly as our data predicts on 4 dates (Nov 5, Dec 15, Jul 15, Mar 1 2026). Read-back after every write remains the check.

## Extraction

`POST /api/saves`: original saved, a copy downscaled to 1280 px on the longest edge (JPEG, EXIF applied, small images untouched), prompt built, model called, answer parsed and normalized, action stored. Raw model output is kept for audit.

The model returns: transcription, title, goal_id, kind, label, deadline (`wall` YYYY-MM-DDTHH:mm, `tz` IANA or null, `quote`, `label`, `year_assumed`), event_dates (verbatim `text`, `start`, `end`), deliverables, verbatim_items (prompt, link, keyword), evidence_quote, suggested_effort_min, and `intent` (what the note asked for: `when` as a day, a date or a part of the day with the exact words, and `minutes` with the exact words).

The goal list sent to the model is `id: name (description)` for the active goals only. The system prompt tells the model that a description only helps it choose.

Normalization rules (`extraction/normalize.js`):

- Every quote must appear in the note or the model's transcription. A deadline without a matching quote is dropped and kept only as a warning.
- Badges are precise: "Matched text in note", "Matched model transcription", "Edited by you", or "No match in note or model transcription". Never a general "Verified". Matching the model's own transcription proves consistency, not correct reading.
- A deadline already in the past at import is dropped with a warning (almost always a past edition). A date with no time becomes a deadline at 23:59 of that day, flagged `timeAssumed` and warned as `deadline_time_assumed`, and a user edit clears the flag. The action view also gives `deadline.short`, the date alone (`22 Nov`, with the year when it is not this year) in the deadline's zone, for chips. Missing year is assumed only with a warning.
- The timezone is used only if stated. If not, the settings timezone is used and labeled `settings_fallback`. With no settings timezone it stays null.
- `event_dates` are the event's own dates, separate from the deadline. If every supported date is before today the warning `event_already_happened` is raised. Date only comparison.
- The note is read for two things only, when and how long, and each is kept only if its quote is found in the note itself, never in the image. The date must be real and not in the past, minutes must be 1 to 1440, and anything else is dropped. `scheduler/intent.js` then turns it into a search window (not before, not after, and the hours of the day) inside the user's own working hours. The prompt tells the model to ignore other requests in the note.
- Goal is never defaulted. If the model gives none, `goal_not_chosen` and the user picks.
- Warning codes: `goal_not_chosen`, `kind_defaulted`, `verbatim_unmatched`, `evidence_unmatched`, `deadline_unsupported`, `deadline_in_past`, `deadline_time_assumed`, `deadline_invalid`, `deadline_timezone_fallback`, `deadline_timezone_missing`, `deadline_timezone_invalid`, `deadline_offset_ignored`, `deadline_year_assumed`, `event_already_happened`.

Real example, `flyer.png` (French hackathon poster for 6-7 JUIN 2026) with the note "I want to join the next edition": goal Join events and opportunities, kind opportunity, no deadline, event date kept verbatim and flagged as already happened, evidence quote matched in the note, effort a model estimate of 15 minutes.

## Google Calendar

- OAuth web client in Testing mode. Each account must be listed as a test user. A Calendar connection must match the app login identity. The app writes to the connected account's primary calendar only. Check which account is connected before a demo: the Google Calendar web UI must be signed in to that same account to see the blocks.
- Scopes: `calendar.events` and `calendar.freebusy`. They are enough for events.list, insert, get, delete and FreeBusy. They are not enough for `calendarList.get` (403), so the account email is read from the calendar title.
- Tokens are stored in the local SQLite file. Refreshed tokens are persisted without losing the refresh token.
- Our events: id `sta` plus the 32 hex idempotency key (Google accepts ids of a to v and 0 to 9, verified live), `extendedProperties.private` holds `stApp` and `stIdempotencyKey`, `transparency: opaque`, start and end sent as exact UTC instants plus the `timeZone`.
- Idempotency: key = hash of action id, start, end, plus an attempt number that counts earlier blocks of the same action at the same slot. A retry gets the same key (no duplicate event, a 409 from Google is recovered if the existing event carries our key). A move back to an old slot gets a new key and a new event id.
- Read-back after every write compares start, end, timezone, UTC offset and tags (`scheduler/readback.js`). Drift is flagged and stored, never silently fixed. If the read-back call itself fails the block is kept with status `failed` and can be re-verified with `POST /readback`.
- Deleting an event is verified by reading it back (Google keeps deleted ids readable as `cancelled`).
- A move writes the new event, commits the new block and supersedes the old one, then deletes the old event. If that delete fails the move still stands and the stale event is ignored by conflict detection (its key is superseded).
- Calendar errors are `CalendarError` with stable codes. `mapGoogleError` and `calendarErrorStatus` live in `google/calendar.js`.

## Recheck and the watcher

`services/recheck.js` has one function, `recheckAction({ actionId, source })`. The "Recheck now" route calls it with `source: "manual"`. The watcher calls `recheckAll`, which calls the same function for every planned action with `source: "watcher"`. A test proves the two give identical results apart from the label. The demo uses the button and never implies instant polling.

It reads events from the earlier of now and the block start up to the deadline (or 14 days), runs `evaluateBlock`, stores the result in `checks`, and returns it with every time formatted by the server. It never writes to the calendar. Moving to an amber alternative is a separate approved `POST /move`.

Account mode runs one scheduler over connected workspaces, with three workers, per-workspace timeouts and backoff. It checks every five minutes by default and isolates failures between workspaces. Legacy mode uses `watcher.js`. `WATCHER=off` disables background checking in either mode.

## The agent step and its trace log

`POST /api/actions/:id/agent-plan { instruction }`, for example "afternoon, not before tomorrow".

- The model (Muse Spark Open, tool calling) gets two read only tools: `get_availability(from_utc, to_utc)` (busy intervals, no event titles) and `find_slot(not_before_utc?)` (the earliest slot that satisfies every rule). It has no write tool.
- Its final answer must be exactly a slot that `find_slot` returned in that run. Code then re-validates it with the same checks approval uses (effort, clock, working hours, deadline, fresh event level read). If anything fails: outcome `rejected` plus a deterministic `fallback` (the earliest valid slot).
- Outcomes: `proposed`, `rejected`, `no_slot` (believed only if `find_slot` itself found none), `max_turns` (6), `failed` (model error, HTTP 502).
- A person still calls `/approve` or `/move`. The response only carries `approveWith` as a hint.
- The action's text comes from a screenshot, so it is passed to the model labeled as data. A slot invented because a post told the model to is rejected by code.
- Every run is stored in `agent_traces`: the prompts, each model turn (latency, completion and reasoning tokens, tool calls), each tool call (arguments, result, ok, ms), the final answer, the validation checks, the fallback and the outcome. Read it with `GET /api/traces/:id`. Step types: `start`, `model_request`, `model_response`, `tool_call`, `final`, `validation`, `fallback`, `error`, `end`.
- Preconditions (missing effort, timezone, closed action) stop before any model call and leave no trace.

Live run on Nov 2: 4 turns, 10 seconds, proposed a valid slot, wrote nothing.

## The model provider

`model/provider.js`: two providers behind `MODEL_PROVIDER`, Baseten (default) and Meta, one OpenAI compatible core. Both use `POST {base}/chat/completions` with a Bearer key. The facts below were verified on Baseten. Image input is a base64 data URL. Tool calling and image input are verified. JSON mode (`response_format`) is unverified and not used.

- Muse Spark Open is a reasoning model. Give it `max_tokens` 8000 for extraction. A real flyer used about 3200 reasoning tokens by default, far above the 600 to 700 seen on text only.
- `reasoning_effort` is accepted by Baseten and works. Default is now `low`. A bogus parameter also returns HTTP 200, so a 200 alone proves nothing. What proves it is the token and time drop.
- Measured on Nov 2, 5 screenshots (4 synthetic with known answers, 1 real flyer), 2 runs each:

| Config | Mean time | Mean reasoning tokens | Checks passed |
|---|---|---|---|
| default | 13.7 s | 2450 | 69/70 |
| low | 7.5 s | 520 | 69/70 |

  The one miss in each config was the same transcription check on the same screenshot, so it is not caused by the setting. Small sample, synthetic posts are cleaner than real ones.
- Downscaling to 1280 px cut prompt tokens by 34% on the flyer (3752 to 2492) and the upload from 2251 KB to 256 KB.
- Calls take several seconds. The UI needs loading states.
- The Meta Model API provider is built but unverified. Same request shape. If Meta answers HTTP 400 and the body mentions reasoning, the call is retried once without `reasoning_effort` and one line is logged, later calls skip it. The reasoning field is read as `reasoning_content` or `reasoning`. Meta answered HTTP 400 to a forced `tool_choice` object (smoke result), so on Meta a forced tool is asked for with `tool_choice` `auto`, only that tool and a strict system instruction. No tool call means one retry, then the error `model_no_tool_call`. Baseten still gets the object. `scripts/meta-smoke.mjs` runs plain text, JSON with a verbatim quote, forced and auto tool calls, image input and the Casablanca probe, probes `tool_choice` `required`, and prints every field that differs from what the code was built against. `--provider baseten` runs the same checks on Baseten. Until its results are checked, Baseten stays the default.
- The UI takes the model name from `GET /auth/session` (`model`), so it follows the active provider.

## Tests

`npm test` runs `node --test "test/*.test.js"`. 335 tests, using local HTTP where needed, with no external Google or model calls. They use:

- `test/fakeCalendar.js`: an in memory calendar with Google's behavior where it matters (unique ids with 409, deleted events stay readable as cancelled, events.list hides cancelled, FreeBusy merges, offsets in returned times, all-day events). `sim` switches on failures: wrong offset, shifted instants, changed timezone, stripped tags.
- A fixed clock (Mon 2 Nov 2026 12:00 UTC in most files) injected into `createApp`.
- A scripted fake model for the agent (each entry answers one chat call and can read the tool results sent back).
- `:memory:` SQLite, or a temporary folder under `server/data/` that tests delete.

Coverage includes `auth` (sessions, profile confirmation, CSRF, OAuth state, account isolation, same-account Calendar binding, encrypted credentials, credits and shared callbacks), `completion` (verified event titles, undo and failure recovery), `tz` (self test, conversions, display), `slots` (windows, DST, grid, deadlines, latest feasible start, red hints), `conflicts` (own events, stale, all-day, free, declined), `blocks` (keys, attempts, supersede), `evaluate` (states, problem types), `readback`, `calendar` (request shapes, pagination, error mapping), `planning` (propose, approve, replay, drift, crash recovery, move, move back, delete failure, done, skip, all-day setting), `recheck` (all states, history, watcher parity, watcher unit), `agent` (happy path, trace order, invented slot, changed calendar, tool errors, no slot, turn limit, model failure, preconditions, move mode), `saves` (upload, validation, badges, edits, event dates), `normalize`, `extract` (parsing, prompt rules, provider shape, tools), `image`, `db` (workspace migrations and constraints), `google` (OAuth URL, state, tokens), `app` (routes, settings). Newer files: `goals` (starter goals, limits, archive rules, the first login setup, migrations), `timezone-setup` (the default timezone and its confirmation), and `intent-note` (the post link, what the note asked for, proposing and approving with the minutes on screen). The signed-in app test covers goal management through the real routes.

When you add behavior, add the test in the same change. Keep tests deterministic: inject the clock, calendar and provider.

## Scripts

In `../scripts`. Run from the repo root with `node scripts/<name>.mjs`. Scripts marked WRITES create events on the real calendar and delete them again. Only run them with the owner's consent.

| Script | What it does | Writes to Google? | Model calls |
|---|---|---|---|
| `live-flow.mjs` | Full flow on the real calendar: propose, approve, recheck, add conflict, amber, move, read-back, recheck, cleanup. Uses a scratch copy of the database. Verified 8 of 8 on Nov 2 | WRITES (own events only, deleted by id) | none |
| `live-calendar-check.mjs` | One 15 minute event on 5 Nov 14:00 Casablanca, read back with `compareReadback`, deleted | WRITES | none |
| `live-timezone-probe.mjs` | Sends local wall times with no offset on 4 dates and compares Google's instant with ours, deletes each | WRITES | none |
| `effort-quality.mjs` | Compares reasoning_effort low vs default on 5 screenshots (renders 4 synthetic posts into `server/data/effort-test/`) | no | about 20 |
| `reasoning-effort.mjs` | Whether Baseten accepts reasoning_effort variants, with time and token counts | no | 8 |
| `smoke.mjs`, `debug.mjs` | Baseten smoke tests written on Nov 2 before the server existed. They produced the first verified facts, including the captured +01:00 model mistake | no | a few |

To inspect the calendar without writing (what the slot search sees), the pattern used on Nov 2 is a short inline script that imports `config`, `db`, `google/auth.js` and `google/calendar.js`, calls `listEvents`, and prints times only.

## What is verified, what is assumed

Verified by running it (Nov 2):

- Timezone self test, Casablanca +00:00 with tzdata 2026f, and Google agrees on 4 dates.
- Baseten: text, JSON extraction, tool calling, image input, reasoning_effort.
- Google: OAuth with both scopes, FreeBusy, events.list, insert with our id format, get, delete (reads back as cancelled), tags round trip, read-back with no drift.
- The full live flow on the real calendar, 8 of 8 steps, cleaned up.
- Migrations v1 to v4 on a copy of the real database.
- Agent run against the real model and real calendar (read only).

Assumed or not yet verified:

- A full live two-account login, booking and isolation run. Automated auth tests use a fake Google provider.
- Shared demo, trust-ledger API and legacy owner-data migration are not implemented.

- The background watcher against real Google over real time (tested with fake timers only).
- The agent in move mode against the real calendar (tested with the fake calendar).
- How the Google Calendar web UI renders the blocks (the API data is right on all probes).
- `response_format` JSON mode on Baseten and the Meta Model API.
- Extraction quality on a broad set of real screenshots. Only one real flyer was run. Step 8 (outside testers) is where this gets measured.

## Known gaps and what to build next

Build order from the project brief, with status:

1. Backend skeleton, schema, OAuth, timezone self test: done.
2. Scheduler pure functions with tests: done.
3. Extraction endpoint, editable fields, badges: done.
4. Approve, write, read-back, idempotency, move, done and skip: done.
5. Recheck now, same function as the watcher: done.
6. React UI exists in web/. UI fidelity and interaction completion require their own audit.
7. Stats queries with the exact metric definitions in the project brief: implemented and tested. Home and goals use database records. `scheduledMinutes` sums active, non superseded, non cancelled block minutes.
8. Test with 2 outside people using their own screenshots, record honest results: not started.
9. Root README and component setup guides: available.
10. Record the demo, make the repo public, submit: not started.

Current API status and remaining product limits:

- GET /api/actions, GET /api/saves, Home, goal metrics and workspace reads are implemented. The current complete route list is in [API.md](docs/API.md).
- Confirmed whole-workspace deletion and deleting a single save (with an option to remove its calendar block) are implemented.
- Open actions have no fabricated availability state. Request a proposal to evaluate a slot. Recheck covers approved blocks.

Other known limits:

- Account mode supports isolated users on one process with persistent disk and encrypted Calendar tokens. Use an HTTPS reverse proxy for hosting. Horizontal scaling and automatic legacy-data migration are not implemented.
- Primary calendar only, using the same Google identity as login. Testing-mode access depends on the configured test-user list.
- One contiguous calendar block per action. App login sessions are independent of planning blocks.
- Editing confirmed effort or the deadline after planning is allowed. Recheck then reports `effort_changed` or `after_deadline` as amber.
- Not built yet: Muse suggesting a new goal when a screenshot fits none of the user's goals, extraction in the background with a quick Book, Later or Skip triage, and a phone share target. How often the note's when and how long are read correctly is not measured.
- A new workspace starts in `America/New_York`. Someone who never confirms their timezone and works elsewhere gets blocks in Eastern time.
- Deferred by scope: claim workflow, reading queue, alerts page, MCP server, model commentary, background watcher UI.

## Design decisions and why

- **Scheduler is pure.** No clock, network or database inside it. That is why the button and the watcher can share one function, and why most behavior is unit tested without mocks.
- **Event level reads for conflicts.** FreeBusy merges overlapping busy periods, so a meeting inside our own block would disappear. A test pins this.
- **Ignore all-day events (default on).** It needs the event level read, so the first search no longer uses FreeBusy in that mode. This is a deliberate departure from the original FreeBusy-first plan.
- **Free events are ignored.** The hackathon block itself (a 225 hour busy event) blocked every slot until it was marked Free in Google Calendar. Keep it Free for the demo, otherwise nothing before Nov 5 can be scheduled.
- **Deadlines need evidence.** No supporting quote means no deadline. A past deadline at import is dropped. Dates without times are not given times.
- **Settings timezone fallback is labeled.** If the post states no timezone, the settings one is used and shown as `settings_fallback`.
- **Goal and effort are never defaulted.** Only confirmed effort is scheduled.
- **Approval is a flag in the request body** (`approved: true`), checked in the service, not in the UI. The agent has no path to it.
- **Idempotency key plus attempt number**, so retries never duplicate and a move back never collides with a deleted event id.
- **Move is replace, not update.** New event, supersede the old block, then delete the old event with verification. A failed delete leaves a stale event that conflict detection ignores.
- **Read-back flags, it does not fix.** Drift is shown to the user.
- **Needs input is its own state.** The scheduler never colors a state it cannot compute.
- **Reasoning effort low by default.** Same measured accuracy, about half the time. Switch with `BASETEN_REASONING_EFFORT=off` if quality ever drops.
- **Only the model's copy of the image is downscaled.** The stored original is untouched.
- **Traces are first class.** Every agent run is stored with all steps, so a rejected or odd proposal can always be explained.
