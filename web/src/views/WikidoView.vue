<script setup>
// Wikido — an immersive, picture-first encyclopedia for children. Topics come
// from two places: developer-authored packs bundled with the app, and topics
// generated + published by the superadmin through the Wikido Studio (Firestore).
// The child's whole experience is looking, tapping, listening, and stepping deeper.
//
// Navigation is a JOURNEY: a list of segments, one per world entered. Internal
// doorways extend the current segment; a cross-topic doorway (a hotspot that
// names another topic via childTopicId) loads that world and starts a new
// segment, landing on the target scene with its own ancestors as trail.
// Breadcrumbs span the whole journey, so a crumb from the previous world steps
// back across worlds.
import { computed, onBeforeUnmount, provide, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  WIKIDO_SHARE, buildWikidoLocation, coldJourneySegment, parseWikidoLocation, resolveWikidoTarget,
} from "@/lib/wikido/urlState";
import { listWikidoTopics, getWikidoTopic, loadWikidoTopic, fetchCloudTopics } from "@/services/wikido";
import { sortStudioTopics } from "@/services/wikidoAdmin";
import { useWikidoProgress } from "@/lib/wikido/progress";
import { useSpeech } from "@/composables/useSpeech";
import { useAuthStore } from "@/stores/auth";
import WikidoScene from "@/components/wikido/WikidoScene.vue";
import WikidoGlobe from "@/components/wikido/WikidoGlobe.vue";
import WikidoTopicCard from "@/components/wikido/WikidoTopicCard.vue";
import { isGlobeHub } from "../../../functions/lib/wikidoGlobe.js";
import WikidoGate from "@/components/wikido/WikidoGate.vue";
import WikidoMusic from "@/components/wikido/WikidoMusic.vue";
import WikidoLensBar from "@/components/wikido/WikidoLensBar.vue";
import { sceneLenses, baseSceneId, MAIN_LENS } from "../../../functions/lib/wikidoPerspectives.js";
import { playLensTurn, preloadImage, warmLensTurn } from "@/lib/wikido/lensTransition";

// The URL is the single source of truth for WHERE the child is (world, scene,
// open card, globe camera, narration panel): every navigation pushes a route,
// and the journey below is rebuilt from the route — so a shared link, a
// refresh and the browser's Back/Forward all land on exactly the same state.
// Auth needs no special handling: the route is public and WikidoGate signs
// visitors in place, without leaving the URL.
const router = useRouter();
const route = useRoute();
const loc = computed(() => parseWikidoLocation(route));
const auth = useAuthStore();
const { countSeen } = useWikidoProgress();
const { stop } = useSpeech();

const bundled = listWikidoTopics();
const cloud = ref([]);        // studio topics (published; drafts for superadmins)
const cloudLoading = ref(true);
const opening = ref(false);   // fetching a topic's full pack (shelf or doorway)

const shelf = computed(() => {
  const bundledIds = new Set(bundled.map((t) => t.id));
  const overrides = new Map(cloud.value.map((t) => [t.id, t]));
  return [...bundled.map((t) => overrides.get(t.id) || t), ...cloud.value.filter((t) => !bundledIds.has(t.id))];
});

const journey = ref([]);            // [{ topicId, scenes: [sceneId, …] }] — last scene of the last segment is on screen
const packsById = ref(new Map());   // topicId → validated pack, cached across the journey
const doorFailures = ref(new Set()); // worlds a cross-topic doorway tried but failed to open

const segment = computed(() => journey.value[journey.value.length - 1] || null);
const topic = computed(() => (segment.value ? packsById.value.get(segment.value.topicId) : null));
const scene = computed(() => (topic.value && segment.value ? topic.value.scenes[segment.value.scenes.at(-1)] : null));
// GLOBE worlds open on a playable 3D Earth: the root scene is the hub whose
// doorway spots are pinned to the planet by lat/lng (see WikidoGlobe).
const onGlobe = computed(() => Boolean(topic.value && scene.value && isGlobeHub(topic.value, scene.value.id)));
const trail = computed(() => {
  const crumbs = [];
  for (const seg of journey.value) {
    const pack = packsById.value.get(seg.topicId);
    for (const sceneId of seg.scenes) {
      crumbs.push({ topicId: seg.topicId, sceneId, title: pack?.scenes[sceneId]?.title || sceneId });
    }
  }
  return crumbs.slice(0, -1); // the last entry is the scene on screen
});

// Worlds a cross-topic doorway may open — everything on the shelf. A world
// missing here (draft, unpublished, or failed to load) leaves its doorways dormant.
const topicDirectory = computed(() => {
  const dir = {};
  for (const t of shelf.value) dir[t.id] = { title: t.title, draft: Boolean(t.draft) };
  for (const id of doorFailures.value) delete dir[id];
  return dir;
});

// Cloud topics load as soon as there is a signed-in user — which may be right
// away (route is open to shared links; the gate signs visitors in place) or
// after the gate authenticates them, so watch rather than fetch once.
watch(
  () => auth.user,
  async (user) => {
    if (!user) return;
    // superadmins additionally preview studio drafts on the shelf; drafts are
    // also filtered here in case a query ever returns one by accident.
    // Studio topics follow the bundled flagship pack, in the curator's order.
    const fetched = await fetchCloudTopics({ includeDrafts: auth.isSuperAdmin });
    cloud.value = sortStudioTopics(fetched.filter((t) => auth.isSuperAdmin || !t.draft));
    cloudLoading.value = false;
  },
  { immediate: true }
);

function totalFor(summary) {
  if (summary.source === "cloud") return summary.discoveryCount || 0;
  const pack = getWikidoTopic(summary.id);
  return pack ? Object.values(pack.scenes).reduce((n, sc) => n + sc.hotspots.length, 0) : 0;
}

async function resolvePack(topicId) {
  const cached = packsById.value.get(topicId);
  if (cached) return cached;
  const pack = await loadWikidoTopic(topicId);
  if (pack) {
    const next = new Map(packsById.value);
    next.set(topicId, pack);
    packsById.value = next;
  }
  return pack;
}

// ── friendly notices + share ─────────────────────────────────────────────────
const toast = ref("");
let toastTimer = 0;
let camTimer = 0;
function notify(message) {
  toast.value = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.value = ""; }, 4500);
}

const rootOf = (topicId) => packsById.value.get(topicId)?.rootSceneId || "";
// a perspective picture's URL is its scene's URL + ?lens= (one canonical URL per view)
function locationFor(state) {
  const pack = packsById.value.get(state.topicId);
  const sc = pack?.scenes?.[state.sceneId];
  const s = sc?.perspectiveOf && pack.scenes[sc.perspectiveOf] ? { ...state, sceneId: sc.perspectiveOf, lens: sc.lens } : state;
  return buildWikidoLocation(s, { rootSceneId: rootOf(state.topicId) });
}
const wrapLng = (lng) => ((((lng + 180) % 360) + 360) % 360) - 180;

// "Copy link": the Web Share sheet on phones, the clipboard everywhere else.
// `camera` (globe) pins the exact view; `withCard` keeps the open card in it.
async function share({ withCard = false, camera = null } = {}) {
  const cur = loc.value;
  const at = camera ? { lat: camera.lat, lng: wrapLng(camera.lng), zoom: camera.zoom } : cur.at;
  const target = locationFor({ ...cur, card: withCard ? cur.card : "", at, intro: null });
  const url = new URL(router.resolve(target).href, window.location.origin).href;
  const coarse = window.matchMedia?.("(pointer: coarse)")?.matches;
  if (coarse && navigator.share) {
    try {
      await navigator.share({ title: topic.value?.title ? `${topic.value.title} — Wikido` : "Wikido", url });
      return;
    } catch (e) {
      if (e?.name === "AbortError") return; // the child closed the share sheet
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    notify("Link copied");
  } catch {
    window.prompt("Copy this link", url);
  }
}
provide(WIKIDO_SHARE, share);

// ── route → journey ──────────────────────────────────────────────────────────
// Put `sceneId` on screen: stepping back along the journey trims it, a doorway
// from the current scene extends it, and anything else (a cold open, Forward)
// rebuilds the trail from the scene's natural ancestors.
function placeScene(pack, sceneId) {
  const j = journey.value;
  let cut = null;
  j.forEach((seg, si) => seg.scenes.forEach((id, ii) => {
    if (seg.topicId === pack.id && id === sceneId) cut = { si, ii };
  }));
  // switching perspective swaps the picture in place — same spot in the trail
  if (!cut) {
    const lastSeg = j[j.length - 1];
    const lastId = lastSeg?.scenes.at(-1);
    if (lastSeg && lastSeg.topicId === pack.id && lastId && baseSceneId(pack.scenes, lastId) === baseSceneId(pack.scenes, sceneId) && lastId !== sceneId) {
      journey.value = [...j.slice(0, -1), { ...lastSeg, scenes: [...lastSeg.scenes.slice(0, -1), sceneId] }];
      return;
    }
  }
  if (cut) {
    const atEnd = cut.si === j.length - 1 && cut.ii === j[cut.si].scenes.length - 1;
    if (!atEnd) {
      journey.value = j.slice(0, cut.si + 1).map((seg, i) => (i === cut.si ? { ...seg, scenes: seg.scenes.slice(0, cut.ii + 1) } : seg));
    }
    return;
  }
  const last = segment.value;
  const here = last ? packsById.value.get(last.topicId)?.scenes[last.scenes.at(-1)] : null;
  if (last && last.topicId === pack.id && here?.hotspots.some((h) => h.childSceneId === sceneId && !h.childTopicId)) {
    journey.value = [...j.slice(0, -1), { ...last, scenes: [...last.scenes, sceneId] }];
    return;
  }
  if (last && here?.hotspots.some((h) => h.childTopicId === pack.id && h.childSceneId === sceneId)) {
    journey.value = [...j, coldJourneySegment(pack, sceneId)]; // a cross-topic doorway
    return;
  }
  journey.value = [coldJourneySegment(pack, sceneId)];
}

let syncId = 0;
async function syncRoute() {
  const id = ++syncId;
  clearTimeout(camTimer); // a camera note from the previous place must not stick to this one
  if (!auth.user) return; // the gate is up; this re-runs once the visitor is in
  const { topicId, sceneId, card, lens } = loc.value;
  if (!topicId) {
    if (journey.value.length) { stop(); journey.value = []; }
    return;
  }
  opening.value = true;
  try {
    const pack = await resolvePack(topicId);
    if (id !== syncId) return;
    if (!pack) {
      notify("That world isn't open right now — here are all the worlds.");
      router.replace(locationFor({}));
      return;
    }
    const target = resolveWikidoTarget(pack, { sceneId, card, lens });
    if (target.notice) notify(target.notice);
    if (target.sceneId !== (sceneId || pack.rootSceneId) || target.card !== card || target.lens !== (lens || "")) {
      // a stale or switched-off link: settle the address bar on the nearest valid place
      router.replace(locationFor({ ...loc.value, topicId, sceneId: target.sceneId, card: target.card, lens: target.lens }));
    }
    placeScene(pack, target.displaySceneId);
  } finally {
    if (id === syncId) opening.value = false;
  }
}
watch(
  () => `${loc.value.topicId}|${loc.value.sceneId}|${loc.value.lens}|${auth.user ? 1 : 0}`,
  syncRoute,
  { immediate: true }
);

// ── actions: each real navigation pushes a route ─────────────────────────────
function openTopic(summary) {
  if (opening.value) return;
  router.push(locationFor({ topicId: summary.id }));
}

function enter(spot) {
  if (!spot?.childSceneId || !topic.value) return;
  // a cross-topic doorway leaves this world entirely
  if (spot.childTopicId && spot.childTopicId !== topic.value.id) {
    enterWorld(spot.childTopicId, spot.childSceneId);
    return;
  }
  if (topic.value.scenes[spot.childSceneId]) {
    router.push(locationFor({ topicId: topic.value.id, sceneId: spot.childSceneId }));
  }
}

// Step through a cross-topic doorway: load the other world first (bundled packs
// resolve on the spot; studio topics come from Firestore), then go there. A
// world that vanished leaves the child where they are.
async function enterWorld(worldId, sceneId) {
  if (opening.value) return;
  opening.value = true;
  try {
    const pack = await resolvePack(worldId);
    if (!pack?.scenes[sceneId]) {
      // dropping it from the directory turns the doorway into an explained dormant door
      const next = new Set(doorFailures.value);
      next.add(worldId);
      doorFailures.value = next;
      return;
    }
  } finally {
    opening.value = false;
  }
  router.push(locationFor({ topicId: worldId, sceneId }));
}

function navigate(target) {
  router.push(locationFor({ topicId: target.topicId, sceneId: target.sceneId }));
}

function exit() {
  stop();
  router.push(locationFor({}));
}

// open card: push when one opens or closes (Back closes it), replace when it
// merely switches to another card
function onCard(cardId) {
  const cur = loc.value;
  if (!cur.topicId || cardId === cur.card) return;
  const next = locationFor({ ...cur, card: cardId });
  if (cur.card && cardId) router.replace(next);
  else router.push(next);
}
function onIntro(open) {
  if (loc.value.topicId) router.replace(locationFor({ ...loc.value, intro: open }));
}
// the globe camera moves constantly: remember it in the address bar (replace —
// never history), debounced so a drag is one write
function onCamera(camera) {
  clearTimeout(camTimer);
  camTimer = setTimeout(() => {
    if (!loc.value.topicId) return;
    router.replace(locationFor({ ...loc.value, at: { lat: camera.lat, lng: wrapLng(camera.lng), zoom: camera.zoom } }));
  }, 400);
}

// ── perspectives: one scene, several ways of looking at it ──────────────────
const lensList = computed(() => (topic.value && scene.value && !onGlobe.value ? sceneLenses(topic.value.scenes, scene.value.id) : []));
const activeLens = computed(() => (scene.value?.perspectiveOf ? scene.value.lens : MAIN_LENS));
const stageEl = ref(null);
const turning = ref(false);
watch(() => lensList.value.length > 1, (has) => { if (has) warmLensTurn(); }, { immediate: true });
function warmLens(id) {
  const l = lensList.value.find((x) => x.id === id);
  if (l) preloadImage(l.scene?.image?.src);
}
async function pickLens(id) {
  if (turning.value || id === activeLens.value || !topic.value) return;
  const list = lensList.value;
  const from = list.find((l) => l.id === activeLens.value);
  const to = list.find((l) => l.id === id);
  if (!to) return;
  turning.value = true;
  try {
    await preloadImage(to.scene?.image?.src, 1200); // turn onto a picture that is there
    const turn = await playLensTurn({
      container: stageEl.value,
      fromSrc: from?.scene?.image?.src,
      toSrc: to.scene?.image?.src,
      direction: list.indexOf(to) >= list.indexOf(from) ? 1 : -1,
    });
    await turn.covered;
    stop();
    // a perspective is a way of looking, not a new place: replace, never push
    router.replace(locationFor({ topicId: topic.value.id, sceneId: to.sceneId, intro: loc.value.intro }));
    await turn.done;
  } finally {
    turning.value = false;
  }
}

onBeforeUnmount(() => {
  stop();
  clearTimeout(camTimer);
  clearTimeout(toastTimer);
});
</script>

<template>
  <div ref="stageEl" class="wikido">
    <!-- ── session resolving: hold the backdrop so a signed-in visitor never
             sees the sign-in gate flash before Firebase reports the session ── -->
    <div
      v-if="!auth.initialized || (auth.user && loc.topicId && !topic && opening)"
      class="wd-wait"
      role="status"
      aria-label="Opening Wikido"
    >
      <span class="material-symbols-rounded wd-wait-logo">travel_explore</span>
    </div>
    <!-- ── gate: a shared link lands here — sign in / sign up in place,
             and the very next paint is the shelf (no redirect) ────────────── -->
    <WikidoGate v-else-if="!auth.user" />
    <!-- ── shelf: pick a topic ─────────────────────────────────────────── -->
    <section v-else-if="!topic" class="wd-shelf">
      <header class="wd-shelf-head">
        <button type="button" class="wd-back" aria-label="Back to Dar-al-Hikmah home" title="Home" @click="router.push('/')">
          <span class="material-symbols-rounded">arrow_back</span>
        </button>
        <div class="wd-shelf-brand">
          <span class="material-symbols-rounded wd-logo" aria-hidden="true">travel_explore</span>
          <div>
            <h1 class="wd-shelf-title">Wikido</h1>
            <p class="wd-shelf-sub">Wander through pictures. Tap what looks interesting. Listen and discover.</p>
          </div>
        </div>
      </header>
      <div class="wd-shelf-grid">
        <WikidoTopicCard
          v-for="t in shelf"
          :key="t.id"
          :topic="t"
          :draft="Boolean(t.draft)"
          :seen="countSeen(t.id)"
          :total="totalFor(t)"
          @open="openTopic"
        />
        <p v-if="!shelf.length" class="wd-empty">No worlds have been published yet — check back soon!</p>
      </div>
    </section>

    <!-- ── explorer: one immersive scene — a picture, or the 3D globe ── -->
    <WikidoGlobe
      v-if="onGlobe"
      :topic="topic"
      :scene="scene"
      :trail="trail"
      :topic-directory="topicDirectory"
      :card-id="loc.card"
      :intro="loc.intro"
      :camera="loc.at"
      @enter="enter"
      @navigate="navigate"
      @exit="exit"
      @card="onCard"
      @intro="onIntro"
      @camera="onCamera"
    >
      <template #tools><WikidoMusic /></template>
    </WikidoGlobe>
    <WikidoScene
      v-else-if="scene"
      :topic="topic"
      :scene="scene"
      :trail="trail"
      :topic-directory="topicDirectory"
      :card-id="loc.card"
      :intro="loc.intro"
      @enter="enter"
      @navigate="navigate"
      @exit="exit"
      @card="onCard"
      @intro="onIntro"
    >
      <template #tools><WikidoMusic /></template>
    </WikidoScene>
    <WikidoLensBar
      v-if="scene && !onGlobe && lensList.length > 1"
      :lenses="lensList"
      :active="activeLens"
      :busy="turning"
      @pick="pickLens"
      @warm="warmLens"
    />

    <Transition name="wd-toast">
      <p v-if="toast" class="wd-toast" role="status">{{ toast }}</p>
    </Transition>
  </div>
</template>

<style scoped>
/* The whole module owns the viewport — the app nav is hidden for this route. */
.wikido {
  position: fixed;
  inset: 0;
  z-index: 60;
  overflow: hidden;
  background: radial-gradient(120% 90% at 20% 0%, #3B1D5E 0%, #241533 55%, #140B20 100%);
}

/* ── session splash (while Firebase resolves the shared visitor's session) ── */
.wd-wait {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
}
.wd-wait-logo {
  font-size: 52px;
  color: #FDE68A;
  background: rgba(253, 230, 138, 0.14);
  border: 1.5px solid rgba(253, 230, 138, 0.4);
  border-radius: 20px;
  padding: 0.7rem;
  animation: wd-wait-pulse 1.2s ease-in-out infinite;
}
@keyframes wd-wait-pulse {
  0%, 100% { opacity: 0.55; transform: scale(0.97); }
  50% { opacity: 1; transform: scale(1.03); }
}

/* ── friendly notices ("Link copied", stale-link landings) ── */
.wd-toast {
  position: absolute;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  z-index: 90;
  max-width: min(90vw, 440px);
  margin: 0;
  padding: 0.6rem 1.1rem;
  border-radius: 999px;
  background: rgba(30, 18, 52, .94);
  border: 1.5px solid rgba(253, 230, 138, .5);
  color: #FFF7EA;
  font-size: 0.95rem;
  font-weight: 700;
  text-align: center;
  box-shadow: 0 10px 30px rgba(0, 0, 0, .4);
}
.wd-toast-enter-active, .wd-toast-leave-active { transition: opacity .3s ease, transform .3s ease; }
.wd-toast-enter-from, .wd-toast-leave-to { opacity: 0; transform: translate(-50%, 10px); }

/* ── shelf ───────────────────────────────────────────────────────────── */
.wd-shelf {
  height: 100%;
  overflow-y: auto;
  padding: 2.5rem clamp(1.5rem, 6vw, 5rem) 3rem;
}
.wd-shelf-head { display: flex; flex-direction: column; gap: 1.25rem; margin-bottom: 1.75rem; }
.wd-back {
  align-self: flex-start;
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: 50%;
  border: 1.5px solid rgba(255, 255, 255, .3);
  background: rgba(255, 253, 247, .1);
  color: #FFF7EA;
  cursor: pointer;
  transition: background .15s ease;
}
.wd-back:hover { background: rgba(255, 253, 247, .22); }
.wd-shelf-brand { display: flex; align-items: center; gap: 1rem; }
.wd-logo {
  font-size: 44px;
  color: #FDE68A;
  background: rgba(253, 230, 138, .14);
  border: 1.5px solid rgba(253, 230, 138, .4);
  border-radius: 18px;
  padding: 0.55rem;
}
.wd-shelf-title {
  margin: 0;
  font-size: 2.3rem;
  line-height: 1;
  color: #FFF7EA;
  letter-spacing: 0.01em;
}
.wd-shelf-sub { margin: 0.35rem 0 0; color: rgba(255, 247, 234, .78); font-size: 1rem; }

.wd-shelf-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(420px, 1fr));
  gap: 1.5rem;
  max-width: 1100px;
}
.wd-empty { color: rgba(255, 247, 234, .8); font-size: 1.05rem; }

/* ── mobile: Wikido works on phones ────────────────────────────────────────
   The explorer letterboxes the whole picture (see WikidoScene) so every spot
   is visible and tappable; the shelf stacks to a single column. */
@media (max-width: 939px) {
  .wd-shelf { padding: 1.25rem 1rem 2rem; }
  .wd-shelf-head { gap: 1rem; margin-bottom: 1.25rem; }
  .wd-shelf-title { font-size: 1.7rem; }
  .wd-shelf-sub { font-size: 0.92rem; }
  .wd-shelf-grid { grid-template-columns: 1fr; gap: 1rem; }
}
</style>
