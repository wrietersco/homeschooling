<script setup>
import { ref, computed, onMounted, watch } from "vue";
import { useRoute } from "vue-router";
import { doc, getDoc, collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthStore } from "@/stores/auth";
import { createPlayerToken, submitScore, addObservation, updateBlockStatus } from "@/services/player";
import { generateActivityContent, deleteActivityContent } from "@/services/activityContent";
import { getActivityJourney } from "@/services/brief";
import ActivityContent from "@/components/ActivityContent.vue";
import SpeakButton from "@/components/SpeakButton.vue";

const route = useRoute();
const auth = useAuthStore();

const activityId = route.params.activityId;
const blockId = route.query.blockId || null;
const dateKey = route.query.dateKey || null;

const activity = ref(null);
const children = ref([]);
const loading = ref(true);
const notFound = ref(false);

// Parent instructions are shown in the guardian's native language first — their
// mother tongue in native script (e.g. Urdu Nastaliq), falling back to the roman
// transliteration when no native script was generated. The English version is
// kept as a collapsible secondary. When no mother-tongue version exists at all,
// English is shown plainly as the headline.
const nativeInstructions = computed(() =>
  activity.value?.parentInstructionsNative || activity.value?.parentInstructionsTranslit || ""
);
const hasNativeInstructions = computed(() => Boolean(nativeInstructions.value));
// Render in Nastaliq + RTL only when showing actual native script (not roman).
const nativeIsScript = computed(() => Boolean(activity.value?.parentInstructionsNative));

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
const deletingContent = ref(false);
const contentError = ref("");
// Optional parent direction for a regeneration — why, and what to change/fix.
// Threaded into the generator's prompt. Capped to match the server (6000 chars).
const GUIDANCE_MAX = 6000;
const regenGuidance = ref("");

// Parent "where this fits in the plan" journey — lazy-loaded on expand.
const journeyOpen = ref(false);
const journeyLoading = ref(false);
const journeyText = ref("");
const journeyError = ref("");
async function toggleJourney() {
  journeyOpen.value = !journeyOpen.value;
  if (journeyOpen.value && !journeyText.value && !journeyLoading.value) {
    journeyLoading.value = true;
    journeyError.value = "";
    try {
      const res = await getActivityJourney(activityId);
      if (res?.configured === false) journeyError.value = "The plan brief isn't available yet.";
      else journeyText.value = res?.text || "No journey information yet.";
    } catch (e) {
      journeyError.value = e?.message || "Could not load the plan context.";
    } finally {
      journeyLoading.value = false;
    }
  }
}

const CONTENT_KIND_LABEL = {
  quran: "Quran verses",
  noorani_qaida: "Qaida exercises",
  arabic_reading: "Arabic reading",
  urdu_reading: "Urdu reading",
  english_reading: "Reading",
  story_reading: "Story passage",
  conversation: "Conversation",
  mathematics: "Problem sums",
  computer: "Worksheet",
  ai_robotics: "Worksheet",
  physical: "Worksheet",
  teaching: "Parent tips",
};
const contentLabel = computed(() =>
  CONTENT_KIND_LABEL[activity.value?.type] || "Activity content"
);

async function handleGenerateContent() {
  if (!activity.value) return;
  generatingContent.value = true;
  contentError.value = "";
  try {
    const res = await generateActivityContent(activity.value.id, regenGuidance.value.trim());
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

// Delete the generated content for this activity, returning it to the empty
// state. We do NOT auto-regenerate afterwards — the parent chose to remove it
// and can rebuild it with the Generate button when ready.
async function handleDeleteContent() {
  if (!activity.value?.content || deletingContent.value) return;
  if (!window.confirm("Delete the generated content for this activity? You can regenerate it afterwards.")) return;
  deletingContent.value = true;
  contentError.value = "";
  try {
    await deleteActivityContent(activity.value.id);
    activity.value.content = null;
  } catch (e) {
    contentError.value = e?.message || "Failed to delete content.";
  } finally {
    deletingContent.value = false;
  }
}

// Child link
const generatingLink = ref(false);
const playerLink = ref("");
const linkError = ref("");
const linkCopied = ref(false);

// Shareable activity URL — the per-activity page itself. Any guardian in the
// same family can open it and view/edit per their permissions, so this is the
// link a parent hands to a partner guardian (or the guide quotes on a call).
const shareLink = computed(() =>
  activity.value ? `${window.location.origin}/activity/${activity.value.id}` : ""
);
const shareCopied = ref(false);
const uidCopied = ref(false);

async function copyToClipboard(text, flag) {
  try {
    await navigator.clipboard.writeText(text);
    flag.value = true;
    setTimeout(() => (flag.value = false), 2000);
  } catch { /* clipboard blocked */ }
}
const copyShareLink = () => copyToClipboard(shareLink.value, shareCopied);
const copyUid = () => copyToClipboard(activity.value?.id || "", uidCopied);

const TYPE_ICONS = {
  quran: "📖", noorani_qaida: "🔤",
  arabic_reading: "📗", urdu_reading: "📙", english_reading: "📘", story_reading: "📚", conversation: "💬",
  mathematics: "🔢", computer: "💻", ai_robotics: "🤖", physical: "🏃", teaching: "📝",
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

// Per-child differentiated content (content.byChild). When present, the parent can
// flip between each child's level-paced version here, mirroring the player.
const previewChildId = ref("");
const byChildMap = computed(() => activity.value?.contentByChild || null);
const differentiatedChildren = computed(() => {
  const m = byChildMap.value;
  if (!m) return [];
  return targetChildren.value.filter((c) => m[c.id]);
});
watch(differentiatedChildren, (kids) => {
  if (kids.length && !kids.some((c) => c.id === previewChildId.value)) previewChildId.value = kids[0].id;
}, { immediate: true });
const previewContent = computed(() => {
  const m = byChildMap.value;
  if (m && previewChildId.value && m[previewChildId.value]) return m[previewChildId.value];
  return activity.value?.content || null;
});
const previewChildName = computed(() =>
  children.value.find((c) => c.id === previewChildId.value)?.name || previewChildId.value
);
const previewLevel = computed(() => activity.value?.differentiatedLevels?.[previewChildId.value] || "");

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
            <button
              class="uid-chip"
              :title="uidCopied ? 'Copied!' : 'Activity ID — click to copy'"
              @click="copyUid"
            >
              <span class="uid-label">ID</span>
              <span class="uid-value">{{ activity.id }}</span>
              <span class="uid-copy">{{ uidCopied ? "✓" : "⧉" }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Instructions — shown in the guardian's native language first -->
      <section class="card">
        <h2 class="card-h">Parent Instructions</h2>

        <template v-if="hasNativeInstructions">
          <div class="pi-head">
            <SpeakButton
              :text="activity.parentInstructionsNative || activity.parentInstructionsTranslit"
              size="sm"
              label="Listen"
            />
          </div>
          <p
            class="instructions pi-native"
            :class="{ 'font-urdu': nativeIsScript, rtl: nativeIsScript }"
          >{{ nativeInstructions }}</p>
          <details v-if="activity.parentInstructions" class="pi-english">
            <summary>In English</summary>
            <p class="instructions">{{ activity.parentInstructions }}</p>
          </details>
        </template>

        <p v-else class="instructions">{{ activity.parentInstructions || "No instructions provided." }}</p>
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
               on first open; manual controls let a parent regenerate or delete it. -->
          <div class="content-actions">
            <button
              v-if="activity.content"
              class="btn ghost danger del-btn"
              :disabled="generatingContent || deletingContent"
              @click="handleDeleteContent"
            >
              {{ deletingContent ? "Deleting…" : "Delete" }}
            </button>
            <button
              class="btn secondary regen-btn"
              :disabled="generatingContent || deletingContent"
              @click="handleGenerateContent"
            >
              {{ generatingContent ? "Working…" : (activity.content ? "Regenerate" : "Generate") }}
            </button>
          </div>
        </div>
        <!-- Optional direction for the generator: what's wrong with the current
             content, or the angle/perspective to take this (re)generation. Fed
             into the generator's prompt. -->
        <div class="regen-guidance">
          <label for="regen-guidance" class="rg-label">
            Direction for the generator <span class="rg-optional">(optional)</span>
          </label>
          <textarea
            id="regen-guidance"
            v-model="regenGuidance"
            class="rg-input"
            :maxlength="GUIDANCE_MAX"
            rows="3"
            :disabled="generatingContent || deletingContent"
            placeholder="What should change this time? e.g. the previous version was too hard — use simpler words; focus more on…; avoid…; add more worked examples."
          ></textarea>
          <span class="rg-count">{{ regenGuidance.length }} / {{ GUIDANCE_MAX }}</span>
        </div>
        <p v-if="contentError" class="field-error" role="alert">{{ contentError }}</p>

        <div v-if="activity.content || differentiatedChildren.length" class="content-preview">
          <!-- Per-child differentiated versions: flip between each child's
               level-paced content. Falls back to the shared blob below. -->
          <div v-if="differentiatedChildren.length" class="bychild">
            <div class="bychild-bar">
              <span class="bychild-label">Per-child version:</span>
              <button
                v-for="c in differentiatedChildren"
                :key="c.id"
                type="button"
                class="bychild-tab"
                :class="{ active: c.id === previewChildId }"
                @click="previewChildId = c.id"
              >{{ c.name || c.id }}</button>
            </div>
            <p v-if="previewLevel" class="bychild-level">
              <strong>{{ previewChildName }}’s level:</strong> {{ previewLevel }}
            </p>
          </div>
          <ActivityContent :key="previewChildId || 'all'" :content="previewContent" />
        </div>
        <p v-else-if="generatingContent" class="card-desc generating">
          <span class="mini-spinner" aria-hidden="true"></span>
          Building the {{ contentLabel.toLowerCase() }} automatically…
        </p>
        <p v-else class="card-desc">
          No {{ contentLabel.toLowerCase() }} yet — use Generate to create it.
        </p>
      </section>

      <!-- Where this fits in the plan (parent journey) -->
      <section class="card">
        <button class="journey-toggle" @click="toggleJourney" :aria-expanded="journeyOpen">
          <span>🧭 Where this fits in the plan</span>
          <span class="chev">{{ journeyOpen ? "▲" : "▼" }}</span>
        </button>
        <div v-if="journeyOpen" class="journey-body">
          <p v-if="journeyLoading" class="card-desc generating">
            <span class="mini-spinner" aria-hidden="true"></span> Reading the plan…
          </p>
          <p v-else-if="journeyError" class="field-error">{{ journeyError }}</p>
          <p v-else class="journey-text">{{ journeyText }}</p>
        </div>
      </section>

      <!-- Share with a guardian — the per-activity page URL. A partner guardian
           in the same family can open it to view (or edit, if their rights
           permit) using the options on this page. Handy on a call with the guide. -->
      <section class="card">
        <h2 class="card-h">Share Activity</h2>
        <p class="card-desc">
          Send this link to a partner guardian. They can open this activity to view
          it — and edit it if their permissions allow — using the options on this page.
        </p>
        <div class="link-box">
          <input class="link-input" :value="shareLink" readonly @focus="$event.target.select()" />
          <button class="btn secondary copy-btn" @click="copyShareLink">
            {{ shareCopied ? "Copied!" : "Copy link" }}
          </button>
        </div>
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
/* Activity unique identifier — small, monospace, click-to-copy. Not meant to be
   pretty, just always visible and copyable for support / sharing. */
.uid-chip {
  display: inline-flex; align-items: center; gap: 0.35rem;
  font-size: 0.7rem; padding: 0.15rem 0.5rem; border-radius: 999px;
  background: #f8fafc; color: #64748b; border: 1px solid #e2e8f0;
  cursor: pointer; font-family: inherit;
}
.uid-chip:hover { background: #f1f5f9; color: #334155; }
.uid-label { font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
.uid-value { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.uid-copy { color: #94a3b8; }
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
.content-actions { display: flex; align-items: center; gap: 0.4rem; flex-shrink: 0; }
.regen-guidance { display: flex; flex-direction: column; gap: 0.3rem; margin: 0.6rem 0 0.2rem; }
.rg-label { font-size: 0.82rem; font-weight: 600; color: #334155; }
.rg-optional { font-weight: 400; color: #94a3b8; }
.rg-input {
  width: 100%; box-sizing: border-box; resize: vertical; min-height: 3.2rem;
  font: inherit; font-size: 0.86rem; line-height: 1.4; color: #0f172a;
  padding: 0.5rem 0.6rem; border: 1px solid #cbd5e1; border-radius: 0.5rem;
}
.rg-input:focus { outline: none; border-color: #2563eb; box-shadow: 0 0 0 2px rgba(37,99,235,0.15); }
.rg-input:disabled { background: #f1f5f9; color: #94a3b8; }
.rg-count { align-self: flex-end; font-size: 0.72rem; color: #94a3b8; font-variant-numeric: tabular-nums; }
.regen-btn { font-size: 0.8rem; padding: 0.3rem 0.8rem; flex-shrink: 0; }
.del-btn { font-size: 0.8rem; padding: 0.3rem 0.8rem; flex-shrink: 0; }
.btn.ghost { background: transparent; color: #475569; border: 1px solid #cbd5e1; }
.btn.ghost.danger { color: #b91c1c; border-color: #fca5a5; }
.btn.ghost.danger:hover:not(:disabled) { background: #fef2f2; border-color: #f87171; }
.content-preview { margin-top: 0.75rem; }
.bychild { margin-bottom: 0.85rem; }
.bychild-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 0.4rem; }
.bychild-label { font-size: 0.82rem; font-weight: 600; color: #64748b; margin-right: 0.2rem; }
.bychild-tab { font: inherit; font-size: 0.85rem; font-weight: 600; padding: 0.3rem 0.8rem; border-radius: 999px; border: 1px solid #d8b4fe; background: #fff; color: #7c3aed; cursor: pointer; }
.bychild-tab.active { background: #7c3aed; color: #fff; border-color: #7c3aed; }
.bychild-level { margin: 0.5rem 0 0; padding: 0.5rem 0.7rem; background: #faf5ff; border: 1px solid #ede9fe; border-radius: 8px; font-size: 0.85rem; color: #475569; }
.generating { display: flex; align-items: center; gap: 0.5rem; color: #475569; }
.mini-spinner { width: 14px; height: 14px; border-radius: 50%; border: 2px solid #cbd5e1; border-top-color: #0b1f3a; animation: spin 0.7s linear infinite; display: inline-block; }
@keyframes spin { to { transform: rotate(360deg); } }

.journey-toggle { display: flex; align-items: center; justify-content: space-between; width: 100%; background: none; border: none; cursor: pointer; font: inherit; font-size: 0.95rem; font-weight: 600; color: #334155; padding: 0; }
.journey-toggle .chev { color: #94a3b8; font-size: 0.8rem; }
.journey-body { margin-top: 0.75rem; }
.journey-text { white-space: pre-wrap; color: #1e293b; line-height: 1.7; margin: 0; }

.instructions, .walkthrough { white-space: pre-wrap; color: #1e293b; line-height: 1.7; margin: 0; }
.walkthrough { color: #475569; font-style: italic; }

/* Mother-tongue (transliterated + spoken) parent instructions */
/* Native-language parent instructions (primary). Nastaliq needs extra size and
   vertical room to read beautifully; RTL for native scripts. */
.pi-head { display: flex; justify-content: flex-end; margin-bottom: 0.35rem; }
.pi-native { color: #1e293b; }
.pi-native.font-urdu { font-size: 1.3rem; line-height: 2.6; }
.pi-native.rtl { direction: rtl; text-align: right; }
/* English fallback, demoted to a collapsible secondary block. */
.pi-english { margin-top: 0.85rem; padding-top: 0.75rem; border-top: 1px dashed #e2e8f0; }
.pi-english summary { font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; cursor: pointer; }
.pi-english .instructions { margin-top: 0.5rem; }

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
