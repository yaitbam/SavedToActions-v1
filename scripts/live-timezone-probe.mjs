// Asks Google which UTC offset IT applies to Africa/Casablanca on a few dates, and compares it with ours.
//
// Run: node scripts/live-timezone-probe.mjs
//
// How: for each date it creates a short event whose start is a LOCAL wall time with NO offset plus timeZone
// "Africa/Casablanca". Google has to convert that with its own timezone data. Reading the event back shows
// which instant Google chose. Our moment-timezone data (tzdata 2026f) is compared with it.
// Each event is marked free time (transparent), has no attendees, is deleted right after the read, and is
// deleted again in a finally block if anything fails.
const { config } = await import("../server/src/config.js");
const { openDb } = await import("../server/src/db.js");
const { createGoogleAuth } = await import("../server/src/google/auth.js");
const { createCalendarClient } = await import("../server/src/google/calendar.js");
const { eventIdFromKey, makeIdempotencyKey, offsetOfDateTime } = await import("../server/src/scheduler/index.js");
const { dataVersion, offsetAt, wallToUtc } = await import("../server/src/tz.js");

const TZ = "Africa/Casablanca";
const PROBES = [
  ["2026-11-05T14:00", "demo date, after the rule change"],
  ["2026-12-15T14:00", "winter"],
  ["2026-07-15T14:00", "summer, before the rule change"],
  ["2026-03-01T14:00", "inside Ramadan 2026"],
];

const db = openDb(config.dbPath);
const googleAuth = createGoogleAuth({ db, config });
const status = googleAuth.status();
if (!status.connected || status.missingScopes.length) {
  console.error("Google is not connected with the needed scopes. Open http://localhost:3000/auth/google first.");
  process.exit(1);
}
const calendar = createCalendarClient({ googleAuth });
console.log(`Our data: moment-timezone tzdata ${dataVersion()}\n`);

const rows = [];
for (const [wall, label] of PROBES) {
  const ours = wallToUtc(wall, TZ);
  const end = wallToUtc(wall.replace("T14:00", "T14:15"), TZ);
  const key = makeIdempotencyKey({ actionId: 0, startUtc: ours.utc, endUtc: end.utc, attempt: 1 + Math.floor(Math.random() * 1e9) });
  const eventId = eventIdFromKey(key);
  let created = false;
  try {
    await calendar.insertEvent({
      id: eventId,
      summary: "SavedToAction timezone probe (deleted automatically)",
      start: { dateTime: `${wall}:00`, timeZone: TZ },
      end: { dateTime: `${wall.replace("T14:00", "T14:15")}:00`, timeZone: TZ },
      transparency: "transparent",
    });
    created = true;
    const got = await calendar.getEvent(eventId);
    const googleInstant = Date.parse(got.start.dateTime);
    const googleOffset = offsetOfDateTime(got.start.dateTime);
    rows.push({
      date: wall,
      case: label,
      "we compute offset": offsetAt(ours.ms, TZ),
      "Google offset": googleOffset ?? "(none)",
      "Google instant (UTC)": Number.isFinite(googleInstant) ? new Date(googleInstant).toISOString() : "?",
      "our instant (UTC)": ours.utc,
      agree: googleInstant === ours.ms ? "yes" : "NO",
    });
  } catch (err) {
    rows.push({ date: wall, case: label, "we compute offset": "-", "Google offset": `ERROR ${err.code ?? ""} ${err.message}`, "Google instant (UTC)": "-", "our instant (UTC)": "-", agree: "-" });
  } finally {
    if (created) {
      try {
        await calendar.deleteEvent(eventId);
      } catch (err) {
        console.error(`COULD NOT DELETE probe event ${eventId}: ${err.message}. Delete "timezone probe" by hand.`);
        process.exitCode = 1;
      }
    }
  }
}
console.table(rows);
console.log("Done. All probe events were deleted.");
