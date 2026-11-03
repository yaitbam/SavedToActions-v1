// Compares reasoning_effort "low" against the default on 5 screenshots, through the app's real pipeline
// (downscale, prompt, model call, normalize). Four screenshots are SYNTHETIC posts rendered here with known
// ground truth, the fifth is the real flyer.png. Synthetic posts are cleaner than real screenshots, so treat
// this as a regression check, not proof of quality on real posts.
//
// Run: node scripts/effort-quality.mjs                (about 20 model calls, one after another)
//      node scripts/effort-quality.mjs --generate-only (just write the PNGs to server/data/effort-test/)
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  process.loadEnvFile(path.join(root, ".env"));
} catch {
  // env may already be set
}
const sharp = createRequire(path.join(root, "server", "package.json"))("sharp");
const { prepareForModel } = await import("../server/src/extraction/image.js");
const { extractFromScreenshot } = await import("../server/src/extraction/extract.js");
const { normalizeExtraction, textMatches } = await import("../server/src/extraction/normalize.js");
const { createProvider } = await import("../server/src/model/provider.js");

const OUT = path.join(root, "server", "data", "effort-test");
fs.mkdirSync(OUT, { recursive: true });
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function card(file, handle, lines) {
  const body = lines.map((l, i) => `<text x="60" y="${230 + i * 58}" font-size="40" font-family="Helvetica, Arial, sans-serif" fill="#111">${esc(l)}</text>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"><rect width="100%" height="100%" fill="#fff"/><circle cx="95" cy="95" r="40" fill="#c9d6ea"/><text x="155" y="108" font-size="34" font-weight="bold" font-family="Helvetica, Arial, sans-serif" fill="#222">${esc(handle)}</text>${body}</svg>`;
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  fs.writeFileSync(path.join(OUT, file), buf);
  return buf;
}

const NOTE_FLYER = "Saw this on Instagram. I want to join the next edition. Check if registration is still open .";
const cases = [
  {
    name: "S1 grant, EN, deadline in GMT",
    note: "Want to apply for this. Need to draft the proposal first.",
    image: () => card("s1.png", "@atlas.builders", ["Atlas Builders Grant", "", "Applications close Friday,", "November 20, 2026 at 23:59 GMT.", "", "Submit a 2 page proposal and a", "1 minute video.", "", "Apply: atlasgrant.example/apply"]),
    truth: { deadlineUtc: "2026-11-20T23:59:00.000Z", kind: ["opportunity"], expectItems: ["atlasgrant.example/apply"], reads: ["atlasgrant.example/apply", "23:59"] },
  },
  {
    name: "S2 prompt post, EN, no deadline",
    note: "Try this prompt on my old code",
    image: () => card("s2.png", "@devtips.daily", ["Prompt of the day:", "", "\"Refactor the following function for", "readability. Keep behavior identical", "and add unit tests.\"", "", "Works great with long files."]),
    truth: { deadlineUtc: null, kind: ["try"], expectItems: ["Refactor the following function for readability"], reads: ["Keep behavior identical"] },
  },
  {
    name: "S3 hackathon, FR, deadline + event dates",
    note: "Register my team before the deadline",
    image: () => card("s3.png", "@hackathon.ia.sante", ["HACKATHON IA SANTÉ", "", "Inscriptions avant le", "15 novembre 2026 à 18h00", "(heure de Casablanca).", "", "Événement : 28-29 novembre 2026", "Technopark, Casablanca"]),
    truth: { deadlineUtc: "2026-11-15T18:00:00.000Z", kind: ["opportunity"], eventDate: { text: "28-29 novembre 2026", start: "2026-11-28", end: "2026-11-29" }, reads: ["15 novembre 2026", "Technopark"] },
  },
  {
    name: "S4 past event, EN, trap",
    note: "Interested in the next one",
    image: () => card("s4.png", "@devfest.casa", ["DevFest Casablanca 2025", "", "12 October 2025", "Technopark, Casablanca", "", "Thank you all, see you next year!"]),
    truth: { deadlineUtc: null, kind: ["opportunity", "other"], eventDate: { text: "12 October 2025", start: "2025-10-12", end: "2025-10-12" }, eventPast: true, reads: ["DevFest Casablanca 2025"] },
  },
  {
    name: "S5 real flyer, FR, past edition",
    note: NOTE_FLYER,
    image: async () => fs.readFileSync(path.join(root, "flyer.png")),
    truth: { deadlineUtc: null, kind: ["opportunity"], eventDate: { text: "6-7 JUIN 2026", start: "2026-06-06", end: "2026-06-07" }, eventPast: true, reads: ["LASTARTUPSTATION"] },
  },
];

const goals = [
  { id: 1, name: "Make money" },
  { id: 2, name: "Level up as a dev" },
  { id: 3, name: "Join events and opportunities" },
];
const images = [];
for (const c of cases) images.push(await c.image());
console.log(`Wrote ${cases.length} screenshots to ${path.relative(root, OUT)}/`);
if (process.argv.includes("--generate-only")) process.exit(0);

const base = { apiKey: process.env.BASETEN_API_KEY, baseUrl: process.env.BASETEN_BASE_URL || "https://inference.baseten.co/v1", model: process.env.BASETEN_MODEL || "meta-models/muse-spark-open-1026" };
if (!base.apiKey) {
  console.error("BASETEN_API_KEY is not set");
  process.exit(1);
}
const configs = [
  { name: "default", provider: createProvider({ provider: "baseten", baseten: { ...base, reasoningEffort: null } }) },
  { name: "low", provider: createProvider({ provider: "baseten", baseten: { ...base, reasoningEffort: "low" } }) },
];
const REPEATS = 2;
const nowMs = Date.now();
const today = new Date(nowMs).toISOString().slice(0, 10);

function score(c, fields, warnings) {
  const t = c.truth;
  const checks = [];
  const check = (name, ok) => checks.push([name, Boolean(ok)]);
  check("deadline", t.deadlineUtc ? fields.deadline?.utc === t.deadlineUtc : fields.deadline === null);
  check("kind", t.kind.includes(fields.kind));
  const items = fields.verbatimItems.map((i) => i.text).join("\n");
  for (const want of t.expectItems ?? []) check(`item "${want.slice(0, 24)}"`, textMatches(items, want));
  if (t.eventDate) {
    const hit = fields.eventDates.find((e) => textMatches(e.text, t.eventDate.text) || textMatches(t.eventDate.text, e.text));
    check("event date text", hit);
    check("event date start/end", hit && hit.start === t.eventDate.start && hit.end === t.eventDate.end);
  }
  check("past-event warning", Boolean(t.eventPast) === warnings.some((w) => w.code === "event_already_happened"));
  for (const want of t.reads ?? []) check(`read "${want.slice(0, 22)}"`, textMatches(fields.transcription, want));
  check("evidence matches text", !fields.evidenceQuote || fields.evidenceMatches.note || fields.evidenceMatches.transcription);
  return checks;
}

const results = [];
for (const [ci, c] of cases.entries()) {
  const prepared = await prepareForModel(images[ci], "image/png");
  for (const cfg of configs) {
    for (let run = 1; run <= REPEATS; run++) {
      const t0 = Date.now();
      let row;
      try {
        const out = await extractFromScreenshot({ provider: cfg.provider, imageBuffer: prepared.buffer, mimeType: prepared.mimeType, note: c.note, goals, today });
        const { fields, warnings } = normalizeExtraction(out.raw, { note: c.note, goals, settingsTz: "Africa/Casablanca", nowMs });
        const checks = score(c, fields, warnings);
        row = { case: c.name, cfg: cfg.name, run, sec: (out.ms / 1000).toFixed(1), reasoning: out.usage?.completion_tokens_details?.reasoning_tokens ?? 0, pass: checks.filter(([, ok]) => ok).length, total: checks.length, failed: checks.filter(([, ok]) => !ok).map(([n]) => n) };
      } catch (err) {
        row = { case: c.name, cfg: cfg.name, run, sec: ((Date.now() - t0) / 1000).toFixed(1), reasoning: 0, pass: 0, total: 0, failed: [`ERROR ${err.code ?? err.message}`] };
      }
      results.push(row);
      console.log(`${row.case.slice(0, 34).padEnd(34)} ${row.cfg.padEnd(7)} #${row.run}  ${row.sec.padStart(5)}s  reasoning ${String(row.reasoning).padStart(5)}  ${row.pass}/${row.total}  ${row.failed.join(" | ")}`);
    }
  }
}

console.log("\n===== SUMMARY =====");
const summary = configs.map((cfg) => {
  const rs = results.filter((r) => r.cfg === cfg.name);
  const sum = (f) => rs.reduce((a, r) => a + f(r), 0);
  return {
    config: cfg.name,
    calls: rs.length,
    "mean seconds": (sum((r) => Number(r.sec)) / rs.length).toFixed(1),
    "mean reasoning tokens": Math.round(sum((r) => r.reasoning) / rs.length),
    "checks passed": `${sum((r) => r.pass)}/${sum((r) => r.total)}`,
    "calls with any failure": rs.filter((r) => r.failed.length).length,
  };
});
console.table(summary);
for (const cfg of configs) {
  const fails = results.filter((r) => r.cfg === cfg.name && r.failed.length);
  if (fails.length) console.log(`${cfg.name} failures:\n` + fails.map((r) => `  ${r.case} #${r.run}: ${r.failed.join(", ")}`).join("\n"));
}
