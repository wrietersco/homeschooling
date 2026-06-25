// LLM abstraction for the agent runtime. The runtime depends only on a small
// `generate()` contract, so tests inject a deterministic fake while production
// uses Gemini. Request building + response parsing are pure functions, unit
// tested without network access.
//
// Gemini gotcha (carried from the prior build): model `gemini-2.0-flash` 404s
// on this key — use `gemini-2.5-flash` with thinkingBudget:0 and a
// maxOutputTokens >= 1024.

export const DEFAULT_MODEL = "gemini-2.5-flash";

// Build a generateContent request body for Gemini's function-calling API.
export function buildGeminiRequest({ system, contents, toolDeclarations, config = {} }) {
  const body = {
    contents,
    generationConfig: {
      temperature: config.temperature ?? 0.4,
      maxOutputTokens: config.maxOutputTokens ?? 2048,
      // Disable "thinking" tokens for latency/cost by default; a superadmin can
      // raise the budget per agent for harder reasoning (config.thinkingBudget).
      thinkingConfig: { thinkingBudget: config.thinkingBudget ?? 0 },
    },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (toolDeclarations?.length) {
    body.tools = [{ functionDeclarations: toolDeclarations }];
  }
  // Optional forced function calling. `mode: "ANY"` makes the model REQUIRED to
  // emit a tool call (optionally restricted to `allowedFunctionNames`) rather
  // than being free to reply with prose — the cure for "the model replied
  // without calling save_content". Pass-through only; callers opt in.
  if (config.toolConfig) body.toolConfig = config.toolConfig;
  return body;
}

// Normalize a Gemini response into { text, functionCalls, finishReason, blockReason }.
// finishReason is surfaced so callers can detect MAX_TOKENS truncation — a
// truncated response silently drops trailing parts (e.g. a large functionCall),
// which otherwise looks like the model just "chose not to" call the tool.
// blockReason is surfaced when the prompt/candidate was filtered by safety, so an
// empty response carries a signal instead of looking like "the model said nothing".
export function parseGeminiResponse(json) {
  const candidate = json?.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  const functionCalls = [];
  let text = "";
  for (const part of parts) {
    if (part.functionCall) {
      functionCalls.push({ name: part.functionCall.name, args: part.functionCall.args || {} });
    } else if (typeof part.text === "string") {
      text += part.text;
    }
  }
  // A safety/recitation block leaves no candidate (promptFeedback.blockReason) or a
  // candidate whose finishReason is SAFETY/RECITATION with no usable parts.
  const finishReason = candidate?.finishReason || null;
  let blockReason = json?.promptFeedback?.blockReason || null;
  if (!blockReason && !candidate) blockReason = "NO_CANDIDATE";
  if (!blockReason && !text && !functionCalls.length && ["SAFETY", "RECITATION", "PROHIBITED_CONTENT"].includes(finishReason)) {
    blockReason = finishReason;
  }
  return { text, functionCalls, finishReason, blockReason, usage: parseUsage(json?.usageMetadata) };
}

// Normalize Gemini's usageMetadata into a stable token-count shape for cost
// metering. `candidatesTokenCount` is the visible output; `thoughtsTokenCount`
// is "thinking" tokens (billed as output) — kept separate so callers can price
// them but still see what the model actually emitted. Returns zeros when usage
// is absent (older responses / injected fakes) so pricing math never NaNs.
export function parseUsage(usageMetadata) {
  const u = usageMetadata || {};
  return {
    inputTokens: Number(u.promptTokenCount) || 0,
    outputTokens: Number(u.candidatesTokenCount) || 0,
    thoughtTokens: Number(u.thoughtsTokenCount) || 0,
    totalTokens: Number(u.totalTokenCount) || 0,
  };
}

// HTTP statuses worth retrying — transient server / rate-limit conditions. 4xx
// other than 429 are caller errors and fail fast.
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Production client. fetchImpl is injectable for testing the transport.
// `maxRetries` bounds transient-failure retries with exponential backoff + jitter
// so a single 429/5xx/network blip doesn't abort a whole multi-step agent run.
export function createGeminiClient({ apiKey, model = DEFAULT_MODEL, fetchImpl = globalThis.fetch, maxRetries = 3, baseDelayMs = 400 } = {}) {
  if (!apiKey) throw new Error("GEMINI_API_KEY is required for the Gemini client");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  return {
    model,
    async generate({ system, contents, toolDeclarations, config }) {
      const body = buildGeminiRequest({ system, contents, toolDeclarations, config });
      let lastErr;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        let res;
        try {
          res = await fetchImpl(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
            body: JSON.stringify(body),
          });
        } catch (e) {
          // Network-level failure — retryable.
          lastErr = e instanceof Error ? e : new Error(String(e));
          if (attempt < maxRetries) { await sleep(backoffMs(baseDelayMs, attempt)); continue; }
          throw lastErr;
        }
        if (res.ok) return parseGeminiResponse(await res.json());

        const detail = await res.text().catch(() => "");
        lastErr = new Error(`Gemini ${res.status}: ${detail.slice(0, 500)}`);
        if (RETRYABLE_STATUSES.has(res.status) && attempt < maxRetries) {
          await sleep(backoffMs(baseDelayMs, attempt));
          continue;
        }
        throw lastErr;
      }
      throw lastErr || new Error("Gemini request failed");
    },
  };
}

// Exponential backoff with full jitter, capped at 8s.
function backoffMs(base, attempt) {
  const ceil = Math.min(8000, base * 2 ** attempt);
  // Deterministic-free jitter without Math.random: spread within [ceil/2, ceil].
  return Math.floor(ceil / 2 + (ceil / 2) * ((attempt * 1664525 + 1013904223) % 1000) / 1000);
}
