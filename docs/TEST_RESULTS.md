# Test results

Real numbers only. Times are GMT+0.

## Server tests

| Result | Value |
|---|---|
| Command | `cd server && npm test` |
| Tests | 340 |
| Passed | 340 |
| Failed | 0 |

The suite uses an in-memory database, a fake calendar and a scripted fake model. It makes no network calls, no Google calls and no model calls.

## Timezone catch

Africa/Casablanca is +00:00. Node's built in timezone data says +01:00, which is wrong, so every conversion uses moment-timezone.

Evidence file: [docs/evidence/timezone-catch.json](evidence/timezone-catch.json). It holds the raw Baseten response, the model name and the timestamp. It was made by `node scripts/timezone-catch.mjs`, one forced tool call with no Google Calendar and no database. The request asks for a prep block on 2026-11-05 at 10:00 in Africa/Casablanca.

| | Value |
|---|---|
| Model | `meta-models/muse-spark-open-1026` (response `model` field) |
| Saved at | 2026-11-04T00:05:19.882Z |
| HTTP status, finish reason | 200, `tool_calls` |
| Model wrote (`start_iso`) | `2026-11-05T10:00:00+01:00` |
| Model timezone field | `Africa/Casablanca` |
| Our code, same wall time (moment-timezone) | UTC `2026-11-05T10:00:00.000Z`, offset `+00:00` |
| Model offset matches ours | No |

If the model's `+01:00` were trusted, the block would land one hour early (09:00 UTC). The app does not trust it. The model returns wall time plus the IANA zone, code computes UTC, and an offset the model adds is ignored and recorded as a correction (`modelOffset +01:00`, `computedOffset +00:00`).

Other checks:

| Check | Result |
|---|---|
| Startup self test (Africa/Casablanca at 2026-11-05T10:00Z must be +00:00) | Passes, the server exits if it does not |
| Automated test | A scripted model answer with a +01:00 deadline gives modelOffset +01:00 and computedOffset +00:00, and an answer with +00:00 or no offset records no correction. Passing, in `server/test/saves.test.js` |

## Live calendar flow

Recorded in `server/README.md`: the full flow on a real Google Calendar passed 8 of 8 steps and was cleaned up. The steps are propose, approve with read back, recheck green, add a conflicting meeting, recheck amber, approved move with read back, recheck green, cleanup. It used a scratch copy of the database and deleted only the events it created.

## Reasoning effort comparison

`scripts/effort-quality.mjs` compares the model's `reasoning_effort` setting, low against the default. It measures speed and extraction accuracy.

Recorded in `server/README.md`: 5 screenshots with known answers, 2 runs each.

| Config | Mean time | Mean reasoning tokens | Checks passed |
|---|---|---|---|
| default | 13.7 s | 2450 | 69 of 70 |
| low | 7.5 s | 520 | 69 of 70 |

The one miss in each config was the same transcription check on the same screenshot. Low is the default in the app.
