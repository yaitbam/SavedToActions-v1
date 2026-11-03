// Measures whether Baseten accepts a reasoning effort parameter for Muse Spark Open, and what it does
// to time and tokens on a real extraction call (flyer + note, downscaled to 1280px like the app does).
//
// Run: node scripts/reasoning-effort.mjs [path/to/screenshot.png]
// Cost: about 9 model calls, run one after another so the timings are comparable.
//
// How to read it: many OpenAI compatible servers silently ignore unknown parameters, so "HTTP 200" alone
// does not mean a parameter works. The bogus parameter is the control. A parameter only counts as working
// if reasoning tokens and time move clearly relative to the baselines.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  process.loadEnvFile(path.join(root, ".env"));
} catch {
  // env may already be set
}
const { prepareForModel } = await import("../server/src/extraction/image.js");
const { buildMessages, parseModelJson } = await import("../server/src/extraction/extract.js");

const KEY = process.env.BASETEN_API_KEY;
const BASE = process.env.BASETEN_BASE_URL || "https://inference.baseten.co/v1";
const MODEL = process.env.BASETEN_MODEL || "meta-models/muse-spark-open-1026";
if (!KEY) {
  console.error("BASETEN_API_KEY is not set");
  process.exit(1);
}

const imagePath = path.resolve(process.argv[2] || path.join(root, "flyer.png"));
const original = fs.readFileSync(imagePath);
const mime = imagePath.endsWith(".png") ? "image/png" : "image/jpeg";
const small = await prepareForModel(original, mime);
console.log(`image: ${small.originalWidth}x${small.originalHeight} ${(original.length / 1024).toFixed(0)} KB -> sent ${small.width}x${small.height} ${(small.buffer.length / 1024).toFixed(0)} KB`);

const goals = [
  { id: 1, name: "Earn more" },
  { id: 2, name: "Learn a skill" },
  { id: 3, name: "Don't miss deadlines" },
];
const note = "Saw this on Instagram. I want to join the next edition. Check if registration is still open .";
const today = new Date().toISOString().slice(0, 10);
const dataUrl = (img) => `data:${img.mimeType};base64,${img.buffer.toString("base64")}`;
const messagesFor = (img) => buildMessages({ goals, note, today, imageDataUrl: dataUrl(img) });

const variants = [
  { name: "baseline #1", extra: {} },
  { name: "baseline #2", extra: {} },
  { name: "reasoning_effort: low", extra: { reasoning_effort: "low" } },
  { name: "reasoning_effort: minimal", extra: { reasoning_effort: "minimal" } },
  { name: "reasoning_effort: high", extra: { reasoning_effort: "high" } },
  { name: "reasoning: {effort: low}", extra: { reasoning: { effort: "low" } } },
  { name: "bogus param (control)", extra: { definitely_not_a_param: 1 } },
  { name: "ORIGINAL size image, no extra", extra: {}, original: true },
];

const rows = [];
for (const v of variants) {
  const img = v.original ? { buffer: original, mimeType: mime } : small;
  const body = { model: MODEL, temperature: 0, max_tokens: 8000, messages: messagesFor(img), ...v.extra };
  const t0 = Date.now();
  let status = 0;
  let text = "";
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(240_000),
    });
    status = res.status;
    text = await res.text();
  } catch (err) {
    text = String(err?.message ?? err);
  }
  const ms = Date.now() - t0;
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON
  }
  const choice = json?.choices?.[0];
  const parsed = parseModelJson(choice?.message?.content ?? "");
  const row = {
    variant: v.name,
    http: status,
    seconds: (ms / 1000).toFixed(1),
    prompt_tok: json?.usage?.prompt_tokens ?? "-",
    completion_tok: json?.usage?.completion_tokens ?? "-",
    reasoning_tok: json?.usage?.completion_tokens_details?.reasoning_tokens ?? "-",
    finish: choice?.finish_reason ?? "-",
    json_ok: parsed ? "yes" : "no",
    kind: parsed?.kind ?? "-",
    goal: parsed?.goal_id ?? "-",
    evidence: parsed?.evidence_quote ? String(parsed.evidence_quote).slice(0, 34) : "-",
    deadline: parsed ? (parsed.deadline ? "proposed" : "null") : "-",
    error: status && status >= 400 ? text.slice(0, 160).replace(/\s+/g, " ") : "",
  };
  rows.push(row);
  console.log(`done: ${row.variant}  http=${row.http}  ${row.seconds}s  reasoning=${row.reasoning_tok}  ${row.error}`);
}

console.log("\n===== RESULTS =====");
console.table(rows.map(({ error, ...r }) => r));
for (const r of rows) if (r.error) console.log(`ERROR ${r.variant}: ${r.error}`);
