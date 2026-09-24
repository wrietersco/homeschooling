// Verifies text models against the REAL provider APIs using the app's own clients
// (same request shape, default generation settings, and a function-call round).
// Usage:  GEMINI_API_KEY=… OPENAI_API_KEY=… node scripts/verifyTextModels.mjs gemini:gemini-3.8-flash openai:gpt-5.6-luna …
import { createGeminiClient, createOpenAiClient } from "../agents/llm.js";

const tools = [{
  name: "get_weather", description: "Get the weather for a city.",
  parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
}];

async function check(spec) {
  const [provider, model] = spec.split(":");
  const key = provider === "openai" ? process.env.OPENAI_API_KEY : process.env.GEMINI_API_KEY;
  const client = provider === "openai" ? createOpenAiClient({ apiKey: key, model, maxRetries: 1 }) : createGeminiClient({ apiKey: key, model, maxRetries: 1 });
  const out = { spec };
  try {
    const t0 = Date.now();
    const plain = await client.generate({
      system: "You are a concise assistant.",
      contents: [{ role: "user", parts: [{ text: "Reply with exactly: pong" }] }],
      config: { temperature: 0.4, maxOutputTokens: 2048, thinkingBudget: 0 },
    });
    out.plain = `${(plain.text || "").trim().slice(0, 30) || "(empty:" + plain.finishReason + ")"} ${Date.now() - t0}ms`;
    out.usage = JSON.stringify(plain.usage || {});
  } catch (e) { out.plain = "FAIL " + String(e.message).slice(0, 140); }
  try {
    const call = await client.generate({
      system: "Use the tool when asked about weather.",
      contents: [{ role: "user", parts: [{ text: "What's the weather in Lahore?" }] }],
      toolDeclarations: tools,
      config: { temperature: 0.4, maxOutputTokens: 2048, thinkingBudget: 0 },
    });
    out.tool = call.functionCalls?.length ? `call ${call.functionCalls[0].name}(${JSON.stringify(call.functionCalls[0].args)})` : `NO CALL (${call.finishReason}) text=${(call.text || "").slice(0, 40)}`;
  } catch (e) { out.tool = "FAIL " + String(e.message).slice(0, 140); }
  // Full tool round trip: model calls the tool, we answer, model writes the final text.
  try {
    const contents = [{ role: "user", parts: [{ text: "What's the weather in Lahore? Answer in one short sentence." }] }];
    const first = await client.generate({ system: "Use the tool for weather, then answer.", contents, toolDeclarations: tools, config: { temperature: 0.4, maxOutputTokens: 2048, thinkingBudget: 0 } });
    if (!first.functionCalls?.length) throw new Error("no tool call on turn 1");
    contents.push({ role: "model", parts: first.functionCalls.map(({ thoughtSignature, ...call }) => ({ functionCall: call, ...(thoughtSignature ? { thoughtSignature } : {}) })) });
    contents.push({ role: "user", parts: first.functionCalls.map((fc) => ({ functionResponse: { name: fc.name, response: { result: { tempC: 31, sky: "sunny" } } } })) });
    const final = await client.generate({ system: "Use the tool for weather, then answer.", contents, toolDeclarations: tools, config: { temperature: 0.4, maxOutputTokens: 2048, thinkingBudget: 0 } });
    out.loop = /31|sunny/i.test(final.text || "") ? `ok "${(final.text || "").trim().slice(0, 60)}"` : `UNEXPECTED "${(final.text || "").slice(0, 60)}" calls=${final.functionCalls?.length}`;
  } catch (e) { out.loop = "FAIL " + String(e.message).slice(0, 140); }
  return out;
}

const specs = process.argv.slice(2);
for (const s of specs) {
  const r = await check(s);
  console.log(`\n${r.spec}\n  plain: ${r.plain}\n  usage: ${r.usage || "-"}\n  tool : ${r.tool}
  loop : ${r.loop}`);
}
