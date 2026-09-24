<!-- Full-screen celebration for a child's win: confetti cannons fire from both
     bottom corners, bursts pop all over the screen, and a flock of balloons
     floats up past the buddy. Purely visual and click-through; the sound is
     played by whoever calls play() (the Live composable owns the audio). -->
<script setup>
import { onBeforeUnmount, onMounted, ref } from "vue";
import confetti from "canvas-confetti";

const canvas = ref(null);
const balloons = ref([]);
let fire = null;
const timers = new Set();

const COLORS = ["#ff5d8f", "#ffb627", "#ffe45c", "#3ddc97", "#46b3ff", "#9b6bff", "#ff7a45", "#2ee6d6"];
const BALLOON_COLORS = ["#ff4f81", "#ffb627", "#3ddc97", "#46b3ff", "#9b6bff", "#ff7a45", "#ff5dc8", "#2ec4b6"];

onMounted(() => {
  fire = confetti.create(canvas.value, { resize: true, useWorker: false, disableForReducedMotion: true });
});
onBeforeUnmount(() => {
  for (const t of timers) clearTimeout(t);
  fire?.reset();
});

function later(ms, fn) {
  const t = setTimeout(() => { timers.delete(t); fn(); }, ms);
  timers.add(t);
}

function launchConfetti() {
  if (!fire) return;
  const base = { colors: COLORS, shapes: ["square", "circle", "star"], ticks: 260, gravity: 0.9, scalar: 1.1 };
  // Cannons from both bottom corners, angled in toward the middle.
  const cannons = () => {
    fire({ ...base, particleCount: 110, angle: 60, spread: 55, startVelocity: 78, origin: { x: 0, y: 1 } });
    fire({ ...base, particleCount: 110, angle: 120, spread: 55, startVelocity: 78, origin: { x: 1, y: 1 } });
  };
  cannons();
  later(350, cannons);
  // A big pop in the middle, then fireworks-style bursts all over the screen.
  fire({ ...base, particleCount: 140, spread: 360, startVelocity: 38, origin: { x: 0.5, y: 0.35 } });
  for (let i = 1; i <= 7; i++) {
    later(i * 230, () => fire({
      ...base,
      particleCount: 55,
      spread: 360,
      startVelocity: 28,
      origin: { x: 0.1 + Math.random() * 0.8, y: 0.1 + Math.random() * 0.45 },
    }));
  }
}

function launchBalloons() {
  const batch = Date.now();
  const fresh = Array.from({ length: 16 }, (_, i) => ({
    id: `${batch}-${i}`,
    left: 2 + ((i * 97) % 93) + Math.random() * 4, // spread across the full width
    size: 52 + Math.random() * 38,
    color: BALLOON_COLORS[i % BALLOON_COLORS.length],
    dur: 4.2 + Math.random() * 1.8,
    delay: Math.random() * 0.9,
    sway: 10 + Math.random() * 18,
  }));
  balloons.value = [...balloons.value, ...fresh];
  const longest = Math.max(...fresh.map((b) => b.dur + b.delay));
  later(longest * 1000 + 200, () => { balloons.value = balloons.value.filter((b) => !b.id.startsWith(`${batch}-`)); });
}

function play() {
  launchConfetti();
  launchBalloons();
}

defineExpose({ play });
</script>

<template>
  <div class="cel-root" aria-hidden="true" data-testid="celebration">
    <canvas ref="canvas" class="cel-canvas" />
    <div
      v-for="b in balloons"
      :key="b.id"
      class="cel-balloon"
      :style="{ left: `${b.left}%`, width: `${b.size}px`, animationDuration: `${b.dur}s`, animationDelay: `${b.delay}s`, '--sway': `${b.sway}px` }"
    >
      <svg viewBox="0 0 60 112">
        <path d="M30 2C13 2 2 17 2 36c0 21 16 37 28 41 12-4 28-20 28-41C58 17 47 2 30 2Z" :fill="b.color" />
        <ellipse cx="19" cy="22" rx="6" ry="11" fill="#fff" opacity=".38" transform="rotate(-22 19 22)" />
        <path d="M25.5 77h9L30 83.5Z" :fill="b.color" />
        <path d="M30 83c-6 8 6 14 0 28" stroke="#7d6c99" stroke-width="1.3" fill="none" />
      </svg>
    </div>
  </div>
</template>

<style scoped>
.cel-root { position: fixed; inset: 0; z-index: 1000; pointer-events: none; overflow: hidden; }
.cel-canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
.cel-balloon {
  position: absolute; bottom: -180px; transform: translateY(0);
  animation-name: cel-rise; animation-timing-function: cubic-bezier(0.35, 0.1, 0.55, 1); animation-fill-mode: both;
  filter: drop-shadow(0 6px 6px rgba(0, 0, 0, 0.12));
}
.cel-balloon svg { display: block; width: 100%; animation: cel-sway 1.7s ease-in-out infinite alternate; }
@keyframes cel-rise { to { transform: translateY(calc(-100vh - 260px)); } }
@keyframes cel-sway {
  from { transform: translateX(calc(var(--sway) * -1)) rotate(-7deg); }
  to { transform: translateX(var(--sway)) rotate(7deg); }
}
@media (prefers-reduced-motion: reduce) {
  .cel-balloon { display: none; }
}
</style>
