// debug.mjs : prints the raw Baseten response for the tool call and image tests
// Run: node debug.mjs flyer.png
import fs from "node:fs";
import path from "node:path";

const KEY = process.env.BASETEN_API_KEY;
const BASE = process.env.BASETEN_BASE_URL || "https://inference.baseten.co/v1";
const MODEL = process.env.BASETEN_MODEL || "meta-models/muse-spark-open-1026";
const IMAGE = process.argv[2];

async function call(label, body) {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model: MODEL, temperature: 0, max_tokens: 4000, ...body }),
  });
  const text = await res.text();
  let j = null;
  try { j = JSON.parse(text); } catch {}
  const c = j?.choices?.[0];
  const msg = c?.message || {};
  console.log(`\n===== ${label} =====`);
  console.log("http:", res.status);
  console.log("finish_reason:", c?.finish_reason);
  console.log("message keys:", Object.keys(msg).join(", "));
  console.log("usage:", JSON.stringify(j?.usage));
  console.log("raw message:", JSON.stringify(msg).slice(0, 1500));
  if (!j) console.log("raw body:", text.slice(0, 800));
}

const tools = [{
  type: "function",
  function: {
    name: "create_prep_block",
    description: "Stage a calendar block to prepare for a deadline.",
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
}];
const ask = "Grant deadline is Fri Nov 6 2026 23:59 GMT. My timezone is Africa/Casablanca. Stage a 120 minute prep block on Thu Nov 5 2026 at 10:00.";

await call("A tool_choice auto", { tools, tool_choice: "auto", messages: [{ role: "user", content: ask }] });
await call("B tool_choice forced", {
  tools,
  tool_choice: { type: "function", function: { name: "create_prep_block" } },
  messages: [{ role: "user", content: ask }],
});

if (IMAGE) {
  const ext = path.extname(IMAGE).slice(1).toLowerCase().replace("jpg", "jpeg");
  const b64 = fs.readFileSync(IMAGE).toString("base64");
  console.log("\nimage bytes:", fs.statSync(IMAGE).size);
  await call("C image base64", {
    messages: [{
      role: "user",
      content: [
        { type: "text", text: "What text is written in this image? List the title and any dates." },
        { type: "image_url", image_url: { url: `data:image/${ext};base64,${b64}` } },
      ],
    }],
  });
}
