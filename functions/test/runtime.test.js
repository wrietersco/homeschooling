import { test } from "node:test";
import assert from "node:assert/strict";
import { runAgent } from "../agents/runtime.js";

// A scripted fake LLM: returns successive responses from a queue.
function fakeLlm(responses) {
  let i = 0;
  const calls = [];
  return {
    calls,
    async generate(args) {
      calls.push(args);
      return responses[Math.min(i++, responses.length - 1)];
    },
  };
}

test("runAgent dispatches a tool call, feeds the result back, then finalizes", async () => {
  const llm = fakeLlm([
    { text: "", functionCalls: [{ name: "query_collection", args: { collection: "children" } }] },
    { text: "You have 2 children.", functionCalls: [] },
  ]);
  let receivedArgs = null;
  const tools = {
    query_collection: async (args) => { receivedArgs = args; return { count: 2, rows: [{ id: "a" }, { id: "b" }] }; },
  };

  const result = await runAgent({
    llm, system: "s", toolDeclarations: [], tools,
    userMessage: "How many kids do I have?",
  });

  assert.equal(result.text, "You have 2 children.");
  assert.equal(result.stoppedAt, "final");
  assert.equal(result.steps.length, 1);
  assert.equal(result.steps[0].tool, "query_collection");
  assert.deepEqual(receivedArgs, { collection: "children" });
  // Second LLM call must include the function response in the contents.
  const fed = JSON.stringify(llm.calls[1].contents);
  assert.match(fed, /functionResponse/);
});

test("runAgent reports an error result for an unknown tool but keeps going", async () => {
  const llm = fakeLlm([
    { text: "", functionCalls: [{ name: "nope", args: {} }] },
    { text: "done", functionCalls: [] },
  ]);
  const result = await runAgent({ llm, tools: {}, userMessage: "x" });
  assert.equal(result.steps[0].result.error, 'unknown tool "nope"');
  assert.equal(result.text, "done");
});

test("runAgent captures a thrown tool error without crashing", async () => {
  const llm = fakeLlm([
    { text: "", functionCalls: [{ name: "boom", args: {} }] },
    { text: "recovered", functionCalls: [] },
  ]);
  const tools = { boom: async () => { throw new Error("kaboom"); } };
  const result = await runAgent({ llm, tools, userMessage: "x" });
  assert.equal(result.steps[0].result.error, "kaboom");
  assert.equal(result.text, "recovered");
});

test("runAgent threads generationConfig into llm.generate", async () => {
  const llm = fakeLlm([{ text: "ok", functionCalls: [] }]);
  await runAgent({
    llm, tools: {}, userMessage: "x",
    generationConfig: { maxOutputTokens: 8192 },
  });
  assert.deepEqual(llm.calls[0].config, { maxOutputTokens: 8192 });
});

test("runAgent flags a truncated (MAX_TOKENS) response instead of passing it off as final", async () => {
  const llm = fakeLlm([{ text: "partial...", functionCalls: [], finishReason: "MAX_TOKENS" }]);
  const result = await runAgent({ llm, tools: {}, userMessage: "x" });
  assert.equal(result.stoppedAt, "truncated");
  assert.equal(result.text, "partial...");
});

test("runAgent threads toolConfig into the generate config (forced calling)", async () => {
  const llm = fakeLlm([{ text: "", functionCalls: [{ name: "save", args: {} }] }]);
  const tools = { save: async () => ({ saved: true }) };
  const toolConfig = { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["save"] } };
  await runAgent({
    llm, tools, userMessage: "x",
    generationConfig: { maxOutputTokens: 4096 },
    toolConfig, stopAfterTool: "save",
  });
  assert.deepEqual(llm.calls[0].config, { maxOutputTokens: 4096, toolConfig });
});

test("runAgent returns immediately after the stopAfterTool tool fires", async () => {
  // The model would keep calling forever under forced mode; stopAfterTool ends it.
  const llm = fakeLlm([{ text: "", functionCalls: [{ name: "save", args: { a: 1 } }] }]);
  let calls = 0;
  const tools = { save: async () => { calls++; return { saved: true }; } };
  const result = await runAgent({
    llm, tools, userMessage: "x", maxSteps: 4, stopAfterTool: "save",
  });
  assert.equal(result.stoppedAt, "tool");
  assert.equal(calls, 1);          // tool ran exactly once
  assert.equal(llm.calls.length, 1); // and we never asked the model again
});

test("runAgent surfaces an empty final response instead of a blank string", async () => {
  // Gemini sometimes ends a turn with finishReason STOP and no parts (empty
  // candidate). That must not reach the UI as "" — a blank bubble that looks
  // like the agent fell asleep. It should become a clear, non-empty message.
  const llm = fakeLlm([{ text: "", functionCalls: [], finishReason: "STOP" }]);
  const result = await runAgent({ llm, tools: {}, userMessage: "x" });
  assert.equal(result.stoppedAt, "empty");
  assert.equal(result.finishReason, "STOP");
  assert.ok(result.text.length > 0, "empty final should yield a non-empty diagnostic message");
});

test("runAgent stops at the step budget if the model never finalizes", async () => {
  const llm = fakeLlm([{ text: "", functionCalls: [{ name: "loop", args: {} }] }]);
  const tools = { loop: async () => ({ ok: true }) };
  const result = await runAgent({ llm, tools, userMessage: "x", maxSteps: 3 });
  assert.equal(result.stoppedAt, "limit");
  assert.equal(result.steps.length, 3);
});
