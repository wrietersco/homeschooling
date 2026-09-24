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

// Gemini Live prebuilt voices (verified working on the Live models, 2026-09-20).
export const LIVE_VOICES = [
  "Puck", "Zephyr", "Charon", "Kore", "Fenrir", "Leda", "Orus", "Aoede", "Callirrhoe", "Autonoe",
  "Enceladus", "Iapetus", "Umbriel", "Algieba", "Despina", "Erinome", "Algenib", "Rasalgethi", "Laomedeia", "Achernar",
  "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird", "Zubenelgenubi", "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat",
];

// Where the Live prices above came from (Google's public pricing page) and when
// they were last checked — shown on the Platform screen so a stale table is obvious.
export const LIVE_PRICING_META = {
  source: "https://ai.google.dev/gemini-api/docs/pricing",
  checkedAt: "2026-09-20",
  unit: "USD per 1M tokens (paid tier); per-minute figures are Google's audio conversions",
  // Audio-only Live sessions end after ~15 minutes unless context-window
  // compression is on (it is, for Explore).
  sessionNote: "Audio-only Live sessions are capped at ~15 minutes by Google unless context-window compression is enabled (Explore enables it).",
};

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
      cost: "Medium", speed: "Fast", pricing: "$2.00 in / $10.00 out per 1M tokens (the launch intro price is now the standard price)", latency: "~2–5s",
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
  // Gemini Live (real-time voice conversation) models — used by Explore. All were
  // verified end-to-end (token → live session → spoken reply) before listing.
  //
  // `thinkingLevels` / `thinkingRequired` are the model's FEATURE SET, not a hint:
  // the Live API closes the socket on a config the model doesn't implement, so
  // every picker and the server gate on them (see liveThinkingLevels). Each flag
  // was observed by connecting for real — scripts/verifyLiveModels.mjs re-checks
  // the whole list (last run 2026-09-21: only gemini-3.8-live refuses a level).
  live: [
    {
      id: "gemini-3.8-live", label: "Gemini 3.8 Live", provider: "gemini", recommended: true, voices: LIVE_VOICES,
      status: "Stable", context: "128k tokens",
      price: { free: true, inText: 0.75, inAudio: 3.0, inVideo: 1.0, outText: 4.5, outAudio: 12.0, inAudioPerMin: 0.005, outAudioPerMin: 0.018 },
      cost: "Medium", speed: "Fast", pricing: "$3.00/M audio in · $12.00/M audio out (≈ $0.005 + $0.018 per audio minute)", latency: "~2.5–3.5s to first audio",
      quality: "Current default Live model — natural, expressive voices with low latency and no reasoning delay.",
      whenToUse: "Start here. Best balance of speed and warmth for a child's back-and-forth conversation.",
    },
    {
      id: "gemini-3.8-live-extended-thinking", label: "Gemini 3.8 Live — extended thinking", provider: "gemini", voices: LIVE_VOICES,
      thinkingLevels: ["low", "medium", "high"], thinkingRequired: true,
      // Verified 2026-09-24 (scripts/reproCelebrateError.mjs, 9 real runs at low and
      // medium): mid-lesson it tells the child "I'm sorry, a system error occurred",
      // with or without tools. Kept listed so the picker explains why, never chosen
      // automatically for "thinks harder".
      unreliable: "Tells the child “a system error occurred” mid-lesson (Google-side; verified 2026-09-24). Don't use until re-verified.",
      status: "Unreliable", context: "128k tokens",
      price: { free: true, inText: 0.75, inAudio: 3.0, inVideo: 1.0, outText: 4.5, outAudio: 12.0, inAudioPerMin: 0.005, outAudioPerMin: 0.018 },
      cost: "Medium+ (thinking tokens add to output)", speed: "Fast–medium", pricing: "Same rates as 3.8 Live; background thinking adds output tokens", latency: "~2.5–3.5s to first audio",
      quality: "Same voice quality but reasons in the background — better for maths and multi-step explanations.",
      whenToUse: "Avoid for now — it interrupts lessons with a spoken “system error”. Re-run scripts/reproCelebrateError.mjs before using it again.",
    },
    {
      id: "gemini-3.1-flash-live-preview", label: "Gemini 3.1 Flash Live (preview)", provider: "gemini", voices: LIVE_VOICES,
      thinkingLevels: ["low", "medium", "high"],
      status: "Preview", context: "128k tokens",
      price: { free: true, inText: 0.75, inAudio: 3.0, inVideo: 1.0, outText: 4.5, outAudio: 12.0, inAudioPerMin: 0.005, outAudioPerMin: 0.018 },
      cost: "Medium", speed: "Fast", pricing: "Same rates as 3.8 Live", latency: "~2.5–3s to first audio",
      quality: "Previous-generation Live model; still solid.",
      whenToUse: "Fallback if 3.8 is unavailable or misbehaves. Preview status — Google may retire it.",
    },
    {
      id: "gemini-2.5-flash-native-audio-preview-12-2025", label: "Gemini 2.5 Flash Native Audio (12-2025 preview)", provider: "gemini", voices: LIVE_VOICES,
      thinkingLevels: ["low", "medium", "high"],
      status: "Preview", context: "128k tokens",
      price: { free: true, inText: 0.5, inAudio: 3.0, inVideo: 3.0, outText: 2.0, outAudio: 12.0, inAudioPerMin: 0.0045, outAudioPerMin: 0.018, perMinEstimated: true },
      cost: "Medium", speed: "Slower start", pricing: "$3.00/M audio in · $12.00/M audio out (thinking tokens included in output price)", latency: "~5–6s to first audio",
      quality: "Older native-audio model; noticeably slower to start speaking.",
      whenToUse: "Last-resort fallback only.",
    },
    {
      id: "gemini-2.5-flash-native-audio-latest", label: "Gemini 2.5 Flash Native Audio (latest alias)", provider: "gemini", voices: LIVE_VOICES,
      thinkingLevels: ["low", "medium", "high"],
      status: "Alias", context: "128k tokens",
      price: { free: true, inText: 0.5, inAudio: 3.0, inVideo: 3.0, outText: 2.0, outAudio: 12.0, inAudioPerMin: 0.0045, outAudioPerMin: 0.018, perMinEstimated: true },
      cost: "Medium", speed: "Slower start", pricing: "Same rates as 2.5 Flash Native Audio", latency: "~5s to first audio",
      quality: "Points at Google's newest 2.5 native-audio release, so behaviour can change without notice.",
      whenToUse: "Only if you want to track Google's latest 2.5 native-audio build automatically. Prefer a pinned model for predictable behaviour.",
    },
    {
      id: "gemini-2.5-flash-native-audio-preview-09-2025", label: "Gemini 2.5 Flash Native Audio (09-2025 preview)", provider: "gemini", voices: LIVE_VOICES,
      thinkingLevels: ["low", "medium", "high"],
      status: "Preview (older)", context: "128k tokens",
      price: { free: true, inText: 0.5, inAudio: 3.0, inVideo: 3.0, outText: 2.0, outAudio: 12.0, inAudioPerMin: 0.0045, outAudioPerMin: 0.018, perMinEstimated: true },
      cost: "Medium", speed: "Slower start", pricing: "Same rates as 2.5 Flash Native Audio", latency: "~4–5s to first audio",
      quality: "Earlier snapshot of the 2.5 native-audio model.",
      whenToUse: "Legacy — only if a newer build regresses for you.",
    },
  ],
  // Other Gemini Live models the API exposes. They speak the same protocol but are
  // NOT conversational buddies, so they are listed for reference (with pricing) and
  // never offered in the Explore model pickers. Verified against the API 2026-09-20.
  liveOther: [
    {
      id: "gemini-3.5-live-translate-preview", label: "Gemini 3.5 Live Translate (preview)", status: "Preview", context: "16k tokens",
      price: { free: true, inAudio: 3.5, outAudio: 21.0, inAudioPerMin: 0.0053, outAudioPerMin: 0.0315 },
      purpose: "Real-time speech-to-speech translation. Does not hold a conversation — it translates what it hears.",
      explore: "Not usable as the buddy (no conversational reply).",
    },
    {
      id: "gemini-3.5-transcribe-live", label: "Gemini 3.5 Transcribe Live", status: "Preview", context: "128k tokens",
      price: { free: true, inAudio: 3.5, outText: 21.0, inAudioPerMin: 0.005, outTextPerMin: 0.004 },
      purpose: "Streaming speech-to-text only (no spoken output). Could power live captions of what the child says.",
      explore: "Not usable as the buddy (rejects audio replies).",
    },
    {
      id: "gemini-robotics-er-2-streaming-preview", label: "Gemini Robotics-ER 2 Streaming (preview)", status: "Preview", context: "128k tokens",
      price: null,
      purpose: "Streaming embodied-reasoning model for robotics. Pricing not published on Google's pricing page.",
      explore: "Not usable as the buddy (rejects audio replies).",
    },
  ],
  // Prebuilt TTS voices the superadmin can pick, per provider. `voices` stays the
  // Gemini list for backward-compat; the UI prefers each MODEL's own `voices`
  // (above) so tts-1/-hd only offer their 9 supported voices.
  voices: GEMINI_VOICES,
  voicesByProvider: { gemini: GEMINI_VOICES, openai: OPENAI_VOICES },
};



// ── Latest models (added 2026-09-20; each was called for real with the app's own
// clients — full tool round trips for text, real generations for image/speech). ──
const NEW_TEXT = [
  {
    id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", provider: "gemini", newest: true,
    cost: "Low–Medium", speed: "Fast", pricing: "$0.75 in / $3.75 out per 1M tokens through 2026-12-31, then $1.50 / $7.50", latency: "~1–3s",
    quality: "Google's newest stable Flash model and its recommended default; strong at agentic and long multi-step work.",
    whenToUse: "The best current Gemini for the curriculum, syllabus and content agents when quality matters. About 2.5× the price of 2.5 Flash, and the price doubles on 1 January 2027.",
  },
  {
    id: "gemini-3.7-flash", label: "Gemini 3.7 Flash", provider: "gemini",
    cost: "Low–Medium", speed: "Fast", pricing: "$0.75 in / $3.75 out per 1M tokens through 2026-12-31, then $1.50 / $7.50", latency: "~1–3s",
    quality: "Previous-generation Flash, same price as 3.8.",
    whenToUse: "Only if 3.8 behaves unexpectedly; otherwise prefer 3.8 at the same price.",
  },
  {
    id: "gemini-3.6-flash", label: "Gemini 3.6 Flash", provider: "gemini",
    cost: "Low–Medium", speed: "Fast", pricing: "$0.75 in / $3.75 out per 1M tokens through 2026-12-31, then $1.50 / $7.50", latency: "~1–3s",
    quality: "Older Flash, same price as 3.8.",
    whenToUse: "Legacy fallback — prefer 3.8.",
  },
  {
    id: "gemini-3.5-flash", label: "Gemini 3.5 Flash", provider: "gemini",
    cost: "Medium", speed: "Fast", pricing: "$1.50 in / $9.00 out per 1M tokens", latency: "~1–2s",
    quality: "Baseline 3.x Flash for routine high-throughput work.",
    whenToUse: "Rarely the right pick: dearer than 3.8 Flash until 2027 and older. Listed for completeness.",
  },
  {
    id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite", provider: "gemini",
    cost: "Low", speed: "Fastest", pricing: "$0.30 in / $2.50 out per 1M tokens", latency: "~0.5–1.5s",
    quality: "Fast and cheap, same price as 2.5 Flash but a newer model. Cannot switch thinking fully off (the app handles this).",
    whenToUse: "Good for the brief and scheduler agents when you want 3.x quality at 2.5 Flash's price.",
  },
  {
    id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite", provider: "gemini",
    cost: "Lowest", speed: "Fastest", pricing: "$0.25 in / $1.50 out per 1M tokens", latency: "~0.5–1.5s",
    quality: "Frontier-class quality for the price; the cheapest 3.x text model.",
    whenToUse: "High-volume, cost-sensitive work such as bulk content backfills.",
  },
  {
    id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (preview)", provider: "gemini",
    cost: "High", speed: "Slower", pricing: "$2.00 in / $12.00 out per 1M tokens (over 200k-token prompts: $4.00 / $18.00)", latency: "~3–8s",
    quality: "Google's strongest reasoning model. Always thinks (thinking cannot be turned off), so it costs more per answer.",
    whenToUse: "The curriculum architect when a 6-month plan has hard constraints. Preview status.",
  },
  {
    id: "gpt-6-astra", label: "OpenAI GPT-6 Astra", provider: "openai", newest: true,
    cost: "Very high", speed: "Medium", pricing: "$10.00 in / $50.00 out per 1M tokens (long context $20 / $75)", latency: "~2–6s",
    quality: "OpenAI's flagship for complex reasoning and coding; 1.05M-token context. Runs through the Responses API.",
    whenToUse: "Only for the hardest planning tasks — about 33× the price of Gemini 2.5 Flash. Not worth it for routine generation.",
  },
  {
    id: "gpt-5.6-sol", label: "OpenAI GPT-5.6 Sol", provider: "openai",
    cost: "High", speed: "Medium", pricing: "$4.00 in / $20.00 out per 1M tokens (long context $8 / $30)", latency: "~2–5s",
    quality: "Professional-grade balance of capability and cost.",
    whenToUse: "The curriculum or syllabus agent when you want OpenAI's top tier below Astra.",
  },
  {
    id: "gpt-5.6-terra", label: "OpenAI GPT-5.6 Terra", provider: "openai",
    cost: "Medium", speed: "Fast", pricing: "$2.00 in / $12.00 out per 1M tokens (long context $4 / $18)", latency: "~1–3s",
    quality: "Intelligence-and-cost balance; a strong general OpenAI choice.",
    whenToUse: "All-round OpenAI option for the content and scheduler agents.",
  },
  {
    id: "gpt-5.6-luna", label: "OpenAI GPT-5.6 Luna", provider: "openai", recommended: true,
    cost: "Low", speed: "Fast", pricing: "$0.20 in / $1.20 out per 1M tokens (long context $0.40 / $1.80)", latency: "~1–2s",
    quality: "OpenAI's cost-optimised current-generation model — a reasoning model at a low price. Runs through the Responses API.",
    whenToUse: "The default OpenAI pick for routine agents (guide, brief, content) when you want the current generation at a low price.",
  },
  {
    id: "gpt-5.5", label: "OpenAI GPT-5.5", provider: "openai",
    cost: "High", speed: "Medium", pricing: "$5.00 in / $30.00 out per 1M tokens (272K context; long $10 / $45)", latency: "~2–5s",
    quality: "Previous flagship.",
    whenToUse: "Superseded by GPT-5.6 Sol at a lower price — listed for completeness.",
  },
  {
    id: "gpt-5.4", label: "OpenAI GPT-5.4", provider: "openai",
    cost: "High", speed: "Medium", pricing: "$2.50 in / $15.00 out per 1M tokens (272K context; long $5 / $22.50)", latency: "~2–5s",
    quality: "Earlier GPT-5 generation; accepts a custom temperature.",
    whenToUse: "Only if you specifically need a model that honours temperature settings.",
  },
  {
    id: "gpt-5.4-mini", label: "OpenAI GPT-5.4 mini", provider: "openai",
    cost: "Low", speed: "Fast", pricing: "$0.75 in / $4.50 out per 1M tokens", latency: "~1–2s",
    quality: "Small GPT-5.4; dearer than GPT-5.6 Luna and older.",
    whenToUse: "Prefer GPT-5.6 Luna; kept because it honours temperature.",
  },
  {
    id: "gpt-5.4-nano", label: "OpenAI GPT-5.4 nano", provider: "openai",
    cost: "Lowest", speed: "Fastest", pricing: "$0.20 in / $1.25 out per 1M tokens", latency: "~0.5–1.5s",
    quality: "Smallest current OpenAI model; good for simple extraction and short replies.",
    whenToUse: "Very high-volume simple work.",
  },
];

const NEW_TTS = [
  {
    id: "gemini-3.1-flash-tts-preview", label: "Gemini 3.1 Flash TTS (preview)", provider: "gemini", newest: true, voices: GEMINI_VOICES,
    cost: "Higher", speed: "Medium", pricing: "$1.00 in / $20.00 out per 1M tokens", latency: "~2–5s",
    quality: "Google's newest and recommended speech model: low latency, natural pacing, same voices.",
    whenToUse: "Try it for activity audio if you want the newest Gemini voice quality. Twice the price of 2.5 Flash TTS and still in preview.",
  },
];

const NEW_IMAGE = [
  {
    id: "gemini-3.1-flash-image", label: "Gemini 3.1 Flash Image (Nano Banana 2)", provider: "gemini", recommended: true, newest: true,
    cost: "Per-image", speed: "Medium", pricing: "~$0.067 / 1K image ($0.50 in / $60 per 1M image tokens)", latency: "~6–12s",
    quality: "Google's current recommended image model: the same soft storybook look as before with better detail and character consistency. Requested at 1:1 to fit the app's layout.",
    whenToUse: "The default for storybook illustrations and picture-naming cards (it replaces the deprecated 2.5 Flash Image).",
  },
  {
    id: "gemini-3.1-flash-lite-image", label: "Gemini 3.1 Flash-Lite Image (Nano Banana 2 Lite)", provider: "gemini", newest: true,
    cost: "Per-image", speed: "Fastest", pricing: "~$0.034 / 1K image ($0.25 in / $30 per 1M image tokens)", latency: "~3–5s",
    quality: "Half the price and about 3× faster than Nano Banana 2, slightly less refined.",
    whenToUse: "Bulk picture-naming and letter-sound cards, where many simple images matter more than polish.",
  },
  {
    id: "gemini-3-pro-image", label: "Gemini 3 Pro Image (Nano Banana Pro)", provider: "gemini",
    cost: "Per-image", speed: "Slow", pricing: "~$0.134 / 1K–2K image, ~$0.24 / 4K ($2 in / $120 per 1M image tokens)", latency: "~12–20s",
    quality: "Professional-grade detail and complex scene layouts.",
    whenToUse: "Cover art or showcase illustrations. Twice the price of Nano Banana 2 and slower.",
  },
  {
    id: "gpt-image-2.5-flare", label: "OpenAI GPT Image 2.5 Flare", provider: "openai", newest: true,
    cost: "Per-image", speed: "Medium", pricing: "≈ $0.006 / 1024² image (image output $30 per 1M tokens; ~200 tokens)", latency: "~10–15s",
    quality: "OpenAI's fast everyday image model. Needs the OPENAI_API_KEY secret.",
    whenToUse: "If you prefer OpenAI's illustration style, or as a fallback if Gemini image quota is exhausted.",
  },
  {
    id: "gpt-image-2.5-sunburst", label: "OpenAI GPT Image 2.5 Sunburst", provider: "openai", newest: true,
    cost: "Per-image", speed: "Slower", pricing: "≈ $0.006 / 1024² image (same rates as Flare; higher-quality settings cost more)", latency: "~15–20s",
    quality: "OpenAI's most capable image model.",
    whenToUse: "Showcase illustrations where you want OpenAI's best.",
  },
];

// New models first within their kind (the Platform screen groups by provider but keeps this order).
MODEL_CATALOG.text.unshift(...NEW_TEXT);
MODEL_CATALOG.tts.unshift(...NEW_TTS);
MODEL_CATALOG.image.unshift(...NEW_IMAGE);
// Nano Banana 2 is the recommended image model now; 2.5 is being retired.
for (const m of MODEL_CATALOG.image) if (m.id === "gemini-2.5-flash-image") delete m.recommended;
// GPT-5.6 Luna is the current low-cost OpenAI pick (GPT-4o mini stays available).
for (const m of MODEL_CATALOG.text) if (m.id === "gpt-4o-mini") delete m.recommended;

// ── Published prices for every text / speech / image model, and availability ───
// USD. `in`/`out` are per 1M tokens; `cachedIn` per 1M cached input tokens;
// `perImage` per generated image; `perMChars` per 1M characters (OpenAI tts-1*).
// Verified against each provider's pricing page on PRICING_META.checkedAt; the
// availability flags were verified by calling the API (a retired model returns 404).
export const PRICING_META = {
  checkedAt: "2026-09-20",
  sources: {
    gemini: "https://ai.google.dev/gemini-api/docs/pricing",
    openai: "https://developers.openai.com/api/docs/pricing",
    anthropic: "https://platform.claude.com/docs/en/about-claude/pricing",
  },
};

const PRICE_TABLE = {
  // text
  "gemini-2.5-flash": { in: 0.3, out: 2.5, audioIn: 1.0, note: "Audio input is $1.00/M." },
  "gemini-2.5-flash-lite": { in: 0.1, out: 0.4, audioIn: 0.3 },
  "gemini-2.5-pro": { in: 1.25, out: 10.0, note: "Prompts over 200k tokens: $2.50 in / $15.00 out." },
  "gemini-2.0-flash": { in: 0.1, out: 0.4 },
  "gpt-4o-mini": { in: 0.15, out: 0.6, cachedIn: 0.075 },
  "gpt-4.1-mini": { in: 0.4, out: 1.6, cachedIn: 0.1 },
  "gpt-4o": { in: 2.5, out: 10.0, cachedIn: 1.25 },
  "gpt-4.1": { in: 2.0, out: 8.0, cachedIn: 0.5 },
  "claude-sonnet-5": { in: 2.0, out: 10.0, cachedIn: 0.2, note: "Launch intro price ($2/$10) is now permanent; the planned rise to $3/$15 was cancelled." },
  "claude-opus-4-8": { in: 5.0, out: 25.0, cachedIn: 0.5 },
  "gemini-3.8-flash": { in: 0.75, out: 3.75, cachedIn: 0.075, until: "2026-12-31", then: { in: 1.5, out: 7.5, cachedIn: 0.15 }, note: "Intro price through 2026-12-31; doubles on 2027-01-01." },
  "gemini-3.7-flash": { in: 0.75, out: 3.75, cachedIn: 0.075, until: "2026-12-31", then: { in: 1.5, out: 7.5, cachedIn: 0.15 }, note: "Intro price through 2026-12-31; doubles on 2027-01-01." },
  "gemini-3.6-flash": { in: 0.75, out: 3.75, cachedIn: 0.075, until: "2026-12-31", then: { in: 1.5, out: 7.5, cachedIn: 0.15 }, note: "Intro price through 2026-12-31; doubles on 2027-01-01." },
  "gemini-3.5-flash": { in: 1.5, out: 9.0, cachedIn: 0.15 },
  "gemini-3.5-flash-lite": { in: 0.3, out: 2.5, cachedIn: 0.03 },
  "gemini-3.1-flash-lite": { in: 0.25, out: 1.5, cachedIn: 0.025, audioIn: 0.5, note: "Audio input is $0.50/M." },
  "gemini-3.1-pro-preview": { in: 2.0, out: 12.0, cachedIn: 0.2, note: "Prompts over 200k tokens: $4.00 in / $18.00 out." },
  "gpt-6-astra": { in: 10.0, out: 50.0, cachedIn: 1.0, note: "Long context: $20 in / $75 out." },
  "gpt-5.6-sol": { in: 4.0, out: 20.0, cachedIn: 0.4, note: "Long context: $8 in / $30 out." },
  "gpt-5.6-terra": { in: 2.0, out: 12.0, cachedIn: 0.2, note: "Long context: $4 in / $18 out." },
  "gpt-5.6-luna": { in: 0.2, out: 1.2, cachedIn: 0.02, note: "Long context: $0.40 in / $1.80 out." },
  "gpt-5.5": { in: 5.0, out: 30.0, cachedIn: 0.5, note: "Long context: $10 in / $45 out." },
  "gpt-5.4": { in: 2.5, out: 15.0, cachedIn: 0.25, note: "Long context: $5 in / $22.50 out." },
  "gpt-5.4-mini": { in: 0.75, out: 4.5, cachedIn: 0.075 },
  "gpt-5.4-nano": { in: 0.2, out: 1.25, cachedIn: 0.02 },
  // speech
  "gemini-3.1-flash-tts-preview": { in: 1.0, out: 20.0, note: "Input is text; output is audio." },
  "gemini-2.5-flash-preview-tts": { in: 0.5, out: 10.0, note: "Input is text; output is audio." },
  "gemini-2.5-pro-preview-tts": { in: 1.0, out: 20.0, note: "Input is text; output is audio." },
  "gpt-4o-mini-tts": { in: 0.6, out: 12.0, note: "Output is audio (≈ $0.015 per minute)." },
  "tts-1": { perMChars: 15.0 },
  "tts-1-hd": { perMChars: 30.0 },
  // image
  "gemini-3.1-flash-image": { in: 0.5, perImage: 0.067, note: "1K image; 0.5K $0.045, 2K $0.101, 4K $0.151." },
  "gemini-3.1-flash-lite-image": { in: 0.25, perImage: 0.0336, note: "1K image." },
  "gemini-3-pro-image": { in: 2.0, perImage: 0.134, note: "1K/2K image; 4K $0.24." },
  "gpt-image-2.5-flare": { perImage: 0.006, note: "Estimate for a 1024×1024 image at default quality (image output $30/M tokens)." },
  "gpt-image-2.5-sunburst": { perImage: 0.006, note: "Estimate for a 1024×1024 image at default quality (image output $30/M tokens)." },
  "gemini-2.5-flash-image": { in: 0.3, perImage: 0.039 },
  "imagen-4.0-fast-generate-001": { perImage: 0.02 },
  "imagen-4.0-generate-001": { perImage: 0.04 },
  "imagen-4.0-ultra-generate-001": { perImage: 0.06 },
  "imagen-3.0-generate-002": { perImage: 0.04 },
};

// state: "ok" | "deprecating" | "unavailable" — see the note for the evidence.
const AVAILABILITY = {
  "gemini-2.0-flash": { state: "unavailable", note: "Google now answers 404 “no longer available”. Choosing it makes every call with that agent fail." },
  "gemini-2.5-flash-image": { state: "deprecating", date: "2026-10-02", note: "Google shuts this model down on 2 October 2026. The app switches to Gemini 3.1 Flash Image automatically on that date if it is still selected." },
  "imagen-4.0-fast-generate-001": { state: "unavailable", note: "Not served by the Gemini API any more (404), and absent from Google's pricing page." },
  "imagen-4.0-generate-001": { state: "unavailable", note: "Not served by the Gemini API any more (404), and absent from Google's pricing page." },
  "imagen-4.0-ultra-generate-001": { state: "unavailable", note: "Not served by the Gemini API any more (404), and absent from Google's pricing page." },
  "imagen-3.0-generate-002": { state: "unavailable", note: "Not served by the Gemini API any more (404), and absent from Google's pricing page." },
};

for (const kind of ["text", "tts", "image"]) {
  for (const m of MODEL_CATALOG[kind] || []) {
    m.price = PRICE_TABLE[m.id] || null;
    m.availability = AVAILABILITY[m.id] || { state: "ok" };
  }
}
for (const m of MODEL_CATALOG.live) m.availability = { state: "ok" };

// ── Live-model capabilities ──────────────────────────────────────────────────
// A Live model only accepts the features it declares. The Live API hard-rejects a
// session config carrying a feature the model doesn't implement — sending a
// thinking level to a non-thinking model closes the socket with "Thinking level is
// not supported for this model" — so the catalog entry is the single source of
// truth: every picker (superadmin and parent) and the server itself filter on
// these helpers instead of pattern-matching model ids.
export function liveModelById(id) {
  const key = String(id || "");
  return MODEL_CATALOG.live.find((m) => m.id === key) || null;
}

// The thinking levels a Live model accepts; [] when it has no thinking at all.
// An id that isn't in the catalog (a newer model a superadmin pinned by hand) is
// judged by its name so a genuinely new thinking model still works.
export function liveThinkingLevels(id) {
  const m = liveModelById(id);
  if (m) return m.thinkingLevels ? [...m.thinkingLevels] : [];
  return /thinking/i.test(String(id || "")) ? ["low", "medium", "high"] : [];
}

// True when the model REFUSES to start without a thinking level (extended-thinking
// Live models), so the server must supply a default rather than omit it.
export function liveRequiresThinking(id) {
  const m = liveModelById(id);
  if (m) return !!m.thinkingRequired;
  return /extended-thinking/i.test(String(id || ""));
}

// The prebuilt voices a Live model supports (all 30 unless it narrows them).
export function liveVoicesFor(id) {
  const m = liveModelById(id);
  return m?.voices?.length ? [...m.voices] : [...LIVE_VOICES];
}

// Conversational Live models that can reason before answering, best first.
export function thinkingLiveModels() {
  return MODEL_CATALOG.live.filter((m) => m.thinkingLevels?.length && !m.unreliable);
}

// A Live model verified to misbehave in real sessions (see `unreliable` above).
export function liveModelUnreliable(id) {
  return !!liveModelById(id)?.unreliable;
}

// Which capability bucket an agent draws its models from.
export function capabilityForAgent(agentKey) {
  if (agentKey === "tts") return "tts";
  if (agentKey === "image") return "image";
  if (agentKey === "explore") return "live";
  return "text";
}

// ── Retired models → automatic replacement ─────────────────────────────────────
// A superadmin may have saved one of these into the Platform config (saving "all
// agent settings" stores every agent's model). Rather than letting every call fail
// after the provider retires it, the config resolves to the replacement from the
// date given (or immediately when `from` is omitted, i.e. it is already dead).
export const RETIRED_MODELS = {
  "gemini-2.0-flash": { replacement: "gemini-2.5-flash" },
  "gemini-2.5-flash-image": { replacement: "gemini-3.1-flash-image", from: "2026-10-02" },
  "imagen-4.0-fast-generate-001": { replacement: "gemini-3.1-flash-lite-image" },
  "imagen-4.0-generate-001": { replacement: "gemini-3.1-flash-image" },
  "imagen-4.0-ultra-generate-001": { replacement: "gemini-3-pro-image" },
  "imagen-3.0-generate-002": { replacement: "gemini-3.1-flash-image" },
};

// The replacement for `model` on `now`, or null when it is still usable.
export function replacementForRetired(model, now = new Date()) {
  const r = RETIRED_MODELS[String(model || "")];
  if (!r) return null;
  if (r.from && now.toISOString().slice(0, 10) < r.from) return null;
  return r.replacement;
}
