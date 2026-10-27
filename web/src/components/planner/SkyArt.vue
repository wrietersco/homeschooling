<script setup>
// The picture beside each hour on the planner's time axis — moon at night,
// sunrise at dawn, a smiling sun by day, a sunset in the evening — so the time
// of day reads without reading.
defineProps({ period: { type: String, default: "day" } });
</script>

<template>
  <svg viewBox="0 0 48 48" class="sky" aria-hidden="true">
    <g v-if="period === 'night'">
      <path d="M30 8 A17 17 0 1 0 40 36 A14 14 0 1 1 30 8 Z" fill="#FFE45C" />
      <circle cx="35" cy="12" r="1.6" fill="#fff" /><circle cx="42" cy="22" r="1.2" fill="#fff" /><circle cx="10" cy="10" r="1.3" fill="#fff" />
    </g>
    <g v-else-if="period === 'dawn'">
      <g class="rays">
        <path v-for="i in 5" :key="i" d="M24 6 L26 13 L22 13 Z" fill="#FFB25A" :transform="`rotate(${-80 + (i - 1) * 40} 24 30)`" />
      </g>
      <path d="M10 30 A14 14 0 0 1 38 30 Z" fill="#FFD93D" />
      <path d="M2 36 Q14 28 26 34 T46 32 V46 H2 Z" fill="#7FE3A6" />
    </g>
    <g v-else-if="period === 'day'">
      <g class="rays spin">
        <path v-for="i in 10" :key="i" d="M24 1 L26.5 8 L21.5 8 Z" fill="#FFD93D" :transform="`rotate(${(i - 1) * 36} 24 24)`" />
      </g>
      <circle cx="24" cy="24" r="13" fill="#FFE45C" />
      <circle cx="20" cy="22" r="1.8" fill="#7A5A00" /><circle cx="28" cy="22" r="1.8" fill="#7A5A00" />
      <path d="M19.5 27 Q24 31 28.5 27" stroke="#7A5A00" stroke-width="1.8" fill="none" stroke-linecap="round" />
    </g>
    <g v-else>
      <path d="M10 32 A14 14 0 0 1 38 32 Z" fill="#FF9D7A" />
      <path d="M4 36 H44 M10 41 H38" stroke="#D6457C" stroke-width="2.6" stroke-linecap="round" opacity=".7" />
      <path d="M30 10 Q33 7 36 10 Q39 7 42 10" stroke="#7B3FD1" stroke-width="1.8" fill="none" stroke-linecap="round" />
    </g>
  </svg>
</template>

<style scoped>
.sky { width: 100%; height: 100%; display: block; overflow: visible; }
.spin { transform-origin: 24px 24px; animation: sky-spin 40s linear infinite; }
@keyframes sky-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
</style>
