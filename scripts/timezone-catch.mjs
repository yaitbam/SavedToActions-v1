// Saves the evidence for the timezone catch: one forced tool call to Muse Spark Open that asks for a start time
// in Africa/Casablanca on 2026-11-05, stored raw, next to what our code computes for the same wall time.
//
// Run: node scripts/timezone-catch.mjs
// Model call only. No Google Calendar, no database. Writes docs/evidence/timezone-catch.json.
// The request is the same as case B in scripts/debug.mjs. The API key is never written to the file.
import fs from "node:fs";
import path from "node:path";
import { config, REPO_ROOT } from "../server/src/config.js";
import { offsetAt, runSelfTest, wallToUtc } from "../server/src/tz.js";

const { apiKey, baseUrl, model } = config.model.baseten;
if (!apiKey) {
  console.error("BASETEN_API_KEY is not set in .env. Nothing was called.");
  process.exit(1);
}
runSelfTest();

const WALL = "2026-11-05T10:00";
const ZONE = "Africa/Casablanca";
const request = {
  model,
  temperature: 0,
  max_tokens: 4000,
  tools: [
    {
      type: "function",
      function: {
        name: "create_prep_block",
        description: "Stage a calendar block to prepare for a deadline.",
        parameters: {
          type: "object",
          properties: { title: { type: "string" }, start_iso: { type: "string" }, duration_min: { type: "integer" }, timezone: { type: "string" } },
          required: ["title", "start_iso", "duration_min", "timezone"],
        },
      },
    },
  ],
  tool_choice: { type: "function", function: { name: "create_prep_block" } },
  messages: [
    {
      role: "user",
      content: "Grant deadline is Fri Nov 6 2026 23:59 GMT. My timezone is Africa/Casablanca. Stage a 120 minute prep block on Thu Nov 5 2026 at 10:00.",
    },
  ],
};

const startedAt = new Date().toISOString();
const res = await fetch(`${baseUrl}/chat/completions`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
  body: JSON.stringify(request),
});
const text = await res.text();
let rawResponse;
try {
  rawResponse = JSON.parse(text);
} catch {
  rawResponse = { unparsedBody: text };
}

// What the model asked for, and what our code computes for the same wall time.
const call = rawResponse?.choices?.[0]?.message?.tool_calls?.[0];
let args = null;
try {
  args = JSON.parse(call?.function?.arguments ?? "null");
} catch {
  args = null;
}
const ours = wallToUtc(WALL, ZONE);
const ourOffset = ours.ok ? offsetAt(ours.utc, ZONE) : null;
const modelStart = args?.start_iso ?? null;
const modelOffset = modelStart?.match(/(Z|[+-]\d{2}:?\d{2})$/)?.[1] ?? null;
const modelOffsetNorm = modelOffset === "Z" ? "+00:00" : modelOffset?.replace(/^([+-]\d{2})(\d{2})$/, "$1:$2") ?? null;
const ourCode = {
  library: "moment-timezone",
  wallTime: WALL,
  zone: ZONE,
  utc: ours.utc ?? null,
  offset: ourOffset,
  modelStartIso: modelStart,
  modelOffset: modelOffsetNorm,
  modelOffsetMatchesOurs: modelOffsetNorm === null ? null : modelOffsetNorm === ourOffset,
};

const evidence = {
  savedAt: new Date().toISOString(),
  requestSentAt: startedAt,
  requestedModel: model,
  responseModel: rawResponse?.model ?? null,
  httpStatus: res.status,
  request,
  rawResponse,
  ourCode,
};
const file = path.join(REPO_ROOT, "docs", "evidence", "timezone-catch.json");
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`);

console.log(`http ${res.status}, model ${evidence.responseModel ?? model}`);
console.log(`finish_reason: ${rawResponse?.choices?.[0]?.finish_reason}`);
console.log(`tool call arguments: ${call?.function?.arguments ?? "(none)"}`);
console.log(`model start_iso: ${modelStart}  (offset ${modelOffsetNorm ?? "none"})`);
console.log(`our code: ${WALL} ${ZONE} -> utc ${ourCode.utc}, offset ${ourOffset}`);
console.log(`model offset matches ours: ${ourCode.modelOffsetMatchesOurs}`);
console.log(`saved ${path.relative(REPO_ROOT, file)}`);
