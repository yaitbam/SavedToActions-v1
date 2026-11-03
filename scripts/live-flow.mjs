// The full flow on YOUR real Google Calendar, through the app's own HTTP routes:
//   propose -> approve (write + read-back) -> recheck (green) -> add a conflicting meeting -> recheck (amber)
//   -> approved move -> read-back -> recheck (green) -> clean up.
//
// Run: node scripts/live-flow.mjs
//
// Safety:
// - Runs on a SCRATCH COPY of server/data/savedtoaction.db, deleted at the end. Your real database is untouched.
// - Every event this script creates is tracked by id. Cleanup deletes exactly those ids and nothing else,
//   then checks the window for anything of ours that is left. It prints counts, never titles of your events.
// - The conflicting meeting is titled "SavedToAction live flow: test conflict (deleted automatically)".
// - No attendees, so nobody is notified.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const realDb = path.join(root, "server", "data", "savedtoaction.db");
const scratch = path.join(root, "server", "data", `live-flow-${Date.now()}`);
fs.mkdirSync(scratch, { recursive: true });
for (const suffix of ["", "-wal", "-shm"]) if (fs.existsSync(realDb + suffix)) fs.copyFileSync(realDb + suffix, path.join(scratch, `savedtoaction.db${suffix}`));
process.env.DB_PATH = path.join(scratch, "savedtoaction.db");
process.env.WATCHER = "off";

const { config } = await import("../server/src/config.js");
const { createApp } = await import("../server/src/app.js");
const { openDb, getSettings, saveSettings } = await import("../server/src/db.js");
const { createGoogleAuth } = await import("../server/src/google/auth.js");
const { createCalendarClient } = await import("../server/src/google/calendar.js");
const { createRecheckService } = await import("../server/src/services/recheck.js");
const { TAG_APP, APP_ID, compareReadback } = await import("../server/src/scheduler/index.js");
const { runSelfTest } = await import("../server/src/tz.js");

const TEST_TITLE = "SavedToAction live flow test (deleted automatically)";
const CONFLICT_TITLE = "SavedToAction live flow: test conflict (deleted automatically)";
const results = [];
const created = new Set();
let server;
let exitCode = 0;

function report(step, ok, lines) {
  results.push({ step, ok });
  console.log(`\n${ok ? "PASS" : "FAIL"}  ${step}`);
  for (const l of [].concat(lines)) console.log(`      ${l}`);
  if (!ok) exitCode = 1;
}

try {
  runSelfTest();
  const db = openDb(config.dbPath);
  const googleAuth = createGoogleAuth({ db, config });
  const status = googleAuth.status();
  if (!status.connected || status.missingScopes.length) {
    console.error("Google is not connected with the needed scopes. Open http://localhost:3000/auth/google first.");
    process.exit(1);
  }
  let settings = getSettings(db);
  if (!settings.tz) settings = saveSettings(db, { ...settings, tz: "Africa/Casablanca" });

  // Track every event we create, so cleanup can remove exactly those.
  const calendar = createCalendarClient({ googleAuth });
  const insert = calendar.insertEvent.bind(calendar);
  calendar.insertEvent = async (body) => {
    created.add(body.id);
    return insert(body);
  };
  const recheckService = createRecheckService({ db, calendar, canRun: () => true, logger: { log() {}, warn() {}, error() {} } });
  const app = createApp({ db, config, googleAuth, selfTest: runSelfTest(), provider: null, calendar, recheck: recheckService });
  server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, body) => {
    const res = await fetch(base + p, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, json: await res.json() };
  };

  console.log(`Settings: timezone ${settings.tz}, working hours ${settings.workStart} to ${settings.workEnd}, ignore all-day events ${settings.ignoreAllDay ? "ON" : "off"}`);

  // An action to schedule: 15 minutes, deadline in 3 days at 18:00 (wall time in the settings timezone).
  const nowIso = new Date().toISOString();
  const deadlineDay = new Date(Date.now() + 3 * 24 * 3600_000).toISOString().slice(0, 10);
  const saveId = Number(db.prepare("INSERT INTO saves (note, imported_at) VALUES ('live flow test', ?)").run(nowIso).lastInsertRowid);
  const actionId = Number(
    db
      .prepare(
        `INSERT INTO actions (save_id, goal_id, kind, title, deadline_wall, deadline_tz, deliverables_json, suggested_effort_min,
           confirmed_effort_min, status, created_at, updated_at) VALUES (?, 3, 'opportunity', ?, ?, ?, '["Live flow test"]', 15, 15, 'open', ?, ?)`,
      )
      .run(saveId, TEST_TITLE, `${deadlineDay}T18:00`, settings.tz, nowIso, nowIso).lastInsertRowid,
  );

  // 1. Propose.
  const p = await call("POST", `/api/actions/${actionId}/propose`);
  report("1. propose (read only)", p.status === 200 && p.json.found === true, [
    `source: ${p.json.source}, mode: ${p.json.mode}`,
    p.json.slot ? `slot: ${p.json.slot.startDisplay} to ${p.json.slot.endDisplay}` : `no slot: ${JSON.stringify(p.json)}`,
  ]);
  if (!p.json.found) throw new Error("no slot to approve, stopping");

  // 2. Approve: fresh check, write, read-back.
  const a = await call("POST", `/api/actions/${actionId}/approve`, { startUtc: p.json.slot.startUtc, endUtc: p.json.slot.endUtc, approved: true });
  const block1 = a.json.block;
  const ev1 = block1 ? await calendar.getEvent(block1.googleEventId) : null;
  const tagged = ev1?.extendedProperties?.private?.[TAG_APP] === APP_ID;
  report("2. approve: write + read-back", a.status === 201 && block1?.readback.status === "ok" && tagged, [
    `HTTP ${a.status}, action status: ${a.json.action?.status}`,
    block1 && `block: ${block1.startDisplay} to ${block1.endDisplay}, event ${block1.googleEventId}`,
    block1 && `read-back: ${block1.readback.status}${block1.readback.drift.length ? ` ${JSON.stringify(block1.readback.drift)}` : ""}`,
    ev1 && `Google returned: ${ev1.start.dateTime} (timeZone ${ev1.start.timeZone}), status ${ev1.status}, our tag present: ${tagged}`,
  ]);
  if (!block1) throw new Error("approve failed, stopping");

  // 3. Recheck: expect green.
  const r1 = await call("POST", `/api/actions/${actionId}/recheck`);
  report("3. recheck (expect green)", r1.json.check?.state === "green", [
    `state: ${r1.json.check?.state}, reason: ${r1.json.check?.reason}, source: ${r1.json.check?.source}`,
    r1.json.check?.latestFeasibleStart && `latest feasible start: ${r1.json.check.latestFeasibleStart.startDisplay}`,
  ]);

  // 4. Add a conflicting meeting that overlaps the block.
  const startMs = Date.parse(block1.startUtc);
  const conflictBody = {
    id: `stlive${Date.now().toString(32)}${Math.floor(Math.random() * 1e6).toString(32)}`.replace(/[^0-9a-v]/g, "a"),
    summary: CONFLICT_TITLE,
    start: { dateTime: new Date(startMs + 3 * 60_000).toISOString(), timeZone: settings.tz },
    end: { dateTime: new Date(startMs + 23 * 60_000).toISOString(), timeZone: settings.tz },
    transparency: "opaque",
  };
  await calendar.insertEvent(conflictBody);
  report("4. add a conflicting meeting", true, [`${conflictBody.start.dateTime} to ${conflictBody.end.dateTime} (overlaps the block), id ${conflictBody.id}`]);

  // 5. Recheck: expect amber with an explained alternative.
  const r2 = await call("POST", `/api/actions/${actionId}/recheck`);
  const c2 = r2.json.check;
  report("5. recheck (expect amber)", c2?.state === "amber" && Boolean(c2.alternative) && c2.conflicts?.[0]?.summary === CONFLICT_TITLE, [
    `state: ${c2?.state}, reason: ${c2?.reason}`,
    ...(c2?.explanation ?? []),
    c2?.alternative && `alternative: ${c2.alternative.startDisplay} to ${c2.alternative.endDisplay}`,
  ]);
  if (!c2?.alternative) throw new Error("no alternative to move to, stopping");

  // 6. Approved move to the alternative.
  const m = await call("POST", `/api/actions/${actionId}/move`, { startUtc: c2.alternative.startUtc, endUtc: c2.alternative.endUtc, approved: true });
  const block2 = m.json.block;
  report("6. move to the alternative (approved)", m.status === 201 && block2?.readback.status === "ok" && m.json.previous?.eventDeleted === true, [
    `HTTP ${m.status}`,
    block2 && `new block: ${block2.startDisplay} to ${block2.endDisplay}, read-back ${block2.readback.status}`,
    m.json.previous && `old block #${m.json.previous.id}: event deleted ${m.json.previous.eventDeleted}${m.json.previous.deleteError ? ` (${m.json.previous.deleteError})` : ""}`,
  ]);
  if (!block2) throw new Error("move failed, stopping");

  // 7. Read-back, independently: the new event is ours and correct, the old one is gone.
  const rb = await call("POST", `/api/actions/${actionId}/readback`);
  const ev2 = await calendar.getEvent(block2.googleEventId);
  const old = await calendar.getEvent(block1.googleEventId);
  const cmp = compareReadback({ block: block2, event: ev2 });
  const supersededRow = db.prepare("SELECT superseded_by FROM blocks WHERE id = ?").get(block1.id);
  const activeCount = db.prepare("SELECT COUNT(*) AS n FROM blocks WHERE action_id = ? AND superseded_by IS NULL AND cancelled_at IS NULL").get(actionId).n;
  report("7. read-back after the move", rb.json.block?.readback.status === "ok" && cmp.status === "ok" && (old === null || old.status === "cancelled") && supersededRow.superseded_by === block2.id && activeCount === 1, [
    `POST /readback: ${rb.json.block?.readback.status}`,
    `independent compare of the new event: ${cmp.status}${cmp.drift.length ? ` ${JSON.stringify(cmp.drift)}` : ""} (Google: ${ev2?.start.dateTime}, ${ev2?.start.timeZone})`,
    `old event: ${old === null ? "gone" : old.status}`,
    `old block superseded by new: ${supersededRow.superseded_by === block2.id}, active blocks for this action: ${activeCount}`,
  ]);

  // 8. Recheck after the move: expect green.
  const r3 = await call("POST", `/api/actions/${actionId}/recheck`);
  report("8. recheck after the move (expect green)", r3.json.check?.state === "green", [`state: ${r3.json.check?.state}, reason: ${r3.json.check?.reason}`]);

  const history = (await call("GET", `/api/actions/${actionId}/checks`)).json.checks.map((c) => `${c.state}/${c.source}`).reverse();
  console.log(`\nChecks stored for this action, oldest first: ${history.join(", ")}`);
} catch (err) {
  exitCode = 1;
  console.error(`\nSTOPPED: ${err.code ?? ""} ${err.message}`);
} finally {
  // Cleanup: delete exactly the events we created, then verify.
  console.log("\n--- cleanup ---");
  try {
    const googleAuth = createGoogleAuth({ db: openDb(config.dbPath), config });
    const calendar = createCalendarClient({ googleAuth });
    for (const id of created) {
      try {
        await calendar.deleteEvent(id);
        const after = await calendar.getEvent(id);
        console.log(`deleted ${id}: now ${after === null ? "gone" : after.status}`);
        if (after !== null && after.status !== "cancelled") exitCode = 1;
      } catch (err) {
        console.error(`COULD NOT DELETE ${id}: ${err.message}. Delete "SavedToAction live flow" events by hand.`);
        exitCode = 1;
      }
    }
    // Anything of ours left within the next 4 days? Counts only, no titles of your events.
    const left = (await calendar.listEvents({ fromMs: Date.now() - 3600_000, toMs: Date.now() + 4 * 24 * 3600_000 })).filter((e) =>
      String(e.summary ?? "").startsWith("SavedToAction live flow"),
    );
    console.log(`events left on the calendar from this test: ${left.length}`);
    if (left.length) exitCode = 1;
  } catch (err) {
    console.error(`cleanup check failed: ${err.message}`);
    exitCode = 1;
  }
  if (server) await new Promise((resolve) => server.close(resolve));
  fs.rmSync(scratch, { recursive: true, force: true });
  console.log(`scratch database removed: ${!fs.existsSync(scratch)}`);
  console.log(`\nSUMMARY: ${results.filter((r) => r.ok).length}/${results.length} steps passed${exitCode ? ", with problems (see above)" : ""}`);
  process.exitCode = exitCode;
}
