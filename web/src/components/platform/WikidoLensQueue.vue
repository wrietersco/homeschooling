<script setup>
// "Making perspectives" tray: every lens the studio is making in the
// background, each with its three stages (spots & cards → artwork → voice),
// live notes, and Retry for whatever failed. Collapsible; stays out of the way.
import { computed, ref } from "vue";
import { perspectiveById } from "../../../../functions/lib/wikidoPerspectives.js";
import { LENS_STAGES, STAGE_NAMES, jobActive, jobDone, jobFailed, queueProgress } from "@/lib/wikido/perspectiveJobs";

const props = defineProps({
  pack: { type: Object, required: true },
  jobs: { type: Array, required: true },
  auto: { type: Boolean, default: true },
});
const emit = defineEmits(["retry", "retry-all", "clear", "select"]);
const open = ref(true);
const progress = computed(() => queueProgress(props.jobs));
const anyFailed = computed(() => props.jobs.some((j) => jobFailed(j) && !jobActive(j)));
const anyFinished = computed(() => props.jobs.some((j) => jobDone(j) || (jobFailed(j) && !jobActive(j))));
const working = computed(() => props.jobs.some((j) => jobActive(j) || (!jobDone(j) && !jobFailed(j))));
const title = (j) => `${props.pack.scenes[j.baseId]?.title || j.baseId} · ${perspectiveById(j.lens)?.name || j.lens}`;
const mark = { idle: "○", running: "⏳", done: "✓", failed: "✗" };
</script>

<template>
  <aside class="lens-queue" :class="{ closed: !open }" aria-label="Making perspectives">
    <button type="button" class="head" :aria-expanded="open" @click="open = !open">
      <span>🔭 Making perspectives</span>
      <span class="count">{{ progress.finished }}/{{ progress.jobs }} done<template v-if="progress.failed"> · {{ progress.failed }} failed</template></span>
      <span class="bar" aria-hidden="true"><span :style="{ width: `${progress.total ? (100 * progress.done) / progress.total : 0}%` }"></span></span>
    </button>
    <div v-if="open" class="body">
      <ul>
        <li v-for="j in jobs" :key="j.key" :class="{ failed: jobFailed(j) && !jobActive(j), done: jobDone(j) }">
          <button type="button" class="name" :disabled="!j.sceneId || !pack.scenes[j.sceneId]" @click="emit('select', j.sceneId)">
            {{ perspectiveById(j.lens)?.emoji }} {{ title(j) }}
          </button>
          <span class="stages">
            <span v-for="s in LENS_STAGES" :key="s" :class="j.stages[s]" :title="j.errors[s] || STAGE_NAMES[s]">{{ mark[j.stages[s]] }} {{ STAGE_NAMES[s] }}</span>
          </span>
          <small v-if="jobActive(j) && j.note" class="note">{{ j.note }}</small>
          <small v-for="s in LENS_STAGES.filter((x) => j.errors[x])" :key="`e-${s}`" class="err">{{ STAGE_NAMES[s] }}: {{ j.errors[s] }}</small>
          <button v-if="jobFailed(j) && !jobActive(j)" type="button" class="mini" @click="emit('retry', j.key)">↻ Try again</button>
        </li>
      </ul>
      <footer>
        <small v-if="working">Keep this tab open. You can keep editing — Save waits for the current step.</small>
        <button v-if="anyFailed" type="button" class="mini" @click="emit('retry-all')">↻ Retry all that failed</button>
        <button v-if="anyFinished" type="button" class="mini" @click="emit('clear')">Clear finished</button>
      </footer>
    </div>
  </aside>
</template>

<style scoped>
.lens-queue { position: fixed; left: 1rem; bottom: 1rem; z-index: 55; width: min(380px, calc(100vw - 2rem)); background: #fff; border: 1.5px solid var(--border); border-radius: 14px; box-shadow: 0 12px 30px rgba(0, 0, 0, 0.18); font-size: 0.85rem; }
.head { display: grid; grid-template-columns: 1fr auto; gap: 0.25rem 0.6rem; width: 100%; padding: 0.6rem 0.8rem; border: none; background: transparent; cursor: pointer; text-align: left; font-family: inherit; font-weight: 800; }
.count { color: var(--muted); font-weight: 700; }
.bar { grid-column: span 2; height: 6px; border-radius: 3px; background: #EDE9FE; overflow: hidden; }
.bar span { display: block; height: 100%; background: var(--primary); transition: width 0.4s; }
.body { border-top: 1px solid var(--border); max-height: 45vh; overflow-y: auto; padding: 0.4rem 0.8rem 0.6rem; }
ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.45rem; }
li { display: flex; flex-direction: column; gap: 0.15rem; padding-bottom: 0.4rem; border-bottom: 1px dashed #EEE; }
li.done .name { color: #14532D; }
.name { border: none; background: transparent; padding: 0; text-align: left; font-family: inherit; font-weight: 800; cursor: pointer; }
.name:disabled { cursor: default; color: inherit; }
.stages { display: flex; flex-wrap: wrap; gap: 0.5rem; font-size: 0.76rem; color: var(--muted); }
.stages .done { color: #15803D; }
.stages .running { color: var(--primary); font-weight: 700; }
.stages .failed { color: #B91C1C; font-weight: 700; }
.note { color: var(--primary); }
.err { color: #991B1B; }
.mini { align-self: flex-start; border: 1px solid var(--border); background: #fff; border-radius: 8px; font-size: 0.76rem; padding: 0.2rem 0.55rem; cursor: pointer; font-family: inherit; }
footer { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; padding-top: 0.5rem; }
footer small { color: var(--muted); flex-basis: 100%; }
</style>
