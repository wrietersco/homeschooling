// Verifies Claude text models against the REAL Anthropic API using the app's own
// client (same request shape, generation settings, and a full tool round trip).
// The key is read from the environment — never pass it on the command line:
//   ANTHROPIC_API_KEY=… node scripts/verifyClaudeModels.mjs [claude-haiku-5-5 claude-sonnet-5-5 …]
// With no arguments it checks the 5.5 generation.
import { createClaudeClient } from "../agents/llm.js";

const key = process.env.ANTHROPIC_API_KEY;
if (!key) {
  console.error("ANTHROPIC_API_KEY is not set. Set it for this shell only (or run `firebase functions:secrets:access ANTHROPIC_API_KEY` yourself and export it). In production the key is the Firebase secret: firebase functions:secrets:set ANTHROPIC_API_KEY");
  process.exit(2);
}
const models = process.argv.slice(2);
if (!models.length) models.push("claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5");

const tools = [{
  name: "get_weather", description: "Get the weather for a city.",
  parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
}];
const cfg = { maxOutputTokens: 2048, thinkingBudget: 0 };
const short = (e) => String(e?.message || e).slice(0, 160);

let failed = false;
for (const model of models) {
  const client = createClaudeClient({ apiKey: key, model, maxRetries: 1 });
  const out = { plain: "", usage: "-", tool: "", loop: "" };
  try {
    const t0 = Date.now();
    const r = await client.generate({ system: "You are a concise assistant.", contents: [{ role: "user", parts: [{ text: "Reply with exactly: pong" }] }], config: cfg });
    out.plain = `${(r.text || "").trim().slice(0, 30) || `(empty:${r.finishReason})`} ${Date.now() - t0}ms`;
    out.usage = JSON.stringify(r.usage);
  } catch (e) { out.plain = "FAIL " + short(e); failed = true; }
  try {
    const r = await client.generate({ system: "Use the tool for weather.", contents: [{ role: "user", parts: [{ text: "What's the weather in Lahore?" }] }], toolDeclarations: tools, config: cfg });
    out.tool = r.functionCalls?.length ? `call ${r.functionCalls[0].name}(${JSON.stringify(r.functionCalls[0].args)})` : `NO CALL (${r.finishReason})`;
    if (!r.functionCalls?.length) failed = true;
  } catch (e) { out.tool = "FAIL " + short(e); failed = true; }
  try {
    const contents = [{ role: "user", parts: [{ text: "What's the weather in Lahore? Answer in one short sentence." }] }];
    const first = await client.generate({ system: "Use the tool for weather, then answer.", contents, toolDeclarations: tools, config: cfg });
    if (!first.functionCalls?.length) throw new Error("no tool call on turn 1");
    contents.push({ role: "model", parts: first.functionCalls.map((c) => ({ functionCall: { name: c.name, args: c.args } })) });
    contents.push({ role: "user", parts: first.functionCalls.map((c) => ({ functionResponse: { name: c.name, response: { result: { tempC: 31, sky: "sunny" } } } })) });
    const final = await client.generate({ system: "Use the tool for weather, then answer.", contents, toolDeclarations: tools, config: cfg });
    const ok = /31|sunny/i.test(final.text || "");
    out.loop = ok ? `ok "${final.text.trim().slice(0, 60)}"` : `UNEXPECTED "${(final.text || "").slice(0, 60)}"`;
    if (!ok) failed = true;
  } catch (e) { out.loop = "FAIL " + short(e); failed = true; }
  console.log(`\n${model}\n  plain: ${out.plain}\n  usage: ${out.usage}\n  tool : ${out.tool}\n  loop : ${out.loop}`);
}
process.exit(failed ? 1 : 0);
