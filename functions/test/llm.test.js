import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildGeminiRequest, parseGeminiResponse, createGeminiClient, DEFAULT_MODEL,
} from "../agents/llm.js";

test("default model avoids the 2.0-flash 404 gotcha", () => {
  assert.equal(DEFAULT_MODEL, "gemini-2.5-flash");
});

test("buildGeminiRequest disables thinking and sets system + tools", () => {
  const body = buildGeminiRequest({
    system: "You are a guide.",
    contents: [{ role: "user", parts: [{ text: "hi" }] }],
    toolDeclarations: [{ name: "t", description: "", parameters: { type: "object", properties: {} } }],
  });
  assert.equal(body.generationConfig.thinkingConfig.thinkingBudget, 0);
  assert.ok(body.generationConfig.maxOutputTokens >= 1024);
  assert.equal(body.systemInstruction.parts[0].text, "You are a guide.");
  assert.equal(body.tools[0].functionDeclarations[0].name, "t");
});

test("buildGeminiRequest passes through toolConfig for forced function calling", () => {
  const toolConfig = { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["save_content"] } };
  const body = buildGeminiRequest({
    system: "s",
    contents: [],
    toolDeclarations: [{ name: "save_content", parameters: { type: "object", properties: {} } }],
    config: { toolConfig },
  });
  assert.deepEqual(body.toolConfig, toolConfig);
});

test("buildGeminiRequest omits toolConfig when not requested", () => {
  const body = buildGeminiRequest({ system: "s", contents: [], toolDeclarations: [] });
  assert.equal(body.toolConfig, undefined);
});

test("parseGeminiResponse splits text and functionCalls", () => {
  const parsed = parseGeminiResponse({
    candidates: [{
      content: {
        parts: [
          { text: "Let me check. " },
          { functionCall: { name: "query_collection", args: { collection: "children" } } },
        ],
      },
    }],
  });
  assert.equal(parsed.text, "Let me check. ");
  assert.equal(parsed.functionCalls.length, 1);
  assert.equal(parsed.functionCalls[0].name, "query_collection");
  assert.deepEqual(parsed.functionCalls[0].args, { collection: "children" });
});

test("createGeminiClient requires an api key", () => {
  assert.throws(() => createGeminiClient({}), /GEMINI_API_KEY/);
});

test("createGeminiClient posts and parses via injected fetch", async () => {
  let captured;
  const fakeFetch = async (url, opts) => {
    captured = { url, opts };
    return {
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: "hello" }] } }] }),
    };
  };
  const client = createGeminiClient({ apiKey: "k", fetchImpl: fakeFetch });
  const res = await client.generate({ system: "s", contents: [], toolDeclarations: [] });
  assert.equal(res.text, "hello");
  assert.match(captured.url, /gemini-2\.5-flash:generateContent/);
  assert.equal(captured.opts.headers["x-goog-api-key"], "k");
});

test("createGeminiClient surfaces API errors", async () => {
  const fakeFetch = async () => ({ ok: false, status: 404, text: async () => "not found" });
  const client = createGeminiClient({ apiKey: "k", fetchImpl: fakeFetch });
  await assert.rejects(() => client.generate({ contents: [] }), /Gemini 404/);
});

test("createGeminiClient does NOT retry non-retryable 4xx", async () => {
  let calls = 0;
  const fakeFetch = async () => { calls++; return { ok: false, status: 400, text: async () => "bad" }; };
  const client = createGeminiClient({ apiKey: "k", fetchImpl: fakeFetch, baseDelayMs: 1 });
  await assert.rejects(() => client.generate({ contents: [] }), /Gemini 400/);
  assert.equal(calls, 1);
});

test("createGeminiClient retries transient 503 then succeeds", async () => {
  let calls = 0;
  const fakeFetch = async () => {
    calls++;
    if (calls < 3) return { ok: false, status: 503, text: async () => "unavailable" };
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }) };
  };
  const client = createGeminiClient({ apiKey: "k", fetchImpl: fakeFetch, baseDelayMs: 1 });
  const res = await client.generate({ contents: [] });
  assert.equal(res.text, "ok");
  assert.equal(calls, 3);
});

test("createGeminiClient retries network errors up to the cap then throws", async () => {
  let calls = 0;
  const fakeFetch = async () => { calls++; throw new Error("ECONNRESET"); };
  const client = createGeminiClient({ apiKey: "k", fetchImpl: fakeFetch, maxRetries: 2, baseDelayMs: 1 });
  await assert.rejects(() => client.generate({ contents: [] }), /ECONNRESET/);
  assert.equal(calls, 3); // initial + 2 retries
});

test("parseGeminiResponse surfaces a prompt safety block", () => {
  const parsed = parseGeminiResponse({ promptFeedback: { blockReason: "SAFETY" } });
  assert.equal(parsed.blockReason, "SAFETY");
  assert.equal(parsed.text, "");
});

test("parseGeminiResponse flags a missing candidate", () => {
  const parsed = parseGeminiResponse({});
  assert.equal(parsed.blockReason, "NO_CANDIDATE");
});

test("parseGeminiResponse flags a SAFETY finishReason with no content", () => {
  const parsed = parseGeminiResponse({ candidates: [{ finishReason: "SAFETY", content: { parts: [] } }] });
  assert.equal(parsed.blockReason, "SAFETY");
});
