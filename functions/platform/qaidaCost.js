// Cost + rate-limit model for bulk Qaida audio generation across TTS providers.
//
// Two providers can voice the corpus: Gemini and OpenAI. This module is the PURE,
// unit-tested core that (a) estimates the dollar cost of voicing the remaining
// words on a given provider/model, and (b) splits a workload across providers in
// proportion to their request-rate limits ("distribute" mode). The worker
// (qaidaImport.js) and the superadmin UI both build on these functions so the
// pre-run estimate and the realized run stay consistent.
//
// Rate limits below are seeded from the providers' published Tier-1 limits
// (Gemini AI Studio Tier 1; OpenAI Tier 1 TTS). They are deliberately conservative
// and superadmin-tunable — the authoritative live limits live in each provider's
// console. Sources: ai.google.dev/gemini-api/docs/rate-limits and
// platform.openai.com → Settings → Limits.
//   Gemini flash-tts ≈ 10 RPM / 100 RPD, pro-tts ≈ 10 RPM / 50 RPD (Tier 1).
//   OpenAI tts ≈ 50 RPM, no published daily cap (Tier 1; rises with spend tier).
export const DEFAULT_TTS_LIMITS = {
  gemini: {
    "gemini-2.5-flash-preview-tts": { rpm: 10, rpd: 100 },
    "gemini-2.5-pro-preview-tts": { rpm: 10, rpd: 50 },
  },
  openai: {
    "gpt-4o-mini-tts": { rpm: 50, rpd: null },
    "tts-1": { rpm: 50, rpd: null },
    "tts-1-hd": { rpm: 50, rpd: null },
  },
};

// Look up a model's limits, falling back to a sane per-provider default.
export function limitFor(provider, model) {
  const byProvider = DEFAULT_TTS_LIMITS[provider] || {};
  if (byProvider[model]) return byProvider[model];
  return provider === "openai" ? { rpm: 50, rpd: null } : { rpm: 10, rpd: 100 };
}

// ─── Cost estimate ────────────────────────────────────────────────────────────
// A Qaida clip is a short letter/word phrase. These constants only drive the
// ROUGH pre-run estimate; actual billing is metered from real usage elsewhere.
const AVG_CLIP_SECONDS = 4;          // typical spoken length of one Qaida item
const AUDIO_TOKENS_PER_SEC = 25;     // matches costMeter's audioSeconds→tokens rate

// Per-CHARACTER TTS models bill the input text directly ($ per 1M characters).
const CHAR_RATES = { "tts-1": 15.0, "tts-1-hd": 30.0 };
// Per-TOKEN TTS models bill input text tokens + audio output tokens ($ per 1M).
const TOKEN_RATES = {
  "gemini-2.5-flash-preview-tts": { input: 0.5, output: 10.0 },
  "gemini-2.5-pro-preview-tts": { input: 1.0, output: 20.0 },
  "gpt-4o-mini-tts": { input: 0.6, output: 12.0 },
};
const FALLBACK_TOKEN_RATE = { input: 0.5, output: 10.0 };

// Estimated USD to voice `items` words totalling `chars` characters on `model`.
export function estimateTtsCost({ items = 0, chars = 0, model }) {
  if (!items) return 0;
  if (CHAR_RATES[model]) return (chars / 1e6) * CHAR_RATES[model];
  const r = TOKEN_RATES[model] || FALLBACK_TOKEN_RATE;
  const inputTokens = chars / 4;                                   // ~4 chars/token
  const outputTokens = items * AVG_CLIP_SECONDS * AUDIO_TOKENS_PER_SEC;
  return (inputTokens * r.input + outputTokens * r.output) / 1e6;
}

// ─── Workload split ───────────────────────────────────────────────────────────
// Split `count` items across providers in proportion to `weights` (e.g. RPM).
// Integer result that always sums back to `count`; the last positive-weight key
// absorbs the rounding remainder. Zero/negative weights get nothing.
export function splitByRate(count, weights = {}) {
  const out = {};
  for (const k of Object.keys(weights)) out[k] = 0;
  const keys = Object.keys(weights).filter((k) => Number(weights[k]) > 0);
  const total = keys.reduce((s, k) => s + Number(weights[k]), 0);
  if (!total || count <= 0) return out;
  let assigned = 0;
  keys.forEach((k, i) => {
    if (i === keys.length - 1) out[k] = count - assigned;
    else {
      out[k] = Math.round((count * Number(weights[k])) / total);
      assigned += out[k];
    }
  });
  return out;
}

// Providers a plan will use, highest-throughput first. "distribute" uses both.
export function activeProviders(plan = {}) {
  const mode = plan.mode || "gemini";
  if (mode === "openai") return ["openai"];
  if (mode === "distribute") return ["openai", "gemini"];
  return ["gemini"];
}

// The model a plan voices with for `provider`, with a per-provider default.
export function planModel(plan = {}, provider) {
  const m = plan.models?.[provider];
  if (typeof m === "string" && m.trim()) return m.trim();
  return provider === "openai" ? "gpt-4o-mini-tts" : "gemini-2.5-flash-preview-tts";
}

// Project the cost of voicing `pending` ({ items, chars }) under `plan`. In
// distribute mode the workload is split by each provider's RPM (rate-limit-
// proportional). Returns per-provider { items, chars, model, usd } + totalUsd.
// NOTE: rough — it does not subtract Gemini's daily quota cap, so if Gemini hits
// its daily limit mid-run the realized split shifts toward OpenAI (and actual
// cost may rise). The UI labels this an estimate accordingly.
export function buildPlanEstimate({ pending = { items: 0, chars: 0 }, plan = {} }) {
  const providers = activeProviders(plan);
  const totalItems = Math.max(0, Number(pending.items) || 0);
  const avgChars = totalItems ? (Number(pending.chars) || 0) / totalItems : 0;

  let split;
  if (providers.length === 1) {
    split = { [providers[0]]: totalItems };
  } else {
    const weights = {};
    for (const p of providers) weights[p] = limitFor(p, planModel(plan, p)).rpm;
    split = splitByRate(totalItems, weights);
  }

  const perProvider = {};
  let totalUsd = 0;
  for (const p of providers) {
    const items = split[p] || 0;
    const chars = Math.round(items * avgChars);
    const model = planModel(plan, p);
    const usd = estimateTtsCost({ items, chars, model });
    perProvider[p] = { items, chars, model, usd, rpm: limitFor(p, model).rpm };
    totalUsd += usd;
  }
  return { perProvider, totalUsd, items: totalItems, chars: Number(pending.chars) || 0 };
}
