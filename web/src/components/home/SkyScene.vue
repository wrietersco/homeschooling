<script setup>
// The Home playground's living backdrop — a full-bleed SVG world:
// gradient sky, sun/moon with spinning rays or twinkling stars, drifting
// clouds, a rainbow, birds, a bobbing hot-air balloon, and rolling candy-green
// hills with flowers and a snail. Everything is decorative (aria-hidden) and
// pure CSS-animated — no canvas, no WebGL, no scroll jank.
import { computed } from "vue";

const props = defineProps({
  mode: { type: Object, required: true }, // palette object from @/lib/skyMode
});

// prefers-reduced-motion: every CSS animation is disabled globally, so the
// scene must still look complete STATICALLY — clouds and birds park at
// pleasant in-sky spots instead of off-screen "waiting" for a drift that
// never runs.
const reduced =
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// Clouds start off-screen LEFT so the drift wrap (x → x+2000) always happens
// outside the viewport: negative delays pre-roll them to mid-flight so the
// sky is already alive on first paint.
const CLOUDS_DRIFT = [
  { x: -260, y: 110, s: 1.15, dur: 105, d: -15 },
  { x: -520, y: 56, s: 0.85, dur: 130, d: -70 },
  { x: -380, y: 208, s: 1.0, dur: 118, d: -40 },
  { x: -700, y: 148, s: 0.75, dur: 140, d: -100 },
  { x: -150, y: 38, s: 0.7, dur: 95, d: -8 },
  { x: -860, y: 258, s: 0.9, dur: 150, d: -125 },
];
const CLOUDS_STATIC = [
  { x: 80, y: 90, s: 1.05 },
  { x: 420, y: 44, s: 0.75 },
  { x: 760, y: 46, s: 0.9 }, // top-center, above the title
  { x: 1080, y: 240, s: 0.7 }, // right of the lede, under the sun
  { x: 205, y: 218, s: 0.8 }, // left of the owl
];
const CLOUDS = reduced ? CLOUDS_STATIC : CLOUDS_DRIFT;

const BIRDS_FLY = [
  { y: 196, s: 1, dur: 42, d: 6 },
  { y: 150, s: 0.72, dur: 56, d: 24 },
];
const BIRDS_STATIC = [
  { x: 300, y: 140, s: 1 },
  { x: 884, y: 138, s: 0.72 },
];
const BIRDS = reduced ? BIRDS_STATIC : BIRDS_FLY;

// Deterministic pseudo-random scatter (no Math.random → stable between renders).
const stars = computed(() =>
  Array.from({ length: props.mode.stars }, (_, i) => ({
    x: ((i * 149 + 37) % 1400) + 20,
    y: ((i * 83 + 19) % 470) + 26,
    r: 1.4 + (i % 3) * 0.6,
    delay: (i % 9) * 0.7,
  }))
);
const fireflies = computed(() =>
  Array.from({ length: props.mode.fireflies }, (_, i) => ({
    x: ((i * 211 + 53) % 1360) + 40,
    y: 600 + ((i * 97 + 31) % 230),
    delay: (i % 6) * 0.9,
    dur: 3.6 + (i % 5) * 0.8,
  }))
);

// Flowers on the front hill — petal color cycles pink / yellow / blue.
const FLOWERS = [
  { x: 180, y: 862, p: "#FF8FB3" },
  { x: 420, y: 856, p: "#FFD54F" },
  { x: 690, y: 866, p: "#8FC9FF" },
  { x: 980, y: 860, p: "#FF8FB3" },
  { x: 1285, y: 864, p: "#FFD54F" },
];

const RAINBOW = ["#FF9AA2", "#FFB27A", "#FFE07A", "#9BE08A", "#8FC9FF", "#C9A8FF"];
</script>

<template>
  <div class="sky" aria-hidden="true">
    <svg
      class="sky-svg"
      viewBox="0 0 1440 900"
      preserveAspectRatio="xMidYMax slice"
      :style="{ '--cloud': mode.cloud, '--cloud-shade': mode.cloudShade, '--crown': `color-mix(in srgb, ${mode.hills[1]} 72%, #1b3b2a)` }"
    >
      <defs>
        <linearGradient id="sky-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" :stop-color="mode.sky[0]" />
          <stop offset="0.55" :stop-color="mode.sky[1]" />
          <stop offset="1" :stop-color="mode.sky[2]" />
        </linearGradient>
        <radialGradient id="sky-orb-glow">
          <stop offset="0" :stop-color="mode.orbGlow" stop-opacity="0.9" />
          <stop offset="1" :stop-color="mode.orbGlow" stop-opacity="0" />
        </radialGradient>
        <linearGradient id="sky-beam" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#FFF3B0" stop-opacity="0.85" />
          <stop offset="1" stop-color="#FFF3B0" stop-opacity="0" />
        </linearGradient>
        <mask id="sky-moon-mask">
          <rect x="1145" y="20" width="220" height="220" fill="#fff" />
          <circle cx="1301" cy="138" r="42" fill="#000" />
        </mask>
        <!-- Puffy cloud built from circles + a flat-bottom pill (always reads right). -->
        <g id="sky-cloud-shape">
          <g fill="var(--cloud-shade)" transform="translate(0 7)">
            <circle cx="40" cy="64" r="26" /><circle cx="78" cy="44" r="34" />
            <circle cx="120" cy="50" r="30" /><circle cx="152" cy="66" r="22" />
            <rect x="32" y="64" width="124" height="26" rx="13" />
          </g>
          <g fill="var(--cloud)">
            <circle cx="40" cy="64" r="26" /><circle cx="78" cy="44" r="34" />
            <circle cx="120" cy="50" r="30" /><circle cx="152" cy="66" r="22" />
            <rect x="32" y="64" width="124" height="26" rx="13" />
          </g>
        </g>
        <g id="sky-bird">
          <path d="M0,0 Q7,-8 14,0 Q21,-8 28,0" fill="none" stroke="#4A3A6B" stroke-width="2.5" stroke-linecap="round" class="bird-wing" />
        </g>
        <clipPath id="sky-balloon-clip">
          <path d="M0,-52 C26,-52 36,-28 29,-6 C24,8 12,14 5,16 L-5,16 C-12,14 -24,8 -29,-6 C-36,-28 -26,-52 0,-52 Z" />
        </clipPath>
        <!-- Daisy: stem, five petals, center. -->
        <g id="sky-flower-shape">
          <line x1="0" y1="0" x2="0" y2="-16" stroke="#2E7D4F" stroke-width="2.5" stroke-linecap="round" />
          <g>
            <circle cx="0" cy="-24" r="3.6" /><circle cx="4.5" cy="-20.5" r="3.6" />
            <circle cx="3" cy="-15.5" r="3.6" /><circle cx="-3" cy="-15.5" r="3.6" />
            <circle cx="-4.5" cy="-20.5" r="3.6" /><circle cx="0" cy="-20" r="2.8" fill="#FF9F45" />
          </g>
        </g>
      </defs>

      <!-- Sky -->
      <rect width="1440" height="900" fill="url(#sky-grad)" />

      <!-- Rainbow (soft, behind everything foreground) -->
      <g opacity="0.32" fill="none" stroke-width="13">
        <path v-for="(c, i) in RAINBOW" :key="i" :stroke="c" :d="`M ${720 - (520 - i * 13)},830 A ${520 - i * 13},${520 - i * 13} 0 0 1 ${720 + (520 - i * 13)},830`" />
      </g>

      <!-- Stars -->
      <g v-if="mode.stars">
        <circle
          v-for="(s, i) in stars" :key="i" :cx="s.x" :cy="s.y" :r="s.r" fill="#FFF6D9"
          class="twinkle" :style="{ animationDelay: s.delay + 's' }"
        />
      </g>

      <!-- Sun / Moon — top-right corner, clear of the owl hero -->
      <g transform="translate(1245 170)">
        <circle r="150" fill="url(#sky-orb-glow)" />
        <g v-if="!mode.isMoon" class="rays">
          <rect v-for="i in 12" :key="i" x="-5" y="-126" width="10" height="26" rx="5" :fill="mode.orbGlow" :transform="`rotate(${i * 30})`" />
        </g>
        <g class="orb">
          <circle r="52" :fill="mode.orb" />
          <template v-if="mode.isMoon">
            <circle r="52" fill="#E8E2CF" opacity="0.35" mask="url(#sky-moon-mask)" />
            <circle cx="-14" cy="10" r="7" fill="#000" opacity="0.07" />
            <circle cx="16" cy="-12" r="5" fill="#000" opacity="0.07" />
            <circle cx="8" cy="22" r="4" fill="#000" opacity="0.06" />
          </template>
        </g>
      </g>

      <!-- Fireflies (evening / night only) -->
      <g>
        <circle
          v-for="(f, i) in fireflies" :key="i" :cx="f.x" :cy="f.y" r="3" fill="#FFE066"
          class="firefly" :style="{ animationDelay: f.delay + 's', '--dur': f.dur + 's' }"
        />
      </g>

      <!-- Clouds -->
      <g v-for="(c, i) in CLOUDS" :key="i" :transform="`translate(${c.x} ${c.y}) scale(${c.s})`">
        <g v-if="reduced"><use href="#sky-cloud-shape" /></g>
        <g v-else class="drift" :style="{ '--dur': c.dur + 's', animationDelay: c.d + 's' }"><use href="#sky-cloud-shape" /></g>
      </g>

      <!-- Birds -->
      <template v-if="reduced">
        <g v-for="(b, i) in BIRDS" :key="'bs' + i" :transform="`translate(${b.x} ${b.y}) scale(${b.s})`">
          <use href="#sky-bird" />
        </g>
      </template>
      <template v-else>
        <g v-for="(b, i) in BIRDS" :key="'b' + i" :transform="`translate(-60 ${b.y})`" :style="{ '--dur': b.dur + 's', animationDelay: b.d + 's' }">
          <g class="fly-across"><use :href="'#sky-bird'" :transform="`scale(${b.s})`" /></g>
        </g>
      </template>

      <!-- Hot-air balloon — bobbing above the left hills -->
      <g transform="translate(170 415) scale(0.78)">
        <g class="balloon">
          <path d="M0,-52 C26,-52 36,-28 29,-6 C24,8 12,14 5,16 L-5,16 C-12,14 -24,8 -29,-6 C-36,-28 -26,-52 0,-52 Z" fill="#FF6B8A" />
          <g clip-path="url(#sky-balloon-clip)">
            <rect x="-36" y="-52" width="10.4" height="70" fill="#FFC93C" />
            <rect x="-15" y="-52" width="10.4" height="70" fill="#FFF6F0" />
            <rect x="4.8" y="-52" width="10.4" height="70" fill="#6BCB77" />
            <rect x="25.6" y="-52" width="10.4" height="70" fill="#FFC93C" />
            <ellipse cx="-14" cy="-34" rx="8" ry="16" fill="#fff" opacity="0.35" />
          </g>
          <path d="M-7,16 L-5,22 L5,22 L7,16 Z" fill="#E4653C" />
          <line x1="-11" y1="22" x2="-8" y2="30" stroke="#8A6238" stroke-width="1.6" />
          <line x1="11" y1="22" x2="8" y2="30" stroke="#8A6238" stroke-width="1.6" />
          <rect x="-11" y="30" width="22" height="14" rx="4" fill="#B08152" stroke="#8A6238" stroke-width="1.6" />
        </g>
      </g>

      <!-- Hills -->
      <path d="M0,768 Q 240,664 500,724 T 980,700 T 1440,744 L1440,900 L0,900 Z" :fill="mode.hills[0]" />
      <path d="M0,824 Q 300,726 640,792 T 1440,800 L1440,900 L0,900 Z" :fill="mode.hills[1]" />
      <!-- trees on the mid hill -->
      <g v-for="t in [{ x: 250, y: 782 }, { x: 1128, y: 796 }]" :key="'t' + t.x" :transform="`translate(${t.x} ${t.y})`">
        <rect x="-5" y="-26" width="10" height="28" rx="4" fill="#8A6238" />
        <circle cx="0" cy="-38" r="21" fill="var(--crown)" />
        <circle cx="-14" cy="-28" r="14" fill="var(--crown)" />
        <circle cx="14" cy="-28" r="14" fill="var(--crown)" />
      </g>
      <path d="M0,900 Q 360,812 760,872 T 1440,858 L1440,900 L0,900 Z" :fill="mode.hills[2]" />
      <!-- flowers + bush + snail on the front hill -->
      <g v-for="(f, i) in FLOWERS" :key="'f' + i" :transform="`translate(${f.x} ${f.y})`" class="sway" :style="{ animationDelay: i * 0.6 + 's' }">
        <use href="#sky-flower-shape" :fill="f.p" />
      </g>
      <g transform="translate(1078 878)">
        <ellipse cx="-10" cy="0" rx="16" ry="11" fill="var(--crown)" />
        <ellipse cx="8" cy="-2" rx="13" ry="9" fill="var(--crown)" />
      </g>
      <g transform="translate(628 884)">
        <circle r="7.5" fill="#F7C8A2" stroke="#C98A5B" stroke-width="2" />
        <circle r="3" fill="none" stroke="#C98A5B" stroke-width="1.6" />
        <path d="M-7,2 Q -16,4 -20,-2" fill="none" stroke="#C98A5B" stroke-width="3" stroke-linecap="round" />
        <circle cx="-20" cy="-3" r="1.8" fill="#C98A5B" />
      </g>
    </svg>
  </div>
</template>

<style scoped>
.sky {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
}
.sky-svg {
  width: 100%;
  height: 100%;
  display: block;
}

/* Every CSS-animated SVG group needs fill-box origin so rotations/pulses
   happen around the shape, not the 1440x900 canvas. */
.rays, .orb, .twinkle, .firefly, .drift, .fly-across, .bird-wing, .balloon, .sway {
  transform-box: fill-box;
  transform-origin: center;
}

.rays { animation: sky-spin 90s linear infinite; }
.orb { animation: sky-breathe 5s ease-in-out infinite alternate; }
.twinkle { animation: sky-twinkle 3.2s ease-in-out infinite; }
.firefly { animation: sky-firefly var(--dur, 4s) ease-in-out infinite alternate; }
.drift { animation: sky-drift var(--dur, 110s) linear infinite; }
.fly-across { animation: sky-fly var(--dur, 48s) linear infinite; transform-origin: initial; }
.bird-wing { animation: sky-flap 0.42s ease-in-out infinite alternate; }
.balloon { animation: sky-bob 5.5s ease-in-out infinite alternate; }
.sway { transform-origin: bottom center; animation: sky-sway 3.4s ease-in-out infinite alternate; }

@keyframes sky-spin { to { transform: rotate(360deg); } }
@keyframes sky-breathe { from { transform: scale(1); } to { transform: scale(1.045); } }
@keyframes sky-twinkle { 0%, 100% { opacity: 0.25; } 50% { opacity: 1; } }
@keyframes sky-firefly {
  from { opacity: 0.15; transform: translate(0, 0); }
  50% { opacity: 1; }
  to { opacity: 0.4; transform: translate(14px, -10px); }
}
@keyframes sky-drift { to { transform: translateX(2000px); } }
@keyframes sky-fly {
  from { transform: translate(0, 0); }
  25% { transform: translate(400px, -26px); }
  50% { transform: translate(800px, 12px); }
  75% { transform: translate(1200px, -18px); }
  to { transform: translate(1640px, 0); }
}
@keyframes sky-flap { from { transform: scaleY(1); } to { transform: scaleY(0.55); } }
@keyframes sky-bob {
  from { transform: translateY(-8px) rotate(-2.4deg); }
  to { transform: translateY(8px) rotate(2.4deg); }
}
@keyframes sky-sway { from { transform: rotate(-5deg); } to { transform: rotate(5deg); } }

@media (prefers-reduced-motion: reduce) {
  .rays, .orb, .twinkle, .firefly, .drift, .fly-across, .bird-wing, .balloon, .sway {
    animation: none !important;
  }
}
</style>
