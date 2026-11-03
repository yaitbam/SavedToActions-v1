import test from "node:test";
import assert from "node:assert/strict";
import { ExtractionError, MAX_TOKENS, buildMessages, buildSystemPrompt, extractFromScreenshot, parseModelJson } from "../src/extraction/extract.js";
import { ModelError, createProvider } from "../src/model/provider.js";

const goals = [
  { id: 1, name: "Earn more" },
  { id: 2, name: "Learn a skill" },
];

test("parseModelJson: plain, fenced, surrounded by prose, and rejects everything else", () => {
  assert.deepEqual(parseModelJson('{"a":1}'), { a: 1 });
  assert.deepEqual(parseModelJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseModelJson('Here you go:\n{"a":{"b":2}}\nHope that helps'), { a: { b: 2 } });
  assert.equal(parseModelJson("[1,2]"), null);
  assert.equal(parseModelJson('{"a":1'), null);
  assert.equal(parseModelJson("no json here"), null);
  assert.equal(parseModelJson(null), null);
});

test("prompt: asks for wall time + IANA tz only, null tz when not stated, no invention", () => {
  const p = buildSystemPrompt({ goals, today: "2026-11-02" });
  assert.match(p, /1: Earn more/);
  assert.match(p, /2: Learn a skill/);
  assert.match(p, /Do NOT add a UTC offset or Z/);
  assert.match(p, /Do NOT convert between timezones/);
  assert.match(p, /IANA timezone name/);
  assert.match(p, /Otherwise null\. Never guess\./);
  assert.match(p, /Never invent deadlines/);
  assert.match(p, /past edition is not a deadline for the next edition/);
  assert.match(p, /today \(2026-11-02\)/);
  assert.match(p, /If the note states what the user wants, quote the note/);
  assert.match(p, /"event_dates" are the dates of the event itself/);
  assert.match(p, /copied verbatim/);
  assert.match(p, /only if the year is written/);
  assert.match(p, /Do not give advice, especially financial advice/);
});

test("prompt: lists the user's goals by id and limits goal_id to those ids or null", () => {
  const preset = [
    { id: 1, name: "Earn more" },
    { id: 2, name: "Learn a skill" },
    { id: 3, name: "Events and opportunities" },
  ];
  const p = buildSystemPrompt({ goals: preset, today: "2026-11-02" });
  assert.match(p, /1: Earn more\n2: Learn a skill\n3: Events and opportunities/);
  assert.match(p, /integer id of the one goal that fits best, copied exactly from this list/);
  assert.match(p, /Use null if none clearly fits/);
  assert.match(p, /never write a goal name/i);
  // A renamed goal reaches the model under its new name, same id.
  const renamed = buildSystemPrompt({ goals: [{ id: 2, name: "Ship side projects" }], today: "2026-11-02" });
  assert.match(renamed, /2: Ship side projects/);
  assert.doesNotMatch(renamed, /Learn a skill/);
});

test("messages: system prompt, then the note and the screenshot as a base64 data URL", () => {
  const msgs = buildMessages({ goals, note: "join the next edition", today: "2026-11-02", imageDataUrl: "data:image/png;base64,AAAA" });
  assert.equal(msgs[0].role, "system");
  assert.equal(msgs[1].role, "user");
  const [text, image] = msgs[1].content;
  assert.match(text.text, /join the next edition/);
  assert.match(text.text, /Today's date: 2026-11-02/);
  assert.deepEqual(image, { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } });
  assert.match(buildMessages({ goals, note: "", today: "2026-11-02", imageDataUrl: "x" })[1].content[0].text, /\(no note\)/);
});

function fakeProvider(result) {
  const calls = [];
  return {
    calls,
    chat: async (req) => {
      calls.push(req);
      if (result instanceof Error) throw result;
      return { content: "", finishReason: "stop", usage: null, model: "fake", ms: 1, ...result };
    },
  };
}
const run = (provider) =>
  extractFromScreenshot({ provider, imageBuffer: Buffer.from("png-bytes"), mimeType: "image/png", note: "n", goals, today: "2026-11-02" });

test("extract: returns the parsed JSON, sends a generous token budget and the image", async () => {
  const provider = fakeProvider({ content: '```json\n{"title":"T"}\n```', usage: { total_tokens: 900 } });
  const r = await run(provider);
  assert.deepEqual(r.raw, { title: "T" });
  assert.equal(r.model, "fake");
  assert.deepEqual(r.usage, { total_tokens: 900 });
  assert.equal(provider.calls[0].maxTokens, MAX_TOKENS);
  assert.ok(MAX_TOKENS >= 4000);
  assert.equal(provider.calls[0].messages[1].content[1].image_url.url, `data:image/png;base64,${Buffer.from("png-bytes").toString("base64")}`);
});

test("extract: every failure has its own code", async () => {
  await assert.rejects(run(fakeProvider(new ModelError("model_http_error", "Model API returned HTTP 500"))), (e) => e instanceof ExtractionError && e.code === "model_http_error");
  await assert.rejects(run(fakeProvider({ content: "   ", finishReason: "stop" })), { code: "model_empty" });
  await assert.rejects(run(fakeProvider({ content: "", finishReason: "length" })), { code: "model_truncated" });
  await assert.rejects(run(fakeProvider({ content: '{"title": "cut off', finishReason: "length" })), { code: "model_truncated" });
  await assert.rejects(run(fakeProvider({ content: "Sorry, I cannot do that.", finishReason: "stop" })), { code: "model_bad_json" });
  await assert.rejects(run(fakeProvider(new TypeError("bug"))), TypeError);
});

// Model provider (Baseten), with a fake fetch.
const modelCfg = { provider: "baseten", baseten: { apiKey: "sk-test-123", baseUrl: "https://inference.baseten.co/v1", model: "meta-models/muse-spark-open-1026" } };
const okResponse = (body, status = 200) => ({ ok: status < 400, status, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });

test("provider: unknown provider name fails loudly", () => {
  assert.throws(() => createProvider({ provider: "nope" }), /Unknown MODEL_PROVIDER "nope"/);
});

test("baseten: verified request shape and response parsing (content, reasoning_content, usage)", async () => {
  let seen;
  const provider = createProvider(modelCfg, {
    fetchImpl: async (url, init) => {
      seen = { url, init, body: JSON.parse(init.body) };
      return okResponse({
        model: "meta-models/muse-spark-open-1026",
        choices: [{ message: { content: '{"a":1}', reasoning_content: "thinking" }, finish_reason: "stop" }],
        usage: { total_tokens: 700 },
      });
    },
  });
  const r = await provider.chat({ messages: [{ role: "user", content: "hi" }], maxTokens: 6000 });
  assert.equal(seen.url, "https://inference.baseten.co/v1/chat/completions");
  assert.equal(seen.init.method, "POST");
  assert.equal(seen.init.headers.Authorization, "Bearer sk-test-123");
  assert.equal(seen.body.model, "meta-models/muse-spark-open-1026");
  assert.equal(seen.body.max_tokens, 6000);
  assert.equal(seen.body.temperature, 0);
  assert.equal(seen.body.response_format, undefined, "JSON mode is unverified on Baseten, so it is not requested");
  assert.deepEqual(r, {
    content: '{"a":1}',
    toolCalls: [],
    assistantMessage: { role: "assistant", content: '{"a":1}' },
    reasoning: "thinking",
    finishReason: "stop",
    usage: { total_tokens: 700 },
    model: "meta-models/muse-spark-open-1026",
    ms: r.ms,
  });
  assert.equal("tools" in seen.body, false, "no tools unless asked");
  assert.equal(provider.name, "baseten");
  assert.equal(provider.configured(), true);
});

test("baseten: reasoning_effort is sent only when configured, and only valid values are accepted", async () => {
  const bodies = [];
  const fetchImpl = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return okResponse({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }] });
  };
  await createProvider(modelCfg, { fetchImpl }).chat({ messages: [] });
  await createProvider({ ...modelCfg, baseten: { ...modelCfg.baseten, reasoningEffort: "low" } }, { fetchImpl }).chat({ messages: [] });
  assert.equal("reasoning_effort" in bodies[0], false);
  assert.equal(bodies[1].reasoning_effort, "low");
  assert.throws(() => createProvider({ ...modelCfg, baseten: { ...modelCfg.baseten, reasoningEffort: "extreme" } }), /Invalid BASETEN_REASONING_EFFORT "extreme"/);
});

test("baseten: tools are sent with tool_choice, and tool calls come back ready to append to the conversation", async () => {
  let body;
  const toolCall = { id: "call_1", type: "function", function: { name: "find_slot", arguments: '{"not_before_utc":"2026-11-03T12:00:00Z"}' } };
  const provider = createProvider(modelCfg, {
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body);
      return okResponse({ choices: [{ message: { content: null, tool_calls: [toolCall], reasoning_content: "secret thoughts" }, finish_reason: "tool_calls" }] });
    },
  });
  const tools = [{ type: "function", function: { name: "find_slot", parameters: { type: "object", properties: {} } } }];
  const r = await provider.chat({ messages: [], tools });
  assert.deepEqual(body.tools, tools);
  assert.equal(body.tool_choice, "auto");
  assert.deepEqual(r.toolCalls, [{ id: "call_1", name: "find_slot", arguments: '{"not_before_utc":"2026-11-03T12:00:00Z"}' }]);
  assert.deepEqual(r.assistantMessage, { role: "assistant", content: null, tool_calls: [toolCall] });
  assert.doesNotMatch(JSON.stringify(r.assistantMessage), /secret thoughts/);
  assert.equal(r.finishReason, "tool_calls");
});

test("baseten: missing key never calls the network", async () => {
  let called = false;
  const provider = createProvider({ ...modelCfg, baseten: { ...modelCfg.baseten, apiKey: "" } }, { fetchImpl: async () => { called = true; } });
  assert.equal(provider.configured(), false);
  await assert.rejects(provider.chat({ messages: [] }), { code: "model_not_configured" });
  assert.equal(called, false);
});

test("baseten: HTTP errors, timeouts, network errors and bad bodies map to codes, and the key never leaks", async () => {
  const chat = (fetchImpl) => createProvider(modelCfg, { fetchImpl }).chat({ messages: [] });
  const http = await chat(async () => okResponse("secret prompt echo", 429)).catch((e) => e);
  assert.equal(http.code, "model_http_error");
  assert.equal(http.status, 429);
  assert.doesNotMatch(http.message, /secret prompt echo|sk-test-123/);
  const timeout = Object.assign(new Error("t"), { name: "TimeoutError" });
  await assert.rejects(chat(async () => { throw timeout; }), { code: "model_timeout" });
  await assert.rejects(chat(async () => { throw new TypeError("fetch failed"); }), { code: "model_unreachable" });
  await assert.rejects(chat(async () => okResponse("<html>bad gateway</html>")), { code: "model_bad_response" });
});
