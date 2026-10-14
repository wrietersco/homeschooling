<script setup>
// The GLOBE view — another form of immersive Wikido world. Instead of a
// full-bleed picture, the child lands on a playable 3D Earth: drag to spin it,
// pinch/scroll/buttons to zoom, and tap the glowing place spots to open their
// cards and step inside (the same journey machinery as picture worlds).
//
// Level of detail: country spots are visible from the start; zooming in
// reveals city spots, then location spots (landmarks) — see LEVEL_ZOOM.
// Spots are plain doorways of the topic's root (hub) scene carrying lat/lng;
// everything else — info cards, TTS, progress, cross-topic doors — is the
// existing Wikido machinery.
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import SpeakButton from "@/components/SpeakButton.vue";
import WikidoHotspot from "./WikidoHotspot.vue";
import WikidoInfoCard from "./WikidoInfoCard.vue";
import { useWikidoProgress } from "@/lib/wikido/progress";
import { resolveWikidoAudioUrl } from "@/lib/wikido/audio";
import { useSpeech } from "@/composables/useSpeech";
import {
  ZOOM_MAX, ZOOM_MIN, clampRotation, clampZoom, currentLevelAtZoom,
  projectSpot, spotOpacityAtZoom,
} from "@/lib/wikido/globe/projection";
import { drawGlobe } from "@/lib/wikido/globe/render";

const props = defineProps({
  topic: { type: Object, required: true },
  // the globe hub (the pack's root scene)
  scene: { type: Object, required: true },
  trail: { type: Array, default: () => [] },
  topicDirectory: { type: Object, default: null },
});
const emit = defineEmits(["enter", "navigate", "exit"]);

const { seen, markSeen, countSeen } = useWikidoProgress();
const { stop } = useSpeech();

// ── view state ────────────────────────────────────────────────────────────────
// The globe opens over South Asia with a gentle welcome drift that settles
// after a moment (a perpetually moving target is impossible to tap — for
// fingers and tests alike). Any pointer contact retires it immediately.
const IDLE_SPIN_MS = 3500;
const rot = ref(clampRotation({ lambda: 70, phi: 22 }));
const zoom = ref(ZOOM_MIN);
const selectedId = ref("");
const hasInteracted = ref(false);
const introOpen = ref(true);
const spinning = ref(true);
let spinStartedAt = 0;

function setZoom(z) {
  zoomTo(z);
}
defineExpose({ setZoom, zoom, rot, resize });

// ── spots: every hub doorway with a place on the planet ───────────────────────
// Layers are exclusive: as the child zooms deeper, the parent layer's pins
// fade away and only the current layer shows (countries → cities → landmarks).
const spots = computed(() =>
  (props.scene.hotspots || []).filter((s) => Number.isFinite(+s.lat) && Number.isFinite(+s.lng))
);

const placed = computed(() => {
  const { w, h } = size.value;
  if (!w || !h) return [];
  const cx = w / 2;
  const cy = h / 2;
  const r = globeRadius();
  return spots.value
    .map((spot) => {
      const p = projectSpot(+spot.lat, +spot.lng, rot.value, { cx, cy, r });
      const opacity = spotOpacityAtZoom(spot.level, zoom.value);
      return { spot, ...p, opacity, shown: p.visible && opacity > 0.02 };
    })
    .filter((p) => p.shown)
    .sort((a, b) => a.depth - b.depth); // far first, so near spots stack on top
});

const selected = computed(() => spots.value.find((s) => s.id === selectedId.value) || null);
const isCross = (spot) => Boolean(spot?.childTopicId && spot.childTopicId !== props.topic.id);
const crossTitle = (spot) => props.topicDirectory?.[spot.childTopicId]?.title || spot.childTopicId;
const doorOpen = (spot) => (isCross(spot) ? Boolean(props.topicDirectory?.[spot.childTopicId]) : true);

function pick(spot) {
  selectedId.value = spot.id;
  markSeen(props.topic.id, `hotspot:${props.scene.id}:${spot.id}`);
  // bring the chosen place to the front of the globe
  animateRotationTo({ lambda: +spot.lng, phi: +spot.lat });
}

function activate(spot) {
  pick(spot);
  if (spot.childSceneId && doorOpen(spot)) emit("enter", spot);
}

watch(
  () => props.scene.id,
  () => {
    stop();
    selectedId.value = "";
    introOpen.value = true;
    markSeen(props.topic.id, `scene:${props.scene.id}`);
  },
  { immediate: true }
);

// ── canvas ────────────────────────────────────────────────────────────────────
const wrapEl = ref(null);
const canvasEl = ref(null);
const size = ref({ w: 0, h: 0 });
const borders = ref(null); // real country outlines — lazy-loaded below
let ctx = null;
let needsDraw = true;
let ro = null;
let raf = 0;

// Country borders (Natural Earth, public domain) arrive in their own chunk;
// the stylized land stands in until then, and the globe redraws on arrival.
import("@/lib/wikido/globe/borders.js")
  .then((m) => {
    borders.value = m.COUNTRY_BORDERS;
    needsDraw = true;
  })
  .catch(() => { /* the stylized fallback is already on screen */ });

function globeRadius() {
  const { w, h } = size.value;
  return Math.max(10, Math.min(w, h) * 0.38 * Math.sqrt(zoom.value));
}

function resize() {
  const el = wrapEl.value;
  const canvas = canvasEl.value;
  if (!el || !canvas) return;
  const w = el.clientWidth;
  const h = el.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  try {
    ctx = canvas.getContext ? canvas.getContext("2d") : null;
  } catch {
    ctx = null; // jsdom has no canvas — the DOM overlay still works
  }
  size.value = { w, h };
  needsDraw = true;
}

// ── drawing ───────────────────────────────────────────────────────────────────




function draw() {
  const g = ctx;
  const { w, h } = size.value;
  if (!g || !w || !h) return;
  // boundary rings under the city and landmark pins of the active layer
  const cx = w / 2;
  const cy = h / 2;
  const r = globeRadius();
  const rings = placed.value
    .filter((p) => p.spot.level !== "country")
    .map((p) => ({ x: p.x, y: p.y, radius: 11 * Math.sqrt(zoom.value), opacity: p.opacity }));
  drawGlobe(g, { w, h, rot: rot.value, r }, { borders: borders.value, rings, dpr: window.devicePixelRatio || 1 });
}

function frame(ts) {
  if (spinning.value && !hasInteracted.value && !dragging.value && !anim) {
    if (!spinStartedAt) spinStartedAt = ts || 0;
    if (ts - spinStartedAt > IDLE_SPIN_MS) spinning.value = false;
    else {
      rot.value = clampRotation({ lambda: rot.value.lambda + 0.06, phi: rot.value.phi });
      needsDraw = true;
    }
  }
  if (anim) stepRotationAnim();
  if (needsDraw) {
    needsDraw = false;
    draw();
  }
  raf = requestAnimationFrame(frame);
}

// ── rotation animation (a picked spot glides to the front) ────────────────────
let anim = null;
function animateRotationTo(target) {
  const from = { ...rot.value };
  const to = clampRotation(target);
  let dLambda = to.lambda - from.lambda;
  if (dLambda > 180) dLambda -= 360;
  if (dLambda < -180) dLambda += 360;
  anim = { from, dLambda, dPhi: to.phi - from.phi, t: 0 };
}
function stepRotationAnim() {
  const a = anim;
  a.t = Math.min(1, a.t + 0.055);
  const e = a.t < 0.5 ? 2 * a.t * a.t : 1 - Math.pow(-2 * a.t + 2, 2) / 2;
  rot.value = clampRotation({ lambda: a.from.lambda + a.dLambda * e, phi: a.from.phi + a.dPhi * e });
  needsDraw = true;
  if (a.t >= 1) anim = null;
}

// ── interaction: drag to spin, wheel/pinch to zoom ────────────────────────────
const dragging = ref(false);
const hintVisible = ref(true);
let drag = null;
const pointers = new Map();
let pinch = null;

// Where a drag may start: anywhere on the planet or its pins — but never on
// the chrome (zoom buttons, cards, header), which keep their taps.
function draggableTarget(e) {
  return !e.target.closest?.(".wd-zoom, .wd-card, .wd-intro, .wd-top, .wd-hint, .wd-zoom-hint");
}

function onPointerDown(e) {
  if (!draggableTarget(e)) return;
  e.target.setPointerCapture?.(e.pointerId);
  hasInteracted.value = true;
  dragging.value = false; // a stale swallow from a drag that ended off-button
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: zoom.value };
    drag = null;
    return;
  }
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY, lambda: rot.value.lambda, phi: rot.value.phi, moved: false };
}

// Any pointer travel over the explorer retires the idle drift — a moving
// target is impossible to tap precisely. Bubbled moves cover the pins too.
function onPointerMove(e) {
  hasInteracted.value = true;
  spinning.value = false;
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch.dist > 0) zoomTo(pinch.zoom * (dist / pinch.dist));
    return;
  }
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < 5) return;
  drag.moved = true;
  dragging.value = true;
  hintVisible.value = false;
  const k = 0.26 / Math.sqrt(zoom.value);
  rot.value = clampRotation({
    lambda: drag.lambda - dx * k,
    phi: drag.phi + dy * k,
  });
  needsDraw = true;
}

function onPointerUp(e) {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (drag && e.pointerId === drag.id) {
    if (drag.moved) {
      selectedId.value = "";
      // keep `dragging` set: the trailing click must still be swallowed
    } else {
      dragging.value = false;
    }
    drag = null;
  }
}

// A drag that started on a pin must not ALSO tap it — swallow the trailing
// click exactly once (the same contract as the picture scene's pan).
function onClickCapture(e) {
  if (!dragging.value) return;
  dragging.value = false;
  e.stopPropagation();
  e.preventDefault();
}

function onWheel(e) {
  e.preventDefault();
  hasInteracted.value = true;
  hintVisible.value = false;
  zoomTo(zoom.value * (e.deltaY < 0 ? 1.13 : 1 / 1.13));
}

function zoomTo(target) {
  zoom.value = clampZoom(target);
  needsDraw = true;
}

function zoomStep(dir) {
  hasInteracted.value = true;
  hintVisible.value = false;
  zoomTo(zoom.value * (dir > 0 ? 1.35 : 1 / 1.35));
}

function resetView() {
  hasInteracted.value = true;
  zoomTo(ZOOM_MIN);
  animateRotationTo({ lambda: 70, phi: 22 });
}

function onKey(e) {
  if (e.key === "Escape") selectedId.value = "";
  if (e.key === "+" || e.key === "=") zoomStep(1);
  if (e.key === "-") zoomStep(-1);
}

onMounted(() => {
  window.addEventListener("keydown", onKey);
  resize();
  ro = new ResizeObserver(resize);
  ro.observe(wrapEl.value);
  raf = requestAnimationFrame(frame);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKey);
  cancelAnimationFrame(raf);
  ro?.disconnect();
  stop();
});

// zoom hint: invite the next layer of discovery (the current layer's pins
// hide as the child crosses into the deeper one)
const zoomHint = computed(() => {
  const level = currentLevelAtZoom(zoom.value);
  if (level === "country") return "Zoom in to explore the cities inside";
  if (level === "city") return "Keep zooming to find famous places";
  return "";
});

const narrated = computed(() => `${props.scene.title}. ${props.scene.narration}`);
const discovered = computed(() => countSeen(props.topic.id));

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch { /* stay windowed */ }
}
</script>

<template>
  <section
    class="wd-globe"
    :class="{ 'has-open': Boolean(selected) }"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @click.capture="onClickCapture"
  >
    <div ref="wrapEl" class="wd-sky">
      <canvas
        ref="canvasEl"
        class="wd-planet"
        @wheel="onWheel"
      ></canvas>

      <!-- the place spots, glued to the spinning planet -->
      <div class="wd-spots">
        <div
          v-for="p in placed"
          :key="p.spot.id"
          class="wd-spot-pos"
          :style="{
            left: `${p.x}px`,
            top: `${p.y}px`,
            opacity: p.opacity,
            zIndex: 5 + Math.round(p.depth * 20),
          }"
        >
          <WikidoHotspot
            :spot="p.spot"
            :seen="seen(topic.id, `hotspot:${scene.id}:${p.spot.id}`)"
            :open="selectedId === p.spot.id"
            :cross="isCross(p.spot)"
            :placement="{ left: '0px', top: '0px' }"
            @select="pick(p.spot)"
            @activate="activate(p.spot)"
          />
        </div>
      </div>
    </div>

    <!-- invite to spin, until the first drag -->
    <Transition name="wd-fade">
      <div v-if="hintVisible" class="wd-hint" role="note">
        <span class="material-symbols-rounded" aria-hidden="true">swipe</span>
        Drag to spin the Earth
      </div>
    </Transition>

    <!-- zoom level discovery hint -->
    <Transition name="wd-fade">
      <div v-if="zoomHint && !hintVisible" class="wd-zoom-hint" role="note">
        <span class="material-symbols-rounded" aria-hidden="true">zoom_in</span>
        {{ zoomHint }}
      </div>
    </Transition>

    <!-- top chrome -->
    <header class="wd-top">
      <nav class="wd-crumbs" aria-label="Where you are">
        <button type="button" class="wd-home" aria-label="Back to all Wikido topics" title="All topics" @click="emit('exit')">
          <span class="material-symbols-rounded">home</span>
        </button>
        <template v-for="crumb in trail" :key="`${crumb.topicId}:${crumb.sceneId}`">
          <button type="button" class="wd-crumb" @click="emit('navigate', crumb)">{{ crumb.title }}</button>
          <span class="material-symbols-rounded wd-crumb-sep" aria-hidden="true">chevron_right</span>
        </template>
        <span class="wd-crumb current" aria-current="location">{{ scene.title }}</span>
      </nav>
      <div class="wd-tools">
        <slot name="tools" />
        <span class="wd-progress" :title="`${discovered} of ${spots.length} places in ${topic.title}`">
          <span class="material-symbols-rounded" aria-hidden="true">explore</span>
          {{ discovered }}/{{ spots.length }}
        </span>
        <button type="button" class="wd-tool" aria-label="Toggle fullscreen" title="Fullscreen" @click="toggleFullscreen">
          <span class="material-symbols-rounded">fullscreen</span>
        </button>
      </div>
    </header>

    <!-- zoom controls -->
    <div class="wd-zoom" role="group" aria-label="Zoom">
      <button type="button" class="wd-zbtn" aria-label="Zoom in" :disabled="zoom >= ZOOM_MAX" @click="zoomStep(1)">
        <span class="material-symbols-rounded">add</span>
      </button>
      <button type="button" class="wd-zbtn" aria-label="Zoom out" :disabled="zoom <= ZOOM_MIN" @click="zoomStep(-1)">
        <span class="material-symbols-rounded">remove</span>
      </button>
      <button type="button" class="wd-zbtn" aria-label="Reset view" title="Back to the whole Earth" @click="resetView">
        <span class="material-symbols-rounded">public</span>
      </button>
    </div>

    <!-- selected place detail -->
    <Transition name="wd-slide">
      <WikidoInfoCard
        v-if="selected"
        :key="`${scene.id}:${selected.id}`"
        class="wd-card"
        :spot="selected"
        :cross="isCross(selected)"
        :cross-title="crossTitle(selected)"
        :openable="doorOpen(selected)"
        @close="selectedId = ''"
        @enter="emit('enter', selected)"
      />
    </Transition>

    <!-- welcome narration -->
    <footer class="wd-intro" :class="{ open: introOpen }">
      <button type="button" class="wd-intro-head" :aria-expanded="introOpen" @click="introOpen = !introOpen">
        <h1 class="wd-title">{{ scene.title }}</h1>
        <span class="material-symbols-rounded wd-chev" aria-hidden="true">keyboard_arrow_down</span>
      </button>
      <div v-if="introOpen" class="wd-intro-body">
        <p class="wd-narration">{{ scene.narration }}</p>
        <div class="wd-intro-actions">
          <SpeakButton
            :text="narrated"
            :audio-url="resolveWikidoAudioUrl(scene.audio || '')"
            size="lg"
            label="Read to me"
            content-kind="story"
            class="wd-read"
          />
        </div>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.wd-globe {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: radial-gradient(120% 90% at 50% 0%, #241548 0%, #191033 55%, #0D0719 100%);
  font-family: inherit;
}

.wd-sky { position: absolute; inset: 0; }
.wd-planet { position: absolute; inset: 0; touch-action: none; cursor: grab; }
.wd-planet:active { cursor: grabbing; }

/* spot layer: positions are computed in px against the canvas. The pins
   themselves take one-finger drags and pinches (see the section handlers),
   so touch-action must stay none here too — no page zoom over the planet. */
.wd-spots { position: absolute; inset: 0; pointer-events: none; touch-action: none; }
.wd-spot-pos {
  position: absolute;
  transform: translate(-50%, -50%);
  pointer-events: auto;
  touch-action: none;
  transition: opacity .3s ease;
}

.wd-fade-enter-active, .wd-fade-leave-active { transition: opacity .35s ease; }
.wd-fade-enter-from, .wd-fade-leave-to { opacity: 0; }

/* invites */
.wd-hint, .wd-zoom-hint {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  z-index: 26;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.4rem 0.85rem;
  border-radius: 999px;
  background: rgba(30, 18, 52, .72);
  border: 1.5px solid rgba(255, 255, 255, .3);
  color: #FFF7EA;
  font-size: 0.85rem;
  font-weight: 700;
  pointer-events: none;
  backdrop-filter: blur(6px);
}
.wd-hint { top: 64px; }
.wd-zoom-hint { bottom: 120px; }
.wd-hint .material-symbols-rounded, .wd-zoom-hint .material-symbols-rounded { font-size: 18px; }

/* top chrome — same language as the picture scene */
.wd-top {
  position: absolute;
  top: 14px;
  left: 16px;
  right: 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  z-index: 35;
  pointer-events: none;
}
.wd-top > * { pointer-events: auto; }
.wd-crumbs { display: flex; align-items: center; gap: 0.35rem; min-width: 0; flex-wrap: wrap; }
.wd-home {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  border: 1.5px solid rgba(255, 255, 255, .35);
  background: rgba(30, 18, 52, .55);
  color: #FFF7EA;
  cursor: pointer;
  backdrop-filter: blur(6px);
  transition: background .15s ease;
}
.wd-home:hover { background: rgba(76, 29, 149, .75); }
.wd-home .material-symbols-rounded { font-size: 20px; }
.wd-crumb {
  border: none;
  cursor: pointer;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0.45rem 0.85rem;
  border-radius: 999px;
  background: rgba(30, 18, 52, .55);
  border: 1.5px solid rgba(255, 255, 255, .28);
  color: #FFF7EA;
  font-size: 0.85rem;
  font-weight: 700;
  font-family: inherit;
  backdrop-filter: blur(6px);
}
.wd-crumb.current {
  background: rgba(255, 253, 247, .92);
  color: #3B0764;
  border-color: transparent;
  cursor: default;
}
.wd-crumb-sep { font-size: 16px; color: rgba(255, 247, 234, .8); }
.wd-tools { display: flex; align-items: center; gap: 0.5rem; }
.wd-progress {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.4rem 0.75rem;
  border-radius: 999px;
  background: rgba(30, 18, 52, .55);
  border: 1.5px solid rgba(255, 255, 255, .28);
  color: #FDE68A;
  font-size: 0.82rem;
  font-weight: 800;
  backdrop-filter: blur(6px);
}
.wd-progress .material-symbols-rounded { font-size: 16px; }
.wd-tool {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  border: 1.5px solid rgba(255, 255, 255, .35);
  background: rgba(30, 18, 52, .55);
  color: #FFF7EA;
  cursor: pointer;
  backdrop-filter: blur(6px);
}
.wd-tool:hover { background: rgba(76, 29, 149, .75); }
.wd-tool .material-symbols-rounded { font-size: 20px; }

/* zoom controls */
.wd-zoom {
  position: absolute;
  right: 20px;
  bottom: 24px;
  z-index: 28;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}
.wd-zbtn {
  display: grid;
  place-items: center;
  width: 46px;
  height: 46px;
  border-radius: 50%;
  border: 1.5px solid rgba(255, 255, 255, .4);
  background: rgba(30, 18, 52, .68);
  color: #FFF7EA;
  cursor: pointer;
  backdrop-filter: blur(6px);
  transition: background .15s ease, transform .12s ease;
  font-family: inherit;
}
.wd-zbtn:hover:not(:disabled) { background: rgba(76, 29, 149, .85); transform: scale(1.06); }
.wd-zbtn:disabled { opacity: 0.35; cursor: default; }
.wd-zbtn .material-symbols-rounded { font-size: 24px; }

/* detail card */
.wd-card {
  position: absolute;
  top: 72px;
  right: 20px;
  z-index: 30;
}
.wd-slide-enter-active { transition: opacity .25s ease, transform .25s ease; }
.wd-slide-leave-active { transition: opacity .18s ease, transform .18s ease; }
.wd-slide-enter-from, .wd-slide-leave-to { opacity: 0; transform: translateX(24px); }

/* welcome footer */
.wd-intro {
  position: absolute;
  left: 20px;
  bottom: 20px;
  z-index: 25;
  width: min(520px, calc(100vw - 480px));
  border-radius: 20px;
  background: linear-gradient(160deg, rgba(24, 14, 42, .88), rgba(24, 14, 42, .72));
  border: 1.5px solid rgba(255, 255, 255, .2);
  box-shadow: 0 14px 40px rgba(10, 5, 25, .5);
  backdrop-filter: blur(8px);
  color: #FFF7EA;
  overflow: hidden;
}
.wd-intro-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  width: 100%;
  padding: 0.85rem 1rem;
  border: none;
  background: none;
  cursor: pointer;
  color: inherit;
  font-family: inherit;
  text-align: left;
}
.wd-title { margin: 0; font-size: 1.5rem; line-height: 1.15; }
.wd-chev { font-size: 26px; transition: transform .2s ease; }
.wd-intro.open .wd-chev { transform: rotate(180deg); }
.wd-intro-body { padding: 0 1rem 0.95rem; }
.wd-narration { margin: 0 0 0.7rem; font-size: 0.95rem; line-height: 1.55; color: rgba(255, 247, 234, .92); }
.wd-intro-actions { display: flex; align-items: center; gap: 0.6rem; }

@media (max-width: 939px) {
  .wd-card { top: auto; right: 12px; left: 12px; bottom: 12px; max-height: 62vh; overflow-y: auto; }
  .wd-intro { width: calc(100vw - 24px); left: 12px; bottom: 12px; }
  .wd-zoom { right: 12px; bottom: 96px; }
  .wd-zbtn { width: 42px; height: 42px; }
  /* the open card is a bottom sheet — the zoom stack would sit on top of it */
  .wd-globe.has-open .wd-zoom { display: none; }
}
</style>
