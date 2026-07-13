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
// Prebuilt voices per provider, sourced from the providers' TTS docs.
//   Gemini: 8 prebuilt voices (same set for every Gemini TTS model).
//   OpenAI: 13 voices, but the legacy per-character models (tts-1 / tts-1-hd)
//   support only 9 of them — ballad/verse/marin/cedar are gpt-4o-mini-tts-only.
//   (Ref: developers.openai.com/api/docs/guides/text-to-speech — "marin"/"cedar"
//   are the recommended highest-quality voices.)
export const GEMINI_VOICES = ["Kore", "Puck", "Charon", "Aoede", "Fenrir", "Leda", "Orus", "Zephyr"];
export const OPENAI_VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse", "marin", "cedar"];
export const OPENAI_VOICES_LEGACY = ["alloy", "ash", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer"]; // tts-1 / tts-1-hd

export const MODEL_CATALOG = {
  text: [
    {
      id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: "gemini", recommended: true,
      cost: "Low", speed: "Fast", pricing: "$0.30 in / $2.50 out per 1M tokens", latency: "~1–3s",
      quality: "Great all-round quality at low cost — the default for every text agent.",
      whenToUse: "Start here for all text agents (guide, syllabus, content, scheduler, brief). Fast, cheap, and strong enough for almost everything in the app.",
    },
    {
      id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", provider: "gemini",
      cost: "High", speed: "Slower", pricing: "$1.25 in / $10.00 out per 1M tokens", latency: "~4–10s",
      quality: "Best reasoning; handles the hardest multi-constraint tasks.",
      whenToUse: "Only for the curriculum architect when a 6-month plan has tricky constraints the Flash model fumbles. ~4× the price and noticeably slower — not worth it for routine generation.",
    },
    {
      id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite", provider: "gemini",
      cost: "Lowest", speed: "Fastest", pricing: "$0.10 in / $0.40 out per 1M tokens", latency: "~0.5–2s",
      quality: "Cheapest and fastest; lighter reasoning.",
      whenToUse: "High-volume, simple jobs where cost dominates — bulk syllabus rows or short rewrites. Avoid for content that needs careful Quran/pedagogy grounding.",
    },
    {
      id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", provider: "gemini",
      cost: "Low", speed: "Fast", pricing: "$0.10 in / $0.40 out per 1M tokens", latency: "~1–3s",
      quality: "Solid previous-gen workhorse.",
      whenToUse: "Fallback if 2.5 Flash regresses or is unavailable in your region. Cheap and stable, but prefer 2.5 Flash when you can.",
    },
    {
      id: "gpt-4o-mini", label: "OpenAI GPT-4o mini", provider: "openai", recommended: true,
      cost: "Low", speed: "Fast", pricing: "$0.15 in / $0.60 out per 1M tokens", latency: "~1–3s",
      quality: "Cheap, fast OpenAI workhorse — strong instruction-following and tool use for routine agents.",
      whenToUse: "The OpenAI default. Pick when you want an OpenAI model (or a fallback if Gemini is unavailable). Comparable quality to Gemini Flash for scheduling/Q&A at a similar price.",
    },
    {
      id: "gpt-4.1-mini", label: "OpenAI GPT-4.1 mini", provider: "openai",
      cost: "Low", speed: "Fast", pricing: "$0.40 in / $1.60 out per 1M tokens", latency: "~1–3s",
      quality: "Sharper reasoning than 4o-mini while still inexpensive; reliable tool calling.",
      whenToUse: "When 4o-mini fumbles a multi-constraint task and you want a step up without paying for the full 4o/4.1 models.",
    },
    {
      id: "gpt-4o", label: "OpenAI GPT-4o", provider: "openai",
      cost: "High", speed: "Medium", pricing: "$2.50 in / $10.00 out per 1M tokens", latency: "~2–6s",
      quality: "Flagship multimodal model; best general OpenAI reasoning.",
      whenToUse: "Only for the hardest tasks where the mini models fall short. ~16× the price of 4o-mini — not worth it for routine generation.",
    },
    {
      id: "gpt-4.1", label: "OpenAI GPT-4.1", provider: "openai",
      cost: "High", speed: "Medium", pricing: "$2.00 in / $8.00 out per 1M tokens", latency: "~2–6s",
      quality: "Strongest OpenAI instruction-following with a large context window.",
      whenToUse: "Heavy long-context or multi-constraint work where the mini models struggle. Pricey — reserve for the few tasks that need it.",
    },
    {
      id: "claude-sonnet-5", label: "Claude Sonnet 5", provider: "anthropic", recommended: true,
      cost: "Medium", speed: "Fast", pricing: "$3.00 in / $15.00 out per 1M tokens (intro $2.00 / $10.00 through 2026-08-31)", latency: "~2–5s",
      quality: "Near-Opus quality on coding/agentic and structured tool-call output — Anthropic's best price/quality balance.",
      whenToUse: "The Claude default for curriculum, planning (scheduler), activity content, and syllabus generation. Strong structured JSON/tool-call output and pedagogy reasoning at a sustainable cost.",
    },
    {
      id: "claude-opus-4-8", label: "Claude Opus 4.8", provider: "anthropic",
      cost: "High", speed: "Slower", pricing: "$5.00 in / $25.00 out per 1M tokens", latency: "~4–10s",
      quality: "Anthropic's most capable Opus-tier model — best long-horizon reasoning, knowledge work, and multi-constraint planning.",
      whenToUse: "Reserve for the curriculum architect on a hard multi-constraint 6-month plan, or when Sonnet 5 output needs a quality step-up. ~1.7–2.5× the price of Sonnet 5 — not worth it for routine generation.",
    },
  ],
  tts: [
    {
      id: "gemini-2.5-flash-preview-tts", label: "Gemini 2.5 Flash TTS", provider: "gemini", recommended: true, voices: GEMINI_VOICES,
      cost: "Low", speed: "Medium", pricing: "$0.50 in / $10.00 out per 1M tokens", latency: "~2–5s",
      quality: "Natural multilingual voices — handles Arabic recitation and English narration well.",
      whenToUse: "Recommended for all activity narration (word/sentence/paragraph audio, parent tips). Good fidelity at a fraction of the Pro price.",
    },
    {
      id: "gemini-2.5-pro-preview-tts", label: "Gemini 2.5 Pro TTS", provider: "gemini", voices: GEMINI_VOICES,
      cost: "Higher", speed: "Slower", pricing: "$1.00 in / $20.00 out per 1M tokens", latency: "~4–8s",
      quality: "Highest-fidelity speech with the most natural prosody.",
      whenToUse: "Only when you want premium recitation quality for showcase content. ~2× the cost and slower — overkill for everyday narration.",
    },
    {
      id: "gpt-4o-mini-tts", label: "OpenAI GPT-4o mini TTS", provider: "openai", recommended: true, voices: OPENAI_VOICES,
      cost: "Low", speed: "Fast", pricing: "$0.60 in / $12.00 out per 1M tokens (~$0.015/min)", latency: "~1–3s",
      quality: "Steerable, natural English narration; all 13 voices incl. the recommended marin / cedar.",
      whenToUse: "Pick when you want OpenAI voices or a fallback if Gemini TTS quota is exhausted. Paid per use (no free RPD pool), so it isn't rate-limited by the daily Gemini quota.",
    },
    {
      id: "tts-1", label: "OpenAI TTS-1", provider: "openai", voices: OPENAI_VOICES_LEGACY,
      cost: "Low", speed: "Fastest", pricing: "$15.00 per 1M characters", latency: "~1–2s",
      quality: "Solid, low-latency English speech; less expressive than GPT-4o mini TTS.",
      whenToUse: "Cheapest OpenAI option for plain English narration where latency matters most. Weaker on non-English text than Gemini.",
    },
    {
      id: "tts-1-hd", label: "OpenAI TTS-1 HD", provider: "openai", voices: OPENAI_VOICES_LEGACY,
      cost: "Higher", speed: "Medium", pricing: "$30.00 per 1M characters", latency: "~2–4s",
      quality: "Higher-fidelity variant of TTS-1.",
      whenToUse: "When you want crisper OpenAI audio for showcase English content and don't mind ~2× the TTS-1 price.",
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
  // Prebuilt TTS voices the superadmin can pick, per provider. `voices` stays the
  // Gemini list for backward-compat; the UI prefers each MODEL's own `voices`
  // (above) so tts-1/-hd only offer their 9 supported voices.
  voices: GEMINI_VOICES,
  voicesByProvider: { gemini: GEMINI_VOICES, openai: OPENAI_VOICES },
};

// Which capability bucket an agent draws its models from.
export function capabilityForAgent(agentKey) {
  if (agentKey === "tts") return "tts";
  if (agentKey === "image") return "image";
  return "text";
}
