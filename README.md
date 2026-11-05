# SavedToAction

![Built with Muse Spark Open](https://img.shields.io/badge/Built%20with-Muse%20Spark%20Open-14110F)

Saved is not done. SavedToAction turns a screenshot of a post you saved into protected time on your calendar, and moves it when your week changes.

Demo video: VIDEO_URL

## What it does

You save a post because you mean to act on it: a hackathon deadline, a prompt to try, a course, a freelance tip. It sits in Saved and the deadline passes. SavedToAction closes that gap in three steps.

1. **Drop a screenshot** with a one line note ("tonight, 30 min") and, if you like, the link to the post. You can crop it first. Cropping happens in your browser, so the parts you cut are never uploaded.
2. **Muse suggests a time.** It reads the screenshot and your note, and code finds a free slot in your calendar. The first thing you see is a time, not a form. The minutes are on screen and you can change them.
3. **You approve it with one tap.** The block is written to your Google Calendar with a link back to the post, read back to check it matches, and rechecked when your calendar changes. Marking it done adds `Done ·` to the event title.

Each save is sorted into one of your goals (six general starters, up to six active, editable in Settings), and Progress shows how many saves in each goal became action. Every field shows where it came from. A deadline only exists if its supporting quote is found in your note or in the text read from the image. Anything the post does not state stays **Missing**. Nothing is invented.

## Try the demo (no Google needed)

The login page has an **Explore the demo** button. It opens a shared, read only workspace with the demo screenshots already saved. It cannot book anything and uses no credits.

```sh
npm --prefix server install
npm --prefix web install
cp -n .env.example .env
node scripts/load-demo.mjs
npm --prefix server start
npm --prefix web run dev
```

Run the last two in separate terminals. Then open **http://localhost:5173/login** and choose **Explore the demo**. Node 22 or newer is needed.

- `node scripts/load-demo.mjs` fills the demo workspace. Each screenshot is saved with the note in `fixtures/demo/notes.json`, the way a user would type one. If `fixtures/demo/extracted.json` exists, it replays the model answers recorded in it, with no key, no credits and no network. If not, it reads the screenshots and notes with the model from your `.env` (see the variables below) and saves the answers there for next time.
- Running it again adds nothing. `node scripts/load-demo.mjs reset` removes the demo, and `node scripts/load-demo.mjs live` reads the screenshots with the model again (run reset first).
- It never touches Google Calendar. Use the same `.env`, so the loader and the server share one `DATA_DIR`.

## How Muse Spark Open is used

Muse Spark Open is an open weights model. The app calls `meta-models/muse-spark-open-1026` through Baseten's OpenAI compatible API, which is the default. The Meta Model API is available as a second provider behind `MODEL_PROVIDER=meta`.

- **Reads the image.** The screenshot goes to the model as a base64 data URL, downscaled to 1280 px. The model returns structured JSON: transcription, title, goal, deadline as local wall time plus a timezone, event dates, an evidence quote, a suggested number of minutes, and what your note asked for.
- **Code validates everything.** Quotes must be found in the note or the transcription. Code computes the deadline's UTC time and ignores any offset the model writes.
- **Finds the first time with no model call.** Code searches your calendar, working hours, deadline and note. Muse is asked again only when you choose "Ask Muse for a different time".
- **Plans with read only tools.** For that request the model uses `get_availability` and `find_slot` for up to 6 turns. Its proposal must be a slot `find_slot` returned, and it is revalidated like an approval. If it fails, code falls back to the earliest valid slot. Every run is stored as a trace.
- **Never writes.** A calendar write happens only after you approve a slot, with an idempotency key, a fresh availability check and a read back that flags any drift.

## Setup

You need Node 22 or newer, a model key (Baseten by default, or Meta), and a Google Cloud OAuth **Web application** client. Setup is the same 5 commands as the demo, minus `load-demo.mjs`.

1. Install and copy the settings (first 3 commands above), then fill in the keys in `.env` (table below). Keep `AUTH_MODE=on`.
2. Enable the Google Calendar API. In the OAuth client's **Authorized redirect URIs**, register `http://localhost:3000/auth/google/callback` exactly. Login and Calendar share it. Keep consent in Testing mode and add your Google account as a test user.
3. Start the backend and the web app (the last 2 commands above).
4. Open **http://localhost:5173**, choose **Open workspace**, sign in, and confirm your details. Connect Calendar from Overview, confirm your timezone and choose your goals. Use `localhost` throughout.

| Variable | Meaning | Default |
|---|---|---|
| `MODEL_PROVIDER` | Which model API to call: `baseten` or `meta` | `baseten` |
| `BASETEN_API_KEY` | Baseten key, needed when the provider is `baseten` | none |
| `META_API_KEY` (or `MODEL_API_KEY`) | Meta key, needed when the provider is `meta` | none |
| `META_BASE_URL`, `META_MODEL` | Meta endpoint and model id | `https://api.meta.ai/v1`, `muse-spark-1.3` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth web client | none |
| `GOOGLE_REDIRECT_URI` | Must match the Google console exactly | `http://localhost:3000/auth/google/callback` |
| `AUTH_MODE` | `on`, or `off` for an isolated local legacy workspace only | `on` |
| `PORT`, `FRONTEND_ORIGIN` | Server port and web app origin | `3000`, `http://localhost:5173` |
| `DATA_DIR` | Where accounts, workspaces and the dev token key live | `data` |
| `OWNER_EMAIL`, `COOKIE_SECURE`, `TOKEN_ENC_KEY`, `FREE_DAILY_CREDITS` | Production and quota settings | see `.env.example` |

For HTTPS production, set `COOKIE_SECURE=true`, a secret `TOKEN_ENC_KEY` of 64 hex characters, and the public origin and callback URLs. Back up the key and the data folder outside Git. `.env.example` lists every variable.

Checks: `npm --prefix server test`, `npm --prefix web test` and `npm --prefix web run build`.

## Safety and privacy

- **No scraping.** The input is only the screenshots, notes and links you provide. A post link is kept as a reference. The app never fetches it and never sends it to the model.
- **The note is not a prompt.** It is limited to 160 characters and read for two things only: when and how long. Each must quote words really in the note, so it cannot be used to ask the model for something else.
- **Private workspaces.** Each account has its own database, screenshots, settings and Calendar credentials. Sessions use HttpOnly cookies and last seven days. Calendar tokens are encrypted on the server. You can delete your account and data in Settings, which asks Google to revoke access and keeps events already on your calendar.
- **Credits.** A free account gets 20 model reads per GMT day (owners 100). A failed model call refunds its credit. There are no payments.
- **No advice.** The app extracts and schedules. It gives no financial, medical or political advice.

## Honest limits

- Google sign in is in Testing mode, so an account must be added as a test user. Public Google approval is a separate step.
- It runs as one server process with persistent disk, behind an HTTPS reverse proxy when hosted.
- The demo workspace is read only and shows one recorded model run.
- A post with a date but no time gets a deadline at 23:59 that day, always labeled as assumed. You can set the real time.
- Reading a screenshot takes about 10 to 20 seconds, and you wait while it runs.
- A new account starts in US Eastern time and is asked to confirm its timezone. Completions are marked by you, not detected.

What was checked by running it: the server tests (fake Google and model, no external calls), the crop editor in a browser, the full propose, approve, read back, recheck, conflict, move and cleanup flow on a real calendar (8 of 8 steps), the Africa/Casablanca timezone case (Node's built in data is wrong there, so all conversions use moment-timezone and the server refuses to start if its self test fails), and Baseten text, JSON, tool calling and image input. Numbers are in [docs/TEST_RESULTS.md](docs/TEST_RESULTS.md).

## Documentation

| File | What it covers |
|---|---|
| [server/README.md](server/README.md) | Backend guide: architecture, scheduling rules, data model, model providers, scripts |
| [server/docs/API.md](server/docs/API.md) | The HTTP API contract |
| [web/README.md](web/README.md) | Frontend guide: routes, session handling, UI rules, browser checks |
| [docs/TEST_RESULTS.md](docs/TEST_RESULTS.md) | Measured results: tests, timezone catch, live calendar flow, reasoning effort |
| [fixtures/demo/README.md](fixtures/demo/README.md) | The demo screenshots and who owns them |
| [LICENSE](LICENSE) | MIT |

## Built with

Muse Spark Open on Baseten, Node.js, Express, SQLite, moment-timezone, the Google Calendar API, React, Vite, TypeScript and Tailwind CSS.
