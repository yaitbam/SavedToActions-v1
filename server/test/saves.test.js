import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { createApp } from "../src/app.js";
import { SERVER_ROOT } from "../src/config.js";
import { openDb, saveSettings } from "../src/db.js";
import { ModelError } from "../src/model/provider.js";
import { detectImageType } from "../src/routes/saves.js";
import { runSelfTest } from "../src/tz.js";

const NOW = Date.parse("2026-11-02T12:00:00Z");
// Real decodable images. PNG is wider than 1280 px so the downscale is exercised, SMALL_PNG is not.
const PNG = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: "#ffffff" } }).png().toBuffer();
const SMALL_PNG = await sharp({ create: { width: 400, height: 300, channels: 3, background: "#336699" } }).png().toBuffer();
const dims = async (dataUrl) => {
  const m = await sharp(Buffer.from(dataUrl.split(",")[1], "base64")).metadata();
  return { format: m.format, width: m.width, height: m.height };
};
const NOTE = "Saw this on Instagram. I want to join the next edition. Check if registration is still open .";
const TRANSCRIPTION = "HACKATHON\nSPORT TECH\n6-7 JUIN 2026\nLASTARTUPSTATION TECHNOPARK\nInscriptions jusqu'au 20 novembre 2026 à 18h00";

const flyerOutput = {
  transcription: TRANSCRIPTION,
  title: "Check registration for the next Hackathon Sport Tech",
  goal_id: 3,
  kind: "opportunity",
  label: null,
  deadline: { wall: "2026-06-06T09:00", date: null, tz: null, label: "Event date", quote: "6-7 JUIN 2026", year_assumed: false },
  event_dates: [{ text: "6-7 JUIN 2026", start: "2026-06-06", end: "2026-06-07" }],
  deliverables: ["Check if registration for the next edition is open"],
  verbatim_items: [{ type: "keyword", text: "HACKATHON" }],
  evidence_quote: "I want to join the next edition",
  suggested_effort_min: 15,
};

function setup({ maxUploadBytes = 1024 * 1024, tz = "Africa/Casablanca" } = {}) {
  fs.mkdirSync(path.join(SERVER_ROOT, "data"), { recursive: true });
  const dir = fs.mkdtempSync(path.join(SERVER_ROOT, "data", "test-"));
  const db = openDb(":memory:");
  // A workspace starts with a default timezone, so "no timezone" has to be set on purpose.
  saveSettings(db, { workStart: "09:00", workEnd: "21:00", tz: tz || null });
  const state = { output: flyerOutput, error: null, calls: [] };
  const provider = {
    name: "fake",
    model: "fake-model",
    configured: () => true,
    chat: async (req) => {
      state.calls.push(req);
      if (state.error) throw state.error;
      return { content: JSON.stringify(state.output), finishReason: "stop", usage: { total_tokens: 700 }, model: "fake-model", ms: 12 };
    },
  };
  const config = { frontendOrigin: "http://localhost:5173", screenshotDir: path.join(dir, "shots"), maxUploadBytes };
  const app = createApp({ db, config, googleAuth: { status: () => ({}) }, selfTest: runSelfTest(), provider, clock: () => NOW });
  return { app, db, dir, state, config };
}

async function withServer(opts, fn) {
  const ctx = setup(opts);
  const server = await new Promise((resolve) => {
    const s = ctx.app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn({ ...ctx, base });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(ctx.dir, { recursive: true, force: true });
  }
}

function upload(base, { image = PNG, note = NOTE, type = "image/png", name = "flyer.png" } = {}) {
  const form = new FormData();
  if (image) form.append("image", new Blob([image], { type }), name);
  if (note !== null) form.append("note", note);
  return fetch(`${base}/api/saves`, { method: "POST", body: form });
}
const patch = (base, id, body) =>
  fetch(`${base}/api/actions/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("detectImageType trusts the bytes", () => {
  assert.equal(detectImageType(PNG), "image/png");
  assert.equal(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])), "image/jpeg");
  assert.equal(detectImageType(Buffer.from("RIFF0000WEBPVP8 ")), "image/webp");
  assert.equal(detectImageType(Buffer.from("MZ not an image")), null);
  assert.equal(detectImageType(Buffer.alloc(0)), null);
});

test('extraction trace retains real telemetry and records only actual timezone corrections', async()=>{
  await withServer({},async({base,state,db})=>{
    for(const [offset,corrected]of [['+01:00',true],['+00:00',false],['',false]]){
      state.output={...flyerOutput,deadline:{wall:'2026-11-20T18:00'+offset,tz:'Africa/Casablanca',quote:"Inscriptions jusqu'au 20 novembre 2026 à 18h00"}};
      const response=await upload(base,{image:SMALL_PNG});
      assert.equal(response.status,201);
      const {action,extraction}=await response.json();
      const row=db.prepare('SELECT * FROM agent_traces WHERE action_id=?').get(action.id);
      assert.equal(row.outcome,'extracted');
      const steps=JSON.parse(row.steps_json);
      assert.equal(steps[0].type,'extraction');
      assert.equal(steps[0].ms,extraction.ms);
      assert.deepEqual(steps[0].usage,extraction.usage);
      assert.deepEqual(steps[0].image,extraction.image);
      assert.equal(steps.some(s=>s.type==='timezone_correction'),corrected);
      assert.equal(action.hasTimezoneCorrection,corrected);
      assert.equal(action.extractionLatencyMs,extraction.ms);
      const read=await(await fetch(`${base}/api/actions/${action.id}`)).json();
      assert.equal(read.hasTimezoneCorrection,corrected);
      assert.equal(read.extractionLatencyMs,extraction.ms);
      assert.equal(read.model,'fake-model');
      const full=(await(await fetch(`${base}/api/traces/${(await(await fetch(`${base}/api/actions/${action.id}/traces`)).json()).traces[0].id}`)).json()).trace;
      assert.equal(full.steps[0].label,'Muse Spark Open read the screenshot');
      if(corrected)assert.equal(full.steps[1].label,'Model wrote +01:00. Code corrected it to +00:00');
      if(corrected){assert.equal(steps[1].modelOffset,'+01:00');assert.equal(steps[1].computedOffset,'+00:00');assert.ok(Number.isInteger(steps[1].ms))}
      const list=await(await fetch(`${base}/api/actions/${action.id}/traces`)).json();
      assert.equal(list.traces[0].outcome,'extracted');
    }
  });
});

test("upload + note: editable extraction, precise badges, model estimate, no invented deadline", async () => {
  await withServer({}, async ({ base, state, db }) => {
    const res = await upload(base);
    assert.equal(res.status, 201);
    const { saveId, action, extraction } = await res.json();
    assert.equal(saveId, 1);

    // What the model was sent.
    const sent = state.calls[0];
    assert.match(sent.messages[1].content[0].text, /I want to join the next edition/);
    assert.match(sent.messages[1].content[0].text, /Today's date: 2026-11-02/);
    // Downscaled to 1280 px on the longest edge before sending. The stored original is untouched (see screenshot test).
    const sentUrl = sent.messages[1].content[1].image_url.url;
    assert.match(sentUrl, /^data:image\/jpeg;base64,/);
    assert.deepEqual(await dims(sentUrl), { format: "jpeg", width: 1280, height: 640 });
    assert.deepEqual(
      { ...extraction.image, sentBytes: undefined },
      { originalWidth: 2000, originalHeight: 1000, sentWidth: 1280, sentHeight: 640, sentBytes: undefined, resized: true },
    );
    assert.ok(extraction.image.sentBytes > 0);

    assert.equal(action.status, "open");
    assert.equal(action.goalId, 3);
    assert.equal(action.kind, "opportunity");
    assert.equal(action.note, NOTE);
    assert.equal(action.model, "fake-model");
    assert.equal(action.deadline, null, "the only date is a past edition");
    assert.ok(action.warnings.some((w) => w.code === "deadline_in_past"));

    // The flyer's event dates are kept verbatim, and flagged as already happened (today is 2026-11-02).
    assert.equal(action.eventDates.length, 1);
    assert.equal(action.eventDates[0].text, "6-7 JUIN 2026");
    assert.deepEqual([action.eventDates[0].start, action.eventDates[0].end], ["2026-06-06", "2026-06-07"]);
    assert.equal(action.eventDates[0].badgeLabel, "Matched model transcription");
    const past = action.warnings.find((w) => w.code === "event_already_happened");
    assert.match(past.message, /6-7 JUIN 2026.*already in the past.*past edition/);
    assert.equal(past.field, "event_dates");
    assert.equal(action.evidence.badge, "matched_note");
    assert.equal(action.evidence.badgeLabel, "Matched text in note");
    assert.equal(action.verbatimItems[0].badgeLabel, "Matched model transcription");
    assert.deepEqual(action.effort, { suggestedMin: 15, confirmedMin: null, confirmed: false, label: "Model estimate", scheduledMin: null });
    assert.deepEqual(action.edited, []);
    assert.equal(action.screenshotUrl, "/api/saves/1/screenshot");

    // Persisted, including the raw model output for audit.
    const row = db.prepare("SELECT model_output_json, transcription FROM actions WHERE id = ?").get(action.id);
    assert.equal(JSON.parse(row.model_output_json).deadline.quote, "6-7 JUIN 2026");
    assert.equal(row.transcription, TRANSCRIPTION);
    assert.deepEqual(await (await fetch(`${base}/api/actions/${action.id}`)).json(), action);
  });
});

test("a stated deadline without a timezone uses the settings timezone and is labeled", async () => {
  await withServer({}, async ({ base, state }) => {
    state.output = {
      ...flyerOutput,
      deadline: { wall: "2026-11-20T18:00", tz: null, label: "Registration closes", quote: "jusqu'au 20 novembre 2026 à 18h00", year_assumed: false },
    };
    const { action } = await (await upload(base)).json();
    assert.equal(action.deadline.tz, "Africa/Casablanca");
    assert.equal(action.deadline.tzSource, "settings_fallback");
    assert.match(action.deadline.tzSourceLabel, /^Not stated in the post\. Using your settings timezone/);
    assert.equal(action.deadline.utc, "2026-11-20T18:00:00.000Z");
    assert.equal(action.deadline.display, "Fri 20 Nov 2026, 18:00 (+00:00)");
    assert.ok(action.warnings.some((w) => w.code === "deadline_timezone_fallback"));
  });
});

test("no timezone in settings: deadline keeps its wall time and shows as unresolved", async () => {
  await withServer({ tz: null }, async ({ base, state }) => {
    state.output = { ...flyerOutput, deadline: { wall: "2026-11-20T18:00", tz: null, quote: "jusqu'au 20 novembre 2026 à 18h00" } };
    const { action } = await (await upload(base)).json();
    assert.equal(action.deadline.wall, "2026-11-20T18:00");
    assert.equal(action.deadline.tz, null);
    assert.equal(action.deadline.utc, null);
    assert.equal(action.deadline.display, null);
    assert.ok(action.warnings.some((w) => w.code === "deadline_timezone_missing"));
  });
});

test("screenshot is served back as the same bytes", async () => {
  await withServer({}, async ({ base }) => {
    const { action } = await (await upload(base)).json();
    const res = await fetch(`${base}${action.screenshotUrl}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), PNG);
    assert.equal((await fetch(`${base}/api/saves/99/screenshot`)).status, 404);
  });
});

test("model failure keeps the save, retry works once, then 409", async () => {
  await withServer({}, async ({ base, state, db }) => {
    state.error = new ModelError("model_http_error", "Model API returned HTTP 503");
    const failed = await upload(base);
    assert.equal(failed.status, 502);
    const body = await failed.json();
    assert.equal(body.error, "model_http_error");
    assert.equal(body.saveId, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM saves").get().n, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM actions").get().n, 0);

    state.error = null;
    const retry = await fetch(`${base}/api/saves/1/extract`, { method: "POST" });
    assert.equal(retry.status, 201);
    assert.equal((await retry.json()).action.kind, "opportunity");
    assert.equal((await fetch(`${base}/api/saves/1/extract`, { method: "POST" })).status, 409);
    assert.equal((await fetch(`${base}/api/saves/99/extract`, { method: "POST" })).status, 404);
  });
});

test("a small image is sent as is, and event dates in the future are not flagged", async () => {
  await withServer({}, async ({ base, state }) => {
    state.output = { ...flyerOutput, event_dates: [{ text: "6-7 JUIN 2026", start: "2027-06-06", end: "2027-06-07" }] };
    const { action, extraction } = await (await upload(base, { image: SMALL_PNG })).json();
    assert.equal(extraction.image.resized, false);
    assert.equal(state.calls[0].messages[1].content[1].image_url.url, `data:image/png;base64,${SMALL_PNG.toString("base64")}`);
    assert.ok(!action.warnings.some((w) => w.code === "event_already_happened"));
  });
});

test("upload validation: missing image, wrong type, broken image, too large, note too long", async () => {
  await withServer({ maxUploadBytes: 50_000 }, async ({ base, state, db }) => {
    assert.equal((await upload(base, { image: null })).status, 400);
    const notImage = await upload(base, { image: Buffer.from("just text"), type: "image/png", name: "x.png" });
    assert.equal(notImage.status, 415);
    assert.equal((await notImage.json()).error, "unsupported_image");
    // Valid PNG signature, garbage after it.
    const broken = await upload(base, { image: Buffer.concat([PNG.subarray(0, 8), Buffer.alloc(200, 1)]) });
    assert.equal(broken.status, 415);
    const big = await upload(base, { image: Buffer.concat([PNG, Buffer.alloc(100_000)]) });
    assert.equal(big.status, 413);
    assert.equal((await upload(base, { note: "x".repeat(5001) })).status, 400);
    assert.equal(state.calls.length, 0, "the model is never called for rejected uploads");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM saves").get().n, 0);
  });
});

test("a note is optional", async () => {
  await withServer({}, async ({ base, state }) => {
    const res = await upload(base, { note: null });
    assert.equal(res.status, 201);
    assert.match(state.calls[0].messages[1].content[0].text, /\(no note\)/);
  });
});

test("edits: every field editable, Edited by you, confirmed effort becomes Your estimate", async () => {
  await withServer({}, async ({ base, state }) => {
    state.output = { ...flyerOutput, goal_id: null, deadline: null };
    const { action } = await (await upload(base)).json();
    assert.ok(action.warnings.some((w) => w.code === "event_already_happened"));
    assert.equal(action.goalId, null);
    assert.ok(action.warnings.some((w) => w.code === "goal_not_chosen"));

    const res = await patch(base, action.id, {
      goalId: 1,
      kind: "try",
      title: "Register my team",
      deliverables: ["Open the registration page", "Register"],
      verbatimItems: [{ type: "keyword", text: "TECHNOPARK" }, { type: "link", text: "https://made-up.example" }],
      evidenceQuote: "join the next edition",
      eventDates: [{ text: "20 novembre 2026", start: "2026-11-20" }],
      confirmedEffortMin: 30,
    });
    assert.equal(res.status, 200);
    const v = await res.json();
    assert.equal(v.goalId, 1);
    assert.equal(v.kind, "try");
    assert.equal(v.title, "Register my team");
    assert.deepEqual(v.edited.sort(), ["deliverables", "event_dates", "evidence_quote", "goal", "kind", "title", "verbatim_items"]);
    assert.deepEqual(v.eventDates.map(({ text, start, end }) => ({ text, start, end })), [{ text: "20 novembre 2026", start: "2026-11-20", end: "2026-11-20" }]);
    assert.ok(!v.warnings.some((w) => w.code === "event_already_happened"), "editing the event dates clears that warning");
    assert.equal(v.evidence.badge, "edited");
    assert.equal(v.evidence.badgeLabel, "Edited by you");
    assert.deepEqual(v.evidence.matches, { note: true, transcription: false });
    assert.equal(v.verbatimItems[0].badge, "edited");
    assert.equal(v.verbatimItems[1].badge, "edited");
    assert.equal(v.verbatimItems[1].badgeLabel, "Edited by you");
    assert.deepEqual(v.verbatimItems[0].matches, {note:false,transcription:true});
    assert.deepEqual(v.verbatimItems[1].matches, {note:false,transcription:false});
    assert.deepEqual(v.effort, { suggestedMin: 15, confirmedMin: 30, confirmed: true, label: "Your estimate", scheduledMin: 30 });
    assert.ok(!v.warnings.some((w) => w.field === "goal"), "a warning about an edited field is dropped");

    // Un-confirming goes back to the model estimate. The model's own number is never overwritten.
    const back = await (await patch(base, action.id, { confirmedEffortMin: null })).json();
    assert.deepEqual(back.effort, { suggestedMin: 15, confirmedMin: null, confirmed: false, label: "Model estimate", scheduledMin: null });
  });
});

test("edits: deadline with settings fallback, with an explicit timezone, and cleared", async () => {
  await withServer({}, async ({ base, state }) => {
    state.output = { ...flyerOutput, deadline: null };
    const { action } = await (await upload(base)).json();

    const fallback = await (await patch(base, action.id, { deadline: { wall: "2026-11-25T10:00" } })).json();
    assert.equal(fallback.deadline.tzSource, "settings_fallback");
    assert.equal(fallback.deadline.utc, "2026-11-25T10:00:00.000Z");
    assert.ok(fallback.edited.includes("deadline"));

    const explicit = await (await patch(base, action.id, { deadline: { wall: "2026-11-25T10:00", tz: "America/New_York" } })).json();
    assert.equal(explicit.deadline.tzSource, "user");
    assert.equal(explicit.deadline.tzSourceLabel, "Set by you");
    assert.equal(explicit.deadline.utc, "2026-11-25T15:00:00.000Z");
    assert.equal(explicit.deadline.display, "Wed 25 Nov 2026, 10:00 (-05:00)");

    const cleared = await (await patch(base, action.id, { deadline: null })).json();
    assert.equal(cleared.deadline, null);
  });
});

test("edit validation: bad values are 400 with the field, unknown action is 404, closed action is 409", async () => {
  await withServer({}, async ({ base, db }) => {
    const { action } = await (await upload(base)).json();
    const bad = async (body) => {
      const res = await patch(base, action.id, body);
      assert.equal(res.status, 400, JSON.stringify(body));
      return res.json();
    };
    assert.equal((await bad({ kind: "claim" })).field, "kind");
    assert.equal((await bad({ goalId: 99 })).field, "goal");
    assert.equal((await bad({ label: "urgent" })).field, "label");
    assert.equal((await bad({ title: 5 })).field, "title");
    assert.equal((await bad({ deliverables: "one" })).field, "deliverables");
    assert.equal((await bad({ verbatimItems: [{ type: "image", text: "x" }] })).field, "verbatim_items");
    assert.equal((await bad({ eventDates: [{ text: "x", start: "2026-02-31" }] })).field, "event_dates");
    assert.equal((await bad({ eventDates: "soon" })).field, "event_dates");
    assert.equal((await bad({ deadline: { wall: "next friday" } })).field, "deadline");
    assert.equal((await bad({ deadline: { wall: "2026-11-25T10:00", tz: "Mars/Olympus" } })).error, "invalid_timezone");
    assert.equal((await bad({ confirmedEffortMin: 0 })).field, "effort");
    assert.equal((await bad({ confirmedEffortMin: 12.5 })).field, "effort");
    assert.equal((await bad({ confirmedEffortMin: 5000 })).field, "effort");

    assert.equal((await patch(base, 999, { title: "x" })).status, 404);
    db.prepare("UPDATE actions SET status = 'done' WHERE id = ?").run(action.id);
    assert.equal((await patch(base, action.id, { title: "x" })).status, 409);
  });
});

test("a post with a date and no time gets an end of day deadline that is labeled as assumed until the user sets a time", async () => {
  await withServer({}, async ({ base, state }) => {
    state.output = { ...flyerOutput, deadline: { wall: null, date: "2026-11-22", tz: null, label: "Deadline", quote: "jusqu'au 20 novembre 2026 à 18h00", year_assumed: false } };
    const { action } = await (await upload(base)).json();
    assert.equal(action.deadline.wall, "2026-11-22T23:59");
    assert.equal(action.deadline.timeAssumed, true);
    assert.match(action.deadline.short, /^22 Nov( 2026)?$/);
    assert.equal(action.deadline.tz, "Africa/Casablanca");
    assert.ok(action.warnings.some((w) => w.code === "deadline_time_assumed"));
    const edited = await fetch(`${base}/api/actions/${action.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deadline: { wall: "2026-11-22T12:00" } }),
    });
    const after = (await edited.json()).deadline ?? (await (await fetch(`${base}/api/actions/${action.id}`)).json()).deadline;
    assert.equal(after.wall, "2026-11-22T12:00");
    assert.equal(after.timeAssumed, false);
  });
});
