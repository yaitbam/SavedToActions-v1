# API map (core flow)

Read from server/src on Nov 3 (Phase 0). Source of truth for web sessions. Web never edits server/.
Longer contract with every route: server/docs/API.md. This file is the compact core flow only.
Base http://localhost:3000. Vite proxies /api and /auth. JSON in and out, no cookies, no auth header.
Errors: `{ error: "code", detail?: "text", field?: "name" }` with a 4xx or 5xx status.
Writes from a browser need the Origin header equal to the frontend origin or be absent.
All times: `*Utc` are ISO instants, `*Display` are server strings like `Thu 5 Nov 2026, 18:00 (+00:00)`. `*Relative` are short strings relative to now: `Today 18:30`, `Tomorrow 09:00`, `Yesterday 22:00`, `Thu 14:00` (2 to 6 days ahead), else `Thu 12 Nov 14:00` (year added when it differs). Slots, blocks and ranges also carry `rangeRelative` like `Thu 14:00 to 15:00`. Relative strings are computed per response, never stored. The browser never converts.
IDs are positive integers. Other routes exist (export, delete data, trace stream, undo, restore, readback, timeline, capabilities). Not used by the core flow.

## Auth and settings

| Method, path | Body | Response |
|---|---|---|
| GET /auth/status | none | `{ configured, connected, hasRefreshToken, missingScopes[] }` |
| GET /auth/google | none | 302 to Google. 503 `google_not_configured` |
| GET /auth/google/callback | query | 302 to `{frontend}/?google=connected\|partial\|denied\|error` |
| POST /auth/disconnect | `{}` | same shape as auth status |
| GET /api/settings | none | `{ workStart "HH:mm", workEnd "HH:mm" or "24:00", tz IANA or null (new workspaces start with America/New_York), ignoreAllDay bool }` |
| PUT /api/settings | any of the four keys | the saved settings. 400 `invalid_working_hours`, `invalid_timezone`, `invalid_ignore_all_day` |
| GET /api/goals | none | Active goals in order, then archived: `[{ id, name, description, color 0 to 5, archived, position, metrics }]` |
| GET /api/goals/starters | none | The eight general starter goals `[{ name, description }]` |
| GET /api/goals/setup, POST /api/goals/setup | `{ skip: true }` or `{ goals: [{ name, description? }] }` | First login choice. GET gives `{ done }`. POST replaces the starting goals with the user's choice (1 to 6), or keeps them |
| POST /api/goals | `{ name, description? }` | 201 the goal. 409 `goal_name_exists`, `goal_limit_reached`. At most six active goals |
| PUT /api/goals/order | `{ ids }` | every active goal once, in the new order |
| POST /api/goals/:id/archive, POST /api/goals/:id/restore | none | Archive only a goal with no saves (409 `goal_in_use`) and never the last active one (409 `last_active_goal`) |
| GET /api/timezone/setup, POST /api/timezone/setup | `{ tz }` | `{ done, tz }`. Confirms the user's timezone. Choosing one with PUT /api/settings confirms it too |
| PUT /api/goals/:id | any of `{ name, description, color }` | the goal. 400 `invalid_goal_or_name`, `goal_name_too_long`, `goal_description_too_long`, `invalid_goal_color`. 409 `goal_name_exists` |

Goal `metrics`: `{ importedSaves, demoSaves, planned, markedDone, savesWithDoneAction, deadlinePassedWithoutCompletion, actionRate (0 to 1 or null), timeScheduledMin }`. Definitions are in `metric_definitions` of GET /api/home and `definitions` of GET /api/insights.
Goal presets for a fresh database: "Earn more", "Learn a skill", "Events and opportunities" (ids 1 to 3). An existing database keeps the names it has. Extraction receives the current goal list (id and name) and `goalId` is one of those ids or null.

## Home and week

| Method, path | Response |
|---|---|
| GET /api/home | `{ now{utc,tz,display}, google_connected, connected_email, next_up (Summary or null), upcoming[Summary + state], needs_attention[{ action Summary, state, reason, text, reasons[] }], recent_saves[{ saveId, importedAt, importedAtDisplay, note, screenshotUrl, isDemo, extraction, action Summary or null }], inbox_count, inbox{needs_effort,failed_extractions}, alerts_count, metric_definitions }` |
| GET /api/week?date=YYYY-MM-DD | `{ tz, days[{ date, label, startDisplay, endDisplay, now, deadline, chips[{ title, kind "busy" or "prep", left, width, startDisplay, endDisplay }] }], maxDays, weekLabel, previousDate, nextDate, todayDate }`. 409 `missing_timezone`. Chips include all calendar events. Our blocks have kind "prep". The web filters on that |

Summary (home lists): `{ id, saveId, title, kind, status, goalId, isDemo, screenshotUrl, deadline{wall,tz,utc,display} or null, effort, block{id,startUtc,endUtc,tz,durationMin,startDisplay,endDisplay,readback{status}} or null, check{id,state,reason,source,checkedAt,checkedAtDisplay,latestFeasibleStart} or null, warnings[codes] }`.
`needs_attention[].state`: `red` (also deadline passed), `amber`, `needs_input`, `error`, `readback_drift`, `readback_failed`.
Saves missing a goal or effort are not in needs_attention. They show in `recent_saves` and `inbox`. The web filters on `goalId == null` and `effort.confirmed == false`.

## Saves and extraction

| Method, path | Request | Response |
|---|---|---|
| POST /api/saves | multipart: `image` (png, jpeg, webp), `note` optional (at most 160 characters, else 400 `note_too_long`), `link` optional (the post link, else 400 `invalid_link`). Header `Idempotency-Key` optional. `?async=true` optional | 201 `{ saveId, action (Action), extraction{ ms, usage, image{...} } }`. Async: 202 `{ saveId, jobId, extractionStatus, statusUrl }`. Errors: 400 `image_required` `note_too_long`, 415 `unsupported_image`, 422 `image_unreadable`, 502 extraction error code with `saveId`, 409 `extraction_in_progress` |
| GET /api/extractions/:id | none | job `{ id, state "queued\|running\|done\|failed", ... }`. Other job fields: unclear |
| POST /api/saves/:id/extract | `{}` | same as POST /api/saves. Retry after 502. 409 `already_extracted`. `/retry` is an identical alias |
| GET /api/saves | query `status` (review, input, reviewed, queued, running, failed, done), `limit` (max 100), `offset` | `{ items[{ saveId, note, importedAt, importedAtDisplay, screenshotUrl, isDemo, extraction, jobId, action Action or null }], total, offset, limit }` |
| GET /api/saves/:id | none | `{ saveId, note, link { url, host, platform } or null, importedAt, importedAtDisplay, isDemo, screenshotUrl, extractionStatus, job, action or null }` |
| PATCH /api/saves/:id | `{ note }` and/or `{ link }` (null or empty removes it) | `{ saveId, note, link, action }`. 400 `invalid_note`, `invalid_link`. 409 while extracting |
| GET /api/saves/:id/screenshot | none | image bytes. Use as `<img src>` through the proxy |
| GET /api/actions | query `q`, `goal`, `kind`, `status`, `has_deadline`, `saved` (all, risk, later, week), `sort`, `limit`, `offset` | `{ items[Action], total, offset, limit, countsByView{all,risk,later} }`. `status` accepts open, planned, done, skipped, fits, conflict, doesnt_fit, needs_input, error, event_passed |

## Action

GET /api/actions/:id returns Action:
```
{ id, saveId, status "open|planned|done|skipped", goalId|null, kind "try|opportunity|other", label "claim|validate|read|someday"|null,
  title, note, link { url, host, platform } or null, intent { when, minutes, minutesQuote, label } or null, transcription, screenshotUrl, isDemo,
  block: Block|null, check: Check|null, doneAt, doneAtDisplay, doneAtRelative,
  deadline: { wall, tz, tzSource, tzSourceLabel, utc, display, relative, short (the date alone, such as 22 Nov), label, quote, yearAssumed, timeAssumed (a date with no time, so 23:59 is used) } | null,
  eventDates[{ text, start, end, matches, badge, badgeLabel }],
  deliverables[string],
  verbatimItems[{ type "prompt|link|keyword", text, matches, badge, badgeLabel }],
  evidence{ quote, matches{note,transcription}, badge, badgeLabel },
  effort{ suggestedMin|null, statedMin|null (minutes written in the note), confirmedMin|null, confirmed bool, label "Model estimate"|"Your estimate"|null, scheduledMin },
  edited[fieldNames], warnings[{ code, field?, proposed?, ... }], model (model name string), extractionLatencyMs (int|null),
  hasTimezoneCorrection (bool), createdAt }
```
Block: `{ id, actionId, googleEventId, idempotencyKey, startUtc, endUtc, tz, durationMin, startDisplay, endDisplay, startRelative, endRelative, rangeRelative, supersededBy, cancelledAt, eventDeletedAt, readback{ status "ok|drift|failed|null", at, atDisplay, drift[{field,expected,actual}], driftDisplay[{field,expectedDisplay,actualDisplay}], error } }`.
Check: `{ id, blockId, checkedAt, checkedAtDisplay, source "manual|watcher", state "green|amber|red|needs_input|error", reason, tz, explanation[string], conflicts[{...,startDisplay,endDisplay}], problems[string], alternative Slot|null, hints|null, latestFeasibleStart Slot+label|null, ownEventFound, deadline{utc,display}|null }`.
Slot: `{ startUtc, endUtc, tz, durationMin, startDisplay, endDisplay, startRelative, endRelative, rangeRelative }`. Check also has `checkedAtRelative`, `deadline.relative`, and the same relative fields on `conflicts`, `alternative`, `latestFeasibleStart` and `hints.fitsIfWorkingHoursExtended`.
UI mapping: green is Fits, amber is Conflict (`alternative` holds the move target), red is Doesn't fit.

| Method, path | Body | Response |
|---|---|---|
| GET /api/actions/:id | none | Action. 404 `not_found` |
| PATCH /api/actions/:id | any of `title`, `goalId` (id or null), `kind`, `label`, `deliverables[]`, `verbatimItems[{type,text}]`, `eventDates[{text,start,end}]`, `evidenceQuote`, `deadline` (`null` or `{ wall "YYYY-MM-DDTHH:mm", tz?, label? }`), `confirmedEffortMin` (int 1 to 1440 or null) | Action. 400 `invalid_*` with `field`. 409 `action_closed`, `operation_in_progress` |
| POST /api/saves/:id/confirm | `{ confirmedEffortMin }` | Action. 400 `effort_required`. 409 `not_extracted` |

Missing values are null. Show null as "Missing".

## Planning (all POST, per action)

Failures return `{ error, detail?, ... }`. Common: 404 `not_found`, 409 `action_closed`, `missing_timezone`, `effort_not_confirmed`, `operation_in_progress`. Google errors map from CalendarError (status varies).

| Method, path | Body | Response |
|---|---|---|
| POST /api/actions/:id/propose | `{ effortMin?, notBeforeUtc? }` | Read only. `effortMin` is the minutes on screen and is not saved. `notBeforeUtc` asks for another time. If the note asked for a time it is tried first and the answer adds `intent { applied, label, reason? }`. Found: `{ mode "new\|move", found true, slot Slot, source "events\|freebusy", latestFeasibleStart Slot+label\|null }`. Not found: `{ mode, found false, reason, hints, explanation[], source }`. Both are 200 |
| POST /api/actions/:id/agent-plan | `{ instruction }` | Read only. Success: `{ traceId, outcome "proposed\|rejected\|no_slot\|max_turns", mode, proposal Slot\|null, rationale, rejected[], fallback Slot\|null, noSlot{reason,explanation}\|null, failure, usage, turns, approveWith{ endpoint "approve\|move", startUtc, endUtc }\|null, note }`. Failure: 502 `model_failed` with `traceId`, `fallback`. Takes seconds. Max instruction length and `rationale` type: unclear |
| POST /api/actions/:id/approve | `{ approved: true, startUtc, endUtc, effortMin? }` | Approving with `effortMin` confirms those minutes and the block must be exactly that long. 201 `{ replayed false, action Action, block Block }`. Replay of the same slot: 200 `replayed true`. Errors: 400 `approval_required` `invalid_slot`, 409 `already_planned` `slot_no_longer_available` (with `conflicts`), 422 `slot_length_mismatch` `slot_in_past` `outside_working_hours` `after_deadline`. The server derives the idempotency key |
| POST /api/actions/:id/move | `{ approved: true, startUtc, endUtc }` | 201 `{ action, block (new), previous{ id, eventDeleted, deleteError } }`. Old block becomes superseded. Extra errors 409 `not_planned`, `same_slot` |
| POST /api/actions/:id/recheck | `{}` | `{ check Check, action Action }`. Reads the calendar, never writes. 409 `not_planned`. A failure may carry `check` |
| POST /api/actions/recheck | `{ ids: [int] }` max 100 | `{ results[{ actionId, ok, status, check?, action?, error? }], calendarUnchanged: true }`. Used for "Recheck now" on Home. Non planned ids return `not_planned` or `action_closed` |
| GET /api/actions/:id/checks | query `limit` (max 100) | `{ checks[Check] }`. Order: unclear |
| POST /api/actions/:id/done | `{}` | `{ action }`. Self reported |
| POST /api/actions/:id/skip | `{ removeFromCalendar?: bool, approved?: bool }` | `{ action, calendar{ hadBlock, removed, removeError } }`. `removeFromCalendar: true` needs `approved: true` else 400 `approval_required` |
| GET /api/actions/:id/traces | none | `{ traces[{ id, actionId, createdAt, finishedAt, instruction, outcome, model, turns }] }` newest first |
| GET /api/traces/:id | none | `{ trace{ ...summary, result, steps[{ n, at, ms, type, ... }] } }`. Step types seen: `extraction`, `timezone_correction`, `start`, `model_request`, `validation`, `fallback`, `end`, `error`. Also `model_response`, `tool_call` (`name` is `get_availability` or `find_slot`) and `final`. Every step has `label`, a plain sentence ("Code checked the slot: passed"), and keeps its raw `type` |

## Insights

| Method, path | Response |
|---|---|
| GET /api/insights | `{ totals{ importedSaves, markedDone, savesWithDoneAction, actionRate, deadlinePassedWithoutCompletion, timeScheduledMin, demoSaves }, weekly[{ weekStart, label, importedSaves, doneSaves, actionRate }] (8 weeks, cumulative), goals[{ id, name, metrics }], kinds[{ name, count }], definitions{...}, seriesNote }` |
| GET /api/goals/:id | `{ goal, actions[Action], ...insights for that goal }` |
| GET /api/about | `{ name, model, provider, ... }` |

Upcoming deadlines for Progress: use `upcoming` from GET /api/home.

## Gaps against REBUILD_PLAN

Phase 1 is done (Nov 3). Notes for the web:
1. Local data: `node scripts/seed-demo.mjs` (server stopped) imports fixtures/demo/01 to 14 as demo saves, goals renamed, effort unconfirmed, nothing planned. `node scripts/demo-reset.mjs` restores that state and keeps settings and the Google connection. Seed result Nov 3: 14 of 14 extracted, 7.2 s per file, deadlines 14 of 14 as expected, goal differs from the manifest on 2 files (03 and 09 came back Missing). Show Missing and let the user pick.
2. `hasTimezoneCorrection` is true when the model wrote an offset that code corrected. The chip text uses the warning `deadline_offset_ignored` (`proposed.modelOffset`, `proposed.computedOffset`, `proposed.tz`). It clears when the user edits the deadline.
3. Model name is `action.model` (the id the provider returned). The display name "Muse Spark Open" is not sent. Extraction latency is `action.extractionLatencyMs`, read from the extraction trace, null if unknown.
4. No endpoint returns only our blocks for the week strip. Filter GET /api/week chips on kind "prep", or build from `next_up` and `upcoming` blocks. Week chips have `startDisplay` only, no relative strings.
5. There is no server side "recheck all". The web sends the planned ids to POST /api/actions/recheck.
6. `fixtures/demo/` exists with 14 PNGs (01 to 14), `manifest.json`, `README.md` and `flyer.png`. `docs/demo-posts/` is a separate older set of 16 files.


## Account sessions (Nov 4)

AUTH_MODE=on is the default for the server entry point. All resource routes require a complete profile and a browser session. AUTH_MODE=off is restricted to local development. Existing resource envelopes are unchanged, but IDs are scoped to the authenticated workspace.

| Method, path | Body | Response |
|---|---|---|
| GET /auth/session | none | `{ authenticated, kind: owner/user/demo/null, profile_complete, name, email, csrf_token, credits: {remaining,max,display} or null, calendar_email: string or null, demo_available?: false }`. Anonymous returns 200 and a CSRF bootstrap cookie |
| GET /auth/login/google | none | Google OIDC redirect with browser-bound state, nonce and PKCE |
| GET /auth/login/google/callback | query | Verified login redirects to /app or /complete-profile. Failure to /login?error=signin_failed |
| PATCH /api/me | `{name}` trimmed 1 to 80 chars | `{name,email}`. Email cannot be changed. Marks profile complete |
| POST /auth/logout | `{}` | `{signed_out:true}` and expires session cookie |
| POST /auth/demo | `{}` | 503 demo_unavailable until a safe demo seed is configured. The live login hides this button |
| GET /auth/google | none | Requires complete profile. Calendar consent bound to signed-in account |
| GET /auth/google/callback | query | Mismatched identity rejected before storing any tokens. Redirects to /app/settings?google=wrong_account/connected/error |

State-changing requests require exact Origin and X-CSRF-Token from GET /auth/session. Cookie sta_session is HttpOnly and SameSite=Lax. Sessions expire after seven days. API errors retain stable machine codes for logs and application decisions. UI must never display raw code or detail fields. Credits reset in GMT and are charged once per extraction/planning operation on the first successful model response. Failed model requests refund their reservation. A crash during an in-flight response may leave a reserved credit charged. Demo, ledger and account deletion are not implemented in this phase.
