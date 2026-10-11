<script setup>
// One explorable Wikido scene: the full-bleed artwork, its hotspot layer, the
// breadcrumb trail home, the scene narration card ("Read to me"), and the
// sliding detail card for the selected hotspot. Speech always stops when the
// scene changes or the component unmounts — no voice bleeding across screens.
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import SpeakButton from "@/components/SpeakButton.vue";
import WikidoHotspot from "./WikidoHotspot.vue";
import WikidoInfoCard from "./WikidoInfoCard.vue";
import { useWikidoProgress } from "@/lib/wikido/progress";
import { resolveWikidoAudioUrl } from "@/lib/wikido/audio";
import { useCoverPlacement } from "@/composables/useCoverPlacement";
import { useSpeech } from "@/composables/useSpeech";

const props = defineProps({
  topic: { type: Object, required: true },
  scene: { type: Object, required: true },
  // Ancestors of the current scene, root first: [{ sceneId, title }]
  trail: { type: Array, default: () => [] },
});
const emit = defineEmits(["enter", "navigate", "exit"]);

const { seen, markSeen, countSeen } = useWikidoProgress();
const { stop } = useSpeech();

const isDev = import.meta.env.DEV;

const selectedId = ref("");
const introOpen = ref(true);
const imgReady = ref(false);

// Dev-only hotspot calibration: press H (or the chip) to show a crosshair that
// reads out cursor position as percentages of the artwork — used to re-measure
// hotspot x/y after swapping in newly generated scene art.
const calibrating = ref(false);
const cursorPct = ref({ x: 50, y: 50 });
const sceneEl = ref(null);
// spot pins must land on the object they mark even though the artwork is
// displayed with `cover` (cropped) — map picture % → on-screen px
const artEl = ref(null);
const { onArtworkLoad, pinStyle } = useCoverPlacement(artEl);

function onMove(e) {
  if (!calibrating.value || !sceneEl.value) return;
  const r = sceneEl.value.getBoundingClientRect();
  cursorPct.value = {
    x: Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)),
    y: Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100)),
  };
}

const selected = computed(() => props.scene.hotspots.find((s) => s.id === selectedId.value) || null);
const narrated = computed(() => `${props.scene.title}. ${props.scene.narration}`);
const discovered = computed(() => countSeen(props.topic.id));
const totalPlaces = computed(() => Object.values(props.topic.scenes).reduce((n, sc) => n + sc.hotspots.length, 0));

watch(
  () => props.scene.id,
  () => {
    stop();
    selectedId.value = "";
    introOpen.value = true;
    imgReady.value = false;
    markSeen(props.topic.id, `scene:${props.scene.id}`);
  },
  { immediate: true }
);

function pick(spot) {
  selectedId.value = spot.id;
  markSeen(props.topic.id, `hotspot:${props.scene.id}:${spot.id}`);
}

// Double-click/tap on a doorway hotspot steps straight into the child scene.
function activate(spot) {
  pick(spot);
  if (spot.childSceneId) emit("enter", spot);
}

function onKey(e) {
  if (e.key === "Escape") selectedId.value = "";
  if (import.meta.env.DEV && (e.key === "h" || e.key === "H") && !e.target.closest("input, textarea, select")) {
    calibrating.value = !calibrating.value;
  }
}
onMounted(() => window.addEventListener("keydown", onKey));
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKey);
  stop();
});

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch { /* browser refused (permissions/iframe) — stay windowed */ }
}
</script>

<template>
  <section ref="sceneEl" class="wd-scene" @mousemove="onMove">
    <Transition name="wd-fade" mode="out-in">
      <div :key="scene.id" ref="artEl" class="wd-art" :class="{ 'has-open': Boolean(selected) }">
        <img
          :src="scene.image.src"
          :alt="scene.image.alt"
          :class="{ ready: imgReady }"
          draggable="false"
          @load="onArtworkLoad($event); imgReady = true"
        />
        <WikidoHotspot
          v-for="spot in scene.hotspots"
          :key="spot.id"
          :spot="spot"
          :placement="pinStyle(spot.x, spot.y)"
          :seen="seen(topic.id, `hotspot:${scene.id}:${spot.id}`)"
          :open="selectedId === spot.id"
          @select="pick(spot)"
          @activate="activate(spot)"
        />
      </div>
    </Transition>

    <!-- top chrome: breadcrumb trail + tools -->
    <header class="wd-top">
      <nav class="wd-crumbs" aria-label="Where you are">
        <button type="button" class="wd-home" aria-label="Back to all Wikido topics" title="All topics" @click="emit('exit')">
          <span class="material-symbols-rounded">home</span>
        </button>
        <template v-for="crumb in trail" :key="crumb.sceneId">
          <button type="button" class="wd-crumb" @click="emit('navigate', crumb.sceneId)">{{ crumb.title }}</button>
          <span class="material-symbols-rounded wd-crumb-sep" aria-hidden="true">chevron_right</span>
        </template>
        <span class="wd-crumb current" aria-current="location">{{ scene.title }}</span>
      </nav>
      <div class="wd-tools">
        <span class="wd-progress" :title="`${discovered} of ${totalPlaces} discoveries in ${topic.title}`">
          <span class="material-symbols-rounded" aria-hidden="true">explore</span>
          {{ discovered }}/{{ totalPlaces }}
        </span>
        <button
          v-if="isDev"
          type="button"
          class="wd-tool"
          :class="{ on: calibrating }"
          aria-label="Toggle hotspot calibration crosshair (H)"
          title="Hotspot calibration (H)"
          @click="calibrating = !calibrating"
        >
          <span class="material-symbols-rounded">my_location</span>
        </button>
        <button type="button" class="wd-tool" aria-label="Toggle fullscreen" title="Fullscreen" @click="toggleFullscreen">
          <span class="material-symbols-rounded">fullscreen</span>
        </button>
      </div>
    </header>

    <!-- selected hotspot detail -->
    <Transition name="wd-slide">
      <WikidoInfoCard
        v-if="selected"
        :key="`${scene.id}:${selected.id}`"
        class="wd-card"
        :spot="selected"
        @close="selectedId = ''"
        @enter="emit('enter', selected)"
      />
    </Transition>

    <!-- dev hotspot calibration overlay -->
    <div v-if="calibrating" class="wd-cal" aria-hidden="true">
      <div class="wd-cal-line v" :style="{ left: cursorPct.x + '%' }"></div>
      <div class="wd-cal-line h" :style="{ top: cursorPct.y + '%' }"></div>
      <span class="wd-cal-read" :style="{ left: cursorPct.x + '%', top: cursorPct.y + '%' }">
        {{ cursorPct.x.toFixed(1) }}%, {{ cursorPct.y.toFixed(1) }}%
      </span>
    </div>

    <!-- scene narration (Gemini-style intro card) -->
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
.wd-scene {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: #241533;
  font-family: inherit;
}

/* ── artwork + hotspot layer ─────────────────────────────────────────── */
.wd-art { position: absolute; inset: 0; }
.wd-art img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  user-select: none;
  opacity: 0;
  transition: opacity .5s ease;
}
.wd-art img.ready { opacity: 1; }

.wd-fade-enter-active, .wd-fade-leave-active { transition: opacity .35s ease; }
.wd-fade-enter-from, .wd-fade-leave-to { opacity: 0; }

/* ── top chrome ──────────────────────────────────────────────────────── */
.wd-top {
  position: absolute;
  top: 14px;
  left: 16px;
  right: 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  z-index: 20;
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
  transition: background .15s ease;
}
.wd-crumb:hover { background: rgba(76, 29, 149, .75); }
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
  transition: background .15s ease;
}
.wd-tool:hover { background: rgba(76, 29, 149, .75); }
.wd-tool .material-symbols-rounded { font-size: 20px; }
.wd-tool.on { background: rgba(253, 230, 138, .9); color: #713F12; border-color: transparent; }

/* dev hotspot calibration overlay */
.wd-cal { position: absolute; inset: 0; z-index: 40; pointer-events: none; }
.wd-cal-line { position: absolute; background: rgba(255, 80, 80, .75); }
.wd-cal-line.v { top: 0; bottom: 0; width: 1px; }
.wd-cal-line.h { left: 0; right: 0; height: 1px; }
.wd-cal-read {
  position: absolute;
  transform: translate(12px, 12px);
  background: rgba(20, 10, 40, .9);
  color: #FDE68A;
  font-size: 0.78rem;
  font-weight: 700;
  padding: 0.25rem 0.55rem;
  border-radius: 8px;
  white-space: nowrap;
}

/* ── detail card ─────────────────────────────────────────────────────── */
.wd-card {
  position: absolute;
  top: 72px;
  right: 20px;
  z-index: 30;
}
.wd-slide-enter-active { transition: opacity .25s ease, transform .25s ease; }
.wd-slide-leave-active { transition: opacity .18s ease, transform .18s ease; }
.wd-slide-enter-from, .wd-slide-leave-to { opacity: 0; transform: translateX(24px); }

/* ── narration footer ────────────────────────────────────────────────── */
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

/* small screens are explicitly out of scope, but don't let the card overlap
   the detail panel before the desktop-only notice takes over */
@media (max-width: 939px) {
  .wd-intro { width: calc(100vw - 40px); }
}
</style>
