// Platform admin deep links. Every sidebar section has a readable URL:
//
//   /platform                      → Families (the default section; kept working)
//   /platform/families?family=<id> → a family's members expanded (also ?q=, ?status=)
//   /platform/plans  /platform/users  /platform/usage  /platform/capacity
//   /platform/costs?family=<id>    → that family's cost detail
//   /platform/ai-config  /platform/models  /platform/quran  /platform/qaida
//   /platform/wikido[/:topicId[/:sceneId]]   (Wikido Studio)
//
// Section ids (used inside PlatformView) differ from the URL slugs where a
// friendlier word reads better; this module is the only place that maps them.
export const SECTION_SLUGS = {
  families: "families",
  subscriptions: "plans",
  users: "users",
  usage: "usage",
  costs: "costs",
  quota: "capacity",
  llm: "ai-config",
  live: "models",
  wikido: "wikido",
  quran: "quran",
  qaida: "qaida",
};
export const DEFAULT_SECTION = "families";

const BY_SLUG = Object.fromEntries(Object.entries(SECTION_SLUGS).map(([id, slug]) => [slug, id]));

// route param → section id. "" (bare /platform) is the default; an unknown slug
// returns null so the caller can fall back with a notice.
export function sectionFromSlug(slug) {
  const s = (Array.isArray(slug) ? slug[0] : slug) || "";
  if (!s) return DEFAULT_SECTION;
  return BY_SLUG[s] || null;
}

// section id → router location. The default section keeps its own slug so a
// shared link is explicit.
export function sectionLocation(id, query = {}) {
  const slug = SECTION_SLUGS[id] || SECTION_SLUGS[DEFAULT_SECTION];
  return { path: `/platform/${slug}`, query };
}
