<script setup>
// One "adventure portal" on the Home world map — a chunky candy button-card.
// Hard offset shadow makes it feel like a physical game tile: it lifts on
// hover and presses down on tap. The SVG scene art is passed as a slot.
import { RouterLink } from "vue-router";

defineProps({
  to: { type: String, required: true },
  title: { type: String, required: true },
  kid: { type: String, required: true }, // kid-facing tagline chip
  sub: { type: String, required: true }, // parent-facing one-liner
  tint: { type: String, required: true }, // pastel body color
  ink: { type: String, required: true }, // dark accent (title/shadow family)
  shade: { type: String, required: true }, // hard "3D" shadow color
  tilt: { type: Number, default: 0 }, // resting rotation, deg
  delay: { type: Number, default: 0 }, // pop-in stagger, ms
});
</script>

<template>
  <RouterLink
    class="portal"
    :to="to"
    :style="{ '--tint': tint, '--ink': ink, '--shade': shade, '--tilt': tilt + 'deg', '--delay': delay + 'ms' }"
  >
    <div class="medal">
      <div class="art"><slot /></div>
    </div>
    <h3 class="p-title">{{ title }}</h3>
    <span class="kid-chip">
      <span class="material-symbols-rounded">star</span>
      {{ kid }}
    </span>
    <p class="p-sub">{{ sub }}</p>
  </RouterLink>
</template>

<style scoped>
.portal {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 1.1rem 0.9rem 1.05rem;
  border-radius: 30px;
  text-decoration: none;
  background: linear-gradient(165deg, color-mix(in srgb, var(--tint) 45%, #fff), var(--tint));
  border: 4px solid #fff;
  box-shadow: 0 10px 0 var(--shade), 0 24px 36px rgba(59, 7, 100, 0.13);
  transform: rotate(var(--tilt));
  transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.35s;
  animation: portal-pop 0.65s cubic-bezier(0.34, 1.56, 0.64, 1) both;
  animation-delay: var(--delay);
}
.portal:hover {
  transform: translateY(-9px) rotate(0deg) scale(1.04);
  box-shadow: 0 17px 0 var(--shade), 0 32px 46px rgba(59, 7, 100, 0.18);
}
.portal:active {
  transform: translateY(3px) scale(0.985);
  box-shadow: 0 5px 0 var(--shade), 0 10px 16px rgba(59, 7, 100, 0.15);
  transition-duration: 0.08s;
}

@keyframes portal-pop {
  from { transform: translateY(44px) scale(0.55) rotate(var(--tilt)); opacity: 0; }
  62% { transform: translateY(-7px) scale(1.06) rotate(var(--tilt)); opacity: 1; }
  to { transform: translateY(0) scale(1) rotate(var(--tilt)); opacity: 1; }
}

.medal {
  width: 106px;
  height: 106px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: radial-gradient(circle at 30% 26%, #ffffff, color-mix(in srgb, var(--tint) 55%, #fff));
  border: 3px solid rgba(255, 255, 255, 0.9);
  box-shadow: inset 0 -7px 12px rgba(59, 7, 100, 0.07), 0 4px 10px rgba(59, 7, 100, 0.08);
}
.art { width: 82px; height: 82px; }
.art :deep(svg) { width: 100%; height: 100%; display: block; }

.p-title {
  margin: 0.6rem 0 0.12rem;
  font-family: "Baloo 2", system-ui, sans-serif;
  font-weight: 800;
  font-size: 1.22rem;
  letter-spacing: 0.3px;
  text-align: center;
  color: var(--ink);
  line-height: 1.1;
}

.kid-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.22rem;
  background: rgba(255, 255, 255, 0.85);
  color: var(--ink);
  font-weight: 700;
  font-size: 0.72rem;
  padding: 0.16rem 0.6rem;
  border-radius: 999px;
  white-space: nowrap;
}
.kid-chip .material-symbols-rounded { font-size: 14px; color: #FFB800; }

.p-sub {
  margin: 0.4rem 0 0;
  font-size: 0.78rem;
  line-height: 1.45;
  text-align: center;
  color: color-mix(in srgb, var(--ink) 82%, #333);
  min-height: 2.9em;
}

@media (prefers-reduced-motion: reduce) {
  .portal { animation: none; transition: none; }
}
</style>
