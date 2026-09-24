<!-- Explore — live voice conversations with a Pixar-style companion.
     Pick a child and a mode, then just talk:
     • Exploration: the companion tells vivid, story-like answers to whatever the
       child is curious about, starting from their interests.
     • Learning: a patient tutor for anything — speech & articulation, maths,
       reading or any concept — pitched from the child's own progress.
     The companion is powered by the Gemini Live API. It already knows the child
     (a compact brief is loaded by the server) and looks up deeper details on demand.
     Full-screen like the Phonics game. -->
<script setup>
import { computed, nextTick, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useProfilesStore } from "@/stores/profiles";
import { useAuthStore } from "@/stores/auth";
import { useLiveExplore } from "@/composables/useLiveExplore";
import { NOTES_MAX, AVOID_MAX, PACES, REPLY_LENGTHS, LANGUAGES, DEFAULT_SETTINGS, DEFAULT_CAPABILITIES } from "@/lib/exploreOptions";
import { loadExploreSettings, saveExploreSettings, previewExploreVoice } from "@/services/exploreSettings";
import { loadExploreSessions } from "@/services/explore";
import { MODE_LABELS, whenLabel, highlightPairs } from "@/lib/exploreHistory";
import { CELEBRATION_SOUNDS, resolveCelebration } from "@/lib/celebration";
import { playCelebrationChime } from "@/lib/liveAudio";
import CelebrationOverlay from "@/components/CelebrationOverlay.vue";

const router = useRouter();
const profiles = useProfilesStore();
const auth = useAuthStore();
const live = useLiveExplore();

const childId = ref("");
const mode = ref("explore");
const focus = ref("");

watch(
  () => profiles.children,
  (list) => { if (!childId.value && list.length) childId.value = list[0].id; },
  { immediate: true }
);

const child = computed(() => profiles.children.find((c) => c.id === childId.value));

// One-tap learning focuses; "Something else" lets a parent type any concept.
const FOCUSES = [
  { label: "Speech & sounds", value: "speech and articulation practice" },
  { label: "Maths", value: "mathematics" },
  { label: "Reading", value: "reading and letters" },
  { label: "Something else", value: "" },
];
const focusChip = ref(0);
function pickFocus(i) {
  focusChip.value = i;
  focus.value = FOCUSES[i].value;
}
pickFocus(0);

const timeLabel = computed(() => {
  const s = Math.max(0, live.secondsLeft.value);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
});

// The buddy's mouth opens with Gemini's voice; its glow follows the child's voice.
const listenGlow = computed(() => (live.muted.value ? 0 : Math.min(1, live.micLevel.value * 9)));

const captions = ref(null);
watch(
  () => live.turns.value,
  async () => {
    await nextTick();
    if (captions.value) captions.value.scrollTop = captions.value.scrollHeight;
  },
  { deep: true }
);

// ── Buddy settings (parents) ────────────────────────────────────────────────
// Preferences stored per CHILD and per MODE (families/{id}/meta/explore_{child}_{mode});
// the server validates them and applies them on top of the platform (superadmin)
// config. Scoped this way because a note like "Hadi is practising k and s sounds"
// or a same-day task is specific to that child, and a delivery style picked for
// Learning is often wrong for freewheeling Exploration — one shared settings
// document meant every child and every mode saw the same notes and dials.
const settingsOpen = ref(false);
const settings = ref({ ...DEFAULT_SETTINGS });
// What the platform's configured Live models actually support. The panel shows a
// control only when it is in here: an option the model would reject (a thinking
// level on a model with no thinking) ends the conversation before it starts.
const caps = ref({ ...DEFAULT_CAPABILITIES });
const THINKING_LABELS = { low: "A little (fastest)", medium: "Balanced", high: "A lot (most careful, slightly slower)" };
// The platform's ceiling wins, so show what the buddy will really get.
const shownMinutes = computed(() => Math.min(settings.value.sessionMinutes, caps.value.maxMinutes));
const settingsSaving = ref(false);
const settingsMsg = ref("");
const settingsErr = ref("");
const canEditSettings = computed(() => ["owner", "parent"].includes(auth.role));
const voiceBusy = ref(false);
const voiceMsg = ref("");
let voiceAudio = null;

// Save stays disabled until this child+mode's REAL values have loaded, so a
// failed or slow read can never lead to defaults being saved over a parent's
// choices, and switching child/mode never saves one's notes over another's.
const settingsLoaded = ref(false);
let settingsToken = 0; // supersedes an in-flight load when the child/mode changes mid-fetch
async function loadSettings() {
  if (!auth.familyId || !childId.value) return;
  const token = ++settingsToken;
  settingsLoaded.value = false;
  settings.value = { ...DEFAULT_SETTINGS };
  caps.value = { ...DEFAULT_CAPABILITIES };
  // A read can fail transiently (flaky connection) — retry a few times.
  for (let attempt = 0; attempt < 4; attempt++) {
    if (token !== settingsToken) return; // a newer child/mode selection took over
    try {
      const r = await loadExploreSettings(childId.value, mode.value);
      if (token !== settingsToken) return;
      settings.value = r.settings;
      caps.value = r.capabilities;
      settingsLoaded.value = true;
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
}
watch([() => auth.familyId, childId, mode], loadSettings, { immediate: true });
// Opening the panel retries a load that hasn't succeeded yet.
watch(settingsOpen, (open) => { if (open && !settingsLoaded.value) loadSettings(); });

async function saveSettings() {
  settingsSaving.value = true;
  settingsMsg.value = "";
  settingsErr.value = "";
  try {
    const r = await saveExploreSettings(childId.value, mode.value, settings.value, caps.value);
    settings.value = r.settings;
    caps.value = r.capabilities;
    settingsMsg.value = "Saved — the buddy will use these next time you talk.";
    setTimeout(() => (settingsMsg.value = ""), 3500);
  } catch (e) {
    settingsErr.value = e?.message || "Couldn't save the settings.";
  } finally {
    settingsSaving.value = false;
  }
}

async function hearVoice() {
  voiceBusy.value = true;
  voiceMsg.value = "";
  try {
    const r = await previewExploreVoice(settings.value.voiceName);
    if (r?.ok && r.url) {
      voiceAudio?.pause();
      voiceAudio = new Audio(r.url);
      voiceAudio.play().catch(() => {});
      voiceMsg.value = r.transcript || "";
    } else {
      voiceMsg.value = r?.configured === false ? "Voices aren't set up yet." : r?.error || "Couldn't play that voice.";
    }
  } catch (e) {
    voiceMsg.value = e?.message || "Couldn't play that voice.";
  } finally {
    voiceBusy.value = false;
  }
}

// ── What happened last time ─────────────────────────────────────────────────
// The buddy files its own highlights mid-conversation, so these appear without
// anyone writing anything down. Read-only, newest first, for the chosen child.
const sessions = ref([]);
const sessionsOpen = ref(false);
async function loadSessions() {
  if (!auth.familyId || !childId.value) return;
  try {
    sessions.value = await loadExploreSessions(auth.familyId, childId.value, 5);
  } catch {
    sessions.value = []; // history is a nice-to-have; never block the buddy on it
  }
}
watch([() => auth.familyId, childId], loadSessions, { immediate: true });

// ── Celebration effect ───────────────────────────────────────────────────────
// When the buddy celebrates a win, the composable plays the parent's chosen
// sound (it owns the AudioContext) and this launches confetti + balloons.
const celebration = ref(null);
watch(() => live.celebrateAt.value, (t) => { if (t) celebration.value?.play(); });

// "Try it" in Buddy settings: the parent sees and hears exactly what the child will.
let tryAudio = null;
let tryCtx = null;
function tryCelebration() {
  const pick = resolveCelebration(settings.value.celebration);
  tryAudio?.pause();
  if (pick?.kind === "file") {
    tryAudio = new Audio(pick.src);
    tryAudio.play().catch(() => {});
  } else if (pick?.kind === "chime") {
    tryCtx = tryCtx || new AudioContext();
    tryCtx.resume().catch(() => {});
    playCelebrationChime(tryCtx);
  }
  celebration.value?.play();
}

function begin() {
  if (!childId.value) return;
  live.start({ childId: childId.value, mode: mode.value, focus: mode.value === "learn" ? focus.value : "" });
}
function again() {
  live.reset();
  loadSessions(); // the chat just ended — pick up what the buddy filed
}
</script>

<template>
  <div class="ex-root" :class="`mode-${mode}`">
    <header class="ex-top">
      <button class="ex-back" type="button" aria-label="Back to dashboard" @click="router.push('/dashboard')">
        <span class="material-symbols-rounded">arrow_back</span>
      </button>
      <h1 class="ex-title">Explore</h1>
      <button
        v-if="live.state.value === 'idle' || live.state.value === 'error'"
        class="ex-back"
        :class="{ 'ex-on': settingsOpen }"
        type="button"
        aria-label="Buddy settings"
        :aria-expanded="settingsOpen"
        title="Buddy settings"
        @click="settingsOpen = !settingsOpen"
      >
        <span class="material-symbols-rounded">tune</span>
      </button>
      <span v-if="live.isLive.value" class="ex-timer" aria-label="Time left">{{ timeLabel }}</span>
    </header>

    <!-- Confetti + balloons when the buddy celebrates a win (or a parent tries it) -->
    <CelebrationOverlay ref="celebration" />

    <!-- ── Setup ─────────────────────────────────────────────────────────── -->
    <main v-if="live.state.value === 'idle' || live.state.value === 'error'" class="ex-setup">
      <div v-if="!profiles.children.length" class="ex-empty">
        Add a child on the <RouterLink to="/children">Children</RouterLink> page first, then come back to explore!
      </div>
      <template v-else>
        <section>
          <h2>Who's exploring?</h2>
          <div class="ex-chips" role="radiogroup" aria-label="Child">
            <button
              v-for="c in profiles.children"
              :key="c.id"
              class="ex-chip"
              :class="{ on: c.id === childId }"
              type="button"
              role="radio"
              :aria-checked="c.id === childId"
              @click="childId = c.id"
            >{{ c.name }}</button>
          </div>
        </section>

        <section>
          <h2>What shall we do?</h2>
          <div class="ex-modes">
            <button class="ex-mode explore" :class="{ on: mode === 'explore' }" type="button" data-mode="explore" @click="mode = 'explore'">
              <span class="material-symbols-rounded">rocket_launch</span>
              <strong>Exploration</strong>
              <small>Ask about anything — hear amazing stories about the world</small>
            </button>
            <button class="ex-mode learn" :class="{ on: mode === 'learn' }" type="button" data-mode="learn" @click="mode = 'learn'">
              <span class="material-symbols-rounded">school</span>
              <strong>Learning</strong>
              <small>Speech, maths, reading — or any idea — one step at a time</small>
            </button>
          </div>
        </section>

        <section v-if="mode === 'learn'">
          <h2>What to learn?</h2>
          <div class="ex-chips">
            <button
              v-for="(f, i) in FOCUSES"
              :key="f.label"
              class="ex-chip"
              :class="{ on: focusChip === i }"
              type="button"
              @click="pickFocus(i)"
            >{{ f.label }}</button>
          </div>
          <input
            v-if="FOCUSES[focusChip].value === ''"
            v-model="focus"
            class="ex-input"
            type="text"
            maxlength="200"
            placeholder="e.g. how plants grow, telling time…"
            aria-label="What to learn"
          />
        </section>

        <section v-if="settingsOpen" class="ex-settings" aria-label="Buddy settings">
          <h2>Buddy settings <small v-if="!canEditSettings">(view only)</small><small v-else-if="!settingsLoaded">Loading…</small></h2>
          <p class="ex-settings-scope">
            Just for <b>{{ child?.name || "this child" }}</b>, in <b>{{ mode === "learn" ? "Learning" : "Exploration" }}</b> mode —
            the other child and the other mode keep their own settings.
          </p>
          <fieldset :disabled="!canEditSettings || !settingsLoaded">
            <label>Voice
              <span class="ex-row">
                <select v-model="settings.voiceName">
                  <option v-for="v in caps.voices" :key="v" :value="v">{{ v }}</option>
                </select>
                <button class="ex-mini" type="button" :disabled="voiceBusy || !canEditSettings" @click="hearVoice">
                  <span class="material-symbols-rounded">volume_up</span>{{ voiceBusy ? "Playing…" : "Hear it" }}
                </button>
              </span>
              <small v-if="voiceMsg">{{ voiceMsg }}</small>
            </label>

            <div v-if="caps.canThink" class="ex-field" role="radiogroup" aria-label="How the buddy teaches">
              <span class="ex-lbl">When learning, the buddy…</span>
              <label class="ex-opt"><input v-model="settings.learnStyle" type="radio" value="thinking" /> <span><b>Thinks harder</b> — checks answers carefully; best for speech and maths</span></label>
              <label class="ex-opt"><input v-model="settings.learnStyle" type="radio" value="fast" /> <span><b>Answers quickly</b> — snappier and more playful</span></label>
            </div>

            <label v-if="caps.canThink && settings.learnStyle === 'thinking' && caps.thinkingLevels.length">How hard should it think?
              <select v-model="settings.thinkingLevel">
                <option v-for="l in caps.thinkingLevels" :key="l" :value="l">{{ THINKING_LABELS[l] || l }}</option>
              </select>
            </label>

            <label>Conversation length: <b>{{ shownMinutes }} minutes</b>
              <input v-model.number="settings.sessionMinutes" type="range" min="5" :max="caps.maxMinutes" step="1" />
              <small>The platform allows up to {{ caps.maxMinutes }} minutes.</small>
            </label>

            <label>When {{ child?.name || "your child" }} gets it right
              <span class="ex-row">
                <select v-model="settings.celebration">
                  <option v-for="o in CELEBRATION_SOUNDS" :key="o.value" :value="o.value">{{ o.label }}</option>
                </select>
                <button class="ex-mini" type="button" @click="tryCelebration">
                  <span class="material-symbols-rounded">celebration</span>Try it
                </button>
              </span>
              <small>Confetti and balloons fill the screen, with this sound.</small>
            </label>

            <div class="ex-sub">How should the buddy talk?</div>

            <label>Speaking speed
              <select v-model="settings.pace">
                <option v-for="o in PACES" :key="o.value" :value="o.value">{{ o.label }}</option>
              </select>
            </label>

            <label>How much it says
              <select v-model="settings.replyLength">
                <option v-for="o in REPLY_LENGTHS" :key="o.value" :value="o.value">{{ o.label }}</option>
              </select>
            </label>

            <label>Language
              <select v-model="settings.language">
                <option v-for="o in LANGUAGES" :key="o.value" :value="o.value">{{ o.label }}</option>
              </select>
            </label>

            <label>Things to be careful about <span class="ex-opt-l">(optional)</span>
              <textarea v-model="settings.avoid" rows="2" :maxlength="AVOID_MAX" placeholder="e.g. Don't mention his stammer. Never talk about scary animals."></textarea>
              <small>{{ settings.avoid.length }}/{{ AVOID_MAX }}</small>
            </label>

            <label>Anything else for the buddy <span class="ex-opt-l">(optional)</span>
              <textarea v-model="settings.notes" rows="3" :maxlength="NOTES_MAX" placeholder="e.g. Hadi is practising k and s sounds. He loves trains — use them in examples."></textarea>
              <small>{{ settings.notes.length }}/{{ NOTES_MAX }} · The buddy follows all of these, but its safety rules always come first.</small>
            </label>
          </fieldset>
          <p v-if="settingsErr" class="ex-error" role="alert">{{ settingsErr }}</p>
          <p v-if="settingsMsg" class="ex-ok">{{ settingsMsg }}</p>
          <button v-if="canEditSettings" class="ex-save" type="button" :disabled="settingsSaving || !settingsLoaded" @click="saveSettings">
            {{ settingsSaving ? "Saving…" : !settingsLoaded ? "Loading your settings…" : "Save settings" }}
          </button>
        </section>

        <section v-if="sessions.length" class="ex-history" aria-label="Recent conversations">
          <button class="ex-hist-top" type="button" :aria-expanded="sessionsOpen" @click="sessionsOpen = !sessionsOpen">
            <span class="material-symbols-rounded">history_edu</span>
            <strong>What happened last time</strong>
            <span class="material-symbols-rounded ex-caret">{{ sessionsOpen ? "expand_less" : "expand_more" }}</span>
          </button>
          <ul v-if="sessionsOpen" class="ex-hist-list">
            <li v-for="s in sessions" :key="s.id">
              <div class="ex-hist-head">
                <b>{{ MODE_LABELS[s.mode] }}</b>
                <span>{{ whenLabel(s.startedAt) }}</span>
              </div>
              <p v-if="!s.highlights.length" class="ex-hist-none">No notes from this chat.</p>
              <div v-for="(h, i) in s.highlights" :key="i" class="ex-hl">
                <span v-for="p in highlightPairs(h)" :key="p.key" class="ex-hl-pair">
                  <i>{{ p.key }}</i> {{ p.value }}
                </span>
              </div>
            </li>
          </ul>
        </section>

        <p v-if="live.state.value === 'error'" class="ex-error" role="alert">{{ live.error.value }}</p>

        <button class="ex-go" type="button" :disabled="!childId" @click="begin">
          <span class="material-symbols-rounded">mic</span>
          Start talking
        </button>
        <p class="ex-fine">The buddy listens through the microphone. Conversations last up to 20 minutes and parents can read them later.</p>
      </template>
    </main>

    <!-- ── Connecting ────────────────────────────────────────────────────── -->
    <main v-else-if="live.state.value === 'connecting'" class="ex-stage">
      <div class="ex-buddy waking"><div class="ex-body" /></div>
      <p class="ex-status">Waking up your buddy…</p>
    </main>

    <!-- ── Live ──────────────────────────────────────────────────────────── -->
    <main v-else-if="live.state.value === 'live'" class="ex-stage">
      <div
        class="ex-buddy"
        :class="{ talking: live.speaking.value, muted: live.muted.value }"
        :style="{ '--glow': listenGlow }"
      >
        <div class="ex-body">
          <div class="ex-eyes"><i /><i /></div>
          <div class="ex-mouth" />
        </div>
      </div>
      <p class="ex-status" aria-live="polite">
        {{ live.muted.value ? "Microphone is off" : live.speaking.value ? "Listen…" : "Your turn — say something!" }}
      </p>
      <div ref="captions" class="ex-captions" aria-label="Conversation">
        <p v-for="(t, i) in live.turns.value.slice(-6)" :key="i" :class="t.role">{{ t.text }}</p>
      </div>
      <div class="ex-controls">
        <button class="ex-round" type="button" :aria-pressed="live.muted.value" :title="live.muted.value ? 'Turn microphone on' : 'Turn microphone off'" @click="live.toggleMute">
          <span class="material-symbols-rounded">{{ live.muted.value ? "mic_off" : "mic" }}</span>
        </button>
        <button class="ex-end" type="button" @click="live.stop">
          <span class="material-symbols-rounded">call_end</span> All done
        </button>
      </div>
    </main>

    <!-- ── Ended ─────────────────────────────────────────────────────────── -->
    <main v-else class="ex-stage">
      <div class="ex-buddy"><div class="ex-body"><div class="ex-eyes happy"><i /><i /></div><div class="ex-mouth smile" /></div></div>
      <p class="ex-status">What a fun chat! See you soon.</p>
      <button class="ex-go" type="button" @click="again">Another adventure</button>
    </main>
  </div>
</template>

<style scoped>
.ex-root {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  flex-direction: column;
  color: #23164a;
  overflow-y: auto;
  background: radial-gradient(120% 90% at 50% 0%, #ffe9b8 0%, #ffc4d8 45%, #b9a6ff 100%);
  font-family: "Nunito", "Segoe UI", system-ui, sans-serif;
}
.ex-root.mode-learn { background: radial-gradient(120% 90% at 50% 0%, #d6f5ff 0%, #b8f0d0 50%, #8fd0ff 100%); }
.ex-top { display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem 1rem; }
.ex-title { margin: 0; font-size: 1.5rem; flex: 1; }
.ex-back, .ex-round {
  width: 44px; height: 44px; border-radius: 50%; border: 0; cursor: pointer;
  background: rgba(255, 255, 255, 0.8); box-shadow: 0 3px 0 rgba(0, 0, 0, 0.12); color: inherit;
  display: grid; place-items: center;
}
.ex-back.ex-on { background: #6b3fd6; color: #fff; }
.ex-settings { background: rgba(255, 255, 255, 0.85); border-radius: 22px; padding: 1rem 1.1rem; display: flex; flex-direction: column; gap: 0.8rem; }
.ex-settings h2 { margin: 0; }
.ex-settings h2 small { font-weight: 600; opacity: 0.7; }
.ex-settings-scope { margin: -0.4rem 0 0; font-size: 0.85rem; opacity: 0.75; }
.ex-settings fieldset { border: 0; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.9rem; min-width: 0; }
.ex-settings label, .ex-field { display: flex; flex-direction: column; gap: 0.3rem; font-weight: 700; }
.ex-settings small { font-weight: 500; opacity: 0.75; }
.ex-settings select, .ex-settings textarea { font: inherit; padding: 0.55rem 0.7rem; border-radius: 12px; border: 2px solid #d9d0f5; background: #fff; box-sizing: border-box; width: 100%; }
.ex-row { display: flex; gap: 0.5rem; align-items: center; }
.ex-row select { flex: 1; }
.ex-mini { border: 0; border-radius: 999px; padding: 0.5rem 0.9rem; font: inherit; font-weight: 700; cursor: pointer; background: #ffcf3f; color: #4a2a00; display: inline-flex; gap: 0.3rem; align-items: center; white-space: nowrap; }
.ex-mini:disabled { opacity: 0.5; cursor: not-allowed; }
.ex-opt { flex-direction: row !important; align-items: flex-start; gap: 0.5rem !important; font-weight: 500 !important; }
.ex-opt input { margin-top: 0.3rem; }
.ex-opt-l { font-weight: 500; opacity: 0.7; }
.ex-lbl { font-weight: 700; }
.ex-save { align-self: flex-start; border: 0; border-radius: 999px; padding: 0.65rem 1.4rem; font: inherit; font-weight: 800; cursor: pointer; background: #6b3fd6; color: #fff; }
.ex-save:disabled { opacity: 0.6; }
.ex-ok { margin: 0; color: #0f6b3f; font-weight: 700; }
.ex-timer { font-weight: 800; background: rgba(255, 255, 255, 0.8); padding: 0.25rem 0.7rem; border-radius: 999px; }
.ex-sub { font-weight: 800; padding-top: 0.4rem; border-top: 2px solid rgba(107, 63, 214, 0.15); }

/* What the buddy itself filed about the last few chats. */
.ex-history { background: rgba(255, 255, 255, 0.85); border-radius: 22px; padding: 0.4rem 0.6rem; }
.ex-hist-top {
  width: 100%; display: flex; align-items: center; gap: 0.5rem; border: 0; background: none; cursor: pointer;
  font: inherit; color: inherit; padding: 0.6rem 0.5rem; text-align: left;
}
.ex-hist-top strong { flex: 1; }
.ex-hist-list { list-style: none; margin: 0; padding: 0 0.5rem 0.6rem; display: flex; flex-direction: column; gap: 0.7rem; }
.ex-hist-head { display: flex; justify-content: space-between; font-size: 0.9rem; opacity: 0.8; }
.ex-hist-none { margin: 0.2rem 0 0; font-size: 0.9rem; opacity: 0.6; }
.ex-hl { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-top: 0.3rem; }
.ex-hl-pair { background: #efe9ff; border-radius: 10px; padding: 0.2rem 0.5rem; font-size: 0.88rem; }
.ex-hl-pair i { font-style: normal; font-weight: 800; opacity: 0.65; margin-right: 0.25rem; }

.ex-setup { width: min(640px, 100%); margin: 0 auto; padding: 0.5rem 1rem 2rem; display: flex; flex-direction: column; gap: 1.1rem; }
.ex-setup h2 { margin: 0 0 0.5rem; font-size: 1.05rem; }
.ex-chips { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.ex-chip {
  border: 0; border-radius: 999px; padding: 0.55rem 1.1rem; font: inherit; font-weight: 700; cursor: pointer;
  background: rgba(255, 255, 255, 0.75); color: inherit; box-shadow: 0 3px 0 rgba(0, 0, 0, 0.1);
}
.ex-chip.on { background: #6b3fd6; color: #fff; }
.ex-modes { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.75rem; }
.ex-mode {
  border: 3px solid transparent; border-radius: 22px; padding: 1rem; text-align: left; cursor: pointer; font: inherit; color: inherit;
  display: flex; flex-direction: column; gap: 0.25rem; background: rgba(255, 255, 255, 0.75); box-shadow: 0 4px 0 rgba(0, 0, 0, 0.1);
}
.ex-mode .material-symbols-rounded { font-size: 2rem; }
.ex-mode.explore .material-symbols-rounded { color: #e0572f; }
.ex-mode.learn .material-symbols-rounded { color: #1c8f6a; }
.ex-mode.on { border-color: #6b3fd6; background: #fff; }
.ex-mode small { opacity: 0.75; }
.ex-input { width: 100%; box-sizing: border-box; margin-top: 0.6rem; padding: 0.7rem 0.9rem; border-radius: 14px; border: 2px solid #fff; font: inherit; }
.ex-go {
  border: 0; border-radius: 999px; padding: 1rem 1.6rem; font: inherit; font-size: 1.15rem; font-weight: 800; cursor: pointer;
  background: #ffcf3f; color: #4a2a00; box-shadow: 0 5px 0 #d99f00; display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem;
}
.ex-go:disabled { opacity: 0.5; cursor: not-allowed; }
.ex-fine { margin: 0; font-size: 0.85rem; opacity: 0.7; text-align: center; }
.ex-error { margin: 0; background: #fff; border-left: 5px solid #d43b3b; padding: 0.7rem 1rem; border-radius: 10px; }
.ex-empty { background: rgba(255, 255, 255, 0.85); padding: 1.2rem; border-radius: 16px; }

.ex-stage { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 0.8rem; padding: 0.5rem 1rem 1.5rem; width: min(640px, 100%); margin: 0 auto; box-sizing: border-box; }
.ex-status { margin: 0; font-size: 1.15rem; font-weight: 800; text-align: center; }

/* The buddy: a squishy blob with big eyes; the glow rings follow the child's voice. */
.ex-buddy {
  --glow: 0;
  width: min(46vw, 230px); aspect-ratio: 1; position: relative; display: grid; place-items: center; margin-top: 0.5rem;
  animation: ex-bob 3.2s ease-in-out infinite;
}
.ex-buddy::before {
  content: ""; position: absolute; inset: -12%; border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 255, 255, calc(0.15 + var(--glow) * 0.7)) 0%, transparent 70%);
  transform: scale(calc(1 + var(--glow) * 0.25)); transition: transform 0.08s linear;
}
.ex-body {
  position: relative; width: 100%; height: 100%; border-radius: 48% 52% 46% 54% / 55% 52% 48% 45%;
  background: radial-gradient(circle at 35% 30%, #ffe27a, #ff9d4a 70%); box-shadow: 0 10px 0 rgba(0, 0, 0, 0.12), inset 0 -10px 0 rgba(0, 0, 0, 0.08);
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12%;
}
.mode-learn .ex-body { background: radial-gradient(circle at 35% 30%, #b5f5d9, #3fbf9a 70%); }
.ex-eyes { display: flex; gap: 22%; }
.ex-eyes i { width: 26px; height: 34px; background: #fff; border-radius: 50%; position: relative; animation: ex-blink 4.5s infinite; }
.ex-eyes i::after { content: ""; position: absolute; width: 14px; height: 18px; background: #23164a; border-radius: 50%; left: 6px; top: 10px; }
.ex-eyes.happy i { height: 16px; border-radius: 0 0 40px 40px; animation: none; }
.ex-eyes.happy i::after { display: none; }
.ex-mouth { width: 34%; height: 7%; background: #7a2f14; border-radius: 0 0 30px 30px; transition: height 0.12s; }
.ex-mouth.smile { height: 12%; }
.talking .ex-mouth { animation: ex-talk 0.32s ease-in-out infinite alternate; }
.muted { filter: grayscale(0.7); }
.waking .ex-body { animation: ex-wake 1s ease-in-out infinite alternate; }

.ex-captions {
  width: 100%; flex: 1; min-height: 4rem; max-height: 30vh; overflow-y: auto; background: rgba(255, 255, 255, 0.7);
  border-radius: 18px; padding: 0.7rem 1rem; box-sizing: border-box; display: flex; flex-direction: column; gap: 0.4rem;
}
.ex-captions p { margin: 0; line-height: 1.35; }
.ex-captions .guide { font-weight: 700; }
.ex-captions .child { color: #5b4a8c; font-style: italic; text-align: right; }
.ex-controls { display: flex; align-items: center; gap: 1rem; }
.ex-round { width: 56px; height: 56px; }
.ex-end {
  border: 0; border-radius: 999px; padding: 0.8rem 1.4rem; font: inherit; font-weight: 800; cursor: pointer; color: #fff; background: #e0483f;
  box-shadow: 0 4px 0 #a8302a; display: inline-flex; align-items: center; gap: 0.4rem;
}

@keyframes ex-bob { 0%, 100% { transform: translateY(0) scale(1); } 50% { transform: translateY(-8px) scale(1.02, 0.98); } }
@keyframes ex-blink { 0%, 92%, 100% { transform: scaleY(1); } 95% { transform: scaleY(0.1); } }
@keyframes ex-talk { from { height: 5%; } to { height: 20%; } }
@keyframes ex-wake { from { transform: scale(0.94); } to { transform: scale(1.02); } }
@media (prefers-reduced-motion: reduce) {
  .ex-buddy, .ex-eyes i, .talking .ex-mouth, .waking .ex-body { animation: none; }
}
</style>
