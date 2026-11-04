# SavedToAction

![Built with Muse Spark Open](https://img.shields.io/badge/Built%20with-Muse%20Spark%20Open-14110F)

Saved is not done. SavedToAction turns a screenshot of a post you saved into protected time on your calendar, and moves it when your week changes.

## The problem

You save a post because you mean to act on it: a hackathon deadline, a prompt to try, a course, a freelance tip. It sits in Saved. The deadline passes. Saving feels like progress, but nothing happens.

## What it does

1. Drop a screenshot of a saved post, with a one line note of when and for how long ("tonight, 30 min") and, if you like, the link to the post. You can crop the screenshot first, to cut out the phone status bar, the bottom bar and other posts. Cropping happens in your browser, so the parts you cut are never uploaded.
2. Muse reads the screenshot and your note and suggests a free time, so the first thing you see is a time and not a form. The minutes are on screen and you can change them. If nothing fits the time your note asked for, it says so and shows the next free time.
3. Approve it with one tap. The minutes shown with the time are confirmed by that tap, and only confirmed minutes are ever scheduled. The block is written to your Google Calendar with a link back to the original post, read back to check it matches, and rechecked when your calendar changes. Marking a booked task done adds `Done ·` to the event title after approval and verification.

## Goals

Goals are what makes a save more than a calendar task. Each save is sorted into one of your goals, and Progress shows how many saves in each goal became action.

- A new account starts with six general goals: Earn more, Learn a skill, Events and opportunities, Career growth, Health and wellbeing, and Create and build. Travel and experiences and Home and family are offered too.
- Right after you connect Calendar, Overview asks which goals your saves are for. You tick general starters, write your own, or skip to keep the defaults.
- You can add, edit, reorder and archive up to six active goals in Settings. A goal with saves cannot be archived until they move, so archived goals never hide live work.
- Each goal has a short description, such as "Jobs, networking, portfolio". It is sent to the model with the name and helps it choose. The model may also pick no goal, and then you choose.

Every field shows where it came from. A deadline only exists if its supporting quote is found in your note or in the text the model read from the image. Anything the post does not state stays **Missing**. Nothing is invented: not deadlines, not dates, not links, not urgency.

## How Muse Spark Open is used

Muse Spark Open is an open weights model. This project calls `meta-models/muse-spark-open-1026` through Baseten's OpenAI compatible API.

- **Image input.** The screenshot is sent as a base64 data URL, downscaled to 1280 px on the longest edge. The original is kept for you.
- **Extraction.** The model returns structured JSON: transcription, title, goal, kind, deadline as local wall time plus an IANA timezone, event dates, deliverables, exact prompts and links, an evidence quote, a suggested number of minutes, and what your note asked for (when, and how long). Code then validates it. Quotes must be found in the note or the transcription, the deadline's UTC time is computed by code from the wall time and the timezone, and an offset the model adds is ignored.
- **A first time with no extra model call.** The first suggested time is found by code from your calendar, working hours, the deadline and what your note asked for. Muse is only asked again when you choose "Ask Muse for a different time".
- **Tool calling with read only tools.** When you ask Muse for a different time in your own words, the model plans with two tools, `get_availability` and `find_slot`, for up to 6 turns. Neither tool writes. The slot it proposes must be one that `find_slot` returned, and it is revalidated with the same checks as an approval. If the model fails or proposes something invalid, the app falls back to the earliest valid slot found by code. Every run is stored as a trace you can open.
- **Code gated writes.** The model never writes to the calendar. A write happens only after you approve a specific slot, with an idempotency key per block, a fresh availability check, and a read back afterwards that flags any drift in start, end or timezone. Moving a block marks the old one superseded, so the two are never both counted.

## Verified facts

These were checked by running them. Details and numbers are in [docs/TEST_RESULTS.md](docs/TEST_RESULTS.md).

- Server tests: 319 pass with isolated databases and fake Google/model services. No external Google or model calls are made by the suite.
- Browser checks: the crop editor was exercised with the mouse and keyboard and the uploaded image size was checked (`web/test/crop.cjs`).
- Demo seed: 14 of 14 illustrative posts extracted, 14 of 14 deadlines as expected, 12 of 14 goals as expected, 7.2 s average per file, zero Google Calendar calls.
- Timezone: Africa/Casablanca is +00:00. Node's built in timezone data says +01:00, which is wrong, so all conversions use moment-timezone and the server refuses to start if its startup self test fails. When the model writes an offset, code ignores it and computes the time itself.
- Google Calendar: the full flow of propose, approve, read back, recheck, conflict, move and cleanup passed 8 of 8 steps on a real calendar (recorded in `server/README.md`).
- Baseten: text, JSON extraction, tool calling and image input work with this model.

## Honest limits

- Google login and private workspaces are implemented. Google OAuth remains in Testing mode, so accounts must be added as test users. Public Google approval is a separate release step.
- Hosting targets one server process with persistent disk. The shared demo, trust ledger and migration of legacy local data are not implemented.
- Goal assignment is the weakest part of extraction. In the demo seed, with the three original goals and no descriptions, the model returned no goal for 2 of 14 posts, and results varied between runs. Goal descriptions and the six general goals are meant to help, but that has not been measured yet. You can always pick the goal yourself.
- Posts that give a date but no time get a deadline at the end of that day (23:59). It is always labeled as assumed on the save, and you can set the real time. A date is never turned into a different day.
- The model takes about 7 s per screenshot, so the app shows a loading state while it reads. Extraction is not yet in the background.
- A new account starts in US Eastern time and is asked to confirm its timezone. Someone who skips that and works elsewhere would get blocks in Eastern time.
- Minutes written in the note are used as the starting point, and the user still approves the time that shows them. The sharing target for phones (share a screenshot straight to the app) is not built.
- Completions are self reported. Progress numbers are computed from database records only.
- The reasoning effort setting was compared on 5 screenshots, 4 of them synthetic. That is a small sample.
- Not verified yet: the background watcher against real Google over real time, how the Google Calendar web UI renders the blocks, `response_format` JSON mode on Baseten, and the Meta Model API, which this project does not use.
- Outside tester results are not in yet. See the empty section in [docs/TEST_RESULTS.md](docs/TEST_RESULTS.md).
- Model suggested minutes have not been measured against what users confirm.
- How often the note's "when" and "how long" are read correctly has not been measured yet.

## Other tools

Task managers, read later apps and calendar assistants overlap with parts of this. We did not compare against them and make no claim about what they can or cannot do. What this project combines is: a screenshot in, minutes you confirm, a write you approve, a read back after the write, and a recheck when the calendar changes.

## No scraping

SavedToAction never scrapes a platform, reads DMs, or posts or comments for you. The input is only screenshots, notes and pasted text that you provide. A post link you add is kept as a reference and opened only by you. The app never fetches it and never sends it to the model.

## The note is not a prompt

The note is limited to 160 characters and read for two things only: when to do it and how long it takes. Each must quote words that are really in the note. Anything else in it is ignored, so it cannot be used to ask the model for something else, and the cost of a save stays the same.

## Demo posts are fictional

The 14 images in `fixtures/demo/` are original illustrative posts. Every account, event, venue, grant and organization in them is invented. They are imported as "Imported demo data" and are never presented as real saves. No financial, medical or political advice is given.

## Accounts and privacy

Sign in with Google, confirm your name and verified email, then connect Google Calendar using the same Google account. You can upload and review saves before connecting Calendar. Right after you connect, Overview asks you to confirm your timezone and then to choose your goals. New accounts start in US Eastern time (`America/New_York`), so scheduling works straight away, and the timezone, working hours and goals can all be changed in Settings. Accounts that already had saves are not asked again.

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
6. Open **http://localhost:5173**, choose **Try it**, sign in, and confirm your details. Connect Calendar from Overview, which then asks you to confirm your timezone and choose your goals. Set your working hours in Settings. Use `localhost` consistently throughout the flow.

Account data defaults to `data/central.sqlite` and `data/workspaces/<workspace_key>/`, separate from the legacy `server/data/` workspace. Existing saves do not automatically become a new account's data. The old seed/reset scripts target the legacy database selected by `DB_PATH`, not signed-in account workspaces. Stop the server before using them. They never remove events already written to Google Calendar.

For HTTPS production, configure the public origin and callback URLs, set `COOKIE_SECURE=true`, and supply a secret `TOKEN_ENC_KEY` containing 64 hexadecimal characters. Keep the key and persistent data backed up outside Git. Local development creates a private token key when this variable is absent. See [account setup](docs/AUTH_SETUP.md) for configuration and current limits.

## Checks and component guides

```sh
npm --prefix server test
npm --prefix web run build
```

Browser checks need the app running and Playwright installed. `web/test/crop.cjs` is the one to start with.

[Server guide](server/README.md) covers storage, API behavior and scheduling. [Web guide](web/README.md) covers routes, session handling, development and browser checks. The [core API reference](server/docs/API.md) and [account setup](docs/AUTH_SETUP.md) provide further detail.

## Built with

Muse Spark Open on Baseten, Node.js, Express, SQLite, moment-timezone, the Google Calendar API, React, Vite, TypeScript and Tailwind CSS.
