// smoke.mjs : Baseten smoke test for Muse Spark Open (SavedToAction / SavedToAction)
// Run: node smoke.mjs [path/to/screenshot.png]
// Needs Node 18+ (built-in fetch). No npm install.
//
// UNVERIFIED ASSUMPTIONS (the test checks them):
// - Baseten Model APIs are OpenAI compatible at https://inference.baseten.co/v1
// - Auth header is "Authorization: Bearer <key>" (set BASETEN_AUTH=Api-Key to switch)
// - Model id is meta-models/muse-spark-open-1026

import fs from "node:fs";
import path from "node:path";

const KEY = process.env.BASETEN_API_KEY;
const BASE = process.env.BASETEN_BASE_URL || "https://inference.baseten.co/v1";
const MODEL = process.env.BASETEN_MODEL || "meta-models/muse-spark-open-1026";
const AUTH = process.env.BASETEN_AUTH || "Bearer";
const IMAGE = process.argv[2];

if (!KEY) {
  console.error("Missing BASETEN_API_KEY. Set it first.");
  process.exit(1);
}

const results = [];

async function chat(body) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `${AUTH} ${KEY}` },
    body: JSON.stringify({ model: MODEL, temperature: 0, max_tokens: 800, ...body }),
  });
  const ms = Date.now() - t0;
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (!res.ok) throw new Error(`HTTP ${res.status} after ${ms}ms: ${text.slice(0, 300)}`);
  return { json, ms };
}

function parseJson(s) {
  if (!s) return null;
  const m = s.match(/\{[\s\S]*\}/);
  try { return m ? JSON.parse(m[0]) : null; } catch { return null; }
}

async function run(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
    console.log(`PASS  ${name}  ${detail}`);
  } catch (e) {
    results.push({ name, ok: false, detail: e.message });
    console.log(`FAIL  ${name}  ${e.message}`);
  }
}

const SOURCE = `Applications for the Atlas Builders Grant close on Friday, November 6, 2026 at 23:59 GMT. Submit a 2 page proposal and a 1 minute video. Selected teams receive $5,000.`;

// 1. Basic text call
await run("1_text", async () => {
  const { json, ms } = await chat({ messages: [{ role: "user", content: "Reply with the single word: pong" }] });
  const out = json?.choices?.[0]?.message?.content?.trim();
  if (!out) throw new Error("empty response");
  return `${ms}ms reply="${out.slice(0, 40)}" model=${json.model || "?"}`;
});

// 2. JSON extraction plus verbatim evidence check
await run("2_json_extract", async () => {
  const { json, ms } = await chat({
    messages: [
      { role: "system", content: "Extract deadline info. Output only JSON with keys: title, deadline_iso, timezone, deliverables (array), evidence_quote (exact substring of the text). Use null if unknown. Never invent." },
      { role: "user", content: SOURCE },
    ],
  });
  const raw = json?.choices?.[0]?.message?.content;
  const obj = parseJson(raw);
  if (!obj) throw new Error(`not JSON: ${String(raw).slice(0, 150)}`);
  const verbatim = obj.evidence_quote && SOURCE.includes(obj.evidence_quote);
  return `${ms}ms deadline=${obj.deadline_iso} tz=${obj.timezone} verbatim_quote=${verbatim}`;
});

// 3. Tool calling (model must choose and call the tool)
await run("3_tool_call", async () => {
  const { json, ms } = await chat({
    tool_choice: "auto",
    tools: [{
      type: "function",
      function: {
        name: "create_prep_block",
        description: "Stage a calendar block to prepare for a deadline. Requires user approval before writing.",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string" },
            start_iso: { type: "string" },
            duration_min: { type: "integer" },
            timezone: { type: "string" },
          },
          required: ["title", "start_iso", "duration_min", "timezone"],
        },
      },
    }],
    messages: [
      { role: "system", content: "You plan prep time for deadlines. Use tools when an action is needed." },
      { role: "user", content: `${SOURCE}\nMy timezone is Africa/Casablanca. Stage a 120 minute prep block on Thursday Nov 5 2026 at 10:00.` },
    ],
  });
  const call = json?.choices?.[0]?.message?.tool_calls?.[0];
  if (!call) throw new Error(`no tool_calls. content="${String(json?.choices?.[0]?.message?.content).slice(0, 150)}"`);
  const args = JSON.parse(call.function.arguments);
  return `${ms}ms tool=${call.function.name} args=${JSON.stringify(args)}`;
});

// 4. Image input (only if a screenshot path is given)
await run("4_image", async () => {
  if (!IMAGE) throw new Error("SKIPPED: pass a screenshot path, e.g. node smoke.mjs flyer.png");
  const ext = path.extname(IMAGE).slice(1).toLowerCase().replace("jpg", "jpeg");
  const b64 = fs.readFileSync(IMAGE).toString("base64");
  const { json, ms } = await chat({
    messages: [{
      role: "user",
      content: [
        { type: "text", text: "Read this image. Output only JSON: title, deadline_text (exact words shown), deadline_iso, timezone. Use null if not visible." },
        { type: "image_url", image_url: { url: `data:image/${ext};base64,${b64}` } },
      ],
    }],
  });
  const raw = json?.choices?.[0]?.message?.content;
  const obj = parseJson(raw);
  if (!obj) throw new Error(`not JSON: ${String(raw).slice(0, 150)}`);
  return `${ms}ms ${JSON.stringify(obj).slice(0, 200)}`;
});

console.log("\n===== SUMMARY =====");
console.log(`model=${MODEL} base=${BASE} auth=${AUTH} node=${process.version}`);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}: ${r.detail}`);
console.log("===================");
