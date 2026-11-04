# SavedToAction

![Built with Muse Spark Open](https://img.shields.io/badge/Built%20with-Muse%20Spark%20Open-14110F)

Saved is not done. SavedToAction turns a screenshot of a post you saved into protected time on your calendar, and moves it when your week changes.

## The problem

You save a post because you mean to act on it: a hackathon deadline, a prompt to try, a course, a freelance tip. It sits in Saved. The deadline passes. Saving feels like progress, but nothing happens.

## What it does

1. Drop a screenshot of a saved post, with an optional note.
2. Confirm how long it will take. The model suggests minutes, but only the minutes you confirm are ever scheduled.
3. Approve a time. The block is written to your Google Calendar, read back to check it matches, and rechecked when your calendar changes.

Every field shows where it came from. A deadline only exists if its supporting quote is found in your note or in the text the model read from the image. Anything the post does not state stays **Missing**. Nothing is invented: not deadlines, not dates, not links, not urgency.

## How Muse Spark Open is used

Muse Spark Open is an open weights model. This project calls `meta-models/muse-spark-open-1026` through Baseten's OpenAI compatible API.

- **Image input.** The screenshot is sent as a base64 data URL, downscaled to 1280 px on the longest edge. The original is kept for you.
- **Extraction.** The model returns structured JSON: transcription, title, goal, kind, deadline as local wall time plus an IANA timezone, event dates, deliverables, exact prompts and links, an evidence quote and a suggested number of minutes. Code then validates it. Quotes must be found in the note or the transcription, the deadline's UTC time is computed by code from the wall time and the timezone, and an offset the model adds is ignored.
- **Tool calling with read only tools.** When you give the planner a preference, the model plans with two tools, `get_availability` and `find_slot`, for up to 6 turns. Neither tool writes. The slot it proposes must be one that `find_slot` returned, and it is revalidated with the same checks as an approval. If the model fails or proposes something invalid, the app falls back to the earliest valid slot found by code. Every run is stored as a trace you can open.
- **Code gated writes.** The model never writes to the calendar. A write happens only after you approve a specific slot, with an idempotency key per block, a fresh availability check, and a read back afterwards that flags any drift in start, end or timezone. Moving a block marks the old one superseded, so the two are never both counted.

## Verified facts

These were checked by running them. Details and numbers are in [docs/TEST_RESULTS.md](docs/TEST_RESULTS.md).

- Server tests: 263 pass, with no network calls.
- Demo seed: 14 of 14 illustrative posts extracted, 14 of 14 deadlines as expected, 12 of 14 goals as expected, 7.2 s average per file, zero Google Calendar calls.
- Timezone: Africa/Casablanca is +00:00. Node's built in timezone data says +01:00, which is wrong, so all conversions use moment-timezone and the server refuses to start if its startup self test fails. When the model writes an offset, code ignores it and computes the time itself.
- Google Calendar: the full flow of propose, approve, read back, recheck, conflict, move and cleanup passed 8 of 8 steps on a real calendar (recorded in `server/README.md`).
- Baseten: text, JSON extraction, tool calling and image input work with this model.

## Honest limits

- Single user and local only. There is no login. Google OAuth runs in Testing mode, so only listed test users can connect.
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

## Setup

You need Node 22 or newer, a Baseten API key, and a Google Cloud OAuth client.

1. Install and configure:
   ```
   cd server
   npm install
   cp ../.env.example ../.env
   ```
   Fill in `BASETEN_API_KEY`, `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`. Keep `GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback`. `.env` is gitignored.
2. In Google Cloud, enable the Google Calendar API, create an OAuth client for a web app with that redirect URI, keep the consent screen in Testing mode, and add your account as a test user. The app asks for the `calendar.events` and `calendar.freebusy` scopes.
3. Start the server on http://localhost:3000 (loopback only):
   ```
   npm start
   ```
4. In a second terminal start the web app on http://localhost:5173, which proxies `/api` and `/auth` to the server:
   ```
   cd web
   npm install
   npm run dev
   ```
5. Open the app, connect Google Calendar, and set your timezone and working hours in settings. Missing timezone is never defaulted, scheduling stays off until you set one.
6. Optional demo data. Stop the server, then run these from the repo root. The seed makes 14 real model calls and backs up the database first:
   ```
   node scripts/seed-demo.mjs
   node scripts/demo-reset.mjs
   ```
   The reset restores the seeded state and keeps your settings and Google connection. Neither script touches Google Calendar. Events you create while trying the app stay on your calendar, delete them by hand.

Run the tests with `cd server && npm test`. More detail on the server is in [server/README.md](server/README.md) and the API in [server/docs/API.md](server/docs/API.md).

## Built with

Muse Spark Open on Baseten, Node.js, Express, SQLite, moment-timezone, the Google Calendar API, React, Vite, TypeScript and Tailwind CSS.
