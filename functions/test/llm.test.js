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
