# Implemented API contract

Version 1. This describes the implemented backend, replacing the earlier frontend design proposal. Base URL: http://localhost:3000. The server binds to loopback for a single-user local workspace. This is not an authenticated multi-tenant internet service.

## Conventions

- IDs are positive safe integers. Invalid IDs return 400 and absent records 404.
- JSON errors use `{ error: string, detail?, field?, ... }`. Preserve saveId, jobId, check, conflicts, alternative, traceId and fallback fields when present.
- Requests use JSON, except multipart screenshots. Responses use JSON, except screenshot bytes, JSON export attachments and trace SSE.
- Lifecycle is open/planned/done/skipped. Availability is green/amber/red/needs_input/error. Read-back is ok/drift/failed/null. These are independent states.
- Display strings are formatted by server moment-timezone. Clients must not recompute timezone offsets.
- Lists return `{ items, total, offset, limit }`. Defaults: limit 50, offset 0. Limit is capped at 100. Negative, fractional or non-finite pagination is rejected.
- Browser mutations from an Origin different from FRONTEND_ORIGIN are rejected. Server secrets never belong in browser configuration.
- Calendar writes need explicit approval. HTTP success after a write does not imply read-back success. Always inspect block.readback.

## Workspace and identity

| Method | Path | Response / behavior |
|---|---|---|
| GET | /health | Liveness, timezoneSelfTest, schemaVersion, Google status |
| GET | /ready | Local DB/timezone readiness and external-dependency configuration flags |
| GET | /api/capabilities | Supported operations, background extraction flags, API version |
| GET | /api/me | name:null, cached Google email or null, local:true |
| GET | /auth/status | configured, connected, hasRefreshToken, missingScopes |
| GET | /auth/google | Browser redirect to Google OAuth |
| GET | /auth/google/callback | OAuth callback, then redirect to frontend |
| POST | /auth/disconnect | Clears local Google credentials, keeps Google events |
| GET | /api/settings | workStart, workEnd, tz, ignoreAllDay |
| PUT | /api/settings | Partial settings edit, returns settings. Explicit tz:null clears timezone |
| GET | /api/timezones | `{ zones: [{ id, offset }] }`, canonical IANA names plus UTC, offset at the current time from moment-timezone, sorted by offset. Aliases stay valid in PUT /api/settings but are not listed |
| GET | /api/goals | Active goals in the user's order, then archived goals. Each is {id,name,description,color,archived,position,metrics} |
| GET | /api/goals/starters | The eight general starter goals, each {name,description} |
| GET | /api/goals/setup | {done}. False until the user chooses goals or skips. Workspaces that already have saves report true |
| POST | /api/goals/setup | Body {skip:true} or {goals:[{name,description?}]}, 1 to 6. The choice becomes the goal list in that order, and unchosen starting goals are removed. A new workspace starts with the first six starters. 409 goals_setup_unavailable once saves are linked to goals |
| POST | /api/goals | Body {name,description?}. Returns 201 and the goal. 409 goal_name_exists, goal_limit_reached |
| PUT | /api/goals/:id | Body with any of name, description, color (0 to 5). Returns the goal |
| PUT | /api/goals/order | Body {ids}, every active goal once. Returns the active goals in order |
| POST | /api/goals/:id/archive | Only a goal with no saves. 409 goal_in_use, last_active_goal |
| POST | /api/goals/:id/restore | 409 goal_limit_reached when six goals are active |
| GET | /api/goals/:id | Goal, linked actions, totals, weekly series, definitions |
| GET | /api/home | Server clock, next_up, upcoming, needs_attention, recent_saves, inbox/alert counts |
| GET | /api/insights | totals, weekly, goals, kinds, definitions, seriesNote |
| GET | /api/about | Model/provider names, timezone self-test, storage and calendar/input policies |

Working hours use HH:mm, with start before end. End may be 24:00. Timezone is an IANA name or null. Only confirmed effort is scheduled. Goals: names are 1 to 40 characters and unique ignoring case, descriptions are at most 120, and at most six goals are active. Goals are archived, never deleted, and only a goal with no saves can be archived. Calendar selection is not an advertised capability of this build.

## Upload, extraction and Inbox

| Method | Path | Response / behavior |
|---|---|---|
| POST | /api/saves | Multipart image and optional note. Waits by default, returns 201 {saveId,action,extraction} |
| POST | /api/saves?async=true | Same input, returns 202 {saveId,jobId,extractionStatus,statusUrl} |
| GET | /api/extractions/:id | id, saveId, state, timestamps, result or error |
| GET | /api/saves/:id | Save metadata, current extractionStatus, persisted job and action or null |
| PATCH | /api/saves/:id | Body {note}, returns {saveId,note,action}. Blocked during extraction |
| GET | /api/saves/:id/screenshot | Original PNG/JPEG/WebP bytes |
| POST | /api/saves/:id/extract | Retry without reupload, same synchronous response |
| POST | /api/saves/:id/extract?async=true | Background retry, returns 202 job envelope |
| POST | /api/saves/:id/retry | Alias for extract, supports async query |
| POST | /api/saves/:id/confirm | Body {confirmedEffortMin}, returns action. No calendar write |
| GET | /api/saves?status=&limit=&offset= | Paged save records with persisted extraction state |

Upload limits: PNG, JPEG or WebP, checked from decoded bytes, default 8 MB. Notes are at most 5000 characters. Stored original images are preserved. Only the copy sent to the model is resized.

Inbox filters: review means open actions awaiting effort confirmation, input means failed extraction, reviewed means confirmed effort or closed actions. queued/running/done/failed filters are also available.

Background jobs are serialized. States are queued → running → done/failed. Duplicate extraction for the same save returns 409 extraction_in_progress with its saveId/jobId. On a server restart, unfinished jobs become failed with extraction_interrupted. They can be retried. Progress percentages and unobserved tool calls are never invented.

### Idempotent uploads

Optional Idempotency-Key header: 1–128 printable ASCII characters. The same key with the same image and note reuses the existing save. Pending work returns its job. Completed work returns its stored result with replayed:true. Different input with the same key returns 409 idempotency_conflict. A failed import returns its saveId and directs the caller to /extract.

```js
const form = new FormData()
form.append('image', screenshotFile)
form.append('note', 'What I want to do with this')
const response = await fetch('http://localhost:3000/api/saves?async=true', {
  method: 'POST',
  headers: { 'Idempotency-Key': crypto.randomUUID() },
  body: form,
})
const accepted = await response.json()
// Poll accepted.statusUrl. Do not automatically upload the same screenshot again.
```

Do not set a multipart Content-Type manually. The browser supplies its boundary. A background job's result has the same {saveId,action,extraction} shape as synchronous upload. Failed jobs keep the saveId for retry. Browser cancellation stops waiting, not backend work.

## Actions

| Method | Path | Body / response |
|---|---|---|
| GET | /api/actions | Paged full action views plus countsByView |
| GET | /api/actions/:id | Full action directly, including block, check, evidence, effort, warnings |
| PATCH | /api/actions/:id | Edited fields, returns action directly |
| POST | /api/actions/:id/propose | Earliest slot, or no-fit reason/hints; latestFeasibleStart when computable |
| POST | /api/actions/:id/agent-plan | Optional {instruction}; proposal/fallback, rationale, traceId, approveWith |
| POST | /api/actions/:id/approve | {startUtc,endUtc,approved:true} → {replayed,action,block} |
| POST | /api/actions/:id/move | Same body → {action,block,previous} including old-event cleanup result |
| POST | /api/actions/:id/restore | {approved:true}; replace the current approved slot after recorded drift/failure, then read back |
| POST | /api/actions/:id/readback | Repeat calendar read → {block}, no calendar write |
| POST | /api/actions/:id/recheck | Approved blocks only → {check,action} |
| POST | /api/actions/recheck | {ids:integer[]} up to 100 → per-item results, calendarUnchanged:true |
| GET | /api/actions/:id/checks?limit= | {checks}, newest first |
| POST | /api/actions/:id/done | {action}, completion is self reported |
| POST | /api/actions/:id/skip | Optional {removeFromCalendar}; true also requires approved:true. Returns {action,calendar}. Web client sends false |
| DELETE | /api/saves/:id | Permanent. Needs {approved:true}, else 400 approval_required. {removeFromCalendar:true} first deletes the active calendar events and reads each back as gone. If one cannot be confirmed nothing is deleted (502, nothing local changes, retry is safe). Without it events stay on the calendar. 409 extraction_in_progress while the model runs. Returns {deleted,calendar:{blocks,removed,kept}} |
| POST | /api/actions/:id/undo | Latest unchanged done/skip transition → {action,calendarUnchanged:true} |

PATCH fields: title, goalId, kind, label, deliverables, verbatimItems, eventDates, evidenceQuote, deadline and confirmedEffortMin. Deadline is null or {wall,tz?,label?}. Model effort is read-only. Edited field badges prioritize Edited by you while preserving underlying text-match flags.

List filters: q (at most 200 characters), goal, kind, status, has_deadline=true|false. Status accepts lifecycle, check states and fits/conflict/doesnt_fit/event_passed aliases. Saved views: all, risk, later, week. Week includes deadlines or active-block starts in the settings timezone's current ISO week. Sort: deadline_asc, deadline_desc, created_desc. Missing deadlines sort last. Unknown filters/sorts return 400.

Approval, move and restore require explicit approval, confirmed effort, working-hour constraints, a fresh availability read and read-back. Restore replaces/supersedes the drifted block at its originally approved time. It does not bypass current conflicts or deadlines. Concurrent operations for one action return 409 operation_in_progress.

Undo only reverts local done/skip status. It does not change Google events. If a skip removed the approved block, undo returns calendar_restore_required. It does not undo approval or moving a calendar block.

## Calendar and trace reads

| Method | Path | Response |
|---|---|---|
| GET | /api/week?date=YYYY-MM-DD | Settings-zone ISO week, labels/geometry, previousDate/nextDate/todayDate |
| GET | /api/actions/:id/timeline | Private busy and approved intervals with server geometry, working window, now/deadline, previous blocks, latest recorded Recheck alternative or null, capped at 21 days |
| GET | /api/actions/:id/traces | {traces}, summaries newest first |
| GET | /api/traces/:id | {trace}, recorded steps and result |
| GET | /api/traces/:id/stream | SSE trace events on persisted changes, end when finished |

Agent steps are persisted as observed. The model has read-only tools. Operation durations/timestamps are recorded. There is no per-step replay endpoint. Start a new agent-plan request to run planning again. Extraction jobs use polling rather than this planning-trace stream.

Successful new extractions also persist a completed trace with type extraction, the provider's measured duration, token usage and actual image dimensions. A timezone_correction step is added only when a supported model deadline's explicit offset differs from moment-timezone. Matching offsets and missing offsets produce no correction step. Older saves are not backfilled with invented telemetry.

Actions include doneAtDisplay. Block read-back includes atDisplay and a separate driftDisplay array with expectedDisplay/actualDisplay, preserving raw drift evidence. Missing settings timezone leaves completion display null. event_already_happened is recomputed on every action read and edit from current event dates and the server's local date, so it cannot remain stale after midnight or a date edit.

## Export and confirmed local deletion

| Method | Path | Response |
|---|---|---|
| POST | /api/export | {download_url:'/api/export'} |
| GET | /api/export | JSON attachment containing structured user records |
| DELETE | /api/me/data | Requires {approved:true,confirmation:'DELETE MY DATA'} |
| DELETE | /api/me | Account mode only. Requires {approved:true,confirmation:'DELETE MY ACCOUNT'} and the CSRF token. Revokes the Google grant best effort, removes the workspace folder, the account row and all sessions. Returns {deleted,google_revoked,calendarUnchanged}, google_revoked is null when no grant existed. 409 operations_in_progress while work is running. Existing Calendar events are kept |

Export excludes Google credentials, API keys and image binaries. Local deletion is blocked during extraction/action operations. It removes local screenshot files and user records, clears local Google credentials, and recreates empty defaults. Existing Google events are kept. This operation is tested only against isolated test data, never the live workspace.

## Readiness and verification

The supported local API is covered by the server tests and typed client methods under web/src/api. /ready reports configuration and connectivity state without performing a model call or a calendar write. Model configuration is not proof of a successful live provider call. Google connected state is not proof that a new write/read-back has been exercised.

Run npm run smoke from server/ while the backend is running. It checks live GET routes and prints no user content. /ready distinguishes local process readiness from readyForScheduling, which additionally requires a configured user timezone, connected Google credentials and no missing scopes.

Not implemented: multi-tenant authentication/billing, internet deployment, arbitrary calendar selection, individual trace-step replay, automatic undo of calendar writes, or claiming the user's completion was externally verified.
