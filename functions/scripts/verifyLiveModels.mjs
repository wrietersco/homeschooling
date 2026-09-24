// Verifies Gemini LIVE models against the REAL API through the app's own paths:
// for each model it connects twice — once with the session config the app would
// build (thinkingConfigFor), and once with a thinking level FORCED on — so the
// feature set each model actually accepts is observed, not assumed.
//
// This is what the catalog's `thinkingLevels` / `thinkingRequired` flags claim, and
// what the Explore pickers hide or show. A mismatch here means a child would hit
// "The buddy couldn't connect: Thinking level is not supported for this model".
//
// Usage: GEMINI_API_KEY=… node scripts/verifyLiveModels.mjs [modelId …]
//        (no arguments → every conversational Live model in the catalog)
import { MODEL_CATALOG, liveThinkingLevels, liveRequiresThinking } from "../agents/modelCatalog.js";
import { thinkingConfigFor } from "../agents/explore.js";
import { testLiveModel } from "../agents/liveTest.js";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("GEMINI_API_KEY is not set.");
  process.exit(1);
}

const ids = process.argv.slice(2).length ? process.argv.slice(2) : MODEL_CATALOG.live.map((m) => m.id);

// Connect for real; return "ok (…ms)" or the provider's own refusal.
async function connect(model, thinkingLevel) {
  try {
    const r = await testLiveModel({ apiKey, model, voiceName: "Puck", thinkingLevel, timeoutMs: 30000 });
    return { ok: true, note: `${r.firstAudioMs ?? "?"}ms to first audio` };
  } catch (e) {
    return { ok: false, note: String(e?.message || e).slice(0, 120) };
  }
}

let failures = 0;
for (const model of ids) {
  const levels = liveThinkingLevels(model);
  // 1. Exactly what the app sends for this model today.
  const appLevel = thinkingConfigFor({ model }).thinkingConfig?.thinkingLevel || "";
  const asApp = await connect(model, appLevel);
  // 2. A thinking level forced on, to confirm the catalog's claim either way.
  const forced = await connect(model, "medium");

  const claim = levels.length ? `thinking: ${levels.join("/")}${liveRequiresThinking(model) ? " (required)" : ""}` : "no thinking";
  const agrees = levels.length ? forced.ok : !forced.ok;
  if (!asApp.ok || !agrees) failures++;
  console.log(
    `${model.padEnd(46)} ${claim.padEnd(34)} as-app${appLevel ? `(${appLevel})` : ""}: ${asApp.ok ? "ok" : "FAIL"} ${asApp.note}`
  );
  console.log(`${"".padEnd(46)} ${"forced level=medium:".padEnd(34)} ${forced.ok ? "accepted" : "rejected"} — ${forced.note}`);
  console.log(`${"".padEnd(46)} catalog ${agrees ? "AGREES" : "DISAGREES with the API"}\n`);
}
console.log(failures ? `${failures} model(s) need attention.` : "All models behave as the catalog claims.");
process.exit(failures ? 1 : 0);
