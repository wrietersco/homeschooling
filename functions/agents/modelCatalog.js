// Curated catalog of vetted models per capability, with rough cost / speed /
// quality notes so the superadmin can make an informed choice (and preview /
// health-check before changes go live). Notes are guidance, not billing data.
export const MODEL_CATALOG = {
  text: [
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", cost: "Low", speed: "Fast", quality: "Great all-round — recommended default." },
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", cost: "High", speed: "Slower", quality: "Best reasoning; use for the hardest tasks." },
    { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite", cost: "Lowest", speed: "Fastest", quality: "Cheapest; good for simple/bulk tasks." },
    { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", cost: "Low", speed: "Fast", quality: "Solid previous-gen workhorse." },
  ],
  tts: [
    { id: "gemini-2.5-flash-preview-tts", label: "Gemini 2.5 Flash TTS", cost: "Low", speed: "Medium", quality: "Natural multilingual voices — recommended." },
    { id: "gemini-2.5-pro-preview-tts", label: "Gemini 2.5 Pro TTS", cost: "Higher", speed: "Slower", quality: "Highest-fidelity speech." },
  ],
  image: [
    { id: "gemini-2.5-flash-image", label: "Gemini 2.5 Flash Image", cost: "Per-image", speed: "Slow", quality: "Gentle storybook illustrations." },
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
