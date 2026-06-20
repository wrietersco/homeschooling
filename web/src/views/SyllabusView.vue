<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { collection, doc, getDoc, getDocs, onSnapshot, query, orderBy, limit } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthStore } from "@/stores/auth";
import { useCurriculumStore } from "@/stores/curriculum";
import { useActivityStore } from "@/stores/activities";
import { useProfilesStore } from "@/stores/profiles";
import { resumeSyllabus, startSyllabus, stopSyllabus } from "@/services/syllabus";
import { deleteSyllabus } from "@/services/admin";
import { requestContentPlanning, requestContentSample, regenerateFailedContent, requestContentBackfill } from "@/services/activityContent";

const auth = useAuthStore();
const curriculumStore = useCurriculumStore();
const activityStore = useActivityStore();
const profilesStore = useProfilesStore();

// Owners/parents (and superadmin) may delete the generated syllabus.
const canDelete = computed(() => ["owner", "parent"].includes(auth.role) || auth.isSuperAdmin);
const deletingSyllabus = ref(false);
async function removeSyllabus() {
  const curr = activeCurriculum.value;
  if (!confirm(
    `Delete all generated activities for "${curr?.title || "this curriculum"}"?\n\n` +
    "This removes the syllabus and any calendar blocks that use these activities. This cannot be undone."
  )) return;
  deletingSyllabus.value = true;
  try {
    await deleteSyllabus(curr?.id || undefined);
    runData.value = null;
    runId.value = null;
  } catch (e) {
    alert(e?.message || "Could not delete the syllabus.");
  } finally {
    deletingSyllabus.value = false;
  }
}

const generating = ref(false);
const error = ref("");
const runId = ref(null);
const runData = ref(null); // live agentRuns doc

// Watch the active syllabus run doc for live progress.
let runUnsub = null;
watch(runId, (id) => {
  if (runUnsub) { runUnsub(); runUnsub = null; }
  if (!id || !auth.familyId) return;
  runUnsub = onSnapshot(
    doc(db, "families", auth.familyId, "agentRuns", id),
    (snap) => { runData.value = snap.exists() ? { id: snap.id, ...snap.data() } : null; }
  );
});
onUnmounted(() => { if (runUnsub) runUnsub(); });

const activeCurriculum = computed(() => curriculumStore.active);

// Convert subjects map to a sorted array for display.
const subjectProgress = computed(() => {
  if (!runData.value?.subjects) return [];
  return Object.entries(runData.value.subjects).map(([id, s]) => ({
    id,
    name: s.name || id,
    status: s.status || "pending",
    activityCount: s.activityCount || 0,
    targetActivityCount: s.targetActivityCount || 0,
    error: s.error,
  }));
});

const runDone = computed(() => runData.value?.status === "done");
const runRunning = computed(() => runData.value?.status === "running");
const runCancelled = computed(() => runData.value?.status === "cancelled");
const hasResumableRun = computed(() => Boolean(runId.value && !runDone.value && !runCancelled.value));
const runQueued = computed(() => runData.value?.status === "queued");

// Stop button — cancel the in-flight build. The live snapshot flips runData to
// "cancelled"; the worker halts after the current subject.
const stopping = ref(false);
async function stopGeneration() {
  if (!runId.value || stopping.value) return;
  stopping.value = true;
  try {
    await stopSyllabus(runId.value);
  } catch (e) {
    error.value = e?.message || "Could not stop generation.";
  } finally {
    stopping.value = false;
  }
}
const generateLabel = computed(() => {
  if (generating.value) return "Starting...";
  if (runRunning.value || runQueued.value) return "Generation running on server";
  if (hasResumableRun.value) return "Continue generation";
  return activityStore.activities.length ? "Regenerate Syllabus" : "Generate Syllabus";
});

const COMPLEXITY_LABELS = { 1: "Intro", 2: "Basic", 3: "Mid", 4: "Advanced", 5: "Mastery" };
const TYPE_ICONS = {
  quran: "📖", noorani_qaida: "🔤",
  arabic_reading: "📗", urdu_reading: "📙", english_reading: "📘", story_reading: "📚", conversation: "💬",
  mathematics: "🔢", computer: "💻", ai_robotics: "🤖", physical: "🏃", teaching: "📝",
};

// Scheduled date per activity (from the shared knowledge brief), so the
// progression flow can show WHEN each step happens once it's scheduled (#7).
const scheduledDates = ref({}); // activityId -> earliest YYYY-MM-DD
async function loadSchedule() {
  if (!auth.familyId) return;
  try {
    const snap = await getDoc(doc(db, "families", auth.familyId, "meta", "knowledge_brief"));
    const sched = snap.exists() ? (snap.data().data?.schedule || []) : [];
    const map = {};
    for (const day of sched) {
      for (const b of day.blocks || []) {
        if (b.activityId && (!map[b.activityId] || day.date < map[b.activityId])) map[b.activityId] = day.date;
      }
    }
    scheduledDates.value = map;
  } catch { /* non-critical — flow still shows basic→advanced order */ }
}

// Child name chips for an activity's targetChildren (#8 personalisation link).
// Only ids that match a real child count; stale/garbage ids (from before the
// binding repair) are ignored so we show the actual NAME or an honest "All
// children" — never the meaningless literal "Child".
const validChildIds = computed(() => new Set(profilesStore.children.map((c) => c.id)));
function childNamesFor(a) {
  const ids = (a.targetChildren || []).filter((id) => validChildIds.value.has(id));
  if (!ids.length) return profilesStore.children.length ? ["All children"] : [];
  return ids.map((id) => profilesStore.children.find((c) => c.id === id)?.name || "All children");
}
function shortDate(d) {
  if (!d) return "";
  const [, m, day] = d.split("-");
  const MON = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${MON[Number(m)] || m} ${Number(day)}`;
}

// Per-subject progression: activities ordered basic→advanced (the store already
// sorts by complexityRank), annotated with scheduled date when present (#7).
const progression = computed(() =>
  activityStore.bySubject.map((g) => ({
    subjectId: g.subjectId,
    subject: g.subject,
    steps: g.items.map((a) => ({
      id: a.id, title: a.title, type: a.type,
      rank: a.complexityRank || 1,
      date: scheduledDates.value[a.id] || "",
    })),
  }))
);

async function startGeneration() {
  if (!activeCurriculum.value || generating.value) return;
  error.value = "";
  generating.value = true;
  try {
    let id = runId.value;
    if (!id || runDone.value) {
      runId.value = null;
      runData.value = null;
      const started = await startSyllabus(activeCurriculum.value.id);
      if (!started.configured) {
        error.value = started.text || "Syllabus agent not configured.";
        return;
      }
      id = started.runId;
      runId.value = id;
    } else {
      await resumeSyllabus(id);
    }
  } catch (e) {
    const msg = e?.message || "Failed to generate syllabus.";
    if (/deadline-exceeded/i.test(msg)) {
      error.value = "Generation hit the time limit while working. Progress is saved; click Continue generation to resume from the saved run.";
    } else {
      error.value = msg;
    }
  } finally {
    generating.value = false;
  }
}

async function findResumableRun() {
  if (!auth.familyId || !activeCurriculum.value || runId.value) return;
  try {
    const snap = await getDocs(collection(db, "families", auth.familyId, "agentRuns"));
    const runs = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((r) => r.type === "syllabus" && r.curriculumId === activeCurriculum.value.id && r.status !== "done" && r.status !== "cancelled")
      .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    if (runs[0]) runId.value = runs[0].id;
  } catch {
    // Non-critical; the user can still start a new checkpointed run.
  }
}

onMounted(() => { findResumableRun(); loadSchedule(); });
watch(activeCurriculum, () => { findResumableRun(); });

const statusIcon = (s) => ({ pending: "⏳", running: "⟳", done: "✓", error: "✗" }[s] || "⏳");
const statusClass = (s) => ({ pending: "pending", running: "running", done: "done", error: "err" }[s] || "pending");

// ─── Content planning (plan-first) + QA sample ───────────────────────────────
const canBuild = computed(() => ["owner", "parent"].includes(auth.role) || auth.isSuperAdmin);
const planning = ref(false);
const planError = ref("");
const planRun = ref(null);          // latest contentplan agentRuns doc (live progress)
const subjectPlans = ref({});       // subjectId -> plan doc
let stopPlanRun = null;
let stopPlans = null;

const planRunning = computed(() => planning.value || planRun.value?.status === "running");
const planSubjectCount = computed(() => Object.keys(subjectPlans.value).length);
const hasPlans = computed(() => planSubjectCount.value > 0);
const planRunSubjects = computed(() =>
  Object.entries(planRun.value?.subjects || {}).map(([id, v]) => ({ id, ...v }))
);

function subscribePlanArtifacts(familyId) {
  if (stopPlanRun) { stopPlanRun(); stopPlanRun = null; }
  if (stopPlans) { stopPlans(); stopPlans = null; }
  if (!familyId) return;
  stopPlanRun = onSnapshot(
    query(collection(db, "families", familyId, "agentRuns"), orderBy("createdAt", "desc"), limit(8)),
    (snap) => {
      const r = snap.docs.map((d) => ({ id: d.id, ...d.data() })).find((d) => d.type === "contentplan");
      if (r) planRun.value = r;
    }, () => {}
  );
  stopPlans = onSnapshot(
    collection(db, "families", familyId, "subjectPlans"),
    (snap) => { const m = {}; snap.docs.forEach((d) => { m[d.id] = d.data(); }); subjectPlans.value = m; }, () => {}
  );
}

async function planContent() {
  if (planning.value) return;
  planning.value = true;
  planError.value = "";
  try {
    const res = await requestContentPlanning();
    if (res?.configured === false) planError.value = res.text || "The planning agent isn't configured.";
  } catch (e) {
    planError.value = e?.message || "Failed to plan content.";
  } finally {
    planning.value = false;
  }
}

// QA sample
const sampleSubjectId = ref("");
const sampleLimit = ref(6);
const sampling = ref(false);
const sampleItems = ref([]);
const sampleError = ref("");
async function runSample() {
  if (!sampleSubjectId.value || sampling.value) return;
  sampling.value = true;
  sampleError.value = "";
  sampleItems.value = [];
  try {
    const res = await requestContentSample(sampleSubjectId.value, Number(sampleLimit.value) || 6);
    if (res?.configured === false) { sampleError.value = res.text || "Content generation isn't configured."; return; }
    sampleItems.value = res.items || [];
  } catch (e) {
    sampleError.value = e?.message || "Failed to generate the sample.";
  } finally {
    sampling.value = false;
  }
}

// Generate ALL remaining content — explicit, user-initiated (no more auto-start
// on page load). Enqueues the server-side backfill; the floating progress card
// (ContentBackfill.vue) then reflects it.
const missingContentCount = computed(() => activityStore.activities.filter((a) => !a.content).length);
const startingFull = ref(false);
const fullError = ref("");
const fullStarted = ref(false);
async function startFullGeneration() {
  if (startingFull.value || !missingContentCount.value) return;
  startingFull.value = true;
  fullError.value = "";
  try {
    const res = await requestContentBackfill();
    if (res?.configured === false) { fullError.value = res.text || "Content generation isn't configured."; return; }
    fullStarted.value = true;
    setTimeout(() => (fullStarted.value = false), 6000);
  } catch (e) {
    fullError.value = e?.message || "Failed to start generation.";
  } finally {
    startingFull.value = false;
  }
}

// Retry-failed: activities that were attempted and failed carry a contentError
// (and have no content). The activities store already streams these fields.
const failedActivities = computed(() => activityStore.activities.filter((a) => a.contentError && !a.content));
const retrying = ref(false);
const retryItems = ref([]);
const retryError = ref("");
const retryRemaining = ref(null);
async function retryFailed() {
  if (retrying.value || !failedActivities.value.length) return;
  retrying.value = true;
  retryError.value = "";
  retryItems.value = [];
  retryRemaining.value = null;
  try {
    const res = await regenerateFailedContent("", 10);
    if (res?.configured === false) { retryError.value = res.text || "Content generation isn't configured."; return; }
    retryItems.value = res.items || [];
    retryRemaining.value = res.remaining ?? null;
  } catch (e) {
    retryError.value = e?.message || "Failed to regenerate.";
  } finally {
    retrying.value = false;
  }
}

watch(() => auth.familyId, (id) => subscribePlanArtifacts(id), { immediate: true });
onUnmounted(() => { if (stopPlanRun) stopPlanRun(); if (stopPlans) stopPlans(); });
</script>

<template>
  <section class="syllabus">
    <h1>Syllabus Builder</h1>
    <p class="lede">
      Generate a complexity-graded activity series for every subject in your active
      curriculum. Activities progress from introductory (rank 1) to mastery (rank 5)
      over 6 months.
    </p>

    <!-- No curriculum yet -->
    <div v-if="!activeCurriculum" class="empty-state">
      <p>No active curriculum found.</p>
      <router-link to="/curriculum" class="btn primary">Build a Curriculum first</router-link>
    </div>

    <template v-else>
      <!-- Curriculum info -->
      <div class="curr-card">
        <span class="curr-title">{{ activeCurriculum.title || "Untitled Curriculum" }}</span>
        <span class="curr-subjects">{{ activeCurriculum.subjectCount }} subject{{ activeCurriculum.subjectCount !== 1 ? "s" : "" }}</span>
      </div>

      <!-- Generate button -->
      <div class="actions">
        <button
          class="btn primary"
          :disabled="generating || runRunning || runQueued"
          @click="startGeneration"
        >
          {{ generateLabel }}
        </button>
        <span v-if="activityStore.activities.length && !generating && !runRunning" class="activity-count">
          {{ activityStore.activities.length }} activities generated
        </span>
        <button
          v-if="canDelete && activityStore.activities.length && !generating && !runRunning"
          class="btn danger"
          :disabled="deletingSyllabus"
          @click="removeSyllabus"
        >
          {{ deletingSyllabus ? "Deleting…" : "🗑 Delete syllabus" }}
        </button>
      </div>

      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <p v-if="runRunning || runQueued" class="server-note">
        Syllabus generation is running on the server. You can leave this page; activities will appear when the run is complete.
      </p>
      <p v-if="runCancelled" class="server-note stopped-note">
        Generation stopped. Activities created before you stopped are saved — click Generate to continue from where it left off.
      </p>

      <!-- Progress panel -->
      <div v-if="runData" class="progress-panel">
        <div class="progress-header">
          <span class="progress-title">Generation progress</span>
          <span class="progress-status" :class="runData.status">{{ runData.status }}</span>
          <button
            v-if="runRunning || runQueued"
            class="btn-stop"
            type="button"
            :disabled="stopping"
            @click="stopGeneration"
          >{{ stopping ? "Stopping…" : "Stop" }}</button>
        </div>
        <div class="subjects-progress">
          <div
            v-for="s in subjectProgress"
            :key="s.id"
            class="subject-row"
            :class="statusClass(s.status)"
          >
            <span class="status-icon">{{ statusIcon(s.status) }}</span>
            <span class="subject-name">{{ s.name }}</span>
            <span v-if="s.status === 'done'" class="subject-count">
              {{ s.activityCount }} / {{ s.targetActivityCount || "?" }} activities
            </span>
            <span v-if="s.status === 'error'" class="subject-err">{{ s.error }}</span>
          </div>
        </div>
        <div v-if="runDone" class="progress-done">
          ✓ Done — {{ runData.totalActivities }} activities created across {{ runData.completedSubjects }} subjects.
        </div>
      </div>

      <!-- Content planning (plan-first) + QA sample -->
      <div v-if="activityStore.activities.length && (!runData || runDone)" class="plan-card">
        <div class="plan-head">
          <h2>Content planning &amp; QA</h2>
          <button v-if="canBuild" class="btn primary" :disabled="planRunning" @click="planContent">
            {{ planRunning ? "Planning…" : (hasPlans ? "Re-plan content" : "Plan content") }}
          </button>
        </div>
        <p class="plan-lede">
          The planner first designs a coherent arc for each subject — what every activity teaches, in order,
          with no duplication — and stores it. Content generation then follows that plan so activities weave
          together instead of being written in isolation. Plan → sample to check quality → generate the rest.
        </p>
        <p v-if="planError" class="error">{{ planError }}</p>
        <p v-if="hasPlans && !planRunning" class="plan-ready">✓ A plan exists for {{ planSubjectCount }} subject(s). New content will follow it.</p>

        <!-- live planning progress -->
        <div v-if="planRunning && planRunSubjects.length" class="plan-progress">
          <div v-for="s in planRunSubjects" :key="s.id" class="subject-row" :class="statusClass(s.status)">
            <span class="status-icon">{{ statusIcon(s.status) }}</span>
            <span class="subject-name">{{ s.name }}</span>
            <span v-if="s.status === 'done'" class="subject-count">{{ s.activityCount }} activities planned</span>
            <span v-else-if="s.status === 'error'" class="subject-err">{{ s.error }}</span>
          </div>
        </div>

        <!-- QA sample -->
        <div class="qa-block">
          <h3 class="qa-title">Quick quality check</h3>
          <div class="qa-row">
            <select v-model="sampleSubjectId" class="qa-select" aria-label="Subject to sample">
              <option value="">Pick a subject…</option>
              <option v-for="g in activityStore.bySubject" :key="g.subjectId" :value="g.subjectId">{{ g.subject }}</option>
            </select>
            <label class="qa-num-label">
              first
              <input type="number" v-model="sampleLimit" min="1" max="8" class="qa-num" aria-label="How many activities" />
            </label>
            <button class="btn secondary" :disabled="!sampleSubjectId || sampling || !canBuild" @click="runSample">
              {{ sampling ? "Generating…" : "Generate sample" }}
            </button>
          </div>
          <p class="qa-hint">Generates real content for the first few activities of one subject (≈ two weeks) so you can judge quality before committing to a full run.</p>
          <p v-if="sampleError" class="error">{{ sampleError }}</p>

          <!-- Generate everything (explicit, user-initiated) -->
          <div class="generate-all">
            <span v-if="missingContentCount" class="ga-count">{{ missingContentCount }} activit{{ missingContentCount === 1 ? "y" : "ies" }} still need content.</span>
            <span v-else class="ga-done">All activities have content ✓</span>
            <button class="btn primary" :disabled="!missingContentCount || startingFull || !canBuild" @click="startFullGeneration">
              {{ startingFull ? "Starting…" : "Generate all content" }}
            </button>
          </div>
          <p v-if="fullStarted" class="ga-started">✓ Started — generation runs on the server; the progress card (bottom of the screen) tracks it. You can leave this page.</p>
          <p v-if="fullError" class="error">{{ fullError }}</p>
          <ul v-if="sampleItems.length" class="qa-items">
            <li v-for="it in sampleItems" :key="it.id" class="qa-item">
              <div class="qa-item-head">
                <span class="qa-mark" :class="it.ok ? 'ok' : 'bad'">{{ it.ok ? "✓" : "✗" }}</span>
                <router-link :to="`/activity/${it.id}`">{{ it.title }}</router-link>
                <span v-if="it.kind" class="qa-kind">{{ it.kind }}</span>
              </div>
              <p v-if="!it.ok && it.error" class="qa-reason">{{ it.error }}</p>
            </li>
          </ul>
        </div>

        <!-- Retry failed activities -->
        <div v-if="failedActivities.length || retryItems.length" class="qa-block retry-block">
          <h3 class="qa-title">Failed activities</h3>
          <div class="qa-row">
            <span class="retry-count">{{ failedActivities.length }} activit{{ failedActivities.length === 1 ? "y" : "ies" }} failed to generate.</span>
            <button class="btn secondary" :disabled="!failedActivities.length || retrying || !canBuild" @click="retryFailed">
              {{ retrying ? "Retrying…" : "Regenerate failed" }}
            </button>
          </div>
          <p class="qa-hint">Retries up to 10 at a time, using the plan. Click again to continue through a larger backlog.</p>
          <p v-if="retryError" class="error">{{ retryError }}</p>
          <p v-if="retryRemaining !== null" class="retry-summary">
            Regenerated {{ retryItems.filter((i) => i.ok).length }} of {{ retryItems.length }}.
            <span v-if="retryRemaining > 0">{{ retryRemaining }} still failing — click again to keep trying.</span>
            <span v-else>No failures remaining 🎉</span>
          </p>
          <ul v-if="retryItems.length" class="qa-items">
            <li v-for="it in retryItems" :key="it.id" class="qa-item">
              <div class="qa-item-head">
                <span class="qa-mark" :class="it.ok ? 'ok' : 'bad'">{{ it.ok ? "✓" : "✗" }}</span>
                <router-link :to="`/activity/${it.id}`">{{ it.title }}</router-link>
                <span v-if="it.kind" class="qa-kind">{{ it.kind }}</span>
              </div>
              <p v-if="!it.ok && it.error" class="qa-reason">{{ it.error }}</p>
            </li>
          </ul>
        </div>
      </div>

      <!-- Learning progression (#7) -->
      <div v-if="progression.length && (!runData || runDone)" class="progression">
        <h2>Learning progression</h2>
        <p class="prog-lede">
          How each subject builds from basics (Intro) to Mastery over the 6 months. Scheduled
          dates appear here once you add activities to the planner.
        </p>
        <div v-for="g in progression" :key="g.subjectId" class="prog-subject">
          <h3 class="group-title">{{ g.subject }}</h3>
          <div class="prog-flow">
            <template v-for="(s, si) in g.steps" :key="s.id">
              <div class="prog-node" :class="`rank-${s.rank}`" :title="s.title">
                <span class="prog-badge">{{ COMPLEXITY_LABELS[s.rank] || `R${s.rank}` }}</span>
                <span class="prog-title"><span class="prog-ico">{{ TYPE_ICONS[s.type] || "📝" }}</span>{{ s.title }}</span>
                <span v-if="s.date" class="prog-date">📅 {{ shortDate(s.date) }}</span>
                <span v-else class="prog-date unscheduled">not scheduled</span>
              </div>
              <span v-if="si < g.steps.length - 1" class="prog-arrow" aria-hidden="true">→</span>
            </template>
          </div>
        </div>
      </div>

      <!-- Activity library -->
      <div v-if="activityStore.bySubject.length && (!runData || runDone)" class="library">
        <h2>Activity Library</h2>
        <div v-for="group in activityStore.bySubject" :key="group.subjectId" class="subject-group">
          <h3 class="group-title">{{ group.subject }}</h3>
          <div class="activities-grid">
            <div v-for="a in group.items" :key="a.id" class="activity-card">
              <div class="card-top">
                <span class="type-icon">{{ TYPE_ICONS[a.type] || "📝" }}</span>
                <span :class="`rank-badge rank-${a.complexityRank}`">
                  {{ COMPLEXITY_LABELS[a.complexityRank] || `R${a.complexityRank}` }}
                </span>
                <span v-if="a.coopMode" class="coop-badge">Co-op</span>
              </div>
              <p class="card-title">{{ a.title }}</p>
              <p class="card-duration">{{ a.durationMinutes }} min</p>
              <div v-if="childNamesFor(a).length" class="card-children">
                <span v-for="(n, ni) in childNamesFor(a)" :key="ni" class="mini-child-chip">{{ n }}</span>
              </div>
              <router-link :to="`/activity/${a.id}`" class="card-view-link">View activity →</router-link>
              <details class="card-details">
                <summary>Instructions</summary>
                <p class="card-body">{{ a.parentInstructions }}</p>
                <p v-if="a.exampleWalkthrough" class="card-body example">
                  <em>Example:</em> {{ a.exampleWalkthrough }}
                </p>
              </details>
            </div>
          </div>
        </div>
      </div>

      <p v-else-if="!generating && !runRunning && !runData" class="empty-lib">
        No activities yet — click "Generate Syllabus" to create your activity series.
      </p>
    </template>
  </section>
</template>

<style scoped>
.syllabus { max-width: 860px; }
.lede { color: #475569; margin-bottom: 1.5rem; }

.empty-state { padding: 2rem; text-align: center; color: #64748b; }

.curr-card {
  display: flex; align-items: center; gap: 0.75rem;
  background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px;
  padding: 0.75rem 1rem; margin-bottom: 1rem;
}
.curr-title { font-weight: 600; }
.curr-subjects { font-size: 0.8rem; color: #94a3b8; }

.actions { display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem; }
.activity-count { font-size: 0.85rem; color: #64748b; }

.btn { padding: 0.6rem 1.2rem; border-radius: 8px; border: none; cursor: pointer; font: inherit; }
.btn.primary { background: #0b1f3a; color: #fff; }
.btn.danger { background: #fff; color: #b91c1c; border: 1px solid #fca5a5; }
.btn.danger:hover { background: #fef2f2; }
.btn:disabled { opacity: 0.6; cursor: not-allowed; }

.error { color: #b91c1c; margin-bottom: 1rem; }
.server-note { color: #475569; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 0.65rem 0.8rem; margin: 0 0 1rem; font-size: 0.9rem; }

/* Progress panel */
.progress-panel {
  background: #fff; border: 1px solid #e2e8f0; border-radius: 10px;
  padding: 1rem; margin-bottom: 1.5rem;
}
.progress-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem; }
.progress-title { font-weight: 600; }
.progress-status { font-size: 0.75rem; padding: 0.15rem 0.5rem; border-radius: 999px; background: #e2e8f0; }
.progress-status.running { background: #fef9c3; color: #854d0e; }
.progress-status.done { background: #dcfce7; color: #15803d; }
.progress-status.error { background: #fee2e2; color: #b91c1c; }
.progress-status.cancelled { background: #ffedd5; color: #9a3412; }
.progress-header .btn-stop {
  margin-left: auto; cursor: pointer; font-size: 0.78rem; font-weight: 600;
  color: #b91c1c; background: #fff; border: 1px solid #fecaca;
  border-radius: 999px; padding: 0.2rem 0.7rem;
}
.progress-header .btn-stop:hover:not(:disabled) { background: #fef2f2; }
.progress-header .btn-stop:disabled { opacity: 0.6; cursor: default; }
.stopped-note { color: #9a3412; background: #fff7ed; border-color: #fed7aa; }

.subjects-progress { display: flex; flex-direction: column; gap: 0.4rem; }
.subject-row {
  display: flex; align-items: center; gap: 0.5rem;
  padding: 0.4rem 0.6rem; border-radius: 6px; background: #f8fafc;
}
.subject-row.done { background: #f0fdf4; }
.subject-row.running { background: #fffbeb; }
.subject-row.err { background: #fff1f2; }
.status-icon { font-size: 0.85rem; width: 1.2rem; text-align: center; }
.subject-name { flex: 1; font-size: 0.9rem; }
.subject-count { font-size: 0.75rem; color: #64748b; }
.subject-err { font-size: 0.75rem; color: #b91c1c; }
.progress-done { margin-top: 0.75rem; color: #15803d; font-size: 0.9rem; }

/* Activity library */
.library h2 { font-size: 1rem; color: #334155; margin: 0 0 1rem; }
.subject-group { margin-bottom: 1.5rem; }
.group-title { font-size: 0.95rem; color: #1e293b; margin: 0 0 0.6rem; padding-bottom: 0.3rem; border-bottom: 1px solid #e2e8f0; }

.activities-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 0.75rem; }
.activity-card {
  background: #fff; border: 1px solid #e2e8f0; border-radius: 10px;
  padding: 0.75rem; display: flex; flex-direction: column; gap: 0.4rem;
}
.card-top { display: flex; align-items: center; gap: 0.4rem; }
.type-icon { font-size: 1.1rem; }
.rank-badge {
  font-size: 0.65rem; font-weight: 700; padding: 0.1rem 0.4rem;
  border-radius: 999px; background: #e2e8f0; color: #475569;
}
.rank-badge.rank-1 { background: #dcfce7; color: #166534; }
.rank-badge.rank-2 { background: #dbeafe; color: #1e40af; }
.rank-badge.rank-3 { background: #fef9c3; color: #854d0e; }
.rank-badge.rank-4 { background: #fed7aa; color: #9a3412; }
.rank-badge.rank-5 { background: #f3e8ff; color: #6b21a8; }
.coop-badge { font-size: 0.65rem; padding: 0.1rem 0.4rem; border-radius: 999px; background: #e0f2fe; color: #0369a1; }

.card-title { font-weight: 600; font-size: 0.9rem; margin: 0; }
.card-duration { font-size: 0.75rem; color: #94a3b8; margin: 0; }
.card-view-link { font-size: 0.75rem; color: #0b1f3a; text-decoration: none; }
.card-view-link:hover { text-decoration: underline; }
.card-details { font-size: 0.85rem; }
.card-details summary { cursor: pointer; color: #475569; }
.card-body { margin: 0.4rem 0 0; color: #334155; white-space: pre-wrap; }
.card-body.example { color: #64748b; }

.empty-lib { color: #94a3b8; }

/* Learning progression flow (#7) */
.progression { margin-bottom: 1.75rem; }
.progression h2 { font-size: 1rem; color: #334155; margin: 0 0 0.25rem; }
.prog-lede { font-size: 0.82rem; color: #64748b; margin: 0 0 1rem; }
.prog-subject { margin-bottom: 1.1rem; }
.prog-flow { display: flex; align-items: stretch; gap: 0.4rem; overflow-x: auto; padding: 0.25rem 0 0.5rem; }
.prog-node {
  flex: 0 0 auto; width: 150px; display: flex; flex-direction: column; gap: 0.3rem;
  background: #fff; border: 1px solid #e2e8f0; border-left-width: 4px; border-radius: 10px; padding: 0.5rem 0.6rem;
}
.prog-node.rank-1 { border-left-color: #16a34a; }
.prog-node.rank-2 { border-left-color: #2563eb; }
.prog-node.rank-3 { border-left-color: #ca8a04; }
.prog-node.rank-4 { border-left-color: #ea580c; }
.prog-node.rank-5 { border-left-color: #9333ea; }
.prog-badge { font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #64748b; }
.prog-title { font-size: 0.78rem; font-weight: 600; color: #1e293b; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.prog-ico { margin-right: 0.25rem; }
.prog-date { font-size: 0.68rem; color: #0369a1; margin-top: auto; }
.prog-date.unscheduled { color: #cbd5e1; }
.prog-arrow { align-self: center; color: #cbd5e1; font-size: 1.1rem; flex: 0 0 auto; }

/* Child attribution chips on activity cards (#8) */
.card-children { display: flex; flex-wrap: wrap; gap: 0.25rem; }
.mini-child-chip { font-size: 0.65rem; font-weight: 600; padding: 0.08rem 0.45rem; border-radius: 999px; background: #e0e7ff; color: #3730a3; }

/* Content planning + QA card */
.plan-card { background: #fff; border: 1px solid #c7d2fe; border-radius: 12px; padding: 1rem 1.25rem; margin-bottom: 1.5rem; }
.plan-head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.plan-head h2 { margin: 0; font-size: 1rem; }
.plan-lede { color: #475569; font-size: 0.86rem; margin: 0.5rem 0 0.75rem; }
.plan-ready { color: #15803d; font-size: 0.85rem; margin: 0 0 0.75rem; }
.plan-progress { display: flex; flex-direction: column; gap: 0.4rem; margin-bottom: 1rem; }
.qa-block { border-top: 1px solid #eef2f7; padding-top: 0.85rem; }
.qa-title { font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; margin: 0 0 0.5rem; }
.qa-row { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.qa-select { padding: 0.4rem 0.6rem; border: 1px solid #cbd5e1; border-radius: 8px; font: inherit; min-width: 160px; }
.qa-num-label { font-size: 0.82rem; color: #64748b; display: flex; align-items: center; gap: 0.35rem; }
.qa-num { width: 3.2rem; padding: 0.4rem 0.5rem; border: 1px solid #cbd5e1; border-radius: 8px; font: inherit; }
.qa-hint { font-size: 0.76rem; color: #94a3b8; margin: 0.4rem 0 0; }
.qa-items { list-style: none; padding: 0; margin: 0.6rem 0 0; display: flex; flex-direction: column; gap: 0.3rem; }
.qa-item { font-size: 0.88rem; }
.qa-item-head { display: flex; align-items: center; gap: 0.5rem; }
.qa-reason { margin: 0.15rem 0 0 1.4rem; font-size: 0.76rem; color: #b91c1c; background: #fef2f2; border-radius: 6px; padding: 0.25rem 0.5rem; }
.qa-mark.ok { color: #15803d; } .qa-mark.bad { color: #b91c1c; }
.qa-kind { font-size: 0.68rem; padding: 0.05rem 0.4rem; border-radius: 999px; background: #f1f5f9; color: #64748b; }
.retry-block { margin-top: 0.5rem; }
.retry-count { font-size: 0.85rem; color: #b45309; }
.retry-summary { font-size: 0.82rem; color: #334155; margin: 0.5rem 0 0; }
.generate-all { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; margin-top: 0.9rem; padding-top: 0.85rem; border-top: 1px solid #eef2f7; }
.ga-count { font-size: 0.85rem; color: #334155; }
.ga-done { font-size: 0.85rem; color: #15803d; }
.ga-started { font-size: 0.82rem; color: #15803d; margin: 0.5rem 0 0; }
</style>
