<script setup>
// Wikido — an immersive, picture-first encyclopedia for children. Topics come
// from two places: developer-authored packs bundled with the app, and topics
// generated + published by the superadmin through the Wikido Studio (Firestore).
// The child's whole experience is looking, tapping, listening, and stepping deeper.
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { listWikidoTopics, getWikidoTopic, loadWikidoTopic, fetchCloudTopics } from "@/services/wikido";
import { sortStudioTopics } from "@/services/wikidoAdmin";
import { useWikidoProgress } from "@/lib/wikido/progress";
import { useSpeech } from "@/composables/useSpeech";
import { useAuthStore } from "@/stores/auth";
import WikidoScene from "@/components/wikido/WikidoScene.vue";
import WikidoTopicCard from "@/components/wikido/WikidoTopicCard.vue";

const router = useRouter();
const auth = useAuthStore();
const { countSeen } = useWikidoProgress();
const { stop } = useSpeech();

const bundled = listWikidoTopics();
const cloud = ref([]);        // studio topics (published; drafts for superadmins)
const cloudLoading = ref(true);
const opening = ref(false);   // fetching a studio topic's full pack

const shelf = computed(() => {
  const bundledIds = new Set(bundled.map((t) => t.id));
  return [...bundled, ...cloud.value.filter((t) => !bundledIds.has(t.id))];
});

const topic = ref(null); // full validated pack once entered
const stack = ref([]);   // scene id path, root first — last entry is on screen

onMounted(async () => {
  // superadmins additionally preview studio drafts on the shelf; drafts are
  // also filtered here in case a query ever returns one by accident.
  // Studio topics follow the bundled flagship pack, in the curator's order.
  const fetched = await fetchCloudTopics({ includeDrafts: auth.isSuperAdmin });
  cloud.value = sortStudioTopics(fetched.filter((t) => auth.isSuperAdmin || !t.draft));
  cloudLoading.value = false;
});

const scene = computed(() => (topic.value ? topic.value.scenes[stack.value[stack.value.length - 1]] : null));
const trail = computed(() =>
  stack.value.slice(0, -1).map((id) => ({ sceneId: id, title: topic.value.scenes[id].title }))
);

function totalFor(summary) {
  if (summary.source === "cloud") return summary.discoveryCount || 0;
  const pack = getWikidoTopic(summary.id);
  return pack ? Object.values(pack.scenes).reduce((n, sc) => n + sc.hotspots.length, 0) : 0;
}

async function openTopic(summary) {
  if (opening.value) return;
  opening.value = true;
  try {
    const pack = summary.source === "cloud" ? await loadWikidoTopic(summary.id) : getWikidoTopic(summary.id);
    if (!pack) return; // validation errors already shouted in the console
    topic.value = pack;
    stack.value = [pack.rootSceneId];
  } finally {
    opening.value = false;
  }
}

function enter(spot) {
  if (spot?.childSceneId && topic.value.scenes[spot.childSceneId]) {
    stack.value.push(spot.childSceneId);
  }
}

function navigate(sceneId) {
  const idx = stack.value.indexOf(sceneId);
  if (idx >= 0) stack.value = stack.value.slice(0, idx + 1);
}

function exit() {
  stop();
  topic.value = null;
  stack.value = [];
}

onBeforeUnmount(() => stop());
</script>

<template>
  <div class="wikido">
    <!-- ── shelf: pick a topic ─────────────────────────────────────────── -->
    <section v-if="!topic" class="wd-shelf">
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

    <!-- ── explorer: one immersive scene ───────────────────────────────── -->
    <WikidoScene
      v-else
      :topic="topic"
      :scene="scene"
      :trail="trail"
      @enter="enter"
      @navigate="navigate"
      @exit="exit"
    />

    <!-- Wikido is desktop-only by design: on small screens explain why. -->
    <div class="wd-desktop-note" role="note">
      <span class="material-symbols-rounded wd-desktop-ico" aria-hidden="true">desktop_windows</span>
      <h2>Wikido loves big screens!</h2>
      <p>This picture world is built for a desktop computer. Please open Wikido on a computer to start exploring.</p>
    </div>
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

/* ── desktop-only notice ─────────────────────────────────────────────── */
.wd-desktop-note { display: none; }
@media (max-width: 939px) {
  .wd-shelf, .wd-scene { display: none; }
  .wd-desktop-note {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    height: 100%;
    text-align: center;
    padding: 2rem;
    color: #FFF7EA;
  }
  .wd-desktop-ico { font-size: 56px; color: #FDE68A; }
  .wd-desktop-note h2 { margin: 0; font-size: 1.5rem; }
  .wd-desktop-note p { margin: 0; max-width: 34ch; color: rgba(255, 247, 234, .8); line-height: 1.5; }
}
</style>
