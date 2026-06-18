<script setup>
import { ref, computed, watch, onUnmounted } from "vue";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthStore } from "@/stores/auth";
import { useCurriculumStore } from "@/stores/curriculum";
import { useActivityStore } from "@/stores/activities";
import { generateSyllabus } from "@/services/syllabus";
import { deleteSyllabus } from "@/services/admin";

const auth = useAuthStore();
const curriculumStore = useCurriculumStore();
const activityStore = useActivityStore();

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
    error: s.error,
  }));
});

const runDone = computed(() => runData.value?.status === "done");
const runRunning = computed(() => runData.value?.status === "running");

const COMPLEXITY_LABELS = { 1: "Intro", 2: "Basic", 3: "Mid", 4: "Advanced", 5: "Mastery" };
const TYPE_ICONS = {
  quran: "📖", noorani_qaida: "🔤", story_reading: "📚", mathematics: "🔢",
  computer: "💻", ai_robotics: "🤖", physical: "🏃", teaching: "📝",
};

async function startGeneration() {
  if (!activeCurriculum.value || generating.value) return;
  error.value = "";
  generating.value = true;
  runId.value = null;
  runData.value = null;
  try {
    const res = await generateSyllabus(activeCurriculum.value.id);
    if (!res.configured) {
      error.value = res.text || "Syllabus agent not configured.";
    }
    // runId is set by the progress watcher once the callable returns
    if (res.runId) runId.value = res.runId;
  } catch (e) {
    error.value = e?.message || "Failed to generate syllabus.";
  } finally {
    generating.value = false;
  }
}

const statusIcon = (s) => ({ pending: "⏳", running: "⟳", done: "✓", error: "✗" }[s] || "⏳");
const statusClass = (s) => ({ pending: "pending", running: "running", done: "done", error: "err" }[s] || "pending");
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
          :disabled="generating || runRunning"
          @click="startGeneration"
        >
          <template v-if="generating || runRunning">⟳ Generating…</template>
          <template v-else-if="activityStore.activities.length">Regenerate Syllabus</template>
          <template v-else>Generate Syllabus</template>
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

      <!-- Progress panel -->
      <div v-if="runData" class="progress-panel">
        <div class="progress-header">
          <span class="progress-title">Generation progress</span>
          <span class="progress-status" :class="runData.status">{{ runData.status }}</span>
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
              {{ s.activityCount }} activities
            </span>
            <span v-if="s.status === 'error'" class="subject-err">{{ s.error }}</span>
          </div>
        </div>
        <div v-if="runDone" class="progress-done">
          ✓ Done — {{ runData.totalActivities }} activities created across {{ runData.completedSubjects }} subjects.
        </div>
      </div>

      <!-- Activity library -->
      <div v-if="activityStore.bySubject.length" class="library">
        <h2>Activity Library</h2>
        <div v-for="group in activityStore.bySubject" :key="group.subjectId" class="subject-group">
          <h3 class="group-title">{{ group.subject }}</h3>
          <div class="activities-grid">
            <div v-for="a in group.items" :key="a.id" class="activity-card">
              <div class="card-top">
                <span class="type-icon">{{ TYPE_ICONS[a.type] || "📝" }}</span>
                <span class="rank-badge rank-{{ a.complexityRank }}">
                  {{ COMPLEXITY_LABELS[a.complexityRank] || `R${a.complexityRank}` }}
                </span>
                <span v-if="a.coopMode" class="coop-badge">Co-op</span>
              </div>
              <p class="card-title">{{ a.title }}</p>
              <p class="card-duration">{{ a.durationMinutes }} min</p>
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
</style>
