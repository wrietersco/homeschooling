<script setup>
// Per-element voice picker. Lists voices from BOTH TTS providers in one consolidated
// dropdown. Two independent actions:
//  - Preview: synthesizes only the FIRST SENTENCE of this element's text, so
//    sampling a voice on a long paragraph stays fast and cheap. Replaying an
//    already-previewed voice reuses the cached clip (no re-synthesis).
//  - Generate: synthesizes the FULL text with the selected voice. The result is
//    playable as many times as the parent likes; nothing is persisted until they
//    explicitly click Save (Discard throws the candidate away and returns to
//    picking). Generate does NOT require a prior Preview — a voice can be chosen
//    and saved directly.
// Regeneration uses each provider's best regeneration model (Gemini's finest,
// OpenAI's 4o), supplied by getTtsVoiceCatalog.
import { ref, computed, onMounted } from "vue";
import { getTtsVoiceCatalog, synthesizeSpeech } from "@/services/tts";
import { useSpeech } from "@/composables/useSpeech";
import { firstSentence } from "@/lib/sentence";

const props = defineProps({
  text: { type: String, required: true },
  lang: { type: String, default: "en" },
  // What kind of content this is — picks a default emotional tone server-side
  // (e.g. "story" narrates warmly, "quran" recites reverently). See
  // TONE_BY_CONTENT_KIND in functions/agents/tts.js.
  contentKind: { type: String, default: "" },
});
const emit = defineEmits(["accept", "close"]);

const { playAudio, stop } = useSpeech();

// Friendly group headings — also conveys which model each provider regenerates with.
const PROVIDER_LABEL = { gemini: "Gemini (finest)", openai: "OpenAI (4o)" };

const catalog = ref(null);
const loadingCatalog = ref(true);
const catalogError = ref("");

const selection = ref("");           // "provider|model|voiceName"

// Sentence-preview state.
const previewing = ref(false);
const previewError = ref("");
const previewedUrl = ref("");
const previewedSel = ref("");

// Full-text generate state — the candidate clip pending Save/Discard.
const generating = ref(false);
const generateError = ref("");
const generatedUrl = ref("");
const generatedSel = ref("");

onMounted(async () => {
  try {
    const data = await getTtsVoiceCatalog();
    catalog.value = data?.providers || {};
    // Default the selection to the first available provider's first voice.
    const firstGroup = groups.value[0];
    if (firstGroup?.options.length) selection.value = firstGroup.options[0].value;
  } catch (e) {
    catalogError.value = e?.message || "Couldn't load voices.";
  } finally {
    loadingCatalog.value = false;
  }
});

// One optgroup per CONFIGURED provider; each option encodes provider|model|voice.
const groups = computed(() => {
  const out = [];
  for (const [provider, info] of Object.entries(catalog.value || {})) {
    if (!info?.available) continue;
    const model = info.defaultModel;
    out.push({
      provider,
      label: PROVIDER_LABEL[provider] || provider,
      options: (info.voices || []).map((v) => ({ value: `${provider}|${model}|${v}`, label: v })),
    });
  }
  return out;
});

// Any provider present but not configured — surfaced as a hint so the user knows why
// a provider they expected is missing.
const unavailableProviders = computed(() =>
  Object.entries(catalog.value || {})
    .filter(([, info]) => !info?.available)
    .map(([p]) => PROVIDER_LABEL[p] || p)
);

const noVoices = computed(() => !loadingCatalog.value && groups.value.length === 0);

function parse(sel) {
  const [provider, model, voiceName] = (sel || "").split("|");
  return { provider, model, voiceName };
}

const selectedVoiceName = computed(() => parse(selection.value).voiceName);
const previewSentence = computed(() => firstSentence(props.text));
// A candidate clip exists for the CURRENT selection — hides the picker/preview
// row and shows Play / Save / Discard instead.
const hasGenerated = computed(() => Boolean(generatedUrl.value) && generatedSel.value === selection.value);

async function preview() {
  if (!selection.value || previewing.value) return;
  // Already previewed this exact voice — replay the cached clip for free
  // instead of paying for another synthesis call.
  if (previewedUrl.value && previewedSel.value === selection.value) {
    playAudio(previewedUrl.value, { onError: () => { previewError.value = "Couldn't play the preview."; } });
    return;
  }
  previewing.value = true;
  previewError.value = "";
  const { provider, model, voiceName } = parse(selection.value);
  try {
    const res = await synthesizeSpeech({ text: previewSentence.value, lang: props.lang, voiceName, provider, model, contentKind: props.contentKind });
    if (res?.configured === false) { previewError.value = "Speech synthesis isn't configured."; return; }
    if (!res?.url) { previewError.value = "No audio was produced — try another voice."; return; }
    previewedUrl.value = res.url;
    previewedSel.value = selection.value;
    playAudio(res.url, { onError: () => { previewError.value = "Couldn't play the preview."; } });
  } catch (e) {
    previewError.value = e?.message || "Couldn't generate the preview.";
  } finally {
    previewing.value = false;
  }
}

// Synthesizes the FULL text for the selected voice — independent of preview, so
// a voice can be picked and saved without ever previewing it. Always makes a
// fresh call (no reuse), so it also serves as "Regenerate" for a new take with
// the same voice.
async function generate() {
  if (!selection.value || generating.value) return;
  generating.value = true;
  generateError.value = "";
  const { provider, model, voiceName } = parse(selection.value);
  try {
    const res = await synthesizeSpeech({ text: props.text, lang: props.lang, voiceName, provider, model, contentKind: props.contentKind });
    if (res?.configured === false) { generateError.value = "Speech synthesis isn't configured."; return; }
    if (!res?.url) { generateError.value = "No audio was produced — try another voice."; return; }
    generatedUrl.value = res.url;
    generatedSel.value = selection.value;
    playAudio(res.url, { onError: () => { generateError.value = "Couldn't play the generated audio."; } });
  } catch (e) {
    generateError.value = e?.message || "Couldn't generate audio.";
  } finally {
    generating.value = false;
  }
}

// Replay the pending candidate as many times as the parent likes — no new call.
function replayGenerated() {
  if (!hasGenerated.value) return;
  playAudio(generatedUrl.value, { onError: () => { generateError.value = "Couldn't play the generated audio."; } });
}

function discardGenerated() {
  generatedUrl.value = "";
  generatedSel.value = "";
  generateError.value = "";
}

function save() {
  if (!hasGenerated.value) return;
  const { provider, model, voiceName } = parse(selection.value);
  emit("accept", { provider, model, voiceName, url: generatedUrl.value });
}

function close() { stop(); emit("close"); }
</script>

<template>
  <div class="voice-picker" role="dialog" aria-label="Choose a voice" @keydown.esc="close" @click.stop>
    <div class="vp-head">
      <span class="vp-title">Choose a voice</span>
      <button type="button" class="vp-x" aria-label="Close" @click="close">✕</button>
    </div>

    <p v-if="loadingCatalog" class="vp-status"><span class="vp-spin" aria-hidden="true"></span> Loading voices…</p>
    <p v-else-if="catalogError" class="vp-err">{{ catalogError }}</p>
    <p v-else-if="noVoices" class="vp-err">No TTS provider is configured.</p>

    <template v-else>
      <label class="vp-field">
        <span class="vp-label">Voice</span>
        <select v-model="selection" class="vp-select">
          <optgroup v-for="g in groups" :key="g.provider" :label="g.label">
            <option v-for="o in g.options" :key="o.value" :value="o.value">{{ o.label }}</option>
          </optgroup>
        </select>
      </label>

      <p v-if="unavailableProviders.length" class="vp-hint">
        {{ unavailableProviders.join(", ") }} not configured.
      </p>

      <p v-if="previewError" class="vp-err">{{ previewError }}</p>
      <p v-if="generateError" class="vp-err">{{ generateError }}</p>

      <!-- Voice picking + (re)generating stay available at all times, so the
           parent can switch voices or take another pass any time — even after
           a candidate is already pending. -->
      <div class="vp-actions">
        <button type="button" class="vp-btn ghost vp-preview" :disabled="previewing || !selection" @click="preview">
          <span v-if="previewing" class="vp-spin" aria-hidden="true"></span>
          {{ previewing ? "Generating…" : "▶ Preview" }}
        </button>
        <button type="button" class="vp-btn primary vp-generate" :disabled="generating || !selection" @click="generate">
          <span v-if="generating" class="vp-spin" aria-hidden="true"></span>
          {{ generating ? "Generating…" : (hasGenerated ? "↻ Regenerate" : "Use this voice") }}
        </button>
      </div>
      <div v-if="hasGenerated" class="vp-actions vp-actions-3">
        <button type="button" class="vp-btn ghost vp-play" @click="replayGenerated">▶ Play</button>
        <button type="button" class="vp-btn ghost danger vp-discard" @click="discardGenerated">Discard</button>
        <button type="button" class="vp-btn primary vp-save" @click="save">Save</button>
      </div>
      <p v-if="!hasGenerated" class="vp-foot">Preview “{{ selectedVoiceName }}” on the first sentence, or generate the full clip directly.</p>
      <p v-else class="vp-foot">Play it as many times as you like, switch voices, or regenerate — nothing is saved until you tap Save.</p>
    </template>
  </div>
</template>

<style scoped>
.voice-picker {
  position: absolute; z-index: 30; top: calc(100% + 0.3rem); left: 0;
  min-width: 240px; max-width: 300px;
  background: #fff; border: 1px solid #cbd5e1; border-radius: 12px;
  box-shadow: 0 8px 28px rgba(15, 23, 42, 0.18); padding: 0.75rem; text-align: left;
}
.vp-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem; }
.vp-title { font-size: 0.82rem; font-weight: 700; color: #0f172a; }
.vp-x { border: none; background: none; cursor: pointer; color: #94a3b8; font-size: 0.85rem; line-height: 1; padding: 0.15rem; }
.vp-x:hover { color: #334155; }
.vp-field { display: flex; flex-direction: column; gap: 0.25rem; }
.vp-label { font-size: 0.72rem; font-weight: 600; color: #64748b; }
.vp-select { font: inherit; font-size: 0.86rem; padding: 0.35rem 0.45rem; border: 1px solid #cbd5e1; border-radius: 8px; color: #0f172a; background: #fff; }
.vp-hint { font-size: 0.72rem; color: #94a3b8; margin: 0.4rem 0 0; }
.vp-status { display: flex; align-items: center; gap: 0.4rem; font-size: 0.82rem; color: #475569; margin: 0.25rem 0; }
.vp-err { font-size: 0.78rem; color: #b91c1c; background: #fef2f2; border-radius: 6px; padding: 0.35rem 0.5rem; margin: 0.5rem 0 0; }
.vp-actions { display: flex; gap: 0.4rem; margin-top: 0.7rem; }
.vp-actions-3 .vp-btn { flex: 1; padding-left: 0.3rem; padding-right: 0.3rem; }
.vp-btn { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 0.3rem; font: inherit; font-size: 0.82rem; font-weight: 600; padding: 0.4rem 0.6rem; border-radius: 999px; cursor: pointer; }
.vp-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.vp-btn.ghost { background: #fff; border: 1px solid #cbd5e1; color: #334155; }
.vp-btn.ghost:hover:not(:disabled) { background: #f1f5f9; }
.vp-btn.ghost.danger { color: #b91c1c; border-color: #fecaca; }
.vp-btn.ghost.danger:hover:not(:disabled) { background: #fef2f2; }
.vp-btn.primary { background: #0b1f3a; border: 1px solid #0b1f3a; color: #fff; }
.vp-btn.primary:hover:not(:disabled) { background: #13294d; }
.vp-foot { font-size: 0.7rem; color: #94a3b8; margin: 0.5rem 0 0; line-height: 1.4; }
.vp-spin { display: inline-block; width: 0.8em; height: 0.8em; border-radius: 50%; border: 2px solid currentColor; border-top-color: transparent; animation: vp-spin 0.7s linear infinite; }
@keyframes vp-spin { to { transform: rotate(360deg); } }
</style>
