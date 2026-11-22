<script setup>
// "Add a place to the globe" — a guided, five-step wizard for a total beginner:
//   1 What kind of place?  2 Which one?  3 Check the spot  4 Make its scene
//   5 Turn it on for children   → then a finish screen saying exactly what is
//   done and what is still left.
// The wizard owns NO data: every change goes through the callbacks the studio
// passes in (ensureSpot / makeScene / setEnabled / relocate / save / paintArt /
// recordVoice / publish), so it reuses the studio's existing save, artwork and
// voice paths. It only remembers the place's spot id — never an object — because
// a save reloads the whole form.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import WikidoGlobeEditor from "@/components/platform/WikidoGlobeEditor.vue";
import WikidoPlaceChecklist from "@/components/platform/WikidoPlaceChecklist.vue";
import { formatLatLng } from "@/lib/wikido/globe/projection";
import {
  PLACE_KINDS, STEP_TITLES, allCountries, catalogChoices, cityChoices, friendlyError, kindForLevel, leftToDo,
  levelForKind, locatePlace, placeChecklist, sceneQuery, spotIdFor, stepOrder,
} from "@/lib/wikido/placeWizard";

const props = defineProps({
  pack: { type: Object, required: true },       // the studio's live (editable) topic
  directory: { type: Array, default: () => [] }, // globeDirectory(pack)
  topicStatus: { type: String, default: "draft" },
  // where to begin: { spotId?, catalogSpotId?, step? }
  start: { type: Object, default: () => ({}) },
  ensureSpot: { type: Function, required: true },   // (place) → spotId  (adds a switched-off pin)
  makeScene: { type: Function, required: true },    // (query) → { spot, sceneId, … }  (throws)
  setEnabled: { type: Function, required: true },   // (spotId, on) → boolean
  relocate: { type: Function, required: true },     // (spotId, lat, lng)
  saveNow: { type: Function, required: true },      // () → Promise<boolean>
  paintArt: { type: Function, required: true },     // (sceneId) → Promise<string|null error>
  recordVoice: { type: Function, required: true },  // (spotId) → Promise<string|null error>
  publish: { type: Function, required: true },      // () → Promise<string|null error>
  discardSpot: { type: Function, default: () => {} }, // (spotId) — drop a pin this wizard added but never used
  isDirty: { type: Boolean, default: false },
});
const emit = defineEmits(["close"]);

// ── state ─────────────────────────────────────────────────────────────────────
const kind = ref("");
const countryId = ref("");
const search = ref("");        // search box on the "which one" step
const typedName = ref("");     // city / landmark name
const chosen = ref(null);      // { name, lat?, lng?, level, spotId?, countryId?, catalogSpotId? }
const spotId = ref("");        // the hub spot this place is (once it exists)
const createdSpotId = ref(""); // a scene-less pin THIS wizard run added (so changing your mind can remove it)
const stepIdx = ref(0);
const phase = ref("steps");    // steps | done
const located = ref(true);     // do we know where it is yet? (flips true once its scene is written)
const plan = ref(true);        // the step order, frozen when leaving "which one" so it never reshuffles mid-flow
const busy = ref(false);
const err = ref("");
const sceneState = ref("idle"); // idle | running | done | skipped
const progressNote = ref("");
const extraBusy = ref("");      // "art" | "voice" | "publish"
const extraNote = ref("");
const dialogEl = ref(null);

const hub = computed(() => props.pack?.scenes?.[props.pack.rootSceneId] || null);
const liveSpot = computed(() => hub.value?.hotspots?.find((h) => h.id === spotId.value) || null);
const steps = computed(() => stepOrder(plan.value));
const stepId = computed(() => steps.value[stepIdx.value]);
const check = computed(() => (liveSpot.value ? placeChecklist(props.pack, liveSpot.value) : null));
const placeName = computed(() => liveSpot.value?.label || chosen.value?.name || "this place");
const countryName = computed(() => allCountries.find((c) => c.id === countryId.value)?.name || "");

// ── start-up: fresh, from a faint dot, or "Finish this place" ─────────────────
onMounted(async () => {
  const s = props.start || {};
  if (s.spotId) {
    const spot = hub.value?.hotspots?.find((h) => h.id === s.spotId);
    if (spot) {
      kind.value = kindForLevel(spot.level);
      chosen.value = { name: spot.label, lat: spot.lat, lng: spot.lng, level: spot.level, spotId: spot.id };
      spotId.value = spot.id;
      located.value = true;
      const c = placeChecklist(props.pack, spot);
      sceneState.value = c.scene ? "done" : "idle";
      if (c.complete || (c.scene && c.on)) phase.value = "done";
      else stepIdx.value = steps.value.indexOf(s.step || c.firstStep);
    }
  } else if (s.catalogSpotId) {
    const row = props.directory.find((r) => r.place.spotId === s.catalogSpotId);
    if (row) {
      kind.value = row.place.level;
      chosen.value = { ...row.place, catalogSpotId: row.place.spotId };
      located.value = true;
      const existed = Boolean(hub.value?.hotspots?.some((h) => h.id === row.place.spotId));
      spotId.value = await props.ensureSpot(placeFromChoice());
      if (!existed) createdSpotId.value = spotId.value;
      stepIdx.value = steps.value.indexOf("spot");
    }
  }
  await nextTick();
  dialogEl.value?.focus();
});

// ── step 1 → 2: picking a kind clears anything chosen for another kind ────────
function pickKind(id) {
  if (kind.value !== id) {
    chosen.value = null;
    typedName.value = "";
    search.value = "";
    countryId.value = "";
  }
  kind.value = id;
}

// ── step 2: the pickers ───────────────────────────────────────────────────────
const isCatalogKind = computed(() => kind.value === "continent" || kind.value === "country");
const catalogRows = computed(() => (isCatalogKind.value ? catalogChoices(props.directory, kind.value, search.value) : []));
const citySuggestions = computed(() => (kind.value === "city" && countryId.value ? cityChoices(countryId.value, typedName.value) : []));
// a place with a scene already is "already on your globe"; one added without a
// scene is still selectable — that is the "finish it" case
const rowHasScene = (row) => Boolean(row.spot?.childSceneId);

function pickCatalog(row) {
  if (rowHasScene(row)) return;
  chosen.value = { ...row.place, catalogSpotId: row.place.spotId };
}

function existingSpotNamed(name) {
  const id = spotIdFor(name);
  return hub.value?.hotspots?.find((h) => h.id === id || spotIdFor(h.label) === id) || null;
}

const pickBlock = computed(() => {
  if (isCatalogKind.value) return chosen.value ? "" : `Pick a ${kind.value} from the list.`;
  if (!countryId.value) return "First choose which country it is inside.";
  const name = typedName.value.trim();
  if (name.length < 2) return kind.value === "city" ? "Type the city's name." : "Type the landmark's name.";
  const hit = existingSpotNamed(name);
  if (hit?.childSceneId) return `“${hit.label}” is already on your globe.`;
  return "";
});

// The place as the studio needs it to add a switched-off pin.
function placeFromChoice() {
  const c = chosen.value;
  return {
    spotId: c.catalogSpotId || c.spotId || spotIdFor(c.name),
    name: c.name,
    lat: c.lat,
    lng: c.lng,
    level: c.level,
    // cities and landmarks live inside a country: keep that link on the pin
    ...((c.countryId || (!isCatalogKind.value && countryId.value)) ? { countryId: c.countryId || countryId.value } : {}),
  };
}

async function leavePick() {
  err.value = "";
  if (!isCatalogKind.value) {
    const name = typedName.value.trim();
    const hit = existingSpotNamed(name);
    if (hit) {
      // added earlier without a scene: carry on with that pin
      chosen.value = { name: hit.label, lat: hit.lat, lng: hit.lng, level: hit.level, spotId: hit.id };
    } else {
      const pos = locatePlace(kind.value, name, countryId.value);
      chosen.value = pos || { name, level: levelForKind(kind.value) };
    }
  }
  located.value = Number.isFinite(+chosen.value.lat) && Number.isFinite(+chosen.value.lng);
  plan.value = located.value;
  if (located.value) {
    const want = placeFromChoice().spotId;
    // changed their mind after going back: drop the unused pin from the first pick
    if (createdSpotId.value && createdSpotId.value !== want) {
      props.discardSpot(createdSpotId.value);
      createdSpotId.value = "";
    }
    const existed = Boolean(hub.value?.hotspots?.some((h) => h.id === want));
    spotId.value = await props.ensureSpot(placeFromChoice());
    if (!existed) createdSpotId.value = spotId.value;
  }
  return true;
}

// ── step 3: the spot ──────────────────────────────────────────────────────────
const readout = computed(() => (liveSpot.value ? formatLatLng(+liveSpot.value.lat, +liveSpot.value.lng) : ""));

// ── step 4: the scene ─────────────────────────────────────────────────────────
const SCENE_NOTES = [
  "Finding the place on the planet…",
  "Writing its story for children…",
  "Adding fun facts and a quiz-worthy detail…",
  "Pinning the doorway on the globe…",
];
let noteTimer = null;
function startNotes() {
  let i = 0;
  progressNote.value = SCENE_NOTES[0];
  noteTimer = setInterval(() => {
    i = Math.min(i + 1, SCENE_NOTES.length - 1);
    progressNote.value = SCENE_NOTES[i];
  }, 7000);
}
function stopNotes() {
  clearInterval(noteTimer);
  noteTimer = null;
  progressNote.value = "";
}
onBeforeUnmount(stopNotes);

async function writeScene() {
  if (busy.value) return;
  busy.value = true;
  err.value = "";
  sceneState.value = "running";
  startNotes();
  try {
    const res = await props.makeScene(sceneQuery({
      kind: kind.value,
      name: chosen.value.name,
      countryName: countryName.value,
      located: located.value,
    }));
    spotId.value = res.spot?.id || spotId.value;
    located.value = true; // the model has now located it (the step order stays as planned)
    sceneState.value = "done";
  } catch (e) {
    sceneState.value = "idle";
    err.value = friendlyError(e, "The scene could not be written. Please try again.");
  } finally {
    stopNotes();
    busy.value = false;
  }
}

async function skipScene() {
  if (busy.value) return;
  busy.value = true;
  err.value = "";
  try {
    if (!(await props.saveNow())) {
      err.value = "Could not save the pin. Please try again.";
      return;
    }
    sceneState.value = "skipped";
    phase.value = "done"; // nothing to switch on without a scene: go straight to the summary
  } finally {
    busy.value = false;
  }
}

// ── step 5: switch on ─────────────────────────────────────────────────────────
const canSwitchOn = computed(() => Boolean(liveSpot.value?.childSceneId));
const isOn = computed(() => liveSpot.value?.enabled !== false);
function toggleOn(event) {
  err.value = "";
  const ok = props.setEnabled(spotId.value, event.target.checked);
  if (!ok) err.value = "This place needs a scene before children can see it.";
  event.target.checked = liveSpot.value?.enabled !== false;
}

async function finish() {
  if (busy.value) return;
  busy.value = true;
  err.value = "";
  try {
    if (props.isDirty && !(await props.saveNow())) {
      err.value = "Your changes could not be saved. Please try again.";
      return;
    }
    phase.value = "done";
  } finally {
    busy.value = false;
  }
}

// ── navigation ────────────────────────────────────────────────────────────────
const nextBlock = computed(() => {
  if (phase.value !== "steps") return "";
  switch (stepId.value) {
    case "kind": return kind.value ? "" : "Choose a kind of place to continue.";
    case "pick": return pickBlock.value;
    case "scene": return sceneState.value === "running" ? "Writing the scene — one moment…" : sceneState.value === "idle" ? "Write the scene first, or choose “Add without a scene for now”." : "";
    default: return "";
  }
});
const isLast = computed(() => stepId.value === "on");
const nextLabel = computed(() => (isLast.value ? "Finish" : stepId.value === "spot" ? "Looks right →" : "Next →"));

async function next() {
  if (nextBlock.value || busy.value) return;
  err.value = "";
  if (stepId.value === "pick") {
    busy.value = true;
    try { await leavePick(); } catch (e) { err.value = friendlyError(e); return; } finally { busy.value = false; }
  }
  if (isLast.value) return finish();
  stepIdx.value += 1;
  // a scene already exists (finishing a half-added place): skip straight past it
  if (stepId.value === "scene" && sceneState.value === "done") stepIdx.value += 1;
}
function back() {
  if (busy.value || stepIdx.value === 0) return;
  err.value = "";
  stepIdx.value -= 1;
  if (stepId.value === "scene" && sceneState.value === "done") stepIdx.value -= 1;
  if (sceneState.value === "skipped") sceneState.value = "idle"; // let them write it after all
}

// from the finish screen back into one step
function reopen(step) {
  if (step === "scene") sceneState.value = "idle";
  stepIdx.value = steps.value.indexOf(step);
  phase.value = "steps";
  err.value = "";
  extraNote.value = "";
}

function addAnother() {
  kind.value = "";
  chosen.value = null;
  typedName.value = "";
  search.value = "";
  countryId.value = "";
  spotId.value = "";
  createdSpotId.value = "";
  sceneState.value = "idle";
  located.value = true;
  plan.value = true;
  stepIdx.value = 0;
  phase.value = "steps";
  err.value = "";
  extraNote.value = "";
}

// ── finish screen extras ──────────────────────────────────────────────────────
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
const paint = () => runExtra("art", () => props.paintArt(liveSpot.value.childSceneId), "Artwork painted.");
const record = () => runExtra("voice", () => props.recordVoice(spotId.value), "Voice recorded.");
const publishNow = () => runExtra("publish", () => props.publish(), "Published — families can now explore this world.");

const todo = computed(() => (check.value ? leftToDo(check.value) : []));
const stepCount = computed(() => steps.value.length);

function onKey(e) {
  if (e.key === "Escape" && !busy.value && !extraBusy.value) emit("close");
}
watch(stepId, () => nextTick(() => dialogEl.value?.querySelector(".wz-body")?.scrollTo?.(0, 0)));
</script>

<template>
  <Teleport to="body">
    <div class="wz-back" @click.self="!busy && emit('close')">
      <div
        ref="dialogEl"
        class="wz"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wz-title"
        tabindex="-1"
        @keydown="onKey"
      >
        <header class="wz-head">
          <div>
            <p class="wz-eyebrow">Add a place to the globe</p>
            <h2 id="wz-title">{{ phase === "done" ? "All done" : STEP_TITLES[stepId] }}</h2>
          </div>
          <button type="button" class="wz-x" aria-label="Close" :disabled="busy || !!extraBusy" @click="emit('close')">✕</button>
        </header>

        <!-- progress -->
        <div v-if="phase === 'steps'" class="wz-progress" role="group" :aria-label="`Step ${stepIdx + 1} of ${stepCount}`">
          <p class="wz-count">Step {{ stepIdx + 1 }} of {{ stepCount }}</p>
          <ol class="wz-dots" aria-hidden="true">
            <li v-for="(s, i) in steps" :key="s" :class="{ done: i < stepIdx, now: i === stepIdx }"></li>
          </ol>
        </div>

        <div class="wz-body">
          <!-- 1 · kind -->
          <section v-if="phase === 'steps' && stepId === 'kind'">
            <p class="wz-help">Pick what you want to add. Not sure? Start with a country.</p>
            <div class="wz-kinds">
              <button
                v-for="k in PLACE_KINDS"
                :key="k.id"
                type="button"
                class="wz-kind"
                :class="{ picked: kind === k.id }"
                :aria-pressed="kind === k.id"
                @click="pickKind(k.id)"
              >
                <span class="wz-kind-emoji" aria-hidden="true">{{ k.emoji }}</span>
                <strong>{{ k.label }}</strong>
                <small>{{ k.help }}</small>
              </button>
            </div>
          </section>

          <!-- 2 · which one -->
          <section v-else-if="phase === 'steps' && stepId === 'pick'">
            <template v-if="isCatalogKind">
              <p class="wz-help">Choose the {{ kind }} from the list — we already know where it is on the planet.</p>
              <input v-model="search" type="search" class="wz-input" :placeholder="`Search ${kind === 'country' ? 'countries' : 'continents'}…`" :aria-label="`Search ${kind}s`" />
              <ul class="wz-list" role="listbox" :aria-label="`Choose a ${kind}`">
                <li v-for="row in catalogRows" :key="row.place.spotId">
                  <button
                    type="button"
                    role="option"
                    class="wz-row"
                    :class="{ picked: chosen?.catalogSpotId === row.place.spotId, taken: rowHasScene(row) }"
                    :aria-selected="chosen?.catalogSpotId === row.place.spotId"
                    :disabled="rowHasScene(row)"
                    @click="pickCatalog(row)"
                  >
                    <span>{{ row.place.name }}</span>
                    <em v-if="rowHasScene(row)">already on your globe</em>
                    <em v-else-if="row.added">added — still needs a scene</em>
                  </button>
                </li>
                <li v-if="!catalogRows.length" class="wz-empty">Nothing matches “{{ search }}”. Check the spelling.</li>
              </ul>
            </template>
            <template v-else>
              <p class="wz-help">
                {{ kind === "city" ? "Say which country the city is in, then type or pick the city." : "Say which country the landmark is in, then type its name." }}
              </p>
              <label class="wz-field">Inside which country? <span class="wz-req">required</span>
                <select v-model="countryId" class="wz-input" @change="typedName = ''">
                  <option value="">— choose a country —</option>
                  <option v-for="c in allCountries" :key="c.id" :value="c.id">{{ c.name }}</option>
                </select>
              </label>
              <label class="wz-field">{{ kind === "city" ? "City name" : "Landmark name" }}
                <input
                  v-model="typedName"
                  type="text"
                  class="wz-input"
                  :disabled="!countryId"
                  :placeholder="kind === 'city' ? 'e.g. Lahore' : 'e.g. Eiffel Tower'"
                  maxlength="60"
                />
              </label>
              <div v-if="citySuggestions.length" class="wz-chips" aria-label="Cities we already know in this country">
                <button v-for="c in citySuggestions.slice(0, 12)" :key="c.id" type="button" class="wz-chip" @click="typedName = c.name">{{ c.name }}<small v-if="c.capital"> ★</small></button>
              </div>
            </template>
          </section>

          <!-- 3 · check the spot -->
          <section v-else-if="phase === 'steps' && stepId === 'spot'">
            <template v-if="liveSpot">
              <p class="wz-help">
                The numbered pin is <strong>{{ liveSpot.label }}</strong>. If it sits in the right place, press “Looks right”.
                If not, drag the pin where it belongs.
              </p>
              <div class="wz-globe">
                <WikidoGlobeEditor
                  :spots="[liveSpot]"
                  :selected-id="liveSpot.id"
                  @relocate="relocate"
                />
              </div>
              <p class="wz-readout" role="status">📍 {{ readout }}</p>
            </template>
            <p v-else class="wz-help">We could not find this place on the globe yet. Go back and try again.</p>
          </section>

          <!-- 4 · the scene -->
          <section v-else-if="phase === 'steps' && stepId === 'scene'">
            <p class="wz-help">
              A scene is the page children open when they tap {{ placeName }}: a short story, fun facts and spots to explore.
              We write it for you — it takes about a minute.
            </p>
            <div v-if="sceneState === 'running'" class="wz-working" role="status" aria-live="polite">
              <span class="wz-spinner" aria-hidden="true"></span>
              <div>
                <strong>{{ progressNote }}</strong>
                <small>Please keep this window open. Nothing is published yet.</small>
              </div>
            </div>
            <div v-else-if="sceneState === 'done'" class="wz-ok">✓ The scene for {{ placeName }} is written.</div>
            <div v-else-if="sceneState === 'skipped'" class="wz-ok">Skipped — the pin is saved without a scene.</div>
            <div v-else class="wz-actions-col">
              <button type="button" class="btn primary wz-big" :disabled="busy" @click="writeScene">
                ✦ {{ err ? "Try again" : `Write the scene for ${placeName}` }}
              </button>
              <button
                v-if="located"
                type="button"
                class="btn wz-link"
                :disabled="busy"
                title="The pin stays on the globe, switched off, until a scene is added later"
                @click="skipScene"
              >Add without a scene for now</button>
              <small v-else class="wz-muted">We find this place's exact spot while writing its scene, so a scene is needed first.</small>
            </div>
          </section>

          <!-- 5 · turn on -->
          <section v-else-if="phase === 'steps' && stepId === 'on'">
            <p class="wz-help">
              When a place is <strong>on</strong>, children can tap it on their globe. Leave it <strong>off</strong> while you are still working on it.
            </p>
            <label class="wz-switch" :class="{ disabled: !canSwitchOn }">
              <input type="checkbox" :checked="isOn" :disabled="!canSwitchOn" @change="toggleOn" />
              <span class="wz-switch-track" aria-hidden="true"></span>
              <span>{{ isOn && canSwitchOn ? `On — children can tap ${placeName}` : `Off — hidden from children` }}</span>
            </label>
            <p v-if="!canSwitchOn" class="wz-muted">This place has no scene yet, so it has to stay off. You can finish it later with “Finish this place”.</p>
            <WikidoPlaceChecklist v-if="check" :check="check" class="wz-check" />
          </section>

          <!-- done -->
          <section v-else-if="phase === 'done' && check">
            <p class="wz-banner" :class="check.on && check.scene ? 'good' : 'wait'">
              <template v-if="check.on && check.scene">🎉 {{ placeName }} is on the globe for children.</template>
              <template v-else-if="check.scene">✓ {{ placeName }} is saved, but switched <strong>off</strong>.</template>
              <template v-else>✓ {{ placeName }} is pinned and saved — it has no scene yet, so it is switched <strong>off</strong>.</template>
            </p>
            <WikidoPlaceChecklist :check="check" class="wz-check" />
            <div v-if="todo.length" class="wz-todo">
              <h3>Still to do</h3>
              <ul><li v-for="t in todo" :key="t">{{ t }}</li></ul>
            </div>
            <p v-else class="wz-muted">Nothing left to do for this place. 🎉</p>

            <div class="wz-extras">
              <button v-if="!check.scene" type="button" class="btn primary" @click="reopen('scene')">✦ Write its scene now</button>
              <button v-if="check.scene && !check.artwork" type="button" class="btn" :disabled="!!extraBusy" @click="paint">{{ extraBusy === "art" ? "Painting… (about a minute)" : "🎨 Paint its artwork" }}</button>
              <button v-if="check.scene && !check.voice" type="button" class="btn" :disabled="!!extraBusy" title="Uses the voice chosen in the Voiceovers panel" @click="record">{{ extraBusy === "voice" ? "Recording…" : "🔊 Record its voice" }}</button>
              <button v-if="check.scene && !check.on" type="button" class="btn" @click="reopen('on')">Switch it on…</button>
            </div>

            <p v-if="topicStatus === 'published'" class="wz-pub ok">✓ Saved. This world is published, so families see this change.</p>
            <div v-else class="wz-pub wait">
              <span>Saved. This world is still a <strong>draft</strong>, so children cannot see it yet.</span>
              <button type="button" class="btn primary" :disabled="!!extraBusy || isDirty" @click="publishNow">{{ extraBusy === "publish" ? "Publishing…" : "Publish to families" }}</button>
            </div>
            <p v-if="isDirty && phase === 'done'" class="wz-muted">You have unsaved edits — close this and press Save edits.</p>
          </section>
          <p v-else-if="phase === 'done'" class="wz-help">That place is no longer on the globe. Close this and try again.</p>

          <p v-if="err" class="wz-error" role="alert">{{ err }}</p>
          <p v-if="extraNote" class="wz-ok-note" role="status">{{ extraNote }}</p>
        </div>

        <footer class="wz-foot">
          <template v-if="phase === 'steps'">
            <button type="button" class="btn" :disabled="stepIdx === 0 || busy" @click="back">← Back</button>
            <div class="wz-next">
              <small v-if="nextBlock" class="wz-reason">{{ nextBlock }}</small>
              <button type="button" class="btn primary" :disabled="!!nextBlock || busy" @click="next">{{ busy && stepId !== 'scene' ? "Working…" : nextLabel }}</button>
            </div>
          </template>
          <template v-else>
            <button type="button" class="btn" @click="addAnother">＋ Add another place</button>
            <button type="button" class="btn primary" @click="emit('close')">Close</button>
          </template>
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
.wz-body { padding: 0.8rem 1.4rem 0.4rem; overflow-y: auto; display: flex; flex-direction: column; gap: 0.7rem; min-height: 260px; }
.wz-body > section { display: flex; flex-direction: column; gap: 0.7rem; }
.wz-help { margin: 0; font-size: 0.95rem; color: var(--text2); }
.wz-muted { margin: 0; font-size: 0.85rem; color: var(--muted); }
.wz-foot { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 0.75rem; padding: 0.9rem 1.4rem 1.1rem; border-top: 1px solid var(--border); }
.wz-next { display: flex; align-items: center; gap: 0.75rem; justify-content: flex-end; flex: 1; }
.wz-reason { color: var(--muted); font-size: 0.78rem; text-align: right; }

.wz-kinds { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.7rem; }
.wz-kind { display: flex; flex-direction: column; align-items: flex-start; gap: 0.2rem; text-align: left; padding: 0.9rem 1rem; border: 2px solid var(--border); border-radius: 14px; background: #fff; cursor: pointer; font-family: inherit; }
.wz-kind:hover { border-color: #C4B5FD; background: #FAF5FF; }
.wz-kind.picked { border-color: var(--primary); background: var(--primary-soft); }
.wz-kind-emoji { font-size: 1.7rem; }
.wz-kind small { color: var(--muted); font-size: 0.8rem; }

.wz-input { width: 100%; padding: 0.55rem 0.7rem; border: 1.5px solid var(--border); border-radius: 10px; font-family: inherit; font-size: 0.95rem; }
.wz-field { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.85rem; font-weight: 700; color: var(--text2); }
.wz-req { font-weight: 600; color: #B45309; font-size: 0.74rem; }
.wz-list { list-style: none; margin: 0; padding: 0; max-height: 280px; overflow-y: auto; border: 1.5px solid var(--border); border-radius: 12px; }
.wz-row { display: flex; justify-content: space-between; gap: 0.5rem; width: 100%; padding: 0.55rem 0.8rem; border: none; border-bottom: 1px solid #F3F4F6; background: #fff; font-family: inherit; font-size: 0.92rem; cursor: pointer; text-align: left; }
.wz-row:hover:not(:disabled) { background: #FAF5FF; }
.wz-row.picked { background: var(--primary-soft); font-weight: 800; }
.wz-row.taken { color: #9CA3AF; cursor: not-allowed; background: #F9FAFB; }
.wz-row em { font-size: 0.78rem; font-style: normal; color: var(--muted); }
.wz-empty { padding: 0.8rem; color: var(--muted); font-size: 0.88rem; }
.wz-chips { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.wz-chip { border: 1.5px solid var(--border); border-radius: 999px; background: #fff; padding: 0.25rem 0.7rem; font-family: inherit; font-size: 0.82rem; cursor: pointer; }
.wz-chip:hover { border-color: var(--primary); background: var(--primary-soft); }

.wz-globe { width: min(100%, 340px); align-self: center; }
.wz-readout { margin: 0; text-align: center; font-weight: 700; font-size: 0.88rem; color: var(--text2); }

.wz-working { display: flex; gap: 0.9rem; align-items: center; padding: 1rem; border-radius: 14px; background: var(--primary-soft); }
.wz-working small { display: block; color: var(--muted); }
.wz-spinner { width: 28px; height: 28px; border-radius: 50%; border: 4px solid #DDD6FE; border-top-color: var(--primary); animation: wz-spin 0.9s linear infinite; flex: none; }
@keyframes wz-spin { to { transform: rotate(360deg); } }
.wz-actions-col { display: flex; flex-direction: column; gap: 0.6rem; align-items: stretch; }
.wz-big { padding: 0.8rem 1rem; font-size: 1rem; }
.wz-link { background: transparent; border-color: transparent; text-decoration: underline; color: var(--text2); }
.wz-ok { padding: 0.8rem 1rem; border-radius: 12px; background: #DCFCE7; color: #14532D; font-weight: 700; }

.wz-switch { display: flex; align-items: center; gap: 0.8rem; font-weight: 700; cursor: pointer; padding: 0.8rem 1rem; border: 2px solid var(--border); border-radius: 14px; }
.wz-switch.disabled { opacity: 0.6; cursor: not-allowed; }
.wz-switch input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.wz-switch-track { position: relative; width: 46px; height: 26px; border-radius: 13px; background: #D1D5DB; flex: none; transition: background 0.15s; }
.wz-switch-track::after { content: ""; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; transition: transform 0.15s; }
.wz-switch input:checked + .wz-switch-track { background: #16A34A; }
.wz-switch input:checked + .wz-switch-track::after { transform: translateX(20px); }
.wz-switch input:focus-visible + .wz-switch-track { outline: 3px solid #C4B5FD; outline-offset: 2px; }

.wz-banner { margin: 0; padding: 0.9rem 1rem; border-radius: 14px; font-weight: 700; }
.wz-banner.good { background: #DCFCE7; color: #14532D; }
.wz-banner.wait { background: #FEF9C3; color: #713F12; }
.wz-todo h3 { margin: 0 0 0.3rem; font-size: 0.95rem; }
.wz-todo ul { margin: 0; padding-left: 1.2rem; font-size: 0.9rem; color: var(--text2); display: flex; flex-direction: column; gap: 0.25rem; }
.wz-extras { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.wz-pub { margin: 0; padding: 0.7rem 0.9rem; border-radius: 12px; font-size: 0.9rem; display: flex; gap: 0.7rem; align-items: center; justify-content: space-between; flex-wrap: wrap; }
.wz-pub.ok { background: #DCFCE7; color: #14532D; }
.wz-pub.wait { background: #FEF9C3; color: #713F12; }
.wz-error { margin: 0; padding: 0.6rem 0.8rem; border-radius: 10px; background: #FEE2E2; color: #991B1B; font-size: 0.9rem; }
.wz-ok-note { margin: 0; color: #14532D; font-weight: 700; font-size: 0.88rem; }
.wz-check { margin-top: 0.2rem; }
@media (max-width: 520px) { .wz-kinds { grid-template-columns: 1fr; } }
</style>
