// Model provider switch: baseten (default) or meta, both OpenAI compatible. MODEL_PROVIDER picks one.
// Verified Nov 2: POST {baseUrl}/chat/completions, Authorization: Bearer <key>, image input as a
// base64 data URL, reasoning model (reasoning_content), so max_tokens must be generous.
// Unverified: response_format JSON mode, so it is not used.

export class ModelError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = "ModelError";
    this.code = code;
    Object.assign(this, extra);
  }
}

export const PROVIDERS = ["baseten", "meta"];

export function createProvider(modelConfig, { fetchImpl = fetch } = {}) {
  switch (modelConfig.provider) {
    case "baseten":
      return openAiCompatProvider({
        name: "baseten",
        keyEnv: "BASETEN_API_KEY",
        effortEnv: "BASETEN_REASONING_EFFORT",
        retryWithoutReasoning: false,
        // Baseten accepts a forced tool_choice object. Verified Nov 2.
        emulateForcedTool: false,
        ...modelConfig.baseten,
      }, fetchImpl);
    case "meta":
      return openAiCompatProvider({
        name: "meta",
        keyEnv: "META_API_KEY",
        effortEnv: "META_REASONING_EFFORT",
        // Unverified on Meta. If it rejects reasoning_effort with a 400, the call is retried once without it.
        retryWithoutReasoning: true,
        // Meta answers HTTP 400 to a forced tool_choice object (smoke result). A forced call is asked for with
        // tool_choice "auto" and a strict instruction instead. META_FORCED_TOOL_CHOICE=required switches the
        // tool_choice to "required" once the smoke check shows Meta accepts it.
        emulateForcedTool: true,
        ...modelConfig.meta,
      }, fetchImpl);
    default:
      throw new Error(`Unknown MODEL_PROVIDER "${modelConfig.provider}". Supported: ${PROVIDERS.join(", ")}`);
  }
}

export const REASONING_EFFORTS = ["minimal", "low", "medium", "high"];

/**
 * What the UI may say about the model. It comes from the active provider config, never from fixed text.
 * Only the Muse Spark Open model is open weights, so any other id is shown as its own id and not called open.
 */
export function modelLabel(id) {
  if (typeof id !== "string" || !id) return null;
  return /muse-spark-open/i.test(id) ? "Muse Spark Open" : id;
}

export function modelInfo(provider) {
  const id = provider?.model ?? null;
  const openWeights = typeof id === "string" && /muse-spark-open/i.test(id);
  return { provider: provider?.name ?? null, id, label: modelLabel(id), openWeights };
}

// A model id that ends in "contributor" is never used, whichever provider is active.
const assertModelId = (model, name) => {
  if (typeof model !== "string" || !model.trim()) throw new Error(`No model id for provider "${name}"`);
  if (/contributor$/i.test(model.trim())) throw new Error(`Refusing model id "${model}" for provider "${name}". Ids ending in contributor are not used`);
};

export const FORCED_TOOL_CHOICES = ["auto", "required"];

// The tool a caller forces, from the OpenAI shape {type:"function", function:{name}}. Null when nothing is forced.
const forcedToolName = (toolChoice) => (toolChoice && typeof toolChoice === "object" ? toolChoice.function?.name ?? null : null);

const forcedToolInstruction = (name) =>
  `You must call the tool "${name}" now. Reply with that tool call only, with no text. Do not answer in words and do not call any other tool.`;

function openAiCompatProvider({ name, keyEnv, effortEnv, retryWithoutReasoning, emulateForcedTool = false, forcedToolChoice = "auto", apiKey, baseUrl, model, reasoningEffort = null }, fetchImpl) {
  if (!FORCED_TOOL_CHOICES.includes(forcedToolChoice)) {
    throw new Error(`Invalid forced tool choice "${forcedToolChoice}". Use one of: ${FORCED_TOOL_CHOICES.join(", ")}`);
  }
  if (reasoningEffort && !REASONING_EFFORTS.includes(reasoningEffort)) {
    throw new Error(`Invalid ${effortEnv} "${reasoningEffort}". Use one of: ${REASONING_EFFORTS.join(", ")}`);
  }
  assertModelId(model, name);
  // Set after the API rejected reasoning_effort once, so later calls do not repeat the failed request.
  let reasoningRejected = false;
  return {
    name,
    model,
    reasoningEffort,
    configured: () => Boolean(apiKey),

    /**
     * Returns { content, toolCalls, reasoning, finishReason, usage, model, ms }. Throws ModelError.
     * A forced tool (toolChoice {type:"function", function:{name}}) is sent as is on Baseten. On Meta it is asked for
     * with tool_choice "auto" (or "required"), only that tool, and a strict instruction. No tool call means one retry,
     * then a clear error, so a forced call never silently turns into plain text.
     */
    async chat(args) {
      const forced = emulateForcedTool ? forcedToolName(args.toolChoice) : null;
      if (!forced) return request(args);
      const only = (args.tools ?? []).filter((t) => t.function?.name === forced);
      if (only.length === 0) throw new ModelError("model_bad_request", `Forced tool "${forced}" is not in the tool list`);
      const emulated = {
        ...args,
        tools: only,
        toolChoice: forcedToolChoice,
        messages: [{ role: "system", content: forcedToolInstruction(forced) }, ...args.messages],
      };
      let last = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        last = await request(emulated);
        if (last.toolCalls.some((call) => call.name === forced)) return { ...last, toolMode: `${forcedToolChoice}+instruction`, toolAttempts: attempt };
      }
      throw new ModelError("model_no_tool_call", `The model did not call the required tool "${forced}" after 2 tries`, { finishReason: last?.finishReason ?? null });
    },
  };

  async function request({ messages, tools, toolChoice = "auto", maxTokens = 6000, temperature = 0, timeoutMs = 180_000 }) {
      if (!apiKey) throw new ModelError("model_not_configured", `${keyEnv} is not set`);
      const started = Date.now();
      const send = async (withReasoning) => {
        let res;
        try {
          res = await fetchImpl(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
              model,
              temperature,
              max_tokens: maxTokens,
              messages,
              // Only sent when configured. Never sent as "none": that value maps to not sending it at all.
              ...(withReasoning && reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
              ...(tools?.length ? { tools, tool_choice: toolChoice } : {}),
            }),
            signal: AbortSignal.timeout(timeoutMs),
          });
        } catch (err) {
          if (err?.name === "TimeoutError") throw new ModelError("model_timeout", `Model call timed out after ${timeoutMs} ms`);
          throw new ModelError("model_unreachable", `Could not reach the model API: ${err?.message ?? err}`);
        }
        return { res, text: await res.text() };
      };
      let sent = await send(!reasoningRejected);
      if (!sent.res.ok && sent.res.status === 400 && retryWithoutReasoning && reasoningEffort && !reasoningRejected && /reasoning/i.test(sent.text)) {
        reasoningRejected = true;
        console.warn(`Model API (${name}) rejected reasoning_effort with HTTP 400. Retrying without it. Set ${effortEnv}=off to stop sending it.`);
        sent = await send(false);
      }
      const { res, text } = sent;
      if (!res.ok) {
        // The response body may echo the prompt, so keep it out of the message.
        throw new ModelError("model_http_error", `Model API returned HTTP ${res.status}`, { status: res.status, body: text.slice(0, 300) });
      }
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new ModelError("model_bad_response", "Model API returned a non JSON body");
      }
      const choice = json?.choices?.[0];
      const toolCalls = choice?.message?.tool_calls ?? [];
      return {
        content: choice?.message?.content ?? "",
        toolCalls: toolCalls.map((tc) => ({ id: tc.id, name: tc.function?.name, arguments: tc.function?.arguments ?? "{}" })),
        // To append to the conversation before sending tool results back. reasoning_content is left out on purpose.
        assistantMessage: { role: "assistant", content: choice?.message?.content ?? null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) },
        // Baseten calls the field reasoning_content. Some OpenAI compatible APIs call it reasoning.
        reasoning: choice?.message?.reasoning_content ?? choice?.message?.reasoning ?? null,
        finishReason: choice?.finish_reason ?? null,
        usage: json?.usage ?? null,
        model: json?.model ?? model,
        ms: Date.now() - started,
      };
  }
}
