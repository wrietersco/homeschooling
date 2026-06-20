// Superadmin model tooling: expose the curated catalog, PREVIEW a model live
// (so impact/cost/quality can be judged before saving), and a TEST-ALL health
// check that pings every configured agent's model so nothing broken reaches live.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { createGeminiClient } from "../agents/llm.js";
import { synthesizePcm, pcmToWav } from "../agents/tts.js";
import { MODEL_CATALOG, capabilityForAgent } from "../agents/modelCatalog.js";
import { AGENT_KEYS, loadAgentConfig } from "../agents/agentConfig.js";

function requireSuperAdmin(request) {
  if (request.auth?.token?.platformRole !== "superadmin") {
    throw new HttpsError("permission-denied", "Superadmin only.");
  }
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

// Run a minimal real call for one capability and return latency + a result.
async function pingModel({ capability, model, voiceName, sampleText, apiKey }) {
  const t0 = now();
  if (capability === "tts") {
    const { pcm, sampleRate } = await synthesizePcm({
      text: sampleText || "Assalamu alaikum.", voiceName: voiceName || "Kore", model, apiKey,
    });
    const wav = pcmToWav(pcm, { sampleRate });
    return { latencyMs: Math.round(now() - t0), url: `data:audio/wav;base64,${wav.toString("base64")}` };
  }
  if (capability === "image") {
    // Image generation is slow + costly; we don't ping it. Treat as configured.
    return { latencyMs: 0, skipped: true, output: "Image model not pinged (generation is costly)." };
  }
  // text
  const client = createGeminiClient({ apiKey, model });
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
export const previewModel = onCall({ secrets: ["GEMINI_API_KEY"], timeoutSeconds: 60 }, async (request) => {
  requireSuperAdmin(request);
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { configured: false };
  const agentKey = String(request.data?.agentKey || "guide");
  const capability = capabilityForAgent(agentKey);
  const model = String(request.data?.model || "").trim() || (MODEL_CATALOG[capability]?.[0]?.id);
  const voiceName = request.data?.voiceName ? String(request.data.voiceName) : undefined;
  const sampleText = String(request.data?.sampleText || "").slice(0, 300);
  try {
    const r = await pingModel({ capability, model, voiceName, sampleText, apiKey });
    return { configured: true, ok: true, capability, model, ...r };
  } catch (e) {
    return { configured: true, ok: false, capability, model, error: String(e?.message || e).slice(0, 400) };
  }
});

// Health-check every configured agent's model. Returns one row per agent so the
// superadmin can confirm everything works before/after saving.
export const testAllModels = onCall({ secrets: ["GEMINI_API_KEY"], timeoutSeconds: 120 }, async (request) => {
  requireSuperAdmin(request);
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { configured: false, results: [] };
  const db = getFirestore();

  const results = [];
  for (const agentKey of AGENT_KEYS) {
    const cfg = await loadAgentConfig(db, agentKey);
    const capability = capabilityForAgent(agentKey);
    try {
      const r = await pingModel({ capability, model: cfg.model, voiceName: cfg.voiceName, sampleText: "ping", apiKey });
      results.push({ agentKey, model: cfg.model, capability, ok: true, skipped: Boolean(r.skipped), latencyMs: r.latencyMs });
    } catch (e) {
      results.push({ agentKey, model: cfg.model, capability, ok: false, error: String(e?.message || e).slice(0, 300) });
    }
  }
  return { configured: true, results };
});
