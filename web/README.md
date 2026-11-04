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
| `/` | Public landing page: a hero that shows the suggested time, a strip of facts about what it is built on (no invented logos or reviews), the problem, three steps with the note and the calendar event, six benefits, an example of progress by goal, what it will never do, an FAQ and a closing call to action. Short copy, no interactive demos |
| `/login` | Google sign-in with the Google button. The demo button is hidden when the server reports it unavailable |
| `/complete-profile` | Confirm name and the read-only verified Google email |
| `/privacy` | Public privacy information |
| `/app` | Overview. Before Calendar is connected, a setup panel with a step tracker and the drop zone. Right after it is connected, two first login steps in place of the drop zone: confirm your timezone, then choose your goals (skippable). After that, summary tiles (planned, need you, to confirm), next up, goals with a link to Progress, saves needing attention and the week |
| `/app/saves` | Saved. A grid of save cards, an inspector drawer for the selected save, and links to Review |
| `/app/saves/:id` | Review. Before a time is booked it is one card: a suggested time, the minutes on screen, and one button that approves the time and confirms its minutes. Other buttons are Another time, Later and Skip, and "Ask Muse for a different time" opens the planner. Below it, what Muse read (goal, deadline in red, evidence, the post link) and Details. After booking it shows the status, read back and Mark done |
| `/app/progress` | Totals, one card per goal and the weekly trend, computed from workspace records, with upcoming deadlines |
| `/app/settings` | Account and account deletion, Calendar connection, a goals manager (add, edit, color, reorder, archive, restore, up to six active), working hours, a searchable timezone list and credits |
| `/app/ui` | Internal component check page, behind the workspace guard |

The session provider checks `/auth/session` before mounting private routes. An anonymous visitor goes to login. An incomplete profile goes to confirmation. A failed session request shows the login page with a general message and Retry, keeping private data closed.

Cookies stay on the same origin. The API client includes the session's CSRF token on writes. On a private API `401`, it clears its session state, hides the current page and hard navigates to login. Sign-out revokes the server session and hard navigates too. Only the first session check replaces the page with a loader. Later reloads, such as saving a name, refresh in the background so the page keeps its state. A signed out visitor's requested `/app/...` page is remembered in session storage for 10 minutes, so signing in returns them there and not to Overview. Account details, screenshots and Google tokens are not persisted in browser storage.

Calendar connection is separate from app login and must use the same Google account. Disconnecting Calendar leaves the login active. Login uses the registered Calendar callback by default. See the [server guide](../server/README.md) when configuring a different callback.

## UI behavior

- Drag-and-drop, paste and file selection open the new save dialog. It has the screenshot with Crop and Change, a note of at most 160 characters with quick phrases for when and how long, and an optional link to the post. A link pasted into the note moves to the link field. Creating a save requires clicking Extract. Preview URLs are released on replacement or close.
- Crop: drag the edges or corners of the box, drag inside it to move it, or use the arrow keys on an edge handle. The crop is cut from the original pixels in the browser, so the parts removed are never uploaded.
- A suggested time is looked up as soon as there are minutes, from the note, the model or a tap. That is a read only request that saves nothing. The approve button sends the minutes on screen and approving confirms them.
- Only the first session check replaces the page with a loader. Later session refreshes happen in the background, and Overview shows a loader until its setup status is known, so nothing flashes.
- A visitor who opens `/app/...` signed out returns to that page after signing in, using session storage for ten minutes.
- Deadlines are red chips with the short date (`Due 22 Nov`). The full date and time are in the tooltip. A date given with no time is labeled as assumed end of day.
- The interface is light only. There is no theme switch.
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

`crop.cjs` crops a phone style screenshot with the mouse and keyboard in the new save dialog and checks the size of the image that is uploaded. It needs `sharp`, which the server package installs, and it closes its browser on failure. `design.cjs` checks that the landing sections (including the FAQ, which opens and closes) exist and the old interactive demos are gone, that there is no horizontal overflow at 1440, 768 and 390 px, and that there is no theme switch. It writes snapshots under `artifacts/design/`. Playwright was not installed when the latest redesign was made, so none of these browser scripts were run afterwards. `phase5.cjs`, `phase6.cjs` and the other scripts were written for the earlier landing, Saved and Review pages and may need updating.

`phase5.cjs` expects the seeded legacy database and an isolated `AUTH_MODE=off` backend. Its initial reads use the local API and later write checks are intercepted. It is not an authenticated multiuser end-to-end test.

## Current limits

The shared demo opens from the login page once `node scripts/load-demo.mjs` has loaded it, and it is read only. Account deletion is in Settings and asks for a typed confirmation. The trust-ledger API is absent, and legacy data is not automatically migrated into new accounts. Two real Google accounts completing login and one booking each still need separate manual verification. Full account configuration and deployment limits are in the [server guide](../server/README.md).
