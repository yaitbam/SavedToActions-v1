# SavedToAction web

React and TypeScript client for SavedToAction. Vite serves the app on http://localhost:5173 and proxies `/api` and `/auth` to the backend on port 3000. See the [root setup guide](../README.md#setup) for credentials and Google configuration, and the [server guide](../server/README.md) for API behavior.

## Development

Use Node 22 or newer. From this directory:

```sh
npm install
npm run dev
```

Start the backend separately with `npm --prefix ../server start`. Open **http://localhost:5173** consistently, rather than switching between `localhost` and `127.0.0.1` during login. No Google secrets or Baseten keys belong in frontend environment variables.

```sh
npm run typecheck
npm run build
npm run preview
```

`build` checks TypeScript and writes production assets to `dist/`. `preview` serves those assets for inspection. It is not a production backend or a substitute for the development API proxy. Hosting needs an HTTPS reverse proxy that routes `/api` and `/auth` to Node and serves the frontend under the same public origin, with SPA route fallback.

## Routes and sign-in

| Route | Purpose |
|---|---|
| `/` | Public landing page. It explains the problem, what SavedToAction does, the value and the impact. No interactive demos |
| `/login` | Google sign-in with the Google button. The demo button is hidden when the server reports it unavailable |
| `/complete-profile` | Confirm name and the read-only verified Google email |
| `/privacy` | Public privacy information |
| `/app` | Overview. Before Calendar is connected, a setup panel with a three step tracker and the drop zone. After, summary tiles (planned, need you, to confirm), next up, goals, saves needing attention and the week |
| `/app/saves` | Saved. A grid of save cards, an inspector drawer for the selected save, and links to Review |
| `/app/saves/:id` | Review in three steps: what we read, how long it takes, then find, approve or move a time and mark done |
| `/app/progress` | Metrics computed from workspace records |
| `/app/settings` | Account and account deletion, Calendar connection, working hours, a searchable timezone list, goal names and credits |
| `/app/ui` | Internal component check page, behind the workspace guard |

The session provider checks `/auth/session` before mounting private routes. An anonymous visitor goes to login. An incomplete profile goes to confirmation. A failed session request shows the login page with a general message and Retry, keeping private data closed.

Cookies stay on the same origin. The API client includes the session's CSRF token on writes. On a private API `401`, it clears its session state, hides the current page and hard navigates to login. Sign-out revokes the server session and hard navigates too. Only the first session check replaces the page with a loader. Later reloads, such as saving a name, refresh in the background so the page keeps its state. A signed out visitor's requested `/app/...` page is remembered in session storage for 10 minutes, so signing in returns them there and not to Overview. Account details, screenshots and Google tokens are not persisted in browser storage.

Calendar connection is separate from app login and must use the same Google account. Disconnecting Calendar leaves the login active. Login uses the registered Calendar callback by default. See [account setup](../docs/AUTH_SETUP.md) when configuring a different callback.

## UI behavior

- Drag-and-drop, paste and file selection open a screenshot preview. Creating a save requires clicking Extract. Preview URLs are released on replacement or close.
- Only confirmed effort is scheduled. Calendar writes need approval and show readback results. Marking a booked task done also marks its Calendar event title.
- Dates and time labels come from the server. The browser does not convert scheduling times. The timezone list and its offsets come from `GET /api/timezones`, which uses moment-timezone. If the list cannot load, Settings falls back to a text field and the server still validates the name.
- Private pages use a left sidebar on desktop. On phones it becomes a slim top bar and a bottom navigation. Status is shown with a word and a shape, never color alone, and cards do not use edge-colored borders.
- Deleting an account needs the typed confirmation `DELETE MY ACCOUNT`. Events already on Google Calendar are kept.
- Credits display the server's string. The browser does not calculate balances or reset times.
- Known validation errors use approved messages. Unknown errors use a general fallback. Raw API codes, details and stack traces are never rendered as user error messages.
- Failed actions use the shared alert provider. Page and form errors stay next to the relevant controls. Read-only demo sessions block client writes, but the backend must enforce isolation and permissions.

The client uses React Router, Tailwind, Manrope and IBM Plex Mono. Shared controls live in `src/ui/`, pages compose feature components, and API modules live in `src/api/`. No additional UI component library is used.

## Browser checks

Browser scripts live in `test/`. They require Playwright and its Chromium browser to be available in the test environment. If Playwright is installed outside this project, set `PLAYWRIGHT_MODULE` to that package's absolute path. Screenshots are written under `artifacts/`, outside Git.

From the repository root, with Vite running:

```sh
node web/test/auth.cjs
node web/test/errors.cjs
node web/test/new-save.cjs
node web/test/phase6.cjs
```

`auth.cjs` also requires the backend in account mode with Google client credentials configured. It checks the live session endpoint and Google redirect, then uses intercepted sessions for profile, CSRF, logout, demo and expiry tests at 1440px and 390px. It does not complete a real Google login or write Calendar events.

`errors.cjs` verifies missing-session recovery and that technical errors are not shown. `new-save.cjs` checks preview lifecycle and upload bytes using intercepted uploads. `phase6.cjs` checks the landing page and image viewers.

`design.cjs` checks that the landing sections exist and the old interactive demos are gone, that there is no horizontal overflow at 1440, 768 and 390 px, and that there is no theme switch. It writes snapshots under `artifacts/design/`. Playwright was not installed when the latest redesign was made, so none of these browser scripts were run afterwards. `phase5.cjs`, `phase6.cjs` and the other scripts were written for the earlier landing, Saved and Review pages and may need updating.

`phase5.cjs` expects the seeded legacy database and an isolated `AUTH_MODE=off` backend. Its initial reads use the local API and later write checks are intercepted. It is not an authenticated multiuser end-to-end test.

## Current limits

The shared demo is unavailable on the live backend. Account deletion is in Settings and asks for a typed confirmation. The trust-ledger API is absent, and legacy data is not automatically migrated into new accounts. Two real Google accounts completing login and one booking each still need separate manual verification. Full account configuration and deployment limits are documented in [account setup](../docs/AUTH_SETUP.md).
