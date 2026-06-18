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
  return body;
}

// Normalize a Gemini response into { text, functionCalls, finishReason }.
// finishReason is surfaced so callers can detect MAX_TOKENS truncation — a
// truncated response silently drops trailing parts (e.g. a large functionCall),
// which otherwise looks like the model just "chose not to" call the tool.
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
  return { text, functionCalls, finishReason: candidate?.finishReason || null };
}

// Production client. fetchImpl is injectable for testing the transport.
export function createGeminiClient({ apiKey, model = DEFAULT_MODEL, fetchImpl = globalThis.fetch } = {}) {
  if (!apiKey) throw new Error("GEMINI_API_KEY is required for the Gemini client");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  return {
    model,
    async generate({ system, contents, toolDeclarations, config }) {
      const body = buildGeminiRequest({ system, contents, toolDeclarations, config });
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`Gemini ${res.status}: ${detail.slice(0, 500)}`);
      }
      return parseGeminiResponse(await res.json());
    },
  };
}
