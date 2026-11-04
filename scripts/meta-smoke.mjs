// meta-smoke.mjs : checks a model provider with the same provider code the app uses. Meta by default, Baseten with a flag.
//
// Run: node scripts/meta-smoke.mjs [--provider meta|baseten] [path/to/screenshot.png]
//
// Meta needs META_API_KEY (or MODEL_API_KEY). Baseten needs BASETEN_API_KEY. Put it in the environment or the repo root .env.
// Optional: META_BASE_URL, META_MODEL, META_REASONING_EFFORT, META_FORCED_TOOL_CHOICE (and the BASETEN_* names for Baseten).
// It tests the provider you name, whatever MODEL_PROVIDER says, and never changes the default. Nothing is written anywhere
// and the key is never printed. Costs about 13 model calls.
//
// Checks: plain text, JSON extraction with a verbatim evidence_quote, a forced tool call, an auto tool call,
// base64 image input with a real screenshot, and the Africa/Casablanca timezone probe (wall time plus IANA zone only).
// Then a probe of tool_choice "required", and a table of fields compared with what the code was built against on Baseten.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..");
const { config } = await import("../server/src/config.js");
const { createProvider } = await import("../server/src/model/provider.js");
const { extractFromScreenshot } = await import("../server/src/extraction/extract.js");
const { prepareForModel } = await import("../server/src/extraction/image.js");
const { detectImageType } = await import("../server/src/routes/saves.js");
const { normalizeExtraction } = await import("../server/src/extraction/normalize.js");
const { offsetAt, wallToUtc } = await import("../server/src/tz.js");

const args = process.argv.slice(2);
let PROVIDER = "meta";
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--provider") PROVIDER = args[++i];
  else if (args[i].startsWith("--provider=")) PROVIDER = args[i].slice("--provider=".length);
  else positional.push(args[i]);
}
if (!["meta", "baseten"].includes(PROVIDER)) {
  console.error(`Unknown provider "${PROVIDER}". Use --provider meta or --provider baseten.`);
  process.exit(1);
}
const cfg = config.model[PROVIDER];
const KEY_HELP = PROVIDER === "meta" ? "META_API_KEY (or MODEL_API_KEY)" : "BASETEN_API_KEY";
if (!cfg.apiKey) {
  console.error(`No key. Set ${KEY_HELP} in the environment or in the repo root .env.`);
  process.exit(1);
}
let provider;
try {
  provider = createProvider({ provider: PROVIDER, [PROVIDER]: cfg });
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
const IMAGE = path.resolve(positional[0] ?? path.join(ROOT, "fixtures", "demo", "01.png"));
if (!fs.existsSync(IMAGE)) {
  console.error(`Screenshot not found: ${IMAGE}`);
  process.exit(1);
}

console.log(`${PROVIDER === "meta" ? "Meta" : "Baseten"} smoke test`);
console.log(`  provider   ${PROVIDER}`);
console.log(`  base url   ${cfg.baseUrl}`);
console.log(`  model      ${cfg.model}`);
console.log(`  reasoning  ${cfg.reasoningEffort ?? "not sent"}`);
if (PROVIDER === "meta") console.log(`  forced tool choice  ${cfg.forcedToolChoice}`);
console.log(`  screenshot ${path.relative(ROOT, IMAGE)}\n`);

const results = [];
const clip = (text, n = 140) => String(text ?? "").replace(/\s+/g, " ").slice(0, n);
async function run(name, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    const ms = Date.now() - t0;
    results.push({ name, ok: true, ms });
    console.log(`PASS  ${name.padEnd(34)} ${String(ms).padStart(6)} ms  ${detail}`);
  } catch (err) {
    const ms = Date.now() - t0;
    results.push({ name, ok: false, ms, error: clip(err.message, 300) });
    console.log(`FAIL  ${name.padEnd(34)} ${String(ms).padStart(6)} ms  ${clip(err.message, 300)}`);
  }
}
const parseJson = (text) => {
  const m = String(text ?? "").match(/\{[\s\S]*\}/);
  try { return m ? JSON.parse(m[0]) : null; } catch { return null; }
};
const need = (cond, message) => { if (!cond) throw new Error(message); };

const SOURCE = "Applications for the Atlas Builders Grant close on Friday, November 6, 2026 at 23:59 GMT. Submit a 2 page proposal and a 1 minute video.";
const TOOLS = [{
  type: "function",
  function: {
    name: "get_availability",
    description: "Read the user's busy times on a calendar day. Read only.",
    parameters: { type: "object", properties: { date: { type: "string", description: "YYYY-MM-DD" } }, required: ["date"] },
  },
}];

// 1
await run("plain text", async () => {
  const out = await provider.chat({ messages: [{ role: "user", content: "Reply with exactly one word: pong" }], maxTokens: 2000 });
  need(/pong/i.test(out.content), `no pong in "${clip(out.content, 60)}"`);
  return `finish=${out.finishReason} model=${out.model} reasoning=${out.reasoning ? "yes" : "none"}`;
});

// 2
await run("json + verbatim evidence_quote", async () => {
  const out = await provider.chat({
    messages: [
      { role: "system", content: 'Return ONLY a JSON object {"title": string, "evidence_quote": string}. evidence_quote must be copied character for character from the text.' },
      { role: "user", content: SOURCE },
    ],
    maxTokens: 4000,
  });
  const json = parseJson(out.content);
  need(json, `not JSON: "${clip(out.content, 80)}"`);
  need(typeof json.evidence_quote === "string" && json.evidence_quote.length > 5, "no evidence_quote");
  need(SOURCE.includes(json.evidence_quote), `quote is not verbatim: "${clip(json.evidence_quote, 80)}"`);
  return `quote "${clip(json.evidence_quote, 70)}"`;
});

// 3
await run("forced tool call", async () => {
  const out = await provider.chat({
    messages: [{ role: "user", content: "Check my availability on 2026-11-05." }],
    tools: TOOLS,
    toolChoice: { type: "function", function: { name: "get_availability" } },
    maxTokens: 2000,
  });
  need(out.toolCalls.length > 0, `no tool call (finish=${out.finishReason})`);
  need(out.toolCalls[0].name === "get_availability", `wrong tool "${out.toolCalls[0].name}"`);
  const args = JSON.parse(out.toolCalls[0].arguments);
  need(typeof args.date === "string", "no date argument");
  return `${out.toolCalls[0].name}(${out.toolCalls[0].arguments}) mode=${out.toolMode ?? "native tool_choice object"} tries=${out.toolAttempts ?? 1} finish=${out.finishReason}`;
});

// 4
await run("auto tool call", async () => {
  const out = await provider.chat({
    messages: [
      { role: "system", content: "You plan calendar time. Use the tools to read the calendar. Never guess." },
      { role: "user", content: "Am I free on 2026-11-05? Look at my calendar first." },
    ],
    tools: TOOLS,
    toolChoice: "auto",
    maxTokens: 4000,
  });
  need(out.toolCalls.length > 0, `model answered without a tool: "${clip(out.content, 80)}" finish=${out.finishReason}`);
  need(out.toolCalls[0].name === "get_availability", `wrong tool "${out.toolCalls[0].name}"`);
  return `${out.toolCalls[0].name}(${out.toolCalls[0].arguments}) finish=${out.finishReason}`;
});

// 5
await run("base64 image + real extraction", async () => {
  const buffer = fs.readFileSync(IMAGE);
  const mime = detectImageType(buffer);
  need(mime, "not a PNG, JPEG or WebP");
  const prepared = await prepareForModel(buffer, mime);
  const goals = [
    { id: 1, name: "Earn more", description: "Freelance, side income, grants" },
    { id: 2, name: "Learn a skill", description: "Courses, tutorials, tools to try" },
    { id: 3, name: "Events and opportunities", description: "Hackathons, programs, meetups" },
  ];
  const nowMs = Date.now();
  const extraction = await extractFromScreenshot({ provider, imageBuffer: prepared.buffer, mimeType: prepared.mimeType, note: "", goals, today: new Date(nowMs).toISOString().slice(0, 10) });
  const { fields, warnings } = normalizeExtraction(extraction.raw, { note: "", goals, settingsTz: "Africa/Casablanca", nowMs });
  need(fields.transcription.length > 20, "the model read no text from the image");
  const goal = goals.find((g) => g.id === fields.goalId)?.name ?? "none";
  console.log(`        title    ${clip(fields.title, 90)}`);
  console.log(`        goal     ${goal}`);
  console.log(`        deadline ${fields.deadline ? JSON.stringify(fields.deadline).slice(0, 150) : "none"}`);
  console.log(`        quote    ${fields.evidenceQuote ? `"${clip(fields.evidenceQuote, 80)}" matches the image or note: ${JSON.stringify(fields.evidenceMatches)}` : "none"}`);
  console.log(`        warnings ${warnings.map((w) => w.code).join(", ") || "none"}`);
  return `${prepared.width}x${prepared.height}, ${fields.transcription.length} chars read, finish=${extraction.finishReason}`;
});

// 6
await run("timezone probe (Casablanca)", async () => {
  const text = "Registration closes Friday 20 November 2026 at 18:00, Casablanca, Morocco.";
  const out = await provider.chat({
    messages: [
      { role: "system", content: 'Return ONLY {"wall": "YYYY-MM-DDTHH:mm", "tz": "<IANA zone>"}. wall is the local time as written. Do NOT add a UTC offset or Z. Do NOT convert between timezones.' },
      { role: "user", content: text },
    ],
    maxTokens: 4000,
  });
  const json = parseJson(out.content);
  need(json, `not JSON: "${clip(out.content, 80)}"`);
  need(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(json.wall ?? ""), `wall must be YYYY-MM-DDTHH:mm with no offset, got "${json.wall}"`);
  need(json.tz === "Africa/Casablanca", `tz must be Africa/Casablanca, got "${json.tz}"`);
  const utc = wallToUtc(json.wall, json.tz);
  need(utc.ok, `code could not convert: ${utc.reason}`);
  const offset = offsetAt(utc.ms, json.tz);
  need(offset === "+00:00", `our offset for ${json.tz} is ${offset}, expected +00:00`);
  need(utc.utc === "2026-11-20T18:00:00.000Z", `utc ${utc.utc}, expected 2026-11-20T18:00:00.000Z`);
  return `wall ${json.wall} ${json.tz} -> ${utc.utc} (${offset}), model gave no offset`;
});

// ---- differences from Baseten --------------------------------------------------------------------------------------
// Raw requests, so field names are read exactly as the API sends them.
async function raw(body) {
  const t0 = Date.now();
  let res;
  try {
    res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({ model: cfg.model, temperature: 0, messages: [{ role: "user", content: "Reply with one word: ok" }], ...body }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    return { status: 0, ms: Date.now() - t0, error: err.message };
  }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* keep text */ }
  return { status: res.status, ms: Date.now() - t0, json, text };
}
const message = (r) => r.json?.choices?.[0]?.message ?? {};

console.log(`\nFields compared with what the code was built against (Baseten, on the right). Running: ${PROVIDER}\n`);
const diffs = [];
const show = (label, found, baseline, { info = false } = {}) => {
  const same = info || String(found) === String(baseline);
  diffs.push({ label, found, baseline, same });
  console.log(`${info ? "info   " : same ? "same   " : "DIFFERS"} ${label.padEnd(32)} ${PROVIDER}: ${String(found).padEnd(44)} built for: ${baseline}`);
};

const a = await raw({ max_tokens: 3000, reasoning_effort: "low" });
const b = await raw({ max_completion_tokens: 3000 });
const c = await raw({ max_tokens: 3000 });
const d = await raw({ max_tokens: 3 });
const e = await raw({
  max_tokens: 2000,
  messages: [{ role: "user", content: "Check my availability on 2026-11-05." }],
  tools: TOOLS,
  tool_choice: { type: "function", function: { name: "get_availability" } },
});
// Used by the probe below. Run here so the tool call shape can be read from it when the forced object is rejected.
const probe = await raw({
  max_tokens: 2000,
  messages: [{ role: "user", content: "Check my availability on 2026-11-05." }],
  tools: TOOLS,
  tool_choice: "required",
});

const reasoningKeys = ["reasoning_content", "reasoning", "reasoning_details"].filter((k) => message(a)[k] != null || message(c)[k] != null);
show("reasoning field name", reasoningKeys.join(" + ") || "none seen", "reasoning_content");
show("max token parameter max_tokens", a.status === 200 || c.status === 200 ? "accepted" : `HTTP ${c.status}`, "accepted");
show("also accepts max_completion_tokens", b.status === 200 ? "yes" : `HTTP ${b.status}`, "not used by the app", { info: true });
show("reasoning_effort low", a.status === 200 ? "accepted" : `HTTP ${a.status}: ${clip(a.json?.error?.message ?? a.text, 70)}`, "accepted");
show("finish_reason when cut short", d.json?.choices?.[0]?.finish_reason ?? `HTTP ${d.status}`, "length");
show("usage.reasoning_tokens path", c.json?.usage?.completion_tokens_details?.reasoning_tokens != null ? "completion_tokens_details.reasoning_tokens" : Object.keys(c.json?.usage ?? {}).join(",") || "none", "completion_tokens_details.reasoning_tokens");
show("response echoes model", c.json?.model ?? "missing", cfg.model);
const call = message(e).tool_calls?.[0] ?? message(probe).tool_calls?.[0];
show("tool_calls[].function.arguments", call ? typeof call.function?.arguments : `no tool call (HTTP ${e.status})`, "string");
show("tool_call id present", call ? Boolean(call.id) : "n/a", "true");
show("forced tool_choice object", e.status === 200 && message(e).tool_calls?.length ? "accepted" : `HTTP ${e.status}`, "accepted");

// Probe: tool_choice "required" as a string. Reported only. It is used by the app only if META_FORCED_TOOL_CHOICE=required is set.
const probeCall = message(probe).tool_calls?.[0];
const probeResult = probe.status === 200
  ? probeCall ? `accepted, called ${probeCall.function?.name}` : `accepted but no tool call (finish=${probe.json?.choices?.[0]?.finish_reason})`
  : `HTTP ${probe.status}: ${clip(probe.json?.error?.message ?? probe.text, 90)}`;
console.log(`\nPROBE  tool_choice "required" (string)  ${probe.ms} ms  ${probeResult}`);
if (PROVIDER === "meta") {
  console.log(probe.status === 200 && probeCall
    ? "        Accepted. The app still asks with auto and an instruction. Set META_FORCED_TOOL_CHOICE=required to use it."
    : "        Not usable. The app keeps asking with auto and an instruction, which is the default.");
}
diffs.push({ label: 'tool_choice "required"', found: probeResult, baseline: "unknown", same: true });

const latencies = [["text, reasoning low", a.ms], ["text, no reasoning param", c.ms], ["forced tool call", e.ms], ['tool_choice "required"', probe.ms]];
console.log("\nLatency of the raw calls: " + latencies.map(([k, v]) => `${k} ${v} ms`).join(", "));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed. Total ${results.reduce((s, r) => s + r.ms, 0)} ms.`);
if (failed.length) console.log(`Failed: ${failed.map((r) => r.name).join(", ")}`);
console.log(`${diffs.filter((x) => !x.same).length} fields differ from what the code was built against. The default provider was not changed.`);
process.exit(failed.length ? 1 : 0);
