# Test results

Real numbers only. Where a result is not backed by saved output in this repo, it says TODO. Times are GMT+0.

## Server tests

| Result | Value |
|---|---|
| Command | `cd server && npm test` |
| Tests | 319 |
| Passed | 319 |
| Failed | 0 |

The suite uses an in-memory database, a fake calendar and a scripted fake model. It makes no network calls, no Google calls and no model calls.

## Demo seed

`node scripts/seed-demo.mjs` sends the 14 illustrative posts in `fixtures/demo/` (01 to 14) through the real pipeline, with the real Muse Spark Open call. Each save is marked as demo data. The script then compares goal and deadline per file with `fixtures/demo/manifest.json`. The manifest is used only for checking, never as model input.

| Metric | Result |
|---|---|
| Files extracted | 14 of 14 |
| Deadlines matching the manifest | 14 of 14 |
| Goals matching the manifest | 12 of 14 |
| Average time per file | 7.2 s wall, 7.1 s model |
| Total wall time | 100 s |
| Google Calendar calls | 0 |
| Calendar blocks before and after | 0 and 0 |

A deadline counts as matching when it equals the manifest, or when the post gives a date without a time and the app leaves the deadline as Missing on purpose (02, 06, 07, 13). No time is ever invented.

The two goal misses are 03 and 09. In both the model returned no goal, and the app shows it as Missing for the user to choose.

> Note: these runs were made before date only deadlines were supported. Rows marked "Missing (no time given)" would now get a deadline at the end of that day, labeled as assumed.

| File | Time | Goal expected | Goal got | Deadline expected | Deadline got |
|---|---|---|---|---|---|
| 01 | 7.6 s | Events and opportunities | Events and opportunities | 2026-11-20 23:59 | 2026-11-20 23:59 |
| 02 | 8.3 s | Earn more | Earn more | 2026-11-30 | Missing (no time given) |
| 03 | 7.1 s | Learn a skill | Missing | Missing | Missing |
| 04 | 7.8 s | Earn more | Earn more | Missing | Missing |
| 05 | 7.0 s | Learn a skill | Learn a skill | Missing | Missing |
| 06 | 5.3 s | Events and opportunities | Events and opportunities | 2026-11-24 | Missing (no time given) |
| 07 | 9.0 s | Learn a skill | Learn a skill | 2026-11-15 | Missing (no time given) |
| 08 | 7.7 s | Earn more | Earn more | Missing | Missing |
| 09 | 6.6 s | Learn a skill | Missing | Missing | Missing |
| 10 | 7.9 s | Missing | Missing | Missing | Missing |
| 11 | 7.5 s | Earn more | Earn more | Missing | Missing |
| 12 | 7.0 s | Events and opportunities | Events and opportunities | 2026-12-01 23:59 UTC | 2026-12-01 23:59 UTC |
| 13 | 6.1 s | Learn a skill | Learn a skill | 2026-11-13 | Missing (no time given) |
| 14 | 5.3 s | Missing | Missing | Missing | Missing |

Notes:
- Files 10 and 14 are posts with no action. The expected result is Missing for goal and deadline, and that is what came back.
- Goal assignment is not stable between runs. A repeat check on five of these files with the same image and prompt gave different goals on some of them. Treat 12 of 14 as one sample, not a rate.
- Nothing was confirmed, proposed, approved or scheduled by the seed.

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
| Corrections in the 14 seed runs | 0. The correction did not trigger in any of the 14 seed runs, because the model did not add an offset to a deadline in those runs |

The evidence file shows the model making this mistake in a tool call. It does not show the correction firing inside the extraction pipeline on a real screenshot. That has not been observed. It is covered by the automated test only.

## Live calendar flow

Recorded in `server/README.md`: the full flow on a real Google Calendar passed 8 of 8 steps and was cleaned up. The steps are propose, approve with read back, recheck green, add a conflicting meeting, recheck amber, approved move with read back, recheck green, cleanup. It used a scratch copy of the database and deleted only the events it created.

No new live calendar writes were made for this document. TODO: the raw output of that run is not saved in this repo. Attach it if it exists.

## Reasoning effort comparison

`scripts/effort-quality.mjs` compares the model's `reasoning_effort` setting, low against the default. This measures speed and extraction accuracy of the setting. It does not measure how good the minutes estimates are.

Recorded in `server/README.md`: 5 screenshots (4 synthetic posts with known answers, 1 real flyer), 2 runs each.

| Config | Mean time | Mean reasoning tokens | Checks passed |
|---|---|---|---|
| default | 13.7 s | 2450 | 69 of 70 |
| low | 7.5 s | 520 | 69 of 70 |

The one miss in each config was the same transcription check on the same screenshot. Small sample. Synthetic posts are cleaner than real ones. Low is the default in the app.

TODO: how close the model's suggested minutes are to what users confirm has not been measured.

## Outside testers

TODO: not run yet. Fill in with real results, including failures. Do not edit this section with estimates.

### Tester 1

| Item | Result |
|---|---|
| Who (role only, no name needed) | TODO |
| Posts they saved and dropped | TODO |
| Deadlines read correctly | TODO |
| Goal picked correctly | TODO |
| Minutes they confirmed vs model estimate | TODO |
| Booked on their calendar and read back matched | TODO |
| What failed or confused them | TODO |

### Tester 2

| Item | Result |
|---|---|
| Who (role only, no name needed) | TODO |
| Posts they saved and dropped | TODO |
| Deadlines read correctly | TODO |
| Goal picked correctly | TODO |
| Minutes they confirmed vs model estimate | TODO |
| Booked on their calendar and read back matched | TODO |
| What failed or confused them | TODO |
