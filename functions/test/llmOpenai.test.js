import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildOpenAiMessages,
  buildOpenAiTools,
  toolChoiceFromConfig,
  parseOpenAiUsage,
  parseOpenAiResponse,
  createOpenAiClient,
} from "../agents/llm.js";

// ─── Request translation: Gemini contents → OpenAI messages ────────────────────

test("buildOpenAiMessages maps a system prompt + plain user turn", () => {
  const messages = buildOpenAiMessages({
    system: "You are helpful.",
    contents: [{ role: "user", parts: [{ text: "Hi" }] }],
  });
  assert.deepEqual(messages, [
    { role: "system", content: "You are helpful." },
    { role: "user", content: "Hi" },
  ]);
});

test("buildOpenAiMessages turns a model functionCall turn into assistant tool_calls", () => {
  const messages = buildOpenAiMessages({
    contents: [
      { role: "user", parts: [{ text: "schedule it" }] },
      { role: "model", parts: [{ functionCall: { name: "schedule_block", args: { dateKey: "2026-06-22" } } }] },
    ],
  });
  const asst = messages[1];
  assert.equal(asst.role, "assistant");
  assert.equal(asst.tool_calls.length, 1);
  assert.equal(asst.tool_calls[0].type, "function");
  assert.equal(asst.tool_calls[0].function.name, "schedule_block");
  assert.deepEqual(JSON.parse(asst.tool_calls[0].function.arguments), { dateKey: "2026-06-22" });
});

test("buildOpenAiMessages pairs a functionResponse with the preceding call's id (FIFO)", () => {
  // The runtime emits the function responses in the SAME order as the calls, so the
  // tool message must carry the matching synthesized tool_call_id.
  const messages = buildOpenAiMessages({
    contents: [
      { role: "user", parts: [{ text: "go" }] },
      { role: "model", parts: [
        { functionCall: { name: "a", args: {} } },
        { functionCall: { name: "b", args: {} } },
      ] },
      { role: "user", parts: [
        { functionResponse: { name: "a", response: { result: { ok: true } } } },
        { functionResponse: { name: "b", response: { result: { error: "nope" } } } },
      ] },
    ],
  });
  const asst = messages[1];
  const toolA = messages[2];
  const toolB = messages[3];
  assert.equal(toolA.role, "tool");
  assert.equal(toolB.role, "tool");
  // Ids line up positionally with the assistant's tool_calls.
  assert.equal(toolA.tool_call_id, asst.tool_calls[0].id);
  assert.equal(toolB.tool_call_id, asst.tool_calls[1].id);
  assert.deepEqual(JSON.parse(toolA.content), { ok: true });
  assert.deepEqual(JSON.parse(toolB.content), { error: "nope" });
});

test("buildOpenAiTools maps function declarations to OpenAI tool shape", () => {
  const tools = buildOpenAiTools([
    { name: "schedule_block", description: "Place a block", parameters: { type: "object", properties: { dateKey: { type: "string" } } } },
  ]);
  assert.equal(tools[0].type, "function");
  assert.equal(tools[0].function.name, "schedule_block");
  assert.equal(tools[0].function.description, "Place a block");
  assert.deepEqual(tools[0].function.parameters.properties.dateKey, { type: "string" });
});

test("buildOpenAiTools returns undefined when there are no declarations", () => {
  assert.equal(buildOpenAiTools(), undefined);
  assert.equal(buildOpenAiTools([]), undefined);
});

test("toolChoiceFromConfig mirrors Gemini forced-mode config", () => {
  assert.equal(toolChoiceFromConfig(null), undefined);
  assert.equal(toolChoiceFromConfig({ functionCallingConfig: { mode: "ANY" } }), "required");
  assert.deepEqual(
    toolChoiceFromConfig({ functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["save"] } }),
    { type: "function", function: { name: "save" } },
  );
  assert.equal(toolChoiceFromConfig({ functionCallingConfig: { mode: "NONE" } }), "none");
});

// ─── Response translation: OpenAI completion → runtime contract ────────────────

test("parseOpenAiResponse extracts text + usage", () => {
  const r = parseOpenAiResponse({
    choices: [{ message: { content: "Done." }, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
  });
  assert.equal(r.text, "Done.");
  assert.equal(r.functionCalls.length, 0);
  assert.equal(r.finishReason, "stop");
  assert.equal(r.blockReason, null);
  assert.deepEqual(r.usage, { inputTokens: 10, outputTokens: 4, thoughtTokens: 0, totalTokens: 14 });
});

test("parseOpenAiResponse extracts tool calls with parsed args", () => {
  const r = parseOpenAiResponse({
    choices: [{
      message: { content: null, tool_calls: [
        { id: "call_0", type: "function", function: { name: "schedule_block", arguments: '{"dateKey":"2026-06-22","scheduledTime":"09:00"}' } },
      ] },
      finish_reason: "tool_calls",
    }],
  });
  assert.equal(r.functionCalls.length, 1);
  assert.equal(r.functionCalls[0].name, "schedule_block");
  assert.deepEqual(r.functionCalls[0].args, { dateKey: "2026-06-22", scheduledTime: "09:00" });
});

test("parseOpenAiResponse maps length → MAX_TOKENS and content_filter → block", () => {
  assert.equal(parseOpenAiResponse({ choices: [{ message: {}, finish_reason: "length" }] }).finishReason, "MAX_TOKENS");
  const blocked = parseOpenAiResponse({ choices: [{ message: {}, finish_reason: "content_filter" }] });
  assert.equal(blocked.blockReason, "SAFETY");
});

test("parseOpenAiResponse tolerates malformed tool arguments", () => {
  const r = parseOpenAiResponse({
    choices: [{ message: { tool_calls: [{ type: "function", function: { name: "x", arguments: "{not json" } }] }, finish_reason: "tool_calls" }],
  });
  assert.deepEqual(r.functionCalls[0].args, {}); // partial blob → no args, not a throw
});

test("parseOpenAiUsage counts reasoning tokens as thoughtTokens", () => {
  const u = parseOpenAiUsage({ prompt_tokens: 5, completion_tokens: 20, completion_tokens_details: { reasoning_tokens: 12 }, total_tokens: 25 });
  assert.deepEqual(u, { inputTokens: 5, outputTokens: 20, thoughtTokens: 12, totalTokens: 25 });
});

// ─── Client transport (injected fetch) ─────────────────────────────────────────

test("createOpenAiClient.generate posts to the chat endpoint and parses a tool call", async () => {
  let captured = null;
  const fetchImpl = async (url, opts) => {
    captured = { url, body: JSON.parse(opts.body), headers: opts.headers };
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { tool_calls: [{ id: "c0", type: "function", function: { name: "schedule_block", arguments: "{}" } }] }, finish_reason: "tool_calls" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    };
  };
  const client = createOpenAiClient({ apiKey: "sk-test", model: "gpt-4o-mini", fetchImpl });
  const res = await client.generate({
    system: "sys",
    contents: [{ role: "user", parts: [{ text: "go" }] }],
    toolDeclarations: [{ name: "schedule_block", description: "d", parameters: { type: "object", properties: {} } }],
    config: { temperature: 0.3, maxOutputTokens: 512 },
  });
  assert.equal(captured.url, "https://api.openai.com/v1/chat/completions");
  assert.equal(captured.headers.Authorization, "Bearer sk-test");
  assert.equal(captured.body.model, "gpt-4o-mini");
  assert.equal(captured.body.temperature, 0.3);
  assert.equal(captured.body.max_completion_tokens, 512);
  assert.equal(captured.body.tools[0].function.name, "schedule_block");
  assert.equal(res.functionCalls[0].name, "schedule_block");
});

test("createOpenAiClient.generate retries a 500 then succeeds", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    if (calls === 1) return { ok: false, status: 500, text: async () => "server error" };
    return { ok: true, json: async () => ({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }) };
  };
  const client = createOpenAiClient({ apiKey: "sk", model: "gpt-4o-mini", fetchImpl, baseDelayMs: 1 });
  const res = await client.generate({ system: "", contents: [{ role: "user", parts: [{ text: "hi" }] }] });
  assert.equal(calls, 2);
  assert.equal(res.text, "ok");
});

test("createOpenAiClient.generate throws a labeled error on a non-retryable 400", async () => {
  const fetchImpl = async () => ({ ok: false, status: 400, text: async () => "bad model" });
  const client = createOpenAiClient({ apiKey: "sk", model: "nope", fetchImpl });
  await assert.rejects(
    () => client.generate({ system: "", contents: [{ role: "user", parts: [{ text: "hi" }] }] }),
    /OpenAI 400: bad model/,
  );
});
