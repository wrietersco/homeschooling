// Generates one image per model through the app's own callImageModel() and reports size/format.
// Usage: GEMINI_API_KEY=… OPENAI_API_KEY=… node scripts/verifyImageModels.mjs gemini-3.1-flash-image gpt-image-2.5-flare
import { callImageModel, imageApiKeyFor } from "../agents/imageGen.js";
function dims(buf) {
  if (buf[0] === 0x89) return `png ${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`;
  let i = 2; while (i < buf.length) { if (buf[i] !== 0xff) { i++; continue; } const m = buf[i + 1]; if (m >= 0xc0 && m <= 0xc3) return `jpeg ${buf.readUInt16BE(i + 7)}x${buf.readUInt16BE(i + 5)}`; i += 2 + buf.readUInt16BE(i + 2); }
  return "?";
}
const keys = { geminiApiKey: process.env.GEMINI_API_KEY, openaiApiKey: process.env.OPENAI_API_KEY };
for (const model of process.argv.slice(2)) {
  const t0 = Date.now();
  const out = await callImageModel({ model, apiKey: imageApiKeyFor(model, keys), fetchImpl: fetch, prompt: "A single, clear, friendly children's illustration of: an apple. One subject only, centred on a plain soft pastel background. No text, no words, no letters in the image." });
  console.log(model.padEnd(30), out ? `${dims(Buffer.from(out.data, "base64"))} ${out.mime} ${(out.data.length * 0.75 / 1024).toFixed(0)}KB ${Date.now() - t0}ms` : "NULL (failed)");
}
