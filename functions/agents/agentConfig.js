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
import { createGeminiClient, createOpenAiClient, createClaudeClient, DEFAULT_ANTHROPIC_MODEL } from "./llm.js";
import { recordCostEvent } from "../lib/costMeter.js";
import { consumePlanUsage } from "../lib/subscriptions.js";
import { replacementForRetired, liveThinkingLevels } from "./modelCatalog.js";

// Agents that can be configured independently. Keep in sync with the Platform UI.
export const AGENT_KEYS = ["guide", "curriculum", "syllabus", "content", "scheduler", "brief", "image", "tts", "explore"];

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
  image: { model: "gemini-3.1-flash-image", systemInstructions: "" },
  tts: { provider: "gemini", model: "gemini-2.5-flash-preview-tts", voiceName: "Kore", systemInstructions: "" },
  // Explore — the child's live voice companion (Gemini Live). `model` is a Live
  // model id (not a text model), `voiceName` a prebuilt Live voice.
  // thinkingLevel ("" | low | medium | high) only applies to extended-thinking Live
  // models; sessionMinutes caps one conversation; dailySessions caps per family/day.
  explore: { model: "gemini-3.8-live", learnModel: "gemini-3.8-live", learnThinkingLevel: "", voiceName: "Puck", thinkingLevel: "", sessionMinutes: 20, dailySessions: 30, systemInstructions: "" },
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
  if (["", "low", "medium", "high"].includes(raw.thinkingLevel)) out.thinkingLevel = raw.thinkingLevel;
  if (["", "low", "medium", "high"].includes(raw.learnThinkingLevel)) out.learnThinkingLevel = raw.learnThinkingLevel;
  if (typeof raw.learnModel === "string" && raw.learnModel.trim()) out.learnModel = raw.learnModel.trim().slice(0, 100);
  if (Number.isFinite(Number(raw.sessionMinutes)) && raw.sessionMinutes !== "") out.sessionMinutes = Math.max(5, Math.min(30, Math.round(Number(raw.sessionMinutes))));
  if (Number.isFinite(Number(raw.dailySessions)) && raw.dailySessions !== "") out.dailySessions = Math.max(1, Math.min(500, Math.round(Number(raw.dailySessions))));
  if (raw.provider === "gemini" || raw.provider === "openai" || raw.provider === "anthropic") out.provider = raw.provider;
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
// A Gemini Live (realtime voice) model id: "gemini-3.8-live", "...-native-audio-...".
// Excludes the specialised Live models (translate / transcribe / robotics) that share the protocol but cannot hold a spoken conversation.
export const isLiveModelId = (id) => /live|native-audio/i.test(String(id || "")) && !/transcribe|translate|robotics/i.test(String(id || ""));

export function mergeAgentConfig(doc, agentKey, now = new Date()) {
  const builtin = AGENT_DEFAULTS[agentKey] || AGENT_DEFAULTS.guide;
  const storedDefault = pickBlock(doc?.default);
  const agentOverride = pickBlock(doc?.agents?.[agentKey]);
  // The global default block carries TEXT-model settings (model, temperature, token
  // limits…). Explore runs on a Live model, so those must never leak into it — only
  // the superadmin's system-instruction text is shared.
  const inheritedDefault = agentKey === "explore"
    ? (storedDefault.systemInstructions !== undefined ? { systemInstructions: storedDefault.systemInstructions } : {})
    : storedDefault;
  const merged = { ...builtin, ...inheritedDefault, ...agentOverride };
  // Belt and braces: a non-Live model id (e.g. a stale/saved text model) would make
  // every conversation fail to connect, so fall back to the built-in Live model.
  if (agentKey === "explore" && !isLiveModelId(merged.model)) merged.model = builtin.model;
  if (agentKey === "explore" && !isLiveModelId(merged.learnModel)) merged.learnModel = builtin.learnModel;
  // A model the provider has retired (or is about to) resolves to its replacement so
  // an old saved choice never turns every call for that agent into a 404.
  const swap = replacementForRetired(merged.model, now);
  if (swap) merged.model = swap;
  // A thinking level only exists for models that have thinking. A level left over
  // from an earlier model choice would make every Live session refuse to connect
  // ("Thinking level is not supported for this model"), so drop it here — the one
  // place every caller (Explore, the Platform preview, the health check) reads.
  if (agentKey === "explore") {
    if (!liveThinkingLevels(merged.model).includes(merged.thinkingLevel)) merged.thinkingLevel = "";
    if (!liveThinkingLevels(merged.learnModel).includes(merged.learnThinkingLevel)) merged.learnThinkingLevel = "";
  }

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

// Human-facing secret name for a resolved provider, used in "isn't configured"
// messages so the superadmin knows exactly which secret to set.
export function secretNameForProvider(provider) {
  if (provider === "openai") return "OPENAI_API_KEY";
  if (provider === "anthropic") return "ANTHROPIC_API_KEY";
  return "GEMINI_API_KEY";
}

// Choose the text provider for an agent. An explicit config.provider wins;
// otherwise we infer from the model id (OpenAI ids like "gpt-4o-mini" / "o3" route
// to OpenAI, "claude-*" ids route to Anthropic) and default to Gemini — so a saved
// model id without a provider field still routes correctly. Mirrors the TTS
// provider resolution in tts.js.
export function resolveTextProvider(provider, model) {
  if (provider === "openai") return "openai";
  if (provider === "anthropic") return "anthropic";
  if (provider === "gemini") return "gemini";
  if (model && /^claude-/i.test(model)) return "anthropic";
  if (model && !/gemini/i.test(model) && /^(gpt-|o[0-9]|chatgpt|ft:)/i.test(model)) return "openai";
  return "gemini";
}

// Coerce a model id onto the resolved provider so a stale cross-provider value
// (e.g. provider switched to OpenAI while the model still reads "gemini-2.5-flash-lite")
// never gets sent to the wrong API — which would 404. Mirrors effectiveTtsModel in
// tts.js. A model that already fits the provider (or any non-cross-provider custom
// id) passes through unchanged.
export function effectiveTextModel(provider, model) {
  if (provider === "openai") return model && !/gemini/i.test(model) ? model : "gpt-4o-mini";
  if (provider === "anthropic") return model && /^claude-/i.test(model) ? model : DEFAULT_ANTHROPIC_MODEL;
  return model && !/^(gpt-|o[0-9]|chatgpt|ft:)/i.test(model) ? model : BASE_MODEL;
}

// Normalize the key argument: a bare string is the Gemini key (legacy single-key
// callers); an object carries one key per provider. Keeps every existing
// resolveLlm(db, key, process.env.GEMINI_API_KEY, …) caller working unchanged.
function normalizeKeys(apiKeys) {
  if (!apiKeys) return {};
  if (typeof apiKeys === "string") return { gemini: apiKeys };
  return { gemini: apiKeys.gemini, openai: apiKeys.openai, anthropic: apiKeys.anthropic };
}

// Build a ready-to-use LLM client + generationConfig for a text agent from its
// resolved config. The provider (Gemini or OpenAI) comes from the superadmin
// per-agent config; `apiKeys` may be a single Gemini key (legacy) or
// { gemini, openai }. Returns { llm: null } when the selected provider has no key
// set so callers can surface the "not configured" message. The model and
// generation knobs come from the per-agent config (with built-in fallbacks).
//
// `meterCtx`, when supplied, attributes every generate() call to a family for
// cost logging: { familyId, source, uid?, childId?, activityId?, runId? }. The
// client is wrapped so metering is automatic for both runAgent and any direct
// llm.generate() callers — best-effort, never blocking the agent on a log write.
export async function resolveLlm(db, agentKey, apiKeys, meterCtx = null) {
  const config = await loadAgentConfig(db, agentKey);
  const provider = resolveTextProvider(config.provider, config.model);
  const model = effectiveTextModel(provider, config.model);
  const keys = normalizeKeys(apiKeys);
  const apiKey = keys[provider];
  if (!apiKey) return { llm: null, genConfig: undefined, config, provider };
  const baseLlm = provider === "openai"
    ? createOpenAiClient({ apiKey, model })
    : provider === "anthropic"
    ? createClaudeClient({ apiKey, model })
    : createGeminiClient({ apiKey, model });
  const llm = meterCtx?.familyId ? withCostMetering(db, baseLlm, agentKey, model, meterCtx) : baseLlm;
  const genConfig = {
    temperature: config.temperature,
    maxOutputTokens: config.maxOutputTokens,
    thinkingBudget: config.thinkingBudget,
  };
  return { llm, genConfig, config, provider };
}

// Wrap a Gemini client so each generate() records a text cost event after the
// model returns. Metering errors are swallowed inside recordCostEvent.
export function withCostMetering(db, client, agentKey, model, meterCtx) {
  return {
    model: client.model,
    async generate(args) {
      const { plan } = await consumePlanUsage(db, meterCtx.familyId, "text", { uid: meterCtx.uid });
      const config = { ...args.config,
        maxOutputTokens: Math.min(Number(args.config?.maxOutputTokens) || 2048, plan.maxOutputTokens),
        thinkingBudget: Math.min(Number(args.config?.thinkingBudget) || 0, plan.thinkingBudget),
      };
      const res = await client.generate({ ...args, config });
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
