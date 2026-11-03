import test from "node:test";
import assert from "node:assert/strict";
import { badgeFor, badgeLabel, normalizeExtraction, textMatches } from "../src/extraction/normalize.js";

const goals = [
  { id: 1, name: "Earn more" },
  { id: 2, name: "Learn a skill" },
  { id: 3, name: "Events and opportunities" },
];
const NOW = Date.parse("2026-11-02T12:00:00Z");
const note = "Saw this on Instagram. I want to join the next edition. Check if registration is still open .";
const transcription = "HACKATHON\nSPORT TECH\nPOUR RÉINVENTER LE FOOTBALL MAROCAIN\n36H\n6-7 JUIN 2026\nLASTARTUPSTATION TECHNOPARK\n80 INNOVATEURS\nInscriptions jusqu'au 20 novembre 2026 à 18h00";
const ctx = { note, goals, settingsTz: "Africa/Casablanca", nowMs: NOW };
const norm = (raw, over = {}) => normalizeExtraction(raw, { ...ctx, ...over });
const codes = (r) => r.warnings.map((w) => w.code);

const flyerRaw = {
  transcription,
  title: "Check registration for the next Hackathon Sport Tech",
  goal_id: 3,
  kind: "opportunity",
  label: null,
  deadline: { wall: "2026-06-06T09:00", date: null, tz: null, label: "Event date", quote: "6-7 JUIN 2026", year_assumed: false },
  deliverables: ["Check if registration for the next edition is open"],
  verbatim_items: [{ type: "keyword", text: "HACKATHON" }],
  evidence_quote: "I want to join the next edition",
  suggested_effort_min: 15,
};

test("flyer: the only date is a past edition, so no deadline is invented", () => {
  const r = norm(flyerRaw);
  assert.equal(r.fields.deadline, null);
  const w = r.warnings.find((x) => x.code === "deadline_in_past");
  assert.ok(w, "past date is kept as a warning");
  assert.equal(w.proposed.wall, "2026-06-06T09:00");
  assert.equal(r.fields.goalId, 3);
  assert.equal(r.fields.kind, "opportunity");
  assert.equal(r.fields.suggestedEffortMin, 15);
  assert.equal(r.fields.evidenceMatches.note, true);
  assert.equal(r.fields.verbatimItems[0].badge, "matched_transcription");
});

test("textMatches: ignores case, spacing, quote and dash styles, and refuses tiny needles", () => {
  assert.equal(textMatches("I want to JOIN\n the next   edition", "join the next edition"), true);
  assert.equal(textMatches("it’s open – apply now", "it's open - apply"), true);
  assert.equal(textMatches("abc", "ab"), false);
  assert.equal(textMatches("anything", ""), false);
  assert.equal(textMatches("", "something"), false);
});

test("badges: note outranks transcription, edited outranks both, none is null (never a general Verified)", () => {
  assert.equal(badgeFor({ note: true, transcription: true }), "matched_note");
  assert.equal(badgeFor({ note: false, transcription: true }), "matched_transcription");
  assert.equal(badgeFor({ note: false, transcription: false }), null);
  assert.equal(badgeFor({ note: true, transcription: true }, { edited: true }), "edited");
  assert.equal(badgeLabel("matched_note"), "Matched text in note");
  assert.equal(badgeLabel("matched_transcription"), "Matched model transcription");
  assert.equal(badgeLabel("edited"), "Edited by you");
  assert.match(badgeLabel(null), /^No match/);
  for (const b of ["matched_note", "matched_transcription", "edited", null]) assert.doesNotMatch(badgeLabel(b), /verified/i);
});

test("evidence quote found only in the transcription, and not found at all", () => {
  const onlyTranscription = norm({ ...flyerRaw, evidence_quote: "80 INNOVATEURS" });
  assert.deepEqual(onlyTranscription.fields.evidenceMatches, { note: false, transcription: true });
  assert.ok(!codes(onlyTranscription).includes("evidence_unmatched"));

  const none = norm({ ...flyerRaw, evidence_quote: "limited seats, hurry" });
  assert.deepEqual(none.fields.evidenceMatches, { note: false, transcription: false });
  assert.ok(codes(none).includes("evidence_unmatched"));

  const missing = norm({ ...flyerRaw, evidence_quote: null });
  assert.equal(missing.fields.evidenceQuote, null);
  assert.ok(!codes(missing).includes("evidence_unmatched"));
});

const futureDeadline = (over = {}) => ({
  ...flyerRaw,
  deadline: { wall: "2026-11-20T18:00", date: null, tz: "Africa/Casablanca", label: "Registration closes", quote: "jusqu'au 20 novembre 2026 à 18h00", year_assumed: false, ...over },
});

test("deadline: wall time + IANA tz from the model, UTC computed by code with moment-timezone", () => {
  const r = norm(futureDeadline());
  assert.deepEqual(r.fields.deadline, {
    wall: "2026-11-20T18:00",
    tz: "Africa/Casablanca",
    tzSource: "model",
    utc: "2026-11-20T18:00:00.000Z",
    label: "Registration closes",
    quote: "jusqu'au 20 novembre 2026 à 18h00",
    yearAssumed: false,
  });
  assert.ok(!r.warnings.some((w) => w.field === "deadline"));
});

test("deadline: a UTC offset from the model is ignored, the wall time and tz decide (the +01:00 mistake cannot leak in)", () => {
  const r = norm(futureDeadline({ wall: "2026-11-20T18:00:00+01:00" }));
  assert.equal(r.fields.deadline.wall, "2026-11-20T18:00");
  assert.equal(r.fields.deadline.utc, "2026-11-20T18:00:00.000Z");
  assert.ok(codes(r).includes("deadline_offset_ignored"));
});

test("deadline: timezone not stated falls back to the settings timezone, and says so", () => {
  const r = norm(futureDeadline({ tz: null }));
  assert.equal(r.fields.deadline.tz, "Africa/Casablanca");
  assert.equal(r.fields.deadline.tzSource, "settings_fallback");
  assert.equal(r.fields.deadline.utc, "2026-11-20T18:00:00.000Z");
  const w = r.warnings.find((x) => x.code === "deadline_timezone_fallback");
  assert.match(w.message, /does not state a timezone.*Africa\/Casablanca/);
});

test("deadline: no timezone anywhere keeps the wall time, leaves tz and UTC null, and warns", () => {
  const r = norm(futureDeadline({ tz: null }), { settingsTz: null });
  assert.equal(r.fields.deadline.wall, "2026-11-20T18:00");
  assert.equal(r.fields.deadline.tz, null);
  assert.equal(r.fields.deadline.tzSource, null);
  assert.equal(r.fields.deadline.utc, null);
  assert.ok(codes(r).includes("deadline_timezone_missing"));
});

test("deadline: an invalid timezone string from the model is ignored, then the fallback applies", () => {
  const r = norm(futureDeadline({ tz: "Mars/Olympus" }));
  assert.equal(r.fields.deadline.tz, "Africa/Casablanca");
  assert.equal(r.fields.deadline.tzSource, "settings_fallback");
  assert.ok(codes(r).includes("deadline_timezone_invalid"));
});

test("deadline: no supporting text in the note or transcription means no deadline", () => {
  const r = norm(futureDeadline({ quote: "closes at midnight" }));
  assert.equal(r.fields.deadline, null);
  const w = r.warnings.find((x) => x.code === "deadline_unsupported");
  assert.equal(w.proposed.wall, "2026-11-20T18:00");
  assert.equal(norm(futureDeadline({ quote: null })).fields.deadline, null);
});

test("deadline: a date without a time is not turned into a time", () => {
  const r = norm(futureDeadline({ wall: null, date: "2026-11-20", quote: "20 novembre 2026" }));
  assert.equal(r.fields.deadline, null);
  const w = r.warnings.find((x) => x.code === "deadline_time_missing");
  assert.match(w.message, /2026-11-20.*no time/);
});

test("deadline: garbage and impossible wall times are dropped", () => {
  assert.equal(norm(futureDeadline({ wall: "next friday" })).fields.deadline, null);
  assert.equal(norm(futureDeadline({ wall: "2026-02-31T10:00" })).fields.deadline, null);
  assert.ok(codes(norm(futureDeadline({ wall: "next friday" }))).includes("deadline_invalid"));
});

test("deadline: an assumed year is flagged", () => {
  const r = norm(futureDeadline({ year_assumed: true }));
  assert.equal(r.fields.deadline.yearAssumed, true);
  assert.match(r.warnings.find((w) => w.code === "deadline_year_assumed").message, /Assumed 2026/);
});

test("goal: numeric strings are accepted, unknown or missing goals stay null with a warning", () => {
  assert.equal(norm({ ...flyerRaw, goal_id: "2" }).fields.goalId, 2);
  for (const goal_id of [99, null, undefined, 1.5, "two"]) {
    const r = norm({ ...flyerRaw, goal_id });
    assert.equal(r.fields.goalId, null);
    assert.ok(codes(r).includes("goal_not_chosen"));
  }
});

test("kind and label: invalid kind becomes other with a warning, label is a hint only", () => {
  const r = norm({ ...flyerRaw, kind: "claim", label: "claim" });
  assert.equal(r.fields.kind, "other");
  assert.ok(codes(r).includes("kind_defaulted"));
  assert.equal(r.fields.label, "claim");
  assert.equal(norm({ ...flyerRaw, label: "urgent" }).fields.label, null);
});

test("effort: whole minutes between 1 and 1440, otherwise null", () => {
  assert.equal(norm({ ...flyerRaw, suggested_effort_min: 7.6 }).fields.suggestedEffortMin, 8);
  for (const v of [0, -5, 5000, "15", null, NaN, undefined]) {
    assert.equal(norm({ ...flyerRaw, suggested_effort_min: v }).fields.suggestedEffortMin, null, String(v));
  }
});

test("verbatim items and deliverables: cleaned, deduped, unmatched items flagged", () => {
  const r = norm({
    ...flyerRaw,
    deliverables: ["Check registration", " check   registration ", "", 42, "Register a team"],
    verbatim_items: [
      { type: "link", text: "https://made-up.example/register" },
      { type: "weird", text: "TECHNOPARK" },
      { type: "keyword", text: "" },
      "not an object",
    ],
  });
  assert.deepEqual(r.fields.deliverables, ["Check registration", "Register a team"]);
  assert.equal(r.fields.verbatimItems.length, 2);
  assert.equal(r.fields.verbatimItems[0].badge, null);
  assert.equal(r.fields.verbatimItems[1].type, "keyword");
  assert.equal(r.fields.verbatimItems[1].badge, "matched_transcription");
  assert.match(r.warnings.find((w) => w.code === "verbatim_unmatched").message, /^1 item was not found/);
});

const withEvent = (event_dates) => norm({ ...flyerRaw, event_dates });
const flyerDates = { text: "6-7 JUIN 2026", start: "2026-06-06", end: "2026-06-07" };

test("event dates: kept verbatim with a badge, and flagged when the event already happened", () => {
  const r = withEvent([flyerDates]);
  assert.deepEqual(r.fields.eventDates.map(({ text, start, end, badge }) => ({ text, start, end, badge })), [
    { text: "6-7 JUIN 2026", start: "2026-06-06", end: "2026-06-07", badge: "matched_transcription" },
  ]);
  const w = r.warnings.find((x) => x.code === "event_already_happened");
  assert.equal(w.field, "event_dates");
  assert.match(w.message, /6-7 JUIN 2026.*already in the past.*past edition/);
  assert.equal(w.proposed.today, "2026-11-02");
});

test("event dates: no warning for upcoming events, for today, or when any date is still ahead", () => {
  const codesFor = (dates) => codes(withEvent(dates));
  assert.ok(!codesFor([{ ...flyerDates, start: "2027-06-06", end: "2027-06-07" }]).includes("event_already_happened"));
  assert.ok(!codesFor([{ ...flyerDates, start: "2026-11-02", end: "2026-11-02" }]).includes("event_already_happened"));
  assert.ok(!codesFor([flyerDates, { text: "Inscriptions jusqu'au 20 novembre 2026", start: "2026-11-20", end: "2026-11-20" }]).includes("event_already_happened"));
});

test("event dates: the model's reading is not trusted without matching text, or without a year", () => {
  const unsupported = withEvent([{ text: "12 March 2026", start: "2026-03-12", end: "2026-03-12" }]);
  assert.equal(unsupported.fields.eventDates[0].badge, null);
  assert.ok(!codes(unsupported).includes("event_already_happened"));

  const noYear = withEvent([{ text: "6-7 JUIN", start: null, end: null }]);
  assert.equal(noYear.fields.eventDates[0].text, "6-7 JUIN");
  assert.equal(noYear.fields.eventDates[0].start, null);
  assert.ok(!codes(noYear).includes("event_already_happened"));
});

test("event dates: impossible dates and reversed ranges are nulled, a single day fills the end", () => {
  assert.equal(withEvent([{ ...flyerDates, start: "2026-02-31", end: "2026-02-31" }]).fields.eventDates[0].start, null);
  const reversed = withEvent([{ ...flyerDates, start: "2026-06-07", end: "2026-06-06" }]).fields.eventDates[0];
  assert.deepEqual([reversed.start, reversed.end], [null, null]);
  const single = withEvent([{ text: "6-7 JUIN 2026", start: "2026-06-06" }]).fields.eventDates[0];
  assert.deepEqual([single.start, single.end], ["2026-06-06", "2026-06-06"]);
  assert.deepEqual(withEvent("not a list").fields.eventDates, []);
  assert.deepEqual(withEvent([{ text: "" }, 5, null]).fields.eventDates, []);
});

test("garbage model output never throws and yields safe, empty fields", () => {
  for (const raw of [null, undefined, [], "text", 7, {}]) {
    const r = norm(raw);
    assert.equal(r.fields.deadline, null);
    assert.equal(r.fields.title, null);
    assert.equal(r.fields.goalId, null);
    assert.equal(r.fields.kind, "other");
    assert.deepEqual(r.fields.deliverables, []);
    assert.deepEqual(r.fields.verbatimItems, []);
    assert.equal(r.fields.suggestedEffortMin, null);
  }
});
