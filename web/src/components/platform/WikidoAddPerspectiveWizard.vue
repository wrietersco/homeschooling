<script setup>
// "＋ Add a perspective" — a guided, four-step wizard for a total beginner:
//   1 Pick a perspective (big recommended cards, ranked for this scene)
//   2 Preview what it will create (the spots, written but not saved)
//   3 Making it (spots & cards → artwork → voice, with Retry)
//   4 What's next (checklist + one-click next steps)
// Like the other wizards it owns NO data: the studio passes callbacks that go
// through its guarded paths, and the making itself runs in the studio's lens
// queue (so closing the window never stops it).
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { PERSPECTIVE_GROUPS, rankPerspectives, sceneKind, sceneLenses, perspectiveById } from "../../../../functions/lib/wikidoPerspectives.js";
import { LENS_STAGES, STAGE_NAMES, jobActive, jobDone, jobFailed, lensChecklist } from "@/lib/wikido/perspectiveJobs";
import { friendlyError } from "@/lib/wikido/placeWizard";

const props = defineProps({
  pack: { type: Object, required: true },
  sceneId: { type: String, required: true },       // the BASE scene
  topicStatus: { type: String, default: "draft" },
  isDirty: { type: Boolean, default: false },
  jobs: { type: Array, default: () => [] },         // the studio's live lens jobs
  preview: { type: Function, required: true },      // (lens, focus) → Promise<scene>
  start: { type: Function, required: true },        // (lens, draft, focus) → job
  retry: { type: Function, required: true },        // (jobKey)
  publish: { type: Function, required: true },      // () → Promise<string|null>
  goTo: { type: Function, default: () => {} },      // (sceneId)
});
const emit = defineEmits(["close"]);

const STEPS = ["pick", "preview", "make", "next"];
const TITLES = { pick: "Pick a perspective", preview: "Check what it will make", make: "Making your perspective", next: "What's next" };
const HELP = {
  pick: "A perspective shows the same place or topic in a new way — its history, its food, its buildings… Each one gets its own picture, spots and voice.",
  preview: "These are the spots children will tap. Nothing is saved yet — you can ask for a different version.",
  make: "The studio writes the cards, paints the picture and records the voice. You can close this window — it keeps going.",
  next: "Your perspective exists. Here is what is done and what is left.",
};

const stepIdx = ref(0);
const stepId = computed(() => STEPS[stepIdx.value]);
const base = computed(() => props.pack.scenes[props.sceneId]);
const kind = computed(() => sceneKind(props.pack, props.sceneId));
const kindWord = computed(() => ({ country: "a country", region: "a region", city: "a city", landmark: "a landmark", topic: "a topic" })[kind.value]);
const have = computed(() => new Map(sceneLenses(props.pack.scenes, props.sceneId).map((l) => [l.id, l.sceneId])));
const ranked = computed(() => rankPerspectives(kind.value));
const showAll = ref(false);
const recommended = computed(() => ranked.value.filter((x) => x.suits).slice(0, 9));
const groups = computed(() => PERSPECTIVE_GROUPS.map((g) => ({ ...g, items: ranked.value.filter((x) => x.group === g.id) })).filter((g) => g.items.length));
const picked = ref("");
const focus = ref("");
const lens = computed(() => perspectiveById(picked.value));
const draft = ref(null);
const previewBusy = ref(false);
const err = ref("");
const jobKey = ref("");
const job = computed(() => props.jobs.find((j) => j.key === jobKey.value) || null);
const lensSceneId = computed(() => job.value?.sceneId || "");
const check = computed(() => (lensSceneId.value ? lensChecklist(props.pack, lensSceneId.value, props.topicStatus) : null));
const extraBusy = ref("");
const extraNote = ref("");
const dialogEl = ref(null);

onMounted(async () => { await nextTick(); dialogEl.value?.focus(); });

function pick(id) {
  if (have.value.has(id)) return;
  if (picked.value !== id) draft.value = null;
  picked.value = id;
  err.value = "";
}
async function makePreview() {
  if (previewBusy.value) return;
  previewBusy.value = true;
  err.value = "";
  try {
    draft.value = await props.preview(picked.value, focus.value.trim());
  } catch (e) {
    err.value = friendlyError(e, "The preview could not be written. Press “Write the preview” again.");
  } finally {
    previewBusy.value = false;
  }
}
watch(stepId, (id) => {
  nextTick(() => dialogEl.value?.querySelector(".wz-body")?.scrollTo?.(0, 0));
  if (id === "preview" && !draft.value) makePreview();
  if (id === "make" && !jobKey.value) jobKey.value = props.start(picked.value, draft.value, focus.value.trim())?.key || "";
});

const nextBlock = computed(() => {
  switch (stepId.value) {
    case "pick": return picked.value ? "" : "Tap the perspective you want.";
    case "preview": return previewBusy.value ? "Writing the preview…" : draft.value ? "" : "The preview is not ready — press “Write the preview”.";
    case "make":
      if (!job.value) return "Starting…";
      if (job.value.stages.write === "failed") return "The spots could not be written — press Try again.";
      if (jobActive(job.value) || !jobDone(job.value) && !jobFailed(job.value)) return "Working — one moment…";
      return "";
    default: return "";
  }
});
const isLast = computed(() => stepId.value === "next");
const nextLabel = computed(() => (stepId.value === "preview" ? "Make it →" : isLast.value ? "Finish" : "Next →"));
const canBack = computed(() => stepIdx.value > 0 && !previewBusy.value && stepId.value !== "make" && !isLast.value);
function next() {
  if (nextBlock.value) return;
  err.value = "";
  if (isLast.value) { emit("close"); return; }
  stepIdx.value += 1;
}
function back() { if (canBack.value) { err.value = ""; stepIdx.value -= 1; } }
function addAnother() {
  picked.value = ""; focus.value = ""; draft.value = null; jobKey.value = ""; extraNote.value = ""; stepIdx.value = 0;
}
function onKey(e) {
  if (e.key === "Escape" && !previewBusy.value) emit("close");
}
async function publishNow() {
  extraBusy.value = "publish";
  extraNote.value = "";
  try {
    const problem = await props.publish();
    extraNote.value = problem || "Published — families can open it now.";
  } finally {
    extraBusy.value = "";
  }
}
function openInEditor() {
  if (lensSceneId.value) props.goTo(lensSceneId.value);
  emit("close");
}
const stageMark = { idle: "○", running: "⏳", done: "✓", failed: "✗" };
</script>

<template>
  <Teleport to="body">
    <div class="wz-back" @click.self="!previewBusy && emit('close')">
      <div ref="dialogEl" class="wz" role="dialog" aria-modal="true" aria-labelledby="lens-wz-title" tabindex="-1" @keydown="onKey">
        <header class="wz-head">
          <div>
            <p class="wz-eyebrow">Add a perspective · {{ base?.title }}</p>
            <h2 id="lens-wz-title">{{ TITLES[stepId] }}</h2>
          </div>
          <button type="button" class="wz-x" aria-label="Close" :disabled="previewBusy" @click="emit('close')">✕</button>
        </header>
        <div class="wz-progress" role="group" :aria-label="`Step ${stepIdx + 1} of ${STEPS.length}`">
          <p class="wz-count">Step {{ stepIdx + 1 }} of {{ STEPS.length }}</p>
          <ol class="wz-dots" aria-hidden="true">
            <li v-for="(s, i) in STEPS" :key="s" :class="{ done: i < stepIdx, now: i === stepIdx }"></li>
          </ol>
        </div>

        <div class="wz-body">
          <p class="wz-help">{{ HELP[stepId] }}</p>

          <!-- 1 · pick -->
          <section v-if="stepId === 'pick'">
            <p class="wz-muted">“{{ base?.title }}” is {{ kindWord }}, so these fit best:</p>
            <div class="lens-grid" role="listbox" aria-label="Recommended perspectives">
              <button
                v-for="x in recommended"
                :key="x.id"
                type="button"
                role="option"
                class="lens-card"
                :class="{ picked: picked === x.id, taken: have.has(x.id) }"
                :aria-selected="picked === x.id"
                :aria-disabled="have.has(x.id)"
                :style="{ '--lens': x.color }"
                @click="pick(x.id)"
              >
                <span class="lens-emoji" aria-hidden="true">{{ x.emoji }}</span>
                <strong>{{ x.name }}</strong>
                <small>{{ x.description }}</small>
                <em v-if="have.has(x.id)" class="lens-have">✓ Already added</em>
              </button>
            </div>
            <button type="button" class="wz-chip wz-more" :aria-expanded="showAll" @click="showAll = !showAll">
              {{ showAll ? "Hide the full list" : `Show all ${ranked.length} perspectives` }}
            </button>
            <div v-if="showAll" class="lens-all">
              <div v-for="g in groups" :key="g.id">
                <p class="lens-group">{{ g.name }}</p>
                <div class="wz-chips">
                  <button
                    v-for="x in g.items"
                    :key="x.id"
                    type="button"
                    class="wz-chip"
                    :class="{ on: picked === x.id }"
                    :disabled="have.has(x.id)"
                    :title="x.description"
                    @click="pick(x.id)"
                  >{{ x.emoji }} {{ x.name }}{{ have.has(x.id) ? " ✓" : "" }}</button>
                </div>
              </div>
            </div>
            <label v-if="picked" class="wz-field">Anything special it should show? <span class="wz-opt">optional</span>
              <input v-model="focus" type="text" class="wz-input" maxlength="200" :placeholder="`e.g. ${lens?.id === 'food' ? 'street food in Lahore' : 'the Mughal times'}`" />
            </label>
          </section>

          <!-- 2 · preview -->
          <section v-else-if="stepId === 'preview'">
            <p class="wz-chosen" :style="{ '--lens': lens?.color }">{{ lens?.emoji }} {{ lens?.name }} — {{ lens?.description }}</p>
            <div v-if="previewBusy" class="wz-working" role="status" aria-live="polite">
              <span class="wz-spinner" aria-hidden="true"></span>
              <div><strong>Writing the preview…</strong><small>Thinking up spots that show “{{ base?.title }}” through {{ lens?.name }} (about 20 seconds).</small></div>
            </div>
            <template v-else-if="draft">
              <dl class="wz-sum">
                <dt>Title</dt><dd>{{ draft.title }}</dd>
                <dt>Read aloud</dt><dd>{{ draft.narration }}</dd>
                <dt>{{ draft.hotspots.length }} spots</dt>
                <dd>
                  <ol class="lens-spots">
                    <li v-for="h in draft.hotspots" :key="h.id"><strong>{{ h.label }}</strong> — <span>{{ h.blurb }}</span></li>
                  </ol>
                </dd>
                <dt>Picture</dt><dd class="wz-muted">{{ lens?.art }}</dd>
              </dl>
              <button type="button" class="btn" :disabled="previewBusy" @click="makePreview">↻ Write a different version</button>
            </template>
            <button v-else type="button" class="btn primary" @click="makePreview">Write the preview</button>
          </section>

          <!-- 3 · make -->
          <section v-else-if="stepId === 'make'">
            <ul v-if="job" class="wz-steps" aria-live="polite">
              <li v-for="s in LENS_STAGES" :key="s" :class="job.stages[s] === 'done' ? 'ok' : job.stages[s] === 'failed' ? 'todo' : ''">
                <span class="wz-mark" aria-hidden="true">{{ stageMark[job.stages[s]] }}</span>
                <div>
                  <strong>{{ STAGE_NAMES[s] }}</strong>
                  <small v-if="job.stages[s] === 'running'">{{ job.note || "Working…" }}</small>
                  <small v-else-if="job.errors[s]" class="lens-err">{{ job.errors[s] }}</small>
                  <small v-else-if="job.stages[s] === 'done'">Done</small>
                  <small v-else>Waiting</small>
                </div>
              </li>
            </ul>
            <div v-if="job && jobFailed(job) && !jobActive(job)" class="wz-actions-col">
              <button type="button" class="btn primary" @click="retry(job.key)">↻ Try again (only what failed)</button>
              <small class="wz-muted">Nothing that worked is lost. Artwork or voice can also be retried later from the scene's perspective strip.</small>
            </div>
            <p v-if="job && jobDone(job)" class="wz-ok">🎉 The {{ lens?.name }} perspective is ready.</p>
          </section>

          <!-- 4 · next -->
          <section v-else-if="stepId === 'next'">
            <p class="wz-banner" :class="check?.exists ? 'good' : 'wait'">
              <template v-if="check?.exists">🎉 “{{ base?.title }}” now has a {{ check.name }} perspective.</template>
              <template v-else>That perspective is no longer in this world. Close this and check the scene.</template>
            </p>
            <ul v-if="check" class="wz-steps" aria-label="Progress of the new perspective">
              <li v-for="r in check.rows" :key="r.key" :class="r.ok ? 'ok' : 'todo'">
                <span class="wz-mark" aria-hidden="true">{{ r.ok ? "✓" : "✗" }}</span>
                <div><strong>{{ r.name }}</strong><small>{{ r.note }}</small></div>
                <template v-if="!r.ok">
                  <button v-if="(r.key === 'artwork' || r.key === 'voice') && job && jobFailed(job)" type="button" class="btn" :disabled="jobActive(job)" @click="retry(job.key)">↻ Try again</button>
                  <button v-else-if="r.key === 'published'" type="button" class="btn primary" :disabled="!!extraBusy || isDirty" @click="publishNow">{{ extraBusy === "publish" ? "Publishing…" : "Publish" }}</button>
                </template>
              </li>
            </ul>
            <p class="wz-muted"><strong>Saving:</strong> done — it is in your draft. Children see it as a big button on the “{{ base?.title }}” picture once it has its artwork<template v-if="topicStatus !== 'published'"> and the world is published</template>.</p>
            <button type="button" class="btn" @click="openInEditor">✏️ Open it in the editor</button>
          </section>

          <p v-if="err" class="wz-error" role="alert">{{ err }}</p>
          <p v-if="extraNote" class="wz-ok-note" role="status">{{ extraNote }}</p>
        </div>

        <footer class="wz-foot">
          <button v-if="!isLast" type="button" class="btn" :disabled="!canBack" @click="back">← Back</button>
          <button v-else type="button" class="btn" @click="addAnother">＋ Add another perspective</button>
          <div class="wz-next">
            <small v-if="nextBlock" class="wz-reason">{{ nextBlock }}</small>
            <button type="button" class="btn primary" :disabled="!!nextBlock" @click="next">{{ nextLabel }}</button>
          </div>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.wz-back { position: fixed; inset: 0; background: rgba(17, 24, 39, 0.55); display: grid; place-items: center; z-index: 60; padding: 1rem; }
.wz { background: #fff; border-radius: 18px; width: 100%; max-width: 720px; max-height: calc(100vh - 2rem); display: flex; flex-direction: column; outline: none; box-shadow: 0 24px 60px rgba(0, 0, 0, 0.3); }
.wz-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; padding: 1.1rem 1.4rem 0.4rem; }
.wz-eyebrow { margin: 0; font-size: 0.72rem; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
.wz-head h2 { margin: 0.1rem 0 0; font-size: 1.4rem; }
.wz .btn:disabled { opacity: 0.45; cursor: not-allowed; }
.wz-x { border: none; background: transparent; font-size: 1.1rem; cursor: pointer; color: var(--muted); padding: 0.2rem 0.4rem; border-radius: 8px; }
.wz-progress { padding: 0 1.4rem; display: flex; align-items: center; gap: 0.9rem; }
.wz-count { margin: 0; font-size: 0.82rem; font-weight: 800; color: var(--primary); white-space: nowrap; }
.wz-dots { list-style: none; margin: 0; padding: 0; display: flex; gap: 0.35rem; flex: 1; }
.wz-dots li { flex: 1; height: 6px; border-radius: 3px; background: #E5E7EB; }
.wz-dots li.done { background: #C4B5FD; }
.wz-dots li.now { background: var(--primary); }
.wz-body { padding: 0.8rem 1.4rem 0.4rem; overflow-y: auto; display: flex; flex-direction: column; gap: 0.7rem; min-height: 300px; }
.wz-body > section { display: flex; flex-direction: column; gap: 0.7rem; }
.wz-help { margin: 0; font-size: 0.95rem; color: var(--text2); }
.wz-muted { margin: 0; font-size: 0.85rem; color: var(--muted); }
.wz-foot { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 0.75rem; padding: 0.9rem 1.4rem 1.1rem; border-top: 1px solid var(--border); }
.wz-next { display: flex; align-items: center; gap: 0.75rem; justify-content: flex-end; flex: 1; }
.wz-reason { color: var(--muted); font-size: 0.78rem; text-align: right; }
.wz-input { width: 100%; padding: 0.55rem 0.7rem; border: 1.5px solid var(--border); border-radius: 10px; font-family: inherit; font-size: 0.95rem; }
.wz-field { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.85rem; font-weight: 700; color: var(--text2); }
.wz-opt { font-weight: 600; color: var(--muted); font-size: 0.74rem; }
.wz-chosen { margin: 0; padding: 0.55rem 0.8rem; border-radius: 12px; background: var(--primary-soft); border-left: 5px solid var(--lens, var(--primary)); font-weight: 700; font-size: 0.9rem; }
.wz-chips { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.wz-chip { border: 1.5px solid var(--border); border-radius: 999px; background: #fff; padding: 0.3rem 0.75rem; font-family: inherit; font-size: 0.84rem; cursor: pointer; min-height: 36px; }
.wz-chip:hover:not(:disabled) { border-color: var(--primary); background: var(--primary-soft); }
.wz-chip.on { border-color: var(--primary); background: var(--primary-soft); font-weight: 800; }
.wz-chip:disabled { color: #9CA3AF; cursor: not-allowed; }
.wz-more { align-self: flex-start; }

.lens-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.6rem; }
.lens-card { position: relative; display: flex; flex-direction: column; align-items: flex-start; gap: 0.2rem; text-align: left; padding: 0.75rem 0.8rem 0.8rem; min-height: 118px; border: 2px solid var(--border); border-top: 6px solid var(--lens); border-radius: 14px; background: #fff; cursor: pointer; font-family: inherit; transition: transform 0.12s, box-shadow 0.12s; }
.lens-card:hover:not(.taken) { transform: translateY(-2px); box-shadow: 0 6px 16px rgba(0, 0, 0, 0.08); }
.lens-card.picked { border-color: var(--lens); background: color-mix(in srgb, var(--lens) 9%, #fff); box-shadow: 0 0 0 3px color-mix(in srgb, var(--lens) 30%, transparent); }
.lens-card.taken { opacity: 0.55; cursor: not-allowed; }
.lens-emoji { font-size: 1.9rem; line-height: 1; }
.lens-card strong { font-size: 1rem; }
.lens-card small { color: var(--muted); font-size: 0.78rem; line-height: 1.3; }
.lens-have { position: absolute; top: 0.45rem; right: 0.55rem; font-style: normal; font-size: 0.72rem; font-weight: 800; color: #15803D; }
.lens-all { display: flex; flex-direction: column; gap: 0.5rem; }
.lens-group { margin: 0.2rem 0 0.25rem; font-size: 0.74rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
.lens-spots { margin: 0; padding-left: 1.2rem; display: flex; flex-direction: column; gap: 0.2rem; font-weight: 500; }
.lens-spots span { color: var(--text2); }
.lens-err { color: #991B1B !important; }

.wz-sum { margin: 0; display: grid; grid-template-columns: 7.5rem 1fr; gap: 0.45rem 0.9rem; font-size: 0.92rem; }
.wz-sum dt { font-weight: 800; color: var(--muted); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.03em; padding-top: 0.15rem; }
.wz-sum dd { margin: 0; color: var(--text); font-weight: 600; }
.wz-working { display: flex; gap: 0.9rem; align-items: center; padding: 1rem; border-radius: 14px; background: var(--primary-soft); }
.wz-working small { display: block; color: var(--muted); }
.wz-spinner { width: 28px; height: 28px; border-radius: 50%; border: 4px solid #DDD6FE; border-top-color: var(--primary); animation: wz-spin 0.9s linear infinite; flex: none; }
@keyframes wz-spin { to { transform: rotate(360deg); } }
.wz-actions-col { display: flex; flex-direction: column; gap: 0.6rem; align-items: stretch; }
.wz-ok { margin: 0; padding: 0.8rem 1rem; border-radius: 12px; background: #DCFCE7; color: #14532D; font-weight: 700; }
.wz-banner { margin: 0; padding: 0.9rem 1rem; border-radius: 14px; font-weight: 700; }
.wz-banner.good { background: #DCFCE7; color: #14532D; }
.wz-banner.wait { background: #FEF9C3; color: #713F12; }
.wz-steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.45rem; }
.wz-steps li { display: flex; align-items: center; gap: 0.7rem; padding: 0.55rem 0.8rem; border: 1.5px solid var(--border); border-radius: 12px; }
.wz-steps li > div { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.wz-steps small { color: var(--muted); font-size: 0.78rem; }
.wz-steps li.ok { background: #F0FDF4; border-color: #BBF7D0; }
.wz-steps li.todo { background: #FEFCE8; border-color: #FDE68A; }
.wz-mark { font-weight: 900; width: 1.2rem; text-align: center; }
.wz-error { margin: 0; padding: 0.6rem 0.8rem; border-radius: 10px; background: #FEE2E2; color: #991B1B; font-size: 0.9rem; }
.wz-ok-note { margin: 0; color: #14532D; font-weight: 700; font-size: 0.88rem; }
@media (max-width: 640px) { .lens-grid { grid-template-columns: repeat(2, 1fr); } .wz-sum { grid-template-columns: 1fr; } }
@media (max-width: 400px) { .lens-grid { grid-template-columns: 1fr; } }
</style>
