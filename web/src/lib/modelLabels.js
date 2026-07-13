// Friendly display names for the text-provider/model that generated a piece of
// activity content — shown as a small badge wherever an activity's content
// appears (ActivityView, the player views, the syllabus library). Static, no
// network call, so it works for every family member (not just superadmins, who
// are the only ones who can call getModelCatalog).

export const PROVIDER_LABELS = {
  gemini: "Google Gemini",
  openai: "OpenAI",
  anthropic: "Anthropic Claude",
};

// Short model labels, mirroring functions/agents/modelCatalog.js. Falls back to
// the raw model id when a model isn't in this table (e.g. a custom id a
// superadmin typed in directly) so the badge never renders blank for real data.
export const MODEL_LABELS = {
  "gemini-2.5-flash": "Gemini 2.5 Flash",
  "gemini-2.5-pro": "Gemini 2.5 Pro",
  "gemini-2.5-flash-lite": "Gemini 2.5 Flash-Lite",
  "gemini-2.0-flash": "Gemini 2.0 Flash",
  "gpt-4o-mini": "GPT-4o mini",
  "gpt-4.1-mini": "GPT-4.1 mini",
  "gpt-4o": "GPT-4o",
  "gpt-4.1": "GPT-4.1",
  "claude-sonnet-5": "Claude Sonnet 5",
  "claude-opus-4-8": "Claude Opus 4.8",
};

// A short CSS-class-friendly key per provider, for color-coding the badge.
export function providerClass(provider) {
  return PROVIDER_LABELS[provider] ? provider : "unknown";
}

// { text, title } for a small badge — `text` is the short model label (or the
// raw id if unrecognized), `title` is the full "<Model> (<Provider>)" tooltip.
// Returns null when there's nothing to show (no provider recorded — e.g. an
// activity generated before this tracking existed), so callers can render
// nothing rather than guessing.
export function describeContentProvider(provider, model) {
  if (!provider) return null;
  const providerLabel = PROVIDER_LABELS[provider] || provider;
  const modelLabel = (model && MODEL_LABELS[model]) || model || providerLabel;
  return { text: modelLabel, title: `${modelLabel} (${providerLabel})`, providerClass: providerClass(provider) };
}
