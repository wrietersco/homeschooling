// Cost metering for paid Gemini calls (text / TTS / image).
//
// Two responsibilities, kept pure where possible so they unit-test without a DB:
//   1. PRICING — per-model rates and the price* functions that turn a usage
//      record into a USD figure.
//   2. recordCostEvent — writes one deep `costEvents` doc per call AND increments
//      the family daily, family monthly, and platform monthly rollups in a single
//      batch, so summarized views need no scans.
//
// Everything is best-effort: a metering failure must NEVER break the user-facing
// agent call, so callers wrap recordCostEvent in try/catch (and it swallows its
// own errors as a second line of defense).
import { FieldValue } from "firebase-admin/firestore";
import { familyPaths, platformPricing, platformCostRollups } from "./paths.js";

// ─── Default pricing (USD per 1,000,000 tokens unless noted) ───────────────────
// Sourced from each provider's published rates (Google Gemini, OpenAI, Anthropic
// — June 2026). Overridable at runtime via the platform/pricing doc; the resolved
// rate is snapshotted into every event so old events keep their original cost
// after a rate change.
export const DEFAULT_PRICING = {
  text: {
    "gemini-2.5-flash": { input: 0.30, output: 2.50 },
    "gemini-2.5-flash-lite": { input: 0.10, output: 0.40 },
    "gemini-2.5-pro": { input: 1.25, output: 10.00 }, // ≤200k-token context tier
    "gemini-2.0-flash": { input: 0.10, output: 0.40 },
    // OpenAI chat models (published per-1M-token rates). Reasoning tokens, if any,
    // are billed at the output rate — priceText folds thoughtTokens into output.
    "gpt-4o-mini": { input: 0.15, output: 0.60 },
    "gpt-4.1-mini": { input: 0.40, output: 1.60 },
    "gpt-4o": { input: 2.50, output: 10.00 },
    "gpt-4.1": { input: 2.00, output: 8.00 },
    // Anthropic Claude models (published per-1M-token rates, June 2026). Sonnet 5
    // intro pricing ($2/$10) runs through 2026-08-31; using the standard $3/$15
    // rate here keeps the fallback conservative once the intro window ends.
    "claude-sonnet-5": { input: 3.00, output: 15.00 },
    "claude-opus-4-8": { input: 5.00, output: 25.00 },
  },
  tts: {
    "gemini-2.5-flash-preview-tts": { input: 0.50, output: 10.00 },
    "gemini-2.5-pro-preview-tts": { input: 1.00, output: 20.00 },
    // OpenAI's audio response carries no token counts, so these are billed via the
    // audioSeconds→output-tokens fallback (25 tok/s) in priceTts. gpt-4o-mini-tts
    // is token-priced (~$0.015/min audio); tts-1/-hd are really per-character but
    // approximated here on the same per-token basis so usage still gets a cost.
    "gpt-4o-mini-tts": { input: 0.60, output: 12.00 },
    "tts-1": { input: 0.00, output: 15.00 },
    "tts-1-hd": { input: 0.00, output: 30.00 },
  },
  image: {
    // Gemini Flash Image output is billed per token ($30/1M); a ≤1024px image
    // ≈ 1290 tokens ⇒ ~$0.039. Imagen models are billed per generated image.
    "gemini-2.5-flash-image": { perImage: 0.039 },
    "imagen-4.0-fast-generate-001": { perImage: 0.02 },
    "imagen-4.0-generate-001": { perImage: 0.04 },
    "imagen-4.0-ultra-generate-001": { perImage: 0.06 },
    "imagen-3.0-generate-002": { perImage: 0.04 },
  },
};

// Fallbacks when a model id isn't in the table — priced as the cheapest plausible
// tier so an unknown model is logged (with a flag) rather than counted as free.
const FALLBACK = { text: { input: 0.30, output: 2.50 }, tts: { input: 0.50, output: 10.00 }, image: { perImage: 0.04 } };

// ─── Pricing config cache (avoids a Firestore read on every paid call) ─────────
let _pricingCache = null;
let _pricingCacheAt = 0;
const PRICING_TTL_MS = 5 * 60 * 1000;

// Read platform/pricing and shallow-merge it over the code defaults per kind.
// Cached for PRICING_TTL_MS. Best-effort: any failure falls back to defaults.
export async function loadPricing(db, nowMs = Date.now()) {
  if (_pricingCache && nowMs - _pricingCacheAt < PRICING_TTL_MS) return _pricingCache;
  let merged = DEFAULT_PRICING;
  try {
    const snap = await platformPricing(db).get();
    if (snap.exists) {
      const o = snap.data() || {};
      merged = {
        text: { ...DEFAULT_PRICING.text, ...(o.text || {}) },
        tts: { ...DEFAULT_PRICING.tts, ...(o.tts || {}) },
        image: { ...DEFAULT_PRICING.image, ...(o.image || {}) },
      };
    }
  } catch {
    merged = DEFAULT_PRICING;
  }
  _pricingCache = merged;
  _pricingCacheAt = nowMs;
  return merged;
}

// Test seam: drop the cache so a test can swap pricing between assertions.
export function _resetPricingCache() { _pricingCache = null; _pricingCacheAt = 0; }

// ─── Pure pricing functions ────────────────────────────────────────────────────
// Each returns { costUsd, rate } so the caller can snapshot the rate it used.
const round6 = (n) => Math.round((Number(n) || 0) * 1e6) / 1e6;

// Thinking tokens are billed at the output rate, so fold them into output.
export function priceText({ model, usage = {}, pricing = DEFAULT_PRICING }) {
  const rate = pricing.text?.[model] || FALLBACK.text;
  const input = Number(usage.inputTokens) || 0;
  const output = (Number(usage.outputTokens) || 0) + (Number(usage.thoughtTokens) || 0);
  const costUsd = round6((input * rate.input + output * rate.output) / 1e6);
  return { costUsd, rate };
}

// TTS: prefer real token usage; fall back to audioSeconds → tokens (25 tok/sec).
export function priceTts({ model, usage = {}, pricing = DEFAULT_PRICING }) {
  const rate = pricing.tts?.[model] || FALLBACK.tts;
  const input = Number(usage.inputTokens) || 0;
  let output = Number(usage.outputTokens) || 0;
  if (!output && usage.audioSeconds) output = Math.round(Number(usage.audioSeconds) * 25);
  const costUsd = round6((input * rate.input + output * rate.output) / 1e6);
  return { costUsd, rate };
}

export function priceImage({ model, usage = {}, pricing = DEFAULT_PRICING }) {
  const rate = pricing.image?.[model] || FALLBACK.image;
  const images = Number(usage.images) || 0;
  const costUsd = round6(images * (rate.perImage || 0));
  return { costUsd, rate };
}

// Dispatch by kind. Returns { costUsd, rate }.
export function priceEvent({ kind, model, usage, pricing }) {
  if (kind === "tts") return priceTts({ model, usage, pricing });
  if (kind === "image") return priceImage({ model, usage, pricing });
  return priceText({ model, usage, pricing });
}

// ─── Period keys (UTC) ─────────────────────────────────────────────────────────
export function periodKeys(date = new Date()) {
  const iso = date.toISOString();      // YYYY-MM-DDTHH:...
  return { month: iso.slice(0, 7), day: iso.slice(0, 10) };
}

// Build the deep-merge increment payload for a rollup doc. Pulls call count + cost
// to the top level and into byKind / byAgent / byModel buckets for breakdowns.
function rollupIncrement({ kind, agentKey, model, costUsd, now }) {
  const bump = () => ({ costUsd: FieldValue.increment(costUsd), calls: FieldValue.increment(1) });
  return {
    costUsd: FieldValue.increment(costUsd),
    calls: FieldValue.increment(1),
    byKind: { [kind]: bump() },
    byAgent: { [agentKey || kind]: bump() },
    byModel: { [model || "unknown"]: bump() },
    updatedAt: now,
  };
}

// ─── Record one paid call ──────────────────────────────────────────────────────
// evt: { familyId, kind, agentKey, source, model, usage, uid?, childId?,
//        activityId?, runId?, cached? }. Computes cost, writes the event doc, and
// increments family-daily, family-monthly, and platform-monthly rollups atomically.
export async function recordCostEvent(db, evt = {}) {
  try {
    const { familyId, kind = "text", model = "unknown" } = evt;
    if (!db || !familyId) return null;

    const now = new Date();
    const pricing = await loadPricing(db);
    const { costUsd, rate } = priceEvent({ kind, model, usage: evt.usage || {}, pricing });
    const { month, day } = periodKeys(now);

    const fp = familyPaths(db, familyId);
    const eventDoc = {
      ts: now,
      kind,
      agentKey: evt.agentKey || kind,
      source: evt.source || null,
      model,
      usage: evt.usage || {},
      rateSnapshot: rate,
      costUsd,
      cached: Boolean(evt.cached),
      uid: evt.uid || null,
      childId: evt.childId || null,
      activityId: evt.activityId || null,
      runId: evt.runId || null,
    };

    const inc = rollupIncrement({ kind, agentKey: eventDoc.agentKey, model, costUsd, now });

    const batch = db.batch();
    batch.set(fp.costEvents().doc(), eventDoc);
    batch.set(fp.costRollups().doc(month), { period: month, granularity: "month", ...inc }, { merge: true });
    batch.set(fp.costRollups().doc(day), { period: day, granularity: "day", ...inc }, { merge: true });
    batch.set(
      platformCostRollups(db).doc(month),
      { period: month, granularity: "month", ...inc, byFamily: { [familyId]: { costUsd: FieldValue.increment(costUsd), calls: FieldValue.increment(1) } } },
      { merge: true }
    );
    await batch.commit();
    return { costUsd };
  } catch (e) {
    console.warn(`[cost] recordCostEvent failed: ${e?.message || e}`);
    return null;
  }
}
