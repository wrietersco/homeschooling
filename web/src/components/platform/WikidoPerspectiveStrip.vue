<script setup>
// One scene's perspectives at a glance: Overview + every lens, each with its
// spots / art / voice status. Click a lens-chip to edit that lens with the normal
// scene editor; "＋ Add a perspective" opens the guided wizard.
import { computed } from "vue";
import { sceneLenses } from "../../../../functions/lib/wikidoPerspectives.js";
import { lensStatus, jobActive, jobFailed, STAGE_NAMES, LENS_STAGES } from "@/lib/wikido/perspectiveJobs";

const props = defineProps({
  pack: { type: Object, required: true },
  sceneId: { type: String, required: true },
  jobs: { type: Array, default: () => [] },
});
const emit = defineEmits(["select", "add", "retry", "remove"]);

const lenses = computed(() => sceneLenses(props.pack.scenes, props.sceneId).map((l) => ({ ...l, st: lensStatus(l.scene) })));
const baseId = computed(() => lenses.value[0]?.sceneId || props.sceneId);
// lenses still being made for this scene (not yet a scene of their own)
const pending = computed(() => props.jobs.filter((j) => j.baseId === baseId.value && (!j.sceneId || !props.pack.scenes[j.sceneId])));
const jobFor = (sceneId) => props.jobs.find((j) => j.sceneId === sceneId) || null;
const stageText = (job) => LENS_STAGES.map((s) => `${STAGE_NAMES[s]}: ${job.stages[s]}`).join(" · ");
</script>

<template>
  <section class="lens-strip" aria-label="Perspectives of this scene">
    <header>
      <strong>🔭 Perspectives</strong>
      <small>Children switch between these with big buttons on the picture.</small>
    </header>
    <div class="lens-chips">
      <div
        v-for="l in lenses"
        :key="l.sceneId"
        class="lens-chip"
        :class="{ active: l.sceneId === sceneId, ready: l.st.ready || l.id === 'main' }"
        :style="{ '--lens': l.lens.color }"
      >
        <button type="button" class="lens-chip-main" :aria-pressed="l.sceneId === sceneId" :title="`Edit the ${l.lens.name} picture`" @click="emit('select', l.sceneId)">
          <span class="emoji" aria-hidden="true">{{ l.lens.emoji }}</span>
          <span class="name">{{ l.lens.name }}</span>
          <span class="marks">
            <span :class="l.st.spots ? 'ok' : 'no'" :title="`${l.st.spots} spots`">● {{ l.st.spots }}</span>
            <span :class="l.st.art ? 'ok' : 'no'" :title="l.st.art ? 'Artwork painted' : 'No artwork yet'">🎨{{ l.st.art ? "✓" : "✗" }}</span>
            <span :class="l.st.voice ? 'ok' : l.st.voiced ? 'part' : 'no'" :title="`${l.st.voiced} of ${l.st.clips} clips recorded`">🔊{{ l.st.voiced }}/{{ l.st.clips }}</span>
          </span>
        </button>
        <template v-if="jobFor(l.sceneId)">
          <span v-if="jobActive(jobFor(l.sceneId))" class="busy" :title="stageText(jobFor(l.sceneId))">⏳ {{ jobFor(l.sceneId).note || "Working…" }}</span>
          <button v-else-if="jobFailed(jobFor(l.sceneId))" type="button" class="mini" :title="stageText(jobFor(l.sceneId))" @click="emit('retry', jobFor(l.sceneId).key)">↻ Retry</button>
        </template>
        <button v-if="l.id !== 'main' && l.sceneId === sceneId" type="button" class="mini remove" :aria-label="`Remove the ${l.lens.name} perspective`" @click="emit('remove', l.sceneId)">Remove</button>
      </div>
      <div v-for="j in pending" :key="j.key" class="lens-chip pending">
        <span class="lens-chip-main">
          <span class="emoji">⏳</span>
          <span class="name">{{ j.lens }}</span>
          <span class="marks">{{ jobFailed(j) ? "failed" : j.note || "queued" }}</span>
        </span>
        <button v-if="jobFailed(j)" type="button" class="mini" @click="emit('retry', j.key)">↻ Retry</button>
      </div>
      <button type="button" class="add" @click="emit('add')">＋ Add a perspective</button>
    </div>
  </section>
</template>

<style scoped>
.lens-strip { border: 1.5px solid var(--border); border-radius: 14px; padding: 0.6rem 0.75rem; background: #FBFAFF; display: flex; flex-direction: column; gap: 0.45rem; }
header { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: baseline; }
header small { color: var(--muted); font-size: 0.78rem; }
.lens-chips { display: flex; flex-wrap: wrap; gap: 0.45rem; align-items: stretch; }
.lens-chip { display: flex; flex-direction: column; gap: 0.2rem; border: 2px solid var(--border); border-left: 5px solid var(--lens, #999); border-radius: 12px; background: #fff; padding: 0.25rem 0.35rem; min-width: 8.5rem; }
.lens-chip.active { border-color: var(--lens, var(--primary)); box-shadow: 0 0 0 2px color-mix(in srgb, var(--lens, #6d28d9) 25%, transparent); }
.lens-chip.pending { border-style: dashed; opacity: 0.8; }
.lens-chip-main { display: grid; grid-template-columns: auto 1fr; grid-template-rows: auto auto; column-gap: 0.4rem; align-items: center; border: none; background: transparent; cursor: pointer; text-align: left; font-family: inherit; padding: 0.1rem; }
.emoji { grid-row: span 2; font-size: 1.4rem; }
.name { font-weight: 800; font-size: 0.88rem; }
.marks { display: flex; gap: 0.35rem; font-size: 0.72rem; color: var(--muted); }
.marks .ok { color: #15803D; }
.marks .no { color: #B45309; }
.marks .part { color: #A16207; }
.busy { font-size: 0.72rem; color: var(--primary); }
.mini { border: 1px solid var(--border); background: #fff; border-radius: 8px; font-size: 0.72rem; padding: 0.1rem 0.4rem; cursor: pointer; font-family: inherit; }
.mini.remove { color: #991B1B; }
.add { border: 2px dashed var(--primary); color: var(--primary); background: #fff; border-radius: 12px; padding: 0.4rem 0.8rem; font-weight: 800; cursor: pointer; font-family: inherit; min-height: 44px; }
.add:hover { background: var(--primary-soft); }
</style>
