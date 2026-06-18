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
}) {
  const contents = [...history, { role: "user", parts: [{ text: userMessage }] }];
  const steps = [];

  for (let i = 0; i < maxSteps; i++) {
    const res = await llm.generate({ system, contents, toolDeclarations, config: generationConfig });

    if (res.functionCalls && res.functionCalls.length) {
      contents.push({ role: "model", parts: res.functionCalls.map((fc) => ({ functionCall: fc })) });

      const responseParts = [];
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
      }
      // Gemini expects function responses in a user turn.
      contents.push({ role: "user", parts: responseParts });
      continue;
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
