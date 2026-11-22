<script setup>
// The child's perspective switcher: big, colourful lens buttons ("Overview",
// "History", "Food"…) floating over a scene that has more than one way of
// looking at it. One tap turns the picture (see lib/wikido/lensTransition.js).
// Arrow keys move between lenses; the active lens stands forward like the
// front face of a prism.
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

const props = defineProps({
  lenses: { type: Array, required: true }, // [{ id, sceneId, lens: { name, emoji, color } }]
  active: { type: String, default: "main" },
  busy: { type: Boolean, default: false },
});
const emit = defineEmits(["pick", "warm"]);
const barEl = ref(null);
const activeIdx = computed(() => Math.max(0, props.lenses.findIndex((l) => l.id === props.active)));

// on phones the row sits just under the scene's top bar, whose height wraps
const topPx = ref(62);
let ro = null;
onMounted(() => {
  const bar = barEl.value?.closest(".wikido")?.querySelector(".wd-top");
  if (!bar || typeof ResizeObserver === "undefined") return;
  const place = () => { const r = bar.getBoundingClientRect(); topPx.value = Math.round(r.bottom + 6); };
  ro = new ResizeObserver(place);
  ro.observe(bar);
  place();
});
onBeforeUnmount(() => ro?.disconnect());

function onKey(e) {
  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
  e.preventDefault();
  const n = props.lenses.length;
  const next = props.lenses[(activeIdx.value + (e.key === "ArrowRight" ? 1 : -1) + n) % n];
  emit("pick", next.id);
  requestAnimationFrame(() => barEl.value?.querySelector(`[data-lens="${next.id}"]`)?.focus());
}
</script>

<template>
  <nav ref="barEl" class="wd-lenses" :class="{ busy }" :style="{ '--wd-lens-top': `${topPx}px` }" aria-label="Ways to look at this place" @keydown="onKey">
    <p class="wd-lenses-cap" aria-hidden="true">Look at it as…</p>
    <div class="wd-lenses-row" role="radiogroup" aria-label="Perspective">
      <button
        v-for="(l, i) in lenses"
        :key="l.id"
        type="button"
        role="radio"
        class="wd-lens"
        :class="{ on: l.id === active }"
        :data-lens="l.id"
        :aria-checked="l.id === active"
        :tabindex="l.id === active ? 0 : -1"
        :style="{ '--lens': l.lens.color, '--tilt': `${(i - activeIdx) * 7}deg` }"
        @pointerenter="emit('warm', l.id)"
        @focus="emit('warm', l.id)"
        @click="emit('pick', l.id)"
      >
        <span class="wd-lens-gem" aria-hidden="true">{{ l.lens.emoji }}</span>
        <span class="wd-lens-name">{{ l.lens.name }}</span>
      </button>
    </div>
  </nav>
</template>

<style scoped>
.wd-lenses {
  position: absolute;
  right: 20px;
  bottom: 20px;
  z-index: 26;
  max-width: min(440px, calc(100vw - 580px));
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.35rem;
  pointer-events: none;
}
.wd-lenses-cap {
  margin: 0;
  padding: 0.15rem 0.6rem;
  border-radius: 999px;
  background: rgba(24, 14, 42, .7);
  color: #FDE68A;
  font-weight: 800;
  font-size: 0.8rem;
  letter-spacing: .02em;
}
.wd-lenses-row {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.5rem;
  perspective: 600px;
  pointer-events: auto;
}
.wd-lens {
  --lens: #3b82f6;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.15rem;
  min-width: 76px;
  min-height: 76px;
  padding: 0.45rem 0.55rem 0.4rem;
  border-radius: 20px;
  border: 2.5px solid rgba(255, 255, 255, .35);
  background: linear-gradient(160deg, rgba(24, 14, 42, .9), rgba(24, 14, 42, .7));
  color: #FFF7EA;
  font-family: inherit;
  cursor: pointer;
  transform: rotateY(var(--tilt)) translateZ(0);
  transition: transform .25s ease, border-color .2s ease, box-shadow .2s ease, background .2s ease;
  backdrop-filter: blur(6px);
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}
.wd-lens:hover, .wd-lens:focus-visible { transform: rotateY(0deg) translateY(-3px); border-color: var(--lens); outline: none; }
.wd-lens:focus-visible { box-shadow: 0 0 0 3px #FDE68A; }
.wd-lens.on {
  transform: rotateY(0deg) translateY(-4px) scale(1.06);
  border-color: var(--lens);
  background: linear-gradient(160deg, color-mix(in srgb, var(--lens) 55%, #180e2a), rgba(24, 14, 42, .85));
  box-shadow: 0 10px 26px color-mix(in srgb, var(--lens) 45%, transparent), 0 0 0 2px rgba(255, 255, 255, .25) inset;
}
.wd-lens-gem {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 14px;
  background: color-mix(in srgb, var(--lens) 30%, rgba(255, 255, 255, .08));
  font-size: 1.45rem;
  line-height: 1;
}
.wd-lens-name { font-size: 0.82rem; font-weight: 800; white-space: nowrap; }
.busy .wd-lens { pointer-events: none; }

/* phones / small tablets: a swipeable row under the top bar */
@media (max-width: 939px) {
  .wd-lenses {
    right: 0;
    left: 0;
    top: var(--wd-lens-top, 62px);
    bottom: auto;
    max-width: none;
    align-items: stretch;
  }
  .wd-lenses-cap { display: none; }
  .wd-lenses-row {
    flex-wrap: nowrap;
    justify-content: flex-start;
    overflow-x: auto;
    padding: 0.2rem 12px 0.5rem;
    scrollbar-width: none;
    scroll-snap-type: x proximity;
  }
  .wd-lenses-row::-webkit-scrollbar { display: none; }
  .wd-lens { flex: none; min-width: 68px; min-height: 66px; scroll-snap-align: start; transform: none; }
  .wd-lens.on { transform: translateY(-2px) scale(1.04); }
  .wd-lens-gem { width: 34px; height: 34px; font-size: 1.25rem; }
}
@media (prefers-reduced-motion: reduce) {
  .wd-lens, .wd-lens.on, .wd-lens:hover { transition: none; transform: none; }
}
</style>
