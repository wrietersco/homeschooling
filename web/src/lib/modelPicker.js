// Pure helpers for the searchable model dropdown on the AI configuration page.
// A "model" is a catalog entry from functions/agents/modelCatalog.js:
//   { id, label, provider, cost, speed, pricing, latency, quality, whenToUse,
//     recommended, newest, price: { in, out, perImage, perMChars }, availability }

export const PROVIDER_ORDER = ["gemini", "openai", "anthropic"];
export const PROVIDER_NAMES = { gemini: "Google Gemini", openai: "OpenAI", anthropic: "Anthropic Claude" };
export const SECRET_NAMES = { gemini: "GEMINI_API_KEY", openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY" };

export const SORTS = [
  { value: "default", label: "Catalog order" },
  { value: "cheapest", label: "Cheapest first" },
  { value: "fastest", label: "Fastest first" },
  { value: "quality", label: "Best quality first" },
];

const COST_RANK = { lowest: 0, low: 1, "low–medium": 2, medium: 3, "medium+": 3.5, "per-image": 3, higher: 4, high: 5, "very": 6 };
const SPEED_RANK = { fastest: 0, fast: 1, "fast–medium": 1.5, medium: 2, slower: 3, slow: 4 };

const rank = (table, label) => {
  const full = String(label || "").toLowerCase().replace(/\s*\(.*$/, "").trim();
  if (full in table) return table[full];
  const first = full.split(" ")[0];
  return first in table ? table[first] : 99;
};

// USD per 1M output tokens (or per image / 1M chars) — what "cheapest" and "quality" sort on.
export function priceKey(m) {
  const p = m?.price;
  if (!p) return Infinity;
  if (p.perImage != null) return p.perImage;
  if (p.perMChars != null) return p.perMChars;
  if (p.out != null) return p.out;
  return Infinity;
}
export function costRank(m) {
  const k = priceKey(m);
  return Number.isFinite(k) ? k : rank(COST_RANK, m?.cost);
}
export function speedRank(m) { return rank(SPEED_RANK, m?.speed); }

// Retired = the provider no longer serves it (calls fail). Shutting down = still works, date set.
export function isRetired(m) { return m?.availability?.state === "unavailable"; }
export function isShuttingDown(m) { return m?.availability?.state === "deprecating"; }

// The id(s) with the lowest price among usable `models` → the "Cheapest" badge.
export function cheapestIds(models) {
  const live = (models || []).filter((m) => !isRetired(m) && Number.isFinite(priceKey(m)));
  if (!live.length) return new Set();
  const min = Math.min(...live.map(priceKey));
  return new Set(live.filter((m) => priceKey(m) === min).map((m) => m.id));
}

// Why a model can't be picked right now, or "" when it can.
//   keys:    { gemini, openai, anthropic } booleans — a missing entry means unknown (allowed)
//   allowed: providers this agent may use (its allowlist); undefined = all
export function disabledReason(m, { keys, allowed } = {}) {
  const prov = m?.provider || "gemini";
  if (allowed && !allowed.includes(prov)) return `This agent can't run on ${PROVIDER_NAMES[prov] || prov} yet.`;
  if (keys && keys[prov] === false) return `${SECRET_NAMES[prov] || "API key"} isn't set, so this provider can't run.`;
  return "";
}

// Search + sort + group. Returns [{ prov, label, models }] (empty groups dropped).
//   showRetired: include models the provider no longer serves (the selected one always stays visible)
export function arrangeModels(models, { query = "", sort = "default", showRetired = false, keepId = "" } = {}) {
  const q = String(query || "").trim().toLowerCase();
  let list = (models || []).filter((m) => showRetired || !isRetired(m) || m.id === keepId);
  if (q) {
    list = list.filter((m) => [m.id, m.label, m.provider, PROVIDER_NAMES[m.provider], m.quality, m.whenToUse, m.cost, m.speed]
      .some((f) => String(f || "").toLowerCase().includes(q)));
  }
  const cmp = {
    cheapest: (a, b) => costRank(a) - costRank(b) || speedRank(a) - speedRank(b),
    fastest: (a, b) => speedRank(a) - speedRank(b) || costRank(a) - costRank(b),
    // No quality score is published, so output price is the proxy: pricier tiers are the stronger models.
    quality: (a, b) => (Number.isFinite(priceKey(b)) ? priceKey(b) : 0) - (Number.isFinite(priceKey(a)) ? priceKey(a) : 0) || costRank(b) - costRank(a),
  }[sort];
  if (cmp) list = [...list].sort(cmp);
  const provs = [...PROVIDER_ORDER, ...new Set(list.map((m) => m.provider || "gemini"))];
  const groups = [];
  for (const prov of provs) {
    if (groups.some((g) => g.prov === prov)) continue;
    const ms = list.filter((m) => (m.provider || "gemini") === prov);
    if (ms.length) groups.push({ prov, label: PROVIDER_NAMES[prov] || prov, models: ms });
  }
  return groups;
}

// Short price chip: "$0.30 in / $2.50 out" · "$0.039 / image" · "$15.00 / 1M chars".
export function priceChip(m) {
  const p = m?.price;
  const usd = (n) => { const [i, d = ""] = String(Number(Number(n).toFixed(4))).split("."); return `$${i}.${d.padEnd(2, "0")}`; };
  if (!p) return m?.pricing || "";
  if (p.perMChars != null) return `${usd(p.perMChars)} / 1M chars`;
  if (p.perImage != null) return `${usd(p.perImage)} / image`;
  if (p.in != null && p.out != null) return `${usd(p.in)} in / ${usd(p.out)} out`;
  return m?.pricing || "";
}
