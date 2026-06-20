// ReAct-style agent loop. Provider-agnostic: it speaks the Gemini "contents"
// shape but only depends on an injected `llm.generate()`. Each tool call is
// dispatched, its result fed back, and the loop repeats until the model returns
// a final text answer or the step budget is exhausted. Every step is recorded
// for the audit trail.

export async function runAgent({
  llm,
  system,
  toolDeclarations,
  tools, // { name: async (args) => result }
  userMessage,
  history = [],
  maxSteps = 8,
  generationConfig,
  onStep,
  // Optional forced-tool config (Gemini functionCallingConfig). When set, the
  // model is REQUIRED to call a tool each turn instead of being free to reply
  // with prose — pair with `stopAfterTool` so the loop ends as soon as the
  // terminal tool fires (otherwise mode:"ANY" would force a redundant re-call).
  toolConfig = null,
  stopAfterTool = null,
}) {
  const contents = [...history, { role: "user", parts: [{ text: userMessage }] }];
  const steps = [];
  const config = toolConfig ? { ...generationConfig, toolConfig } : generationConfig;

  for (let i = 0; i < maxSteps; i++) {
    const res = await llm.generate({ system, contents, toolDeclarations, config });

    if (res.functionCalls && res.functionCalls.length) {
      contents.push({ role: "model", parts: res.functionCalls.map((fc) => ({ functionCall: fc })) });

      const responseParts = [];
      let hitStopTool = false;
      for (const fc of res.functionCalls) {
        const tool = tools[fc.name];
        let result;
        try {
          result = tool ? await tool(fc.args || {}) : { error: `unknown tool "${fc.name}"` };
        } catch (e) {
          result = { error: e.message };
        }
        const step = { step: steps.length + 1, tool: fc.name, args: fc.args || {}, result };
        steps.push(step);
        if (onStep) await onStep(step);
        responseParts.push({ functionResponse: { name: fc.name, response: { result } } });
        if (stopAfterTool && fc.name === stopAfterTool) hitStopTool = true;
      }
      // Gemini expects function responses in a user turn.
      contents.push({ role: "user", parts: responseParts });
      // The terminal tool fired — its handler captured what we needed, so end
      // here rather than letting a forced-mode loop request a redundant call.
      if (hitStopTool) return { text: "", steps, contents, stoppedAt: "tool" };
      continue;
    }

    // No function call this turn. If the response was filtered by a safety /
    // recitation block, surface that explicitly instead of returning an empty
    // string that looks like the model "chose" to say nothing.
    if (res.blockReason && !res.text) {
      return {
        text: "I couldn't complete that request because the response was filtered. Please rephrase or try a different passage.",
        steps,
        contents,
        stoppedAt: "blocked",
        blockReason: res.blockReason,
      };
    }

    // No function call this turn. If the model hit the output-token ceiling,
    // it likely intended a (now-dropped) tool call — don't pass the partial
    // text off as a clean final answer.
    if (res.finishReason === "MAX_TOKENS") {
      return {
        text:
          res.text ||
          "I ran out of room while writing that response. Please try again — the request may be too large for a single step.",
        steps,
        contents,
        stoppedAt: "truncated",
      };
    }

    return { text: res.text || "", steps, contents, stoppedAt: "final" };
  }

  return { text: "I wasn't able to finish within the step budget.", steps, contents, stoppedAt: "limit" };
}
