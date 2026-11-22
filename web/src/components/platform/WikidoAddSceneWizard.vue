<script setup>
// "Add a scene" — a guided, five-step wizard for a total beginner:
//   1 Where does it go?   2 What is it about?   3 Check and create
//   4 Writing your scene  5 What's next (checklist + one-click next steps)
// Like the Add-a-place wizard it owns NO data: every change goes through the
// callbacks the studio passes in (suggest / planOutline / createScene / adopt /
// paintArt / recordVoice / publish), so it reuses the studio's existing guarded
// generation paths. It only remembers scene ids — never scene objects — because
// adopting the server result reloads the whole form.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { countOutline, removeOutlineNode, retryFailedItems, runOutline, summarizeRun, withKeys } from "@/lib/wikido/outlineBuild";
import { friendlyError } from "@/lib/wikido/placeWizard";
import {
  CREATE_NOTES, FOCUS_EXAMPLES, MAX_SPOTS, MODES, NAME_EXAMPLES, SCENE_STEPS, SCENE_STEP_HELP, SCENE_STEP_TITLES,
  branchChecklist, parentChoices, sceneChecklist, scenePath, spotRoom, whatBlock,
} from "@/lib/wikido/sceneWizard";

const props = defineProps({
  pack: { type: Object, required: true },        // the studio's live (editable) topic
  topicStatus: { type: String, default: "draft" },
  start: { type: Object, default: () => ({}) },  // { parentId? }
  isDirty: { type: Boolean, default: false },
  suggest: { type: Function, required: true },     // (parentId) → Promise<{ suggestions }>
  planOutline: { type: Function, required: true }, // (parentId, total) → Promise<{ outline, trimmed }>
  createScene: { type: Function, required: true }, // ({ parentSceneId, label, focus }) → Promise<{ sceneId, title }>
  adopt: { type: Function, required: true },       // (sceneIdToSelect) → Promise — reload the studio from the server
  paintArt: { type: Function, required: true },    // (sceneId) → Promise<string|null error>
  recordVoice: { type: Function, required: true }, // (sceneId) → Promise<string|null error>
  publish: { type: Function, required: true },     // () → Promise<string|null error>
  goToScene: { type: Function, default: () => {} }, // (sceneId) — select it in the studio
});
const emit = defineEmits(["close"]);

// ── state ─────────────────────────────────────────────────────────────────────
const stepIdx = ref(0);
const parentId = ref(props.start?.parentId && props.pack?.scenes?.[props.start.parentId] ? props.start.parentId : ""); // preselected when opened from a card
const parentQuery = ref("");
const mode = ref("");            // ideas | type | branch
const label = ref("");
const focus = ref("");
const ideas = ref([]);           // [{ label, focus, why }]
const pickedIdea = ref(null);
const ideasBusy = ref(false);
const planSize = ref(6);
const outline = ref([]);
const planBusy = ref(false);
const planTrimmed = ref(false);
const createState = ref("idle"); // idle | running | done | failed
const items = ref([]);           // live per-scene status of a branch run
const createdIds = ref([]);
const stopRequested = ref(false);
const err = ref("");
const progressNote = ref("");
const extraBusy = ref("");       // art | voice | publish
const extraNote = ref("");
const dialogEl = ref(null);

const stepId = computed(() => SCENE_STEPS[stepIdx.value]);
const parent = computed(() => props.pack?.scenes?.[parentId.value] || null);
const parentPath = computed(() => (parent.value ? scenePath(props.pack, parentId.value) : []));
const room = computed(() => spotRoom(props.pack, parentId.value));
const choices = computed(() => parentChoices(props.pack, parentQuery.value));
const topLevel = computed(() => outline.value.length);
const total = computed(() => (mode.value === "branch" ? countOutline(outline.value) : 1));
const outlineRows = computed(() => {
  const rows = [];
  const walk = (nodes, depth) => nodes.forEach((n) => { rows.push({ node: n, depth }); walk(n.children, depth + 1); });
  walk(outline.value, 0);
  return rows;
});
const busy = computed(() => createState.value === "running" || ideasBusy.value || planBusy.value);

onMounted(async () => {
  await nextTick();
  dialogEl.value?.focus();
});

// ── step 1: where ─────────────────────────────────────────────────────────────
function pickParent(c) {
  if (c.full) return;
  if (parentId.value !== c.id) { ideas.value = []; pickedIdea.value = null; outline.value = []; }
  parentId.value = c.id;
}

// ── step 2: what ──────────────────────────────────────────────────────────────
function pickMode(id) {
  mode.value = id;
  err.value = "";
}
async function getIdeas() {
  if (ideasBusy.value) return;
  ideasBusy.value = true;
  err.value = "";
  try {
    const res = await props.suggest(parentId.value);
    ideas.value = res.suggestions || [];
    pickedIdea.value = null;
    if (!ideas.value.length) err.value = "The studio had no new ideas this time. Press “Get ideas” again, or choose “I'll type it”.";
  } catch (e) {
    err.value = friendlyError(e, "Could not get ideas. Please try again.");
  } finally {
    ideasBusy.value = false;
  }
}
function pickIdea(idea) {
  pickedIdea.value = idea;
  label.value = idea.label;
  focus.value = idea.focus || "";
}
async function draftOutline() {
  if (planBusy.value) return;
  planBusy.value = true;
  err.value = "";
  try {
    const res = await props.planOutline(parentId.value, planSize.value);
    outline.value = withKeys(res.outline);
    planTrimmed.value = Boolean(res.trimmed);
    if (!outline.value.length) err.value = "The studio could not plan scenes this time. Please try again.";
  } catch (e) {
    err.value = friendlyError(e, "Could not draft an outline. Please try again.");
  } finally {
    planBusy.value = false;
  }
}
const dropNode = (key) => { outline.value = removeOutlineNode(outline.value, key); };

// ── navigation ────────────────────────────────────────────────────────────────
const nextBlock = computed(() => {
  switch (stepId.value) {
    case "where":
      if (!parentId.value) return "Choose the scene it should open from.";
      return room.value ? "" : "That picture already has 8 spots. Choose another scene.";
    case "what":
      return whatBlock({
        mode: mode.value, label: label.value, focus: focus.value, picked: pickedIdea.value,
        outlineCount: countOutline(outline.value), room: room.value, topLevel: topLevel.value, busy: busy.value,
      });
    case "create":
      if (createState.value === "running") return "Writing — one moment…";
      return createState.value === "done" ? "" : "The scene is not written yet — press Try again.";
    default:
      return "";
  }
});
const isLast = computed(() => stepId.value === "next");
const nextLabel = computed(() => (stepId.value === "review" ? "Create it →" : isLast.value ? "Finish" : "Next →"));

// a finished scene is never written twice: no Back from a finished Create step
const canBack = computed(() => stepIdx.value > 0 && !busy.value && !isLast.value && !(stepId.value === "create" && createState.value === "done"));

function next() {
  if (nextBlock.value || busy.value) return;
  err.value = "";
  if (isLast.value) { emit("close"); return; }
  stepIdx.value += 1;
}
function back() {
  if (!canBack.value) return;
  err.value = "";
  stepIdx.value -= 1;
  // a failed attempt can be changed: forget it so Create starts fresh next time
  if (stepId.value === "review") { createState.value = "idle"; items.value = []; createdIds.value = []; }
}

// ── step 4: create ────────────────────────────────────────────────────────────
let noteTimer = null;
function startNotes() {
  let i = 0;
  progressNote.value = CREATE_NOTES[0];
  noteTimer = setInterval(() => {
    i = Math.min(i + 1, CREATE_NOTES.length - 1);
    progressNote.value = CREATE_NOTES[i];
  }, 6000);
}
function stopNotes() {
  clearInterval(noteTimer);
  noteTimer = null;
  progressNote.value = "";
}
onBeforeUnmount(stopNotes);

watch(stepId, (id) => {
  nextTick(() => dialogEl.value?.querySelector(".wz-body")?.scrollTo?.(0, 0));
  if (id === "create" && createState.value === "idle") runCreate();
});

async function runCreate() {
  if (createState.value === "running") return;
  createState.value = "running";
  stopRequested.value = false;
  err.value = "";
  startNotes();
  try {
    if (mode.value === "branch") {
      const run = await runOutline({
        outline: outline.value,
        parentSceneId: parentId.value,
        createScene: props.createScene,
        onUpdate: (list) => { items.value = list; },
        shouldStop: () => stopRequested.value,
      });
      items.value = run.items;
      createdIds.value = [...run.created];
      if (run.items.some((i) => i.status === "failed")) await retryBranch();
      await props.adopt(createdIds.value[0] || parentId.value);
      const sum = summarizeRun(items.value);
      if (!createdIds.value.length) {
        createState.value = "failed";
        err.value = friendlyError(items.value.find((i) => i.error)?.error, "No scene could be written. Please try again.");
      } else {
        createState.value = "done";
        if (sum.failed || sum.skipped) err.value = `${sum.failed + sum.skipped} of ${items.value.length} scenes were not created. You can try those again.`;
      }
    } else {
      const res = await props.createScene({ parentSceneId: parentId.value, label: label.value.trim(), focus: focus.value.trim() });
      createdIds.value = [res.sceneId];
      await props.adopt(res.sceneId);
      createState.value = "done";
    }
  } catch (e) {
    createState.value = "failed";
    err.value = friendlyError(e, "The scene could not be written. Nothing was lost — please try again.");
  } finally {
    stopNotes();
  }
}

async function retryBranch() {
  await retryFailedItems({
    items: items.value,
    createScene: props.createScene,
    rootParentSceneId: parentId.value,
    onUpdate: (list) => { items.value = list; },
  });
  createdIds.value = items.value.filter((i) => i.status === "done" && i.sceneId).map((i) => i.sceneId);
}

// "Try again": a branch only redoes its failed scenes; a single scene starts over
async function tryAgain() {
  if (createState.value === "running") return;
  if (mode.value === "branch" && createdIds.value.length) {
    createState.value = "running";
    err.value = "";
    startNotes();
    try {
      await retryBranch();
      await props.adopt(createdIds.value[0]);
      const sum = summarizeRun(items.value);
      createState.value = "done";
      err.value = sum.failed || sum.skipped ? `${sum.failed + sum.skipped} scenes still could not be created.` : "";
    } catch (e) {
      createState.value = "done";
      err.value = friendlyError(e);
    } finally {
      stopNotes();
    }
    return;
  }
  createState.value = "idle";
  items.value = [];
  createdIds.value = [];
  runCreate();
}

// ── step 5: what's next ───────────────────────────────────────────────────────
const firstId = computed(() => createdIds.value[0] || "");
const isBranch = computed(() => mode.value === "branch");
const check = computed(() => (firstId.value ? sceneChecklist(props.pack, firstId.value, props.topicStatus) : null));
const bcheck = computed(() => (isBranch.value ? branchChecklist(props.pack, createdIds.value, props.topicStatus) : null));
const newTitle = computed(() => props.pack?.scenes?.[firstId.value]?.title || label.value || "the new scene");

const rows = computed(() => {
  if (!check.value) return [];
  const b = bcheck.value;
  const n = createdIds.value.length;
  const one = !isBranch.value;
  return [
    { key: "scene", name: one ? "Scene written" : `Scenes written (${b.scenes} of ${n})`, ok: one ? check.value.scene : b.scenes === n, note: "Saved to your draft automatically." },
    { key: "artwork", name: one ? "Artwork" : `Artwork (${b.artwork} of ${n})`, ok: one ? check.value.artwork : b.artwork === n, note: "The picture children see." },
    { key: "voice", name: one ? "Voice" : `Voice (${b.voice} of ${n})`, ok: one ? check.value.voice : b.voice === n, note: "Optional — children can still read it." },
    { key: "spot", name: "Spot on the parent picture", ok: one ? check.value.spot : b.spots === n, note: `On “${parent.value?.title || "the parent"}”. You can nudge where it sits.` },
    { key: "published", name: "Published", ok: props.topicStatus === "published", note: props.topicStatus === "published" ? "This world is live for families." : "The world is still a draft — children cannot see it yet." },
  ];
});

async function runExtra(which, fn, doneNote) {
  if (extraBusy.value) return;
  extraBusy.value = which;
  extraNote.value = "";
  err.value = "";
  try {
    const problem = await fn();
    if (problem) err.value = problem;
    else extraNote.value = doneNote;
  } catch (e) {
    err.value = friendlyError(e);
  } finally {
    extraBusy.value = "";
  }
}
// every new scene, one after another; stops at the first problem
const eachScene = (fn, only) => async () => {
  for (const id of createdIds.value) {
    if (only && !only(id)) continue;
    const problem = await fn(id);
    if (problem) return problem;
  }
  return null;
};
const paint = () => runExtra("artwork", eachScene(props.paintArt, (id) => !sceneChecklist(props.pack, id).artwork), "Artwork painted.");
const record = () => runExtra("voice", eachScene(props.recordVoice, (id) => !sceneChecklist(props.pack, id).voice), "Voice recorded.");
const publishNow = () => runExtra("publish", () => props.publish(), "Published — families can now explore this world.");
function nudgeSpot() {
  props.goToScene(parentId.value);
  emit("close");
}

function addAnother() {
  mode.value = "";
  label.value = "";
  focus.value = "";
  ideas.value = [];
  pickedIdea.value = null;
  outline.value = [];
  items.value = [];
  createdIds.value = [];
  createState.value = "idle";
  err.value = "";
  extraNote.value = "";
  stepIdx.value = parentId.value ? 1 : 0;
}

function onKey(e) {
  if (e.key === "Escape" && !busy.value && !extraBusy.value) emit("close");
}

// the parent's picture with its existing pins, for the "where will it sit" preview
const parentArt = computed(() => (/^(https?:\/\/|\/wikido\/)/.test(String(parent.value?.image?.src || "")) ? parent.value.image.src : ""));
const parentPins = computed(() => (parent.value?.hotspots || []).map((h, i) => ({ n: i + 1, x: h.x, y: h.y, label: h.label })));
</script>

<template>
  <Teleport to="body">
    <div class="wz-back" @click.self="!busy && emit('close')">
      <div ref="dialogEl" class="wz" role="dialog" aria-modal="true" aria-labelledby="wz-title" tabindex="-1" @keydown="onKey">
        <header class="wz-head">
          <div>
            <p class="wz-eyebrow">Add a scene</p>
            <h2 id="wz-title">{{ SCENE_STEP_TITLES[stepId] }}</h2>
          </div>
          <button type="button" class="wz-x" aria-label="Close" :disabled="busy || !!extraBusy" @click="emit('close')">✕</button>
        </header>

        <div class="wz-progress" role="group" :aria-label="`Step ${stepIdx + 1} of ${SCENE_STEPS.length}`">
          <p class="wz-count">Step {{ stepIdx + 1 }} of {{ SCENE_STEPS.length }}</p>
          <ol class="wz-dots" aria-hidden="true">
            <li v-for="(s, i) in SCENE_STEPS" :key="s" :class="{ done: i < stepIdx, now: i === stepIdx }"></li>
          </ol>
        </div>

        <div class="wz-body">
          <p class="wz-help">{{ SCENE_STEP_HELP[stepId] }}</p>

          <!-- 1 · where -->
          <section v-if="stepId === 'where'">
            <p v-if="parent" class="wz-chosen">📍 <span>{{ parentPath.join(" › ") }}</span></p>
            <input v-model="parentQuery" type="search" class="wz-input" placeholder="Search scenes by name…" aria-label="Search parent scenes" />
            <ul class="wz-list" role="listbox" aria-label="Choose the parent scene">
              <li v-for="c in choices" :key="c.id">
                <button
                  type="button"
                  role="option"
                  class="wz-row wz-scene"
                  :class="{ picked: parentId === c.id, taken: c.full }"
                  :aria-selected="parentId === c.id"
                  :disabled="c.full"
                  @click="pickParent(c)"
                >
                  <span class="wz-scene-name" :style="{ paddingLeft: Math.min(c.depth, 5) * 0.9 + 'rem' }">
                    <strong>{{ c.title }}</strong>
                    <small v-if="c.path.length > 1">{{ c.path.slice(0, -1).join(" › ") }}</small>
                  </span>
                  <em v-if="c.full">picture full (8 spots)</em>
                  <em v-else>{{ c.room }} {{ c.room === 1 ? "spot" : "spots" }} free</em>
                </button>
              </li>
              <li v-if="!choices.length" class="wz-empty">No scene matches “{{ parentQuery }}”.</li>
            </ul>
          </section>

          <!-- 2 · what -->
          <section v-else-if="stepId === 'what'">
            <div class="wz-kinds wz-modes">
              <button
                v-for="m in MODES"
                :key="m.id"
                type="button"
                class="wz-kind"
                :class="{ picked: mode === m.id }"
                :aria-pressed="mode === m.id"
                @click="pickMode(m.id)"
              >
                <span class="wz-kind-emoji" aria-hidden="true">{{ m.emoji }}</span>
                <strong>{{ m.label }}</strong>
                <small>{{ m.help }}</small>
              </button>
            </div>

            <template v-if="mode === 'ideas'">
              <button type="button" class="btn primary wz-big" :disabled="ideasBusy" @click="getIdeas">
                {{ ideasBusy ? "Thinking of ideas…" : ideas.length ? "✨ Get different ideas" : "✨ Get ideas" }}
              </button>
              <div v-if="ideas.length" class="wz-ideas" role="listbox" aria-label="Scene ideas">
                <button
                  v-for="idea in ideas"
                  :key="idea.label"
                  type="button"
                  role="option"
                  class="wz-idea"
                  :class="{ picked: pickedIdea === idea }"
                  :aria-selected="pickedIdea === idea"
                  @click="pickIdea(idea)"
                >
                  <strong>{{ idea.label }}</strong>
                  <span>{{ idea.why || idea.focus }}</span>
                </button>
              </div>
              <template v-if="pickedIdea">
                <label class="wz-field">Name — change it if you like
                  <input v-model="label" type="text" class="wz-input" maxlength="80" />
                </label>
              </template>
            </template>

            <template v-else-if="mode === 'type'">
              <label class="wz-field">Scene name
                <input v-model="label" type="text" class="wz-input" maxlength="80" placeholder="e.g. Inside a Volcano" />
              </label>
              <div class="wz-chips" aria-label="Name examples">
                <button v-for="ex in NAME_EXAMPLES" :key="ex" type="button" class="wz-chip" @click="label = ex">{{ ex }}</button>
              </div>
              <label class="wz-field">What should it teach? <span class="wz-opt">optional</span>
                <input v-model="focus" type="text" class="wz-input" maxlength="200" placeholder="e.g. how lava is made" />
              </label>
              <div class="wz-chips" aria-label="Teaching examples">
                <button v-for="ex in FOCUS_EXAMPLES" :key="ex" type="button" class="wz-chip" @click="focus = ex">{{ ex }}</button>
              </div>
            </template>

            <template v-else-if="mode === 'branch'">
              <div class="wz-plan">
                <label class="wz-field inline">How many scenes?
                  <select v-model.number="planSize" class="wz-input" :disabled="planBusy">
                    <option :value="4">about 4</option>
                    <option :value="6">about 6</option>
                    <option :value="8">about 8</option>
                    <option :value="12">up to 12</option>
                  </select>
                </label>
                <button type="button" class="btn primary" :disabled="planBusy" @click="draftOutline">
                  {{ planBusy ? "Drafting…" : outline.length ? "✨ Draft a different outline" : "✨ Draft an outline" }}
                </button>
              </div>
              <div v-if="outline.length" class="wz-outline">
                <p class="wz-muted">Edit the names, or remove scenes you don't want. Nothing is created yet.</p>
                <div v-for="r in outlineRows" :key="r.node.key" class="wz-orow" :style="{ marginLeft: r.depth * 1.1 + 'rem' }">
                  <span aria-hidden="true">{{ r.depth ? "└" : "●" }}</span>
                  <div class="wz-ofields">
                    <input v-model="r.node.label" type="text" class="wz-input" aria-label="Scene name" maxlength="80" />
                    <small>{{ r.node.focus }}</small>
                  </div>
                  <button type="button" class="wz-chip" :aria-label="`Remove ${r.node.label}`" @click="dropNode(r.node.key)">Remove</button>
                </div>
                <p v-if="planTrimmed" class="wz-muted">The draft was trimmed to keep it a sensible size.</p>
              </div>
            </template>
          </section>

          <!-- 3 · review -->
          <section v-else-if="stepId === 'review'">
            <dl class="wz-sum">
              <dt>It will go under</dt>
              <dd>{{ parentPath.join(" › ") }}</dd>
              <template v-if="mode === 'branch'">
                <dt>New scenes ({{ total }})</dt>
                <dd>
                  <ul class="wz-tree">
                    <li v-for="r in outlineRows" :key="r.node.key" :style="{ marginLeft: r.depth * 1.1 + 'rem' }">{{ r.node.label }}</li>
                  </ul>
                </dd>
              </template>
              <template v-else>
                <dt>New scene</dt>
                <dd>{{ label.trim() || "The studio will choose a name" }}</dd>
                <template v-if="focus.trim()">
                  <dt>It will teach</dt>
                  <dd>{{ focus }}</dd>
                </template>
              </template>
              <dt>Its spot</dt>
              <dd>
                {{ mode === "branch" ? `${topLevel} new ${topLevel === 1 ? "spot" : "spots"}` : "A new spot" }} will appear on the picture of “{{ parent?.title }}”
                (it has {{ MAX_SPOTS - room }} of {{ MAX_SPOTS }} spots now). Tapping it opens the new scene.
              </dd>
            </dl>
            <div class="wz-mini" aria-label="The parent picture, with its current spots">
              <img v-if="parentArt" :src="parentArt" alt="" />
              <span v-else class="wz-mini-empty">No artwork on the parent yet — the spot is placed when it is painted.</span>
              <span v-for="p in parentPins" :key="p.n" class="wz-pin" :style="{ left: p.x + '%', top: p.y + '%' }" :title="p.label">{{ p.n }}</span>
              <span class="wz-new-badge">＋ new spot{{ mode === "branch" && topLevel > 1 ? "s" : "" }} go here</span>
            </div>
            <p class="wz-muted">
              The studio writes it as a <strong>draft</strong>. Nothing is published and no artwork is painted until you choose to.
              <template v-if="isDirty"> Your unsaved edits are saved first.</template>
              <template v-if="mode === 'branch'"> {{ total }} scenes take about {{ Math.max(1, Math.round(total * 0.5)) }} minutes.</template>
              <template v-else> It takes about a minute.</template>
            </p>
          </section>

          <!-- 4 · create -->
          <section v-else-if="stepId === 'create'">
            <div v-if="createState === 'running'" class="wz-working" role="status" aria-live="polite">
              <span class="wz-spinner" aria-hidden="true"></span>
              <div>
                <strong>{{ progressNote }}</strong>
                <small>Please keep this window open. Nothing is published.</small>
              </div>
            </div>
            <div v-else-if="createState === 'done'" class="wz-ok">
              ✓ {{ mode === "branch" ? `${createdIds.length} scenes are written.` : `“${newTitle}” is written.` }} Press Next.
            </div>
            <div v-else-if="createState === 'failed'" class="wz-actions-col">
              <button type="button" class="btn primary wz-big" @click="tryAgain">Try again</button>
              <small class="wz-muted">Nothing was lost. You can also go Back and change your answers.</small>
            </div>

            <ul v-if="items.length" class="wz-build" aria-live="polite">
              <li v-for="i in items" :key="i.key" :class="i.status">
                <span aria-hidden="true">{{ { pending: "○", running: "◐", done: "✓", failed: "✕", skipped: "–" }[i.status] }}</span>
                <span>{{ i.label }}</span>
                <small v-if="i.status === 'failed'">couldn't be written</small>
                <small v-else-if="i.status === 'skipped'">skipped — its parent failed</small>
              </li>
            </ul>
            <div v-if="createState === 'running' && mode === 'branch'" class="wz-actions-col">
              <button type="button" class="btn wz-link" :disabled="stopRequested" @click="stopRequested = true">{{ stopRequested ? "Stopping after this scene…" : "Stop after this scene" }}</button>
            </div>
            <div v-if="createState === 'done' && items.some((i) => i.status === 'failed' || i.status === 'skipped')" class="wz-actions-col">
              <button type="button" class="btn" @click="tryAgain">Try the missing scenes again</button>
            </div>
          </section>

          <!-- 5 · what's next -->
          <section v-else-if="stepId === 'next'">
            <p class="wz-banner" :class="check && check.scene ? 'good' : 'wait'">
              <template v-if="check && check.scene">
                🎉 {{ isBranch ? `${createdIds.length} new scenes are under “${parent?.title}”.` : `“${newTitle}” is under “${parent?.title}”.` }}
              </template>
              <template v-else>That scene is no longer in this world. Close this and check the map.</template>
            </p>
            <ul class="wz-steps" aria-label="Progress of the new scene">
              <li v-for="r in rows" :key="r.key" :class="r.ok ? 'ok' : 'todo'">
                <span class="wz-mark" aria-hidden="true">{{ r.ok ? "✓" : "✗" }}</span>
                <div><strong>{{ r.name }}</strong><small>{{ r.note }}</small></div>
                <template v-if="!r.ok">
                  <button v-if="r.key === 'artwork'" type="button" class="btn" :disabled="!!extraBusy" @click="paint">{{ extraBusy === "artwork" ? "Painting… (about a minute each)" : isBranch ? "🎨 Paint them all" : "🎨 Paint it" }}</button>
                  <button v-else-if="r.key === 'voice'" type="button" class="btn" :disabled="!!extraBusy" title="Uses the voice chosen in the Voiceovers panel" @click="record">{{ extraBusy === "voice" ? "Recording…" : "🔊 Record voice" }}</button>
                  <button v-else-if="r.key === 'published'" type="button" class="btn primary" :disabled="!!extraBusy || isDirty" @click="publishNow">{{ extraBusy === "publish" ? "Publishing…" : "Publish" }}</button>
                </template>
                <button v-else-if="r.key === 'spot'" type="button" class="btn" @click="nudgeSpot">Adjust spot…</button>
              </li>
            </ul>
            <p class="wz-muted">
              <strong>Saving:</strong> done — the studio saved this to your draft.
              <template v-if="topicStatus !== 'published'"> <strong>Publishing:</strong> still needed before children can see the world.</template>
              <template v-else> <strong>Publishing:</strong> this world is already live. A scene without artwork should get its picture before families open it.</template>
            </p>
            <p v-if="isDirty" class="wz-muted">You have unsaved edits — close this and press Save edits.</p>
          </section>

          <p v-if="err" class="wz-error" role="alert">{{ err }}</p>
          <p v-if="extraNote" class="wz-ok-note" role="status">{{ extraNote }}</p>
        </div>

        <footer class="wz-foot">
          <button v-if="!isLast" type="button" class="btn" :disabled="!canBack" @click="back">← Back</button>
          <button v-else type="button" class="btn" @click="addAnother">＋ Add another scene</button>
          <div class="wz-next">
            <small v-if="nextBlock" class="wz-reason">{{ nextBlock }}</small>
            <button type="button" class="btn primary" :disabled="!!nextBlock || busy || (isLast && !!extraBusy)" @click="next">{{ nextLabel }}</button>
          </div>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.wz-back { position: fixed; inset: 0; background: rgba(17, 24, 39, 0.55); display: grid; place-items: center; z-index: 60; padding: 1rem; }
.wz { background: #fff; border-radius: 18px; width: 100%; max-width: 640px; max-height: calc(100vh - 2rem); display: flex; flex-direction: column; outline: none; box-shadow: 0 24px 60px rgba(0, 0, 0, 0.3); }
.wz-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; padding: 1.1rem 1.4rem 0.4rem; }
.wz-eyebrow { margin: 0; font-size: 0.72rem; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
.wz-head h2 { margin: 0.1rem 0 0; font-size: 1.4rem; }
.wz .btn:disabled { opacity: 0.45; cursor: not-allowed; }
.wz-x { border: none; background: transparent; font-size: 1.1rem; cursor: pointer; color: var(--muted); padding: 0.2rem 0.4rem; border-radius: 8px; }
.wz-x:hover:not(:disabled) { background: #F3F4F6; }
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
.wz-field.inline { flex-direction: row; align-items: center; gap: 0.5rem; }
.wz-field.inline .wz-input { width: auto; }
.wz-opt { font-weight: 600; color: var(--muted); font-size: 0.74rem; }
.wz-chosen { margin: 0; padding: 0.55rem 0.8rem; border-radius: 12px; background: var(--primary-soft); font-weight: 700; font-size: 0.9rem; }
.wz-list { list-style: none; margin: 0; padding: 0; max-height: 280px; overflow-y: auto; border: 1.5px solid var(--border); border-radius: 12px; }
.wz-row { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; width: 100%; padding: 0.5rem 0.8rem; border: none; border-bottom: 1px solid #F3F4F6; background: #fff; font-family: inherit; font-size: 0.92rem; cursor: pointer; text-align: left; }
.wz-row:hover:not(:disabled) { background: #FAF5FF; }
.wz-row.picked { background: var(--primary-soft); }
.wz-row.taken { color: #9CA3AF; cursor: not-allowed; background: #F9FAFB; }
.wz-row em { font-size: 0.76rem; font-style: normal; color: var(--muted); white-space: nowrap; }
.wz-scene-name { display: flex; flex-direction: column; min-width: 0; }
.wz-scene-name small { color: var(--muted); font-size: 0.74rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wz-empty { padding: 0.8rem; color: var(--muted); font-size: 0.88rem; }

.wz-kinds { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.7rem; }
.wz-modes { grid-template-columns: repeat(3, 1fr); }
.wz-kind { display: flex; flex-direction: column; align-items: flex-start; gap: 0.2rem; text-align: left; padding: 0.8rem 0.9rem; border: 2px solid var(--border); border-radius: 14px; background: #fff; cursor: pointer; font-family: inherit; }
.wz-kind:hover { border-color: #C4B5FD; background: #FAF5FF; }
.wz-kind.picked { border-color: var(--primary); background: var(--primary-soft); }
.wz-kind-emoji { font-size: 1.6rem; }
.wz-kind small { color: var(--muted); font-size: 0.78rem; }
.wz-chips { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.wz-chip { border: 1.5px solid var(--border); border-radius: 999px; background: #fff; padding: 0.25rem 0.7rem; font-family: inherit; font-size: 0.82rem; cursor: pointer; }
.wz-chip:hover { border-color: var(--primary); background: var(--primary-soft); }
.wz-big { padding: 0.8rem 1rem; font-size: 1rem; }
.wz-ideas { display: flex; flex-direction: column; gap: 0.5rem; }
.wz-idea { display: flex; flex-direction: column; gap: 0.15rem; text-align: left; padding: 0.7rem 0.9rem; border: 2px solid var(--border); border-radius: 12px; background: #fff; cursor: pointer; font-family: inherit; }
.wz-idea span { font-size: 0.84rem; color: var(--muted); }
.wz-idea:hover { border-color: #C4B5FD; background: #FAF5FF; }
.wz-idea.picked { border-color: var(--primary); background: var(--primary-soft); }
.wz-plan { display: flex; flex-wrap: wrap; gap: 0.7rem; align-items: center; }
.wz-outline { display: flex; flex-direction: column; gap: 0.4rem; }
.wz-orow { display: flex; align-items: center; gap: 0.5rem; border: 1.5px solid var(--border); border-radius: 10px; padding: 0.35rem 0.5rem; }
.wz-ofields { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.1rem; }
.wz-ofields small { color: var(--muted); font-size: 0.76rem; }

.wz-sum { margin: 0; display: grid; grid-template-columns: 9rem 1fr; gap: 0.4rem 0.9rem; font-size: 0.92rem; }
.wz-sum dt { font-weight: 800; color: var(--muted); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.03em; padding-top: 0.15rem; }
.wz-sum dd { margin: 0; color: var(--text); font-weight: 600; }
.wz-tree { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.15rem; }
.wz-mini { position: relative; width: min(100%, 360px); aspect-ratio: 16 / 9; align-self: center; border-radius: 12px; overflow: hidden; background: #F3F0FA; border: 1.5px solid var(--border); }
.wz-mini img { width: 100%; height: 100%; object-fit: cover; }
.wz-mini-empty { position: absolute; inset: 0; display: grid; place-items: center; padding: 1rem; text-align: center; font-size: 0.8rem; color: var(--muted); }
.wz-pin { position: absolute; width: 20px; height: 20px; margin: -10px 0 0 -10px; border-radius: 50%; background: #0F766E; color: #fff; font-size: 0.7rem; font-weight: 800; display: grid; place-items: center; border: 2px solid #fff; }
.wz-new-badge { position: absolute; right: 8px; bottom: 8px; padding: 0.2rem 0.55rem; border-radius: 999px; background: #fff; border: 2px dashed var(--primary); color: var(--primary); font-size: 0.74rem; font-weight: 800; }

.wz-working { display: flex; gap: 0.9rem; align-items: center; padding: 1rem; border-radius: 14px; background: var(--primary-soft); }
.wz-working small { display: block; color: var(--muted); }
.wz-spinner { width: 28px; height: 28px; border-radius: 50%; border: 4px solid #DDD6FE; border-top-color: var(--primary); animation: wz-spin 0.9s linear infinite; flex: none; }
@keyframes wz-spin { to { transform: rotate(360deg); } }
.wz-actions-col { display: flex; flex-direction: column; gap: 0.6rem; align-items: stretch; }
.wz-link { background: transparent; border-color: transparent; text-decoration: underline; color: var(--text2); }
.wz-ok { padding: 0.8rem 1rem; border-radius: 12px; background: #DCFCE7; color: #14532D; font-weight: 700; }
.wz-build { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.9rem; }
.wz-build li { display: flex; gap: 0.5rem; align-items: baseline; }
.wz-build li.done { color: #14532D; }
.wz-build li.failed { color: #991B1B; }
.wz-build li.skipped, .wz-build li.pending { color: var(--muted); }
.wz-build small { color: inherit; }

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
.wz-steps li.ok .wz-mark { color: #15803D; }
.wz-steps li.todo .wz-mark { color: #B45309; }
.wz-error { margin: 0; padding: 0.6rem 0.8rem; border-radius: 10px; background: #FEE2E2; color: #991B1B; font-size: 0.9rem; }
.wz-ok-note { margin: 0; color: #14532D; font-weight: 700; font-size: 0.88rem; }
@media (max-width: 560px) { .wz-modes { grid-template-columns: 1fr; } .wz-sum { grid-template-columns: 1fr; } }
</style>
