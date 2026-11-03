// Model provider switch. Baseten (OpenAI compatible) is the only provider in this build.
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

export function createProvider(modelConfig, { fetchImpl = fetch } = {}) {
  switch (modelConfig.provider) {
    case "baseten":
      return basetenProvider(modelConfig.baseten, fetchImpl);
    default:
      throw new Error(`Unknown MODEL_PROVIDER "${modelConfig.provider}". Supported: baseten`);
  }
}

export const REASONING_EFFORTS = ["minimal", "low", "medium", "high"];

function basetenProvider({ apiKey, baseUrl, model, reasoningEffort = null }, fetchImpl) {
  if (reasoningEffort && !REASONING_EFFORTS.includes(reasoningEffort)) {
    throw new Error(`Invalid BASETEN_REASONING_EFFORT "${reasoningEffort}". Use one of: ${REASONING_EFFORTS.join(", ")}`);
  }
  return {
    name: "baseten",
    model,
    reasoningEffort,
    configured: () => Boolean(apiKey),

    /** Returns { content, reasoning, finishReason, usage, model, ms }. Throws ModelError. */
    async chat({ messages, tools, toolChoice = "auto", maxTokens = 6000, temperature = 0, timeoutMs = 180_000 }) {
      if (!apiKey) throw new ModelError("model_not_configured", "BASETEN_API_KEY is not set");
      const started = Date.now();
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
            // Verified accepted and effective on Baseten (Nov 2). Only sent when configured.
            ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
            // Tool calling (auto and forced) was verified on Baseten Nov 2.
            ...(tools?.length ? { tools, tool_choice: toolChoice } : {}),
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        if (err?.name === "TimeoutError") throw new ModelError("model_timeout", `Model call timed out after ${timeoutMs} ms`);
        throw new ModelError("model_unreachable", `Could not reach the model API: ${err?.message ?? err}`);
      }
      const text = await res.text();
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
        reasoning: choice?.message?.reasoning_content ?? null,
        finishReason: choice?.finish_reason ?? null,
        usage: json?.usage ?? null,
        model: json?.model ?? model,
        ms: Date.now() - started,
      };
    },
  };
}
