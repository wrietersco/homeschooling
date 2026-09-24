import { test } from "node:test";
import assert from "node:assert/strict";
import {
  geminiThinkingConfig, buildGeminiRequest, parseGeminiResponse,
  usesResponsesApi, openAiReasoningEffort, buildOpenAiResponsesInput, buildOpenAiResponsesTools,
  responsesToolChoiceFromConfig, buildOpenAiResponsesRequest, parseOpenAiResponsesResponse, parseOpenAiResponsesUsage,
  createOpenAiClient,
} from "../agents/llm.js";
import { runAgent } from "../agents/runtime.js";
import { isOpenAiImageModel, imageApiKeyFor, geminiImageConfig, callImageModel, DEFAULT_IMAGE_MODEL } from "../agents/imageGen.js";
import { effectiveRate, priceText, priceImage, priceTts, DEFAULT_PRICING } from "../lib/costMeter.js";
import { mergeAgentConfig, AGENT_DEFAULTS } from "../agents/agentConfig.js";
import { MODEL_CATALOG, RETIRED_MODELS, replacementForRetired } from "../agents/modelCatalog.js";

// ── Gemini 3.x: thinking settings ───────────────────────────────────────────────
test("thinking-required Gemini models never get a zero thinking budget (HTTP 400 otherwise)", () => {
  for (const m of ["gemini-2.5-pro", "gemini-3.1-pro-preview", "gemini-3.5-flash-lite"]) {
    assert.equal(geminiThinkingConfig(m, 0), undefined, m);
    assert.equal(buildGeminiRequest({ contents: [], config: { thinkingBudget: 0 }, model: m }).generationConfig.thinkingConfig, undefined, m);
  }
  // An explicit positive budget is always honoured, on any model.
  assert.deepEqual(geminiThinkingConfig("gemini-3.1-pro-preview", 512), { thinkingBudget: 512 });
});

test("other Gemini models keep the explicit thinking-off budget", () => {
  for (const m of ["gemini-2.5-flash", "gemini-3.8-flash", "gemini-3.1-flash-lite", "gemini-2.5-flash-lite", undefined]) {
    assert.deepEqual(geminiThinkingConfig(m, 0), { thinkingBudget: 0 }, String(m));
  }
  assert.deepEqual(buildGeminiRequest({ contents: [] }).generationConfig.thinkingConfig, { thinkingBudget: 0 }); // unchanged default
});

// ── Gemini 3.x: thought signatures survive the tool loop ────────────────────────
test("parseGeminiResponse keeps a functionCall thoughtSignature", () => {
  const r = parseGeminiResponse({
    candidates: [{ content: { parts: [{ functionCall: { name: "get_weather", args: { city: "Lahore" } }, thoughtSignature: "SIG123" }] } }],
  });
  assert.deepEqual(r.functionCalls, [{ name: "get_weather", args: { city: "Lahore" }, thoughtSignature: "SIG123" }]);
  // no signature -> no field (older models unchanged)
  const plain = parseGeminiResponse({ candidates: [{ content: { parts: [{ functionCall: { name: "x", args: {} } }] } }] });
  assert.deepEqual(plain.functionCalls, [{ name: "x", args: {} }]);
});

test("runAgent echoes the thoughtSignature on the PART, beside functionCall (Gemini 3.x rejects the next turn otherwise)", async () => {
  const seen = [];
  let call = 0;
  const llm = {
    async generate({ contents }) {
      seen.push(JSON.parse(JSON.stringify(contents)));
      if (call++ === 0) return { text: "", functionCalls: [{ name: "lookup", args: { q: 1 }, thoughtSignature: "SIG-ABC" }], finishReason: "STOP" };
      return { text: "done", functionCalls: [], finishReason: "STOP" };
    },
  };
  const out = await runAgent({ llm, system: "s", toolDeclarations: [], tools: { lookup: async () => ({ ok: true }) }, userMessage: "hi" });
  assert.equal(out.text, "done");
  const modelTurn = seen[1].find((t) => t.role === "model");
  assert.deepEqual(modelTurn.parts, [{ functionCall: { name: "lookup", args: { q: 1 } }, thoughtSignature: "SIG-ABC" }]);
});

// ── OpenAI: routing + Responses API translation ─────────────────────────────────
test("usesResponsesApi: the newest reasoning models go to /v1/responses, older chat models do not", () => {
  for (const m of ["gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5"]) assert.ok(usesResponsesApi(m), m);
  for (const m of ["gpt-4o-mini", "gpt-4o", "gpt-4.1", "gpt-4.1-mini", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano", "claude-sonnet-5", ""]) assert.ok(!usesResponsesApi(m), m);
});

test("openAiReasoningEffort: thinking off is none where offered and low for GPT-6; budgets map to tiers", () => {
  assert.equal(openAiReasoningEffort("gpt-5.6-luna", 0), "none");
  assert.equal(openAiReasoningEffort("gpt-6-astra", 0), "low"); // Astra has no "none"
  assert.equal(openAiReasoningEffort("gpt-5.6-sol", 1024), "low");
  assert.equal(openAiReasoningEffort("gpt-5.6-sol", 4096), "medium");
  assert.equal(openAiReasoningEffort("gpt-5.6-sol", 20000), "high");
});

test("buildOpenAiResponsesInput maps text, function calls and results with FIFO call ids", () => {
  const input = buildOpenAiResponsesInput({
    contents: [
      { role: "user", parts: [{ text: "weather?" }] },
      { role: "model", parts: [{ text: "checking" }, { functionCall: { name: "get_weather", args: { city: "Lahore" } } }, { functionCall: { name: "get_time", args: {} } }] },
      { role: "user", parts: [{ functionResponse: { name: "get_weather", response: { result: { c: 31 } } } }, { functionResponse: { name: "get_time", response: { result: "noon" } } }] },
      { role: "model", parts: [{ text: "31 and sunny" }] },
    ],
  });
  assert.deepEqual(input, [
    { role: "user", content: "weather?" },
    { role: "assistant", content: "checking" },
    { type: "function_call", call_id: "call_0", name: "get_weather", arguments: '{"city":"Lahore"}' },
    { type: "function_call", call_id: "call_1", name: "get_time", arguments: "{}" },
    { type: "function_call_output", call_id: "call_0", output: '{"c":31}' },
    { type: "function_call_output", call_id: "call_1", output: "noon" },
    { role: "assistant", content: "31 and sunny" },
  ]);
});

test("buildOpenAiResponsesRequest: no temperature, flat tools, instructions, reasoning effort, store:false", () => {
  const body = buildOpenAiResponsesRequest({
    model: "gpt-5.6-luna", system: "Be brief.", contents: [{ role: "user", parts: [{ text: "hi" }] }],
    toolDeclarations: [{ name: "t", description: "d", parameters: { type: "object", properties: { a: { type: "string" } } } }],
    config: { temperature: 0.4, maxOutputTokens: 1234, thinkingBudget: 0, toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["t"] } } },
  });
  assert.equal("temperature" in body, false);
  assert.equal(body.instructions, "Be brief.");
  assert.equal(body.max_output_tokens, 1234);
  assert.deepEqual(body.reasoning, { effort: "none" });
  assert.equal(body.store, false);
  assert.deepEqual(body.tools, [{ type: "function", name: "t", description: "d", parameters: { type: "object", properties: { a: { type: "string" } } } }]);
  assert.deepEqual(body.tool_choice, { type: "function", name: "t" });
  assert.equal(buildOpenAiResponsesTools(undefined), undefined);
  assert.equal(responsesToolChoiceFromConfig({ functionCallingConfig: { mode: "ANY" } }), "required");
  assert.equal(responsesToolChoiceFromConfig({ functionCallingConfig: { mode: "NONE" } }), "none");
});

test("parseOpenAiResponsesResponse: text, function calls, usage split, truncation, refusal", () => {
  const ok = parseOpenAiResponsesResponse({
    status: "completed",
    output: [
      { type: "reasoning", summary: [] },
      { type: "message", content: [{ type: "output_text", text: "Hello " }, { type: "output_text", text: "there" }] },
      { type: "function_call", name: "get_weather", arguments: '{"city":"Lahore"}', call_id: "c1" },
    ],
    usage: { input_tokens: 45, output_tokens: 30, total_tokens: 75, output_tokens_details: { reasoning_tokens: 10 } },
  });
  assert.equal(ok.text, "Hello there");
  assert.deepEqual(ok.functionCalls, [{ name: "get_weather", args: { city: "Lahore" } }]);
  assert.equal(ok.finishReason, "STOP");
  assert.deepEqual(ok.usage, { inputTokens: 45, outputTokens: 20, thoughtTokens: 10, totalTokens: 75 }); // reasoning split out of output

  const cut = parseOpenAiResponsesResponse({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [] });
  assert.equal(cut.finishReason, "MAX_TOKENS");
  const refused = parseOpenAiResponsesResponse({ status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }] });
  assert.equal(refused.blockReason, "SAFETY");
  const badArgs = parseOpenAiResponsesResponse({ output: [{ type: "function_call", name: "x", arguments: "{oops" }] });
  assert.deepEqual(badArgs.functionCalls, [{ name: "x", args: {} }]);
  assert.deepEqual(parseOpenAiResponsesUsage(undefined), { inputTokens: 0, outputTokens: 0, thoughtTokens: 0, totalTokens: 0 });
});

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    return handler({ url, body, n: calls.length });
  };
  fn.calls = calls;
  return fn;
}
const jsonRes = (obj, status = 200) => ({ ok: status < 400, status, json: async () => obj, text: async () => JSON.stringify(obj) });

test("createOpenAiClient sends GPT-6 Astra to /v1/responses and GPT-4o mini to /v1/chat/completions", async () => {
  const f1 = fakeFetch(() => jsonRes({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "pong" }] }], usage: { input_tokens: 1, output_tokens: 1 } }));
  const astra = createOpenAiClient({ apiKey: "k", model: "gpt-6-astra", fetchImpl: f1 });
  const r = await astra.generate({ system: "s", contents: [{ role: "user", parts: [{ text: "ping" }] }], config: { temperature: 0.4 } });
  assert.equal(r.text, "pong");
  assert.equal(f1.calls[0].url, "https://api.openai.com/v1/responses");
  assert.equal("temperature" in f1.calls[0].body, false);

  const f2 = fakeFetch(() => jsonRes({ choices: [{ message: { content: "pong" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
  const mini = createOpenAiClient({ apiKey: "k", model: "gpt-4o-mini", fetchImpl: f2 });
  await mini.generate({ system: "s", contents: [{ role: "user", parts: [{ text: "ping" }] }], config: { temperature: 0.4 } });
  assert.equal(f2.calls[0].url, "https://api.openai.com/v1/chat/completions");
  assert.equal(f2.calls[0].body.temperature, 0.4);
});

test("chat models that reject a custom temperature are retried once without it", async () => {
  const f = fakeFetch(({ n }) =>
    n === 1
      ? jsonRes({ error: { message: "Unsupported value: 'temperature' does not support 0.4 with this model." } }, 400)
      : jsonRes({ choices: [{ message: { content: "pong" }, finish_reason: "stop" }], usage: {} }));
  const c = createOpenAiClient({ apiKey: "k", model: "gpt-5-mini", fetchImpl: f, maxRetries: 0 });
  const r = await c.generate({ system: "s", contents: [{ role: "user", parts: [{ text: "ping" }] }], config: { temperature: 0.4 } });
  assert.equal(r.text, "pong");
  assert.equal(f.calls.length, 2);
  assert.equal("temperature" in f.calls[0].body, true);
  assert.equal("temperature" in f.calls[1].body, false);
});

test("an unrelated 400 is not retried as a temperature problem", async () => {
  const f = fakeFetch(() => jsonRes({ error: { message: "bad tools schema" } }, 400));
  const c = createOpenAiClient({ apiKey: "k", model: "gpt-4o-mini", fetchImpl: f, maxRetries: 0 });
  await assert.rejects(() => c.generate({ system: "s", contents: [{ role: "user", parts: [{ text: "x" }] }] }), /OpenAI 400/);
  assert.equal(f.calls.length, 1);
});

// ── Images ──────────────────────────────────────────────────────────────────────
test("image model routing: provider key, OpenAI detection, square Gemini 3.x config", () => {
  assert.equal(DEFAULT_IMAGE_MODEL, "gemini-3.1-flash-image");
  assert.equal(AGENT_DEFAULTS.image.model, "gemini-3.1-flash-image");
  assert.ok(isOpenAiImageModel("gpt-image-2.5-flare") && isOpenAiImageModel("chatgpt-image-latest"));
  assert.ok(!isOpenAiImageModel("gemini-3.1-flash-image") && !isOpenAiImageModel("imagen-4.0-generate-001"));
  const keys = { geminiApiKey: "G", openaiApiKey: "O" };
  assert.equal(imageApiKeyFor("gemini-3.1-flash-image", keys), "G");
  assert.equal(imageApiKeyFor("gpt-image-2.5-sunburst", keys), "O");
  assert.equal(imageApiKeyFor("gpt-image-2.5-sunburst", { geminiApiKey: "G" }), ""); // no OpenAI key -> skip images
  assert.deepEqual(geminiImageConfig("gemini-3.1-flash-image"), { imageConfig: { aspectRatio: "1:1" } });
  assert.deepEqual(geminiImageConfig("gemini-3-pro-image"), { imageConfig: { aspectRatio: "1:1" } });
  assert.deepEqual(geminiImageConfig("gemini-2.5-flash-image"), {});
});

test("callImageModel: Gemini 3 asks for 1:1; OpenAI uses the images API and returns b64", async () => {
  const gem = fakeFetch(() => jsonRes({ candidates: [{ content: { parts: [{ inlineData: { data: "QUJD", mimeType: "image/jpeg" } }] } }] }));
  const g = await callImageModel({ model: "gemini-3.1-flash-image", prompt: "a cat", apiKey: "G", fetchImpl: gem });
  assert.deepEqual(g, { data: "QUJD", mime: "image/jpeg" });
  assert.match(gem.calls[0].url, /models\/gemini-3\.1-flash-image:generateContent$/);
  assert.deepEqual(gem.calls[0].body.generationConfig, { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "1:1" } });

  const old = fakeFetch(() => jsonRes({ candidates: [{ content: { parts: [{ inlineData: { data: "QQ==" } }] } }] }));
  await callImageModel({ model: "gemini-2.5-flash-image", prompt: "x", apiKey: "G", fetchImpl: old });
  assert.deepEqual(old.calls[0].body.generationConfig, { responseModalities: ["IMAGE"] });

  const oai = fakeFetch(() => jsonRes({ data: [{ b64_json: "UE5H" }] }));
  const o = await callImageModel({ model: "gpt-image-2.5-flare", prompt: "a cat", apiKey: "O", fetchImpl: oai });
  assert.deepEqual(o, { data: "UE5H", mime: "image/png" });
  assert.equal(oai.calls[0].url, "https://api.openai.com/v1/images/generations");
  assert.deepEqual(oai.calls[0].body, { model: "gpt-image-2.5-flare", prompt: "a cat", size: "1024x1024", n: 1 });

  const failing = fakeFetch(() => ({ ok: false, status: 500, text: async () => "boom", json: async () => ({}) }));
  assert.equal(await callImageModel({ model: "gpt-image-2.5-flare", prompt: "x", apiKey: "O", fetchImpl: failing }), null);
});

// ── Cost meter ──────────────────────────────────────────────────────────────────
test("Gemini 3.8 Flash bills the intro price through 2026-12-31 and the doubled price from 2027-01-01", () => {
  const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000 };
  assert.equal(priceText({ model: "gemini-3.8-flash", usage, now: new Date("2026-12-31T23:59:59Z") }).costUsd, 0.75 + 3.75);
  assert.equal(priceText({ model: "gemini-3.8-flash", usage, now: new Date("2027-01-01T00:00:00Z") }).costUsd, 1.5 + 7.5);
  assert.equal(priceText({ model: "gemini-3.5-flash", usage, now: new Date("2027-06-01") }).costUsd, 1.5 + 9); // no date on 3.5: unchanged
  assert.equal(effectiveRate(undefined), undefined);
});

test("the new models are metered at their published rates", () => {
  const per = (model, i, o) => priceText({ model, usage: { inputTokens: i, outputTokens: o } }).costUsd;
  assert.equal(per("gpt-6-astra", 1e6, 1e6), 60);
  assert.equal(per("gpt-5.6-sol", 1e6, 1e6), 24);
  assert.equal(per("gpt-5.6-terra", 1e6, 1e6), 14);
  assert.equal(per("gpt-5.6-luna", 1e6, 1e6), 1.4);
  assert.equal(per("gemini-3.1-flash-lite", 1e6, 1e6), 1.75);
  assert.equal(per("gemini-3.1-pro-preview", 1e6, 1e6), 14);
  // reasoning tokens are billed as output
  assert.equal(priceText({ model: "gpt-5.6-luna", usage: { inputTokens: 0, outputTokens: 500_000, thoughtTokens: 500_000 } }).costUsd, 1.2);
  assert.equal(priceImage({ model: "gemini-3.1-flash-image", usage: { images: 10 } }).costUsd, 0.67);
  assert.equal(priceImage({ model: "gemini-3.1-flash-lite-image", usage: { images: 1 } }).costUsd, 0.0336);
  assert.equal(priceImage({ model: "gemini-3-pro-image", usage: { images: 1 } }).costUsd, 0.134);
  assert.equal(priceImage({ model: "gpt-image-2.5-flare", usage: { images: 100 } }).costUsd, 0.6);
  assert.equal(priceTts({ model: "gemini-3.1-flash-tts-preview", usage: { inputTokens: 1e6, outputTokens: 1e6 } }).costUsd, 21);
});

test("dated catalog prices agree with the meter's dated rates", () => {
  for (const m of MODEL_CATALOG.text) {
    const r = DEFAULT_PRICING.text[m.id];
    assert.equal(!!m.price.until, !!r.until, `${m.id} until`);
    if (m.price.until) {
      assert.equal(m.price.until, r.until);
      assert.equal(m.price.then.in, r.then.input);
      assert.equal(m.price.then.out, r.then.output);
    }
  }
});

// ── Retired-model replacement ───────────────────────────────────────────────────
test("a saved retired model resolves to its replacement so calls never 404", () => {
  const cfgFor = (agent, model, now) => mergeAgentConfig({ default: {}, agents: { [agent]: { model } } }, agent, now);
  // already dead -> replaced immediately
  assert.equal(cfgFor("guide", "gemini-2.0-flash").model, "gemini-2.5-flash");
  assert.equal(cfgFor("image", "imagen-4.0-generate-001").model, "gemini-3.1-flash-image");
  assert.equal(cfgFor("image", "imagen-4.0-ultra-generate-001").model, "gemini-3-pro-image");
  // deprecating -> replaced on/after its shutdown date only
  assert.equal(cfgFor("image", "gemini-2.5-flash-image", new Date("2026-10-01T12:00:00Z")).model, "gemini-2.5-flash-image");
  assert.equal(cfgFor("image", "gemini-2.5-flash-image", new Date("2026-10-02T00:00:01Z")).model, "gemini-3.1-flash-image");
  // healthy models untouched
  assert.equal(cfgFor("guide", "gemini-3.8-flash").model, "gemini-3.8-flash");
  assert.equal(replacementForRetired("gpt-5.6-luna"), null);
  // every replacement is a real, healthy catalog model
  const all = [...MODEL_CATALOG.text, ...MODEL_CATALOG.tts, ...MODEL_CATALOG.image];
  for (const [id, r] of Object.entries(RETIRED_MODELS)) {
    const target = all.find((m) => m.id === r.replacement);
    assert.ok(target, `${id} -> ${r.replacement} must be in the catalog`);
    assert.equal(target.availability.state, "ok", `${r.replacement} must be healthy`);
  }
});

test("the new models are catalogued with provider, price and healthy availability", () => {
  const ids = (k) => MODEL_CATALOG[k].map((m) => m.id);
  for (const id of ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.1-pro-preview",
    "gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano"]) {
    const m = MODEL_CATALOG.text.find((x) => x.id === id);
    assert.ok(m, id);
    assert.ok(["gemini", "openai"].includes(m.provider), id);
    assert.equal(m.availability.state, "ok", id);
    assert.ok(m.price.in > 0 && m.price.out > 0, id);
  }
  assert.ok(ids("tts").includes("gemini-3.1-flash-tts-preview"));
  for (const id of ["gemini-3.1-flash-image", "gemini-3.1-flash-lite-image", "gemini-3-pro-image", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]) assert.ok(ids("image").includes(id), id);
  // exactly one recommended model in the groups where a default is suggested
  assert.equal(MODEL_CATALOG.image.filter((m) => m.recommended).length, 1);
  assert.equal(MODEL_CATALOG.text.filter((m) => m.provider === "openai" && m.recommended).length, 1);
});
