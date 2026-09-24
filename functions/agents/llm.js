// LLM abstraction for the agent runtime. The runtime depends only on a small
// `generate()` contract, so tests inject a deterministic fake while production
// uses Gemini. Request building + response parsing are pure functions, unit
// tested without network access.
//
// Gemini gotcha (carried from the prior build): model `gemini-2.0-flash` 404s
// on this key — use `gemini-2.5-flash` with thinkingBudget:0 and a
// maxOutputTokens >= 1024.

export const DEFAULT_MODEL = "gemini-2.5-flash";

// Some Gemini models cannot switch thinking off — a `thinkingBudget: 0` request is
// rejected with HTTP 400 ("Budget 0 is invalid. This model only works in thinking
// mode"): every Pro model (2.5 Pro, 3.1 Pro …) and gemini-3.5-flash-lite (verified
// against the live API 2026-09-20). For those, "thinking off" means "leave the
// model's own default", i.e. omit thinkingConfig. Everything else keeps the
// explicit budget (0 = off unless a superadmin raised it for harder reasoning).
const GEMINI_THINKING_REQUIRED = /(^|-)pro(-|$)|3\.5-flash-lite/i;
export function geminiThinkingConfig(model, budget = 0) {
  const b = Number(budget) || 0;
  if (b > 0) return { thinkingBudget: b };
  if (GEMINI_THINKING_REQUIRED.test(String(model || ""))) return undefined;
  return { thinkingBudget: 0 };
}

// Build a generateContent request body for Gemini's function-calling API.
export function buildGeminiRequest({ system, contents, toolDeclarations, config = {}, model }) {
  const thinking = geminiThinkingConfig(model, config.thinkingBudget);
  const body = {
    contents,
    generationConfig: {
      temperature: config.temperature ?? 0.4,
      maxOutputTokens: config.maxOutputTokens ?? 2048,
      // Disable "thinking" tokens for latency/cost by default; a superadmin can
      // raise the budget per agent for harder reasoning (config.thinkingBudget).
      ...(thinking ? { thinkingConfig: thinking } : {}),
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
      const call = { name: part.functionCall.name, args: part.functionCall.args || {} };
      // Gemini 3.x models attach an opaque `thoughtSignature` to the function-call
      // part and REJECT the next turn (HTTP 400 "Function call is missing a
      // thought_signature") unless it is echoed back. Keep it so the runtime can.
      if (part.thoughtSignature) call.thoughtSignature = part.thoughtSignature;
      functionCalls.push(call);
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
      const body = buildGeminiRequest({ system, contents, toolDeclarations, config, model });
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

// ─── OpenAI text client ─────────────────────────────────────────────────────────
// The agent runtime speaks Gemini's { contents, toolDeclarations } shape. To run
// the SAME ReAct loop on OpenAI, we translate that shape into Chat Completions
// messages/tools and translate the response back into the runtime's
// { text, functionCalls, finishReason, blockReason, usage } contract — so every
// text agent works on either provider with no runtime change. The translation is
// pure (buildOpenAiMessages / buildOpenAiTools / parseOpenAiResponse), unit-tested
// without network access.

export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

// The newest OpenAI models (GPT-5.5, GPT-5.6 Sol/Terra/Luna, GPT-6 Astra …) are
// reasoning models: /v1/chat/completions rejects a non-default temperature for
// them, and refuses function tools unless reasoning_effort is "none" — which
// GPT-6 Astra does not even offer. Their supported route is the Responses API, so
// those ids are sent there (verified against the live API 2026-09-20). Older chat
// models (gpt-4o*, gpt-4.1*, gpt-5.4*) keep using Chat Completions unchanged.
export function usesResponsesApi(model) {
  return /^gpt-(5\.([5-9]|\d{2,})|[6-9])/i.test(String(model || ""));
}

// Map the app's generic "thinking budget" onto OpenAI's reasoning effort. Budget 0
// means "don't spend on thinking": "none" where the model allows it, else the
// lowest effort it offers (GPT-6 Astra has no "none"). A positive budget picks a
// tier by size. Returns the effort string for the Responses API.
export function openAiReasoningEffort(model, thinkingBudget = 0) {
  const b = Number(thinkingBudget) || 0;
  if (b <= 0) return /^gpt-[6-9]/i.test(String(model || "")) ? "low" : "none";
  if (b <= 2048) return "low";
  if (b <= 8192) return "medium";
  return "high";
}

// Gemini `contents` → Responses API `input` items. Same FIFO call-id pairing as
// buildOpenAiMessages (Gemini parts carry no ids):
//   user / text             → { role: "user", content }
//   model / text            → { role: "assistant", content }
//   model / functionCall[]  → [assistant text?] + { type: "function_call", call_id, name, arguments }
//   user / functionResponse → { type: "function_call_output", call_id, output }
export function buildOpenAiResponsesInput({ contents = [] }) {
  const items = [];
  const pendingIds = [];
  let callSeq = 0;
  for (const turn of contents) {
    const parts = turn.parts || [];
    const fnCalls = parts.filter((p) => p.functionCall);
    const fnResponses = parts.filter((p) => p.functionResponse);
    const text = parts.filter((p) => typeof p.text === "string").map((p) => p.text).join("");
    if (fnCalls.length) {
      if (text) items.push({ role: "assistant", content: text });
      for (const p of fnCalls) {
        const id = `call_${callSeq++}`;
        pendingIds.push(id);
        items.push({ type: "function_call", call_id: id, name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args || {}) });
      }
      continue;
    }
    if (fnResponses.length) {
      for (const p of fnResponses) {
        const id = pendingIds.shift() || `call_${callSeq++}`;
        const payload = p.functionResponse?.response?.result ?? p.functionResponse?.response ?? {};
        items.push({ type: "function_call_output", call_id: id, output: typeof payload === "string" ? payload : JSON.stringify(payload) });
      }
      continue;
    }
    items.push({ role: turn.role === "model" ? "assistant" : "user", content: text });
  }
  return items;
}

// Gemini functionDeclarations → Responses API tools (flat, unlike Chat Completions).
export function buildOpenAiResponsesTools(toolDeclarations) {
  if (!toolDeclarations?.length) return undefined;
  return toolDeclarations.map((d) => ({
    type: "function",
    name: d.name,
    description: d.description || "",
    parameters: d.parameters || { type: "object", properties: {} },
  }));
}

// Forced-tool config → Responses tool_choice ("required" | "none" | {type,name}).
export function responsesToolChoiceFromConfig(toolConfig) {
  const fc = toolConfig?.functionCallingConfig;
  if (!fc) return undefined;
  if (fc.mode === "ANY" || fc.mode === "REQUIRED") {
    const allowed = fc.allowedFunctionNames;
    if (Array.isArray(allowed) && allowed.length === 1) return { type: "function", name: allowed[0] };
    return "required";
  }
  if (fc.mode === "NONE") return "none";
  return undefined;
}

// The full Responses API request body for one generate() call.
export function buildOpenAiResponsesRequest({ model, system, contents, toolDeclarations, config = {} }) {
  const body = {
    model,
    input: buildOpenAiResponsesInput({ contents }),
    // Includes reasoning tokens, like Chat Completions' max_completion_tokens.
    max_output_tokens: config.maxOutputTokens ?? 2048,
    reasoning: { effort: openAiReasoningEffort(model, config.thinkingBudget) },
    store: false, // the app keeps its own history; don't retain conversations at OpenAI
  };
  if (system) body.instructions = system;
  const tools = buildOpenAiResponsesTools(toolDeclarations);
  if (tools) body.tools = tools;
  const choice = responsesToolChoiceFromConfig(config.toolConfig);
  if (choice) body.tool_choice = choice;
  return body;
}

// Responses usage → the app's token shape. `output_tokens` already includes the
// reasoning tokens, so split them out (thoughtTokens are folded back into output
// by priceText, keeping cost math identical across providers).
export function parseOpenAiResponsesUsage(usage) {
  const u = usage || {};
  const reasoning = Number(u.output_tokens_details?.reasoning_tokens) || 0;
  const output = Number(u.output_tokens) || 0;
  return {
    inputTokens: Number(u.input_tokens) || 0,
    outputTokens: Math.max(0, output - reasoning),
    thoughtTokens: reasoning,
    totalTokens: Number(u.total_tokens) || (Number(u.input_tokens) || 0) + output,
  };
}

// Normalize a Responses API result into { text, functionCalls, finishReason,
// blockReason, usage } — the same contract parseOpenAiResponse returns.
export function parseOpenAiResponsesResponse(json) {
  const functionCalls = [];
  let text = "";
  let refusal = false;
  for (const item of json?.output || []) {
    if (item.type === "function_call") {
      let args = {};
      try { args = item.arguments ? JSON.parse(item.arguments) : {}; } catch { args = {}; }
      functionCalls.push({ name: item.name, args });
    } else if (item.type === "message") {
      for (const c of item.content || []) {
        if (c.type === "output_text" && typeof c.text === "string") text += c.text;
        else if (c.type === "refusal") refusal = true;
      }
    }
  }
  const reason = json?.incomplete_details?.reason || null;
  let finishReason = json?.status === "incomplete" ? (reason === "max_output_tokens" ? "MAX_TOKENS" : reason) : "STOP";
  const blockReason = reason === "content_filter" || (refusal && !text && !functionCalls.length) ? "SAFETY" : null;
  return { text, functionCalls, finishReason, blockReason, usage: parseOpenAiResponsesUsage(json?.usage) };
}

// Build OpenAI `messages` from a system string + Gemini `contents`. Turn mapping:
//   user / text             → { role: "user" }
//   model / text            → { role: "assistant" }
//   model / functionCall[]  → { role: "assistant", tool_calls: [...] }
//   user / functionResponse → one { role: "tool", tool_call_id } per response
// Gemini parts carry no tool-call id, so ids are synthesized positionally and
// paired FIFO — the runtime always emits the function responses in the same order
// as the calls, so the assistant tool_calls and their tool replies stay aligned.
export function buildOpenAiMessages({ system, contents = [] }) {
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  const pendingIds = []; // FIFO of tool_call ids awaiting their tool responses
  let callSeq = 0;
  for (const turn of contents) {
    const parts = turn.parts || [];
    const fnCalls = parts.filter((p) => p.functionCall);
    const fnResponses = parts.filter((p) => p.functionResponse);
    const text = parts.filter((p) => typeof p.text === "string").map((p) => p.text).join("");

    if (fnCalls.length) {
      const tool_calls = fnCalls.map((p) => {
        const id = `call_${callSeq++}`;
        pendingIds.push(id);
        return {
          id,
          type: "function",
          function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args || {}) },
        };
      });
      messages.push({ role: "assistant", content: text || null, tool_calls });
      continue;
    }
    if (fnResponses.length) {
      for (const p of fnResponses) {
        const id = pendingIds.shift() || `call_${callSeq++}`;
        const payload = p.functionResponse?.response?.result ?? p.functionResponse?.response ?? {};
        messages.push({
          role: "tool",
          tool_call_id: id,
          content: typeof payload === "string" ? payload : JSON.stringify(payload),
        });
      }
      continue;
    }
    messages.push({ role: turn.role === "model" ? "assistant" : "user", content: text });
  }
  return messages;
}

// Gemini functionDeclarations → OpenAI tools. The JSON-Schema `parameters` object
// is the same shape both providers accept, so it passes through unchanged.
export function buildOpenAiTools(toolDeclarations) {
  if (!toolDeclarations?.length) return undefined;
  return toolDeclarations.map((d) => ({
    type: "function",
    function: {
      name: d.name,
      description: d.description || "",
      parameters: d.parameters || { type: "object", properties: {} },
    },
  }));
}

// Forced-tool config → OpenAI tool_choice. Mirrors Gemini's functionCallingConfig:
// mode ANY/REQUIRED → "required" (or a specific function when exactly one name is
// allowed); NONE → "none". Returns undefined when the caller didn't force a tool.
export function toolChoiceFromConfig(toolConfig) {
  const fc = toolConfig?.functionCallingConfig;
  if (!fc) return undefined;
  if (fc.mode === "ANY" || fc.mode === "REQUIRED") {
    const allowed = fc.allowedFunctionNames;
    if (Array.isArray(allowed) && allowed.length === 1) return { type: "function", function: { name: allowed[0] } };
    return "required";
  }
  if (fc.mode === "NONE") return "none";
  return undefined;
}

// OpenAI usage → the same token shape parseUsage produces, so cost metering and
// pricing math treat both providers identically. Reasoning tokens (o-series) are
// billed as output, so they map to thoughtTokens (folded into output by priceText).
export function parseOpenAiUsage(usage) {
  const u = usage || {};
  return {
    inputTokens: Number(u.prompt_tokens) || 0,
    outputTokens: Number(u.completion_tokens) || 0,
    thoughtTokens: Number(u.completion_tokens_details?.reasoning_tokens) || 0,
    totalTokens: Number(u.total_tokens) || 0,
  };
}

// Normalize an OpenAI chat completion into { text, functionCalls, finishReason,
// blockReason, usage }. finish_reason "length" maps to MAX_TOKENS so the runtime
// reports truncation (instead of passing a partial answer off as final), and
// "content_filter" surfaces as a block reason the way Gemini's SAFETY does.
export function parseOpenAiResponse(json) {
  const choice = json?.choices?.[0];
  const msg = choice?.message || {};
  const functionCalls = [];
  for (const tc of msg.tool_calls || []) {
    if (tc.type && tc.type !== "function") continue;
    let args = {};
    try {
      args = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {};
    } catch {
      args = {}; // a malformed/partial arguments blob → treat as no args
    }
    functionCalls.push({ name: tc.function?.name, args });
  }
  const text = typeof msg.content === "string" ? msg.content : "";
  const raw = choice?.finish_reason || null;
  const finishReason = raw === "length" ? "MAX_TOKENS" : raw;
  const blockReason = raw === "content_filter" ? "SAFETY" : null;
  return { text, functionCalls, finishReason, blockReason, usage: parseOpenAiUsage(json?.usage) };
}

// Production OpenAI client. Same generate() contract + retry/backoff policy as the
// Gemini client, so the runtime and resolveLlm treat them interchangeably.
export function createOpenAiClient({ apiKey, model = DEFAULT_OPENAI_MODEL, fetchImpl = globalThis.fetch, maxRetries = 3, baseDelayMs = 400 } = {}) {
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for the OpenAI client");
  const viaResponses = usesResponsesApi(model);
  return {
    model,
    async generate({ system, contents, toolDeclarations, config = {} }) {
      let url;
      let body;
      let parse;
      if (viaResponses) {
        url = OPENAI_RESPONSES_URL;
        body = buildOpenAiResponsesRequest({ model, system, contents, toolDeclarations, config });
        parse = parseOpenAiResponsesResponse;
      } else {
        url = OPENAI_CHAT_URL;
        body = {
          model,
          messages: buildOpenAiMessages({ system, contents }),
          temperature: config.temperature ?? 0.4,
          // The current chat models expect max_completion_tokens (max_tokens is
          // deprecated and rejected by the newer ones).
          max_completion_tokens: config.maxOutputTokens ?? 2048,
        };
        const tools = buildOpenAiTools(toolDeclarations);
        if (tools) body.tools = tools;
        const choice = toolChoiceFromConfig(config.toolConfig);
        if (choice) body.tool_choice = choice;
        parse = parseOpenAiResponse;
      }

      let lastErr;
      let droppedTemperature = false;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        let res;
        try {
          res = await fetchImpl(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify(body),
          });
        } catch (e) {
          lastErr = e instanceof Error ? e : new Error(String(e));
          if (attempt < maxRetries) { await sleep(backoffMs(baseDelayMs, attempt)); continue; }
          throw lastErr;
        }
        if (res.ok) return parse(await res.json());

        const detail = await res.text().catch(() => "");
        lastErr = new Error(`OpenAI ${res.status}: ${detail.slice(0, 500)}`);
        // A newer reasoning model that only accepts the default temperature: retry
        // once without it instead of failing every call for that agent.
        if (res.status === 400 && !droppedTemperature && "temperature" in body && /temperature/i.test(detail)) {
          droppedTemperature = true;
          delete body.temperature;
          attempt -= 1; // this retry doesn't consume the transient-error budget
          continue;
        }
        if (RETRYABLE_STATUSES.has(res.status) && attempt < maxRetries) {
          await sleep(backoffMs(baseDelayMs, attempt));
          continue;
        }
        throw lastErr;
      }
      throw lastErr || new Error("OpenAI request failed");
    },
  };
}

// ─── Anthropic (Claude) text client ─────────────────────────────────────────────
// Same translation strategy as the OpenAI client above: the runtime speaks
// Gemini's { contents, toolDeclarations } shape, so we translate it into
// Anthropic's Messages API (system / messages / tools / tool_choice) and
// translate the response back into the runtime's { text, functionCalls,
// finishReason, blockReason, usage } contract. Pure + unit-tested without
// network access, mirroring buildOpenAiMessages / parseOpenAiResponse.
//
// "claude-sonnet-5" is the default: Anthropic's best price/quality balance for
// this app's structured, tool-calling text agents (curriculum/syllabus/content/
// scheduler) — Opus 4.8 is available as an explicit per-agent upgrade for the
// hardest planning tasks, mirroring how Gemini 2.5 Pro / GPT-4.1 are reserved
// (not default) in modelCatalog.js.

export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5";
const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

// Build Anthropic `messages` from a Gemini `contents` array. Turn mapping:
//   user / text             → { role: "user", content: text }
//   model / text            → { role: "assistant", content: text }
//   model / functionCall[]  → { role: "assistant", content: [{type:"tool_use", id, name, input}] }
//   user / functionResponse → { role: "user", content: [{type:"tool_result", tool_use_id, content}] }
// Gemini parts carry no tool-call id, so ids are synthesized positionally and
// paired FIFO — the runtime always emits function responses in the same order
// as the calls, so tool_use/tool_result pairs stay aligned (same trick as
// buildOpenAiMessages).
export function buildClaudeMessages({ contents = [] }) {
  const messages = [];
  const pendingIds = []; // FIFO of tool_use ids awaiting their tool_result
  let callSeq = 0;
  for (const turn of contents) {
    const parts = turn.parts || [];
    const fnCalls = parts.filter((p) => p.functionCall);
    const fnResponses = parts.filter((p) => p.functionResponse);
    const text = parts.filter((p) => typeof p.text === "string").map((p) => p.text).join("");

    if (fnCalls.length) {
      const content = fnCalls.map((p) => {
        const id = `toolu_${callSeq++}`;
        pendingIds.push(id);
        return { type: "tool_use", id, name: p.functionCall.name, input: p.functionCall.args || {} };
      });
      messages.push({ role: "assistant", content });
      continue;
    }
    if (fnResponses.length) {
      const content = fnResponses.map((p) => {
        const id = pendingIds.shift() || `toolu_${callSeq++}`;
        const payload = p.functionResponse?.response?.result ?? p.functionResponse?.response ?? {};
        return {
          type: "tool_result",
          tool_use_id: id,
          content: typeof payload === "string" ? payload : JSON.stringify(payload),
        };
      });
      messages.push({ role: "user", content });
      continue;
    }
    messages.push({ role: turn.role === "model" ? "assistant" : "user", content: text });
  }
  return messages;
}

// Gemini functionDeclarations → Anthropic tools. The JSON-Schema `parameters`
// object is the same shape Anthropic's `input_schema` expects, so it passes
// through unchanged.
export function buildClaudeTools(toolDeclarations) {
  if (!toolDeclarations?.length) return undefined;
  return toolDeclarations.map((d) => ({
    name: d.name,
    description: d.description || "",
    input_schema: d.parameters || { type: "object", properties: {} },
  }));
}

// Forced-tool config → Anthropic tool_choice. Mirrors Gemini's
// functionCallingConfig: mode ANY/REQUIRED → {type:"any"} (or {type:"tool",
// name} when exactly one name is allowed); NONE → {type:"none"}. Returns
// undefined when the caller didn't force a tool.
export function claudeToolChoiceFromConfig(toolConfig) {
  const fc = toolConfig?.functionCallingConfig;
  if (!fc) return undefined;
  if (fc.mode === "ANY" || fc.mode === "REQUIRED") {
    const allowed = fc.allowedFunctionNames;
    if (Array.isArray(allowed) && allowed.length === 1) return { type: "tool", name: allowed[0] };
    return { type: "any" };
  }
  if (fc.mode === "NONE") return { type: "none" };
  return undefined;
}

// Anthropic usage → the same token shape parseUsage produces. Claude has no
// separate "thinking tokens" counter the way Gemini does — thinking output (when
// enabled) is folded into output_tokens by Anthropic already, so thoughtTokens
// is always 0 here (priceText simply adds it to output, a no-op).
export function parseClaudeUsage(usage) {
  const u = usage || {};
  const inputTokens = Number(u.input_tokens) || 0;
  const outputTokens = Number(u.output_tokens) || 0;
  return { inputTokens, outputTokens, thoughtTokens: 0, totalTokens: inputTokens + outputTokens };
}

// Normalize an Anthropic Messages response into { text, functionCalls,
// finishReason, blockReason, usage }. stop_reason "max_tokens" maps to the same
// "MAX_TOKENS" sentinel runtime.js already checks for Gemini/OpenAI truncation.
// stop_reason "refusal" (safety-classifier decline — see stop_details.category)
// surfaces as a blockReason the way Gemini's SAFETY does, so runAgent's existing
// "response was filtered" handling covers Claude too with no runtime change.
export function parseClaudeResponse(json) {
  const blocks = json?.content || [];
  const functionCalls = [];
  let text = "";
  for (const block of blocks) {
    if (block?.type === "tool_use") {
      functionCalls.push({ name: block.name, args: block.input || {} });
    } else if (block?.type === "text" && typeof block.text === "string") {
      text += block.text;
    }
    // "thinking" blocks are intentionally not surfaced to callers.
  }
  const stopReason = json?.stop_reason || null;
  const finishReason = stopReason === "max_tokens" ? "MAX_TOKENS" : stopReason;
  const blockReason = stopReason === "refusal" ? (json?.stop_details?.category || "REFUSAL") : null;
  return { text, functionCalls, finishReason, blockReason, usage: parseClaudeUsage(json?.usage) };
}

// Bucket this app's legacy numeric thinkingBudget config onto Claude Sonnet
// 5's qualitative output_config.effort ("low"|"medium"|"high"|"xhigh"|"max") —
// {type:"enabled", budget_tokens:N} 400s on claude-sonnet-5 / claude-opus-4-8
// (the only two Claude models this app uses; "thinking.type.enabled is not
// supported for this model. Use thinking.type.adaptive and output_config.effort
// to control thinking behavior."), so effort is the closest lever left.
//
// Deliberately CONSERVATIVE: this app's stored thinkingBudget values are small
// Gemini-scale numbers (512-2048), never a request for deep reasoning. Claude's
// adaptive thinking has no token cap, and "high" (Anthropic's DEFAULT) will
// think for thousands of tokens on a large agentic prompt — enough to consume
// the whole output ceiling before the model ever emits a tool_use block. That
// is the scheduler's "0 scheduled, still billed" bug: high-effort thinking on
// the big schedule prompt truncated at step 0. So any modest budget maps to
// "low" (brief thinking, room left to act); only an unusually large explicit
// budget escalates. Pure/exported for tests.
export function effortFromThinkingBudget(thinkingBudget) {
  const n = Number(thinkingBudget) || 0;
  if (n >= 16384) return "high";
  if (n >= 4096) return "medium";
  return "low";
}

// A max_tokens ceiling sized for a non-thinking agent (2048-4096) leaves too
// little room once adaptive thinking is on: Sonnet 5 has no token cap on
// thinking spend (unlike the old budget_tokens model), so the model can burn
// the entire ceiling on reasoning and never reach a tool_use block — steps=0,
// "I ran out of room while writing that response", yet the thinking tokens are
// real and billed. Pair this generous floor with low effort (above) so each
// ReAct step has ample room to think briefly AND emit its tool call. It's only
// a ceiling, not a target — low effort keeps actual spend (and latency) small.
const MIN_MAX_TOKENS_WITH_THINKING = 16000;

// Production Anthropic client. Same generate() contract + retry/backoff policy
// as the Gemini/OpenAI clients, so the runtime and resolveLlm treat all three
// interchangeably. `max_tokens` is required by the Messages API (no server-side
// default). Sampling params (temperature/top_p/top_k) are intentionally never
// sent: Claude Sonnet 5 rejects non-default values and Opus 4.7/4.8 reject the
// fields outright (both return 400) — steer behaviour via prompting instead, per
// Anthropic's own migration guidance. `thinkingBudget > 0` opts into adaptive
// thinking (reusing the same per-agent config field Gemini's thinkingBudget
// uses) with an effort level derived from it; the default 0 keeps cost/latency
// predictable, matching this app's Gemini thinkingBudget:0 default.
export function createClaudeClient({ apiKey, model = DEFAULT_ANTHROPIC_MODEL, fetchImpl = globalThis.fetch, maxRetries = 3, baseDelayMs = 400 } = {}) {
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required for the Claude client");
  return {
    model,
    async generate({ system, contents, toolDeclarations, config = {} }) {
      const thinkingBudget = Number(config.thinkingBudget) || 0;
      let maxTokens = config.maxOutputTokens ?? 2048;
      const body = {
        model,
        messages: buildClaudeMessages({ contents }),
      };
      if (thinkingBudget > 0) {
        // "adaptive" is the ONLY on-mode Claude Sonnet 5 / Opus 4.7+ accept —
        // budget_tokens has no replacement cap, so effort is the only dial.
        body.thinking = { type: "adaptive" };
        body.output_config = { effort: effortFromThinkingBudget(thinkingBudget) };
        maxTokens = Math.max(maxTokens, MIN_MAX_TOKENS_WITH_THINKING);
      } else {
        body.thinking = { type: "disabled" };
      }
      body.max_tokens = maxTokens;
      if (system) body.system = system;
      const tools = buildClaudeTools(toolDeclarations);
      if (tools) body.tools = tools;
      const toolChoice = claudeToolChoiceFromConfig(config.toolConfig);
      if (toolChoice) body.tool_choice = toolChoice;

      let lastErr;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        let res;
        try {
          res = await fetchImpl(ANTHROPIC_MESSAGES_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": apiKey,
              "anthropic-version": ANTHROPIC_VERSION,
            },
            body: JSON.stringify(body),
          });
        } catch (e) {
          lastErr = e instanceof Error ? e : new Error(String(e));
          if (attempt < maxRetries) { await sleep(backoffMs(baseDelayMs, attempt)); continue; }
          throw lastErr;
        }
        if (res.ok) return parseClaudeResponse(await res.json());

        const detail = await res.text().catch(() => "");
        lastErr = new Error(`Claude ${res.status}: ${detail.slice(0, 500)}`);
        if (RETRYABLE_STATUSES.has(res.status) && attempt < maxRetries) {
          await sleep(backoffMs(baseDelayMs, attempt));
          continue;
        }
        throw lastErr;
      }
      throw lastErr || new Error("Claude request failed");
    },
  };
}
