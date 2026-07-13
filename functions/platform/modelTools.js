// Superadmin model tooling: expose the curated catalog, PREVIEW a model live
// (so impact/cost/quality can be judged before saving), and a TEST-ALL health
// check that pings every configured agent's model so nothing broken reaches live.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { createGeminiClient, createOpenAiClient, createClaudeClient } from "../agents/llm.js";
import { pcmToWav, TTS_PROVIDERS, resolveTtsProvider, effectiveTtsModel, effectiveTtsVoice } from "../agents/tts.js";
import { MODEL_CATALOG, capabilityForAgent } from "../agents/modelCatalog.js";
import { AGENT_KEYS, loadAgentConfig, resolveTextProvider, secretNameForProvider } from "../agents/agentConfig.js";

function requireSuperAdmin(request) {
  if (request.auth?.token?.platformRole !== "superadmin") {
    throw new HttpsError("permission-denied", "Superadmin only.");
  }
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

// Run a minimal real call for one capability and return latency + a result.
// `geminiKey` powers text/image (and Gemini TTS); `openaiKey` powers OpenAI TTS
// and OpenAI text; `anthropicKey` powers Claude text.
async function pingModel({ capability, provider, model, voiceName, sampleText, geminiKey, openaiKey, anthropicKey }) {
  const t0 = now();
  if (capability === "tts") {
    const p = resolveTtsProvider(provider);
    const apiKey = p === "openai" ? openaiKey : geminiKey;
    if (!apiKey) throw new Error(`${p === "openai" ? "OPENAI_API_KEY" : "GEMINI_API_KEY"} is not set.`);
    const m = effectiveTtsModel(p, model);
    const { pcm, sampleRate } = await TTS_PROVIDERS[p].synth({
      text: sampleText || "Assalamu alaikum.", voiceName: effectiveTtsVoice(p, voiceName, m), model: m, apiKey,
    });
    const wav = pcmToWav(pcm, { sampleRate });
    return { latencyMs: Math.round(now() - t0), url: `data:audio/wav;base64,${wav.toString("base64")}`, model: m, provider: p };
  }
  if (capability === "image") {
    // Image generation is slow + costly; we don't ping it. Treat as configured.
    return { latencyMs: 0, skipped: true, output: `Image model "${model}" not pinged (generation is costly). It will be used live when activities generate illustrations.` };
  }
  // text — pick the client by provider so an OpenAI/Claude-configured agent is
  // pinged against that provider (not silently against Gemini).
  const textProvider = resolveTextProvider(provider, model);
  const textKey = textProvider === "openai" ? openaiKey : textProvider === "anthropic" ? anthropicKey : geminiKey;
  if (!textKey) throw new Error(`${secretNameForProvider(textProvider)} is not set.`);
  const client = textProvider === "openai"
    ? createOpenAiClient({ apiKey: textKey, model })
    : textProvider === "anthropic"
    ? createClaudeClient({ apiKey: textKey, model })
    : createGeminiClient({ apiKey: textKey, model });
  const res = await client.generate({
    system: "You are a model health check. Reply with one short sentence.",
    contents: [{ role: "user", parts: [{ text: sampleText || "Say hello in one short sentence." }] }],
    config: { maxOutputTokens: 64, temperature: 0.3 },
  });
  return { latencyMs: Math.round(now() - t0), output: (res.text || "").slice(0, 300) };
}

export const getModelCatalog = onCall(async (request) => {
  requireSuperAdmin(request);
  return { catalog: MODEL_CATALOG, agentCapabilities: Object.fromEntries(AGENT_KEYS.map((k) => [k, capabilityForAgent(k)])) };
});

// Preview a specific (possibly UNSAVED) model/voice choice for an agent.
export const previewModel = onCall({ secrets: ["GEMINI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"], timeoutSeconds: 60 }, async (request) => {
  requireSuperAdmin(request);
  const geminiKey = process.env.GEMINI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!geminiKey && !openaiKey && !anthropicKey) return { configured: false };
  const agentKey = String(request.data?.agentKey || "guide");
  const capability = capabilityForAgent(agentKey);
  const model = String(request.data?.model || "").trim() || (MODEL_CATALOG[capability]?.[0]?.id);
  const provider = capability === "tts"
    ? resolveTtsProvider(request.data?.provider)
    : capability === "text"
      ? resolveTextProvider(request.data?.provider, model)
      : undefined;
  const voiceName = request.data?.voiceName ? String(request.data.voiceName) : undefined;
  const sampleText = String(request.data?.sampleText || "").slice(0, 300);
  try {
    const r = await pingModel({ capability, provider, model, voiceName, sampleText, geminiKey, openaiKey, anthropicKey });
    return { configured: true, ok: true, capability, provider, model, ...r };
  } catch (e) {
    return { configured: true, ok: false, capability, provider, model, error: String(e?.message || e).slice(0, 400) };
  }
});

// Health-check every configured agent's model. Returns one row per agent so the
// superadmin can confirm everything works before/after saving.
export const testAllModels = onCall({ secrets: ["GEMINI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"], timeoutSeconds: 120 }, async (request) => {
  requireSuperAdmin(request);
  const geminiKey = process.env.GEMINI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!geminiKey && !openaiKey && !anthropicKey) return { configured: false, results: [] };
  const db = getFirestore();

  const results = [];
  for (const agentKey of AGENT_KEYS) {
    const cfg = await loadAgentConfig(db, agentKey);
    const capability = capabilityForAgent(agentKey);
    const provider = capability === "tts"
      ? resolveTtsProvider(cfg.provider)
      : capability === "text"
        ? resolveTextProvider(cfg.provider, cfg.model)
        : undefined;
    const model = capability === "tts" ? effectiveTtsModel(provider, cfg.model) : cfg.model;
    try {
      const r = await pingModel({ capability, provider, model: cfg.model, voiceName: cfg.voiceName, sampleText: "ping", geminiKey, openaiKey, anthropicKey });
      results.push({ agentKey, model: r.model || model, provider, capability, ok: true, skipped: Boolean(r.skipped), latencyMs: r.latencyMs });
    } catch (e) {
      results.push({ agentKey, model, provider, capability, ok: false, error: String(e?.message || e).slice(0, 300) });
    }
  }
  return { configured: true, results };
});
