<script setup>
// A small tappable speaker button. Reads `text` aloud in `lang` when pressed.
// Used at word, sentence, and paragraph levels throughout the activity content.
//
// When ActivityContent provides a TTS-override context, the button (a) plays a saved
// voice for this text if one exists, and (b) shows a ▾ caret to pick/regenerate a
// voice (parent view only). Without the context it behaves exactly as before.
import { computed, inject, ref } from "vue";
import { useSpeech } from "@/composables/useSpeech";
import { TTS_OVERRIDES } from "@/lib/ttsOverrides";
import VoicePicker from "@/components/VoicePicker.vue";

// Parent-supplied attrs (class, etc.) land on the inner speaker button — not the
// positioning wrapper — so existing selectors/styles (e.g. `.tip-speak`) and click
// behaviour are unchanged.
defineOptions({ inheritAttrs: false });

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
  // What kind of content this is ("quran", "qaida", "dialogue", "story", "tips",
  // "vocab", "instructional") — picks a default emotional tone server-side so a
  // Quran ayah, a bedtime story, and a math problem don't all read the same way.
  contentKind: { type: String, default: "" },
});

const { supported, speakingId, loadingId, speak, playAudio, stop } = useSpeech();

// Optional saved-voice context from ActivityContent (null elsewhere).
const overrides = inject(TTS_OVERRIDES, null);
const savedOverride = computed(() => overrides?.overrideFor(props.text, props.lang) || null);
// Show the voice picker only when editing is allowed AND there is real text to voice
// (a recorded-qirat button without TTS text wouldn't regenerate meaningfully).
const canPick = computed(() => Boolean(overrides?.canEditVoice && props.text));
const pickerOpen = ref(false);

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
  // A saved voice for this element wins over the default audio/TTS path.
  const saved = savedOverride.value;
  if (saved?.url) {
    playAudio(saved.url, {
      id: speakId.value,
      onError: () => speak(props.text, props.lang, { id: speakId.value, rate: props.rate, voiceName: props.voiceName, contentKind: props.contentKind }),
    });
    return;
  }
  if (props.audioUrl) {
    playAudio(props.audioUrl, {
      id: speakId.value,
      onError: () => speak(props.text, props.lang, { id: speakId.value, rate: props.rate, voiceName: props.voiceName, contentKind: props.contentKind }),
    });
  } else {
    speak(props.text, props.lang, { id: speakId.value, rate: props.rate, voiceName: props.voiceName, contentKind: props.contentKind });
  }
}

function onAccept(payload) {
  overrides?.saveOverride(props.text, props.lang, payload);
  pickerOpen.value = false;
}
</script>

<template>
  <span v-if="usable" class="speak-wrap">
    <button
      type="button"
      class="speak-btn"
      :class="[`size-${size}`, { active, loading, saved: Boolean(savedOverride) }]"
      :aria-label="label || `Listen: ${text}`"
      :title="loading ? 'Preparing audio…' : (savedOverride ? `Listen (custom voice: ${savedOverride.voiceName})` : (label || 'Listen'))"
      :aria-busy="loading"
      v-bind="$attrs"
      @click.stop="onClick"
    >
      <span v-if="loading" class="spin" aria-hidden="true"></span>
      <span v-else class="ico">{{ active ? "⏸" : "🔊" }}</span>
      <span v-if="label" class="lbl">{{ loading ? "Preparing…" : label }}</span>
    </button>
    <button
      v-if="canPick"
      type="button"
      class="voice-caret"
      :class="`size-${size}`"
      :aria-label="`Change voice for: ${text}`"
      :aria-expanded="pickerOpen"
      title="Change voice"
      @click.stop="pickerOpen = !pickerOpen"
    >▾</button>
    <VoicePicker
      v-if="pickerOpen"
      :text="text"
      :lang="lang"
      :content-kind="contentKind"
      @accept="onAccept"
      @close="pickerOpen = false"
    />
  </span>
</template>

<style scoped>
/* Wrapper anchors the (absolutely-positioned) voice picker under the button. */
.speak-wrap { position: relative; display: inline-flex; align-items: center; gap: 0.15rem; vertical-align: middle; }
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
/* A saved custom voice gets a subtle violet accent so it's clear it's personalized. */
.speak-btn.saved { border-color: #c4b5fd; }
.speak-btn.saved:hover { background: #f5f3ff; }

/* The ▾ caret that opens the voice picker (parent view only). */
.voice-caret {
  display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid #cbd5e1; background: #fff; color: #64748b;
  border-radius: 999px; cursor: pointer; line-height: 1; font-size: 0.7rem;
  width: 1.35rem; height: 1.35rem; padding: 0;
  transition: background 0.12s, border-color 0.12s;
}
.voice-caret:hover { background: #f5f3ff; border-color: #c4b5fd; color: #6d28d9; }
.voice-caret.size-sm { width: 1.1rem; height: 1.1rem; font-size: 0.6rem; }

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
