<script setup>
// A small tappable speaker button. Reads `text` aloud in `lang` when pressed.
// Used at word, sentence, and paragraph levels throughout the activity content.
import { computed } from "vue";
import { useSpeech } from "@/composables/useSpeech";

const props = defineProps({
  text: { type: String, required: true },
  lang: { type: String, default: "en" },
  // Optional recorded audio (e.g. real qirat). Played in preference to TTS;
  // falls back to TTS if it can't load.
  audioUrl: { type: String, default: "" },
  // visual size: "sm" (inline word), "md" (sentence), "lg" (paragraph/card)
  size: { type: String, default: "md" },
  label: { type: String, default: "" },
  rate: { type: Number, default: 0.85 },
  // Optional Gemini voice name (used to give dialogue characters distinct voices).
  voiceName: { type: String, default: "" },
});

const { supported, speakingId, loadingId, speak, playAudio, stop } = useSpeech();

// Unique-ish id per text+lang+voice so the active chunk highlights while playing
// (different-voice buttons for the same line must not collide).
const speakId = computed(() => `${props.lang}:${props.voiceName}:${props.audioUrl || props.text}`);
const active = computed(() => speakingId.value === speakId.value);
// True while the Gemini audio for THIS button is being fetched.
const loading = computed(() => loadingId.value === speakId.value);

// Usable whenever there's recorded audio, server TTS (signed-in), or a browser
// voice. Since text is always present and Gemini TTS covers it, show the button.
const usable = computed(() => Boolean(props.audioUrl) || Boolean(props.text) || supported.value);

function onClick() {
  if (active.value) { stop(); return; }
  if (props.audioUrl) {
    playAudio(props.audioUrl, {
      id: speakId.value,
      onError: () => speak(props.text, props.lang, { id: speakId.value, rate: props.rate, voiceName: props.voiceName }),
    });
  } else {
    speak(props.text, props.lang, { id: speakId.value, rate: props.rate, voiceName: props.voiceName });
  }
}
</script>

<template>
  <button
    v-if="usable"
    type="button"
    class="speak-btn"
    :class="[`size-${size}`, { active, loading }]"
    :aria-label="label || `Listen: ${text}`"
    :title="loading ? 'Preparing audio…' : (label || 'Listen')"
    :aria-busy="loading"
    @click.stop="onClick"
  >
    <span v-if="loading" class="spin" aria-hidden="true"></span>
    <span v-else class="ico">{{ active ? "⏸" : "🔊" }}</span>
    <span v-if="label" class="lbl">{{ loading ? "Preparing…" : label }}</span>
  </button>
</template>

<style scoped>
.speak-btn {
  display: inline-flex; align-items: center; gap: 0.3rem;
  border: 1px solid #cbd5e1; background: #fff; color: #334155;
  border-radius: 999px; cursor: pointer; line-height: 1;
  transition: background 0.12s, border-color 0.12s, transform 0.08s;
  vertical-align: middle;
}
.speak-btn:hover { background: #f1f5f9; }
.speak-btn:active { transform: scale(0.94); }
.speak-btn.active { background: #0b1f3a; border-color: #0b1f3a; color: #fff; }

.size-sm { padding: 0.05rem 0.3rem; font-size: 0.7rem; }
.size-md { padding: 0.2rem 0.5rem; font-size: 0.85rem; }
.size-lg { padding: 0.35rem 0.7rem; font-size: 1rem; }

.ico { line-height: 1; }
.lbl { font-weight: 600; white-space: nowrap; }

.speak-btn.loading { opacity: 0.85; cursor: progress; }
.spin {
  display: inline-block; width: 0.8em; height: 0.8em; border-radius: 50%;
  border: 2px solid currentColor; border-top-color: transparent;
  animation: speak-spin 0.7s linear infinite; vertical-align: middle;
}
@keyframes speak-spin { to { transform: rotate(360deg); } }
</style>
