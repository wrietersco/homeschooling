<script setup>
// The OpenStreetMap credit shown whenever street tiles are on the globe.
// A real link (required by the OSM tile usage policy). The wrapper ignores
// pointer events so pin taps and drags pass through; only the link catches them.
import { TILE_ATTRIBUTION } from "@/lib/wikido/globe/tiles";
defineProps({
  show: { type: Boolean, default: false },
  below: { type: Boolean, default: false }, // sit under a top-left HUD (child view) instead of the corner
});
</script>

<template>
  <div v-if="show" class="osm-attr" :class="{ below }">
    <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">{{ TILE_ATTRIBUTION }}</a>
  </div>
</template>

<style scoped>
.osm-attr { position: absolute; left: 6px; top: 6px; z-index: 6; pointer-events: none; }
.osm-attr.below { top: 58px; }
.osm-attr a {
  pointer-events: auto; display: inline-block; font: 600 11px/1.3 system-ui, sans-serif;
  color: #334; background: rgba(255, 255, 255, 0.8); padding: 2px 6px; border-radius: 4px; text-decoration: none;
}
.osm-attr a:hover, .osm-attr a:focus-visible { text-decoration: underline; background: #fff; }
</style>
