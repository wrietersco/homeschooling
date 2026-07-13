import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildClaudeMessages,
  buildClaudeTools,
  claudeToolChoiceFromConfig,
  parseClaudeUsage,
  parseClaudeResponse,
  createClaudeClient,
  effortFromThinkingBudget,
} from "../agents/llm.js";

// ─── Request translation: Gemini contents → Anthropic messages ─────────────────

test("buildClaudeMessages maps a plain user turn to a text message", () => {
  const messages = buildClaudeMessages({
    contents: [{ role: "user", parts: [{ text: "Hi" }] }],
  });
  assert.deepEqual(messages, [{ role: "user", content: "Hi" }]);
});

test("buildClaudeMessages turns a model functionCall turn into an assistant tool_use block", () => {
  const messages = buildClaudeMessages({
    contents: [
      { role: "user", parts: [{ text: "schedule it" }] },
      { role: "model", parts: [{ functionCall: { name: "schedule_block", args: { dateKey: "2026-06-22" } } }] },
    ],
  });
  const asst = messages[1];
  assert.equal(asst.role, "assistant");
  assert.equal(asst.content.length, 1);
  assert.equal(asst.content[0].type, "tool_use");
  assert.equal(asst.content[0].name, "schedule_block");
  assert.deepEqual(asst.content[0].input, { dateKey: "2026-06-22" });
});

test("buildClaudeMessages pairs a functionResponse with the preceding call's tool_use id (FIFO)", () => {
  const messages = buildClaudeMessages({
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
  const toolMsg = messages[2];
  assert.equal(toolMsg.role, "user");
  assert.equal(toolMsg.content.length, 2);
  assert.equal(toolMsg.content[0].type, "tool_result");
  // Ids line up positionally with the assistant's tool_use blocks.
  assert.equal(toolMsg.content[0].tool_use_id, asst.content[0].id);
  assert.equal(toolMsg.content[1].tool_use_id, asst.content[1].id);
  assert.deepEqual(JSON.parse(toolMsg.content[0].content), { ok: true });
  assert.deepEqual(JSON.parse(toolMsg.content[1].content), { error: "nope" });
});

test("buildClaudeTools maps function declarations to Anthropic input_schema shape", () => {
  const tools = buildClaudeTools([
    { name: "schedule_block", description: "Place a block", parameters: { type: "object", properties: { dateKey: { type: "string" } } } },
  ]);
  assert.equal(tools[0].name, "schedule_block");
  assert.equal(tools[0].description, "Place a block");
  assert.deepEqual(tools[0].input_schema.properties.dateKey, { type: "string" });
});

test("buildClaudeTools returns undefined when there are no declarations", () => {
  assert.equal(buildClaudeTools(), undefined);
  assert.equal(buildClaudeTools([]), undefined);
});

test("claudeToolChoiceFromConfig mirrors Gemini forced-mode config", () => {
  assert.equal(claudeToolChoiceFromConfig(null), undefined);
  assert.deepEqual(claudeToolChoiceFromConfig({ functionCallingConfig: { mode: "ANY" } }), { type: "any" });
  assert.deepEqual(
    claudeToolChoiceFromConfig({ functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["save"] } }),
    { type: "tool", name: "save" },
  );
  assert.deepEqual(claudeToolChoiceFromConfig({ functionCallingConfig: { mode: "NONE" } }), { type: "none" });
});

// ─── Response translation: Anthropic message → runtime contract ───────────────

test("parseClaudeResponse extracts text + usage", () => {
  const r = parseClaudeResponse({
    content: [{ type: "text", text: "Done." }],
    stop_reason: "end_turn",
    usage: { input_tokens: 10, output_tokens: 4 },
  });
  assert.equal(r.text, "Done.");
  assert.equal(r.functionCalls.length, 0);
  assert.equal(r.finishReason, "end_turn");
  assert.equal(r.blockReason, null);
  assert.deepEqual(r.usage, { inputTokens: 10, outputTokens: 4, thoughtTokens: 0, totalTokens: 14 });
});

test("parseClaudeResponse extracts tool_use blocks as function calls", () => {
  const r = parseClaudeResponse({
    content: [{ type: "tool_use", id: "toolu_1", name: "schedule_block", input: { dateKey: "2026-06-22", scheduledTime: "09:00" } }],
    stop_reason: "tool_use",
  });
  assert.equal(r.functionCalls.length, 1);
  assert.equal(r.functionCalls[0].name, "schedule_block");
  assert.deepEqual(r.functionCalls[0].args, { dateKey: "2026-06-22", scheduledTime: "09:00" });
});

test("parseClaudeResponse maps max_tokens → MAX_TOKENS and refusal → blockReason", () => {
  assert.equal(parseClaudeResponse({ content: [], stop_reason: "max_tokens" }).finishReason, "MAX_TOKENS");
  const refused = parseClaudeResponse({ content: [], stop_reason: "refusal", stop_details: { category: "cyber" } });
  assert.equal(refused.blockReason, "cyber");
});

test("parseClaudeResponse ignores thinking blocks", () => {
  const r = parseClaudeResponse({
    content: [{ type: "thinking", thinking: "internal reasoning" }, { type: "text", text: "Answer." }],
    stop_reason: "end_turn",
  });
  assert.equal(r.text, "Answer.");
});

test("parseClaudeUsage folds input/output tokens with no thoughtTokens", () => {
  const u = parseClaudeUsage({ input_tokens: 5, output_tokens: 20 });
  assert.deepEqual(u, { inputTokens: 5, outputTokens: 20, thoughtTokens: 0, totalTokens: 25 });
});

// ─── Client transport (injected fetch) ─────────────────────────────────────────

test("createClaudeClient.generate posts to the Messages endpoint and parses a tool call", async () => {
  let captured = null;
  const fetchImpl = async (url, opts) => {
    captured = { url, body: JSON.parse(opts.body), headers: opts.headers };
    return {
      ok: true,
      json: async () => ({
        content: [{ type: "tool_use", id: "toolu_0", name: "schedule_block", input: {} }],
        stop_reason: "tool_use",
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    };
  };
  const client = createClaudeClient({ apiKey: "sk-ant-test", model: "claude-sonnet-5", fetchImpl });
  const res = await client.generate({
    system: "sys",
    contents: [{ role: "user", parts: [{ text: "go" }] }],
    toolDeclarations: [{ name: "schedule_block", description: "d", parameters: { type: "object", properties: {} } }],
    config: { maxOutputTokens: 512 },
  });
  assert.equal(captured.url, "https://api.anthropic.com/v1/messages");
  assert.equal(captured.headers["x-api-key"], "sk-ant-test");
  assert.equal(captured.headers["anthropic-version"], "2023-06-01");
  assert.equal(captured.body.model, "claude-sonnet-5");
  assert.equal(captured.body.max_tokens, 512);
  assert.equal(captured.body.system, "sys");
  assert.equal(captured.body.tools[0].name, "schedule_block");
  assert.equal(captured.body.temperature, undefined); // never sent — Sonnet 5 rejects non-default values
  assert.deepEqual(captured.body.thinking, { type: "disabled" }); // default thinkingBudget 0
  assert.equal(res.functionCalls[0].name, "schedule_block");
});

test("createClaudeClient.generate enables adaptive thinking + a conservative output_config.effort when thinkingBudget > 0", async () => {
  let captured = null;
  const fetchImpl = async (url, opts) => {
    captured = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" }) };
  };
  const client = createClaudeClient({ apiKey: "sk", model: "claude-opus-4-8", fetchImpl });
  await client.generate({ contents: [{ role: "user", parts: [{ text: "hi" }] }], config: { thinkingBudget: 512, maxOutputTokens: 20000 } });
  // budget_tokens 400s on claude-opus-4-8 ("Use thinking.type.adaptive and
  // output_config.effort to control thinking behavior") — adaptive + effort replace it.
  assert.deepEqual(captured.thinking, { type: "adaptive" });
  assert.deepEqual(captured.output_config, { effort: "low" }); // modest budget → brief thinking, room to act
  assert.equal(captured.max_tokens, 20000); // configured ceiling already exceeds the thinking floor
});

test("createClaudeClient.generate bumps max_tokens to a thinking-safe floor when the configured ceiling is too small", async () => {
  let captured = null;
  const fetchImpl = async (url, opts) => {
    captured = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" }) };
  };
  const client = createClaudeClient({ apiKey: "sk", model: "claude-sonnet-5", fetchImpl });
  // thinkingBudget 2048 + maxOutputTokens 4096 is the exact scheduler config that
  // produced "0 scheduled but billed": adaptive thinking has no token cap on Sonnet
  // 5, so it can consume the whole 4096 ceiling and never reach a tool_use block.
  await client.generate({ contents: [{ role: "user", parts: [{ text: "hi" }] }], config: { thinkingBudget: 2048, maxOutputTokens: 4096 } });
  assert.deepEqual(captured.thinking, { type: "adaptive" });
  assert.deepEqual(captured.output_config, { effort: "low" }); // 2048 is still a modest budget → low effort
  assert.equal(captured.max_tokens, 16000); // bumped to the thinking-safe floor, not left at 4096
});

test("effortFromThinkingBudget maps this app's modest budgets to low, escalating only for large explicit ones", () => {
  // Every budget this app actually stores (512-2048) → low: brief thinking that
  // leaves room to emit tool calls (the fix for the scheduler truncation bug).
  assert.equal(effortFromThinkingBudget(0), "low");
  assert.equal(effortFromThinkingBudget(512), "low");
  assert.equal(effortFromThinkingBudget(2048), "low");
  assert.equal(effortFromThinkingBudget(4095), "low");
  // Only an unusually large explicit budget escalates.
  assert.equal(effortFromThinkingBudget(4096), "medium");
  assert.equal(effortFromThinkingBudget(16384), "high");
});

test("createClaudeClient.generate retries a 500 then succeeds", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    if (calls === 1) return { ok: false, status: 500, text: async () => "server error" };
    return { ok: true, json: async () => ({ content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" }) };
  };
  const client = createClaudeClient({ apiKey: "sk", model: "claude-sonnet-5", fetchImpl, baseDelayMs: 1 });
  const res = await client.generate({ contents: [{ role: "user", parts: [{ text: "hi" }] }] });
  assert.equal(calls, 2);
  assert.equal(res.text, "ok");
});

test("createClaudeClient.generate throws a labeled error on a non-retryable 400", async () => {
  const fetchImpl = async () => ({ ok: false, status: 400, text: async () => "bad model" });
  const client = createClaudeClient({ apiKey: "sk", model: "nope", fetchImpl });
  await assert.rejects(
    () => client.generate({ contents: [{ role: "user", parts: [{ text: "hi" }] }] }),
    /Claude 400: bad model/,
  );
});

test("createClaudeClient throws without an API key", () => {
  assert.throws(() => createClaudeClient({ apiKey: "" }), /ANTHROPIC_API_KEY is required/);
});
