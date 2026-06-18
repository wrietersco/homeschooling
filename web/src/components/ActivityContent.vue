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
import { ref, computed } from "vue";
import SpeakButton from "@/components/SpeakButton.vue";
import { useSpeech } from "@/composables/useSpeech";

const props = defineProps({
  content: { type: Object, required: true },
});

const { speak, playAudio } = useSpeech();

const kind = computed(() => props.content?.kind || "steps");
const primaryLang = computed(() => props.content?.primaryLang || "en");

// Recite a single Quran word — real qirat audio if present, else TTS.
function reciteWord(w) {
  if (w.audioUrl) {
    playAudio(w.audioUrl, { onError: () => speak(w.arabic, "ar", { rate: 0.75 }) });
  } else {
    speak(w.arabic, "ar", { rate: 0.75 });
  }
}

// Professional Arabic now comes from Gemini TTS (server), so we no longer warn
// about a missing OS Arabic voice for qaida — the browser voice is only a
// last-resort offline fallback.

// Reading-text size control (spec: child can enlarge / en-small the text).
const fontScale = ref(1);
const canScale = computed(() => kind.value === "quran_reading" || kind.value === "story");
function bigger() { fontScale.value = Math.min(2.2, +(fontScale.value + 0.15).toFixed(2)); }
function smaller() { fontScale.value = Math.max(0.7, +(fontScale.value - 0.15).toFixed(2)); }

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

const storyParagraphs = computed(() =>
  (props.content?.story?.paragraphs || []).map((p) => ({
    text: p,
    sentences: splitSentences(p).map((s) => ({ text: s, words: splitWords(s) })),
  }))
);
</script>

<template>
  <div class="activity-content">
    <div class="ac-topbar">
      <p v-if="content.instructions" class="ac-instructions">{{ content.instructions }}</p>
      <div v-if="canScale" class="font-ctrl" role="group" aria-label="Text size">
        <button type="button" @click="smaller" aria-label="Smaller text">A−</button>
        <button type="button" @click="bigger" aria-label="Larger text">A+</button>
      </div>
    </div>

    <!-- ─── QURAN READING ──────────────────────────────────────────── -->
    <div v-if="kind === 'quran_reading' && content.quran" class="quran">
      <div class="quran-head">
        <h3 class="quran-surah">{{ content.quran.surahName || "Quran" }}</h3>
        <span v-if="content.quran.reference" class="quran-ref">{{ content.quran.reference }}</span>
        <span
          v-if="content.quran.textSource === 'quran.foundation' || content.quran.textSource === 'curated'"
          class="quran-verified"
          title="Arabic text verified against Quran Foundation"
        >✓ Verified text</span>
        <span
          v-else-if="content.quran.textSource"
          class="quran-unverified"
          title="The verified Quran source was unavailable; this Arabic was AI-drafted — check before relying on it."
        >⚠ Unverified text</span>
      </div>
      <p class="ac-hint">Tap any word to hear it recited, or use “Recite ayah” for the whole verse.</p>

      <div v-for="(v, vi) in content.quran.verses" :key="vi" class="ayah">
        <div class="ayah-tools">
          <span class="ayah-num">{{ vi + 1 }}</span>
          <SpeakButton :text="v.arabic" lang="ar" :audio-url="v.audioUrl" size="md" label="Recite ayah" :rate="0.8" />
        </div>
        <p class="ayah-arabic" :style="{ fontSize: (2 * fontScale) + 'rem' }">
          <template v-if="v.words && v.words.length">
            <span
              v-for="(w, wi) in v.words"
              :key="wi"
              class="ayah-word"
              :title="w.transliteration ? `${w.transliteration} — tap to recite` : 'tap to recite'"
              @click="reciteWord(w)"
            >{{ w.arabic }}</span>
          </template>
          <template v-else>{{ v.arabic }}</template>
        </p>
        <p v-if="v.transliteration" class="ayah-translit" :style="{ fontSize: (0.95 * fontScale) + 'rem' }">{{ v.transliteration }}</p>
        <p v-if="v.translation" class="ayah-translation" :style="{ fontSize: (1 * fontScale) + 'rem' }">{{ v.translation }}</p>
      </div>
    </div>

    <!-- ─── QAIDA EXERCISES ────────────────────────────────────────── -->
    <div v-else-if="kind === 'qaida_exercise'" class="qaida">
      <div v-for="(ex, ei) in content.exercises" :key="ei" class="qaida-ex">
        <h3 class="qaida-title">{{ ex.title }}</h3>
        <p class="qaida-instruction">{{ ex.instruction }}</p>
        <div class="glyph-grid">
          <button
            v-for="(it, ii) in ex.items"
            :key="ii"
            type="button"
            class="glyph"
            :title="it.hint || it.transliteration || 'Recite'"
            @click="speak(it.text, ex.lang || primaryLang, { rate: 0.8 })"
          >
            <span class="glyph-text">{{ it.text }}</span>
            <span v-if="it.transliteration" class="glyph-translit">{{ it.transliteration }}</span>
            <span class="glyph-ico">🔊</span>
          </button>
        </div>
      </div>
    </div>

    <!-- ─── STORY ──────────────────────────────────────────────────── -->
    <div v-else-if="kind === 'story' && content.story" class="story">
      <div class="story-head">
        <h3 class="story-title">{{ content.story.title }}</h3>
        <SpeakButton :text="content.story.paragraphs.join(' ')" :lang="content.story.lang || primaryLang" size="md" label="Read whole story" :rate="0.9" />
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
        <ul class="vocab-list">
          <li v-for="(v, vi) in content.story.vocab" :key="vi" class="vocab-item">
            <SpeakButton :text="v.word" :lang="content.story.lang || primaryLang" size="sm" />
            <strong class="vocab-word">{{ v.word }}</strong>
            <span class="vocab-meaning">— {{ v.meaning }}</span>
          </li>
        </ul>
      </div>

      <div class="passage" :class="{ rtl: (content.story.lang || primaryLang).startsWith('ar') }">
        <div v-for="(para, pi) in storyParagraphs" :key="pi" class="para">
          <div class="para-tools">
            <SpeakButton :text="para.text" :lang="content.story.lang || primaryLang" size="md" label="Paragraph" :rate="0.9" />
          </div>
          <p class="para-body" :style="{ fontSize: (1.15 * fontScale) + 'rem' }">
            <span v-for="(sent, si) in para.sentences" :key="si" class="sentence">
              <SpeakButton :text="sent.text" :lang="content.story.lang || primaryLang" size="sm" :rate="0.85" />
              <span
                v-for="(word, wi) in sent.words"
                :key="wi"
                class="word"
                :title="`Tap to hear: ${word}`"
                @click="speak(word, content.story.lang || primaryLang, { rate: 0.8 })"
              >{{ word }}</span>
            </span>
          </p>
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
            <span class="problem-q">{{ p.question }}</span>
            <SpeakButton :text="p.question" :lang="primaryLang" size="sm" />
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
            <SpeakButton :text="s.instruction" :lang="primaryLang" size="sm" />
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
                <SpeakButton :text="card.front" :lang="card.frontLang || primaryLang" size="md" label="Listen" />
              </div>
              <p class="fc-front-text" :class="{ rtl: (card.frontLang || primaryLang).startsWith('ar') }">{{ card.front }}</p>
              <p v-if="card.transliteration" class="fc-translit">{{ card.transliteration }}</p>
              <span class="fc-flip-hint">tap to flip →</span>
            </div>
            <div class="fc-face fc-back">
              <div class="fc-top-tools" @click.stop>
                <SpeakButton :text="card.back" :lang="card.backLang || 'en'" size="md" label="Listen" />
              </div>
              <p class="fc-back-text">{{ card.back }}</p>
              <p v-if="card.note" class="fc-note">💡 {{ card.note }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Fallback when content is malformed/empty -->
    <p v-else class="ac-empty">No interactive content is available for this activity yet.</p>
  </div>
</template>

<style scoped>
.activity-content { width: 100%; }
.voice-warn { background: #fef9c3; color: #854d0e; padding: 0.5rem 0.75rem; border-radius: 8px; font-size: 0.85rem; margin: 0 0 0.75rem; }
.ac-topbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.75rem; margin-bottom: 1rem; }
.ac-instructions { font-size: 1rem; color: #334155; background: rgba(255,255,255,0.6); padding: 0.6rem 0.8rem; border-radius: 8px; margin: 0; line-height: 1.6; flex: 1; }
.ac-hint { font-size: 0.8rem; color: #64748b; margin: 0 0 0.75rem; }
.ac-empty { font-size: 0.9rem; color: #94a3b8; }
.sub-h { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; margin: 0 0 0.5rem; }
.rtl { direction: rtl; }

.font-ctrl { display: flex; gap: 0.3rem; flex-shrink: 0; }
.font-ctrl button { border: 1px solid #cbd5e1; background: #fff; color: #334155; border-radius: 8px; padding: 0.25rem 0.6rem; font-size: 0.85rem; font-weight: 700; cursor: pointer; }
.font-ctrl button:hover { background: #f1f5f9; }

/* Quran */
.quran-head { display: flex; align-items: baseline; gap: 0.6rem; flex-wrap: wrap; }
.quran-surah { font-size: 1.3rem; color: #14532d; margin: 0; }
.quran-ref { font-size: 0.85rem; color: #64748b; }
.quran-verified { font-size: 0.72rem; font-weight: 700; color: #166534; background: #dcfce7; padding: 0.1rem 0.5rem; border-radius: 999px; }
.quran-unverified { font-size: 0.72rem; font-weight: 700; color: #9a3412; background: #ffedd5; padding: 0.1rem 0.5rem; border-radius: 999px; }
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
.glyph { display: flex; flex-direction: column; align-items: center; gap: 0.2rem; min-width: 64px; padding: 0.6rem 0.8rem; border: 1px solid #cbd5e1; border-radius: 12px; background: #fff; cursor: pointer; transition: background 0.12s, transform 0.08s; }
.glyph:hover { background: #eff6ff; }
.glyph:active { transform: scale(0.95); }
.glyph-text { font-size: 1.8rem; font-weight: 700; color: #0f172a; }
.glyph-translit { font-size: 0.72rem; color: #64748b; }
.glyph-ico { font-size: 0.75rem; opacity: 0.6; }

/* Story */
.story-head { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap; margin-bottom: 0.9rem; }
.story-title { font-size: 1.2rem; color: #0f172a; margin: 0; }
.story-image { display: block; width: 100%; max-width: 480px; margin: 0 auto 1rem; border-radius: 16px; box-shadow: 0 2px 12px rgba(0,0,0,0.1); }
.vocab { background: rgba(255,255,255,0.7); border-radius: 10px; padding: 0.75rem 0.9rem; margin-bottom: 1rem; }
.vocab-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.4rem; }
.vocab-item { display: flex; align-items: center; gap: 0.5rem; font-size: 0.95rem; color: #1e293b; }
.vocab-word { color: #0f172a; }
.vocab-meaning { color: #475569; }
.passage { display: flex; flex-direction: column; gap: 1rem; }
.para { background: rgba(255,255,255,0.55); border-radius: 10px; padding: 0.75rem 0.9rem; }
.para-tools { margin-bottom: 0.4rem; }
.para-body { margin: 0; line-height: 2.1; color: #1e293b; }
.sentence { margin-right: 0.3rem; }
.word { display: inline-block; cursor: pointer; margin: 0 0.12rem; padding: 0 0.12rem; border-radius: 4px; transition: background 0.1s; }
.word:hover { background: #dbeafe; }
.comprehension { margin-top: 1rem; background: rgba(255,255,255,0.7); border-radius: 10px; padding: 0.75rem 0.9rem; }
.comp-list { margin: 0; padding-left: 1.2rem; color: #1e293b; font-size: 0.95rem; line-height: 1.7; }

/* Problems */
.problem-list { list-style: decimal; padding-left: 1.4rem; margin: 0; display: flex; flex-direction: column; gap: 0.85rem; }
.problem { background: rgba(255,255,255,0.7); border: 1px solid #f3e8ff; border-radius: 12px; padding: 0.8rem 0.9rem; }
.problem-q-row { display: flex; align-items: center; gap: 0.5rem; justify-content: space-between; }
.problem-q { font-size: 1.2rem; color: #0f172a; font-weight: 600; }
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
