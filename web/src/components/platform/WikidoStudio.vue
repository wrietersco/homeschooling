<script setup>
// Wikido Studio — the superadmin workspace for generating immersive picture-
// encyclopedia topics on ANY subject, growing them layer by layer, curating
// every word and picture, and publishing them to all families.
//
// Topic lives in Firestore (wikidoTopics/{id}); artwork is generated per scene
// with the platform image model into Storage; spoken audio falls back to the
// runtime TTS chain (the developer's Kokoro script can attach recordings later,
// exactly as for hand-authored packs).
import { computed, onMounted, ref, watch } from "vue";
import {
  generateWikidoTopic, addWikidoChildScene, suggestWikidoScenes, planWikidoOutline, generateWikidoSceneImage, generateWikidoImages,
  generateWikidoSpotDetails, planWikidoDepth,
  saveWikidoTopic, setWikidoTopicStatus, deleteWikidoTopic, fetchAllWikidoTopicsAdmin,
  checkVoiceoverBridge, synthesizeOnBridge, planVoiceoverClips, attachWikidoAudio, BRIDGE_URL,
  reorderWikidoTopics, sortStudioTopics,
} from "@/services/wikidoAdmin";
import { buildSceneTree, moveSceneSibling } from "@/lib/wikido/tree";
import { useCoverPlacement } from "@/composables/useCoverPlacement";
import { spotOutcome, sceneStatus, deletePlan, deleteSceneFrom, topicHealth, undoBuiltScenes, spotNeedsDetails } from "@/lib/wikido/studioModel";
import { withKeys, countOutline, removeOutlineNode, runOutline, summarizeRun } from "@/lib/wikido/outlineBuild";

// ── topic list ────────────────────────────────────────────────────────────────
const topics = ref([]);
const loading = ref(true);
const selectedId = ref("");
const message = ref("");
const error = ref("");

async function refresh(keepSelection = true) {
  loading.value = true;
  try {
    topics.value = sortStudioTopics(await fetchAllWikidoTopicsAdmin());
    if (!keepSelection || !topics.value.some((t) => t.id === selectedId.value)) {
      selectedId.value = topics.value[0]?.id || "";
      loadSelected();
    }
  } finally {
    loading.value = false;
  }
}

// move a topic up/down the studio shelf order (persisted for every family)
const chipBusy = ref("");
async function moveTopicChip(topicId, dir) {
  if (chipBusy.value) return;
  const ids = topics.value.map((t) => t.id);
  const idx = ids.indexOf(topicId);
  const swap = dir === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swap < 0 || swap >= ids.length) return;
  [ids[idx], ids[swap]] = [ids[swap], ids[idx]];
  const byId = new Map(topics.value.map((t) => [t.id, t]));
  topics.value = ids.map((id) => byId.get(id));
  chipBusy.value = topicId;
  try {
    await reorderWikidoTopics({ orderedIds: ids });
    message.value = "Topic order updated — the child-facing shelf shows studio topics in this order.";
  } catch (e) {
    error.value = e?.message?.replace("internal: ", "") || "Reordering failed.";
    await refresh(true);
  } finally {
    chipBusy.value = "";
  }
}

// ── voiceovers (local Kokoro bridge) ──────────────────────────────────────────
const bridge = ref({ online: false });
const voBusy = ref(false);
const voProgress = ref({ done: 0, total: 0 });
const voForce = ref(false);
const voFailed = ref([]);

async function probeBridge() {
  bridge.value = await checkVoiceoverBridge(BRIDGE_URL);
}

// Record every missing clip on the local Kokoro bridge, then attach each MP3 to
// the topic through the superadmin callable (Storage + pack audio fields).
async function generateVoiceovers() {
  if (voBusy.value || !form.value) return;
  voBusy.value = true;
  voFailed.value = [];
  error.value = "";
  try {
    // the callable checks the SAVED topic — freshly added hotspots must ship
    // first; if the save fails (validation), recording must not run at all
    if (dirty.value) {
      const ok = await save();
      if (!ok) { voBusy.value = false; return; }
    }
    const items = planVoiceoverClips(form.value, { force: voForce.value });
    voProgress.value = { done: 0, total: items.length };
    if (!items.length) {
      message.value = "Every scene and hotspot already has a voiceover (use “re-record all” to refresh).";
      return;
    }
    const failedIds = [];
    const chunkSize = 5;
    for (let i = 0; i < items.length; i += chunkSize) {
      const chunk = items.slice(i, i + chunkSize);
      const { results, failed } = await synthesizeOnBridge(bridge.value.url, chunk);
      for (const clip of results) {
        const dot = clip.id.indexOf(".");
        const sceneId = dot < 0 ? clip.id : clip.id.slice(0, dot);
        const hotspotId = dot < 0 ? "" : clip.id.slice(dot + 1);
        try {
          await attachWikidoAudio({ topicId: selectedId.value, sceneId, hotspotId: hotspotId || undefined, audioBase64: clip.mp3, mime: "audio/mpeg" });
        } catch (e) {
          failedIds.push(`${clip.id}: ${String(e?.message || e).replace(/^[a-z-]+: /i, "").slice(0, 90)}`);
          voFailed.value = [...failedIds];
          continue;
        }
        // reflect it in the form so dirty-state and skip-logic stay accurate
        const scene = form.value.scenes[sceneId];
        if (scene) {
          if (hotspotId) {
            const spot = scene.hotspots?.find((h) => h.id === hotspotId);
            if (spot) spot.audio = "attached";
          } else {
            scene.audio = "attached";
          }
        }
        voProgress.value.done += 1;
      }
      failedIds.push(...failed.map((f) => f.id));
      voFailed.value = [...failedIds];
    }
    message.value = `Voiceovers attached: ${voProgress.value.done}/${items.length}${failedIds.length ? ` · failed: ${failedIds.join(", ")}` : ""}.`;
    snapshot();
  } catch (e) {
    error.value = e?.message?.replace("internal: ", "") || "Voiceover generation failed.";
  } finally {
    voBusy.value = false;
  }
}
onMounted(() => {
  refresh(false);
  probeBridge();
});

const selectedDoc = computed(() => topics.value.find((t) => t.id === selectedId.value) || null);

// ── create ────────────────────────────────────────────────────────────────────
const newTitle = ref("");
const newAngle = ref("");
const creating = ref(false);

async function createTopic() {
  if (!newTitle.value.trim() || creating.value) return;
  creating.value = true;
  error.value = "";
  message.value = "";
  try {
    const res = await generateWikidoTopic({ title: newTitle.value.trim(), angle: newAngle.value.trim() });
    message.value = `Generated “${res.title}” — ${res.scenes} scenes, ${res.discoveries} discoveries. Generate artwork, review, then publish.`;
    newTitle.value = "";
    newAngle.value = "";
    await refresh();
    selectedId.value = res.id;
    loadSelected();
  } catch (e) {
    error.value = e?.message?.replace("internal: ", "").replace("invalid-argument: ", "") || "Generation failed.";
  } finally {
    creating.value = false;
  }
}

// ── workspace editing ─────────────────────────────────────────────────────────
const form = ref(null);        // editable deep copy of the pack
const originalJson = ref("");  // dirty detection
const selectedSceneId = ref("");
const saving = ref(false);
const generatingImages = ref(false);
const imageBusy = ref("");     // sceneId with artwork in flight
const layerBusy = ref(false);
const layerLabel = ref("");
const layerFocus = ref("");

function loadSelected() {
  const doc = selectedDoc.value;
  // JSON round-trip: topic docs are pure JSON data, and structuredClone would
  // choke on Vue's reactive proxies
  form.value = doc ? JSON.parse(JSON.stringify(doc)) : null;
  delete form.value?.id;
  originalJson.value = form.value ? JSON.stringify(form.value) : "";
  selectedSceneId.value = form.value?.rootSceneId || "";
  message.value = "";
  error.value = "";
}

const dirty = computed(() => Boolean(form.value && JSON.stringify(form.value) !== originalJson.value));
const missingArtwork = computed(() =>
  form.value ? Object.values(form.value.scenes).filter((s) => !String(s.image?.src || "").startsWith("http")).map((s) => s.id) : []
);

// voiceover coverage over the current (edited) form
const voStats = computed(() => {
  let total = 0;
  let recorded = 0;
  for (const s of Object.values(form.value?.scenes || {})) {
    total += 1;
    if (s.audio) recorded += 1;
    for (const h of s.hotspots || []) {
      total += 1;
      if (h.audio) recorded += 1;
    }
  }
  return { total, recorded };
});

// scenes ordered exactly as the explorer traverses them: breadth-first from the
// root along doorways (children in doorway order), orphans appended
const orderedScenes = computed(() => (form.value?.scenes ? buildSceneTree(form.value.scenes, form.value.rootSceneId) : []));

function selectScene(id) {
  selectedSceneId.value = id;
}

// ── tree power features ───────────────────────────────────────────────────────
const layerParentId = ref("");

// the layer form always names its target; keep it glued to the selected scene
watch(selectedSceneId, (id) => { if (!layerParentId.value) layerParentId.value = id; });
watch(() => form.value, () => { layerParentId.value = selectedSceneId.value; });

const layerParentTitle = computed(() =>
  form.value?.scenes?.[layerParentId.value]?.title || form.value?.scenes?.[selectedSceneId.value]?.title || ""
);

function startDeeperLayer(sceneId) {
  selectScene(sceneId);
  layerParentId.value = sceneId;
  layerLabel.value = "";
  layerFocus.value = "";
  // scroll the growth form into view
  requestAnimationFrame(() => document.querySelector(".layer-form")?.scrollIntoView({ behavior: "smooth", block: "center" }));
}

function moveScene(sceneId, dir) {
  const next = moveSceneSibling(form.value.scenes, sceneId, dir);
  if (next) form.value.scenes = next;
}

const canMove = (sceneId, dir) => {
  const siblings = siblingIdsOf(sceneId);
  const idx = siblings.indexOf(sceneId);
  return dir === "up" ? idx > 0 : idx >= 0 && idx < siblings.length - 1;
};
function siblingIdsOf(sceneId) {
  const parent = Object.values(form.value?.scenes || {}).find((s) => (s.hotspots || []).some((h) => h.childSceneId === sceneId));
  return parent ? (parent.hotspots || []).filter((h) => h.childSceneId).map((h) => h.childSceneId) : [];
}
const selectedScene = computed(() => form.value?.scenes?.[selectedSceneId.value] || null);
const incomingDoorways = computed(() => {
  if (!form.value || !selectedSceneId.value) return [];
  return Object.entries(form.value.scenes).flatMap(([sid, s]) =>
    (s.hotspots || []).filter((h) => h.childSceneId === selectedSceneId.value).map((h) => `${s.title} → ${h.label}`)
  );
});

function snapshot() {
  originalJson.value = JSON.stringify(form.value);
}

async function save() {
  if (!form.value || saving.value) return false;
  saving.value = true;
  error.value = "";
  message.value = "";
  const restoreScene = selectedSceneId.value;
  try {
    const res = await saveWikidoTopic({ topicId: selectedId.value, pack: form.value });
    message.value = `Saved — ${res.discoveryCount} discoveries.`;
    snapshot();
    // adopt the server-normalized doc (missing ids repaired, etc.) — otherwise
    // the form keeps stale ids and later steps (voiceovers) target ghosts
    await refresh(true);
    loadSelected();
    selectedSceneId.value = form.value.scenes[restoreScene] ? restoreScene : form.value.rootSceneId;
    return true;
  } catch (e) {
    error.value = e?.message?.replace("invalid-argument: ", "") || "Save failed.";
    return false;
  } finally {
    saving.value = false;
  }
}

async function generateAllImages() {
  if (generatingImages.value) return;
  generatingImages.value = true;
  error.value = "";
  message.value = "Generating artwork… this takes a while (one picture per scene).";
  try {
    const res = await generateWikidoImages({ topicId: selectedId.value });
    // pull the fresh artwork srcs into the form
    const docs = await fetchAllWikidoTopicsAdmin();
    const doc = docs.find((t) => t.id === selectedId.value);
    if (doc) {
      for (const [sid, s] of Object.entries(doc.scenes || {})) {
        if (form.value.scenes[sid]) form.value.scenes[sid].image.src = s.image?.src || "";
      }
    }
    message.value = `Artwork: ${res.generated} generated, ${res.failed} failed.`;
    snapshot();
  } catch (e) {
    error.value = e?.message?.replace("internal: ", "") || "Artwork generation failed.";
  } finally {
    generatingImages.value = false;
  }
}

async function regenerateSceneImage(sceneId) {
  if (imageBusy.value) return;
  imageBusy.value = sceneId;
  error.value = "";
  try {
    const res = await generateWikidoSceneImage({ topicId: selectedId.value, sceneId });
    if (form.value.scenes[sceneId]) form.value.scenes[sceneId].image.src = res.url;
    message.value = "Artwork updated.";
    snapshot();
  } catch (e) {
    error.value = e?.message?.replace("internal: ", "") || "Artwork generation failed.";
  } finally {
    imageBusy.value = "";
  }
}

// ── AI suggestions for the next scene (read-only until a chip is clicked) ───────
const suggestions = ref([]);
const suggestBusy = ref(false);
const suggestFor = ref("");

async function suggestScenes() {
  const parentId = layerParentId.value || selectedSceneId.value;
  if (!parentId || suggestBusy.value) return;
  suggestBusy.value = true;
  error.value = "";
  try {
    // the server reads the SAVED topic — persist edits so it sees this scene
    if (dirty.value && !(await save())) return;
    const res = await suggestWikidoScenes({ topicId: selectedId.value, parentSceneId: parentId });
    suggestions.value = res.suggestions || [];
    suggestFor.value = parentId;
  } catch (e) {
    error.value = e?.message?.replace("internal: ", "") || "Could not get suggestions.";
  } finally {
    suggestBusy.value = false;
  }
}

// one click: the chip becomes the scene name + focus and the normal creation runs
async function addSuggested(s) {
  layerLabel.value = s.label;
  layerFocus.value = s.focus;
  suggestions.value = suggestions.value.filter((x) => x !== s);
  await addLayer();
}
watch(layerParentId, (id) => { if (id !== suggestFor.value) suggestions.value = []; });

// ── Topic Builder: plan a whole branch → review → build scene by scene ─────────
// Planning is read-only. Nothing exists until "Build"; each scene then goes
// through the same guarded addWikidoChildScene path as a hand-made one (draft,
// validated). A failed scene skips only its own subtree, and a finished run can
// be undone as one batch.
const planSize = ref(6);
const outline = ref([]);          // the reviewed tree [{ key, label, focus, children }]
const planBusy = ref(false);
const planTrimmed = ref(false);
const planFor = ref("");          // parent scene the outline hangs under
const buildItems = ref([]);       // live per-scene status of the current/last run
const building = ref(false);
const stopRequested = ref(false);
const lastBuild = ref(null);      // { created: [sceneId…], parentTitle }

const outlineCount = computed(() => countOutline(outline.value));
const outlineRows = computed(() => {
  const rows = [];
  const walk = (nodes, depth) => nodes.forEach((n) => { rows.push({ node: n, depth }); walk(n.children, depth + 1); });
  walk(outline.value, 0);
  return rows;
});
const buildSummary = computed(() => summarizeRun(buildItems.value));
const planParentTitle = computed(() => form.value?.scenes?.[planFor.value]?.title || "");
watch(layerParentId, (id) => { if (!building.value && id !== planFor.value) outline.value = []; });

async function draftOutline() {
  const parentId = layerParentId.value || selectedSceneId.value;
  if (!parentId || planBusy.value || building.value) return;
  planBusy.value = true;
  error.value = "";
  buildItems.value = [];
  lastBuild.value = null;
  try {
    // the server plans from the SAVED topic — persist edits first
    if (dirty.value && !(await save())) return;
    const res = await planWikidoOutline({ topicId: selectedId.value, parentSceneId: parentId, total: planSize.value });
    outline.value = withKeys(res.outline);
    planTrimmed.value = Boolean(res.trimmed);
    planFor.value = parentId;
  } catch (e) {
    error.value = e?.message?.replace("internal: ", "") || "Could not draft an outline.";
  } finally {
    planBusy.value = false;
  }
}

function dropOutlineNode(key) {
  outline.value = removeOutlineNode(outline.value, key);
}

async function buildOutline() {
  if (building.value || !outline.value.length) return;
  building.value = true;
  stopRequested.value = false;
  error.value = "";
  const parentId = planFor.value;
  const parentTitle = planParentTitle.value;
  let run;
  try {
    run = await runOutline({
      outline: outline.value,
      parentSceneId: parentId,
      createScene: (args) => addWikidoChildScene({ topicId: selectedId.value, ...args }),
      onUpdate: (items) => { buildItems.value = items; },
      shouldStop: () => stopRequested.value,
    });
  } finally {
    building.value = false;
  }
  // adopt the server-side result (new scenes + the spots that open them)
  topics.value = await fetchAllWikidoTopicsAdmin();
  loadSelected();
  selectedSceneId.value = form.value?.scenes?.[parentId] ? parentId : form.value?.rootSceneId || "";
  layerParentId.value = selectedSceneId.value;
  const sum = summarizeRun(run.items);
  lastBuild.value = run.created.length ? { created: run.created, parentTitle } : null;
  outline.value = [];
  message.value = `Built ${sum.done} scene${sum.done === 1 ? "" : "s"} under “${parentTitle}”${sum.failed ? ` — ${sum.failed} failed` : ""}${sum.skipped ? `, ${sum.skipped} skipped` : ""}${run.stopped ? " (stopped early)" : ""}. They are drafts: generate artwork, review, then publish.`;
}

async function undoBuild() {
  if (!lastBuild.value || !form.value) return;
  const n = lastBuild.value.created.length;
  if (!window.confirm(`Remove the ${n} scene${n === 1 ? "" : "s"} from the last build, and the spots that open them?`)) return;
  form.value.scenes = undoBuiltScenes(form.value.scenes, lastBuild.value.created);
  if (!form.value.scenes[selectedSceneId.value]) selectedSceneId.value = form.value.rootSceneId;
  lastBuild.value = null;
  buildItems.value = [];
  if (await save()) message.value = "Last build undone.";
}

async function addLayer() {
  if (layerBusy.value) return;
  const parentId = layerParentId.value || selectedSceneId.value;
  if (!parentId) return;
  layerBusy.value = true;
  error.value = "";
  try {
    // save unsaved edits first so the server grows the CURRENT scene
    if (dirty.value) await save();
    const res = await addWikidoChildScene({
      topicId: selectedId.value,
      parentSceneId: parentId,
      label: layerLabel.value.trim(),
      focus: layerFocus.value.trim(),
    });
    message.value = `Added deeper scene “${res.title}” (${res.hotspots} hotspots). Generate its artwork, then publish.`;
    layerLabel.value = "";
    layerFocus.value = "";
    const fresh = await fetchAllWikidoTopicsAdmin();
    topics.value = fresh;
    loadSelected();
    selectedSceneId.value = res.sceneId;
    layerParentId.value = res.sceneId;
  } catch (e) {
    error.value = e?.message?.replace("internal: ", "") || "Could not add the layer.";
  } finally {
    layerBusy.value = false;
  }
}

async function togglePublish() {
  const next = selectedDoc.value?.status === "published" ? "draft" : "published";
  // unsaved edits ship with the publish save
  if (dirty.value) await save();
  try {
    await setWikidoTopicStatus({ topicId: selectedId.value, status: next });
    message.value = next === "published" ? "Published! Families can now explore this world." : "Moved back to draft.";
    await refresh(true);
  } catch (e) {
    error.value = e?.message?.replace("failed-precondition: ", "") || "Status change failed.";
  }
}

async function removeTopic() {
  if (!window.confirm(`Delete “${selectedDoc.value?.title}”? Families will no longer see it, and all of its artwork and voice recordings are permanently deleted. This cannot be undone.`)) return;
  error.value = "";
  try {
    const res = await deleteWikidoTopic({ topicId: selectedId.value });
    selectedId.value = "";
    form.value = null;
    await refresh(false);
    message.value = res?.filesFailed
      ? "Topic deleted, but some of its files could not be removed from storage — they can be cleaned up later."
      : `Topic deleted along with its ${res?.filesDeleted ?? 0} artwork and audio file${res?.filesDeleted === 1 ? "" : "s"}.`;
  } catch (e) {
    error.value = e?.message?.replace("internal: ", "") || "Delete failed.";
  }
}

// ── hotspot editing helpers ───────────────────────────────────────────────────
function slug(text, fallback) {
  const s = String(text || "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s || fallback;
}

function addHotspot(scene) {
  const n = scene.hotspots.length + 1;
  let id = `spot-${n}`;
  while (scene.hotspots.some((h) => h.id === id)) id = `spot-${n}-${Math.floor(Math.random() * 90 + 10)}`;
  scene.hotspots.push({
    id,
    label: "New spot",
    blurb: "A short teaser",
    x: 50,
    y: 50,
    info: { title: "New discovery", body: ["Explain it in one child-friendly paragraph.", "Add a second paragraph if it needs more."], fact: "One surprising, true fact." },
  });
  selectedSceneId.value = scene.id; // no-op if already selected
  selectedSpotId.value = id;        // open the new spot so it can be edited straight away
  // by default the agent writes the details for a fresh spot — placeholders are
  // just the fallback if the agent is unavailable
  const created = scene.hotspots[scene.hotspots.length - 1];
  writeSpotWithAgent(created, { auto: true });
}

// The agent writes one spot's card (label, teaser, card text, fun fact) from
// the scene + picture context. Used automatically for new spots and on demand
// via ✦. Position, spot kind, doorway and recordings are never touched.
const spotAgentBusy = ref("");
async function writeSpotWithAgent(spot, { auto = false } = {}) {
  if (spotAgentBusy.value) return;
  spotAgentBusy.value = spot.id;
  if (!auto) { error.value = ""; }
  try {
    const res = await generateWikidoSpotDetails({
      topicId: selectedId.value,
      sceneId: selectedSceneId.value,
      hotspotId: spot.id,
    });
    const d = res.spot || {};
    if (d.label) spot.label = d.label;
    if (d.blurb) spot.blurb = d.blurb;
    if (d.info) spot.info = { ...spot.info, ...d.info };
    if (!auto) message.value = `Agent wrote the details for “${spot.label}”.`;
    else message.value = `Agent wrote the details for “${spot.label}” — adjust anything you like.`;
  } catch (e) {
    const msg = String(e?.message || e).replace(/^[a-z-]+: /i, "");
    const text = `The agent couldn’t write “${spot.label}” (${msg}). You can write it by hand, or press ✦ to try again.`;
    if (auto) message.value = text;
    else error.value = text;
  } finally {
    spotAgentBusy.value = "";
  }
}

function removeHotspot(scene, spotId) {
  scene.hotspots = scene.hotspots.filter((h) => h.id !== spotId);
}

function moveHotspot(scene, index, dir) {
  const swap = dir === "up" ? index - 1 : index + 1;
  if (swap < 0 || swap >= scene.hotspots.length) return;
  [scene.hotspots[index], scene.hotspots[swap]] = [scene.hotspots[swap], scene.hotspots[index]];
}

// ── plain-language view model ─────────────────────────────────────────────────
const sceneStatusOf = (id) => sceneStatus(form.value.scenes, form.value.scenes[id]);
const outcomeOf = (spot) => spotOutcome(form.value.scenes, spot);
const health = computed(() => (form.value ? topicHealth(form.value.scenes, form.value.rootSceneId) : []));
const showHealth = ref(false);
const hasArt = (scene) => String(scene?.image?.src || "").startsWith("http");

// ── spots: numbered pins on the picture ───────────────────────────────────────
const selectedSpotId = ref("");
watch(selectedSceneId, () => { selectedSpotId.value = ""; });

function selectSpot(spotId) {
  selectedSpotId.value = selectedSpotId.value === spotId ? "" : spotId;
  if (selectedSpotId.value) {
    requestAnimationFrame(() => document.getElementById(`spot-row-${spotId}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  }
}

// drag a pin → x/y percentages of the picture (what the explorer renders)
let drag = null;
const stageEl = ref(null);
const { onArtworkLoad, pinStyle, picturePercent } = useCoverPlacement(stageEl);

function startPinDrag(event, spot) {
  const stage = event.currentTarget.closest(".stage");
  if (!stage) return;
  drag = { spot, rect: stage.getBoundingClientRect(), moved: false };
  event.currentTarget.setPointerCapture?.(event.pointerId);
}
function movePinDrag(event) {
  if (!drag) return;
  drag.moved = true;
  // invert the cover transform: pointer position → picture percentages
  const { x, y } = picturePercent(event.clientX, event.clientY, drag.rect);
  drag.spot.x = x;
  drag.spot.y = y;
}
function endPinDrag(spot) {
  const wasDrag = drag?.moved;
  drag = null;
  if (!wasDrag) selectSpot(spot.id);
}

// switch a spot between "shows a fact" and "opens a scene"
function setSpotKind(spot, kind) {
  if (kind === "fact") {
    delete spot.childSceneId;
    return;
  }
  if (!spot.childSceneId) {
    const first = orderedScenes.value.find((s) => s.id !== selectedSceneId.value);
    if (first) spot.childSceneId = first.id;
  }
}

// ── add more depth (one click, topic-wide) ──────────────────────────────────
// The agent assesses the WHOLE topic and proposes new deeper scenes; the
// studio builds each proposed branch through the guarded child-scene callable,
// so everything lands as draft content the curator can review or undo.
const depthBusy = ref(false);
const depthNote = ref("");
async function addMoreDepth() {
  if (depthBusy.value) return;
  depthBusy.value = true;
  error.value = "";
  try {
    if (dirty.value) { const ok = await save(); if (!ok) return; }
    message.value = "";
    depthNote.value = "Assessing the topic…";
    const plan = await planWikidoDepth({ topicId: selectedId.value, maxScenes: 3 });
    if (!plan.branches.length) {
      message.value = "The curator assessed the topic — every branch already has good depth. Nothing added.";
      return;
    }
    let added = 0;
    const createdScenes = [];
    const failedItems = [];
    for (const branch of plan.branches) {
      const outline = withKeys(branch.outline);
      depthNote.value = `Writing “${branch.outline[0]?.label || "new scenes"}” under “${branch.parentTitle}”…`;
      const run = await runOutline({
        outline,
        parentSceneId: branch.parentSceneId,
        createScene: addWikidoChildScene,
        onUpdate: (items) => {
          const s = summarizeRun(items);
          depthNote.value = `Writing scenes… ${s.done} done${s.failed ? `, ${s.failed} failed` : ""}.`;
        },
      });
      added += run.created.length;
      createdScenes.push(...run.created);
      for (const item of run.items) {
        if (item.status === "failed") failedItems.push(`${item.label}: ${item.error}`);
      }
    }
    await refresh(true);
    loadSelected();
    if (createdScenes[0] && form.value.scenes[createdScenes[0]]) selectedSceneId.value = createdScenes[0];
    if (added && failedItems.length) {
      error.value = `Some scenes failed: ${failedItems.slice(0, 3).join(" · ")} — press ✦ Add more depth again for the rest.`;
    }
    if (added) {
      message.value = `Added ${added} new deeper scenes with full content — paint them with “Generate artwork”.`;
    } else {
      error.value = error.value || `No scenes could be added: ${failedItems[0] || "the assessment came back empty — try again."}`;
    }
  } catch (e) {
    error.value = e?.message?.replace("internal: ", "") || "Could not add more depth.";
  } finally {
    depthBusy.value = false;
    depthNote.value = "";
  }
}
// ── scoped delete ─────────────────────────────────────────────────────────────
const deleteTarget = ref(""); // sceneId awaiting confirmation
const deleteInfo = computed(() => (deleteTarget.value && form.value ? deletePlan(form.value.scenes, deleteTarget.value) : null));

function askDeleteScene(sceneId) {
  if (sceneId === form.value.rootSceneId) {
    error.value = "The first scene is the entrance to the topic and cannot be deleted.";
    return;
  }
  deleteTarget.value = sceneId;
}
function confirmDeleteScene(withDeeper) {
  const id = deleteTarget.value;
  form.value.scenes = deleteSceneFrom(form.value.scenes, id, { withDeeper });
  if (!form.value.scenes[selectedSceneId.value]) selectedSceneId.value = form.value.rootSceneId;
  deleteTarget.value = "";
  message.value = "Scene removed — save your edits to keep the change.";
}
</script>

<template>
  <div class="studio">
    <!-- create -->
    <section class="create card">
      <div>
        <h2>Generate a new world</h2>
        <p>Any subject works — science, history, philosophy, a concept. The studio writes the scene tree, the child-friendly explanations, and the artwork prompts; you curate and publish.</p>
      </div>
      <form class="create-form" @submit.prevent="createTopic">
        <input v-model="newTitle" type="text" placeholder="Topic title — e.g. “The Human Body”" aria-label="Topic title" />
        <input v-model="newAngle" type="text" placeholder="Optional focus — e.g. “how cells fight germs”" aria-label="Optional focus" />
        <button class="btn primary" type="submit" :disabled="creating || !newTitle.trim()">
          {{ creating ? "Designing the world…" : "Generate topic" }}
        </button>
      </form>
    </section>

    <p v-if="message" class="note ok">{{ message }}</p>
    <p v-if="error" class="note err">{{ error }}</p>

    <!-- topics list -->
    <section class="list">
      <p v-if="loading" class="muted">Loading topics…</p>
      <p v-else-if="!topics.length" class="muted">No studio topics yet — generate the first one above.</p>
      <div
        v-for="t in topics"
        :key="t.id"
        class="topic-chip"
        :class="{ active: t.id === selectedId }"
      >
        <button type="button" class="chip-main" @click="selectedId = t.id; loadSelected()">
          <span class="chip-emoji">{{ t.emoji || "🌟" }}</span>
          <span class="chip-body">
            <span class="chip-title">{{ t.title }}</span>
            <span class="chip-meta">{{ Object.keys(t.scenes || {}).length }} scenes · {{ t.discoveryCount || 0 }} discoveries</span>
          </span>
          <span class="chip-status" :class="t.status">{{ t.status }}</span>
        </button>
        <span v-if="topics.length > 1" class="chip-move">
          <button type="button" class="tree-act" :disabled="chipBusy === t.id" :aria-label="`Move ${t.title} earlier on the shelf`" title="Move earlier on the shelf" @click.stop="moveTopicChip(t.id, 'up')">↑</button>
          <button type="button" class="tree-act" :disabled="chipBusy === t.id" :aria-label="`Move ${t.title} later on the shelf`" title="Move later" @click.stop="moveTopicChip(t.id, 'down')">↓</button>
        </span>
      </div>
    </section>

    <!-- workspace -->
    <section v-if="form" class="workspace">
      <header class="ws-toolbar">
        <div>
          <h2>{{ form.emoji }} {{ form.title }} <span class="status-pill" :class="selectedDoc?.status">{{ selectedDoc?.status }}</span></h2>
          <p>{{ Object.keys(form.scenes).length }} scenes · {{ missingArtwork.length }} awaiting artwork <span v-if="dirty">· unsaved edits</span></p>
        </div>
        <div class="toolbar-actions">
          <button class="btn primary" :disabled="depthBusy" title="The agent assesses the whole topic and adds new deeper scenes with content (unsaved edits are saved first)" @click="addMoreDepth">
            {{ depthBusy ? (depthNote || "Assessing the topic…") : "✦ Add more depth" }}
          </button>
          <button class="btn" :disabled="generatingImages || !missingArtwork.length" @click="generateAllImages">
            {{ generatingImages ? "Painting scenes…" : missingArtwork.length ? `Generate artwork (${missingArtwork.length})` : "Artwork complete ✓" }}
          </button>
          <button class="btn" :disabled="saving || !dirty" @click="save">{{ saving ? "Saving…" : "Save edits" }}</button>
          <button class="btn primary" :disabled="dirty" @click="togglePublish">
            {{ selectedDoc?.status === "published" ? "Unpublish" : "Publish to families" }}
          </button>
          <button class="btn danger" @click="removeTopic">Delete</button>
        </div>
      </header>
      <p v-if="dirty" class="note warn">You have unsaved edits — save before publishing so families see your changes.</p>

      <!-- voiceovers: recorded locally with the Kokoro bridge -->
      <section class="voiceover">
        <div class="vo-head">
          <span class="vo-dot" :class="{ on: bridge.online }"></span>
          <div class="vo-copy">
            <strong>Voiceovers</strong>
            <span v-if="bridge.online">
              {{ bridge.engine }} bridge online ({{ bridge.voice }}) · {{ voStats.recorded }}/{{ voStats.total }} clips recorded
            </span>
            <span v-else>
              Offline — start the local bridge with <code>npm run wikido:bridge</code> to record studio-quality narration (Kokoro).
            </span>
          </div>
          <label v-if="bridge.online" class="vo-force">
            <input v-model="voForce" type="checkbox" /> re-record all
          </label>
          <button
            v-if="bridge.online"
            class="btn primary"
            :disabled="voBusy || !voStats.total"
            @click="generateVoiceovers"
          >
            {{ voBusy ? `Recording… ${voProgress.done}/${voProgress.total}` : voStats.recorded ? `Record missing (${voStats.total - voStats.recorded})` : `Record all ${voStats.total} clips` }}
          </button>
        </div>
        <p v-if="voFailed.length" class="muted">Failed clips: {{ voFailed.join(", ") }} — try again.</p>
      </section>

      <p class="model-line">
        A topic is a <strong>map of scenes</strong>. Each scene is a picture with <strong>spots</strong>.
        A spot either <strong>shows a fact</strong> or <strong>opens another scene</strong>.
      </p>

      <section v-if="health.length" class="health" :class="{ open: showHealth }">
        <button type="button" class="health-head" :aria-expanded="showHealth" @click="showHealth = !showHealth">
          <span class="health-badge">{{ health.length }}</span>
          {{ health.length === 1 ? "thing to fix before publishing" : "things to fix before publishing" }}
          <span class="health-chev">{{ showHealth ? "▴" : "▾" }}</span>
        </button>
        <ul v-if="showHealth">
          <li v-for="(issue, i) in health" :key="i" :class="issue.level">
            <span>{{ issue.text }}</span>
            <button type="button" class="link-btn" @click="selectScene(issue.sceneId)">Go to scene</button>
          </li>
        </ul>
      </section>

      <div class="ws-grid">
        <!-- map of scenes -->
        <nav class="scene-tree" aria-label="Map of scenes">
          <h3 class="pane-title">Map of scenes</h3>
          <div
            v-for="{ id, depth } in orderedScenes"
            :key="id"
            class="scene-row"
            :class="{ active: id === selectedSceneId, nested: depth > 0 }"
            :style="{ marginLeft: `${Math.min(depth, 4) * 0.9}rem` }"
          >
            <button type="button" class="scene-main" :aria-current="id === selectedSceneId" @click="selectScene(id)">
              <span class="scene-thumb">
                <img v-if="hasArt(form.scenes[id])" :src="form.scenes[id].image.src" alt="" />
                <span v-else class="thumb-empty">🖼</span>
              </span>
              <span class="scene-name">{{ form.scenes[id].title }}</span>
              <span class="status-dot" :class="sceneStatusOf(id).key" :title="sceneStatusOf(id).label" :aria-label="sceneStatusOf(id).label"></span>
            </button>
            <span class="scene-sub">
              {{ form.scenes[id].hotspots.length }} {{ form.scenes[id].hotspots.length === 1 ? "spot" : "spots" }}
              <template v-if="id === form.rootSceneId"> · entrance</template>
            </span>
            <div v-if="id === selectedSceneId" class="scene-actions">
              <button v-if="form.scenes[id].hotspots.length < 8" type="button" class="mini add" @click="startDeeperLayer(id)">＋ Add scene under this</button>
              <button type="button" class="mini" :disabled="!canMove(id, 'up')" title="Show earlier among its siblings" @click="moveScene(id, 'up')">↑ Earlier</button>
              <button type="button" class="mini" :disabled="!canMove(id, 'down')" title="Show later among its siblings" @click="moveScene(id, 'down')">↓ Later</button>
            </div>
          </div>
          <p class="legend">
            <span class="status-dot ready"></span> ready
            <span class="status-dot needs-artwork"></span> needs artwork
            <span class="status-dot needs-spots"></span> needs attention
          </p>
        </nav>

        <!-- scene editor -->
        <div v-if="selectedScene" class="scene-editor">
          <p class="crumb">
            <template v-if="incomingDoorways.length">Opened from: {{ incomingDoorways.join(" · ") }}</template>
            <template v-else-if="selectedScene.id === form.rootSceneId">This is the entrance — the first picture a child sees.</template>
            <template v-else>⚠ No spot opens this scene yet, so children can’t reach it.</template>
          </p>

          <!-- the picture IS the editor: numbered pins are the spots -->
          <div ref="stageEl" class="stage" :class="{ empty: !hasArt(selectedScene) }">
            <img v-if="hasArt(selectedScene)" :src="selectedScene.image.src" alt="Scene artwork" draggable="false" @load="onArtworkLoad" />
            <div v-else class="art-empty">
              <p>No artwork yet — spots can still be placed, then paint the picture.</p>
              <button class="btn primary" :disabled="imageBusy === selectedScene.id" @click="regenerateSceneImage(selectedScene.id)">
                {{ imageBusy === selectedScene.id ? "Painting…" : "Generate artwork" }}
              </button>
            </div>
            <button
              v-for="(spot, i) in selectedScene.hotspots"
              :key="spot.id"
              type="button"
              class="pin"
              :class="[outcomeOf(spot).kind, { selected: spot.id === selectedSpotId }]"
              :style="pinStyle(spot.x, spot.y)"
              :aria-label="`Spot ${i + 1}: ${spot.label}`"
              :title="`${spot.label} — ${outcomeOf(spot).text}. Drag to move.`"
              @pointerdown.prevent="startPinDrag($event, spot)"
              @pointermove="movePinDrag"
              @pointerup="endPinDrag(spot)"
              @pointercancel="endPinDrag(spot)"
            >{{ i + 1 }}</button>
            <button
              v-if="hasArt(selectedScene)"
              class="btn art-regen"
              :disabled="imageBusy === selectedScene.id"
              @click="regenerateSceneImage(selectedScene.id)"
            >
              {{ imageBusy === selectedScene.id ? "Repainting…" : "Regenerate artwork" }}
            </button>
          </div>
          <p class="stage-hint">Drag a numbered pin to place it. Click a pin to edit that spot.</p>

          <label class="field">Scene title
            <input v-model="selectedScene.title" type="text" />
          </label>
          <label class="field">Narration (read aloud when the scene opens)
            <textarea v-model="selectedScene.narration" rows="3"></textarea>
          </label>
          <label class="field">Artwork prompt (what the picture shows — landmarks left/centre/right)
            <textarea v-model="selectedScene.artPrompt" rows="3"></textarea>
          </label>

          <h3 class="pane-title">Spots on this picture ({{ selectedScene.hotspots.length }})</h3>
          <div
            v-for="(spot, spotIndex) in selectedScene.hotspots"
            :id="`spot-row-${spot.id}`"
            :key="spot.id"
            class="spot"
            :class="{ selected: spot.id === selectedSpotId }"
          >
            <div class="spot-head">
              <button type="button" class="spot-toggle" :aria-expanded="spot.id === selectedSpotId" @click="selectSpot(spot.id)">
                <span class="spot-num" :class="outcomeOf(spot).kind">{{ spotIndex + 1 }}</span>
                <span class="spot-label">
                  {{ spot.label }}
                  <span v-if="spotNeedsDetails(spot).needs" class="needs-badge" title="Placeholder details — press ✦ and the agent writes them">✦ needs details</span>
                </span>
                <span class="outcome" :class="outcomeOf(spot).kind">
                  <span aria-hidden="true">{{ outcomeOf(spot).kind === "fact" ? "💡" : outcomeOf(spot).kind === "scene" ? "🚪" : "⚠" }}</span>
                  {{ outcomeOf(spot).text }}
                </span>
              </button>
              <button
                type="button"
                class="tree-act agent"
                :disabled="spotAgentBusy === spot.id"
                :aria-label="`Agent writes the details for ${spot.label}`"
                :title="spotAgentBusy === spot.id ? 'The agent is writing…' : '✦ Let the agent write these details'"
                @click.stop="writeSpotWithAgent(spot)"
              >{{ spotAgentBusy === spot.id ? "✦…" : "✦" }}</button>
              <span class="spot-order">
                <button type="button" class="tree-act" :disabled="spotIndex === 0" :aria-label="`Move ${spot.label} earlier`" @click="moveHotspot(selectedScene, spotIndex, 'up')">↑</button>
                <button type="button" class="tree-act" :disabled="spotIndex === selectedScene.hotspots.length - 1" :aria-label="`Move ${spot.label} later`" @click="moveHotspot(selectedScene, spotIndex, 'down')">↓</button>
              </span>
              <button type="button" class="spot-del" :aria-label="`Remove spot ${spot.label}`" title="Remove this spot (the scene it opens, if any, is kept)" @click="removeHotspot(selectedScene, spot.id)">Remove</button>
            </div>

            <div v-if="spot.id === selectedSpotId" class="spot-body">
              <label class="field">Spot name
                <input v-model="spot.label" type="text" />
              </label>
              <fieldset class="kind">
                <legend>When a child taps this spot…</legend>
                <label><input type="radio" :name="`kind-${spot.id}`" :checked="!spot.childSceneId" @change="setSpotKind(spot, 'fact')" /> 💡 It shows a fact card</label>
                <label><input type="radio" :name="`kind-${spot.id}`" :checked="!!spot.childSceneId" @change="setSpotKind(spot, 'scene')" /> 🚪 It opens another scene</label>
              </fieldset>
              <label v-if="spot.childSceneId" class="field">Opens this scene
                <select v-model="spot.childSceneId">
                  <option v-for="s in orderedScenes" :key="s.id" :value="s.id" :disabled="s.id === selectedSceneId">{{ form.scenes[s.id].title }}</option>
                </select>
              </label>
              <label class="field">Teaser (shown when a child hovers the spot)
                <input v-model="spot.blurb" type="text" />
              </label>
              <label class="field">Card title
                <input v-model="spot.info.title" type="text" />
              </label>
              <label class="field">Card text (one paragraph per line)
                <textarea :value="spot.info.body.join('\n')" rows="4" @input="spot.info.body = $event.target.value.split('\n').map((l) => l.trim()).filter(Boolean)"></textarea>
              </label>
              <label class="field">Fun fact
                <input v-model="spot.info.fact" type="text" />
              </label>
              <details class="advanced">
                <summary>Exact position</summary>
                <div class="field-row">
                  <label class="field">Across (%)<input v-model.number="spot.x" type="number" min="0" max="100" /></label>
                  <label class="field">Down (%)<input v-model.number="spot.y" type="number" min="0" max="100" /></label>
                </div>
              </details>
            </div>
          </div>
          <button class="btn" @click="addHotspot(selectedScene)">＋ Add a spot to this picture</button>

          <!-- grow -->
          <section class="grow card">
            <h3 class="pane-title">Add a new scene under “{{ layerParentTitle }}”</h3>
            <p class="muted">
              The studio writes a new scene and adds a spot to <strong>{{ layerParentTitle }}</strong>’s picture that opens it.
              Nothing is published, and no artwork is painted until you ask. Use <em>＋ Add scene under this</em> in the map to pick a different parent.
            </p>
            <div class="suggest">
              <button type="button" class="btn" :disabled="suggestBusy || layerBusy" @click="suggestScenes">
                {{ suggestBusy ? "Thinking of ideas…" : suggestions.length ? "✨ Suggest different ideas" : "✨ Suggest scenes for me" }}
              </button>
              <div v-if="suggestions.length" class="chips" role="list">
                <button v-for="s in suggestions" :key="s.label" type="button" role="listitem" class="chip" :disabled="layerBusy" :title="s.focus" @click="addSuggested(s)">
                  <strong>＋ {{ s.label }}</strong>
                  <span>{{ s.why || s.focus }}</span>
                </button>
              </div>
              <p v-if="suggestions.length" class="muted">Click an idea to create that scene straight away, or write your own below.</p>
            </div>
            <form class="layer-form" @submit.prevent="addLayer">
              <input v-model="layerLabel" type="text" placeholder="Scene name (optional) — e.g. “Inside a Volcano”" aria-label="Scene name" />
              <input v-model="layerFocus" type="text" placeholder="What should it teach? (optional) — e.g. “how lava is made”" aria-label="What should the scene teach" />
              <button class="btn primary" type="submit" :disabled="layerBusy">
                {{ layerBusy ? "Writing the scene…" : "Create scene with AI" }}
              </button>
            </form>
          </section>

          <section class="grow card builder">
            <h3 class="pane-title">Or plan a whole branch at once</h3>
            <p class="muted">
              The studio drafts an outline of new scenes under <strong>{{ layerParentTitle }}</strong>. Review and edit it first — nothing is created until you press Build.
            </p>
            <div class="plan-controls">
              <label class="field inline">Scenes
                <select v-model.number="planSize" :disabled="planBusy || building">
                  <option :value="4">about 4</option>
                  <option :value="6">about 6</option>
                  <option :value="8">about 8</option>
                  <option :value="12">up to 12</option>
                </select>
              </label>
              <button class="btn" :disabled="planBusy || building" @click="draftOutline">
                {{ planBusy ? "Drafting outline…" : outline.length ? "✨ Draft a different outline" : "✨ Draft an outline" }}
              </button>
            </div>

            <div v-if="outline.length" class="outline">
              <p class="outline-title">Proposed scenes under “{{ planParentTitle }}” — edit names, remove what you don’t want:</p>
              <div v-for="row in outlineRows" :key="row.node.key" class="outline-row" :style="{ marginLeft: row.depth * 1.2 + 'rem' }">
                <span class="branch-mark" aria-hidden="true">{{ row.depth ? "└" : "●" }}</span>
                <div class="outline-fields">
                  <input v-model="row.node.label" type="text" class="o-label" aria-label="Scene name" />
                  <span class="o-focus">{{ row.node.focus }}</span>
                </div>
                <button type="button" class="spot-del" :aria-label="`Remove ${row.node.label}`" title="Remove this scene and any scenes under it from the plan" @click="dropOutlineNode(row.node.key)">Remove</button>
              </div>
              <p v-if="planTrimmed" class="muted">The draft was trimmed to keep it a sensible size (depth, breadth or duplicates).</p>
              <p class="muted">
                Will create <strong>{{ outlineCount }}</strong> {{ outlineCount === 1 ? "scene" : "scenes" }}, one at a time (about {{ Math.max(1, Math.round(outlineCount * 0.5)) }} min).
                They are drafts — nothing is published and no artwork is painted yet.
              </p>
              <div class="outline-actions">
                <button class="btn primary" :disabled="building" @click="buildOutline">Build {{ outlineCount }} {{ outlineCount === 1 ? "scene" : "scenes" }}</button>
                <button class="btn" :disabled="building" @click="outline = []">Discard outline</button>
              </div>
            </div>

            <div v-if="buildItems.length" class="build-log" aria-live="polite">
              <p class="outline-title">
                {{ building ? "Building…" : "Last build" }}
                <span class="muted">{{ buildSummary.done }} built<template v-if="buildSummary.failed"> · {{ buildSummary.failed }} failed</template><template v-if="buildSummary.skipped"> · {{ buildSummary.skipped }} skipped</template></span>
              </p>
              <ul>
                <li v-for="i in buildItems" :key="i.key" :class="i.status">
                  <span class="b-icon" aria-hidden="true">{{ { pending: "○", running: "◐", done: "✓", failed: "✕", skipped: "–" }[i.status] }}</span>
                  <span>{{ i.label }}</span>
                  <span v-if="i.status === 'failed'" class="b-err">{{ i.error }}</span>
                  <span v-else-if="i.status === 'skipped'" class="b-err">skipped because its parent scene failed</span>
                </li>
              </ul>
              <div class="outline-actions">
                <button v-if="building" class="btn" :disabled="stopRequested" @click="stopRequested = true">{{ stopRequested ? "Stopping after this scene…" : "Stop after this scene" }}</button>
                <button v-if="!building && lastBuild" class="btn danger" @click="undoBuild">Undo this build ({{ lastBuild.created.length }})</button>
              </div>
            </div>
          </section>

          <div v-if="selectedScene.id !== form.rootSceneId" class="danger-zone">
            <button class="btn danger" @click="askDeleteScene(selectedScene.id)">Delete this scene…</button>
          </div>
        </div>
      </div>

      <!-- delete confirmation: states exactly what will go -->
      <div v-if="deleteInfo" class="modal-back" @click.self="deleteTarget = ''">
        <div class="modal" role="dialog" aria-modal="true" aria-label="Delete scene">
          <h3>Delete “{{ form.scenes[deleteTarget].title }}”?</h3>
          <ul class="plan">
            <li v-if="deleteInfo.openedBy.length">
              Spots that open it ({{ deleteInfo.openedBy.map((o) => `“${o.label}” in ${o.sceneTitle}`).join(", ") }}) will become plain fact spots.
            </li>
            <li v-if="deleteInfo.deeper.length">
              It has {{ deleteInfo.deeper.length }} deeper {{ deleteInfo.deeper.length === 1 ? "scene" : "scenes" }}: {{ deleteInfo.deeper.join(", ") }}.
            </li>
            <li v-else>No deeper scenes are affected.</li>
            <li>Unsaved until you press “Save edits”.</li>
          </ul>
          <div class="modal-actions">
            <button class="btn" @click="deleteTarget = ''">Cancel</button>
            <button class="btn danger" @click="confirmDeleteScene(false)">
              {{ deleteInfo.deeper.length ? "Delete only this scene" : "Delete scene" }}
            </button>
            <button v-if="deleteInfo.deeper.length" class="btn danger" @click="confirmDeleteScene(true)">Delete it and its deeper scenes</button>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.studio { display: flex; flex-direction: column; gap: 1rem; }

.create { display: flex; flex-direction: column; gap: 0.75rem; padding: 1rem 1.25rem; }
.create h2 { margin: 0 0 0.25rem; }
.create p { margin: 0; color: var(--text2); font-size: 0.9rem; }
.create-form { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.create-form input { flex: 1 1 220px; }

.note { margin: 0; padding: 0.55rem 0.85rem; border-radius: 10px; font-size: 0.9rem; }
.note.ok { background: #DCFCE7; color: #14532D; }
.note.err { background: #FEE2E2; color: #991B1B; }
.note.warn { background: #FEF9C3; color: #713F12; }
.muted { color: var(--muted); font-size: 0.88rem; }

.list { display: flex; flex-direction: column; gap: 0.45rem; max-width: 560px; }
.topic-chip {
  display: flex; align-items: center; gap: 0.25rem;
  border: 1.5px solid var(--border); background: #fff; border-radius: 14px;
  padding: 0.25rem 0.35rem 0.25rem 0.6rem;
}
.topic-chip.active { border-color: var(--primary); background: var(--primary-soft); }
.chip-main {
  display: flex; align-items: center; gap: 0.55rem; flex: 1; min-width: 0;
  border: none; background: none; cursor: pointer; font-family: inherit; text-align: left; padding: 0.35rem 0.2rem;
}
.chip-emoji { font-size: 1.3rem; }
.chip-body { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.chip-title { font-weight: 700; font-size: 0.9rem; color: var(--text); }
.chip-meta { font-size: 0.72rem; color: var(--muted); }
.chip-status { font-size: 0.68rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; border-radius: 999px; padding: 0.18rem 0.5rem; }
.chip-status.published { background: #DCFCE7; color: #14532D; }
.chip-status.draft { background: #FEF3C7; color: #92400E; }
.chip-move { display: flex; flex-direction: column; gap: 1px; padding-right: 0.2rem; }

.workspace { display: flex; flex-direction: column; gap: 0.9rem; }

.voiceover {
  display: flex; flex-direction: column; gap: 0.5rem;
  border: 1.5px solid var(--border); border-radius: 14px; padding: 0.7rem 1rem; background: #fff;
}
.vo-head { display: flex; align-items: center; gap: 0.7rem; flex-wrap: wrap; }
.vo-dot { width: 10px; height: 10px; border-radius: 50%; background: #D1D5DB; flex-shrink: 0; }
.vo-dot.on { background: #16A34A; box-shadow: 0 0 0 3px #DCFCE7; }
.vo-copy { display: flex; flex-direction: column; gap: 0.1rem; font-size: 0.85rem; }
.vo-copy code { background: #F3F0FA; border-radius: 6px; padding: 0.05rem 0.35rem; font-size: 0.78rem; }
.vo-copy strong { font-size: 0.92rem; }
.vo-force { display: flex; align-items: center; gap: 0.3rem; font-size: 0.78rem; color: var(--text2); margin-left: auto; }
.ws-toolbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
.ws-toolbar h2 { margin: 0; font-size: 1.3rem; }
.ws-toolbar p { margin: 0.2rem 0 0; color: var(--muted); font-size: 0.85rem; }
.toolbar-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.status-pill { font-size: 0.68rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; border-radius: 999px; padding: 0.2rem 0.55rem; vertical-align: middle; }
.status-pill.published { background: #DCFCE7; color: #14532D; }
.status-pill.draft { background: #FEF3C7; color: #92400E; }

.model-line { margin: 0; padding: 0.6rem 0.9rem; border-radius: 12px; background: var(--primary-soft); color: var(--text2); font-size: 0.88rem; }
.model-line strong { color: var(--primary); }

.health { border: 1.5px solid #FDE68A; background: #FFFBEB; border-radius: 12px; }
.health-head { display: flex; align-items: center; gap: 0.5rem; width: 100%; border: none; background: none; cursor: pointer; font-family: inherit; font-weight: 700; font-size: 0.88rem; color: #92400E; padding: 0.55rem 0.85rem; text-align: left; }
.health-badge { background: #F59E0B; color: #fff; border-radius: 999px; min-width: 1.4rem; text-align: center; padding: 0.05rem 0.4rem; font-size: 0.78rem; }
.health-chev { margin-left: auto; }
.health ul { list-style: none; margin: 0; padding: 0 0.85rem 0.6rem; display: flex; flex-direction: column; gap: 0.35rem; }
.health li { display: flex; align-items: center; justify-content: space-between; gap: 0.6rem; font-size: 0.84rem; color: var(--text2); }
.health li.error span::before { content: "● "; color: #DC2626; }
.health li.warn span::before { content: "● "; color: #F59E0B; }
.link-btn { border: none; background: none; color: var(--primary); cursor: pointer; font-family: inherit; font-size: 0.8rem; font-weight: 700; white-space: nowrap; }

.ws-grid { display: grid; grid-template-columns: 290px 1fr; gap: 1.25rem; align-items: start; }
@media (max-width: 900px) { .ws-grid { grid-template-columns: 1fr; } }

.pane-title { margin: 0.4rem 0 0.2rem; font-size: 0.95rem; color: var(--text); }

/* map of scenes */
.scene-tree { display: flex; flex-direction: column; gap: 0.3rem; position: sticky; top: 4.5rem; }
.scene-tree .pane-title { margin-top: 0; }
.scene-row {
  display: flex; flex-direction: column; gap: 0.1rem;
  border: 1.5px solid var(--border); background: #fff; border-radius: 12px; padding: 0.3rem 0.45rem;
  position: relative;
}
.scene-row.nested::before { content: ""; position: absolute; left: -0.55rem; top: 50%; width: 0.45rem; border-top: 2px solid var(--border); }
.scene-row.nested::after { content: ""; position: absolute; left: -0.55rem; top: -0.4rem; bottom: 50%; border-left: 2px solid var(--border); }
.scene-row.active { border-color: var(--primary); background: var(--primary-soft); }
.scene-main {
  display: flex; align-items: center; gap: 0.5rem; min-width: 0;
  border: none; background: none; cursor: pointer; font-family: inherit; text-align: left; padding: 0.1rem;
}
.scene-thumb { width: 42px; height: 26px; border-radius: 6px; overflow: hidden; flex-shrink: 0; display: grid; place-items: center; background: #F3F0FA; }
.scene-thumb img { width: 100%; height: 100%; object-fit: cover; }
.thumb-empty { font-size: 0.8rem; color: var(--muted); }
.scene-name { flex: 1; font-size: 0.86rem; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
.scene-sub { font-size: 0.72rem; color: var(--muted); padding-left: 0.1rem; }
.scene-actions { display: flex; flex-wrap: wrap; gap: 0.3rem; padding-top: 0.25rem; }
.mini { border: 1px solid var(--border); background: #fff; border-radius: 8px; padding: 0.2rem 0.5rem; font-size: 0.72rem; font-weight: 700; cursor: pointer; font-family: inherit; color: var(--text2); }
.mini:hover:not(:disabled) { border-color: var(--primary); color: var(--primary); }
.mini:disabled { opacity: 0.35; cursor: default; }
.mini.add { color: #15803D; border-color: #BBF7D0; background: #F0FDF4; }
.legend { margin: 0.3rem 0 0; font-size: 0.7rem; color: var(--muted); display: flex; gap: 0.6rem; align-items: center; flex-wrap: wrap; }

.status-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; display: inline-block; background: #9CA3AF; }
.status-dot.ready { background: #16A34A; }
.status-dot.needs-artwork { background: #F59E0B; }
.status-dot.needs-spots, .status-dot.broken-link { background: #DC2626; }

.tree-act {
  border: none; background: none; cursor: pointer; color: var(--muted);
  font-size: 0.8rem; line-height: 1; padding: 0.15rem 0.35rem; border-radius: 6px; font-family: inherit;
}
.tree-act:hover:not(:disabled) { background: var(--primary-soft); color: var(--primary); }
.tree-act:disabled { opacity: 0.25; cursor: default; }

/* scene editor */
.scene-editor { display: flex; flex-direction: column; gap: 0.75rem; min-width: 0; }
.crumb { margin: 0; font-size: 0.82rem; color: var(--text2); }

.stage { position: relative; border-radius: 14px; overflow: hidden; background: #F3F0FA; aspect-ratio: 16 / 9; touch-action: none; user-select: none; }
.stage img { width: 100%; height: 100%; object-fit: cover; display: block; }
.stage.empty { display: grid; place-items: center; }
.art-empty { display: flex; flex-direction: column; align-items: center; gap: 0.5rem; padding: 1rem; color: var(--muted); text-align: center; }
.art-empty p { margin: 0; font-size: 0.85rem; }
.art-regen { position: absolute; right: 8px; bottom: 8px; }
.stage-hint { margin: -0.4rem 0 0; font-size: 0.75rem; color: var(--muted); }

.pin {
  position: absolute; transform: translate(-50%, -50%); width: 30px; height: 30px; border-radius: 50%;
  border: 3px solid #fff; background: #7C3AED; color: #fff; font-weight: 800; font-size: 0.8rem; font-family: inherit;
  cursor: grab; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4); display: grid; place-items: center; padding: 0;
}
.pin.scene { background: #0D9488; }
.pin.broken { background: #DC2626; }
.pin:active { cursor: grabbing; }
.pin.selected { box-shadow: 0 0 0 4px rgba(124, 58, 237, 0.45), 0 2px 8px rgba(0, 0, 0, 0.4); transform: translate(-50%, -50%) scale(1.15); }

.field { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.8rem; font-weight: 600; color: var(--text2); }
.field-row { display: flex; gap: 0.6rem; }
.field-row .field { flex: 1; }

/* spots */
.spot { border: 1.5px solid var(--border); border-radius: 12px; padding: 0.35rem 0.6rem; background: #fff; }
.spot.selected { border-color: var(--primary); }
.spot-head { display: flex; align-items: center; gap: 0.4rem; }
.spot-toggle { display: flex; align-items: center; gap: 0.6rem; flex: 1; min-width: 0; border: none; background: none; cursor: pointer; font-family: inherit; text-align: left; padding: 0.25rem 0; }
.spot-num { width: 24px; height: 24px; border-radius: 50%; background: #7C3AED; color: #fff; font-size: 0.75rem; font-weight: 800; display: grid; place-items: center; flex-shrink: 0; }
.spot-num.scene { background: #0D9488; }
.spot-num.broken { background: #DC2626; }
.spot-label { font-weight: 700; font-size: 0.9rem; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-flex; align-items: center; gap: 0.35rem; }
.needs-badge {
  font-size: 0.62rem; font-weight: 800; letter-spacing: 0.03em;
  color: #92400E; background: #FEF3C7; border-radius: 999px; padding: 0.1rem 0.45rem;
  white-space: nowrap;
}
.outcome { margin-left: auto; font-size: 0.74rem; font-weight: 700; border-radius: 999px; padding: 0.16rem 0.6rem; background: #F3E8FF; color: #6D28D9; white-space: nowrap; }
.outcome.scene { background: #CCFBF1; color: #0F766E; }
.outcome.broken { background: #FEE2E2; color: #991B1B; }
.spot-order { display: inline-flex; gap: 0; }
.spot-del { border: none; background: none; color: var(--muted); cursor: pointer; font-family: inherit; font-size: 0.74rem; font-weight: 700; padding: 0.2rem 0.4rem; border-radius: 6px; }
.spot-del:hover { color: #B91C1C; background: #FEE2E2; }
.spot-body { display: flex; flex-direction: column; gap: 0.6rem; padding: 0.6rem 0 0.4rem; }
.kind { border: 1.5px solid var(--border); border-radius: 10px; padding: 0.5rem 0.75rem; display: flex; flex-direction: column; gap: 0.35rem; font-size: 0.85rem; }
.kind legend { font-size: 0.78rem; font-weight: 700; color: var(--text2); padding: 0 0.3rem; }
.kind label { display: flex; align-items: center; gap: 0.4rem; cursor: pointer; }
.advanced summary { cursor: pointer; font-size: 0.78rem; color: var(--muted); }

/* grow */
.grow { display: flex; flex-direction: column; gap: 0.5rem; padding: 0.9rem 1rem; }
.grow .pane-title { margin-top: 0; }
.grow .muted { margin: 0; }
.suggest { display: flex; flex-direction: column; gap: 0.5rem; align-items: flex-start; }
.chips { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.chip { display: flex; flex-direction: column; gap: 0.15rem; text-align: left; max-width: 240px; border: 1.5px solid #BBF7D0; background: #F0FDF4; border-radius: 12px; padding: 0.45rem 0.7rem; cursor: pointer; font-family: inherit; }
.chip strong { font-size: 0.84rem; color: #15803D; }
.chip span { font-size: 0.74rem; color: var(--text2); }
.chip:hover:not(:disabled) { border-color: #16A34A; }
.chip:disabled { opacity: 0.5; cursor: default; }
.layer-form { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.layer-form input { flex: 1 1 200px; }

.builder { margin-top: 0.1rem; }
.plan-controls { display: flex; gap: 0.6rem; align-items: flex-end; flex-wrap: wrap; }
.field.inline { flex-direction: row; align-items: center; gap: 0.5rem; }
.outline { display: flex; flex-direction: column; gap: 0.4rem; }
.outline-title { margin: 0; font-size: 0.85rem; font-weight: 700; color: var(--text); }
.outline-row { display: flex; align-items: center; gap: 0.5rem; border: 1.5px solid var(--border); background: #fff; border-radius: 10px; padding: 0.35rem 0.5rem; }
.branch-mark { color: var(--muted); font-size: 0.9rem; }
.outline-fields { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.1rem; }
.o-label { border: none; border-bottom: 1px dashed var(--border); padding: 0.1rem 0; font-weight: 700; font-size: 0.88rem; background: transparent; font-family: inherit; }
.o-focus { font-size: 0.75rem; color: var(--muted); }
.outline-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.build-log { display: flex; flex-direction: column; gap: 0.4rem; }
.build-log ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.84rem; }
.build-log li { display: flex; gap: 0.5rem; align-items: baseline; color: var(--text2); }
.build-log li.done .b-icon { color: #16A34A; }
.build-log li.failed .b-icon { color: #DC2626; }
.build-log li.running .b-icon { color: #7C3AED; }
.b-err { font-size: 0.75rem; color: #B91C1C; }
.danger-zone { border-top: 1px dashed var(--border); padding-top: 0.75rem; }
.btn.danger { background: #FEE2E2; border-color: #FECACA; color: #991B1B; }

/* delete dialog */
.modal-back { position: fixed; inset: 0; background: rgba(17, 24, 39, 0.5); display: grid; place-items: center; z-index: 50; padding: 1rem; }
.modal { background: #fff; border-radius: 16px; padding: 1.25rem 1.4rem; max-width: 480px; width: 100%; display: flex; flex-direction: column; gap: 0.75rem; }
.modal h3 { margin: 0; }
.plan { margin: 0; padding-left: 1.1rem; display: flex; flex-direction: column; gap: 0.35rem; font-size: 0.88rem; color: var(--text2); }
.modal-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; justify-content: flex-end; }
</style>
