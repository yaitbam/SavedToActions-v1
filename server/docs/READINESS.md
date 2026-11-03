# Local API readiness

Verified November 3, 2026. Supported deployment: a single-user local workspace bound to loopback. The implemented contract is [API.md](API.md).

## Checks completed

| Check | Result |
|---|---|
| Server npm test | 250 passed, 0 failed |
| Frontend API request-contract tests | 13 passed, 0 failed |
| Frontend npm run build | Passed TypeScript and Vite |
| Live read-only smoke | 16 API reads passed |
| Live configuration | Model configured, Google connected, user timezone configured, scheduling readiness true |
| Timezone self-test | Passed using moment-timezone |
| git diff whitespace check | Passed |

The smoke covered health, readiness, capabilities, settings, Google status, local identity, goals, Home, Insights, About, action/save collections and an existing action's detail, checks and traces plus its save detail. It did not print user content. Run it again with npm run smoke from server/ while the API is running.

The tests use isolated databases, temporary screenshots and fake model/calendar services. They exercise uploads, persisted background jobs, retries, interrupted-job recovery, import idempotency, explicit approval gates, fresh availability checks, read-back drift, restore, lifecycle undo, bulk recheck, trace streaming, exports, confirmed deletion and error contracts. New extraction traces preserve measured telemetry. Offset-correction tests cover matching, mismatching and absent model offsets. Event-passed warnings update after reads and edits.

No new live calendar events or deletions were performed in this readiness pass. Live configuration flags are not a new extraction-quality result or a new end-to-end calendar write/read-back result. Earlier live verification is documented separately in the project brief.

## Remaining boundaries

- Multi-user login, tenant isolation, hosted deployment and billing are outside this local API. Do not expose this unauthenticated API to the internet.
- Google access is for the connected account's primary calendar.
- Individual trace-step replay is unavailable. A new agent-plan request creates a new recorded run.
- Extraction status uses polling. Planning traces also support SSE. A process restart marks unfinished jobs interrupted so they can be retried.
- Lifecycle undo reverses the latest unchanged done/skip transition. It never silently reverses Google Calendar writes.
- Export includes structured records, without credentials or screenshot binaries. Confirmed local deletion retains existing Google events.
- Historical saves are not backfilled with fabricated extraction telemetry. Recorded Recheck alternatives remain recorded observations. A fresh proposal requires /propose and every approval checks availability again.
- API support does not mean every optional operation already has a frontend control.

## Next validation

1. Exercise one real screenshot through extraction and review its fields.
2. Approve a specific calendar slot, then check read-back, conflict detection and an explicitly approved move.
3. Complete the two outside-user trials required by the project brief and record the observed results.
