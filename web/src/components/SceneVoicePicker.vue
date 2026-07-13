<script setup>
// Scene-wide voice picker for dialogue "Play whole scene": pick a voice per
// CHARACTER (not per line), preview a sample of each, then generate + save every
// line that character speaks in one action — instead of opening each line's
// picker one at a time. Emits `accept` with the full list of generated clips
// (one per line) so the caller can save them all as per-element overrides.
import { reactive, ref, computed, onMounted } from "vue";
import { getTtsVoiceCatalog, synthesizeSpeech } from "@/services/tts";
import { useSpeech } from "@/composables/useSpeech";
import { firstSentence } from "@/lib/sentence";

const props = defineProps({
  turns: { type: Array, required: true }, // [{ speaker, text, lang }]
  contentKind: { type: String, default: "dialogue" },
});
const emit = defineEmits(["accept", "close"]);

const { playAudio, stop } = useSpeech();

const PROVIDER_LABEL = { gemini: "Gemini (finest)", openai: "OpenAI (4o)" };

const catalog = ref(null);
const loadingCatalog = ref(true);
const catalogError = ref("");

// One row per distinct speaker, in first-appearance order.
const speakers = computed(() => {
  const seen = [];
  for (const t of props.turns) {
    const name = t.speaker || "?";
    if (!seen.includes(name)) seen.push(name);
  }
  return seen;
});

const selection = reactive({});    // speaker -> "provider|model|voiceName"
const previewing = reactive({});   // speaker -> bool
const previewError = reactive({}); // speaker -> string
const previewedUrl = reactive({}); // speaker -> url
const previewedSel = reactive({}); // speaker -> selection at time of that preview

const generating = ref(false);
const generateError = ref("");
const progress = reactive({ done: 0, total: 0 });
const savedCount = ref(0);

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

const unavailableProviders = computed(() =>
  Object.entries(catalog.value || {})
    .filter(([, info]) => !info?.available)
    .map(([p]) => PROVIDER_LABEL[p] || p)
);
const noVoices = computed(() => !loadingCatalog.value && groups.value.length === 0);

onMounted(async () => {
  try {
    const data = await getTtsVoiceCatalog();
    catalog.value = data?.providers || {};
    // Default each character to a DIFFERENT voice (round-robin), so the scene
    // sounds varied right away instead of every speaker defaulting to the same one.
    const allOptions = groups.value.flatMap((g) => g.options.map((o) => o.value));
    speakers.value.forEach((sp, i) => {
      if (allOptions.length) selection[sp] = allOptions[i % allOptions.length];
    });
  } catch (e) {
    catalogError.value = e?.message || "Couldn't load voices.";
  } finally {
    loadingCatalog.value = false;
  }
});

function parse(sel) {
  const [provider, model, voiceName] = (sel || "").split("|");
  return { provider, model, voiceName };
}

// The first line spoken by this character — used for the sample preview.
function firstTurnFor(speaker) {
  return props.turns.find((t) => (t.speaker || "?") === speaker);
}

async function preview(speaker) {
  const sel = selection[speaker];
  if (!sel || previewing[speaker]) return;
  // Already previewed this exact voice — replay the cached clip for free.
  if (previewedUrl[speaker] && previewedSel[speaker] === sel) {
    playAudio(previewedUrl[speaker], { onError: () => { previewError[speaker] = "Couldn't play the preview."; } });
    return;
  }
  previewing[speaker] = true;
  previewError[speaker] = "";
  const { provider, model, voiceName } = parse(sel);
  const turn = firstTurnFor(speaker);
  try {
    const res = await synthesizeSpeech({
      text: firstSentence(turn?.text || ""), lang: turn?.lang || "en",
      voiceName, provider, model, contentKind: props.contentKind,
    });
    if (res?.configured === false) { previewError[speaker] = "Speech synthesis isn't configured."; return; }
    if (!res?.url) { previewError[speaker] = "No audio was produced — try another voice."; return; }
    previewedUrl[speaker] = res.url;
    previewedSel[speaker] = sel;
    playAudio(res.url, { onError: () => { previewError[speaker] = "Couldn't play the preview."; } });
  } catch (e) {
    previewError[speaker] = e?.message || "Couldn't generate the preview.";
  } finally {
    previewing[speaker] = false;
  }
}

// Generate + save EVERY line in the scene, one call per turn, using its
// speaker's chosen voice. Sequential (not parallel) so a long scene doesn't
// slam the TTS quota all at once; progress is shown as it goes. One line
// failing doesn't stop the rest of the scene from generating.
async function generateAll() {
  if (generating.value) return;
  const pending = props.turns.filter((t) => selection[t.speaker || "?"]);
  if (!pending.length) return;
  generating.value = true;
  generateError.value = "";
  savedCount.value = 0;
  progress.done = 0;
  progress.total = pending.length;
  const accepted = [];
  for (const t of pending) {
    const { provider, model, voiceName } = parse(selection[t.speaker || "?"]);
    try {
      const res = await synthesizeSpeech({ text: t.text, lang: t.lang || "en", voiceName, provider, model, contentKind: props.contentKind });
      if (res?.url) accepted.push({ text: t.text, lang: t.lang || "en", provider, model, voiceName, url: res.url });
    } catch {
      // Keep going — a single line's failure shouldn't abandon the whole scene.
    }
    progress.done += 1;
  }
  generating.value = false;
  savedCount.value = accepted.length;
  if (accepted.length !== pending.length) {
    generateError.value = `${pending.length - accepted.length} line(s) couldn't be generated — the rest were saved.`;
  }
  if (accepted.length) emit("accept", accepted);
}

function close() { stop(); emit("close"); }
</script>

<template>
  <div class="scene-picker" role="dialog" aria-label="Choose voices for the whole scene" @keydown.esc="close" @click.stop>
    <div class="vp-head">
      <span class="vp-title">Choose voices for the scene</span>
      <button type="button" class="vp-x" aria-label="Close" @click="close">✕</button>
    </div>

    <p v-if="loadingCatalog" class="vp-status"><span class="vp-spin" aria-hidden="true"></span> Loading voices…</p>
    <p v-else-if="catalogError" class="vp-err">{{ catalogError }}</p>
    <p v-else-if="noVoices" class="vp-err">No TTS provider is configured.</p>

    <template v-else>
      <div v-for="sp in speakers" :key="sp" class="sp-row">
        <div class="sp-head">
          <span class="sp-name">{{ sp }}</span>
          <select v-model="selection[sp]" class="vp-select">
            <optgroup v-for="g in groups" :key="g.provider" :label="g.label">
              <option v-for="o in g.options" :key="o.value" :value="o.value">{{ o.label }}</option>
            </optgroup>
          </select>
          <button type="button" class="vp-btn ghost sp-preview" :disabled="previewing[sp] || !selection[sp]" @click="preview(sp)">
            <span v-if="previewing[sp]" class="vp-spin" aria-hidden="true"></span>
            {{ previewing[sp] ? "…" : "▶" }}
          </button>
        </div>
        <p v-if="previewError[sp]" class="vp-err">{{ previewError[sp] }}</p>
      </div>

      <p v-if="unavailableProviders.length" class="vp-hint">{{ unavailableProviders.join(", ") }} not configured.</p>
      <p v-if="generateError" class="vp-err">{{ generateError }}</p>
      <p v-if="generating" class="vp-status"><span class="vp-spin" aria-hidden="true"></span> Generating {{ progress.done }} / {{ progress.total }}…</p>
      <p v-else-if="savedCount" class="vp-ok">✓ Saved {{ savedCount }} line{{ savedCount === 1 ? "" : "s" }}.</p>

      <div class="vp-actions">
        <button type="button" class="vp-btn primary sp-generate" :disabled="generating" @click="generateAll">
          {{ generating ? "Generating…" : "Generate & save whole scene" }}
        </button>
      </div>
      <p class="vp-foot">Each line is generated with its character's chosen voice and saved immediately — this can take a moment for a long scene.</p>
    </template>
  </div>
</template>

<style scoped>
.scene-picker {
  position: absolute; z-index: 30; top: calc(100% + 0.3rem); right: 0;
  min-width: 280px; max-width: 340px; max-height: 70vh; overflow-y: auto;
  background: #fff; border: 1px solid #cbd5e1; border-radius: 12px;
  box-shadow: 0 8px 28px rgba(15, 23, 42, 0.18); padding: 0.75rem; text-align: left;
}
.vp-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem; }
.vp-title { font-size: 0.82rem; font-weight: 700; color: #0f172a; }
.vp-x { border: none; background: none; cursor: pointer; color: #94a3b8; font-size: 0.85rem; line-height: 1; padding: 0.15rem; }
.vp-x:hover { color: #334155; }
.vp-select { font: inherit; font-size: 0.82rem; padding: 0.3rem 0.4rem; border: 1px solid #cbd5e1; border-radius: 8px; color: #0f172a; background: #fff; flex: 1; min-width: 0; }
.vp-hint { font-size: 0.72rem; color: #94a3b8; margin: 0.4rem 0 0; }
.vp-status { display: flex; align-items: center; gap: 0.4rem; font-size: 0.82rem; color: #475569; margin: 0.5rem 0 0; }
.vp-ok { font-size: 0.82rem; color: #166534; background: #f0fdf4; border-radius: 6px; padding: 0.35rem 0.5rem; margin: 0.5rem 0 0; }
.vp-err { font-size: 0.76rem; color: #b91c1c; background: #fef2f2; border-radius: 6px; padding: 0.3rem 0.5rem; margin: 0.35rem 0 0; }
.vp-actions { margin-top: 0.7rem; }
.vp-btn { display: inline-flex; align-items: center; justify-content: center; gap: 0.3rem; font: inherit; font-size: 0.82rem; font-weight: 600; padding: 0.4rem 0.6rem; border-radius: 999px; cursor: pointer; }
.vp-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.vp-btn.ghost { background: #fff; border: 1px solid #cbd5e1; color: #334155; }
.vp-btn.ghost:hover:not(:disabled) { background: #f1f5f9; }
.vp-btn.primary { width: 100%; background: #0b1f3a; border: 1px solid #0b1f3a; color: #fff; }
.vp-btn.primary:hover:not(:disabled) { background: #13294d; }
.vp-foot { font-size: 0.7rem; color: #94a3b8; margin: 0.5rem 0 0; line-height: 1.4; }
.vp-spin { display: inline-block; width: 0.8em; height: 0.8em; border-radius: 50%; border: 2px solid currentColor; border-top-color: transparent; animation: vp-spin 0.7s linear infinite; }
@keyframes vp-spin { to { transform: rotate(360deg); } }

.sp-row { margin-bottom: 0.6rem; padding-bottom: 0.6rem; border-bottom: 1px solid #f1f5f9; }
.sp-row:last-of-type { border-bottom: none; }
.sp-head { display: flex; align-items: center; gap: 0.35rem; }
.sp-name { font-size: 0.78rem; font-weight: 700; color: #334155; flex-shrink: 0; min-width: 3.5rem; }
.sp-preview { flex-shrink: 0; padding: 0.3rem 0.5rem; }
</style>
