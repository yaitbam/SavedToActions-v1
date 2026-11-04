import test from "node:test";
import assert from "node:assert/strict";
import { ExtractionError, MAX_TOKENS, buildMessages, buildSystemPrompt, extractFromScreenshot, parseModelJson } from "../src/extraction/extract.js";
import { ModelError, createProvider, modelInfo } from "../src/model/provider.js";
import { modelConfigFromEnv } from "../src/config.js";

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

// ---- the provider switch: baseten (default) or meta ----------------------------------------------------------------
const metaCfg = (over = {}) => ({ provider: "meta", meta: { apiKey: "meta-key-1", baseUrl: "https://api.meta.ai/v1", model: "muse-spark-1.3", reasoningEffort: "low", ...over } });
const okChat = { choices: [{ message: { content: "ok" }, finish_reason: "stop" }], model: "muse-spark-1.3", usage: {} };

test("config: baseten is the default and the meta values are the agreed defaults", () => {
  const cfg = modelConfigFromEnv({});
  assert.equal(cfg.provider, "baseten");
  assert.equal(cfg.baseten.baseUrl, "https://inference.baseten.co/v1");
  assert.equal(cfg.baseten.model, "meta-models/muse-spark-open-1026");
  assert.equal(cfg.baseten.reasoningEffort, "low");
  assert.deepEqual(cfg.meta, { apiKey: "", baseUrl: "https://api.meta.ai/v1", model: "muse-spark-1.3", reasoningEffort: "low", forcedToolChoice: "auto" });
});

test("config: MODEL_PROVIDER, key names, overrides and the trailing slash", () => {
  assert.equal(modelConfigFromEnv({ MODEL_PROVIDER: " Meta " }).provider, "meta");
  assert.equal(modelConfigFromEnv({ MODEL_PROVIDER: "" }).provider, "baseten");
  // META_API_KEY wins over MODEL_API_KEY, MODEL_API_KEY is the fallback, and the Baseten key is never used for Meta.
  assert.equal(modelConfigFromEnv({ META_API_KEY: "a", MODEL_API_KEY: "b" }).meta.apiKey, "a");
  assert.equal(modelConfigFromEnv({ MODEL_API_KEY: "b" }).meta.apiKey, "b");
  assert.equal(modelConfigFromEnv({ BASETEN_API_KEY: "c" }).meta.apiKey, "");
  assert.equal(modelConfigFromEnv({ META_API_KEY: "a" }).baseten.apiKey, "");
  const over = modelConfigFromEnv({ META_BASE_URL: "https://example.test/v9//", META_MODEL: "muse-spark-2" });
  assert.equal(over.meta.baseUrl, "https://example.test/v9");
  assert.equal(over.meta.model, "muse-spark-2");
  // none is never sent: it means send nothing.
  for (const value of ["none", "off", "default", "NONE"]) assert.equal(modelConfigFromEnv({ META_REASONING_EFFORT: value }).meta.reasoningEffort, null);
  assert.equal(modelConfigFromEnv({ META_REASONING_EFFORT: "high" }).meta.reasoningEffort, "high");
});

test("provider: both names work, unknown fails and lists them, contributor ids are refused", () => {
  assert.equal(createProvider(modelCfg).name, "baseten");
  assert.equal(createProvider(metaCfg()).name, "meta");
  assert.throws(() => createProvider({ provider: "nope" }), /Supported: baseten, meta/);
  assert.throws(() => createProvider(metaCfg({ model: "muse-spark-1.3-contributor" })), /contributor/);
  assert.throws(() => createProvider({ provider: "baseten", baseten: { ...modelCfg.baseten, model: "x/Contributor" } }), /contributor/);
  assert.throws(() => createProvider(metaCfg({ reasoningEffort: "none" })), /Invalid META_REASONING_EFFORT/);
});

test("meta: request shape, bearer key, base url and reasoning_effort low", async () => {
  let seen;
  const fetchImpl = async (url, init) => { seen = { url, init, body: JSON.parse(init.body) }; return okResponse(okChat); };
  const out = await createProvider(metaCfg(), { fetchImpl }).chat({ messages: [{ role: "user", content: "hi" }], maxTokens: 123 });
  assert.equal(seen.url, "https://api.meta.ai/v1/chat/completions");
  assert.equal(seen.init.headers.Authorization, "Bearer meta-key-1");
  assert.equal(seen.body.model, "muse-spark-1.3");
  assert.equal(seen.body.reasoning_effort, "low");
  assert.equal(seen.body.max_tokens, 123);
  assert.equal(out.content, "ok");
  // A reasoning field named "reasoning" is read too.
  const named = await createProvider(metaCfg(), { fetchImpl: async () => okResponse({ choices: [{ message: { content: "a", reasoning: "why" } }] }) }).chat({ messages: [] });
  assert.equal(named.reasoning, "why");
});

test("meta: a missing key names META_API_KEY and never calls the network", async () => {
  let called = false;
  const provider = createProvider(metaCfg({ apiKey: "" }), { fetchImpl: async () => { called = true; } });
  assert.equal(provider.configured(), false);
  await assert.rejects(provider.chat({ messages: [] }), (e) => e.code === "model_not_configured" && /META_API_KEY/.test(e.message));
  assert.equal(called, false);
});

test("meta: a 400 about reasoning is retried once without it, with one log line, and later calls skip it", async () => {
  const bodies = [], logs = [];
  const warn = console.warn;
  console.warn = (line) => logs.push(line);
  try {
    const fetchImpl = async (_url, init) => {
      const body = JSON.parse(init.body);
      bodies.push(body);
      return "reasoning_effort" in body ? okResponse({ error: { message: "Unknown parameter: reasoning_effort" } }, 400) : okResponse(okChat);
    };
    const provider = createProvider(metaCfg(), { fetchImpl });
    assert.equal((await provider.chat({ messages: [] })).content, "ok");
    assert.equal((await provider.chat({ messages: [] })).content, "ok");
    assert.deepEqual(bodies.map((b) => "reasoning_effort" in b), [true, false, false]);
    assert.equal(logs.length, 1);
    assert.match(logs[0], /rejected reasoning_effort/);
    assert.ok(!logs[0].includes("meta-key-1"));
  } finally { console.warn = warn; }
});

test("meta: other 400s are not retried, and baseten never retries", async () => {
  let calls = 0;
  const bad = async () => { calls += 1; return okResponse({ error: { message: "messages is required" } }, 400); };
  await assert.rejects(createProvider(metaCfg(), { fetchImpl: bad }).chat({ messages: [] }), (e) => e.status === 400);
  assert.equal(calls, 1);
  calls = 0;
  const reasoningBad = async () => { calls += 1; return okResponse({ error: { message: "bad reasoning_effort" } }, 400); };
  await assert.rejects(createProvider(modelCfg, { fetchImpl: reasoningBad }).chat({ messages: [] }), (e) => e.status === 400);
  assert.equal(calls, 1);
  // With reasoning turned off there is nothing to retry.
  calls = 0;
  await assert.rejects(createProvider(metaCfg({ reasoningEffort: null }), { fetchImpl: reasoningBad }).chat({ messages: [] }), (e) => e.status === 400);
  assert.equal(calls, 1);
});

test("modelInfo: the label and open weights claim come from the active config", () => {
  const baseten = modelInfo(createProvider(modelCfg));
  assert.deepEqual(baseten, { provider: "baseten", id: "meta-models/muse-spark-open-1026", label: "Muse Spark Open", openWeights: true });
  const meta = modelInfo(createProvider(metaCfg()));
  assert.deepEqual(meta, { provider: "meta", id: "muse-spark-1.3", label: "muse-spark-1.3", openWeights: false });
  assert.deepEqual(modelInfo(null), { provider: null, id: null, label: null, openWeights: false });
});

// ---- forced tool calls: Baseten sends the object, Meta asks with auto and a strict instruction ---------------------------
const TOOL = { type: "function", function: { name: "get_availability", description: "x", parameters: { type: "object", properties: {} } } };
const OTHER = { type: "function", function: { name: "find_slot", description: "y", parameters: { type: "object", properties: {} } } };
const FORCE = { type: "function", function: { name: "get_availability" } };
const toolReply = (name) => okResponse({ choices: [{ message: { content: null, tool_calls: [{ id: "c1", type: "function", function: { name, arguments: "{}" } }] }, finish_reason: "tool_calls" }] });
const textReply = okResponse({ choices: [{ message: { content: "I can help with that" }, finish_reason: "stop" }] });
const recorder = (...replies) => {
  const bodies = [];
  return { bodies, fetchImpl: async (_u, init) => { bodies.push(JSON.parse(init.body)); return replies[Math.min(bodies.length, replies.length) - 1]; } };
};

test("meta: a forced tool is asked for with auto, only that tool and a strict instruction", async () => {
  const { bodies, fetchImpl } = recorder(toolReply("get_availability"));
  const out = await createProvider(metaCfg(), { fetchImpl }).chat({ messages: [{ role: "user", content: "check 2026-11-05" }], tools: [TOOL, OTHER], toolChoice: FORCE });
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].tool_choice, "auto");
  assert.deepEqual(bodies[0].tools.map((t) => t.function.name), ["get_availability"]);
  assert.equal(bodies[0].messages[0].role, "system");
  assert.match(bodies[0].messages[0].content, /must call the tool "get_availability"/);
  assert.equal(bodies[0].messages[1].content, "check 2026-11-05");
  assert.equal(out.toolCalls[0].name, "get_availability");
  assert.equal(out.toolMode, "auto+instruction");
  assert.equal(out.toolAttempts, 1);
});

test("meta: no tool call is retried once, a second miss fails with a clear error", async () => {
  const retried = recorder(textReply, toolReply("get_availability"));
  const ok = await createProvider(metaCfg(), { fetchImpl: retried.fetchImpl }).chat({ messages: [], tools: [TOOL], toolChoice: FORCE });
  assert.equal(retried.bodies.length, 2);
  assert.equal(ok.toolAttempts, 2);

  const missed = recorder(textReply, textReply, toolReply("get_availability"));
  await assert.rejects(
    createProvider(metaCfg(), { fetchImpl: missed.fetchImpl }).chat({ messages: [], tools: [TOOL], toolChoice: FORCE }),
    (e) => e instanceof ModelError && e.code === "model_no_tool_call" && /"get_availability" after 2 tries/.test(e.message),
  );
  assert.equal(missed.bodies.length, 2, "exactly one retry, never more");

  // A call to some other tool does not count as the forced one.
  const wrong = recorder(toolReply("find_slot"), toolReply("find_slot"));
  await assert.rejects(createProvider(metaCfg(), { fetchImpl: wrong.fetchImpl }).chat({ messages: [], tools: [TOOL, OTHER], toolChoice: FORCE }), (e) => e.code === "model_no_tool_call");
  // The tool must exist in the list.
  await assert.rejects(createProvider(metaCfg(), { fetchImpl: async () => textReply }).chat({ messages: [], tools: [OTHER], toolChoice: FORCE }), (e) => e.code === "model_bad_request");
});

test("meta: META_FORCED_TOOL_CHOICE=required is opt in, auto stays the default, bad values are refused", async () => {
  assert.equal(modelConfigFromEnv({}).meta.forcedToolChoice, "auto");
  assert.equal(modelConfigFromEnv({ META_FORCED_TOOL_CHOICE: " Required " }).meta.forcedToolChoice, "required");
  const { bodies, fetchImpl } = recorder(toolReply("get_availability"));
  const out = await createProvider(metaCfg({ forcedToolChoice: "required" }), { fetchImpl }).chat({ messages: [], tools: [TOOL], toolChoice: FORCE });
  assert.equal(bodies[0].tool_choice, "required");
  assert.match(bodies[0].messages[0].content, /get_availability/);
  assert.equal(out.toolMode, "required+instruction");
  assert.throws(() => createProvider(metaCfg({ forcedToolChoice: "none" })), /Invalid forced tool choice/);
});

test("meta: an auto tool choice is passed through untouched, and Baseten still sends the forced object", async () => {
  const auto = recorder(toolReply("get_availability"));
  const messages = [{ role: "user", content: "hi" }];
  await createProvider(metaCfg(), { fetchImpl: auto.fetchImpl }).chat({ messages, tools: [TOOL, OTHER], toolChoice: "auto" });
  assert.equal(auto.bodies[0].tool_choice, "auto");
  assert.deepEqual(auto.bodies[0].tools.map((t) => t.function.name), ["get_availability", "find_slot"]);
  assert.deepEqual(auto.bodies[0].messages, messages);

  const base = recorder(toolReply("get_availability"));
  const out = await createProvider(modelCfg, { fetchImpl: base.fetchImpl }).chat({ messages, tools: [TOOL, OTHER], toolChoice: FORCE });
  assert.deepEqual(base.bodies[0].tool_choice, FORCE);
  assert.deepEqual(base.bodies[0].messages, messages);
  assert.deepEqual(base.bodies[0].tools.map((t) => t.function.name), ["get_availability", "find_slot"]);
  assert.equal(out.toolMode, undefined);
});
