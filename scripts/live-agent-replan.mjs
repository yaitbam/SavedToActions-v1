// The agent replan (move mode) on YOUR real Google Calendar, through the app's own HTTP routes:
//   propose -> approve (write + read-back) -> add a conflicting meeting -> POST /agent-plan (Muse Spark Open,
//   read only tools) -> verify trace + code gate + zero calendar writes -> approved /move -> read-back -> clean up.
//
// Run: node scripts/live-agent-replan.mjs   (needs BASETEN_API_KEY and a connected Google account)
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
const scratch = path.join(root, "server", "data", `live-agent-${Date.now()}`);
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
const { createProvider } = await import("../server/src/model/provider.js");

const TEST_TITLE = "SavedToAction live flow agent test (deleted automatically)";
const CONFLICT_TITLE = "SavedToAction live flow: agent test conflict (deleted automatically)";
const INSTRUCTION = "my block got a conflict, find a new slot before the deadline";
const writes = []; // every calendar write, with a phase label
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
  let phase = "setup";
  calendar.insertEvent = async (body) => {
    created.add(body.id);
    writes.push({ phase, op: "insert", id: body.id });
    return insert(body);
  };
  for (const op of ["updateEvent", "patchEvent", "deleteEvent"]) {
    if (typeof calendar[op] !== "function") continue;
    const orig = calendar[op].bind(calendar);
    calendar[op] = async (...args) => {
      writes.push({ phase, op, id: typeof args[0] === "string" ? args[0] : args[0]?.id });
      return orig(...args);
    };
  }
  const provider = createProvider(config.model);
  if (!provider.configured()) throw new Error("model provider not configured, set BASETEN_API_KEY");
  const recheckService = createRecheckService({ db, calendar, canRun: () => true, logger: { log() {}, warn() {}, error() {} } });
  const app = createApp({ db, config, googleAuth, selfTest: runSelfTest(), provider, calendar, recheck: recheckService });
  server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, body) => {
    const res = await fetch(base + p, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, json: await res.json() };
  };

  console.log(`Settings: timezone ${settings.tz}, working hours ${settings.workStart} to ${settings.workEnd}, ignore all-day events ${settings.ignoreAllDay ? "ON" : "off"}`);
  console.log(`Model: ${provider.name} ${provider.model}`);

  const nowIso = new Date().toISOString();
  const deadlineDay = new Date(Date.now() + 3 * 24 * 3600_000).toISOString().slice(0, 10);
  const saveId = Number(db.prepare("INSERT INTO saves (note, imported_at) VALUES ('live agent test', ?)").run(nowIso).lastInsertRowid);
  const actionId = Number(
    db
      .prepare(
        `INSERT INTO actions (save_id, goal_id, kind, title, deadline_wall, deadline_tz, deliverables_json, suggested_effort_min,
           confirmed_effort_min, status, created_at, updated_at) VALUES (?, 3, 'opportunity', ?, ?, ?, '["Live agent test"]', 15, 15, 'open', ?, ?)`,
      )
      .run(saveId, TEST_TITLE, `${deadlineDay}T18:00`, settings.tz, nowIso, nowIso).lastInsertRowid,
  );

  // 1. Propose + approve a real block.
  const p = await call("POST", `/api/actions/${actionId}/propose`);
  if (!p.json.found) throw new Error(`no slot to approve: ${JSON.stringify(p.json)}`);
  phase = "approve";
  const a = await call("POST", `/api/actions/${actionId}/approve`, { startUtc: p.json.slot.startUtc, endUtc: p.json.slot.endUtc, approved: true });
  const block1 = a.json.block;
  report("1. approve a real block (write + read-back)", a.status === 201 && block1?.readback.status === "ok", [
    block1 ? `block: ${block1.startDisplay} to ${block1.endDisplay}, event ${block1.googleEventId}, read-back ${block1.readback.status}` : JSON.stringify(a.json),
  ]);
  if (!block1) throw new Error("approve failed, stopping");

  // 2. Conflicting meeting.
  phase = "conflict";
  const startMs = Date.parse(block1.startUtc);
  const conflictBody = {
    id: `stagent${Date.now().toString(32)}${Math.floor(Math.random() * 1e6).toString(32)}`.replace(/[^0-9a-v]/g, "a"),
    summary: CONFLICT_TITLE,
    start: { dateTime: new Date(startMs + 3 * 60_000).toISOString(), timeZone: settings.tz },
    end: { dateTime: new Date(startMs + 23 * 60_000).toISOString(), timeZone: settings.tz },
    transparency: "opaque",
  };
  await calendar.insertEvent(conflictBody);
  report("2. add a conflicting meeting", true, [`${conflictBody.start.dateTime} to ${conflictBody.end.dateTime}, id ${conflictBody.id}`]);

  // 3. Agent replan, move mode. No writes allowed in this phase.
  phase = "agent";
  const writesBefore = writes.length;
  const ag = await call("POST", `/api/actions/${actionId}/agent-plan`, { instruction: INSTRUCTION });
  const agentWrites = writes.slice(writesBefore);
  const blocksAfterAgent = db.prepare("SELECT COUNT(*) AS n FROM blocks WHERE action_id = ?").get(actionId).n;
  const tr = ag.json.traceId ? (await call("GET", `/api/traces/${ag.json.traceId}`)).json.trace : null;
  const steps = tr?.steps ?? [];
  const toolNames = steps.filter((s) => s.type === "tool_call").map((s) => s.name);
  const everyStepTimed = steps.length > 0 && steps.every((s) => typeof s.ms === "number" && s.at);
  const gate = steps.find((s) => s.type === "validation");
  const proposal = ag.json.proposal;
  const conflictFree = proposal ? Date.parse(proposal.endUtc) <= Date.parse(conflictBody.start.dateTime) || Date.parse(proposal.startUtc) >= Date.parse(conflictBody.end.dateTime) : false;
  report("3. POST /agent-plan in move mode", ag.status === 200 && ag.json.mode === "move" && ag.json.outcome === "proposed", [
    `HTTP ${ag.status}, mode ${ag.json.mode}, outcome ${ag.json.outcome}, turns ${ag.json.turns}, trace #${ag.json.traceId}`,
    proposal ? `proposal: ${proposal.startDisplay} to ${proposal.endDisplay}` : `no proposal: ${JSON.stringify(ag.json.rejected ?? ag.json)}`,
    `rationale: ${ag.json.rationale}`,
    `approveWith: ${JSON.stringify(ag.json.approveWith)}`,
  ]);
  report("4. model called get_availability and find_slot", toolNames.includes("get_availability") && toolNames.includes("find_slot"), [`tool calls in order: ${toolNames.join(", ") || "(none)"}`]);
  report("5. slot passed the code gate and avoids the conflict", Boolean(gate?.ok) && conflictFree, [
    `checks: ${JSON.stringify(gate?.checks ?? [])}`,
    `rejected: ${JSON.stringify(gate?.rejected ?? [])}`,
    `outside the conflicting meeting: ${conflictFree}`,
  ]);
  report("6. trace saved with every step and duration", everyStepTimed && steps.at(-1)?.type === "end", [
    `${steps.length} steps stored, all with at + ms: ${everyStepTimed}`,
  ]);
  report("7. nothing written by /agent-plan", agentWrites.length === 0 && blocksAfterAgent === 1, [
    `calendar writes during agent phase: ${agentWrites.length}, block rows for this action: ${blocksAfterAgent}`,
  ]);

  console.log("\n--- trace ---");
  for (const s of steps) {
    const extra =
      s.type === "tool_call" ? `${s.name}(${JSON.stringify(s.args)}) ok=${s.ok} tool_ms=${s.durationMs}` :
      s.type === "model_response" ? `turn ${s.turn} model_ms=${s.durationMs} finish=${s.finishReason} tokens=${s.completionTokens} reasoning=${s.reasoningTokens} toolCalls=${(s.toolCalls ?? []).map((c) => c.name).join(",") || "none"}` :
      s.type === "validation" ? `ok=${s.ok}` :
      s.type === "end" ? `outcome=${s.outcome} turns=${s.turns} totalMs=${s.totalMs}` : "";
    console.log(`  #${s.n} +${s.ms}ms ${s.type} ${extra}`);
  }
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  const traceOut = path.join(root, "docs", "agent-replan-trace.json");
  fs.writeFileSync(traceOut, JSON.stringify({ capturedAt: new Date().toISOString(), note: "Live run on the owner's calendar. Test events deleted after the run. Prompt contains no event titles.", trace: tr }, null, 2));
  console.log(`trace written to docs/agent-replan-trace.json`);
  if (!ag.json.approveWith) throw new Error("no approved slot to move to, stopping");

  // 8. Separate, approved move to the agent's slot.
  phase = "move";
  const m = await call("POST", `/api/actions/${actionId}/move`, { startUtc: ag.json.approveWith.startUtc, endUtc: ag.json.approveWith.endUtc, approved: true });
  const block2 = m.json.block;
  const ev2 = block2 ? await calendar.getEvent(block2.googleEventId) : null;
  const cmp = block2 ? compareReadback({ block: block2, event: ev2 }) : null;
  const old = await calendar.getEvent(block1.googleEventId);
  report("8. approved /move + read-back", m.status === 201 && block2?.readback.status === "ok" && cmp?.status === "ok" && (old === null || old.status === "cancelled"), [
    `HTTP ${m.status}`,
    block2 && `new block: ${block2.startDisplay} to ${block2.endDisplay}, read-back ${block2.readback.status}, independent compare ${cmp?.status}`,
    `old event: ${old === null ? "gone" : old.status}`,
  ]);
  const r3 = await call("POST", `/api/actions/${actionId}/recheck`);
  report("9. recheck after the move (expect green)", r3.json.check?.state === "green", [`state: ${r3.json.check?.state}`]);
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
