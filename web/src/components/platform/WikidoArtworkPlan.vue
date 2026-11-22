<script setup>
// "What the artwork will include": a short read-only list of what Generate /
// Regenerate artwork will paint for each spot (spot → visual subject → where),
// plus one edit field per spot for the visual subject. The prompt itself is
// built from the same module (functions/lib/wikidoSpotArt.js), so this preview
// matches what the painter is told.
import { computed } from "vue";
import { describeSpots } from "../../../../functions/lib/wikidoSpotArt.js";

const props = defineProps({
  scene: { type: Object, required: true },
  scenes: { type: Object, default: () => ({}) },
});

const rows = computed(() => describeSpots(props.scene, props.scenes));

function setVisual(id, value) {
  const spot = props.scene.hotspots?.find((h) => h.id === id);
  if (!spot) return;
  const v = String(value || "").trim().slice(0, 140);
  if (v) spot.visual = v;
  else delete spot.visual; // empty = back to the automatic subject
}
</script>

<template>
  <details v-if="rows.length" class="art-plan">
    <summary>What the artwork will include ({{ rows.length }} {{ rows.length === 1 ? "spot" : "spots" }})</summary>
    <ul>
      <li v-for="r in rows" :key="r.id">
        <span class="n">{{ r.n }}</span>
        <div class="body">
          <label>
            <span class="lbl">{{ r.label }}<em v-if="r.childTitle"> → {{ r.childTitle }}</em></span>
            <input
              type="text"
              maxlength="140"
              :value="r.stored ? r.visual : ''"
              :placeholder="r.visual"
              :aria-label="`Visual subject for spot ${r.n}: ${r.label}`"
              @change="setVisual(r.id, $event.target.value)"
            />
          </label>
          <span class="pos">{{ r.position }}</span>
        </div>
      </li>
    </ul>
    <p class="hint">Each subject is painted where its spot sits. Leave a field empty to use the automatic subject (abstract names like “India” get a landmark when the artwork is generated).</p>
  </details>
</template>

<style scoped>
.art-plan { margin: 8px 0; padding: 8px 12px; border: 1px solid #dcd7ee; border-radius: 10px; background: #fff; font-size: 0.85rem; }
.art-plan summary { cursor: pointer; font-weight: 600; }
.art-plan ul { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 8px; }
.art-plan li { display: flex; gap: 8px; align-items: flex-start; }
.n { flex: none; width: 22px; height: 22px; border-radius: 50%; background: #6d3ad8; color: #fff; display: grid; place-items: center; font-size: 0.75rem; font-weight: 700; }
.body { flex: 1; min-width: 0; display: grid; gap: 2px; }
.lbl { display: block; font-weight: 600; }
.lbl em { font-weight: 400; color: #6b6785; font-style: normal; }
.body input { width: 100%; box-sizing: border-box; padding: 4px 8px; border: 1px solid #cfcae6; border-radius: 6px; font: inherit; }
.pos { color: #6b6785; font-size: 0.78rem; }
.hint { margin: 8px 0 0; color: #6b6785; font-size: 0.78rem; }
</style>
