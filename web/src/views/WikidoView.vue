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
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { listWikidoTopics, getWikidoTopic, loadWikidoTopic, fetchCloudTopics } from "@/services/wikido";
import { sortStudioTopics } from "@/services/wikidoAdmin";
import { ancestorChain } from "@/lib/wikido/tree";
import { useWikidoProgress } from "@/lib/wikido/progress";
import { useSpeech } from "@/composables/useSpeech";
import { useAuthStore } from "@/stores/auth";
import WikidoScene from "@/components/wikido/WikidoScene.vue";
import WikidoGlobe from "@/components/wikido/WikidoGlobe.vue";
import WikidoTopicCard from "@/components/wikido/WikidoTopicCard.vue";
import { isGlobeHub } from "../../../functions/lib/wikidoGlobe.js";
import WikidoGate from "@/components/wikido/WikidoGate.vue";
import WikidoMusic from "@/components/wikido/WikidoMusic.vue";

const router = useRouter();
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

async function openTopic(summary) {
  if (opening.value) return;
  opening.value = true;
  try {
    const pack = await resolvePack(summary.id);
    if (!pack) return; // validation errors already shouted in the console
    journey.value = [{ topicId: pack.id, scenes: [pack.rootSceneId] }];
  } finally {
    opening.value = false;
  }
}

function enter(spot) {
  if (!spot?.childSceneId || !topic.value) return;
  // a cross-topic doorway leaves this world entirely
  if (spot.childTopicId && spot.childTopicId !== topic.value.id) {
    enterWorld(spot.childTopicId, spot.childSceneId);
    return;
  }
  if (topic.value.scenes[spot.childSceneId]) {
    journey.value = [
      ...journey.value.slice(0, -1),
      { ...segment.value, scenes: [...segment.value.scenes, spot.childSceneId] },
    ];
  }
}

// Step through a cross-topic doorway: load the other world (bundled packs
// resolve on the spot; studio topics come from Firestore) and land on the
// target scene with its own ancestors as the trail back to that world's root.
async function enterWorld(worldId, sceneId) {
  if (opening.value) return;
  opening.value = true;
  try {
    const pack = await resolvePack(worldId);
    if (!pack?.scenes[sceneId]) {
      // the world vanished or failed to load — stay put; dropping it from the
      // directory turns the doorway into an explained dormant door
      const next = new Set(doorFailures.value);
      next.add(worldId);
      doorFailures.value = next;
      return;
    }
    journey.value = [...journey.value, { topicId: worldId, scenes: [...ancestorChain(pack.scenes, sceneId), sceneId] }];
  } finally {
    opening.value = false;
  }
}

function navigate(target) {
  let cut = null;
  journey.value.forEach((seg, si) => {
    seg.scenes.forEach((sceneId, ii) => {
      if (seg.topicId === target.topicId && sceneId === target.sceneId) cut = { si, ii };
    });
  });
  if (!cut) return;
  journey.value = journey.value
    .slice(0, cut.si + 1)
    .map((seg, i) => (i === cut.si ? { ...seg, scenes: seg.scenes.slice(0, cut.ii + 1) } : seg));
}

function exit() {
  stop();
  journey.value = [];
}

onBeforeUnmount(() => stop());
</script>

<template>
  <div class="wikido">
    <!-- ── session resolving: hold the backdrop so a signed-in visitor never
             sees the sign-in gate flash before Firebase reports the session ── -->
    <div v-if="!auth.initialized" class="wd-wait" role="status" aria-label="Opening Wikido">
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
      @enter="enter"
      @navigate="navigate"
      @exit="exit"
    >
      <template #tools><WikidoMusic /></template>
    </WikidoGlobe>
    <WikidoScene
      v-else-if="scene"
      :topic="topic"
      :scene="scene"
      :trail="trail"
      :topic-directory="topicDirectory"
      @enter="enter"
      @navigate="navigate"
      @exit="exit"
    >
      <template #tools><WikidoMusic /></template>
    </WikidoScene>
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
