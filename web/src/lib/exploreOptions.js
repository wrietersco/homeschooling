import { CELEBRATION_VALUES, DEFAULT_CELEBRATION } from "./celebration";

// Choices a parent can make for the Explore buddy. The server re-validates every
// value (voices must be from its verified list; there is no raw model id here).
//
// WHAT THE PANEL MAY OFFER depends on the Live model the superadmin configured:
// a model without extended thinking rejects a thinking level outright, so the
// server sends `capabilities` alongside the settings and the panel only shows
// controls the current models can honour. These constants are the fallback used
// until (or if) those capabilities arrive.
export const LIVE_VOICES = [
  "Puck", "Zephyr", "Charon", "Kore", "Fenrir", "Leda", "Orus", "Aoede", "Callirrhoe", "Autonoe",
  "Enceladus", "Iapetus", "Umbriel", "Algieba", "Despina", "Erinome", "Algenib", "Rasalgethi", "Laomedeia", "Achernar",
  "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird", "Zubenelgenubi", "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat",
];

export const NOTES_MAX = 500;
export const AVOID_MAX = 300;

// How the parents want the buddy to speak. These are delivery choices, not model
// features, so they are never capability-gated — every Live model honours them
// because they are compiled into the system instruction as hard directives.
export const PACES = [
  { value: "normal", label: "Normal" },
  { value: "slow", label: "Slow, with pauses" },
];
export const REPLY_LENGTHS = [
  { value: "normal", label: "Normal (1–3 sentences)" },
  { value: "short", label: "Short (1–2 sentences)" },
  { value: "tiny", label: "Very little (one sentence, then listen)" },
];
export const LANGUAGES = [
  { value: "auto", label: "Follow the child" },
  { value: "english", label: "English only" },
  { value: "urdu", label: "Urdu only" },
  { value: "arabic", label: "Arabic only" },
];
const valuesOf = (list) => list.map((o) => o.value);

export const DEFAULT_SETTINGS = {
  voiceName: "Puck",
  learnStyle: "thinking", // "fast" | "thinking"
  thinkingLevel: "medium", // only used when learnStyle === "thinking"
  sessionMinutes: 20,
  pace: "normal",
  replyLength: "normal",
  language: "auto",
  avoid: "",
  notes: "",
  celebration: DEFAULT_CELEBRATION,
};

// What the platform's currently configured models support. Assume the full set
// until the server says otherwise, so a slow read never hides a working control.
export const DEFAULT_CAPABILITIES = {
  voices: LIVE_VOICES,
  canThink: true,
  thinkingLevels: ["low", "medium", "high"],
  maxMinutes: 30,
};

export function normalizeCapabilities(raw = {}) {
  const c = { ...DEFAULT_CAPABILITIES };
  if (Array.isArray(raw.voices) && raw.voices.length) c.voices = raw.voices.filter((v) => typeof v === "string");
  if (typeof raw.canThink === "boolean") c.canThink = raw.canThink;
  if (Array.isArray(raw.thinkingLevels)) c.thinkingLevels = raw.thinkingLevels.filter((l) => ["low", "medium", "high"].includes(l));
  const m = Math.round(Number(raw.maxMinutes));
  if (Number.isFinite(m) && m > 0) c.maxMinutes = Math.max(5, Math.min(30, m));
  if (!c.thinkingLevels.length) c.canThink = false;
  return c;
}

// Fill gaps with defaults and clamp to the allowed ranges — and to what the
// configured models actually support, so a setting the buddy would choke on is
// never sent (a thinking level only exists for models that can think).
export function normalizeSettings(raw = {}, caps = DEFAULT_CAPABILITIES) {
  const c = normalizeCapabilities(caps);
  const s = { ...DEFAULT_SETTINGS };
  if (c.voices.includes(raw.voiceName)) s.voiceName = raw.voiceName;
  else if (!c.voices.includes(s.voiceName)) s.voiceName = c.voices[0];
  if (raw.learnStyle === "fast" || raw.learnStyle === "thinking") s.learnStyle = raw.learnStyle;
  if (!c.canThink) s.learnStyle = "fast";
  if (c.thinkingLevels.includes(raw.thinkingLevel)) s.thinkingLevel = raw.thinkingLevel;
  else if (!c.thinkingLevels.includes(s.thinkingLevel)) s.thinkingLevel = c.thinkingLevels[0] || "";
  const m = Math.round(Number(raw.sessionMinutes));
  if (Number.isFinite(m) && m > 0) s.sessionMinutes = Math.max(5, Math.min(30, m));
  if (valuesOf(PACES).includes(raw.pace)) s.pace = raw.pace;
  if (valuesOf(REPLY_LENGTHS).includes(raw.replyLength)) s.replyLength = raw.replyLength;
  if (valuesOf(LANGUAGES).includes(raw.language)) s.language = raw.language;
  if (CELEBRATION_VALUES.includes(raw.celebration)) s.celebration = raw.celebration;
  if (typeof raw.avoid === "string") s.avoid = raw.avoid.slice(0, AVOID_MAX);
  if (typeof raw.notes === "string") s.notes = raw.notes.slice(0, NOTES_MAX);
  return s;
}
