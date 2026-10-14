<script setup>
// Wikido Studio — the superadmin workspace for generating immersive picture-
// encyclopedia topics on ANY subject, growing them layer by layer, curating
// every word and picture, and publishing them to all families.
//
// Topic lives in Firestore (wikidoTopics/{id}); artwork is generated per scene
// with the platform image model into Storage; spoken audio falls back to the
// runtime TTS chain (the developer's Kokoro script can attach recordings later,
// exactly as for hand-authored packs).
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  generateWikidoTopic, addWikidoChildScene, suggestWikidoScenes, planWikidoOutline, generateWikidoSceneImage, generateWikidoImages,
  adjustWikidoSpots, adjustWikidoAllSpots,
  createWikidoGlobeTopic, generateWikidoGlobeScene,
  generateWikidoSpotDetails, planWikidoDepth, planWikidoRelinks,
  saveWikidoTopic, setWikidoTopicStatus, deleteWikidoTopic, fetchAllWikidoTopicsAdmin,
  checkVoiceoverBridge, synthesizeOnBridge, planVoiceoverClips, attachWikidoAudio, generateWikidoAudios, BRIDGE_URL,
  requestWikidoKokoroJob, stopWikidoKokoroJob, getWikidoKokoroJob,
  startVoiceoverBridge, bridgeLauncherStatus,
  reorderWikidoTopics, sortStudioTopics,
} from "@/services/wikidoAdmin";
import { buildSceneTree, moveSceneSibling, subtreeSceneIds, canMoveScene, moveSceneTo, moveSceneByDrop, resolveDrop, findParentSceneId } from "@/lib/wikido/tree";
import { wikidoTopicPacks } from "@/lib/wikido";
import { useCoverPlacement } from "@/composables/useCoverPlacement";
import { spotOutcome, sceneStatus, deletePlan, deleteSceneFrom, topicHealth, undoBuiltScenes, spotNeedsDetails, bundledTopicSummaries } from "@/lib/wikido/studioModel";
import WikidoGlobeEditor from "@/components/platform/WikidoGlobeEditor.vue";
import { withKeys, countOutline, removeOutlineNode, runOutline, summarizeRun, retryFailedItems } from "@/lib/wikido/outlineBuild";
import { getLlmConfig } from "@/services/admin";

// ── topic list ────────────────────────────────────────────────────────────────
const topics = ref([]);
const loading = ref(true);
const selectedId = ref("");
const message = ref("");
const error = ref("");

async function refresh(keepSelection = true) {
  loading.value = true;
  try {
    const bundledIds = new Set(wikidoTopicPacks.map((p) => p.id));
    const cloud = sortStudioTopics(await fetchAllWikidoTopicsAdmin());
    const overrides = new Map(cloud.map((t) => [t.id, t]));
    topics.value = [...bundledTopicSummaries(wikidoTopicPacks).map((t) =>
      overrides.has(t.id) ? { ...overrides.get(t.id), bundledOrigin: true } : t
    ), ...cloud.filter((t) => !bundledIds.has(t.id))];
    if (!keepSelection || !topics.value.some((t) => t.id === selectedId.value)) {
      // open on a generated world (the thing that usually needs work); the
      // bundled worlds above it are reference material, not work in progress
      selectedId.value = (topics.value.find((t) => !t.bundled) || topics.value[0])?.id || "";
      loadSelected();
    }
  } finally {
    loading.value = false;
    scheduleAutoRecord();
  }
}

// move a topic up/down the studio shelf order (persisted for every family).
// Bundled worlds are pinned above the studio list and are never reordered —
// their shelf position comes from the app registry, not Firestore.
const chipBusy = ref("");
async function moveTopicChip(topicId, dir) {
  if (chipBusy.value) return;
  const bundled = topics.value.filter((t) => t.bundled);
  const cloud = topics.value.filter((t) => !t.bundled);
  const ids = cloud.map((t) => t.id);
  const idx = ids.indexOf(topicId);
  if (idx < 0) return;
  const swap = dir === "up" ? idx - 1 : idx + 1;
  if (swap < 0 || swap >= ids.length) return;
  [ids[idx], ids[swap]] = [ids[swap], ids[idx]];
  const byId = new Map(cloud.map((t) => [t.id, t]));
  topics.value = [...bundled, ...ids.map((id) => byId.get(id))];
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

// ── voiceovers ────────────────────────────────────────────────────────────────
// Two categorical engines, one "Generate audios" button:
//   · Premium — the local Kokoro bridge: limitless and free, needs the dev
//     machine (`npm run wikido:bridge`);
//   · Paid premium — the platform's configured speech model, billed per clip
//     under the shared platform limits, works from any machine.
// The picker follows reality until the curator chooses an engine themselves:
// bridge up → Kokoro, bridge down → paid.
const bridge = ref({ online: false });
const voBusy = ref(false);
const voProgress = ref({ done: 0, total: 0 });
const voForce = ref(false);
const voFailed = ref([]);
let bridgeProbeTimer = null;
const voiceEngine = ref("kokoro"); // "kokoro" | "paid"
const enginePicked = ref(false);
const ttsModelLabel = ref("");

async function probeBridge() {
  bridge.value = await checkVoiceoverBridge(BRIDGE_URL);
  if (!enginePicked.value) voiceEngine.value = bridge.value.online ? "kokoro" : "paid";
}

// ── starting the bridge from the studio ─────────────────────────────────────
// A web page can't spawn processes, but when the studio is served by the dev
// server (same machine), that server can: it spawns the bridge exactly like
// `npm run wikido:bridge` and reports the real process state. The studio then
// polls until the engine answers — or tells you the truth: pid, exit code,
// and the bridge's own last output lines.
const bridgeStarting = ref(false);
const bridgeStartNote = ref("");
let bridgeStartTimer = null;
let bridgeStartRun = 0;
// the local bridge launcher only exists when the studio is served by the dev
// server — production pages use the in-browser Kokoro engine instead
const isDevServed = import.meta.env.DEV;

async function startBridge() {
  if (bridge.value.online || bridgeStarting.value) return bridge.value.online;
  bridgeStarting.value = true;
  bridgeStartNote.value = "";
  error.value = "";
  const run = ++bridgeStartRun;
  try {
    const launched = await startVoiceoverBridge();
    if (!launched.supported) {
      message.value = "";
      error.value = "The studio can only launch the bridge when it is served locally — open the studio through `npm run dev` and press “Start the bridge”, or run `npm run wikido:bridge` in the repo root.";
      return false;
    }
    bridgeStartNote.value = launched.already
      ? "Bridge process already running — waiting for it to answer…"
      : `Kokoro starting (pid ${launched.pid})…`;
    message.value = bridgeStartNote.value;
    const started = Date.now();
    for (let poll = 0; Date.now() - started < 120_000; poll++) {
      await new Promise((r) => { bridgeStartTimer = setTimeout(r, poll === 0 ? 600 : 2500); });
      if (run !== bridgeStartRun) return bridge.value.online; // superseded/unmounted
      await probeBridge();
      if (bridge.value.online) {
        bridgeStarting.value = false;
        bridgeStartNote.value = "";
        message.value = `Kokoro bridge is up${launched.pid ? ` (pid ${launched.pid})` : ""} — the free premium engine can record now.`;
        scheduleAutoRecord();
        return true;
      }
      const proc = await bridgeLauncherStatus();
      if (run !== bridgeStartRun) return bridge.value.online;
      if (proc.supported && !proc.alive) {
        bridgeStarting.value = false;
        bridgeStartNote.value = "";
        const last = (proc.output || []).slice(-2).join(" · ");
        error.value = `The bridge process exited (code ${proc.exit?.code ?? proc.exit?.signal ?? "?"}).${last ? ` Its last lines: ${last}` : ""} — fix and press “Start the bridge” again.`;
        return false;
      }
      bridgeStartNote.value = `Kokoro starting… ${Math.round((Date.now() - started) / 1000)}s`;
      message.value = bridgeStartNote.value;
    }
    bridgeStarting.value = false;
    bridgeStartNote.value = "";
    error.value = "The bridge didn't answer after two minutes — is port 8787 free? Check the dev-server terminal for its output.";
    return false;
  } finally {
    if (run === bridgeStartRun) bridgeStarting.value = false;
  }
}

// Record every missing clip on the local Kokoro bridge, then attach each MP3 to
// the topic through the superadmin callable (Storage + pack audio fields).
// Runs from the manual button AND automatically whenever the bridge is online
// and clips are missing — Kokoro is the default voice for published topics.
async function generateVoiceovers({ auto = false } = {}) {
  if (voBusy.value || !form.value) return { recorded: 0, failed: [] };
  voBusy.value = true;
  voFailed.value = [];
  if (!auto) error.value = "";
  let recorded = 0;
  try {
    // the callable checks the SAVED topic — freshly added hotspots must ship
    // first; if the save fails (validation), recording must not run at all
    if (dirty.value) {
      const ok = await save();
      if (!ok) return { recorded: 0, failed: [] };
    }
    const items = planVoiceoverClips(form.value, { force: voForce.value && !auto });
    voProgress.value = { done: 0, total: items.length };
    if (!items.length) {
      if (!auto) message.value = "Every scene and hotspot already has a voiceover (use “re-record all” to refresh).";
      return { recorded: 0, failed: [] };
    }
    if (auto) message.value = `Recording voiceovers (Kokoro)… 0/${items.length}`;
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
          const attached = await attachWikidoAudio({ topicId: selectedId.value, sceneId, hotspotId: hotspotId || undefined, audioBase64: clip.mp3, mime: "audio/mpeg" });
          recorded += 1;
          // reflect the REAL recording url in the form so dirty-state and
          // skip-logic stay accurate
          const scene = form.value.scenes[sceneId];
          if (scene) {
            if (hotspotId) {
              const spot = scene.hotspots?.find((h) => h.id === hotspotId);
              if (spot) spot.audio = attached.url;
            } else {
              scene.audio = attached.url;
            }
          }
        } catch (e) {
          failedIds.push(`${clip.id}: ${String(e?.message || e).replace(/^[a-z-]+: /i, "").slice(0, 90)}`);
          voFailed.value = [...failedIds];
          continue;
        }
        voProgress.value.done += 1;
        if (auto) message.value = `Recording voiceovers (Kokoro)… ${voProgress.value.done}/${items.length}`;
      }
      failedIds.push(...failed.map((f) => f.id));
      voFailed.value = [...failedIds];
    }
    if (!auto) message.value = `Voiceovers attached: ${voProgress.value.done}/${items.length}${failedIds.length ? ` · failed: ${failedIds.join(", ")}` : ""}.`;
    snapshot();
    return { recorded, failed: failedIds };
  } catch (e) {
    if (!auto) error.value = e?.message?.replace("internal: ", "") || "Voiceover generation failed.";
    return { recorded, failed: failedIds || [] };
  } finally {
    voBusy.value = false;
  }
}

// Auto-managed voice: while the bridge is online, missing clips are recorded
// without any click — after loads, saves, and content additions settle.
const autoVoice = ref(true);
let autoVoiceTimer = null;
function scheduleAutoRecord() {
  if (!autoVoice.value || !bridge.value.online) return;
  clearTimeout(autoVoiceTimer);
  autoVoiceTimer = setTimeout(async () => {
    if (autoVoice.value && bridge.value.online && form.value && !voBusy.value && !dirty.value) {
      const missing = planVoiceoverClips(form.value).length;
      if (missing > 0) await generateVoiceovers({ auto: true });
    }
  }, 2500);
}

// ── premium voiceovers (paid, server-side) ───────────────────────────────────
// The second voice option: the platform's own speech model records the clips
// server-side — from any machine, no local bridge needed (it bills per clip).
// The callable reads its texts from the SAVED topic, so unsaved edits ship
// first; clip ids are sent in small chunks with live progress.
const premBusy = ref(false);
const premProgress = ref({ done: 0, total: 0 });

async function generatePremiumAudios() {
  if (premBusy.value || !form.value) return;
  premBusy.value = true;
  error.value = "";
  try {
    if (dirty.value) {
      const ok = await save();
      if (!ok) return;
    }
    const items = planVoiceoverClips(form.value, { force: voForce.value });
    premProgress.value = { done: 0, total: items.length };
    if (!items.length) {
      message.value = "Every scene and spot already has a voiceover (tick “re-record all” to regenerate with the paid premium voice).";
      return;
    }
    message.value = `Generating premium audios… 0/${items.length}`;
    const failed = [];
    const chunkSize = 5;
    for (let i = 0; i < items.length; i += chunkSize) {
      const chunk = items.slice(i, i + chunkSize);
      const res = await generateWikidoAudios({ topicId: selectedId.value, clipIds: chunk.map((c) => c.id), force: voForce.value });
      for (const r of res.results || []) {
        if (!r.url) { failed.push(`${r.id}: ${String(r.error || "failed").slice(0, 80)}`); continue; }
        const dot = r.id.indexOf(".");
        const sceneId = dot < 0 ? r.id : r.id.slice(0, dot);
        const hotspotId = dot < 0 ? "" : r.id.slice(dot + 1);
        // reflect the real recording url so dirty-state and skip-logic stay accurate
        const scene = form.value.scenes[sceneId];
        if (scene) {
          if (hotspotId) {
            const spot = scene.hotspots?.find((h) => h.id === hotspotId);
            if (spot) spot.audio = r.url;
          } else {
            scene.audio = r.url;
          }
        }
        premProgress.value.done += 1;
        message.value = `Generating premium audios… ${premProgress.value.done}/${items.length}`;
      }
      // the server stops mid-chunk only when the shared speech pool ran out —
      // continuing would just bill the same failure again
      if (res.failed || res.stoppedEarly) break;
    }
    message.value = `Premium audios attached: ${premProgress.value.done}/${items.length}${failed.length ? ` · failed: ${failed.join(", ")}` : ""}.`;
    snapshot();
  } catch (e) {
    error.value = e?.message?.replace(/^(internal|failed-precondition|invalid-argument): /, "") || "Audio generation failed.";
  } finally {
    premBusy.value = false;
  }
}

// ── free Kokoro on the platform's servers (fire-and-forget queue) ─────────────
// The studio ENQUEUES the topic's job and can be closed: a scheduled worker
// records the clips one by one on the server, wiring every MP3 into the topic
// as it lands. The studio just polls the job for progress — staring optional.
const kokoroBusy = ref(false);        // the enqueue request itself
const kokoroJob = ref(null);          // polled job doc (null = none for this topic)
const kokoroStopping = ref(false);
let kokoroJobTimer = null;
const kokoroJobActive = computed(() => Boolean(kokoroJob.value && ["queued", "running"].includes(kokoroJob.value.status)));

async function pollKokoroJob({ announce = false } = {}) {
  if (!selectedId.value) return;
  try {
    const res = await getWikidoKokoroJob({ topicId: selectedId.value });
    const prev = kokoroJob.value;
    kokoroJob.value = res.job || null;
    const nowActive = kokoroJobActive.value;
    if (prev && ["queued", "running"].includes(prev.status) && kokoroJob.value && !nowActive) {
      // the run finished while we watched — pull the fresh audio into the editor
      await refresh(true);
      loadSelected();
      const j = kokoroJob.value;
      message.value = j.status === "done"
        ? `Kokoro finished in the background: ${j.recorded}/${j.total} clips recorded${j.failed ? `, ${j.failed} failed (re-run for the rest)` : ""}.`
        : j.status === "cancelled" ? `Kokoro run stopped — ${j.recorded}/${j.total} clips were recorded; Generate audios continues where it left off.`
        : `Kokoro run failed: ${j.lastError || "unknown error"}`;
    }
    if (announce && nowActive) {
      message.value = "Recording with Kokoro on the platform's servers — you can close this tab; the queue keeps running.";
    }
  } catch { /* a failed poll just waits for the next tick */ }
}

function watchKokoroJob() {
  clearInterval(kokoroJobTimer);
  if (kokoroJobActive.value) kokoroJobTimer = setInterval(() => pollKokoroJob(), 4000);
}

async function generateKokoroAudios() {
  if (kokoroBusy.value || !form.value) return;
  kokoroBusy.value = true;
  error.value = "";
  try {
    // the job snapshots the SAVED topic's texts — unsaved edits must ship first
    if (dirty.value) {
      const ok = await save();
      if (!ok) return;
    }
    const res = await requestWikidoKokoroJob({ topicId: selectedId.value, force: voForce.value });
    if (res.status === "done") {
      message.value = "Every scene and spot already has a voiceover (tick “re-record all” to regenerate with the Kokoro voice).";
      await pollKokoroJob();
      return;
    }
    kokoroJob.value = { status: res.status, total: res.total, recorded: res.recorded || 0, failed: res.failed || 0 };
    message.value = `Recording with Kokoro on the platform's servers — ${res.total} clip${res.total === 1 ? "" : "s"} queued. You can close this tab; the queue keeps running.`;
    await pollKokoroJob();
    watchKokoroJob();
  } catch (e) {
    error.value = e?.message?.replace(/^(internal|failed-precondition|invalid-argument): /, "") || "Could not enqueue the Kokoro job.";
  } finally {
    kokoroBusy.value = false;
  }
}

async function stopKokoroJob() {
  if (kokoroStopping.value || !kokoroJobActive.value) return;
  kokoroStopping.value = true;
  try {
    await stopWikidoKokoroJob({ topicId: selectedId.value });
    await pollKokoroJob();
    // the poll announces the final outcome itself when the run ends here
    if (kokoroJobActive.value) message.value = "Stopping the Kokoro queue — clips already recorded stay.";
  } catch (e) {
    error.value = e?.message?.replace(/^[a-z-]+: /, "") || "Could not stop the job.";
  } finally {
    kokoroStopping.value = false;
  }
}

// One button, two engines: the categorical picker decides where a
// "Generate audios" click goes. Kokoro is limitless everywhere: through the
// local bridge when it's up, on the platform's servers when it isn't — the
// tab stays light either way.
const voGenerating = computed(() => voBusy.value || premBusy.value || kokoroBusy.value);
const voProgressNow = computed(() => (premBusy.value ? premProgress.value : voProgress.value));
async function generateAudios() {
  if (voGenerating.value) return;
  if (voiceEngine.value === "kokoro") {
    if (bridge.value.online) await generateVoiceovers();
    else await generateKokoroAudios();
  } else {
    await generatePremiumAudios();
  }
}

onMounted(() => {
  refresh(false);
  probeBridge().then(() => scheduleAutoRecord());
  // name the configured speech model on the paid-premium option (best effort —
  // a failed read just leaves the generic label)
  getLlmConfig()
    .then((cfg) => { ttsModelLabel.value = String(cfg?.agents?.tts?.model || ""); })
    .catch(() => {});
  // keep probing — the bridge may start after this page
  bridgeProbeTimer = setInterval(async () => {
    const was = bridge.value.online;
    await probeBridge();
    if (!was && bridge.value.online) scheduleAutoRecord();
  }, 15000);
});
onBeforeUnmount(() => {
  clearInterval(bridgeProbeTimer);
  bridgeStartRun++; // a running start attempt sees the stale run id and stops
  clearTimeout(bridgeStartTimer);
  clearInterval(kokoroJobTimer);
});

// a Kokoro job runs server-side: pick up its progress whenever this topic is
// opened (or switches), and keep an eye on it while it is active
watch(selectedId, () => { pollKokoroJob().then(watchKokoroJob); });

const selectedDoc = computed(() => topics.value.find((t) => t.id === selectedId.value) || null);
// Bundles without a saved override start as an editable draft.
const isBundled = computed(() => Boolean(selectedDoc.value?.bundled));
// only generated topics participate in shelf reordering
const reorderableCount = computed(() => topics.value.filter((t) => !t.bundled).length);

// ── create ────────────────────────────────────────────────────────────────────
const newTitle = ref("");
const newAngle = ref("");
const newIsGlobe = ref(false);
const creating = ref(false);

async function createTopic() {
  if (!newTitle.value.trim() || creating.value) return;
  creating.value = true;
  error.value = "";
  message.value = "";
  try {
    if (newIsGlobe.value) {
      const res = await createWikidoGlobeTopic({ title: newTitle.value.trim(), angle: newAngle.value.trim() });
      message.value = `Created the globe world “${res.title}” — pin places by name to grow it.`;
    } else {
      const res = await generateWikidoTopic({ title: newTitle.value.trim(), angle: newAngle.value.trim() });
      message.value = `Generated “${res.title}” — ${res.scenes} scenes, ${res.discoveries} discoveries. Generate artwork, review, then publish.`;
    }
    newTitle.value = "";
    newAngle.value = "";
    newIsGlobe.value = false;
    await refresh();
    selectedId.value = (topics.value.at(-1))?.id || selectedId.value;
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
  delete form.value?.bundled;
  delete form.value?.bundledOrigin;
  if (doc?.bundled) form.value.status = "draft";
  originalJson.value = form.value && !doc?.bundled ? JSON.stringify(form.value) : "";
  selectedSceneId.value = form.value?.rootSceneId || "";
  message.value = "";
  error.value = "";
}

const dirty = computed(() => Boolean(form.value && JSON.stringify(form.value) !== originalJson.value));
// ── globe worlds (view: "globe") ──────────────────────────────────────────────
// The root scene is the hub the 3D globe renders; its spots are pinned places.
const isGlobeForm = computed(() => form.value?.view === "globe");
const isHubScene = computed(() => Boolean(isGlobeForm.value && selectedSceneId.value === form.value?.rootSceneId));
const placeQuery = ref("");
const placeBusy = ref(false);
const placeNote = ref("");

async function pinPlace() {
  const q = placeQuery.value.trim();
  if (!q || placeBusy.value) return;
  placeBusy.value = true;
  error.value = "";
  try {
    if (dirty.value && !(await save())) return;
    placeNote.value = `Finding “${q}” and writing its scene…`;
    const res = await generateWikidoGlobeScene({ topicId: selectedId.value, query: q });
    placeNote.value = "";
    const where = res.place?.country?.name && res.place.country.name !== res.place.name ? ` in ${res.place.country.name}` : "";
    message.value = `Pinned “${res.place.name}”${where} (${res.place.level}) — “${res.title}” is written and waiting for its artwork.`;
    placeQuery.value = "";
    await refresh(true);
    loadSelected();
    selectedSceneId.value = res.sceneId;
  } catch (e) {
    placeNote.value = "";
    error.value = e?.message?.replace(/^(internal|invalid-argument|failed-precondition): /, "") || "Could not pin that place.";
  } finally {
    placeBusy.value = false;
  }
}

// A place pinned by hand (rare): starts at the equator; pick the scene it opens
// and set its coordinates in the spot editor.
function addGlobeSpot() {
  const hub = form.value.scenes[form.value.rootSceneId];
  const n = hub.hotspots.length + 1;
  let id = `place-${n}`;
  while (hub.hotspots.some((h) => h.id === id)) id = `place-${n}-${Math.floor(Math.random() * 90 + 10)}`;
  hub.hotspots.push({
    id,
    label: "New place",
    blurb: "A place on the globe",
    lat: 0,
    lng: 0,
    level: "city",
    info: { title: "New place", body: ["Pick the scene this place opens, and set its coordinates."] },
  });
  selectedSceneId.value = form.value.rootSceneId;
  selectedSpotId.value = id;
}

// A pin dragged on the studio globe editor lands on real lat/lng — the same
// fields the gazetteer pre-saves. Purely optional fine-tuning; nothing moves
// unless the curator drags it, and the change stays unsaved until Save edits.
function relocateGlobeSpot(spotId, lat, lng) {
  const spot = form.value?.scenes?.[form.value.rootSceneId]?.hotspots?.find((h) => h.id === spotId);
  if (!spot) return;
  spot.lat = lat;
  spot.lng = lng;
}

const missingArtwork = computed(() =>
  form.value
    ? Object.values(form.value.scenes)
        .filter((s) => !(isGlobeForm.value && s.id === form.value.rootSceneId))
        .filter((s) => !hasArt(s))
        .map((s) => s.id)
    : []
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

// Keep each parent's complete branch together in the map: depth-first from the
// root along doorways (children in doorway order), orphans appended
const orderedScenes = computed(() => (form.value?.scenes ? buildSceneTree(form.value.scenes, form.value.rootSceneId) : []));

function selectScene(id) {
  selectedSceneId.value = id;
  layerParentId.value = id;
}

// ── tree power features ───────────────────────────────────────────────────────
const layerParentId = ref("");

// the layer form always names its target; keep it glued to the selected scene
watch(selectedSceneId, (id) => { layerParentId.value = id; });
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

// ── free drag-and-drop on the map ─────────────────────────────────────────────
// Hold the ⠿ grip and drop a scene:
//   · between two rows  → reorder among those siblings
//   · onto a row        → re-parent the scene under it — its whole branch
//                         (every deeper scene) moves along automatically
// resolveDrop guards cycles, the root, crowded pictures, and turns a gap next
// to a parentless row (entrance / unlinked) into "nest under it".
const dragSceneId = ref("");
const dropHint = ref(null); // { rowId, mode: "before"|"after"|"into" } | null

function onDragStart(e, sceneId) {
  dragSceneId.value = sceneId;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", sceneId);
}
function onDragEnd() {
  dragSceneId.value = "";
  dropHint.value = null;
}
function onRowDragLeave(sceneId) {
  if (dropHint.value?.rowId === sceneId) dropHint.value = null;
}
function onRowDragOver(e, rowSceneId) {
  if (!dragSceneId.value || rowSceneId === dragSceneId.value) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const rel = rect.height ? (e.clientY - rect.top) / rect.height : 0.5;
  const raw = rel < 0.3 ? "before" : rel > 0.7 ? "after" : "into";
  const plan = resolveDrop(form.value.scenes, dragSceneId.value, rowSceneId, raw, form.value.rootSceneId);
  if (!plan) return; // no legal move here — no drop, no indicator
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  dropHint.value = { rowId: rowSceneId, mode: plan.mode };
}
function onRowDrop(e, rowSceneId) {
  // read the drag id BEFORE onDragEnd clears the state
  const dragId = dragSceneId.value || e.dataTransfer?.getData("text/plain") || "";
  const hint = dropHint.value;
  onDragEnd();
  const next = moveSceneByDrop(form.value.scenes, dragId, rowSceneId, hint?.mode || "into", form.value.rootSceneId);
  if (!next) return;
  const taken = Math.max(0, subtreeSceneIds(next, dragId).length - 1);
  form.value.scenes = next;
  message.value = `Scene moved${taken ? `, taking its ${taken} deeper scene${taken === 1 ? "" : "s"} along` : ""} — remember to save your edits.`;
}

// ── change a scene's parent from the form ─────────────────────────────────────
const currentParentId = computed(() =>
  form.value && selectedSceneId.value ? findParentSceneId(form.value.scenes, selectedSceneId.value) : ""
);
// deeper scenes travel with every re-parent — say so next to the field
const deeperSceneCount = computed(() =>
  form.value && selectedSceneId.value ? Math.max(0, subtreeSceneIds(form.value.scenes, selectedSceneId.value).length - 1) : 0
);
const allowedParentIds = computed(() => {
  const ids = new Set();
  if (!form.value || !selectedSceneId.value) return ids;
  for (const row of orderedScenes.value) {
    if (canMoveScene(form.value.scenes, selectedSceneId.value, row.id, form.value.rootSceneId)) ids.add(row.id);
  }
  return ids;
});
function parentOptionLabel(row) {
  const title = form.value.scenes[row.id]?.title || row.id;
  const indent = "\u00A0\u00A0\u00A0".repeat(Math.min(row.depth, 5));
  return `${indent}${row.id === currentParentId.value ? `${title} (current)` : title}`;
}
function changeParent(newParentId) {
  if (!form.value || !newParentId || newParentId === currentParentId.value) return;
  const next = moveSceneTo(form.value.scenes, selectedSceneId.value, newParentId, null, form.value.rootSceneId);
  if (!next) {
    error.value = `“${form.value.scenes[newParentId]?.title || newParentId}” can’t take this scene — a scene never moves under its own subtopics, and a picture holds at most 8 spots.`;
    return;
  }
  form.value.scenes = next;
  const taken = Math.max(0, subtreeSceneIds(next, selectedSceneId.value).length - 1);
  message.value = `Moved under “${form.value.scenes[newParentId].title}”${taken ? `, with its ${taken} deeper scene${taken === 1 ? "" : "s"}` : ""} — save your edits to keep the change.`;
}

const canMove = (sceneId, dir) => {
  const siblings = siblingIdsOf(sceneId);
  const idx = siblings.indexOf(sceneId);
  return dir === "up" ? idx > 0 : idx >= 0 && idx < siblings.length - 1;
};
function siblingIdsOf(sceneId) {
  const parent = Object.values(form.value?.scenes || {}).find((s) => (s.hotspots || []).some((h) => h.childSceneId === sceneId && !h.childTopicId));
  return parent ? (parent.hotspots || []).filter((h) => h.childSceneId && !h.childTopicId).map((h) => h.childSceneId) : [];
}
const selectedScene = computed(() => form.value?.scenes?.[selectedSceneId.value] || null);
const incomingDoorways = computed(() => {
  if (!form.value || !selectedSceneId.value) return [];
  return Object.entries(form.value.scenes).flatMap(([sid, s]) =>
    (s.hotspots || []).filter((h) => h.childSceneId === selectedSceneId.value && !h.childTopicId).map((h) => `${s.title} → ${h.label}`)
  );
});

// ── cross-topic doorways: the rest of the catalog as "other worlds" ──────────
// Every bundled pack + every studio topic except the one being edited. A spot
// can open a scene in any of these (childTopicId + childSceneId).
const otherWorlds = computed(() => {
  const worlds = new Map();
  for (const t of topics.value) {
    if (t.id !== selectedId.value) {
      worlds.set(t.id, { id: t.id, title: t.title, scenes: t.scenes || {}, rootSceneId: t.rootSceneId, status: t.bundled ? "published" : t.status });
    }
  }
  for (const p of wikidoTopicPacks) {
    if (p.id !== selectedId.value && !worlds.has(p.id)) {
      worlds.set(p.id, { id: p.id, title: p.title, scenes: p.scenes, rootSceneId: p.rootSceneId, status: "published" });
    }
  }
  return worlds;
});
const worldScenesOf = (spot) => Object.values(otherWorlds.value.get(spot.childTopicId)?.scenes || {});
// point a cross-topic doorway at a world (its entrance is the default target)
function setDoorWorld(spot, worldId) {
  spot.childTopicId = worldId;
  const world = otherWorlds.value.get(worldId);
  const entrance = world?.scenes?.[world.rootSceneId] ? world.rootSceneId : Object.keys(world?.scenes || {})[0];
  if (entrance) spot.childSceneId = entrance;
}

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
    const saveMessage = `Saved — ${res.discoveryCount} discoveries.${res.repairs?.length ? " " + res.repairs.join(" ") : ""}`;
    snapshot();
    // adopt the server-normalized doc (missing ids repaired, etc.) — otherwise
    // the form keeps stale ids and later steps (voiceovers) target ghosts
    await refresh(true);
    loadSelected();
    selectedSceneId.value = form.value.scenes[restoreScene] ? restoreScene : form.value.rootSceneId;
    message.value = saveMessage;
    return true;
  } catch (e) {
    const msg = e?.message?.replace("invalid-argument: ", "") || "Save failed.";
    // a save blocked by an unreachable scene is exactly what the re-link agent fixes
    error.value = /unreachable from root/i.test(msg)
      ? `${msg} — press “✦ Re-link misplaced scenes” and it will be linked under its proper scene.`
      : msg;
    return false;
  } finally {
    saving.value = false;
  }
}

async function generateAllImages() {
  if (generatingImages.value) return;
  if (dirty.value) { const ok = await save(); if (!ok) return; }
  generatingImages.value = true;
  error.value = "";
  message.value = "Generating artwork… this takes a while (one picture per scene).";
  try {
    const res = await generateWikidoImages({ topicId: selectedId.value });
    // pull the fresh artwork srcs AND the agent-placed spot coordinates into
    // the form — the placement pass runs server-side right after each picture
    const docs = await fetchAllWikidoTopicsAdmin();
    const doc = docs.find((t) => t.id === selectedId.value);
    if (doc) {
      for (const [sid, s] of Object.entries(doc.scenes || {})) {
        if (!form.value.scenes[sid]) continue;
        form.value.scenes[sid].image.src = s.image?.src || "";
        form.value.scenes[sid].hotspots = (s.hotspots || []).map((h) => ({ ...h }));
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
  if (dirty.value && !(await save())) return;
  imageBusy.value = sceneId;
  error.value = "";
  try {
    const res = await generateWikidoSceneImage({ topicId: selectedId.value, sceneId });
    const scene = form.value.scenes[sceneId];
    if (scene) {
      scene.image.src = res.url;
      moveSpotsTo(scene, res.placements);
    }
    const placed = (res.placements || []).length;
    message.value = placed ? `Artwork updated — the agent placed ${placed} ${placed === 1 ? "spot" : "spots"} on the new picture.` : "Artwork updated.";
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
    // the system retries transient failures automatically — once
    if (run.items.some((i) => i.status === 'failed')) {
      message.value = 'Retrying failed scenes…';
      await retryFailedItems({
        items: run.items,
        createScene: (args) => addWikidoChildScene({ topicId: selectedId.value, ...args }),
        rootParentSceneId: parentId,
        onUpdate: (items) => { buildItems.value = items; },
      });
    }
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
    if (dirty.value && !(await save())) return;
    const res = await addWikidoChildScene({
      topicId: selectedId.value,
      parentSceneId: parentId,
      label: layerLabel.value.trim(),
      focus: layerFocus.value.trim(),
    });
    message.value = `Added deeper scene “${res.title}” (${res.hotspots} hotspots). Generate its artwork, then publish.`;
    layerLabel.value = "";
    layerFocus.value = "";
    await refresh(true);
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
  if (dirty.value && !(await save())) return;
  // a published topic gets its full Kokoro voice first (when the bridge can)
  if (next === "published" && bridge.value.online && !voBusy.value) {
    const missing = planVoiceoverClips(form.value).length;
    if (missing > 0) {
      message.value = `Recording ${missing} missing voiceovers before publishing…`;
      const { failed } = await generateVoiceovers({ auto: true });
      if (failed.length) {
        error.value = `Some voiceovers failed (${failed.length}) — publish anyway? Press publish again to retry.`;
        return;
      }
    }
  }
  try {
    const res = await setWikidoTopicStatus({ topicId: selectedId.value, status: next });
    const restoreScene = selectedSceneId.value;
    await refresh(true);
    loadSelected();
    if (form.value.scenes[restoreScene]) selectedSceneId.value = restoreScene;
    message.value = (next === "published" ? "Published! Families can now explore this world." : "Moved back to draft.")
      + (res?.repairs?.length ? " " + res.repairs.join(" ") : "");
  } catch (e) {
    error.value = e?.message?.replace("failed-precondition: ", "") || "Status change failed.";
  }
}

async function removeTopic() {
  if (isBundled.value) return; // nothing to delete — a bundled world lives in the repo
  const restoring = Boolean(selectedDoc.value?.bundledOrigin);
  const prompt = restoring
    ? `Restore the original bundled version of “${selectedDoc.value?.title}”? Saved edits and generated assets will be deleted. Families will see the original bundled world.`
    : `Delete “${selectedDoc.value?.title}”? Families will no longer see it, and all of its artwork and voice recordings are permanently deleted. This cannot be undone.`;
  if (!window.confirm(prompt)) return;
  error.value = "";
  try {
    const res = await deleteWikidoTopic({ topicId: selectedId.value });
    selectedId.value = "";
    form.value = null;
    await refresh(false);
    message.value = res?.filesFailed
      ? "Topic deleted, but some of its files could not be removed from storage — they can be cleaned up later."
      : restoring ? "Original bundled version restored." : `Topic deleted along with its ${res?.filesDeleted ?? 0} artwork and audio file${res?.filesDeleted === 1 ? "" : "s"}.`;
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
  if (isBundled.value && !(await save())) return;
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
    scheduleAutoRecord();
  }
}

function removeHotspot(scene, spotId) {
  const spot = scene.hotspots.find(h => h.id === spotId);
  if (spot?.childSceneId && !spot.childTopicId && form.value.scenes[spot.childSceneId]) {
    if (!window.confirm(`Remove “${spot.label}” and the scene branch it opens? This takes effect when you save.`)) return;
    form.value.scenes = deleteSceneFrom(form.value.scenes, spot.childSceneId, { withDeeper: true });
    scene = form.value.scenes[scene.id];
  }
  scene.hotspots = scene.hotspots.filter((h) => h.id !== spotId);
}

function moveHotspot(scene, index, dir) {
  const swap = dir === "up" ? index - 1 : index + 1;
  if (swap < 0 || swap >= scene.hotspots.length) return;
  [scene.hotspots[index], scene.hotspots[swap]] = [scene.hotspots[swap], scene.hotspots[index]];
}

// ── plain-language view model ─────────────────────────────────────────────────
const sceneStatusOf = (id) => sceneStatus(form.value.scenes, form.value.scenes[id], otherWorlds.value, isGlobeForm.value ? form.value.rootSceneId : null);
const outcomeOf = (spot) => spotOutcome(form.value.scenes, spot, otherWorlds.value);
const health = computed(() => (form.value ? topicHealth(form.value.scenes, form.value.rootSceneId, otherWorlds.value, isGlobeForm.value ? form.value.rootSceneId : null) : []));
const showHealth = ref(false);
const hasArt = (scene) => /^(https?:\/\/|\/wikido\/)/.test(String(scene?.image?.src || ""));

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
const placement = ref("");
const draggingSpotId = ref("");
const stageEl = ref(null);
const { onArtworkLoad, pinStyle, pinPosition, picturePercent } = useCoverPlacement(stageEl);
watch([selectedId, selectedSceneId], () => { cancelPinDrag(); placement.value = ""; });

function startPinDrag(event, spot) {
  if (saving.value || drag || (event.button != null && event.button !== 0)) return;
  const stage = stageEl.value;
  if (!stage) return;
  const rect = stage.getBoundingClientRect();
  const center = pinPosition(spot.x, spot.y);
  drag = {
    spot, rect, pointerId: event.pointerId, target: event.currentTarget,
    startX: event.clientX, startY: event.clientY, x: spot.x, y: spot.y,
    offsetX: event.clientX - rect.left - center.left,
    offsetY: event.clientY - rect.top - center.top, moved: false,
  };
  event.currentTarget.setPointerCapture?.(event.pointerId);
}
function movePinDrag(event) {
  if (!drag || event.pointerId !== drag.pointerId || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
  if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) return;
  drag.moved = true;
  draggingSpotId.value = drag.spot.id;
  // Keep the grabbed point under the pointer and invert the artwork's cover crop.
  const { x, y } = picturePercent(event.clientX - drag.offsetX, event.clientY - drag.offsetY, drag.rect);
  drag.spot.x = x;
  drag.spot.y = y;
  placement.value = `${drag.spot.label}: X ${x}%, Y ${y}% — unsaved`;
}
function releasePinDrag() {
  const previous = drag;
  drag = null;
  draggingSpotId.value = "";
  if (previous?.target.hasPointerCapture?.(previous.pointerId)) previous.target.releasePointerCapture(previous.pointerId);
  return previous;
}
function endPinDrag(event, spot) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  movePinDrag(event);
  const previous = releasePinDrag();
  if (!previous.moved) selectSpot(spot.id);
}
function cancelPinDrag(event) {
  if (!drag || (event && event.pointerId !== drag.pointerId)) return;
  const previous = releasePinDrag();
  previous.spot.x = previous.x;
  previous.spot.y = previous.y;
  placement.value = "";
}
async function savePlacement() {
  if (await save()) placement.value = "Spot positions saved.";
}

// move the pins the agent placed (percentages of THIS picture) onto the form
function moveSpotsTo(scene, placements) {
  let moved = 0;
  for (const p of placements || []) {
    const spot = scene?.hotspots?.find((h) => h.id === p.id);
    if (spot) { spot.x = p.x; spot.y = p.y; moved++; }
  }
  return moved;
}

// ✦ Auto-adjust: the same vision pass that places the spots right after the
// artwork is painted, on demand — it re-reads the finished picture and moves
// every pin onto what the picture actually shows. The studio only enables it
// once a GENERATED picture exists (hosted artwork), because that picture is
// the coordinate source; bundled, hand-placed worlds keep their pins.
const adjustingSpots = ref(false);
const hasHostedArt = (scene) => /^https?:\/\//.test(String(scene?.image?.src || ""));
async function autoAdjustSpots() {
  const scene = selectedScene.value;
  if (!scene || adjustingSpots.value || !hasHostedArt(scene) || !(scene.hotspots || []).length) return;
  // the agent places the SAVED spots — persist edits so it sees this scene
  if (dirty.value && !(await save())) return;
  adjustingSpots.value = true;
  error.value = "";
  try {
    const res = await adjustWikidoSpots({ topicId: selectedId.value, sceneId: selectedSceneId.value });
    const moved = moveSpotsTo(form.value.scenes[selectedSceneId.value], res.placements);
    snapshot(); // the callable already persisted the same coordinates
    placement.value = moved
      ? `Auto-adjusted ${moved} of ${res.total} ${res.total === 1 ? "spot" : "spots"} — drag to fine-tune, then save.`
      : "The agent couldn’t place these spots on this picture — positions are unchanged.";
  } catch (e) {
    error.value = e?.message?.replace(/^(invalid-argument|failed-precondition|internal): /, "") || "Auto-adjust failed.";
  } finally {
    adjustingSpots.value = false;
  }
}

// ✦ Auto-adjust ALL spots: the per-scene pass, run across the whole topic —
// every scene with generated artwork gets its pins re-read and re-placed. The
// callable persists each scene as it finishes; the studio reloads the doc so
// the pins show the fresh coordinates. Scenes with bundled/hand-authored
// artwork (or none at all) are skipped by design.
const adjustingAllSpots = ref(false);
const hasGeneratedArt = computed(() =>
  Object.values(form.value?.scenes || {}).some((s) => /^https?:\/\//.test(String(s.image?.src || "")))
);
async function autoAdjustAllSpots() {
  if (adjustingAllSpots.value) return;
  if (dirty.value && !(await save())) return;
  adjustingAllSpots.value = true;
  error.value = "";
  try {
    message.value = "Auto-adjusting every spot… the agent reads each picture (one per scene).";
    const res = await adjustWikidoAllSpots({ topicId: selectedId.value });
    const docs = await fetchAllWikidoTopicsAdmin();
    const doc = docs.find((t) => t.id === selectedId.value);
    if (doc) {
      for (const [sid, s] of Object.entries(doc.scenes || {})) {
        if (form.value.scenes[sid]) form.value.scenes[sid].hotspots = (s.hotspots || []).map((h) => ({ ...h }));
      }
    }
    snapshot(); // the callable already persisted the same coordinates
    const moved = (res.results || []).reduce((n, r) => n + (r.placed || 0), 0);
    if (!res.adjusted && !res.failed) {
      message.value = "No scenes have generated artwork yet — paint them first, then auto-adjust.";
    } else {
      message.value =
        `Auto-adjusted ${res.adjusted} ${res.adjusted === 1 ? "scene" : "scenes"} (${moved} ${moved === 1 ? "spot" : "spots"} placed)` +
        (res.skipped ? `; skipped ${res.skipped} without generated artwork` : "") +
        (res.failed ? `; ${res.failed} failed — run again for the rest` : "") +
        ".";
    }
  } catch (e) {
    error.value = e?.message?.replace(/^(internal|failed-precondition): /, "") || "Auto-adjust failed.";
  } finally {
    adjustingAllSpots.value = false;
  }
}

// switch a spot between "shows a fact", "opens a scene here", and "opens
// a scene in another world"
function setSpotKind(spot, kind) {
  if (kind === "fact") {
    delete spot.childSceneId;
    delete spot.childTopicId;
    return;
  }
  if (kind === "world") {
    if (!(spot.childSceneId && spot.childTopicId)) {
      const first = otherWorlds.value.values().next().value;
      if (first) setDoorWorld(spot, first.id);
    }
    return;
  }
  // "scene": a doorway inside this topic — a stale cross-topic target must be
  // re-picked, its scene id belongs to the other world's namespace
  if (spot.childTopicId !== undefined) {
    delete spot.childTopicId;
    spot.childSceneId = "";
  }
  if (!spot.childSceneId || !form.value.scenes[spot.childSceneId]) {
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
const depthDirection = ref(""); // optional steering — where the curator wants the depth
async function addMoreDepth() {
  if (depthBusy.value) return;
  depthBusy.value = true;
  error.value = "";
  try {
    if (dirty.value) { const ok = await save(); if (!ok) return; }
    message.value = "";
    depthNote.value = "Assessing the topic…";
    const plan = await planWikidoDepth({ topicId: selectedId.value, maxScenes: 3, hint: depthDirection.value.trim() });
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
        createScene: (args) => addWikidoChildScene({ topicId: selectedId.value, ...args }),
        onUpdate: (items) => {
          const s = summarizeRun(items);
          depthNote.value = `Writing scenes… ${s.done} done${s.failed ? `, ${s.failed} failed` : ""}.`;
        },
      });
      // the system retries transient failures automatically — once
      if (run.items.some((i) => i.status === "failed")) {
        depthNote.value = "Retrying failed scenes…";
        await retryFailedItems({
          items: run.items,
          createScene: (args) => addWikidoChildScene({ topicId: selectedId.value, ...args }),
          rootParentSceneId: branch.parentSceneId,
          onUpdate: (items) => {
            const s = summarizeRun(items);
            depthNote.value = `Retrying… ${s.done} done${s.failed ? `, ${s.failed} failed` : ""}.`;
          },
        });
      }
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

// ── re-link misplaced scenes (read-only assessment) ─────────────────────────
// The curator studies the whole topic — titles, narrations, spot labels,
// doorways — and proposes where every unreachable or misplaced scene belongs
// (the same "unreachable from root" problems the save check blocks on). Moves
// are applied through the same guarded helpers as the map's drag-and-drop and
// stay unsaved until the curator commits.
const relinkBusy = ref(false);
const relinkNote = ref("");
const relinkReport = ref([]); // [{ sceneTitle, parentTitle, reason }]
async function relinkScenes() {
  if (relinkBusy.value || depthBusy.value) return;
  relinkBusy.value = true;
  error.value = "";
  try {
    if (dirty.value) { const ok = await save(); if (!ok) return; }
    message.value = "";
    relinkNote.value = "Studying the topic…";
    relinkReport.value = [];
    const res = await planWikidoRelinks({ topicId: selectedId.value });
    const moves = res.moves || [];
    if (!moves.length) {
      message.value = "The curator studied the topic — every scene is already where it belongs.";
      return;
    }
    const applied = [];
    for (const m of moves) {
      const next = moveSceneTo(form.value.scenes, m.sceneId, m.parentSceneId, null, form.value.rootSceneId);
      if (!next) continue;
      form.value.scenes = next;
      // name the new doorway after what the child will find there
      if (m.doorwayLabel) {
        const door = (form.value.scenes[m.parentSceneId].hotspots || []).find((h) => h.childSceneId === m.sceneId && !h.childTopicId);
        if (door) door.label = m.doorwayLabel;
      }
      applied.push({ sceneTitle: m.sceneTitle, parentTitle: m.parentTitle, reason: m.reason });
    }
    if (applied.length) {
      relinkReport.value = applied;
      message.value = `Re-linked ${applied.length} of ${moves.length} misplaced ${moves.length === 1 ? "scene" : "scenes"} — review the map, then save your edits.`;
    } else {
      error.value = `The curator suggested ${moves.length} ${moves.length === 1 ? "move" : "moves"}, but none could be applied — the target pictures may be full (8 spots each).`;
    }
  } catch (e) {
    error.value = e?.message?.replace("internal: ", "") || "Could not re-link scenes.";
  } finally {
    relinkBusy.value = false;
    relinkNote.value = "";
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
        <label class="create-globe" title="Open on a playable 3D Earth; pin places onto the globe by name">
          <input v-model="newIsGlobe" type="checkbox" /> 🌍 3D globe world
        </label>
        <button class="btn primary" type="submit" :disabled="creating || !newTitle.trim()">
          {{ creating ? "Designing the world…" : newIsGlobe ? "Create globe world" : "Generate topic" }}
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
        <span v-if="!t.bundled && reorderableCount > 1" class="chip-move">
          <button type="button" class="tree-act" :disabled="chipBusy === t.id" :aria-label="`Move ${t.title} earlier on the shelf`" title="Move earlier on the shelf" @click.stop="moveTopicChip(t.id, 'up')">↑</button>
          <button type="button" class="tree-act" :disabled="chipBusy === t.id" :aria-label="`Move ${t.title} later on the shelf`" title="Move later" @click.stop="moveTopicChip(t.id, 'down')">↓</button>
        </span>
      </div>
    </section>

    <!-- workspace -->
    <section v-if="form" class="workspace">
      <p v-if="isBundled" class="note">This bundled world is editable. Save creates a draft; publish when ready to show your changes to families.</p>
      <header class="ws-toolbar">
        <div>
          <h2>{{ form.emoji }} {{ form.title }} <span class="status-pill" :class="selectedDoc?.status">{{ selectedDoc?.status }}</span></h2>
          <p>{{ Object.keys(form.scenes).length }} scenes · {{ missingArtwork.length }} awaiting artwork <span v-if="dirty">· unsaved edits</span></p>
        </div>
        <div class="toolbar-actions">
          <input
            v-model="depthDirection"
            class="depth-direction"
            type="text"
            maxlength="300"
            :disabled="depthBusy"
            placeholder="Optional direction — e.g. “more about how animals sense the world”"
            title="Steer where ✦ Add more depth goes. Leave empty and the curator decides."
            @keydown.enter.prevent="addMoreDepth"
          />
          <button class="btn primary" :disabled="depthBusy || relinkBusy" title="The agent assesses the whole topic and adds new deeper scenes with content (unsaved edits are saved first)" @click="addMoreDepth">
            {{ depthBusy ? (depthNote || "Assessing the topic…") : "✦ Add more depth" }}
          </button>
          <button
            class="btn"
            :disabled="relinkBusy || depthBusy"
            title="The agent studies the topic's hierarchy and links every unreachable or misplaced scene under its proper parent (unsaved edits are saved first)"
            @click="relinkScenes"
          >
            {{ relinkBusy ? (relinkNote || "Studying the topic…") : "✦ Re-link misplaced scenes" }}
          </button>
          <button
            class="btn"
            :disabled="adjustingAllSpots || !hasGeneratedArt || depthBusy || relinkBusy || imageBusy !== ''"
            title="The agent re-reads every generated picture in this topic and moves all spots onto what each picture shows (unsaved edits are saved first)"
            @click="autoAdjustAllSpots"
          >
            {{ adjustingAllSpots ? "Auto-adjusting every spot…" : "✦ Auto-adjust all spots" }}
          </button>
          <button class="btn" :disabled="generatingImages || !missingArtwork.length" @click="generateAllImages">
            {{ generatingImages ? "Painting scenes…" : missingArtwork.length ? `Generate artwork (${missingArtwork.length})` : "Artwork complete ✓" }}
          </button>
          <button class="btn" :disabled="saving || !dirty" @click="save">{{ saving ? "Saving…" : "Save edits" }}</button>
          <button class="btn primary" :disabled="dirty" @click="togglePublish">
            {{ selectedDoc?.status === "published" ? "Unpublish" : "Publish to families" }}
          </button>
          <button v-if="!isBundled" class="btn danger" @click="removeTopic">{{ selectedDoc?.bundledOrigin ? "Restore bundled version" : "Delete" }}</button>
        </div>
      </header>
      <p v-if="dirty" class="note warn">You have unsaved edits — save before publishing so families see your changes.</p>

      <!-- what the re-link agent just did, until the curator saves -->
      <div v-if="relinkReport.length" class="relink-report">
        <p class="relink-head">
          Re-linked by the curator — review the map, then save:
          <button type="button" class="tree-act" aria-label="Dismiss the re-link report" @click="relinkReport = []">✕</button>
        </p>
        <ul>
          <li v-for="r in relinkReport" :key="r.sceneTitle">
            <strong>“{{ r.sceneTitle }}”</strong> now opens from <strong>“{{ r.parentTitle }}”</strong><template v-if="r.reason"> — {{ r.reason }}</template>
          </li>
        </ul>
      </div>

      <!-- voiceovers: pick an engine categorically, then Generate audios —
           free Kokoro via the local bridge, or the platform's paid speech
           model that needs no local setup -->
      <section class="voiceover">
        <div class="vo-head">
          <span class="vo-dot" :class="{ on: bridge.online }"></span>
          <div class="vo-copy">
            <strong>Voiceovers</strong>
            <span v-if="bridge.online">
              {{ bridge.engine }} bridge online ({{ bridge.voice }}) · {{ voStats.recorded }}/{{ voStats.total }} clips recorded · missing clips record automatically
            </span>
            <span v-else>
              Bridge offline — Premium Kokoro records on the platform's servers (free, nothing is billed). Paid premium records with the configured speech model.
            </span>
          </div>
          <label class="vo-force">
            <input v-model="voForce" type="checkbox" /> re-record all
          </label>
        </div>
        <div class="vo-engine" role="radiogroup" aria-label="Voice engine">
          <label class="vo-option" :class="{ picked: voiceEngine === 'kokoro' }">
            <input
              type="radio"
              name="voice-engine"
              value="kokoro"
              v-model="voiceEngine"
              :disabled="voGenerating"
              @change="enginePicked = true"
            />
            <span class="vo-name">Premium — Kokoro</span>
            <span class="vo-meta">limitless<template v-if="!bridge.online"> · on the platform's servers</template></span>
          </label>
          <label class="vo-option" :class="{ picked: voiceEngine === 'paid' }">
            <input
              type="radio"
              name="voice-engine"
              value="paid"
              v-model="voiceEngine"
              :disabled="voGenerating"
              @change="enginePicked = true"
            />
            <span class="vo-name">Paid premium<template v-if="ttsModelLabel"> — {{ ttsModelLabel }}</template></span>
            <span class="vo-meta">configured speech model · platform limits apply</span>
          </label>
          <button
            v-if="!bridge.online && isDevServed"
            class="btn"
            :disabled="bridgeStarting || voGenerating"
            :title="bridgeStarting ? (bridgeStartNote || 'Starting…') : 'Spawns the bridge on this machine (via the locally-served studio) and waits until it answers'"
            @click="startBridge"
          >
            {{ bridgeStarting ? (bridgeStartNote || "Starting…") : "▶ Start the bridge" }}
          </button>
          <button
            class="btn primary"
            :disabled="voGenerating || kokoroJobActive || !voStats.total"
            :title="voiceEngine === 'kokoro'
              ? 'Free premium — through the local bridge when it is up, recorded on the platform’s servers when it is not'
              : 'Paid premium — the configured speech model records every scene and spot; platform limits apply'"
            @click="generateAudios"
          >
            {{ kokoroBusy ? "Enqueueing the Kokoro job…" : voGenerating ? `Generating… ${voProgressNow.done}/${voProgressNow.total}` : voStats.recorded ? `Generate audios (${voStats.total - voStats.recorded})` : `Generate all ${voStats.total} audios` }}
          </button>
        </div>
        <div v-if="kokoroJob" class="vo-job">
          <template v-if="kokoroJobActive">
            <span class="vo-dot on"></span>
            <span class="vo-job-copy">
              Recording with Kokoro on the platform's servers — <strong>{{ kokoroJob.recorded || 0 }}/{{ kokoroJob.total || 0 }}</strong> clips<template v-if="kokoroJob.failed"> · {{ kokoroJob.failed }} failed</template>. Safe to close this tab — the queue keeps running.
            </span>
            <button class="btn" :disabled="kokoroStopping" @click="stopKokoroJob">{{ kokoroStopping ? "Stopping…" : "Stop the queue" }}</button>
          </template>
          <span v-else class="muted">
            Last Kokoro run: {{ kokoroJob.recorded || 0 }}/{{ kokoroJob.total || 0 }} recorded<template v-if="kokoroJob.status === 'cancelled'"> · stopped early</template><template v-else-if="kokoroJob.status === 'error'"> · failed — {{ kokoroJob.lastError || "unknown error" }}</template><template v-else-if="kokoroJob.failed"> · {{ kokoroJob.failed }} failed — press Generate audios for the rest</template>.
          </span>
        </div>
        <p v-if="voFailed.length" class="muted">Failed clips: {{ voFailed.join(", ") }} — try again.</p>
      </section>

      <!-- globe worlds: pin places by name; the agent resolves, writes, and pins -->
      <section v-if="isGlobeForm" class="pin-place card">
        <div>
          <h3 class="pane-title">🌍 Pin a place on the globe</h3>
          <p class="muted">
            Type any country, capital, city or famous place. The system finds its spot on the planet, writes the
            scene, and pins the doorway — country spots show first, city spots appear as the child zooms in,
            and landmark spots when they zoom close.
          </p>
        </div>
        <form class="layer-form" @submit.prevent="pinPlace">
          <input
            v-model="placeQuery"
            type="text"
            placeholder="e.g. “Pakistan”, “Lahore”, “Eiffel Tower”"
            aria-label="Place to pin on the globe"
          />
          <button class="btn primary" type="submit" :disabled="placeBusy || !placeQuery.trim()">
            {{ placeBusy ? (placeNote || "Pinning…") : "＋ Pin this place" }}
          </button>
        </form>
      </section>

      <p class="model-line">
        <template v-if="isGlobeForm">
          This world opens on a <strong>3D globe</strong>. Every place is a <strong>spot on the planet</strong> that
          <strong>opens a scene</strong> — zoom in to reveal city and landmark spots.
        </template>
        <template v-else>
          A topic is a <strong>map of scenes</strong>. Each scene is a picture with <strong>spots</strong>.
          A spot either <strong>shows a fact</strong>, <strong>opens another scene</strong>, or <strong>opens another world</strong>.
        </template>
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
          <p class="tree-hint">Hold ⠿ and drag a scene anywhere: drop between rows to reorder, or onto a scene to make it the parent — everything under the dragged scene moves along.</p>
          <div
            v-for="{ id, depth, parentId } in orderedScenes"
            :key="id"
            class="scene-row"
            :class="[
              { active: id === selectedSceneId, nested: depth > 0, dragging: dragSceneId === id },
              dropHint && dropHint.rowId === id ? `drop-${dropHint.mode}` : '',
            ]"
            :style="{ marginLeft: `${depth * 0.9}rem` }"
            @dragover="onRowDragOver($event, id)"
            @dragleave="onRowDragLeave(id)"
            @drop="onRowDrop($event, id)"
          >
            <span
              class="drag-grip"
              draggable="true"
              :aria-label="`Drag to move ${form.scenes[id].title}`"
              title="Drag to move this scene"
              @dragstart="onDragStart($event, id)"
              @dragend="onDragEnd"
            >⠿</span>
            <button type="button" class="scene-main" :aria-current="id === selectedSceneId" @click="selectScene(id)">
              <span class="scene-thumb">
                <img v-if="hasArt(form.scenes[id])" :src="form.scenes[id].image.src" alt="" />
                <span v-else class="thumb-empty">🖼</span>
              </span>
              <span class="scene-name">{{ form.scenes[id].title }}</span>
              <span class="status-dot" :class="sceneStatusOf(id).key" :title="sceneStatusOf(id).label" :aria-label="sceneStatusOf(id).label"></span>
            </button>
            <small class="muted scene-parent">{{ parentId ? `Under ${form.scenes[parentId].title}` : id === form.rootSceneId ? 'Topic entrance' : 'Unlinked scene — choose a parent' }}</small>
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

          <!-- the scene hangs from exactly one parent: pick it here or drag in the map -->
          <label v-if="selectedScene.id !== form.rootSceneId" class="field parent-field">Parent scene (the picture whose spot opens this one)
            <select :value="currentParentId ?? ''" @change="changeParent($event.target.value)">
              <option v-if="!currentParentId" value="">— none yet: this scene is unreachable —</option>
              <option v-for="row in orderedScenes" :key="row.id" :value="row.id" :disabled="!allowedParentIds.has(row.id)">
                {{ parentOptionLabel(row) }}
              </option>
            </select>
          </label>
          <p v-if="selectedScene.id !== form.rootSceneId && deeperSceneCount" class="muted parent-note">
            Choosing a parent moves this scene and its {{ deeperSceneCount }} deeper {{ deeperSceneCount === 1 ? "scene" : "scenes" }} along with it.
          </p>
          <p v-else-if="selectedScene.id === form.rootSceneId" class="muted parent-note">The entrance always comes first, so it has no parent — every other scene hangs from some picture.</p>

          <!-- the globe hub: the editor IS the planet -->
          <div v-if="isHubScene" class="hub-editor-zone">
            <div class="hub-editor-grid">
              <WikidoGlobeEditor
                :spots="selectedScene.hotspots"
                :selected-id="selectedSpotId"
                @select="selectSpot"
                @relocate="relocateGlobeSpot"
              />
              <div class="hub-editor-copy">
                <p>
                  This is the <strong>globe hub</strong> — children open the world on a 3D Earth and tap the pinned
                  places. Country spots show first; city and landmark spots appear as they zoom in.
                </p>
                <p>
                  Every place's coordinates are <strong>pre-saved</strong> when you pin it, so pins sit exactly
                  right by default. <strong>Drag a pin</strong> only if you want to fine-tune its spot on the
                  planet, then save. Borders come from Natural Earth. Click a pin to edit its card below.
                </p>
                <p v-if="selectedScene.hotspots.length" class="muted">
                  {{ selectedScene.hotspots.length }} place{{ selectedScene.hotspots.length === 1 ? "" : "s" }} pinned — the list below is the order children explore them in.
                </p>
              </div>
            </div>
          </div>
          <div v-else-if="selectedScene.id !== form.rootSceneId || !isGlobeForm" class="stage-wrap">
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
              :class="[outcomeOf(spot).kind, { selected: spot.id === selectedSpotId, dragging: spot.id === draggingSpotId }]"
              :style="pinStyle(spot.x, spot.y)"
              :aria-label="`Spot ${i + 1}: ${spot.label}`"
              :title="`${spot.label} — ${outcomeOf(spot).text}. Drag to move.`"
              @pointerdown.prevent="startPinDrag($event, spot)"
              @pointermove="movePinDrag"
              @pointerup="endPinDrag($event, spot)"
              @pointercancel="cancelPinDrag"
              @lostpointercapture="cancelPinDrag"
              :disabled="saving"
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
          <div class="placement-tools">
            <div>
              <p class="stage-hint">Hold and drag a numbered spot to position it, then save. Click a spot to edit it.</p>
              <p class="placement-status" role="status">{{ placement || (dirty ? "Unsaved edits" : "Positions saved") }}</p>
              <p v-if="error" class="placement-error" role="alert">{{ error }}</p>
            </div>
            <div class="placement-actions">
              <button
                type="button"
                class="btn"
                :disabled="!hasHostedArt(selectedScene) || !selectedScene.hotspots.length || adjustingSpots || imageBusy === selectedScene.id || saving || !!draggingSpotId"
                :title="hasHostedArt(selectedScene)
                  ? 'The agent re-reads this picture and moves every spot onto what it actually shows'
                  : 'Auto-adjust reads the generated picture — generate the artwork first'"
                @click="autoAdjustSpots"
              >{{ adjustingSpots ? "Reading the picture…" : "✦ Auto-adjust spots" }}</button>
              <button type="button" class="btn" :disabled="saving || !dirty || !!draggingSpotId" @click="savePlacement">{{ saving ? "Saving…" : "Save spot positions" }}</button>
            </div>
          </div>
          </div>

          <label class="field">Scene title
            <input v-model="selectedScene.title" type="text" />
          </label>
          <label class="field">Narration (read aloud when the scene opens)
            <textarea v-model="selectedScene.narration" rows="3"></textarea>
          </label>
          <label class="field">Artwork prompt (what the picture shows — landmarks left/centre/right)
            <textarea v-model="selectedScene.artPrompt" rows="3"></textarea>
          </label>

          <h3 class="pane-title">{{ isHubScene ? `Places on the globe (${selectedScene.hotspots.length})` : `Spots on this picture (${selectedScene.hotspots.length})` }}</h3>
          <div
            v-for="(spot, spotIndex) in selectedScene.hotspots"
            :id="`spot-row-${spot.id}`"
            :key="spot.id"
            class="spot"
            :class="{ selected: spot.id === selectedSpotId, dragging: spot.id === draggingSpotId }"
          >
            <div class="spot-head">
              <button type="button" class="spot-toggle" :aria-expanded="spot.id === selectedSpotId" @click="selectSpot(spot.id)">
                <span class="spot-num" :class="outcomeOf(spot).kind">{{ spotIndex + 1 }}</span>
                <span class="spot-label">
                  {{ spot.label }}
                  <span v-if="spotNeedsDetails(spot).needs" class="needs-badge" title="Placeholder details — press ✦ and the agent writes them">✦ needs details</span>
                </span>
                <span class="outcome" :class="outcomeOf(spot).kind">
                  <span aria-hidden="true">{{ outcomeOf(spot).kind === "fact" ? "💡" : outcomeOf(spot).kind === "scene" ? "🚪" : outcomeOf(spot).kind === "world" ? "🌍" : "⚠" }}</span>
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
              <button type="button" class="spot-del" :aria-label="`Remove spot ${spot.label}`" title="Remove this spot and its local scene branch" @click="removeHotspot(selectedScene, spot.id)">Remove</button>
            </div>

            <div v-if="spot.id === selectedSpotId" class="spot-body">
              <label class="field">Spot name
                <input v-model="spot.label" type="text" />
              </label>
              <fieldset v-if="!isHubScene" class="kind">
                <legend>When a child taps this spot…</legend>
                <label><input type="radio" :name="`kind-${spot.id}`" :checked="!spot.childSceneId" @change="setSpotKind(spot, 'fact')" /> 💡 It shows a fact card</label>
                <label><input type="radio" :name="`kind-${spot.id}`" :checked="spot.childSceneId && !spot.childTopicId" @change="setSpotKind(spot, 'scene')" /> 🚪 It opens another scene here</label>
                <label><input type="radio" :name="`kind-${spot.id}`" :checked="spot.childSceneId && spot.childTopicId" @change="setSpotKind(spot, 'world')" /> 🌍 It opens a scene in ANOTHER world</label>
              </fieldset>
              <p v-else class="muted door-note">🌍 A globe place always opens the scene below. Pin more places from the “Pin a place” bar at the top.</p>
              <div v-if="isHubScene" class="field-row">
                <label class="field">Zoom level (when the spot appears)
                  <select v-model="spot.level">
                    <option value="country">🌍 Country — visible immediately</option>
                    <option value="city">🏙️ City — appears when zoomed in</option>
                    <option value="location">📍 Location — appears when zoomed close</option>
                  </select>
                </label>
              </div>
              <div v-if="isHubScene" class="field-row">
                <label class="field">Latitude (−90 … 90)
                  <input v-model.number="spot.lat" type="number" step="0.0001" min="-90" max="90" />
                </label>
                <label class="field">Longitude (−180 … 180)
                  <input v-model.number="spot.lng" type="number" step="0.0001" min="-180" max="180" />
                </label>
              </div>
              <label v-if="spot.childSceneId && !spot.childTopicId" class="field">Opens this scene
                <select v-model="spot.childSceneId">
                  <option v-for="s in orderedScenes" :key="s.id" :value="s.id" :disabled="s.id === selectedSceneId">{{ form.scenes[s.id].title }}</option>
                </select>
              </label>
              <template v-if="spot.childSceneId && spot.childTopicId">
                <label class="field">In this world
                  <select :value="spot.childTopicId" @change="setDoorWorld(spot, $event.target.value)">
                    <option v-for="w in otherWorlds.values()" :key="w.id" :value="w.id">{{ w.title }}{{ w.status && w.status !== "published" ? " (draft)" : "" }}</option>
                  </select>
                </label>
                <label class="field">Opens this scene there
                  <select :value="spot.childSceneId" @change="spot.childSceneId = $event.target.value">
                    <option v-for="s in worldScenesOf(spot)" :key="s.id" :value="s.id">{{ s.title }}</option>
                  </select>
                </label>
                <p class="muted door-note">🌍 Cross-topic doorway: children step from this world straight into “{{ otherWorlds.get(spot.childTopicId)?.title || spot.childTopicId }}”.</p>
              </template>
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
              <details v-if="!isHubScene" class="advanced">
                <summary>Exact position</summary>
                <div class="field-row">
                  <label class="field">Across (%)<input v-model.number="spot.x" type="number" min="0" max="100" /></label>
                  <label class="field">Down (%)<input v-model.number="spot.y" type="number" min="0" max="100" /></label>
                </div>
              </details>
            </div>
          </div>
          <button v-if="!isHubScene" class="btn" @click="addHotspot(selectedScene)">＋ Add a spot to this picture</button>
          <button v-else class="btn" @click="addGlobeSpot">＋ Pin a place by hand</button>

          <!-- grow -->
          <section v-if="!isHubScene" class="grow card">
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

          <section v-if="!isHubScene" class="grow card builder">
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
              Deleting only this scene moves its children to its parent. It has {{ deleteInfo.deeper.length }} deeper {{ deleteInfo.deeper.length === 1 ? "scene" : "scenes" }}: {{ deleteInfo.deeper.join(", ") }}.
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
.chip-status.bundled { background: #EDE9FE; color: #5B21B6; }
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
/* the categorical engine picker: free Kokoro vs the paid platform voice */
.vo-engine { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; padding: 0.35rem 0 0; }
.vo-option {
  display: flex; align-items: baseline; gap: 0.35rem;
  border: 1.5px solid var(--border); border-radius: 10px; padding: 0.3rem 0.65rem;
  cursor: pointer; background: #fff;
}
.vo-option.picked { border-color: var(--primary); background: var(--primary-soft); }
.vo-option input { accent-color: var(--primary); margin: 0; }
.vo-name { font-size: 0.8rem; font-weight: 700; color: var(--text); white-space: nowrap; }
.vo-meta { font-size: 0.72rem; color: var(--muted); white-space: nowrap; }
.vo-engine .btn { margin-left: auto; }
.vo-job {
  display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap;
  border: 1px dashed var(--border); border-radius: 10px; padding: 0.4rem 0.7rem;
  font-size: 0.82rem; color: var(--text2);
}
.vo-job-copy { flex: 1; min-width: 200px; }
.ws-toolbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
.ws-toolbar h2 { margin: 0; font-size: 1.3rem; }
.ws-toolbar p { margin: 0.2rem 0 0; color: var(--muted); font-size: 0.85rem; }
.toolbar-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.depth-direction { flex: 1 1 240px; max-width: 340px; }
.relink-report { border: 1px solid var(--line, #ddd); border-radius: 8px; padding: 0.5rem 0.9rem; margin: 0.5rem 0; font-size: 0.92em; background: rgba(127, 127, 127, 0.06); }
.relink-report ul { margin: 0.25rem 0 0.25rem 1.1rem; padding: 0; }
.relink-report .relink-head { margin: 0.15rem 0; font-weight: 600; display: flex; align-items: center; gap: 0.4rem; }
.status-pill { font-size: 0.68rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; border-radius: 999px; padding: 0.2rem 0.55rem; vertical-align: middle; }
.status-pill.published { background: #DCFCE7; color: #14532D; }
.status-pill.draft { background: #FEF3C7; color: #92400E; }
.status-pill.bundled { background: #EDE9FE; color: #5B21B6; }



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
/* free drag-and-drop on the map */
.drag-grip {
  cursor: grab; color: var(--muted); font-size: 0.8rem; line-height: 1;
  padding: 0.2rem 0.15rem; border-radius: 6px; user-select: none; flex-shrink: 0;
}
.drag-grip:hover { background: var(--primary-soft); color: var(--primary); }
.drag-grip:active { cursor: grabbing; }
.scene-row.dragging { opacity: 0.35; }
.scene-row.drop-into { outline: 2px dashed var(--primary); outline-offset: -2px; background: var(--primary-soft); }
.scene-row.drop-before { box-shadow: inset 0 3px 0 var(--primary); }
.scene-row.drop-after { box-shadow: inset 0 -3px 0 var(--primary); }
.scene-sub { font-size: 0.72rem; color: var(--muted); padding-left: 0.1rem; }
.scene-parent { font-size: 0.72rem; padding-left: 0.1rem; }
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
.placement-tools { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
.placement-actions { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.placement-error { margin: .35rem 0 0; color: #B91C1C; font-size: .8rem; }
.placement-status { margin: .35rem 0 0; font-size: .8rem; color: var(--text); }
.stage-hint { margin: -0.4rem 0 0; font-size: 0.75rem; color: var(--muted); }

.pin {
  position: absolute; transform: translate(-50%, -50%); width: 30px; height: 30px; border-radius: 50%;
  border: 3px solid #fff; background: #7C3AED; color: #fff; font-weight: 800; font-size: 0.8rem; font-family: inherit;
  cursor: grab; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4); display: grid; place-items: center; padding: 0;
}
.pin.scene { background: #0D9488; }
.pin.broken { background: #DC2626; }
.pin:active, .pin.dragging { cursor: grabbing; }
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
.spot-num.world { background: #B45309; }
.spot-num.broken { background: #DC2626; }
.spot-label { font-weight: 700; font-size: 0.9rem; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-flex; align-items: center; gap: 0.35rem; }
.needs-badge {
  font-size: 0.62rem; font-weight: 800; letter-spacing: 0.03em;
  color: #92400E; background: #FEF3C7; border-radius: 999px; padding: 0.1rem 0.45rem;
  white-space: nowrap;
}
.outcome { margin-left: auto; font-size: 0.74rem; font-weight: 700; border-radius: 999px; padding: 0.16rem 0.6rem; background: #F3E8FF; color: #6D28D9; white-space: nowrap; }
.outcome.scene { background: #CCFBF1; color: #0F766E; }
.outcome.world { background: #FEF3C7; color: #92400E; }
.outcome.broken { background: #FEE2E2; color: #991B1B; }
.door-note { margin: 0.2rem 0 0; font-size: 0.78rem; }
.spot-order { display: inline-flex; gap: 0; }
.spot-del { border: none; background: none; color: var(--muted); cursor: pointer; font-family: inherit; font-size: 0.74rem; font-weight: 700; padding: 0.2rem 0.4rem; border-radius: 6px; }
.spot-del:hover { color: #B91C1C; background: #FEE2E2; }
.spot-body { display: flex; flex-direction: column; gap: 0.6rem; padding: 0.6rem 0 0.4rem; }
.kind { border: 1.5px solid var(--border); border-radius: 10px; padding: 0.5rem 0.75rem; display: flex; flex-direction: column; gap: 0.35rem; font-size: 0.85rem; }
.kind legend { font-size: 0.78rem; font-weight: 700; color: var(--text2); padding: 0 0.3rem; }
.kind label { display: flex; align-items: center; gap: 0.4rem; cursor: pointer; }
.advanced summary { cursor: pointer; font-size: 0.78rem; color: var(--muted); }

/* grow */
.pin-place { display: flex; flex-direction: column; gap: 0.5rem; padding: 0.9rem 1rem; border: 1.5px solid #A5F3FC; background: #ECFEFF; }
.pin-place .pane-title { margin-top: 0; }
.pin-place .muted { margin: 0; }
.hub-editor-zone { border: 1.5px solid var(--border); border-radius: 14px; padding: 0.75rem; background: #F8F7FC; }
.hub-editor-grid { display: grid; grid-template-columns: minmax(280px, 440px) 1fr; gap: 1rem; align-items: start; }
@media (max-width: 900px) { .hub-editor-grid { grid-template-columns: 1fr; } }
.hub-editor-copy { display: flex; flex-direction: column; gap: 0.5rem; font-size: 0.88rem; color: var(--text2); }
.hub-editor-copy p { margin: 0; }
.create-globe { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.85rem; font-weight: 700; color: var(--text2); white-space: nowrap; }

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
