<script setup>
import { ref, computed, onMounted } from "vue";
import { useRoute } from "vue-router";
import { doc, getDoc, collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthStore } from "@/stores/auth";
import { createPlayerToken, submitScore, addObservation, updateBlockStatus } from "@/services/player";
import { generateActivityContent } from "@/services/activityContent";
import ActivityContent from "@/components/ActivityContent.vue";

const route = useRoute();
const auth = useAuthStore();

const activityId = route.params.activityId;
const blockId = route.query.blockId || null;
const dateKey = route.query.dateKey || null;

const activity = ref(null);
const children = ref([]);
const loading = ref(true);
const notFound = ref(false);

// Scoring
const scores = ref({});     // { childId: { completed: bool, isDriving: bool } }
const submittingScore = ref(false);
const scoreError = ref("");
const scoreDone = ref(false);

// Observation
const obsText = ref("");
const obsChildId = ref("");
const submittingObs = ref(false);
const obsError = ref("");
const obsSaved = ref(false);

// Learning content (flashcards / qaida / story)
const generatingContent = ref(false);
const contentError = ref("");

const CONTENT_KIND_LABEL = {
  quran: "Quran verses",
  noorani_qaida: "Qaida exercises",
  story_reading: "Story passage",
  mathematics: "Problem sums",
  computer: "Worksheet",
  ai_robotics: "Worksheet",
  physical: "Worksheet",
  teaching: "Worksheet",
};
const contentLabel = computed(() =>
  CONTENT_KIND_LABEL[activity.value?.type] || "Activity content"
);

async function handleGenerateContent() {
  if (!activity.value) return;
  generatingContent.value = true;
  contentError.value = "";
  try {
    const res = await generateActivityContent(activity.value.id);
    if (res?.configured === false) {
      contentError.value = res.text || "Content generation isn't configured yet.";
      return;
    }
    if (res?.content) activity.value.content = res.content;
  } catch (e) {
    contentError.value = e?.message || "Failed to generate content.";
  } finally {
    generatingContent.value = false;
  }
}

// Child link
const generatingLink = ref(false);
const playerLink = ref("");
const linkError = ref("");
const linkCopied = ref(false);

const TYPE_ICONS = {
  quran: "📖", noorani_qaida: "🔤", story_reading: "📚", mathematics: "🔢",
  computer: "💻", ai_robotics: "🤖", physical: "🏃", teaching: "📝",
};
const RANK_LABELS = { 1: "Intro", 2: "Basic", 3: "Mid", 4: "Advanced", 5: "Mastery" };

onMounted(async () => {
  if (!auth.familyId) { notFound.value = true; loading.value = false; return; }
  try {
    const snap = await getDoc(doc(db, "families", auth.familyId, "activities", activityId));
    if (!snap.exists()) { notFound.value = true; loading.value = false; return; }
    activity.value = { id: snap.id, ...snap.data() };

    const childSnap = await getDocs(collection(db, "families", auth.familyId, "children"));
    children.value = childSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const targets = activity.value.targetChildren?.length
      ? activity.value.targetChildren
      : children.value.map((c) => c.id);
    for (const cid of targets) {
      scores.value[cid] = { completed: false, isDriving: false };
    }
    if (targets.length) obsChildId.value = targets[0];
  } catch {
    notFound.value = true;
  } finally {
    loading.value = false;
  }

  // Auto-generate content on open if this activity predates auto-content, so the
  // parent never has to click Generate per activity.
  if (activity.value && !activity.value.content && !generatingContent.value) {
    handleGenerateContent();
  }
});

const targetChildren = computed(() => {
  if (!activity.value || !children.value.length) return [];
  const ids = activity.value.targetChildren?.length
    ? activity.value.targetChildren
    : children.value.map((c) => c.id);
  return children.value.filter((c) => ids.includes(c.id));
});

const hasCoopDriver = computed(() =>
  Object.values(scores.value).some((s) => s.isDriving)
);

function toggleDriver(childId) {
  for (const cid of Object.keys(scores.value)) {
    scores.value[cid].isDriving = cid === childId && !scores.value[childId].isDriving;
  }
}

async function generateLink() {
  if (!activity.value) return;
  generatingLink.value = true;
  linkError.value = "";
  playerLink.value = "";
  try {
    const token = await createPlayerToken(
      auth.familyId,
      activity.value,
      activity.value.targetChildren || [],
      blockId,
      dateKey,
      auth.user?.uid
    );
    playerLink.value = `${window.location.origin}/play/${token}`;
  } catch (e) {
    linkError.value = e?.message || "Failed to generate link.";
  } finally {
    generatingLink.value = false;
  }
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(playerLink.value);
    linkCopied.value = true;
    setTimeout(() => (linkCopied.value = false), 2000);
  } catch { /* clipboard blocked */ }
}

async function handleSubmitScores() {
  if (!activity.value) return;
  submittingScore.value = true;
  scoreError.value = "";
  try {
    const drivingChildId = Object.entries(scores.value).find(([, v]) => v.isDriving)?.[0] || null;
    for (const [childId, s] of Object.entries(scores.value)) {
      const child = children.value.find((c) => c.id === childId);
      await submitScore(auth.familyId, {
        activityId: activity.value.id,
        activityTitle: activity.value.title,
        blockId: blockId || null,
        dateKey: dateKey || null,
        childId,
        childName: child?.name || childId,
        coopMode: Boolean(activity.value.coopMode),
        drivingChildId: activity.value.coopMode ? drivingChildId : null,
        sharedSuccess: activity.value.coopMode ? Boolean(drivingChildId) : null,
        completed: s.completed,
        notes: "",
        scoredBy: auth.user?.uid || "",
      });
    }
    if (blockId && dateKey) await updateBlockStatus(auth.familyId, dateKey, blockId, "done");
    scoreDone.value = true;
  } catch (e) {
    scoreError.value = e?.message || "Failed to submit.";
  } finally {
    submittingScore.value = false;
  }
}

async function handleSubmitObservation() {
  if (!activity.value || !obsText.value.trim()) return;
  submittingObs.value = true;
  obsError.value = "";
  try {
    const child = children.value.find((c) => c.id === obsChildId.value);
    await addObservation(auth.familyId, {
      activityId: activity.value.id,
      activityTitle: activity.value.title,
      childId: obsChildId.value,
      childName: child?.name || obsChildId.value,
      text: obsText.value.trim(),
      authorUid: auth.user?.uid || "",
    });
    obsText.value = "";
    obsSaved.value = true;
    setTimeout(() => (obsSaved.value = false), 3000);
  } catch (e) {
    obsError.value = e?.message || "Failed to save.";
  } finally {
    submittingObs.value = false;
  }
}
</script>

<template>
  <div class="activity-view">
    <router-link to="/planner" class="back-link">← Back to Planner</router-link>

    <div v-if="loading" class="loading">Loading activity…</div>

    <div v-else-if="notFound" class="not-found">
      <p>Activity not found.</p>
      <router-link to="/syllabus" class="btn secondary">Go to Syllabus</router-link>
    </div>

    <template v-else-if="activity">
      <!-- Header -->
      <div class="activity-header">
        <div class="activity-icon">{{ TYPE_ICONS[activity.type] || "📝" }}</div>
        <div>
          <h1 class="activity-title">{{ activity.title }}</h1>
          <div class="activity-meta">
            <span :class="`rank-badge rank-${activity.complexityRank}`">
              {{ RANK_LABELS[activity.complexityRank] }}
            </span>
            <span class="meta-chip">{{ activity.subject }}</span>
            <span class="meta-chip">{{ activity.durationMinutes }} min</span>
            <span v-if="activity.coopMode" class="meta-chip co-op">Co-op</span>
          </div>
        </div>
      </div>

      <!-- Instructions -->
      <section class="card">
        <h2 class="card-h">Parent Instructions</h2>
        <p class="instructions">{{ activity.parentInstructions || "No instructions provided." }}</p>
      </section>

      <!-- Walkthrough -->
      <section v-if="activity.exampleWalkthrough" class="card">
        <h2 class="card-h">Example Walkthrough</h2>
        <p class="walkthrough">{{ activity.exampleWalkthrough }}</p>
      </section>

      <!-- Activity content — generated automatically when the activity is created -->
      <section class="card">
        <div class="content-head">
          <h2 class="card-h">Activity Content — {{ contentLabel }}</h2>
          <!-- Content is generated automatically when the activity is created and
               on first open; the only manual control is a subtle Regenerate. -->
          <button
            v-if="activity.content"
            class="btn secondary regen-btn"
            :disabled="generatingContent"
            @click="handleGenerateContent"
          >
            {{ generatingContent ? "Working…" : "Regenerate" }}
          </button>
        </div>
        <p v-if="contentError" class="field-error" role="alert">{{ contentError }}</p>

        <div v-if="activity.content" class="content-preview">
          <ActivityContent :content="activity.content" />
        </div>
        <p v-else-if="generatingContent" class="card-desc generating">
          <span class="mini-spinner" aria-hidden="true"></span>
          Building the {{ contentLabel.toLowerCase() }} automatically…
        </p>
        <p v-else class="card-desc">
          Preparing the {{ contentLabel.toLowerCase() }} automatically…
        </p>
      </section>

      <!-- Child link -->
      <section class="card">
        <h2 class="card-h">Child Link</h2>
        <p class="card-desc">
          Generate a link to open this activity on the child's device. The link expires in 8 hours.
        </p>
        <button class="btn primary" :disabled="generatingLink" @click="generateLink">
          {{ generatingLink ? "Generating…" : "Generate child link" }}
        </button>
        <p v-if="linkError" class="field-error" role="alert">{{ linkError }}</p>
        <div v-if="playerLink" class="link-box">
          <input class="link-input" :value="playerLink" readonly />
          <button class="btn secondary copy-btn" @click="copyLink">
            {{ linkCopied ? "Copied!" : "Copy" }}
          </button>
        </div>
      </section>

      <!-- Scoring -->
      <section class="card">
        <h2 class="card-h">Record Scores</h2>
        <p v-if="scoreDone" class="success-msg">✓ Scores saved{{ blockId ? " — block marked done" : "" }}.</p>
        <template v-else>
          <div v-if="!targetChildren.length" class="card-desc">No children assigned to this activity.</div>
          <template v-else>
            <div v-if="activity.coopMode" class="card-desc coop-note">
              Co-op activity — optionally mark one child as the driving member.
            </div>
            <div class="score-rows">
              <div v-for="child in targetChildren" :key="child.id" class="score-row">
                <label class="score-check">
                  <input type="checkbox" v-model="scores[child.id].completed" />
                  <span class="child-name">{{ child.name || child.id }}</span>
                </label>
                <button
                  v-if="activity.coopMode"
                  class="driver-btn"
                  :class="{ active: scores[child.id]?.isDriving }"
                  @click="toggleDriver(child.id)"
                >
                  {{ scores[child.id]?.isDriving ? "★ Driver" : "Driver?" }}
                </button>
              </div>
            </div>
            <p v-if="scoreError" class="field-error" role="alert">{{ scoreError }}</p>
            <button
              class="btn primary"
              :disabled="submittingScore"
              @click="handleSubmitScores"
            >
              {{ submittingScore ? "Saving…" : "Submit scores" }}
            </button>
          </template>
        </template>
      </section>

      <!-- Observation -->
      <section class="card">
        <h2 class="card-h">Add Observation</h2>
        <div v-if="targetChildren.length" class="obs-child-row">
          <label class="obs-label">
            Child
            <select v-model="obsChildId" class="obs-select">
              <option v-for="c in targetChildren" :key="c.id" :value="c.id">
                {{ c.name || c.id }}
              </option>
            </select>
          </label>
        </div>
        <textarea
          v-model="obsText"
          class="obs-textarea"
          placeholder="Write your observation here…"
          rows="4"
        ></textarea>
        <p v-if="obsError" class="field-error" role="alert">{{ obsError }}</p>
        <p v-if="obsSaved" class="success-msg">✓ Observation saved.</p>
        <button
          class="btn primary"
          :disabled="submittingObs || !obsText.trim()"
          @click="handleSubmitObservation"
        >
          {{ submittingObs ? "Saving…" : "Save observation" }}
        </button>
      </section>
    </template>
  </div>
</template>

<style scoped>
.activity-view { max-width: 680px; padding-bottom: 3rem; }
.back-link { display: inline-block; color: #64748b; font-size: 0.85rem; margin-bottom: 1.25rem; text-decoration: none; }
.back-link:hover { color: #0b1f3a; }

.loading { color: #94a3b8; padding: 2rem 0; }
.not-found { padding: 2rem 0; color: #64748b; display: flex; flex-direction: column; gap: 1rem; }

/* Header */
.activity-header { display: flex; gap: 1rem; align-items: flex-start; margin-bottom: 1.5rem; }
.activity-icon { font-size: 2.5rem; line-height: 1; }
.activity-title { margin: 0 0 0.4rem; font-size: 1.3rem; color: #0f172a; }
.activity-meta { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.meta-chip { font-size: 0.75rem; padding: 0.15rem 0.5rem; border-radius: 999px; background: #f1f5f9; color: #475569; }
.meta-chip.co-op { background: #e0f2fe; color: #0369a1; }
.rank-badge { font-size: 0.72rem; font-weight: 700; padding: 0.15rem 0.5rem; border-radius: 999px; }
.rank-1 { background: #dcfce7; color: #166534; }
.rank-2 { background: #dbeafe; color: #1e40af; }
.rank-3 { background: #fef9c3; color: #854d0e; }
.rank-4 { background: #fed7aa; color: #9a3412; }
.rank-5 { background: #f3e8ff; color: #6b21a8; }

/* Cards */
.card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 1.25rem; margin-bottom: 1rem; }
.card-h { margin: 0 0 0.75rem; font-size: 0.9rem; color: #334155; text-transform: uppercase; letter-spacing: 0.05em; }
.card-desc { font-size: 0.85rem; color: #64748b; margin: 0 0 0.75rem; }
.coop-note { background: #f0f9ff; padding: 0.4rem 0.6rem; border-radius: 6px; color: #0369a1; }

.content-head { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; margin-bottom: 0.5rem; }
.content-head .card-h { margin: 0; }
.regen-btn { font-size: 0.8rem; padding: 0.3rem 0.8rem; flex-shrink: 0; }
.content-preview { margin-top: 0.75rem; }
.generating { display: flex; align-items: center; gap: 0.5rem; color: #475569; }
.mini-spinner { width: 14px; height: 14px; border-radius: 50%; border: 2px solid #cbd5e1; border-top-color: #0b1f3a; animation: spin 0.7s linear infinite; display: inline-block; }
@keyframes spin { to { transform: rotate(360deg); } }

.instructions, .walkthrough { white-space: pre-wrap; color: #1e293b; line-height: 1.7; margin: 0; }
.walkthrough { color: #475569; font-style: italic; }

/* Child link */
.link-box { display: flex; gap: 0.5rem; margin-top: 0.75rem; }
.link-input { flex: 1; padding: 0.4rem 0.6rem; border: 1px solid #cbd5e1; border-radius: 6px; font: inherit; font-size: 0.82rem; color: #334155; background: #f8fafc; }
.copy-btn { white-space: nowrap; }

/* Scoring */
.score-rows { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 0.75rem; }
.score-row { display: flex; align-items: center; gap: 0.75rem; padding: 0.4rem 0; }
.score-check { display: flex; align-items: center; gap: 0.5rem; cursor: pointer; flex: 1; }
.child-name { font-weight: 500; color: #1e293b; }
.driver-btn {
  font-size: 0.75rem; padding: 0.2rem 0.6rem; border: 1px solid #cbd5e1;
  border-radius: 999px; background: #f8fafc; color: #64748b; cursor: pointer;
}
.driver-btn.active { background: #fef9c3; border-color: #d97706; color: #92400e; }

/* Observation */
.obs-child-row { margin-bottom: 0.5rem; }
.obs-label { display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; color: #475569; }
.obs-select { padding: 0.3rem 0.5rem; border: 1px solid #cbd5e1; border-radius: 6px; font: inherit; }
.obs-textarea {
  width: 100%; padding: 0.6rem; border: 1px solid #cbd5e1; border-radius: 8px;
  font: inherit; font-size: 0.9rem; resize: vertical; margin-bottom: 0.6rem;
  box-sizing: border-box;
}

/* Shared */
.btn { padding: 0.5rem 1.1rem; border-radius: 8px; border: none; cursor: pointer; font: inherit; font-size: 0.9rem; }
.btn.primary { background: #0b1f3a; color: #fff; }
.btn.secondary { background: #f1f5f9; color: #334155; border: 1px solid #cbd5e1; }
.btn:disabled { opacity: 0.6; cursor: not-allowed; }
.field-error { color: #b91c1c; font-size: 0.82rem; margin: 0.4rem 0; }
.success-msg { color: #15803d; font-size: 0.85rem; margin: 0 0 0.5rem; }
</style>
