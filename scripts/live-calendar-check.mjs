// One real round trip against YOUR Google Calendar, to verify what the unit tests can only simulate:
// does Google store Africa/Casablanca on 2026-11-05 the way our own timezone data says (+00:00)?
//
// Run: node scripts/live-calendar-check.mjs
//
// What it does, in order:
//   1. Counts events in a 15 minute window on Thu 5 Nov 2026, 14:00 Casablanca time (prints a number, no titles).
//   2. Creates ONE event in that window, titled "SavedToAction live check (deleted automatically)".
//   3. Reads it back and compares start, end, timezone and offset with compareReadback (the app's own function).
//   4. Deletes that event (by its id, nothing else is touched) and reads back that it is gone.
// The event is deleted even if a step fails. No attendees, so nobody is notified.

const { config } = await import("../server/src/config.js");
const { openDb } = await import("../server/src/db.js");
const { createGoogleAuth } = await import("../server/src/google/auth.js");
const { buildEventBody, createCalendarClient } = await import("../server/src/google/calendar.js");
const { blockTags, compareReadback, eventIdFromKey, makeIdempotencyKey } = await import("../server/src/scheduler/index.js");
const { dataVersion, offsetAt, runSelfTest, wallToUtc } = await import("../server/src/tz.js");

const TZ = "Africa/Casablanca";
const WALL_START = "2026-11-05T14:00";
const WALL_END = "2026-11-05T14:15";

const self = runSelfTest();
console.log(`Our timezone data: moment-timezone tzdata ${dataVersion()}, ${TZ} on ${self.instantUtc} is ${self.actual}`);

const db = openDb(config.dbPath);
const googleAuth = createGoogleAuth({ db, config });
const status = googleAuth.status();
if (!status.connected || status.missingScopes.length) {
  console.error("Google is not connected with the needed scopes. Open http://localhost:3000/auth/google first.");
  process.exit(1);
}
const calendar = createCalendarClient({ googleAuth });

const start = wallToUtc(WALL_START, TZ);
const end = wallToUtc(WALL_END, TZ);
// attempt is just a random salt here, so every run gets its own key and event id.
const key = makeIdempotencyKey({ actionId: 0, startUtc: start.utc, endUtc: end.utc, attempt: 1 + Math.floor(Math.random() * 1e9) });
const eventId = eventIdFromKey(key);
const block = { startUtc: start.utc, endUtc: end.utc, tz: TZ, idempotencyKey: key };

const step = (name, value) => console.log(`${name}: ${value}`);

let created = false;
try {
  const nearby = await calendar.listEvents({ fromMs: start.ms, toMs: end.ms });
  step("1. events already in the window (events.list)", nearby.length);

  await calendar.insertEvent(
    buildEventBody({
      eventId,
      summary: "SavedToAction live check (deleted automatically)",
      description: "Created by scripts/live-calendar-check.mjs. Safe to delete.",
      startUtc: start.utc,
      endUtc: end.utc,
      tz: TZ,
      tags: blockTags(key),
    }),
  );
  created = true;
  step("2. event created, id", eventId);

  const event = await calendar.getEvent(eventId);
  step("3a. Google returned start", `${event.start.dateTime} (timeZone ${event.start.timeZone})`);
  step("3b. Google returned end", `${event.end.dateTime} (timeZone ${event.end.timeZone})`);
  step("3c. our own data says the offset is", offsetAt(start.ms, TZ));
  const cmp = compareReadback({ block, event });
  step("3d. read-back comparison", cmp.status === "ok" ? "OK, no drift" : `DRIFT ${JSON.stringify(cmp.drift)}`);
} catch (err) {
  console.error(`FAILED: ${err.code ?? ""} ${err.message}`);
  process.exitCode = 1;
} finally {
  if (created) {
    try {
      await calendar.deleteEvent(eventId);
      const after = await calendar.getEvent(eventId);
      step("4. event deleted, read back as", after === null ? "gone" : after.status);
    } catch (err) {
      console.error(`COULD NOT DELETE the test event ${eventId}: ${err.message}. Delete "SavedToAction live check" by hand.`);
      process.exitCode = 1;
    }
  }
}
console.log("\nDone.");
