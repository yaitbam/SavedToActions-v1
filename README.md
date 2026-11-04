# SavedToAction

![Built with Muse Spark Open](https://img.shields.io/badge/Built%20with-Muse%20Spark%20Open-14110F)

Saved is not done. SavedToAction turns a screenshot of a post you saved into protected time on your calendar, and moves it when your week changes.

## The problem

You save a post because you mean to act on it: a hackathon deadline, a prompt to try, a course, a freelance tip. It sits in Saved. The deadline passes. Saving feels like progress, but nothing happens.

## What it does

1. Drop a screenshot of a saved post, with an optional note.
2. Confirm how long it will take. The model suggests minutes, but only the minutes you confirm are ever scheduled.
3. Approve a time. The block is written to your Google Calendar, read back to check it matches, and rechecked when your calendar changes. Marking a booked task done adds `Done ·` to the event title after approval and verification.

Every field shows where it came from. A deadline only exists if its supporting quote is found in your note or in the text the model read from the image. Anything the post does not state stays **Missing**. Nothing is invented: not deadlines, not dates, not links, not urgency.

## How Muse Spark Open is used

Muse Spark Open is an open weights model. This project calls `meta-models/muse-spark-open-1026` through Baseten's OpenAI compatible API.

- **Image input.** The screenshot is sent as a base64 data URL, downscaled to 1280 px on the longest edge. The original is kept for you.
- **Extraction.** The model returns structured JSON: transcription, title, goal, kind, deadline as local wall time plus an IANA timezone, event dates, deliverables, exact prompts and links, an evidence quote and a suggested number of minutes. Code then validates it. Quotes must be found in the note or the transcription, the deadline's UTC time is computed by code from the wall time and the timezone, and an offset the model adds is ignored.
- **Tool calling with read only tools.** When you give the planner a preference, the model plans with two tools, `get_availability` and `find_slot`, for up to 6 turns. Neither tool writes. The slot it proposes must be one that `find_slot` returned, and it is revalidated with the same checks as an approval. If the model fails or proposes something invalid, the app falls back to the earliest valid slot found by code. Every run is stored as a trace you can open.
- **Code gated writes.** The model never writes to the calendar. A write happens only after you approve a specific slot, with an idempotency key per block, a fresh availability check, and a read back afterwards that flags any drift in start, end or timezone. Moving a block marks the old one superseded, so the two are never both counted.

## Verified facts

These were checked by running them. Details and numbers are in [docs/TEST_RESULTS.md](docs/TEST_RESULTS.md).

- Server tests: 280 pass with isolated databases and fake Google/model services. No external Google or model calls are made by the suite.
- Demo seed: 14 of 14 illustrative posts extracted, 14 of 14 deadlines as expected, 12 of 14 goals as expected, 7.2 s average per file, zero Google Calendar calls.
- Timezone: Africa/Casablanca is +00:00. Node's built in timezone data says +01:00, which is wrong, so all conversions use moment-timezone and the server refuses to start if its startup self test fails. When the model writes an offset, code ignores it and computes the time itself.
- Google Calendar: the full flow of propose, approve, read back, recheck, conflict, move and cleanup passed 8 of 8 steps on a real calendar (recorded in `server/README.md`).
- Baseten: text, JSON extraction, tool calling and image input work with this model.

## Honest limits

- Google login and private workspaces are implemented. Google OAuth remains in Testing mode, so accounts must be added as test users. Public Google approval is a separate release step.
- Hosting targets one server process with persistent disk. The shared demo, trust ledger and migration of legacy local data are not implemented.
- Goal assignment is the weakest part of extraction. In the demo seed the model returned no goal for 2 of 14 posts, and results varied between runs. You can always pick the goal yourself.
- Posts that give a date but no time get no deadline. The app does not guess a time.
- The model takes about 7 s per screenshot, so the app shows loading states.
- Completions are self reported. Progress numbers are computed from database records only.
- The reasoning effort setting was compared on 5 screenshots, 4 of them synthetic. That is a small sample.
- Not verified yet: the background watcher against real Google over real time, how the Google Calendar web UI renders the blocks, `response_format` JSON mode on Baseten, and the Meta Model API, which this project does not use.
- Outside tester results are not in yet. See the empty section in [docs/TEST_RESULTS.md](docs/TEST_RESULTS.md).
- Model suggested minutes have not been measured against what users confirm.

## Other tools

Task managers, read later apps and calendar assistants overlap with parts of this. We did not compare against them and make no claim about what they can or cannot do. What this project combines is: a screenshot in, minutes you confirm, a write you approve, a read back after the write, and a recheck when the calendar changes.

## No scraping

SavedToAction never scrapes a platform, reads DMs, or posts or comments for you. The input is only screenshots, notes and pasted text that you provide.

## Demo posts are fictional

The 14 images in `fixtures/demo/` are original illustrative posts. Every account, event, venue, grant and organization in them is invented. They are imported as "Imported demo data" and are never presented as real saves. No financial, medical or political advice is given.

## Accounts and privacy

Sign in with Google, confirm your name and verified email, then connect Google Calendar using the same Google account. You can upload and review saves before connecting Calendar. After you connect Calendar, Overview asks which goals your saves are for. You pick from general starters or write your own, and you can change them later in Settings. Scheduling also needs your timezone and working hours.

Each account has its own workspace database, screenshots, settings and Calendar credentials. Sessions use HttpOnly cookies and expire after seven days. Calendar tokens are encrypted on the server. Sign-out ends the app session. Disconnecting Calendar leaves your app login active. You can delete your account and data in Settings after typing a confirmation. That asks Google to revoke Calendar access, removes your workspace and sessions, and keeps events already on your Calendar.

Free accounts receive 20 credits per GMT day, and owner accounts receive 100. One extraction or agent-planning operation consumes one credit when a model response succeeds. Failed model requests refund their reservation. A process crash during a pending request may leave the reserved credit charged. There are no payments or paid plans.

## Setup

You need Node 22 or newer, a Baseten API key, and a Google Cloud OAuth **Web application** client.

1. From the repository root, install both applications:
   ```sh
   npm --prefix server install
   npm --prefix web install
   ```
2. For a new checkout, copy `.env.example` to `.env`. Preserve an existing `.env`. Set `BASETEN_API_KEY`, `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Keep `AUTH_MODE=on` and `GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback` for local development.
3. Enable Google Calendar API. In the OAuth client's **Authorized redirect URIs**, register `http://localhost:3000/auth/google/callback` exactly. Login and Calendar share this callback by default. If you set a different `GOOGLE_LOGIN_REDIRECT_URI`, register that exact URL too. Keep consent in Testing mode and add your Google account as a test user. Login requests `openid email profile`. Calendar connection separately requests `calendar.events` and `calendar.freebusy`.
4. Start the backend in one terminal:
   ```sh
   npm --prefix server start
   ```
5. Start the frontend in another terminal:
   ```sh
   npm --prefix web run dev
   ```
6. Open **http://localhost:5173**, choose **Try it**, sign in, and confirm your details. Connect Calendar in Settings and choose your timezone from the list, then set your working hours. Use `localhost` consistently throughout the flow.

Account data defaults to `data/central.sqlite` and `data/workspaces/<workspace_key>/`, separate from the legacy `server/data/` workspace. Existing saves do not automatically become a new account's data. The old seed/reset scripts target the legacy database selected by `DB_PATH`, not signed-in account workspaces. Stop the server before using them. They never remove events already written to Google Calendar.

For HTTPS production, configure the public origin and callback URLs, set `COOKIE_SECURE=true`, and supply a secret `TOKEN_ENC_KEY` containing 64 hexadecimal characters. Keep the key and persistent data backed up outside Git. Local development creates a private token key when this variable is absent. See [account setup](docs/AUTH_SETUP.md) for configuration and current limits.

## Checks and component guides

```sh
npm --prefix server test
npm --prefix web run build
```

[Server guide](server/README.md) covers storage, API behavior and scheduling. [Web guide](web/README.md) covers routes, session handling, development and browser checks. The [core API reference](server/docs/API.md) and [account setup](docs/AUTH_SETUP.md) provide further detail.

## Built with

Muse Spark Open on Baseten, Node.js, Express, SQLite, moment-timezone, the Google Calendar API, React, Vite, TypeScript and Tailwind CSS.
