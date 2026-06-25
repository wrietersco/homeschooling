// Per-agent LLM configuration. The superadmin Platform screen writes a single
// document at platform/llm_config holding a global `default` block plus optional
// per-agent overrides. Every agent resolves its effective settings through
// loadAgentConfig(db, agentKey), which deep-merges:
//
//   built-in AGENT_DEFAULTS[key]  ⊕  stored.default  ⊕  stored.agents[key]
//
// so an unset field always falls back to a sane built-in. This is the single
// place model/temperature/token/thinking/system-instruction/voice settings are
// resolved, and it is read fresh on every invocation so superadmin edits take
// effect immediately (no redeploy, no cache).
import { platformLlmConfig } from "../lib/paths.js";
import { createGeminiClient } from "./llm.js";
import { recordCostEvent } from "../lib/costMeter.js";

// Agents that can be configured independently. Keep in sync with the Platform UI.
export const AGENT_KEYS = ["guide", "curriculum", "syllabus", "content", "scheduler", "brief", "image", "tts"];

const BASE_MODEL = "gemini-2.5-flash";

// Built-in fallbacks. Mirror the values the agents used before config existed so
// behaviour is unchanged until a superadmin overrides something.
export const AGENT_DEFAULTS = {
  guide: { model: BASE_MODEL, temperature: 0.4, maxOutputTokens: 2048, thinkingBudget: 0, systemInstructions: "" },
  curriculum: { model: BASE_MODEL, temperature: 0.4, maxOutputTokens: 8192, thinkingBudget: 0, systemInstructions: "" },
  syllabus: { model: BASE_MODEL, temperature: 0.4, maxOutputTokens: 2048, thinkingBudget: 0, systemInstructions: "" },
  content: { model: BASE_MODEL, temperature: 0.5, maxOutputTokens: 8192, thinkingBudget: 0, systemInstructions: "" },
  scheduler: { model: BASE_MODEL, temperature: 0.3, maxOutputTokens: 4096, thinkingBudget: 0, systemInstructions: "" },
  brief: { model: BASE_MODEL, temperature: 0.4, maxOutputTokens: 2048, thinkingBudget: 0, systemInstructions: "" },
  image: { model: "gemini-2.5-flash-image", systemInstructions: "" },
  tts: { model: "gemini-2.5-flash-preview-tts", voiceName: "Kore", systemInstructions: "" },
};

// Clean a stored block — keep only known, well-typed fields. Used both when
// reading (defensive) and writing (validation lives in admin.setLlmConfig).
function pickBlock(raw = {}) {
  const out = {};
  if (typeof raw.model === "string" && raw.model.trim()) out.model = raw.model.trim().slice(0, 100);
  if (Number.isFinite(Number(raw.temperature))) out.temperature = Number(raw.temperature);
  if (Number.isFinite(Number(raw.maxOutputTokens))) out.maxOutputTokens = Number(raw.maxOutputTokens);
  if (Number.isFinite(Number(raw.thinkingBudget))) out.thinkingBudget = Number(raw.thinkingBudget);
  if (typeof raw.systemInstructions === "string") out.systemInstructions = raw.systemInstructions;
  if (typeof raw.voiceName === "string" && raw.voiceName.trim()) out.voiceName = raw.voiceName.trim().slice(0, 60);
  return out;
}

// Read the raw stored config doc, normalising legacy (flat) shapes into the
// structured { default, agents } form. Returns { default, agents }.
export async function readLlmConfigDoc(db) {
  const snap = await platformLlmConfig(db).get();
  const data = snap.exists ? snap.data() || {} : {};

  // Structured shape already present.
  if (data.default || data.agents) {
    const agents = {};
    for (const k of AGENT_KEYS) agents[k] = pickBlock(data.agents?.[k]);
    return { default: pickBlock(data.default), agents };
  }

  // Legacy flat shape: { modelId, temperature, maxOutputTokens, thinkingBudget,
  // systemPromptSuffix | systemInstructions }. Fold it into `default` so old
  // installs keep working until the superadmin re-saves.
  const legacyDefault = pickBlock({
    model: data.modelId,
    temperature: data.temperature,
    maxOutputTokens: data.maxOutputTokens,
    thinkingBudget: data.thinkingBudget,
    systemInstructions: data.systemInstructions ?? data.systemPromptSuffix,
  });
  const agents = {};
  for (const k of AGENT_KEYS) agents[k] = {};
  return { default: legacyDefault, agents };
}

// Deep-merge built-in defaults ⊕ stored default ⊕ stored per-agent override.
export function mergeAgentConfig(doc, agentKey) {
  const builtin = AGENT_DEFAULTS[agentKey] || AGENT_DEFAULTS.guide;
  const storedDefault = pickBlock(doc?.default);
  const agentOverride = pickBlock(doc?.agents?.[agentKey]);
  const merged = { ...builtin, ...storedDefault, ...agentOverride };

  // The global `default` block must not silently lower an agent's token ceiling
  // below its built-in. curriculum/content need maxOutputTokens >= 8192 because
  // finalize_curriculum / content generation emit large tool-call payloads;
  // truncation surfaces to users as "I ran out of room while writing that
  // response" (Gemini finishReason MAX_TOKENS). The Platform UI seeds the global
  // default at 2048, so saving "all agent settings" would otherwise clobber the
  // higher built-in. Only an explicit per-agent override may reduce it.
  if (
    typeof builtin.maxOutputTokens === "number" &&
    agentOverride.maxOutputTokens === undefined &&
    typeof merged.maxOutputTokens === "number" &&
    merged.maxOutputTokens < builtin.maxOutputTokens
  ) {
    merged.maxOutputTokens = builtin.maxOutputTokens;
  }
  return merged;
}

// Resolve the effective config for one agent. One Firestore read per call.
export async function loadAgentConfig(db, agentKey) {
  const doc = await readLlmConfigDoc(db);
  return mergeAgentConfig(doc, agentKey);
}

// Build a ready-to-use Gemini client + generationConfig for a text agent from
// its resolved config. Returns { llm: null } when no API key is set so callers
// can surface the "not configured" message. The model and generation knobs come
// from the superadmin per-agent config (with built-in fallbacks).
//
// `meterCtx`, when supplied, attributes every generate() call to a family for
// cost logging: { familyId, source, uid?, childId?, activityId?, runId? }. The
// client is wrapped so metering is automatic for both runAgent and any direct
// llm.generate() callers — best-effort, never blocking the agent on a log write.
export async function resolveLlm(db, agentKey, apiKey, meterCtx = null) {
  if (!apiKey) return { llm: null, genConfig: undefined, config: null };
  const config = await loadAgentConfig(db, agentKey);
  const baseLlm = createGeminiClient({ apiKey, model: config.model });
  const llm = meterCtx?.familyId ? withCostMetering(db, baseLlm, agentKey, config.model, meterCtx) : baseLlm;
  const genConfig = {
    temperature: config.temperature,
    maxOutputTokens: config.maxOutputTokens,
    thinkingBudget: config.thinkingBudget,
  };
  return { llm, genConfig, config };
}

// Wrap a Gemini client so each generate() records a text cost event after the
// model returns. Metering errors are swallowed inside recordCostEvent.
function withCostMetering(db, client, agentKey, model, meterCtx) {
  return {
    model: client.model,
    async generate(args) {
      const res = await client.generate(args);
      if (res?.usage) {
        await recordCostEvent(db, {
          familyId: meterCtx.familyId,
          kind: "text",
          agentKey,
          model,
          source: meterCtx.source || agentKey,
          usage: res.usage,
          uid: meterCtx.uid,
          childId: meterCtx.childId,
          activityId: meterCtx.activityId,
          runId: meterCtx.runId,
        });
      }
      return res;
    },
  };
}
