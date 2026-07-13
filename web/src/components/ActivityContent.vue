<script setup>
// Renders the type-specific, ready-to-do content for an activity — the same
// component drives the parent ActivityView and the child ChildPlayerView.
//
//   quran_reading   → the actual verses, word-by-word, tap any word for qirat
//   qaida_exercise  → Noorani Qaida drills (tap each glyph to hear it)
//   story           → storybook passage with word / sentence / paragraph voice
//   problems        → math problem sums (reveal hint / answer / working)
//   steps           → ordered hands-on worksheet
//   flashcards      → legacy term cards (kept for back-compat)
//
// Reading kinds (quran/story) get an enlarge/shrink font control. Voice is
// available at word, sentence, verse, and paragraph levels (Arabic qirat-assist
// + other languages) via SpeakButton.
import { ref, computed, toRef, provide } from "vue";
import SpeakButton from "@/components/SpeakButton.vue";
import VoicePicker from "@/components/VoicePicker.vue";
import SceneVoicePicker from "@/components/SceneVoicePicker.vue";
import { useSpeech } from "@/composables/useSpeech";
import { useQaidaLibrary } from "@/composables/useQaidaLibrary";
import { buildTipsSections, tipsLangFor, tipLineId, tipSequence } from "@/lib/activityTips";
import { TTS_OVERRIDES, overrideKey } from "@/lib/ttsOverrides";
import { splitBismillahWords, splitBismillahText } from "@/lib/bismillah";

const props = defineProps({
  content: { type: Object, required: true },
  // Saved per-element voices, keyed by overrideKey(text, lang). Read on playback;
  // the parent view also lets the user add to it via the voice picker.
  audioOverrides: { type: Object, default: () => ({}) },
  // True in the parent activity view (shows the voice picker); false in the child
  // player (saved voices still play, but they can't be changed there).
  canEditVoice: { type: Boolean, default: false },
});
const emit = defineEmits(["update:override"]);

// Saved-voice context consumed by SpeakButton (and the Qaida glyph tiles below).
const overrideFor = (text, lang) => props.audioOverrides?.[overrideKey(text, lang)] || null;
function saveOverride(text, lang, payload) {
  emit("update:override", { key: overrideKey(text, lang), text, lang, ...payload });
}
provide(TTS_OVERRIDES, {
  overrideFor,
  get canEditVoice() { return props.canEditVoice; },
  saveOverride,
});

// Which Qaida glyph's voice picker is open (by overrideKey), or "" for none.
const openGlyphPicker = ref("");

const { speak, speakSequence, sequenceIndex, speakingId, playAudio, loadingId, ttsLogs, lastError } = useSpeech();

// Resolve each Qaida glyph's CURRENT recording live from the shared library (by
// materialRef), so activities pick up audio as it's voiced over time — no
// regeneration. Falls back to the embedded snapshot, then TTS.
const { liveAudioUrl, liveSpellScript } = useQaidaLibrary(toRef(props, "content"));

const kind = computed(() => props.content?.kind || "steps");
const primaryLang = computed(() => props.content?.primaryLang || "en");

// The family's native language. Content already in this language needs no
// translation; content in any OTHER (non-native) language shows its meaning by
// default so the child can follow it.
const NATIVE_LANG = "ur";
function isNativeLang(lang) { return new RegExp(`^${NATIVE_LANG}`).test((lang || "").toLowerCase()); }

function isRtlLang(lang) { return /^(ar|ur|fa|ps)/.test((lang || "").toLowerCase()); }

// The language of the main text the child reads for THIS content kind — drives
// the auto-translate default below.
const contentLang = computed(() => {
  const c = props.content || {};
  if (kind.value === "dialogue") return c.dialogue?.lang || primaryLang.value;
  if (kind.value === "story" || kind.value === "reading") return c.story?.lang || primaryLang.value;
  if (kind.value === "qaida_exercise") return (c.exercises?.[0]?.lang) || primaryLang.value;
  return primaryLang.value; // quran_reading is always Arabic
});

// Pick the right joined-script font class for a BCP-47 language so Arabic and
// Urdu render with proper naskh / nastaliq faces instead of a boxy system font.
function fontClassFor(lang) {
  const l = (lang || "").toLowerCase();
  if (l.startsWith("ur")) return "font-urdu";
  if (l.startsWith("ar") || l.startsWith("fa") || l.startsWith("ps")) return "font-arabic";
  return "";
}

// The verified source fuses the Bismillah onto the Arabic text of a surah's
// first ayah (Uthmani mushaf convention). Peel it off per row so the reading
// view can show it as its own centered line, separate from the ayah — and so
// the "Recite ayah" button / word taps only cover the real ayah, not a repeat
// of the Bismillah. `vi` indexes the flat verses array, which may span more
// than one surah (e.g. a combined Al-Ikhlas + An-Nas activity), so "first ayah
// of its surah" is re-checked at every row, not just vi === 0.
const quranRows = computed(() => {
  const verses = props.content?.quran?.verses || [];
  return verses.map((original, vi) => {
    const isFirstOfSurah = vi === 0 || verses[vi - 1]?.surah !== original.surah;
    let bismillah = null;
    let v = original;
    if (isFirstOfSurah) {
      if (original.words?.length) {
        const { bismillahWords, verseWords } = splitBismillahWords(original.words);
        if (bismillahWords.length) {
          bismillah = { arabic: bismillahWords.map((w) => w.arabic).join(" ") };
          v = { ...original, words: verseWords, arabic: verseWords.map((w) => w.arabic).join(" ") };
        }
      } else {
        const { bismillah: text, verse: rest } = splitBismillahText(original.arabic);
        if (text) { bismillah = { arabic: text }; v = { ...original, arabic: rest }; }
      }
    }
    return { v, vi, bismillah };
  });
});

// Recite a single Quran word — real qirat audio if present, else TTS.
function reciteWord(w) {
  if (w.audioUrl) {
    playAudio(w.audioUrl, { onError: () => speak(w.arabic, "ar", { rate: 0.75, contentKind: "quran" }) });
  } else {
    speak(w.arabic, "ar", { rate: 0.75, contentKind: "quran" });
  }
}

// Recite a Qaida glyph — a saved custom voice (from the voice picker) wins; else the
// curated spell-out recording from the shared nooraniQaida library (resolved LIVE by
// materialRef, so it appears as soon as the platform voices it); else TTS of the raw
// glyph.
function reciteGlyph(it, lang) {
  const url = overrideFor(it.text, lang)?.url || liveAudioUrl(it);
  if (url) {
    playAudio(url, { onError: () => speak(it.text, lang, { rate: 0.8, contentKind: "qaida" }) });
  } else {
    speak(it.text, lang, { rate: 0.8, contentKind: "qaida" });
  }
}

// Save an accepted voice for a glyph and close its picker.
function onGlyphVoice(it, lang, payload) {
  saveOverride(it.text, lang, payload);
  openGlyphPicker.value = "";
}

// Professional Arabic now comes from Gemini TTS (server), so we no longer warn
// about a missing OS Arabic voice for qaida — the browser voice is only a
// last-resort offline fallback.

// Reading-text size control (spec: child can enlarge / en-small the text).
// Available across all Arabic Language & Qur'an content kinds.
const SCALABLE_KINDS = ["quran_reading", "story", "reading", "qaida_exercise", "dialogue"];
const fontScale = ref(1);
const canScale = computed(() => SCALABLE_KINDS.includes(kind.value));
function bigger() { fontScale.value = Math.min(2.2, +(fontScale.value + 0.15).toFixed(2)); }
function smaller() { fontScale.value = Math.max(0.7, +(fontScale.value - 0.15).toFixed(2)); }

// Translation / meaning toggle for non-native content. Available across the
// Arabic Language & Qur'an kinds; defaults ON when the content is in a language
// other than the family's native one (Urdu), so the meaning shows automatically.
// Reading passages only expose the toggle when a translation was actually
// generated (Arabic passages) — Urdu/English passages carry none.
const hasPassageTranslation = computed(() =>
  (props.content?.story?.paragraphTranslations || []).some(Boolean)
);
const canTranslate = computed(() => {
  const k = kind.value;
  if (k === "reading" || k === "story") return hasPassageTranslation.value;
  return ["quran_reading", "qaida_exercise", "dialogue"].includes(k);
});
const showMeaning = ref(canTranslate.value && !isNativeLang(contentLang.value));
function toggleMeaning() { showMeaning.value = !showMeaning.value; }

// ─── Dialogue (conversation) ─────────────────────────────────────────────────
// Give each distinct speaker a different Gemini voice so the two sides of the
// conversation are easy to tell apart. The TTS model is unchanged (superadmin-
// set); only the voiceName varies per character.
const VOICE_PALETTE = ["Kore", "Puck", "Charon", "Aoede", "Fenrir", "Leda", "Orus", "Zephyr"];
const dialogueLang = computed(() => props.content?.dialogue?.lang || primaryLang.value);
const dialogueVoices = computed(() => {
  const map = {};
  let idx = 0;
  for (const t of props.content?.dialogue?.turns || []) {
    const who = t.speaker || t.role || "?";
    if (!(who in map)) { map[who] = VOICE_PALETTE[idx % VOICE_PALETTE.length]; idx += 1; }
  }
  return map;
});
function voiceForTurn(t) { return dialogueVoices.value[t.speaker || t.role || "?"] || ""; }
// "Play whole scene" must sound the same as tapping each line individually — a
// turn with a saved custom voice (from that line's caret) plays it here too,
// instead of always falling back to the default per-character palette voice.
function playScene() {
  const turns = (props.content?.dialogue?.turns || []).map((t, i) => ({
    text: t.text,
    lang: dialogueLang.value,
    voiceName: voiceForTurn(t),
    audioUrl: overrideFor(t.text, dialogueLang.value)?.url || "",
    id: `turn-${i}`,
    rate: 0.95,
    contentKind: "dialogue",
  }));
  speakSequence(turns);
}

// Scene-wide voice picker ("Play whole scene" caret): lets a parent choose one
// voice per CHARACTER and generate + save every line that character speaks in
// one action, instead of opening each line's own picker individually.
const sceneVoicePickerOpen = ref(false);
const dialogueTurnsForPicker = computed(() =>
  (props.content?.dialogue?.turns || []).map((t) => ({
    speaker: t.speaker || t.role || "?",
    text: t.text,
    lang: dialogueLang.value,
  }))
);
function onSceneVoicesAccepted(items) {
  for (const item of items) {
    saveOverride(item.text, item.lang, { provider: item.provider, model: item.model, voiceName: item.voiceName, url: item.url });
  }
}

// ─── Flashcards (legacy) ──────────────────────────────────────────────────────
const flipped = ref({});
function toggleFlip(i) { flipped.value[i] = !flipped.value[i]; }

// ─── Problems: per-problem reveal state ───────────────────────────────────────
const revealAnswer = ref({});
const revealHint = ref({});

// ─── Story: split paragraphs into sentences and words ─────────────────────────
function splitSentences(text) {
  return (text.match(/[^.!?؟۔]+[.!?؟۔]*/g) || [text]).map((s) => s.trim()).filter(Boolean);
}
function splitWords(text) { return text.split(/\s+/).filter(Boolean); }

// True when any vocabulary word carries a generated picture (letter-sound /
// picture-association activities) — switches the vocab list to a card grid.
const vocabHasPictures = computed(() =>
  (props.content?.story?.vocab || []).some((v) => v.image && v.image.url)
);

const storyParagraphs = computed(() => {
  const translations = props.content?.story?.paragraphTranslations || [];
  return (props.content?.story?.paragraphs || []).map((p, i) => ({
    text: p,
    sentences: splitSentences(p).map((s) => ({ text: s, words: splitWords(s) })),
    translation: translations[i] || null,
  }));
});

// ─── Tips (parent facilitation) ──────────────────────────────────────────────
// The Tips / Watch for / Encourage guidance is written in the family's native
// language (Urdu) — rendered in proper Nastaliq, and readable aloud line-by-line
// or a whole section at a time so parents can listen instead of read.
const tipsLang = computed(() => tipsLangFor(props.content?.tips));
const tipsSections = computed(() => buildTipsSections(props.content?.tips));
// Embedded ready-to-use story (character-building / empathy / seerah activities)
// and the discussion questions that draw out its lesson.
const tipsStory = computed(() => {
  const s = props.content?.tips?.story;
  return s && Array.isArray(s.paragraphs) && s.paragraphs.length ? s : null;
});
// "Read aloud" speaks the whole story — and the moral (the green takeaway) is
// part of the story, so parents who listen instead of read still hear the point.
const tipsStoryReadText = computed(() => {
  const s = tipsStory.value;
  if (!s) return "";
  return [...s.paragraphs, s.moral].filter(Boolean).join(" ");
});
const tipsDiscussion = computed(() =>
  (props.content?.tips?.discussionQuestions || []).filter((q) => typeof q === "string" && q.trim())
);
function lineId(text) { return tipLineId(tipsLang.value, text); }
// Same as playScene: a line with a saved custom voice plays it here too, not
// just when tapped individually.
function playSection(items) {
  const turns = tipSequence(tipsLang.value, items).map((t) => ({
    ...t,
    audioUrl: overrideFor(t.text, tipsLang.value)?.url || "",
  }));
  speakSequence(turns);
}
</script>

<template>
  <div class="activity-content">
    <div class="ac-topbar">
      <p
        v-if="content.instructions"
        class="ac-instructions"
        :class="[fontClassFor(contentLang), { rtl: isRtlLang(contentLang) }]"
      >{{ content.instructions }}</p>
      <div class="ac-controls">
        <button
          v-if="canTranslate"
          type="button"
          class="meaning-toggle"
          :class="{ on: showMeaning }"
          :aria-pressed="showMeaning"
          @click="toggleMeaning"
        >{{ showMeaning ? "Hide meaning" : "Show meaning" }}</button>
        <div v-if="canScale" class="font-ctrl" role="group" aria-label="Text size">
          <button type="button" @click="smaller" aria-label="Smaller text">A−</button>
          <button type="button" @click="bigger" aria-label="Larger text">A+</button>
        </div>
      </div>
    </div>

    <!-- ─── QURAN READING ──────────────────────────────────────────── -->
    <div v-if="kind === 'quran_reading' && content.quran" class="quran">
      <div class="quran-head">
        <h3 class="quran-surah">{{ content.quran.surahName || "Quran" }}</h3>
        <span v-if="content.quran.reference" class="quran-ref">{{ content.quran.reference }}</span>
        <span
          v-if="['alquran.cloud', 'quran.foundation', 'curated'].includes(content.quran.textSource)"
          class="quran-verified"
          title="Arabic text verified against a Quran source"
        >✓ Verified text</span>
        <span
          v-else-if="content.quran.textSource"
          class="quran-unverified"
          title="The verified Quran source was unavailable; this Arabic was AI-drafted — check before relying on it."
        >⚠ Unverified text</span>
      </div>
      <p class="ac-hint">Tap any word to hear it recited, or use “Recite ayah” for the whole verse.</p>

      <template v-for="row in quranRows" :key="row.vi">
        <div v-if="row.bismillah" class="bismillah-line">
          <SpeakButton :text="row.bismillah.arabic" lang="ar" size="sm" label="Bismillah" content-kind="quran" />
          <p class="bismillah-arabic font-arabic" :style="{ fontSize: (1.5 * fontScale) + 'rem' }">{{ row.bismillah.arabic }}</p>
        </div>
        <div class="ayah">
          <div class="ayah-tools">
            <span class="ayah-num">{{ row.v.ayah || row.vi + 1 }}</span>
            <SpeakButton :text="row.v.arabic" lang="ar" :audio-url="row.v.audioUrl" size="md" label="Recite ayah" :rate="0.8" content-kind="quran" />
          </div>
          <p class="ayah-arabic font-arabic" :style="{ fontSize: (2 * fontScale) + 'rem' }">
            <template v-if="row.v.words && row.v.words.length">
              <span
                v-for="(w, wi) in row.v.words"
                :key="wi"
                class="ayah-word"
                :class="{ 'with-gloss': showMeaning }"
                :title="w.transliteration ? `${w.transliteration} — tap to recite` : 'tap to recite'"
                @click="reciteWord(w)"
              >
                <span class="aw-ar">{{ w.arabic }}</span>
                <span v-if="showMeaning" class="aw-gloss">
                  <span v-if="w.transliteration" class="aw-tr">{{ w.transliteration }}</span>
                  <span v-if="w.en" class="aw-en">{{ w.en }}</span>
                  <span v-if="w.ur" class="aw-ur font-urdu">{{ w.ur }}</span>
                </span>
              </span>
            </template>
            <template v-else>{{ row.v.arabic }}</template>
          </p>
          <p v-if="row.v.transliteration" class="ayah-translit" :style="{ fontSize: (0.95 * fontScale) + 'rem' }">{{ row.v.transliteration }}</p>
          <p v-if="row.v.translation" class="ayah-translation" :style="{ fontSize: (1 * fontScale) + 'rem' }">{{ row.v.translation }}</p>
        </div>
      </template>
    </div>

    <!-- ─── QAIDA EXERCISES ────────────────────────────────────────── -->
    <div v-else-if="kind === 'qaida_exercise'" class="qaida">
      <div v-for="(ex, ei) in content.exercises" :key="ei" class="qaida-ex">
        <h3 class="qaida-title">{{ ex.title }}</h3>
        <p class="qaida-instruction">{{ ex.instruction }}</p>
        <div class="glyph-grid">
          <div v-for="(it, ii) in ex.items" :key="ii" class="glyph-cell">
            <button
              type="button"
              class="glyph"
              :class="{ 'glyph-lib': liveAudioUrl(it), 'glyph-saved': overrideFor(it.text, ex.lang || primaryLang) }"
              :title="liveSpellScript(it) || it.hint || it.transliteration || 'Recite'"
              @click="reciteGlyph(it, ex.lang || primaryLang)"
            >
              <img v-if="it.image && it.image.url" :src="it.image.url" :alt="it.image.alt || it.text" class="glyph-pic" loading="lazy" />
              <span class="glyph-text" :class="fontClassFor(ex.lang || primaryLang)" :style="{ fontSize: (1.8 * fontScale) + 'rem' }">{{ it.text }}</span>
              <span v-if="it.transliteration" class="glyph-translit">{{ it.transliteration }}</span>
              <span v-if="liveSpellScript(it)" class="glyph-spell">{{ liveSpellScript(it) }}</span>
              <span v-if="showMeaning && it.en" class="glyph-en">{{ it.en }}</span>
              <span v-if="showMeaning && it.ur" class="glyph-ur font-urdu">{{ it.ur }}</span>
              <span class="glyph-ico">{{ overrideFor(it.text, ex.lang || primaryLang) ? '🎙️' : (liveAudioUrl(it) ? '🎧' : '🔊') }}</span>
            </button>
            <button
              v-if="canEditVoice && it.text"
              type="button"
              class="glyph-voice"
              :aria-label="`Change voice for: ${it.text}`"
              :aria-expanded="openGlyphPicker === overrideKey(it.text, ex.lang || primaryLang)"
              title="Change voice"
              @click.stop="openGlyphPicker = openGlyphPicker === overrideKey(it.text, ex.lang || primaryLang) ? '' : overrideKey(it.text, ex.lang || primaryLang)"
            >▾</button>
            <VoicePicker
              v-if="openGlyphPicker === overrideKey(it.text, ex.lang || primaryLang)"
              :text="it.text"
              :lang="ex.lang || primaryLang"
              content-kind="qaida"
              @accept="onGlyphVoice(it, ex.lang || primaryLang, $event)"
              @close="openGlyphPicker = ''"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- ─── DIALOGUE / CONVERSATION (listening & speaking) ─────────── -->
    <div v-else-if="kind === 'dialogue' && content.dialogue" class="dialogue">
      <div class="dialogue-head">
        <h3 class="dialogue-title">{{ content.dialogue.title }}</h3>
        <div class="scene-actions">
          <button type="button" class="scene-btn" @click="playScene">▶ Play whole scene</button>
          <button
            v-if="canEditVoice"
            type="button"
            class="scene-voice-btn"
            aria-label="Choose voices for the whole scene"
            :aria-expanded="sceneVoicePickerOpen"
            title="Choose voices for the whole scene"
            @click.stop="sceneVoicePickerOpen = !sceneVoicePickerOpen"
          >▾</button>
          <SceneVoicePicker
            v-if="sceneVoicePickerOpen"
            :turns="dialogueTurnsForPicker"
            content-kind="dialogue"
            @accept="onSceneVoicesAccepted"
            @close="sceneVoicePickerOpen = false"
          />
        </div>
      </div>
      <p v-if="content.dialogue.scenario" class="dialogue-scenario">{{ content.dialogue.scenario }}</p>
      <p class="ac-hint">Each character has its own voice — tap a line to hear it, or play the whole scene.</p>

      <div class="turns">
        <div
          v-for="(t, ti) in content.dialogue.turns"
          :key="ti"
          class="turn"
          :class="[{ speaking: sequenceIndex === ti }, ti % 2 ? 'right' : 'left']"
        >
          <div class="turn-speaker">{{ t.speaker }}</div>
          <div class="turn-bubble">
            <div class="turn-line" :class="{ rtl: isRtlLang(content.dialogue.lang || primaryLang) }">
              <p class="turn-text" :class="fontClassFor(content.dialogue.lang || primaryLang)" :style="{ fontSize: (1.1 * fontScale) + 'rem' }">{{ t.text }}</p>
              <SpeakButton :text="t.text" :lang="content.dialogue.lang || primaryLang" :voice-name="voiceForTurn(t)" size="sm" label="Play" content-kind="dialogue" />
            </div>
            <p v-if="t.transliteration" class="turn-tr">{{ t.transliteration }}</p>
            <p v-if="showMeaning && t.en" class="turn-en">{{ t.en }}</p>
            <p v-if="showMeaning && t.ur" class="turn-ur font-urdu">{{ t.ur }}</p>
          </div>
        </div>
      </div>
    </div>

    <!-- ─── STORY / READING (Arabic·Urdu·English literacy) ─────────── -->
    <div v-else-if="(kind === 'story' || kind === 'reading') && content.story" class="story">
      <div class="story-head">
        <h3 class="story-title">{{ content.story.title }}</h3>
        <SpeakButton :text="content.story.paragraphs.join(' ')" :lang="content.story.lang || primaryLang" size="md" label="Read whole story" :rate="0.9" content-kind="story" />
      </div>

      <img
        v-if="content.story.image && content.story.image.url"
        :src="content.story.image.url"
        :alt="content.story.image.alt || content.story.title"
        class="story-image"
        loading="lazy"
      />

      <div v-if="content.story.vocab?.length" class="vocab">
        <h4 class="sub-h">Words to know</h4>
        <ul class="vocab-list" :class="{ 'has-pics': vocabHasPictures }">
          <li v-for="(v, vi) in content.story.vocab" :key="vi" class="vocab-item" :class="{ 'with-pic': v.image && v.image.url }">
            <img
              v-if="v.image && v.image.url"
              :src="v.image.url"
              :alt="v.image.alt || v.word"
              class="vocab-pic"
              loading="lazy"
            />
            <div class="vocab-text">
              <SpeakButton :text="v.word" :lang="content.story.lang || primaryLang" size="sm" content-kind="vocab" />
              <strong
                class="vocab-word"
                :class="fontClassFor(content.story.lang || primaryLang)"
                :dir="isRtlLang(content.story.lang || primaryLang) ? 'rtl' : 'ltr'"
                :style="{ fontSize: (1.4 * fontScale) + 'rem' }"
              >{{ v.word }}</strong>
              <span class="vocab-meaning">— {{ v.meaning }}</span>
            </div>
          </li>
        </ul>
      </div>

      <div class="passage" :class="[fontClassFor(content.story.lang || primaryLang), { rtl: /^(ar|ur|fa)/.test((content.story.lang || primaryLang).toLowerCase()) }]">
        <div v-for="(para, pi) in storyParagraphs" :key="pi" class="para">
          <div class="para-tools">
            <SpeakButton :text="para.text" :lang="content.story.lang || primaryLang" size="md" label="Paragraph" :rate="0.9" content-kind="story" />
          </div>
          <p class="para-body" :style="{ fontSize: (1.15 * fontScale) + 'rem' }">
            <span v-for="(sent, si) in para.sentences" :key="si" class="sentence">
              <SpeakButton :text="sent.text" :lang="content.story.lang || primaryLang" size="sm" :rate="0.85" content-kind="story" />
              <span
                v-for="(word, wi) in sent.words"
                :key="wi"
                class="word"
                :title="`Tap to hear: ${word}`"
                @click="speak(word, content.story.lang || primaryLang, { rate: 0.8, contentKind: 'story' })"
              >{{ word }}</span>
            </span>
          </p>
          <div v-if="showMeaning && para.translation" class="para-translation">
            <p v-if="para.translation.en" class="para-tr-en" :style="{ fontSize: (1 * fontScale) + 'rem' }">{{ para.translation.en }}</p>
            <p v-if="para.translation.ur" class="para-tr-ur font-urdu" :style="{ fontSize: (1.05 * fontScale) + 'rem' }">{{ para.translation.ur }}</p>
          </div>
        </div>
      </div>

      <div v-if="content.story.comprehension?.length" class="comprehension">
        <h4 class="sub-h">Talk about it</h4>
        <ol class="comp-list">
          <li v-for="(q, qi) in content.story.comprehension" :key="qi">{{ q }}</li>
        </ol>
      </div>
    </div>

    <!-- ─── PROBLEMS (math) ────────────────────────────────────────── -->
    <div v-else-if="kind === 'problems'" class="problems">
      <p class="ac-hint">Solve each problem. Tap to check your answer.</p>
      <ol class="problem-list">
        <li v-for="(p, pi) in content.problems" :key="pi" class="problem">
          <div class="problem-q-row">
            <span class="problem-q" :class="{ 'problem-q-vertical': p.question.includes('\n') }">{{ p.question }}</span>
            <SpeakButton :text="p.question" :lang="primaryLang" size="sm" content-kind="instructional" />
          </div>
          <div class="problem-actions">
            <button v-if="p.hint" type="button" class="mini-btn" @click="revealHint[pi] = !revealHint[pi]">
              {{ revealHint[pi] ? "Hide hint" : "Hint" }}
            </button>
            <button type="button" class="mini-btn primary" @click="revealAnswer[pi] = !revealAnswer[pi]">
              {{ revealAnswer[pi] ? "Hide answer" : "Check answer" }}
            </button>
          </div>
          <p v-if="revealHint[pi] && p.hint" class="problem-hint">💡 {{ p.hint }}</p>
          <div v-if="revealAnswer[pi]" class="problem-answer">
            <strong>Answer:</strong> {{ p.answer }}
            <p v-if="p.working" class="problem-working">{{ p.working }}</p>
          </div>
        </li>
      </ol>
    </div>

    <!-- ─── STEPS / WORKSHEET ──────────────────────────────────────── -->
    <div v-else-if="kind === 'steps' && content.worksheet" class="worksheet">
      <p v-if="content.worksheet.goal" class="ws-goal">🎯 {{ content.worksheet.goal }}</p>

      <div v-if="content.worksheet.materials?.length" class="ws-materials">
        <h4 class="sub-h">You’ll need</h4>
        <ul class="ws-mat-list">
          <li v-for="(m, mi) in content.worksheet.materials" :key="mi">{{ m }}</li>
        </ul>
      </div>

      <h4 class="sub-h">Steps</h4>
      <ol class="ws-steps">
        <li v-for="(s, si) in content.worksheet.steps" :key="si" class="ws-step">
          <div class="ws-step-row">
            <span class="ws-step-text">{{ s.instruction }}</span>
            <SpeakButton :text="s.instruction" :lang="primaryLang" size="sm" content-kind="instructional" />
          </div>
          <p v-if="s.detail" class="ws-step-detail">{{ s.detail }}</p>
        </li>
      </ol>

      <div v-if="content.worksheet.checks?.length" class="ws-checks">
        <h4 class="sub-h">Did it work?</h4>
        <ul class="ws-check-list">
          <li v-for="(c, ci) in content.worksheet.checks" :key="ci">✓ {{ c }}</li>
        </ul>
      </div>
    </div>

    <!-- ─── FLASHCARDS (legacy) ────────────────────────────────────── -->
    <div v-else-if="kind === 'flashcards'" class="flashcards">
      <p class="ac-hint">Tap a card to flip it. Tap 🔊 to hear it.</p>
      <div class="card-grid">
        <div v-for="(card, i) in content.cards" :key="i" class="flashcard" :class="{ flipped: flipped[i] }" @click="toggleFlip(i)">
          <div class="fc-inner">
            <div class="fc-face fc-front">
              <div class="fc-top-tools" @click.stop>
                <SpeakButton :text="card.front" :lang="card.frontLang || primaryLang" size="md" label="Listen" content-kind="vocab" />
              </div>
              <p class="fc-front-text" :class="[fontClassFor(card.frontLang || primaryLang), { rtl: /^(ar|ur|fa)/.test((card.frontLang || primaryLang).toLowerCase()) }]">{{ card.front }}</p>
              <p v-if="card.transliteration" class="fc-translit">{{ card.transliteration }}</p>
              <span class="fc-flip-hint">tap to flip →</span>
            </div>
            <div class="fc-face fc-back">
              <div class="fc-top-tools" @click.stop>
                <SpeakButton :text="card.back" :lang="card.backLang || 'en'" size="md" label="Listen" content-kind="vocab" />
              </div>
              <p class="fc-back-text">{{ card.back }}</p>
              <p v-if="card.note" class="fc-note">💡 {{ card.note }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ─── TIPS (parent-led lesson kit: embedded story + facilitation) ─ -->
    <div v-else-if="kind === 'tips' && content.tips" class="tips">
      <!-- Ready-to-use story / scenario, written out in full so the parent has
           nothing to source. Rendered before the facilitation guidance. -->
      <div v-if="tipsStory" class="tips-story">
        <div class="story-head">
          <h3 class="story-title" :class="fontClassFor(tipsStory.lang || tipsLang)">{{ tipsStory.title || "Story" }}</h3>
          <SpeakButton :text="tipsStoryReadText" :lang="tipsStory.lang || tipsLang" size="md" label="Read aloud" :rate="0.9" content-kind="story" />
        </div>
        <div class="passage" :class="[fontClassFor(tipsStory.lang || tipsLang), { rtl: isRtlLang(tipsStory.lang || tipsLang) }]">
          <div v-for="(para, pi) in tipsStory.paragraphs" :key="pi" class="para">
            <div class="para-tools">
              <SpeakButton :text="para" :lang="tipsStory.lang || tipsLang" size="sm" label="Paragraph" :rate="0.9" content-kind="story" />
            </div>
            <p class="para-body" :style="{ fontSize: (1.15 * fontScale) + 'rem' }">{{ para }}</p>
          </div>
        </div>
        <p v-if="tipsStory.moral" class="tips-moral" :class="[fontClassFor(tipsStory.lang || tipsLang), { rtl: isRtlLang(tipsStory.lang || tipsLang) }]">
          <span class="tips-moral-ico">🌱</span>{{ tipsStory.moral }}
        </p>
      </div>

      <div v-if="tipsDiscussion.length" class="tips-block">
        <div class="tips-block-head">
          <h4 class="sub-h">💬 Talk about it</h4>
          <button type="button" class="section-play" aria-label="Play discussion questions" @click="playSection(tipsDiscussion)">🔊 Play section</button>
        </div>
        <ul class="tips-list" :class="[fontClassFor(tipsLang), { rtl: isRtlLang(tipsLang) }]">
          <li v-for="(q, i) in tipsDiscussion" :key="i" class="tip-line" :class="{ speaking: speakingId === lineId(q) }">
            <SpeakButton :text="q" :lang="tipsLang" size="sm" class="tip-speak" content-kind="tips" />
            <span class="tip-text">{{ q }}</span>
          </li>
        </ul>
      </div>

      <p class="ac-hint">Here's how to guide it well. Tap 🔊 to hear any line, or play a whole section.</p>
      <div v-for="section in tipsSections" :key="section.key" class="tips-block">
        <div class="tips-block-head">
          <h4 class="sub-h">{{ section.icon }} {{ section.title }}</h4>
          <button
            type="button"
            class="section-play"
            :aria-label="`Play whole section: ${section.title}`"
            @click="playSection(section.items)"
          >🔊 Play section</button>
        </div>
        <ul class="tips-list" :class="[fontClassFor(tipsLang), { rtl: isRtlLang(tipsLang) }]">
          <li
            v-for="(t, i) in section.items"
            :key="i"
            class="tip-line"
            :class="{ speaking: speakingId === lineId(t) }"
          >
            <SpeakButton :text="t" :lang="tipsLang" size="sm" class="tip-speak" content-kind="tips" />
            <span class="tip-text">{{ t }}</span>
          </li>
        </ul>
      </div>
    </div>

    <!-- Fallback when content is malformed/empty -->
    <p v-else class="ac-empty">No interactive content is available for this activity yet.</p>

    <!-- Global audio status + diagnostics-on-request -->
    <p v-if="loadingId" class="audio-status" role="status">
      <span class="spin-sm" aria-hidden="true"></span> Preparing audio…
    </p>
    <p v-else-if="lastError" class="audio-error" role="status">🔇 {{ lastError }}</p>
    <details v-if="ttsLogs.length" class="audio-diag">
      <summary>Audio diagnostics</summary>
      <ul class="audio-log"><li v-for="(l, i) in ttsLogs" :key="i">{{ l }}</li></ul>
    </details>
  </div>
</template>

<style scoped>
.activity-content { width: 100%; }
.voice-warn { background: #fef9c3; color: #854d0e; padding: 0.5rem 0.75rem; border-radius: 8px; font-size: 0.85rem; margin: 0 0 0.75rem; }
.ac-topbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.75rem; margin-bottom: 1rem; }
.ac-instructions { font-size: 1rem; color: #334155; background: rgba(255,255,255,0.6); padding: 0.6rem 0.8rem; border-radius: 8px; margin: 0; line-height: 1.6; flex: 1; }
.ac-hint { font-size: 0.8rem; color: #64748b; margin: 0 0 0.75rem; }
.ac-empty { font-size: 0.9rem; color: #94a3b8; }

/* Tips (parent facilitation) — line-by-line + whole-section audio */
.tips-block { background: rgba(255,255,255,0.7); border: 1px solid #e2e8f0; border-radius: 12px; padding: 0.75rem 0.95rem; margin-bottom: 0.75rem; }
.tips-block-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; margin-bottom: 0.5rem; }
.tips-block-head .sub-h { margin: 0; }
.section-play { border: 1px solid #14532d; background: #14532d; color: #fff; border-radius: 999px; padding: 0.22rem 0.7rem; font-size: 0.78rem; font-weight: 600; cursor: pointer; white-space: nowrap; flex-shrink: 0; transition: background 0.12s; }
.section-play:hover { background: #1a6b3a; }
.section-play:active { transform: scale(0.96); }
.tips-list { list-style: none; margin: 0; padding: 0; color: #1e293b; display: flex; flex-direction: column; gap: 0.35rem; }
.tips-list li { margin: 0; }
.tip-line { display: flex; align-items: flex-start; gap: 0.5rem; padding: 0.3rem 0.4rem; border-radius: 8px; transition: background 0.15s; }
.tip-line.speaking { background: #dcfce7; }
.tip-speak { margin-top: 0.15rem; flex-shrink: 0; }
.tip-text { flex: 1; line-height: 1.8; }
.tips-list.rtl .tip-text { text-align: right; }
/* Nastaliq needs more size + vertical room to read beautifully. */
.tips-list.font-urdu .tip-text { font-size: 1.3rem; line-height: 2.6; }

/* Tips — embedded ready-to-use story + its moral */
.tips-story { background: rgba(255,255,255,0.7); border: 1px solid #e2e8f0; border-radius: 12px; padding: 0.85rem 1rem; margin-bottom: 0.85rem; }
.tips-story .story-head { margin-bottom: 0.6rem; }
.tips-moral { margin: 0.75rem 0 0; padding: 0.6rem 0.8rem; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; color: #166534; line-height: 1.7; }
.tips-moral.rtl { text-align: right; }
.tips-moral.font-urdu { font-size: 1.25rem; line-height: 2.4; }
.tips-moral-ico { margin-right: 0.4rem; }
.tips-moral.rtl .tips-moral-ico { margin: 0 0 0 0.4rem; }

/* Audio status + diagnostics */
.audio-status { display: flex; align-items: center; gap: 0.4rem; font-size: 0.82rem; color: #475569; margin: 0.75rem 0 0; }
.audio-error { font-size: 0.82rem; color: #9a3412; background: #ffedd5; border-radius: 8px; padding: 0.4rem 0.6rem; margin: 0.75rem 0 0; }
.spin-sm { display: inline-block; width: 12px; height: 12px; border-radius: 50%; border: 2px solid #cbd5e1; border-top-color: #0b1f3a; animation: spin 0.7s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.audio-diag { margin-top: 0.5rem; font-size: 0.78rem; color: #64748b; }
.audio-diag summary { cursor: pointer; }
.audio-log { margin: 0.4rem 0 0; padding-left: 1rem; line-height: 1.5; }
.sub-h { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; margin: 0 0 0.5rem; }
.rtl { direction: rtl; }

.ac-controls { display: flex; align-items: center; gap: 0.5rem; flex-shrink: 0; }
.font-ctrl { display: flex; gap: 0.3rem; flex-shrink: 0; }
.font-ctrl button { border: 1px solid #cbd5e1; background: #fff; color: #334155; border-radius: 8px; padding: 0.25rem 0.6rem; font-size: 0.85rem; font-weight: 700; cursor: pointer; }
.font-ctrl button:hover { background: #f1f5f9; }
.meaning-toggle { border: 1px solid #cbd5e1; background: #fff; color: #334155; border-radius: 999px; padding: 0.25rem 0.7rem; font-size: 0.8rem; font-weight: 600; cursor: pointer; white-space: nowrap; }
.meaning-toggle:hover { background: #f1f5f9; }
.meaning-toggle.on { background: #14532d; border-color: #14532d; color: #fff; }

/* Word-by-word gloss (English + Urdu) under each Arabic word */
.ayah-word.with-gloss { display: inline-flex; flex-direction: column; align-items: center; vertical-align: top; margin: 0 0.15rem 0.5rem; }
.aw-gloss { display: flex; flex-direction: column; align-items: center; gap: 0.05rem; margin-top: 0.15rem; line-height: 1.3; }
.aw-tr { font-size: 0.7rem; color: #15803d; font-style: italic; direction: ltr; }
.aw-en { font-size: 0.72rem; color: #475569; direction: ltr; }
.aw-ur { font-size: 0.8rem; color: #334155; direction: rtl; }
.glyph-en { font-size: 0.72rem; color: #475569; }
.glyph-ur { font-size: 0.85rem; color: #334155; direction: rtl; }

/* Quran */
.quran-head { display: flex; align-items: baseline; gap: 0.6rem; flex-wrap: wrap; }
.quran-surah { font-size: 1.3rem; color: #14532d; margin: 0; }
.quran-ref { font-size: 0.85rem; color: #64748b; }
.quran-verified { font-size: 0.72rem; font-weight: 700; color: #166534; background: #dcfce7; padding: 0.1rem 0.5rem; border-radius: 999px; }
.quran-unverified { font-size: 0.72rem; font-weight: 700; color: #9a3412; background: #ffedd5; padding: 0.1rem 0.5rem; border-radius: 999px; }
/* Bismillah — shown as its own centered line, separate from the ayah it's
   textually fused to in the verified source, with no ayah number of its own. */
.bismillah-line { display: flex; flex-direction: column; align-items: center; gap: 0.35rem; margin-bottom: 0.6rem; }
.bismillah-arabic { direction: rtl; text-align: center; color: #14532d; font-weight: 600; margin: 0; }
.ayah { background: rgba(255,255,255,0.7); border: 1px solid #dcfce7; border-radius: 14px; padding: 1rem 1.1rem; margin-bottom: 0.9rem; }
.ayah-tools { display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.5rem; }
.ayah-num { display: inline-flex; align-items: center; justify-content: center; min-width: 1.5rem; height: 1.5rem; border-radius: 999px; background: #dcfce7; color: #166534; font-size: 0.75rem; font-weight: 700; }
.ayah-arabic { direction: rtl; text-align: right; line-height: 2.4; color: #0f172a; margin: 0.25rem 0; font-weight: 600; }
.ayah-word { cursor: pointer; padding: 0 0.2rem; border-radius: 6px; transition: background 0.1s; }
.ayah-word:hover { background: #bbf7d0; }
.ayah-translit { color: #15803d; font-style: italic; margin: 0.4rem 0 0.2rem; line-height: 1.6; }
.ayah-translation { color: #475569; margin: 0.2rem 0 0; line-height: 1.6; }

/* Qaida */
.qaida-ex { background: rgba(255,255,255,0.7); border: 1px solid #e2e8f0; border-radius: 12px; padding: 1rem; margin-bottom: 0.9rem; }
.qaida-title { font-size: 1rem; color: #1e3a5f; margin: 0 0 0.25rem; }
.qaida-instruction { font-size: 0.9rem; color: #475569; margin: 0 0 0.75rem; line-height: 1.5; }
.glyph-grid { display: flex; flex-wrap: wrap; gap: 0.6rem; }
/* Cell wraps the glyph button so the voice caret + picker can anchor to it (a button
   can't nest another button). */
.glyph-cell { position: relative; display: inline-flex; }
.glyph { display: flex; flex-direction: column; align-items: center; gap: 0.2rem; min-width: 64px; max-width: 140px; padding: 0.6rem 0.8rem; border: 1px solid #cbd5e1; border-radius: 12px; background: #fff; cursor: pointer; transition: background 0.12s, transform 0.08s; }
/* A glyph with a saved custom voice — violet accent, like SpeakButton.saved. */
.glyph-saved { border-color: #c4b5fd; }
.glyph-saved:hover { background: #f5f3ff; }
.glyph-voice {
  position: absolute; top: -0.4rem; right: -0.4rem; z-index: 2;
  width: 1.3rem; height: 1.3rem; padding: 0; border-radius: 999px;
  border: 1px solid #cbd5e1; background: #fff; color: #64748b;
  font-size: 0.65rem; line-height: 1; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  box-shadow: 0 1px 3px rgba(15,23,42,0.12); transition: background 0.12s, border-color 0.12s;
}
.glyph-voice:hover { background: #f5f3ff; border-color: #c4b5fd; color: #6d28d9; }
.glyph:hover { background: #eff6ff; }
.glyph:active { transform: scale(0.95); }
/* Linked to the shared library (curated spell-out recording) — subtle accent. */
.glyph-lib { border-color: #93c5fd; }
.glyph-lib:hover { background: #eaf2ff; }
.glyph-pic { width: 84px; height: 84px; object-fit: cover; border-radius: 10px; background: #f1f5f9; margin-bottom: 0.15rem; }
.glyph-text { font-size: 1.8rem; font-weight: 700; color: #0f172a; }
.glyph-translit { font-size: 0.72rem; color: #64748b; }
.glyph-spell { font-size: 0.66rem; color: #2563eb; text-align: center; line-height: 1.25; }
.glyph-ico { font-size: 0.75rem; opacity: 0.6; }

/* Dialogue / conversation */
.dialogue-head { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap; }
.dialogue-title { font-size: 1.2rem; color: #0f172a; margin: 0; }
.scene-actions { position: relative; display: flex; align-items: center; gap: 0.4rem; }
.scene-btn { border: 1px solid #0b1f3a; background: #0b1f3a; color: #fff; border-radius: 999px; padding: 0.35rem 0.85rem; font-size: 0.82rem; font-weight: 600; cursor: pointer; }
.scene-btn:hover { background: #13294d; }
/* The ▾ caret that opens the scene-wide voice picker (parent view only). */
.scene-voice-btn {
  display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid #cbd5e1; background: #fff; color: #64748b;
  border-radius: 999px; cursor: pointer; line-height: 1; font-size: 0.7rem;
  width: 1.6rem; height: 1.6rem; padding: 0;
  transition: background 0.12s, border-color 0.12s;
}
.scene-voice-btn:hover { background: #f5f3ff; border-color: #c4b5fd; color: #6d28d9; }
.dialogue-scenario { font-size: 0.92rem; color: #475569; font-style: italic; margin: 0.4rem 0 0; }
.turns { display: flex; flex-direction: column; gap: 0.7rem; margin-top: 0.75rem; }
.turn { max-width: 88%; }
.turn.left { align-self: flex-start; }
.turn.right { align-self: flex-end; }
.turn-speaker { font-size: 0.72rem; font-weight: 700; color: #64748b; margin-bottom: 0.2rem; }
.turn.right .turn-speaker { text-align: right; }
.turn-bubble { background: rgba(255,255,255,0.85); border: 1px solid #e2e8f0; border-radius: 14px; padding: 0.6rem 0.8rem; }
.turn.right .turn-bubble { background: #eef2ff; border-color: #c7d2fe; }
.turn.speaking .turn-bubble { box-shadow: 0 0 0 2px #6366f1; }
.turn-line { display: flex; align-items: center; gap: 0.5rem; }
.turn-line.rtl { flex-direction: row-reverse; }
.turn-text { margin: 0; color: #0f172a; font-size: 1.1rem; line-height: 1.8; flex: 1; }
.turn-tr { margin: 0.25rem 0 0; font-size: 0.82rem; color: #15803d; font-style: italic; }
.turn-en { margin: 0.2rem 0 0; font-size: 0.85rem; color: #475569; }
.turn-ur { margin: 0.2rem 0 0; font-size: 0.95rem; color: #334155; direction: rtl; }

/* Story */
.story-head { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap; margin-bottom: 0.9rem; }
.story-title { font-size: 1.2rem; color: #0f172a; margin: 0; }
.story-image { display: block; width: 100%; max-width: 480px; margin: 0 auto 1rem; border-radius: 16px; box-shadow: 0 2px 12px rgba(0,0,0,0.1); }
.vocab { background: rgba(255,255,255,0.7); border-radius: 10px; padding: 0.75rem 0.9rem; margin-bottom: 1rem; }
.vocab-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.4rem; }
.vocab-item { display: flex; align-items: center; gap: 0.5rem; font-size: 0.95rem; color: #1e293b; }
.vocab-word { color: #0f172a; }
.vocab-meaning { color: #475569; }
/* Picture-naming layout: when vocab words carry generated pictures, lay them out
   as picture cards (letter-sound / picture-association activities). */
.vocab-list.has-pics { flex-direction: row; flex-wrap: wrap; gap: 0.9rem; }
.vocab-list.has-pics .vocab-item.with-pic { flex-direction: column; align-items: center; gap: 0.4rem; width: 140px; background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 0.6rem; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
.vocab-pic { width: 116px; height: 116px; object-fit: cover; border-radius: 10px; background: #f1f5f9; }
.vocab-text { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; justify-content: center; }
.passage { display: flex; flex-direction: column; gap: 1rem; }
.para { background: rgba(255,255,255,0.55); border-radius: 10px; padding: 0.75rem 0.9rem; }
.para-tools { margin-bottom: 0.4rem; }
.para-body { margin: 0; line-height: 2.1; color: #1e293b; }
.sentence { margin-right: 0.3rem; }
.word { display: inline-block; cursor: pointer; margin: 0 0.12rem; padding: 0 0.12rem; border-radius: 4px; transition: background 0.1s; }
.word:hover { background: #dbeafe; }
/* Per-paragraph translation for non-native (e.g. Arabic) reading passages. */
.para-translation { margin-top: 0.5rem; padding-top: 0.5rem; border-top: 1px dashed #cbd5e1; }
.para-tr-en { margin: 0; color: #475569; line-height: 1.6; direction: ltr; text-align: left; }
.para-tr-ur { margin: 0.3rem 0 0; color: #334155; line-height: 1.9; direction: rtl; text-align: right; }
.comprehension { margin-top: 1rem; background: rgba(255,255,255,0.7); border-radius: 10px; padding: 0.75rem 0.9rem; }
.comp-list { margin: 0; padding-left: 1.2rem; color: #1e293b; font-size: 0.95rem; line-height: 1.7; }

/* Problems */
.problem-list { list-style: decimal; padding-left: 1.4rem; margin: 0; display: flex; flex-direction: column; gap: 0.85rem; }
.problem { background: rgba(255,255,255,0.7); border: 1px solid #f3e8ff; border-radius: 12px; padding: 0.8rem 0.9rem; }
.problem-q-row { display: flex; align-items: center; gap: 0.5rem; justify-content: space-between; }
.problem-q { font-size: 1.2rem; color: #0f172a; font-weight: 600; }
.problem-q-vertical { white-space: pre; font-family: "Courier New", ui-monospace, monospace; line-height: 1.3; display: inline-block; }
.problem-actions { display: flex; gap: 0.5rem; margin-top: 0.6rem; }
.mini-btn { border: 1px solid #cbd5e1; background: #fff; color: #475569; border-radius: 999px; padding: 0.25rem 0.8rem; font-size: 0.8rem; cursor: pointer; }
.mini-btn.primary { background: #4a1d96; border-color: #4a1d96; color: #fff; }
.mini-btn:hover { filter: brightness(0.97); }
.problem-hint { margin: 0.5rem 0 0; font-size: 0.9rem; color: #6b21a8; }
.problem-answer { margin: 0.6rem 0 0; font-size: 0.95rem; color: #166534; background: #f0fdf4; border-radius: 8px; padding: 0.5rem 0.7rem; }
.problem-working { margin: 0.35rem 0 0; color: #475569; white-space: pre-wrap; font-size: 0.9rem; }

/* Worksheet / steps */
.ws-goal { font-size: 1.05rem; color: #0c4a6e; background: #f0f9ff; border-radius: 10px; padding: 0.6rem 0.8rem; margin: 0 0 1rem; }
.ws-materials, .ws-checks { margin-bottom: 1rem; }
.ws-mat-list, .ws-check-list { margin: 0; padding-left: 1.2rem; color: #1e293b; line-height: 1.7; }
.ws-check-list { list-style: none; padding-left: 0; }
.ws-steps { margin: 0 0 1rem; padding-left: 1.4rem; display: flex; flex-direction: column; gap: 0.7rem; }
.ws-step-row { display: flex; align-items: center; gap: 0.5rem; justify-content: space-between; }
.ws-step-text { color: #0f172a; font-weight: 500; }
.ws-step-detail { margin: 0.3rem 0 0; color: #64748b; font-size: 0.9rem; line-height: 1.5; }

/* Flashcards (legacy) */
.card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 0.9rem; }
.flashcard { perspective: 1000px; min-height: 170px; cursor: pointer; }
.fc-inner { position: relative; width: 100%; height: 100%; min-height: 170px; transition: transform 0.5s; transform-style: preserve-3d; }
.flashcard.flipped .fc-inner { transform: rotateY(180deg); }
.fc-face { position: absolute; inset: 0; backface-visibility: hidden; border-radius: 14px; border: 1px solid #e2e8f0; background: #fff; padding: 0.9rem; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.5rem; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
.fc-back { transform: rotateY(180deg); background: #f8fafc; }
.fc-top-tools { position: absolute; top: 0.5rem; right: 0.5rem; }
.fc-front-text { font-size: 1.5rem; font-weight: 700; color: #0f172a; margin: 0.5rem 0 0; line-height: 1.5; }
.fc-front-text.rtl { font-size: 1.9rem; }
.fc-translit { font-size: 0.85rem; color: #64748b; font-style: italic; margin: 0; }
.fc-back-text { font-size: 1.05rem; color: #1e293b; margin: 0.5rem 0 0; line-height: 1.5; }
.fc-note { font-size: 0.8rem; color: #475569; margin: 0.3rem 0 0; }
.fc-flip-hint { position: absolute; bottom: 0.5rem; font-size: 0.68rem; color: #cbd5e1; }
</style>
