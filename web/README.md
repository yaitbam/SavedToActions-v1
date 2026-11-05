# SavedToAction web

The React and TypeScript client of [SavedToAction](../README.md). Vite serves it on http://localhost:5173 and proxies `/api` and `/auth` to the backend on port 3000. For credentials and Google setup see the [root setup guide](../README.md#setup). For the API see the [server guide](../server/README.md) and the [API contract](../server/docs/API.md).

## Development

Needs Node 22 or newer. Start the backend first (`npm --prefix ../server start`), then from this folder:

```sh
npm install
npm run dev
```

Open **http://localhost:5173** consistently, rather than switching between `localhost` and `127.0.0.1` during login. No Google secrets or model keys belong in frontend environment variables.

`npm run typecheck` checks types, `npm run build` checks them and writes production assets to `dist/`, and `npm run preview` serves those assets for inspection only. Hosting needs an HTTPS reverse proxy that routes `/api` and `/auth` to Node and serves the frontend on the same public origin, with a fallback to `index.html` for page routes.

## Routes

| Route | Purpose |
|---|---|
| `/` | Public landing page: what it is, three steps, benefits, an example of progress by goal, what it never does and an FAQ |
| `/login` | Google sign in, and **Explore the demo** when the server reports a demo is loaded |
| `/complete-profile` | Confirm your name and the read only verified Google email |
| `/privacy`, `/500`, any unknown address | Privacy page, the server error page and the not found page |
| `/app` | Overview. Before Calendar is connected, a setup panel and the drop zone. Right after connecting, two first steps: confirm your timezone, then choose your goals. After that: summary tiles, next up, goals, saves needing attention and the week |
| `/app/saves` | Saved: a grid of save cards, an inspector drawer for the selected save |
| `/app/saves/:id` | Review. Step 1 checks what Muse read, with a way to edit it. Step 2 is the minutes. Step 3 is the suggested time with one main button. Other times, "Ask Muse for a different time", Decide later and Skip sit under More options. After booking it shows the status, the read back, Mark done and Remove from calendar |
| `/app/progress` | Totals, a card per goal, the weekly trend and upcoming deadlines, computed from workspace records |
| `/app/settings` | Account and deletion, Calendar connection, goals manager, working hours, a searchable timezone list and credits |
| `/app/ui` | Internal component check page behind the sign in guard |

## Session and sign in

- A session provider checks `/auth/session` before any private route mounts. An anonymous visitor goes to login, an incomplete profile goes to confirmation, and a session check that fails goes to the `/500` page, so private data stays closed.
- Cookies stay on one origin. The API client sends the session's CSRF token on writes. On a private `401` it clears its state and hard navigates to login. Sign out revokes the server session and does the same.
- Only the first session check replaces the page with a loader. Later refreshes, such as saving a name, happen in the background so the page keeps its state.
- A signed out visitor's requested `/app/...` page is remembered in session storage for 10 minutes, so signing in returns them there. Account details, screenshots and Google tokens are never kept in browser storage.
- Calendar connection is separate from login and must use the same Google account. Disconnecting Calendar leaves the login active.
- A demo session is read only. The client blocks its writes and shows a banner, and the backend enforces it regardless.

## UI behavior

- Drag and drop, paste and file selection open the new save dialog: the screenshot with Crop and Change, a note of at most 160 characters with quick phrases, and an optional post link. Creating a save needs a click on Extract. Cropping is cut from the original pixels in the browser, so removed parts are never uploaded.
- A suggested time is looked up as soon as there are minutes. That request is read only and saves nothing. Approving sends the minutes on screen and confirms them. Only confirmed effort is scheduled.
- All dates, offsets and time labels come from the server. The browser does not convert scheduling times. The timezone list comes from `GET /api/timezones`, and if it cannot load, Settings falls back to a text field.
- Deadlines are red chips with the short date (`Due 22 Nov`), and a date with no time is labeled as an assumed end of day. Status is a word and a shape, never color alone. The interface is light only.
- Credits show the server's string. The browser never calculates balances.
- Known errors use approved messages and unknown ones a general fallback. Raw codes, details and stack traces are never shown.
- Private pages use a sidebar on desktop, and a slim top bar with a bottom navigation on phones.
- The client uses React Router, Tailwind, Manrope and IBM Plex Mono. Shared controls live in `src/ui/`, pages compose feature components in `src/features/`, and API modules live in `src/api/`. No other component library is used.

## Browser checks

Scripts in `test/` need Playwright with Chromium and a running Vite server. If Playwright is installed elsewhere, set `PLAYWRIGHT_MODULE` to its absolute path. Screenshots go to `artifacts/`, outside Git. From the repository root:

```sh
node web/test/auth.cjs
node web/test/errors.cjs
node web/test/new-save.cjs
node web/test/crop.cjs
```

- `auth.cjs` needs the backend in account mode with Google credentials. It checks the session endpoint and the Google redirect, then uses intercepted sessions for profile, CSRF, logout, demo and expiry at 1440 px and 390 px. It does not complete a real Google login.
- `errors.cjs` checks recovery from a missing session and that technical errors are not shown. `new-save.cjs` checks preview cleanup and uploaded bytes. `crop.cjs` crops a screenshot with the mouse and keyboard and checks the uploaded size. It needs `sharp`, which the server package installs.
- `design.cjs`, `phase5.cjs` and `phase6.cjs` were written for earlier versions of the landing, Saved and Review pages, may need updating, and `phase5.cjs` expects a prepared legacy database with `AUTH_MODE=off`.

## Current limits

Two real Google accounts each completing login and one booking still need a manual check. The trust ledger is not built, and old local data is not migrated into new accounts. See the [root limits](../README.md#honest-limits) and the [server guide](../server/README.md).
