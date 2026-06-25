// Curated catalog of vetted models per capability, with rough cost / speed /
// quality notes — plus published per-unit pricing, typical latency, and a
// project-specific "when to use" suggestion — so the superadmin can make an
// informed choice (and preview / health-check before changes go live). Notes are
// guidance; the authoritative billed rate lives in costMeter.DEFAULT_PRICING and
// the platform/pricing override doc.
//
// Field reference (all optional except id/label):
//   cost/speed/quality — short relative labels for at-a-glance chips
//   pricing            — human per-unit price string (matches costMeter rates)
//   latency            — rough wall-clock for one call
//   whenToUse          — when to pick this model *in this homeschool app*
//   recommended        — the sane default for its bucket (one per bucket)
export const MODEL_CATALOG = {
  text: [
    {
      id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", recommended: true,
      cost: "Low", speed: "Fast", pricing: "$0.30 in / $2.50 out per 1M tokens", latency: "~1–3s",
      quality: "Great all-round quality at low cost — the default for every text agent.",
      whenToUse: "Start here for all text agents (guide, syllabus, content, scheduler, brief). Fast, cheap, and strong enough for almost everything in the app.",
    },
    {
      id: "gemini-2.5-pro", label: "Gemini 2.5 Pro",
      cost: "High", speed: "Slower", pricing: "$1.25 in / $10.00 out per 1M tokens", latency: "~4–10s",
      quality: "Best reasoning; handles the hardest multi-constraint tasks.",
      whenToUse: "Only for the curriculum architect when a 6-month plan has tricky constraints the Flash model fumbles. ~4× the price and noticeably slower — not worth it for routine generation.",
    },
    {
      id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite",
      cost: "Lowest", speed: "Fastest", pricing: "$0.10 in / $0.40 out per 1M tokens", latency: "~0.5–2s",
      quality: "Cheapest and fastest; lighter reasoning.",
      whenToUse: "High-volume, simple jobs where cost dominates — bulk syllabus rows or short rewrites. Avoid for content that needs careful Quran/pedagogy grounding.",
    },
    {
      id: "gemini-2.0-flash", label: "Gemini 2.0 Flash",
      cost: "Low", speed: "Fast", pricing: "$0.10 in / $0.40 out per 1M tokens", latency: "~1–3s",
      quality: "Solid previous-gen workhorse.",
      whenToUse: "Fallback if 2.5 Flash regresses or is unavailable in your region. Cheap and stable, but prefer 2.5 Flash when you can.",
    },
  ],
  tts: [
    {
      id: "gemini-2.5-flash-preview-tts", label: "Gemini 2.5 Flash TTS", recommended: true,
      cost: "Low", speed: "Medium", pricing: "$0.50 in / $10.00 out per 1M tokens", latency: "~2–5s",
      quality: "Natural multilingual voices — handles Arabic recitation and English narration well.",
      whenToUse: "Recommended for all activity narration (word/sentence/paragraph audio, parent tips). Good fidelity at a fraction of the Pro price.",
    },
    {
      id: "gemini-2.5-pro-preview-tts", label: "Gemini 2.5 Pro TTS",
      cost: "Higher", speed: "Slower", pricing: "$1.00 in / $20.00 out per 1M tokens", latency: "~4–8s",
      quality: "Highest-fidelity speech with the most natural prosody.",
      whenToUse: "Only when you want premium recitation quality for showcase content. ~2× the cost and slower — overkill for everyday narration.",
    },
  ],
  image: [
    {
      id: "gemini-2.5-flash-image", label: "Gemini 2.5 Flash Image (Nano Banana)", recommended: true,
      cost: "Per-image", speed: "Medium", pricing: "~$0.039 / image", latency: "~6–12s",
      quality: "Conversational image model — keeps the same character consistent across pages and follows narrative scenes; supports edits.",
      whenToUse: "Recommended for storybook illustrations. Its strength is character consistency across a multi-page story and scene-following — exactly what reading activities need. Also used for picture-naming cards.",
    },
    {
      id: "imagen-4.0-fast-generate-001", label: "Imagen 4 Fast",
      cost: "Per-image", speed: "Fastest", pricing: "~$0.02 / image", latency: "~2–4s",
      quality: "Quick, clean single-subject images; less control over fine narrative detail.",
      whenToUse: "Bulk picture-naming / letter-sound cards where you generate many simple single-object pictures and speed + cost matter more than story continuity. Cheapest option.",
    },
    {
      id: "imagen-4.0-generate-001", label: "Imagen 4",
      cost: "Per-image", speed: "Medium", pricing: "~$0.04 / image", latency: "~5–8s",
      quality: "Crisp, high-fidelity single images with strong prompt adherence.",
      whenToUse: "When you want sharper, more detailed standalone illustrations than Nano Banana and don't need character consistency across pages.",
    },
    {
      id: "imagen-4.0-ultra-generate-001", label: "Imagen 4 Ultra",
      cost: "Per-image", speed: "Slow", pricing: "~$0.06 / image", latency: "~8–15s",
      quality: "Best detail and prompt adherence of the Imagen line.",
      whenToUse: "Showcase or cover art where quality and faithful prompt-following matter most. Slowest and priciest — not for bulk generation.",
    },
    {
      id: "imagen-3.0-generate-002", label: "Imagen 3",
      cost: "Per-image", speed: "Medium", pricing: "~$0.04 / image", latency: "~5–8s",
      quality: "Stable previous-generation image model.",
      whenToUse: "Fallback if Imagen 4 variants are unavailable in your region. Reliable, but prefer Imagen 4 or Nano Banana when available.",
    },
  ],
  // Prebuilt Gemini TTS voices the superadmin can pick for the tts agent.
  voices: ["Kore", "Puck", "Charon", "Aoede", "Fenrir", "Leda", "Orus", "Zephyr"],
};

// Which capability bucket an agent draws its models from.
export function capabilityForAgent(agentKey) {
  if (agentKey === "tts") return "tts";
  if (agentKey === "image") return "image";
  return "text";
}
