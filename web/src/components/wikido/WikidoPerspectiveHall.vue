<script setup>
// The Perspective Hall: a futuristic ring of hologram panels around the child
// (see lib/wikido/hall3d.js). One panel stands in front, its neighbours curve
// away left and right, and the ring never ends — a scene with 100 perspectives
// is just as easy to spin through as one with 4.
//
//   swipe / drag / arrow keys / wheel   spin the ring
//   tap a side panel                    bring it to the front
//   tap the front panel (first time)    it is read aloud and an ENTER button appears
//   ENTER                               step into that perspective
//   ✕ / Esc                             back to the picture
//
// Without WebGL (or with a failed load) the same flow runs on a plain
// snap-scrolling row of cards, so no child is ever left without a way in.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useSpeech } from "@/composables/useSpeech";
import { resolveWikidoAudioUrl } from "@/lib/wikido/audio";
import { panelCaption, wrapIndex } from "@/lib/wikido/hallLayout";

const props = defineProps({
  lenses: { type: Array, required: true }, // sceneLenses(): [{ id, sceneId, lens, scene }]
  active: { type: String, default: "main" },
});
const emit = defineEmits(["enter", "close"]);

const { speak, playAudio, stop, speakingId } = useSpeech();

const stageEl = ref(null);
const focus = ref(Math.max(0, props.lenses.findIndex((l) => l.id === props.active)));
const armed = ref(-1); // the panel whose narration is playing / whose ENTER is showing
const mode = ref("loading"); // loading | 3d | cards
const leaving = ref(""); // "" | "enter" | "close": the hall animates out before it hands over
let hall = null;
let alive = true;

const items = computed(() =>
  props.lenses.map((l) => {
    const c = panelCaption(l);
    return { id: l.id, title: c.title, emoji: c.emoji, color: c.color, sub: c.sub, src: l.scene?.image?.src || "" };
  })
);
const current = computed(() => props.lenses[wrapIndex(focus.value, props.lenses.length)] || null);
const currentItem = computed(() => items.value[wrapIndex(focus.value, items.value.length)] || null);
const isArmed = computed(() => armed.value === wrapIndex(focus.value, props.lenses.length));
const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function webglOk() {
  try {
    const c = document.createElement("canvas");
    return Boolean(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl")));
  } catch { return false; }
}

onMounted(async () => {
  if (!webglOk()) { mode.value = "cards"; return; }
  try {
    const { createHall3d } = await import("@/lib/wikido/hall3d.js");
    if (!alive) return;
    await nextTick();
    hall = createHall3d({
      container: stageEl.value,
      items: items.value,
      index: focus.value,
      reducedMotion: reduced(),
      onFocus: (i) => { setFocus(i, false); },
      onTap: (i, onFront) => { if (onFront) arm(i); else setFocus(i, true); },
    });
    mode.value = "3d";
  } catch {
    mode.value = "cards";
  }
  window.addEventListener("resize", onResize);
});

function onResize() { hall?.resize(); }

function setFocus(i, move) {
  const idx = wrapIndex(i, props.lenses.length);
  if (idx !== focus.value) {
    focus.value = idx;
    if (armed.value !== idx) { armed.value = -1; stop(); } // spinning away ends the narration
  }
  if (move) hall?.focus(idx);
}

// First tap on the front panel: read it aloud and offer ENTER.
function arm(i) {
  const idx = wrapIndex(i, props.lenses.length);
  focus.value = idx;
  armed.value = idx;
  const l = props.lenses[idx];
  const text = `${l.lens?.name === "Overview" ? l.scene?.title : `${l.lens?.name}. ${l.scene?.title}`}. ${l.scene?.narration || ""}`.trim();
  const url = resolveWikidoAudioUrl(l.scene?.audio || "");
  const id = `hall:${l.id}`;
  stop();
  if (url) playAudio(url, { id, onError: () => speak(text, "en", { id, contentKind: "story" }) });
  else speak(text, "en", { id, contentKind: "story" });
}

// ENTER: the camera dives into the panel while the interface melts away, then hand over
async function enter() {
  const l = current.value;
  if (!l || leaving.value) return;
  stop();
  if (mode.value === "3d" && !reduced()) {
    leaving.value = "enter";
    await hall?.flyInto();
    if (!alive) return;
  }
  emit("enter", l.id);
}

function close() {
  if (leaving.value) return;
  stop();
  if (reduced()) { emit("close"); return; }
  leaving.value = "close";
  setTimeout(() => { if (alive) emit("close"); }, 260);
}

function tapCard(i) {
  const idx = wrapIndex(i, props.lenses.length);
  if (idx === wrapIndex(focus.value, props.lenses.length)) { arm(idx); return; }
  setFocus(idx, true);
}

function step(dir) {
  if (mode.value === "3d") hall?.step(dir);
  else setFocus(focus.value + dir, false);
}

function onKey(e) {
  if (e.key === "Escape") { e.preventDefault(); close(); }
  else if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
  else if (e.key === "Enter" && !e.target.closest?.("button")) { e.preventDefault(); if (isArmed.value) enter(); else arm(focus.value); }
}

// the fallback row follows the focused card
const rowEl = ref(null);
watch(focus, (i) => {
  if (mode.value !== "cards") return;
  nextTick(() => rowEl.value?.querySelector(`[data-i="${i}"]`)?.scrollIntoView?.({ inline: "center", block: "nearest", behavior: reduced() ? "auto" : "smooth" }));
});
watch(items, (next) => hall?.setItems(next));
watch(armed, (i) => hall?.setArmed(i));

onMounted(() => {
  window.addEventListener("keydown", onKey);
  document.body.style.overscrollBehavior = "contain";
});
onBeforeUnmount(() => {
  alive = false;
  window.removeEventListener("keydown", onKey);
  window.removeEventListener("resize", onResize);
  document.body.style.overscrollBehavior = "";
  stop();
  hall?.dispose();
  hall = null;
});

const narrating = computed(() => String(speakingId.value || "").startsWith("hall:"));
</script>

<template>
  <div class="hall" :class="leaving && 'leaving-' + leaving" role="dialog" aria-modal="true" aria-label="Choose a way to look at this place">
    <div class="hall-sky" aria-hidden="true"></div>
    <header class="hall-top">
      <p class="hall-kicker">PERSPECTIVES</p>
      <button type="button" class="hall-x" aria-label="Back to the picture" title="Back (Esc)" @click="close">
        <span class="material-symbols-rounded" aria-hidden="true">close</span>
      </button>
    </header>

    <!-- the ring (three.js) -->
    <div v-show="mode === '3d'" ref="stageEl" class="hall-stage" aria-hidden="true"></div>

    <!-- no WebGL: a snap-scrolling row with the same tap → hear → ENTER flow -->
    <div v-if="mode === 'cards'" ref="rowEl" class="hall-row" role="listbox" aria-label="Perspectives">
      <button
        v-for="(it, i) in items"
        :key="it.id"
        type="button"
        role="option"
        class="hall-card"
        :class="{ on: i === wrapIndex(focus, items.length) }"
        :data-i="i"
        :aria-selected="i === wrapIndex(focus, items.length)"
        :style="{ '--c': it.color, '--bg': it.src ? `url(${it.src})` : 'none' }"
        @click="tapCard(i)"
      >
        <span class="hall-card-chip">{{ it.emoji }} {{ it.title }}</span>
        <span class="hall-card-title">{{ it.title }}</span>
        <span class="hall-card-sub">{{ it.sub }}</span>
      </button>
    </div>
    <p v-if="mode === 'loading'" class="hall-wait" role="status">Opening the hall…</p>

    <!-- what is in front of you -->
    <footer class="hall-bottom" aria-live="polite">
      <template v-if="currentItem">
        <div v-if="!isArmed" class="hall-hint">
          <strong class="hall-name">{{ currentItem.emoji }} {{ currentItem.title }}</strong>
          <span class="hall-sub">Swipe to turn the hall · tap the panel to hear about it</span>
          <span class="hall-count">{{ wrapIndex(focus, items.length) + 1 }} / {{ items.length }}</span>
        </div>
        <div v-else class="hall-armed">
          <p class="hall-line">
            <span class="hall-wave" :class="{ on: narrating }" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
            {{ current?.scene?.narration || current?.scene?.title }}
          </p>
          <button type="button" class="hall-enter" @click="enter">
            <span>ENTER</span>
            <span class="material-symbols-rounded" aria-hidden="true">arrow_forward</span>
          </button>
        </div>
      </template>
    </footer>
    <button v-if="items.length > 1" type="button" class="hall-arrow l" aria-label="Previous perspective" @click="step(-1)">
      <span class="material-symbols-rounded" aria-hidden="true">chevron_left</span>
    </button>
    <button v-if="items.length > 1" type="button" class="hall-arrow r" aria-label="Next perspective" @click="step(1)">
      <span class="material-symbols-rounded" aria-hidden="true">chevron_right</span>
    </button>
  </div>
</template>

<style scoped>
.hall {
  position: absolute;
  inset: 0;
  z-index: 40;
  display: flex;
  flex-direction: column;
  color: #e0f2fe;
  overflow: hidden;
  animation: hall-in .35s ease both;
  user-select: none;
  -webkit-user-select: none;
}
@keyframes hall-in { from { opacity: 0; transform: scale(1.04); } to { opacity: 1; transform: none; } }
.hall-sky {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(60% 50% at 50% 55%, rgba(56, 189, 248, .22), transparent 70%),
    radial-gradient(90% 70% at 50% 100%, rgba(99, 102, 241, .28), transparent 70%),
    linear-gradient(180deg, #030818 0%, #07122e 55%, #0a1a44 100%);
}
.hall-top { position: relative; z-index: 3; display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; }
.hall-kicker { margin: 0; font-size: .78rem; letter-spacing: .32em; font-weight: 800; color: #7dd3fc; text-shadow: 0 0 12px rgba(56, 189, 248, .8); }
.hall-x {
  display: grid; place-items: center; width: 46px; height: 46px; border-radius: 50%;
  border: 1.5px solid rgba(125, 211, 252, .55); background: rgba(8, 20, 52, .7); color: #e0f2fe; cursor: pointer;
  box-shadow: 0 0 16px rgba(56, 189, 248, .35);
}
.leaving-close { animation: hall-out .26s ease both; }
@keyframes hall-out { to { opacity: 0; transform: scale(1.05); } }
.leaving-enter .hall-top, .leaving-enter .hall-bottom, .leaving-enter .hall-arrow { opacity: 0; transition: opacity .25s ease; }
.leaving-enter { animation: hall-dive .8s ease-in both; }
@keyframes hall-dive { 0%, 60% { opacity: 1; } 100% { opacity: 0; } }
.hall-x:hover, .hall-x:focus-visible { background: rgba(56, 189, 248, .25); outline: none; }
.hall-stage { position: absolute; inset: 0; z-index: 1; }
.hall-wait { position: absolute; inset: 0; z-index: 1; display: grid; place-items: center; margin: 0; font-weight: 700; color: #7dd3fc; }

/* ── fallback row ── */
.hall-row {
  position: relative; z-index: 2; flex: 1; display: flex; align-items: center; gap: 18px;
  overflow-x: auto; scroll-snap-type: x mandatory; padding: 0 calc(50% - 150px); scrollbar-width: none;
}
.hall-row::-webkit-scrollbar { display: none; }
.hall-card {
  --c: #38bdf8; --bg: none;
  flex: none; width: 300px; height: 225px; scroll-snap-align: center; position: relative; text-align: left;
  display: flex; flex-direction: column; justify-content: flex-end; gap: 2px; padding: 14px 16px; border-radius: 22px;
  border: 2.5px solid var(--c); color: #fff; cursor: pointer; font-family: inherit;
  background: linear-gradient(180deg, rgba(6, 10, 30, 0) 30%, rgba(6, 10, 30, .9)), var(--bg) center / cover, #0f1d46;
  box-shadow: 0 0 22px color-mix(in srgb, var(--c) 55%, transparent); opacity: .72; transform: scale(.9);
  transition: transform .25s ease, opacity .25s ease;
}
.hall-card.on { opacity: 1; transform: scale(1.04); }
.hall-card-chip { position: absolute; top: 12px; left: 12px; padding: 4px 12px; border-radius: 99px; background: rgba(8, 14, 40, .8); border: 1.5px solid var(--c); font-weight: 700; font-size: .85rem; }
.hall-card-title { font-size: 1.35rem; font-weight: 800; text-shadow: 0 0 12px var(--c); }
.hall-card-sub { font-size: .85rem; opacity: .9; }

/* ── bottom: caption / narration + ENTER ── */
.hall-bottom {
  position: absolute; z-index: 3; left: 0; right: 0; bottom: 0; display: flex; justify-content: center;
  padding: 0 16px calc(18px + env(safe-area-inset-bottom)); pointer-events: none;
}
.hall-hint, .hall-armed { pointer-events: auto; text-align: center; max-width: min(640px, 100%); }
.hall-hint { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.hall-name { font-size: 1.5rem; text-shadow: 0 0 16px rgba(56, 189, 248, .85); }
.hall-sub { font-size: .9rem; color: #bae6fd; }
.hall-count { font-size: .78rem; letter-spacing: .16em; color: #7dd3fc; }
.hall-armed {
  display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 14px 18px 16px; border-radius: 22px;
  background: rgba(6, 14, 40, .78); border: 1.5px solid rgba(125, 211, 252, .5); backdrop-filter: blur(8px);
  box-shadow: 0 0 30px rgba(56, 189, 248, .3); max-height: 38vh; overflow-y: auto;
}
.hall-line { margin: 0; font-size: 1rem; line-height: 1.5; display: flex; gap: 10px; align-items: flex-start; text-align: left; }
.hall-wave { flex: none; display: inline-flex; gap: 3px; align-items: flex-end; height: 22px; margin-top: 2px; }
.hall-wave i { width: 4px; height: 6px; border-radius: 2px; background: #38bdf8; }
.hall-wave.on i { animation: hall-bar .9s ease-in-out infinite; }
.hall-wave.on i:nth-child(2) { animation-delay: .15s; }
.hall-wave.on i:nth-child(3) { animation-delay: .3s; }
.hall-wave.on i:nth-child(4) { animation-delay: .45s; }
@keyframes hall-bar { 0%, 100% { height: 6px; } 50% { height: 22px; } }
.hall-enter {
  display: inline-flex; align-items: center; gap: .5rem; min-width: 210px; justify-content: center; min-height: 54px; padding: 0 28px;
  border-radius: 14px; border: 2px solid #7dd3fc; background: linear-gradient(180deg, rgba(56, 189, 248, .35), rgba(37, 99, 235, .45));
  color: #f0f9ff; font-family: inherit; font-weight: 900; font-size: 1.25rem; letter-spacing: .28em; cursor: pointer;
  box-shadow: 0 0 24px rgba(56, 189, 248, .6), inset 0 0 14px rgba(125, 211, 252, .35); text-shadow: 0 0 12px #38bdf8;
  animation: hall-pulse 1.8s ease-in-out infinite;
}
.hall-enter { position: relative; overflow: hidden; }
.hall-enter::after {
  content: ""; position: absolute; inset: 0; transform: translateX(-120%);
  background: linear-gradient(100deg, transparent 30%, rgba(224, 242, 254, .55) 50%, transparent 70%);
  animation: hall-shine 2.4s ease-in-out infinite;
}
@keyframes hall-shine { 55%, 100% { transform: translateX(120%); } }
.hall-armed { animation: hall-rise .35s cubic-bezier(.2, .9, .3, 1.2) both; }
@keyframes hall-rise { from { opacity: 0; transform: translateY(18px) scale(.96); } to { opacity: 1; transform: none; } }
.hall-enter:hover, .hall-enter:focus-visible { filter: brightness(1.2); outline: none; }
@keyframes hall-pulse { 50% { box-shadow: 0 0 38px rgba(56, 189, 248, .95), inset 0 0 18px rgba(125, 211, 252, .5); } }

.hall-arrow {
  position: absolute; z-index: 3; top: 50%; transform: translateY(-50%); display: grid; place-items: center; width: 48px; height: 48px;
  border-radius: 50%; border: 1.5px solid rgba(125, 211, 252, .5); background: rgba(8, 20, 52, .6); color: #e0f2fe; cursor: pointer;
}
.hall-arrow.l { left: 12px; }
.hall-arrow.r { right: 12px; }
.hall-arrow:hover, .hall-arrow:focus-visible { background: rgba(56, 189, 248, .3); outline: none; }

@media (max-width: 700px) {
  .hall-arrow { display: none; }
  .hall-name { font-size: 1.25rem; }
}
@media (prefers-reduced-motion: reduce) {
  .hall, .hall-enter, .hall-enter::after, .hall-armed, .hall-wave.on i { animation: none; }
  .hall-card { transition: none; }
}
</style>
