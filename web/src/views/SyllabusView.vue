<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from "vue";
import { collection, doc, getDoc, getDocs, onSnapshot, query, orderBy, limit } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthStore } from "@/stores/auth";
import { useCurriculumStore } from "@/stores/curriculum";
import { useActivityStore } from "@/stores/activities";
import { useProfilesStore } from "@/stores/profiles";
import { resumeSyllabus, startSyllabus, stopSyllabus } from "@/services/syllabus";
import { deleteSyllabus, auditActivityDifferentiation, differentiateActivities } from "@/services/admin";
import { requestContentPlanning, requestContentSample, regenerateFailedContent, requestContentBackfill } from "@/services/activityContent";
import { useActivityLink } from "@/composables/useActivityLink";
import ActivityContent from "@/components/ActivityContent.vue";

const { copiedId, copyActivityLink } = useActivityLink();

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
const TYPE_LABELS = {
  quran: "Quran", noorani_qaida: "Qaida",
  arabic_reading: "Arabic reading", urdu_reading: "Urdu reading", english_reading: "English reading",
  story_reading: "Story", conversation: "Conversation",
  mathematics: "Mathematics", computer: "Computer", ai_robotics: "AI & Robotics", physical: "Physical", teaching: "Teaching",
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

// ─── Activity Library search + filters ──────────────────────────────────────
// Lightweight client-side filtering over the already-streamed activities, so the
// parent can find a specific activity (search) or narrow the library by type,
// complexity, or which child it targets — without a round trip.
const librarySearch = ref("");
const libraryTypes = ref([]);   // selected activity types (empty = all)
const libraryRanks = ref([]);   // selected complexity ranks (empty = all)
const libraryChildId = ref(""); // "" = all children

// Types present in the library, sorted by label (reuses TYPE_LABELS ordering).
const libraryTypeOptions = computed(() => {
  const present = new Set(activityStore.activities.map((a) => a.type));
  return Object.keys(TYPE_LABELS).filter((t) => present.has(t));
});
const libraryRankOptions = computed(() => {
  const present = new Set(activityStore.activities.map((a) => a.complexityRank || 1));
  return [1, 2, 3, 4, 5].filter((r) => present.has(r));
});

function toggleLibraryType(t) {
  const i = libraryTypes.value.indexOf(t);
  if (i === -1) libraryTypes.value.push(t); else libraryTypes.value.splice(i, 1);
}
function toggleLibraryRank(r) {
  const i = libraryRanks.value.indexOf(r);
  if (i === -1) libraryRanks.value.push(r); else libraryRanks.value.splice(i, 1);
}
function clearLibraryFilters() {
  librarySearch.value = "";
  libraryTypes.value = [];
  libraryRanks.value = [];
  libraryChildId.value = "";
}
const hasLibraryFilters = computed(() =>
  Boolean(librarySearch.value.trim()) || libraryTypes.value.length > 0 ||
  libraryRanks.value.length > 0 || Boolean(libraryChildId.value)
);

function activityMatches(a) {
  const q = librarySearch.value.trim().toLowerCase();
  if (q) {
    const hay = `${a.title || ""} ${a.parentInstructions || ""} ${a.exampleWalkthrough || ""}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  if (libraryTypes.value.length && !libraryTypes.value.includes(a.type)) return false;
  if (libraryRanks.value.length && !libraryRanks.value.includes(a.complexityRank || 1)) return false;
  if (libraryChildId.value) {
    const ids = (a.targetChildren || []).filter((id) => validChildIds.value.has(id));
    // No explicit targets = applies to all children, so it always matches a child filter.
    if (ids.length && !ids.includes(libraryChildId.value)) return false;
  }
  return true;
}

// Same grouping shape as activityStore.bySubject, but only matching activities,
// and groups with no matches are dropped.
const filteredBySubject = computed(() => {
  if (!hasLibraryFilters.value) return activityStore.bySubject;
  return activityStore.bySubject
    .map((g) => ({ ...g, items: g.items.filter(activityMatches) }))
    .filter((g) => g.items.length);
});
const filteredActivityCount = computed(() =>
  filteredBySubject.value.reduce((n, g) => n + g.items.length, 0)
);

// ─── Quick view drawer ───────────────────────────────────────────────────────
// A full-width drawer slides in from the right showing an activity's content
// inline, so the parent can preview it without navigating away from the library.
const quickViewActivity = ref(null);
function openQuickView(a) {
  quickViewActivity.value = a;
  document.body.style.overflow = "hidden"; // lock background scroll while open
}
function closeQuickView() {
  quickViewActivity.value = null;
  document.body.style.overflow = "";
}
function onKeydown(e) {
  if (e.key === "Escape" && quickViewActivity.value) closeQuickView();
}
onMounted(() => window.addEventListener("keydown", onKeydown));
onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown);
  document.body.style.overflow = "";
});

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
    const res = await requestContentSample(sampleSubjectId.value, Number(sampleLimit.value) || 6, bulkGuidance.value.trim());
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
// Optional parent direction shared by all the bulk (re)generation actions below —
// why they're regenerating and what to change. Fed into each activity's prompt.
// Capped to match the server (6000 chars).
const GUIDANCE_MAX = 6000;
const bulkGuidance = ref("");
const startingFull = ref(false);
const fullError = ref("");
const fullStarted = ref(false);
async function startFullGeneration() {
  if (startingFull.value || !missingContentCount.value) return;
  startingFull.value = true;
  fullError.value = "";
  try {
    const res = await requestContentBackfill({ guidance: bulkGuidance.value.trim() });
    if (res?.configured === false) { fullError.value = res.text || "Content generation isn't configured."; return; }
    fullStarted.value = true;
    setTimeout(() => (fullStarted.value = false), 6000);
  } catch (e) {
    fullError.value = e?.message || "Failed to start generation.";
  } finally {
    startingFull.value = false;
  }
}

// Regenerate ALL content — overwrites every activity's existing content (force).
// Heavier than fill-missing, so it confirms first. Reuses the same server-side
// queue + progress card; the regenerate token makes it converge.
const regeneratingAll = ref(false);
async function regenerateAllContent() {
  if (regeneratingAll.value || !activityStore.activities.length) return;
  const n = activityStore.activities.length;
  if (!window.confirm(`Regenerate content for all ${n} activities? This overwrites their current content and can take a while (it runs on the server — you can leave this page).`)) return;
  regeneratingAll.value = true;
  fullError.value = "";
  try {
    const res = await requestContentBackfill({ force: true, guidance: bulkGuidance.value.trim() });
    if (res?.configured === false) { fullError.value = res.text || "Content generation isn't configured."; return; }
    fullStarted.value = true;
    setTimeout(() => (fullStarted.value = false), 6000);
  } catch (e) {
    fullError.value = e?.message || "Failed to start regeneration.";
  } finally {
    regeneratingAll.value = false;
  }
}

// Regenerate by activity TYPE — the parent ticks one or more types (e.g. just
// the parent-led "Teaching" activities) and only those are overwritten. Same
// server-side queue, scoped by `types`.
const typeCounts = computed(() => {
  const m = {};
  for (const a of activityStore.activities) m[a.type] = (m[a.type] || 0) + 1;
  return m;
});
const regenTypes = computed(() =>
  Object.keys(typeCounts.value).sort((a, b) => (TYPE_LABELS[a] || a).localeCompare(TYPE_LABELS[b] || b))
);
const selectedTypes = ref([]);
function toggleType(t) {
  const i = selectedTypes.value.indexOf(t);
  if (i === -1) selectedTypes.value.push(t); else selectedTypes.value.splice(i, 1);
}
const selectedTypeCount = computed(() =>
  selectedTypes.value.reduce((n, t) => n + (typeCounts.value[t] || 0), 0)
);
const regeneratingTypes = ref(false);
async function regenerateSelectedTypes() {
  if (regeneratingTypes.value || !selectedTypes.value.length) return;
  const n = selectedTypeCount.value;
  const names = selectedTypes.value.map((t) => TYPE_LABELS[t] || t).join(", ");
  if (!window.confirm(`Regenerate content for ${n} ${names} activit${n === 1 ? "y" : "ies"}? This overwrites their current content and runs on the server.`)) return;
  regeneratingTypes.value = true;
  fullError.value = "";
  try {
    const res = await requestContentBackfill({ force: true, types: [...selectedTypes.value], guidance: bulkGuidance.value.trim() });
    if (res?.configured === false) { fullError.value = res.text || "Content generation isn't configured."; return; }
    fullStarted.value = true;
    setTimeout(() => (fullStarted.value = false), 6000);
  } catch (e) {
    fullError.value = e?.message || "Failed to start regeneration.";
  } finally {
    regeneratingTypes.value = false;
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
    const res = await regenerateFailedContent("", 10, bulkGuidance.value.trim());
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

// ─── Activity differentiation audit (read-only) ──────────────────────────────
// Flags skill-paced activities (Noorani Qaida, reading, maths…) that are clubbed
// across several children of differing levels onto one shared content blob. Read-
// only: it produces a plan, mutates nothing. Owner/parent only.
const auditOpen = ref(false);
const auditRunning = ref(false);
const auditError = ref("");
const auditPlan = ref(null);
function onAuditToggle(e) { auditOpen.value = e.target.open; }
async function runAudit() {
  auditRunning.value = true;
  auditError.value = "";
  try {
    auditPlan.value = await auditActivityDifferentiation();
  } catch (e) {
    auditError.value = e?.message || "Audit failed.";
  } finally {
    auditRunning.value = false;
  }
}
// Only the activities the audit wants changed (split or reviewed), worst first.
const auditFlagged = computed(() =>
  (auditPlan.value?.activities || []).filter((a) => a.recommendation !== "keep-shared")
);

// Apply differentiation — pilot scoped to Noorani Qaida. Generates per-child
// content variants, looping the bounded callable until nothing remains. Then
// re-runs the audit so the list reflects the new state.
const diffRunning = ref(false);
const diffError = ref("");
const diffProgress = ref("");
const diffItems = ref([]);
async function differentiateQaida() {
  diffRunning.value = true;
  diffError.value = "";
  diffItems.value = [];
  diffProgress.value = "Inferring each child's level and generating per-child content…";
  try {
    let remaining = Infinity;
    let guard = 0;
    while (remaining > 0 && guard < 40) {
      // One activity per call: per-child content + image generation is slow, so a
      // small batch keeps each request comfortably under the function timeout.
      const res = await differentiateActivities({ types: ["noorani_qaida"], limit: 1 });
      if (res?.configured === false) { diffError.value = res.text || "Not configured."; break; }
      diffItems.value.push(...(res.items || []));
      remaining = Number(res.remaining) || 0;
      diffProgress.value = `Differentiated ${diffItems.value.filter((i) => i.ok).length} activit${diffItems.value.filter((i) => i.ok).length === 1 ? "y" : "ies"}; ${remaining} remaining…`;
      guard += 1;
    }
    diffProgress.value = `Done — ${diffItems.value.filter((i) => i.ok).length} Noorani Qaida activit${diffItems.value.filter((i) => i.ok).length === 1 ? "y" : "ies"} now have per-child content.`;
    await runAudit(); // refresh the flagged list
  } catch (e) {
    diffError.value = e?.message || "Differentiation failed.";
  } finally {
    diffRunning.value = false;
  }
}

// ─── Progressive disclosure: power sections collapsed by default ─────────────
const syllabusToolsEl = ref(null);
const contentToolsEl = ref(null);
const syllabusToolsOpen = ref(false);
const contentToolsOpen = ref(false);
const progressionOpen = ref(false);
const syllabusToolsManual = ref(false);
const contentToolsManual = ref(false);

const shouldAutoOpenSyllabusTools = computed(() =>
  !activityStore.activities.length || runRunning.value || runQueued.value
);
const shouldAutoOpenContentTools = computed(() =>
  planRunning.value || failedActivities.value.length > 0
);
const showLibrary = computed(() =>
  activityStore.bySubject.length && (!runData.value || runDone.value)
);

watch(shouldAutoOpenSyllabusTools, (open) => {
  if (open && !syllabusToolsManual.value) syllabusToolsOpen.value = true;
}, { immediate: true });
watch(shouldAutoOpenContentTools, (open) => {
  if (open && !contentToolsManual.value) contentToolsOpen.value = true;
}, { immediate: true });

function onSyllabusToolsToggle(e) {
  syllabusToolsOpen.value = e.target.open;
  syllabusToolsManual.value = true;
}
function onContentToolsToggle(e) {
  contentToolsOpen.value = e.target.open;
  contentToolsManual.value = true;
}
function onProgressionToggle(e) {
  progressionOpen.value = e.target.open;
}

function openSyllabusTools() {
  syllabusToolsOpen.value = true;
  nextTick(() => syllabusToolsEl.value?.scrollIntoView({ behavior: "smooth", block: "start" }));
}
function openContentTools() {
  contentToolsManual.value = false;
  contentToolsOpen.value = true;
  nextTick(() => contentToolsEl.value?.scrollIntoView({ behavior: "smooth", block: "start" }));
}

const statusGenerateLabel = computed(() => {
  if (generating.value) return "Starting…";
  if (runRunning.value || runQueued.value) return "Generation running…";
  if (!activityStore.activities.length) return "Generate activities";
  return null;
});
</script>

<template>
  <section class="syllabus">
    <h1>Your Activities</h1>
    <p class="lede">
      Browse and open the learning activities for your curriculum.
      Advanced tools for building and improving content are below.
    </p>

    <!-- No curriculum yet -->
    <div v-if="!activeCurriculum" class="empty-state">
      <p>No active curriculum found.</p>
      <router-link to="/curriculum" class="btn primary">Build a Curriculum first</router-link>
    </div>

    <template v-else>
      <!-- Compact status strip -->
      <div class="status-strip">
        <div class="status-info">
          <span class="status-title">{{ activeCurriculum.title || "Untitled Curriculum" }}</span>
          <span class="status-meta">
            {{ activeCurriculum.subjectCount }} subject{{ activeCurriculum.subjectCount !== 1 ? "s" : "" }}
            <template v-if="activityStore.activities.length">
              · {{ activityStore.activities.length }} activit{{ activityStore.activities.length === 1 ? "y" : "ies" }}
            </template>
          </span>
        </div>
        <div class="status-actions">
          <button
            v-if="statusGenerateLabel"
            class="btn primary"
            :disabled="generating || runRunning || runQueued"
            @click="startGeneration"
          >
            {{ statusGenerateLabel }}
          </button>
          <button
            v-else-if="activityStore.activities.length"
            type="button"
            class="btn-link"
            @click="openSyllabusTools"
          >
            Manage syllabus
          </button>
        </div>
      </div>

      <p v-if="error" class="error" role="alert">{{ error }}</p>

      <!-- Actionable banners -->
      <div v-if="runRunning || runQueued" class="banner banner-running">
        <span>Activities are being generated on the server — you can leave this page.</span>
        <button
          class="btn-stop"
          type="button"
          :disabled="stopping"
          @click="stopGeneration"
        >{{ stopping ? "Stopping…" : "Stop" }}</button>
      </div>
      <p v-if="runCancelled" class="banner banner-stopped">
        Generation stopped. Saved activities are kept — open Syllabus tools to continue.
      </p>
      <div v-if="failedActivities.length && canBuild && showLibrary" class="banner banner-failed">
        <span>{{ failedActivities.length }} activit{{ failedActivities.length === 1 ? "y" : "ies" }} failed to generate content.</span>
        <button class="btn secondary" :disabled="retrying" @click="openContentTools(); retryFailed()">
          {{ retrying ? "Retrying…" : "Retry failed" }}
        </button>
      </div>
      <div v-if="missingContentCount && showLibrary && canBuild && !runRunning && !runQueued" class="banner banner-missing">
        <span>{{ missingContentCount }} activit{{ missingContentCount === 1 ? "y" : "ies" }} still need content.</span>
        <button type="button" class="btn secondary" @click="openContentTools">Generate content</button>
      </div>

      <!-- Activity library (hero) -->
      <div v-if="showLibrary" class="library">
        <div class="lib-controls">
          <div class="lib-search">
            <span class="lib-search-ico" aria-hidden="true">🔍</span>
            <input
              v-model="librarySearch"
              type="search"
              class="lib-search-input"
              placeholder="Search activities by title or instructions…"
              aria-label="Search activities"
            />
          </div>

          <details class="lib-filters">
            <summary>Filter activities</summary>
            <div class="lib-filters-body">
              <div class="lib-filter-row">
                <span class="lib-filter-label">Type</span>
                <div class="lib-chips">
                  <button
                    v-for="t in libraryTypeOptions"
                    :key="t"
                    type="button"
                    class="lib-chip"
                    :class="{ on: libraryTypes.includes(t) }"
                    :aria-pressed="libraryTypes.includes(t)"
                    @click="toggleLibraryType(t)"
                  >
                    <span class="lib-chip-ico">{{ TYPE_ICONS[t] || "📝" }}</span>
                    {{ TYPE_LABELS[t] || t }}
                  </button>
                </div>
              </div>

              <div class="lib-filter-row">
                <span class="lib-filter-label">Level</span>
                <div class="lib-chips">
                  <button
                    v-for="r in libraryRankOptions"
                    :key="r"
                    type="button"
                    class="lib-chip"
                    :class="{ on: libraryRanks.includes(r) }"
                    :aria-pressed="libraryRanks.includes(r)"
                    @click="toggleLibraryRank(r)"
                  >
                    {{ COMPLEXITY_LABELS[r] || `R${r}` }}
                  </button>
                </div>
              </div>

              <div v-if="profilesStore.children.length" class="lib-filter-row">
                <span class="lib-filter-label">Child</span>
                <select v-model="libraryChildId" class="lib-select" aria-label="Filter by child">
                  <option value="">All children</option>
                  <option v-for="c in profilesStore.children" :key="c.id" :value="c.id">{{ c.name }}</option>
                </select>
              </div>

              <div class="lib-result-row">
                <span class="lib-result-count">
                  {{ filteredActivityCount }} of {{ activityStore.activities.length }} activit{{ activityStore.activities.length === 1 ? "y" : "ies" }}
                </span>
                <button v-if="hasLibraryFilters" type="button" class="lib-clear" @click="clearLibraryFilters">Clear filters</button>
              </div>
            </div>
          </details>
        </div>

        <p v-if="!filteredBySubject.length" class="lib-no-match">No activities match your search or filters.</p>

        <div v-for="group in filteredBySubject" :key="group.subjectId" class="subject-group">
          <h3 class="group-title">{{ group.subject }}</h3>
          <div class="activities-grid">
            <div v-for="a in group.items" :key="a.id" class="activity-card">
              <div class="card-top">
                <span class="type-icon">{{ TYPE_ICONS[a.type] || "📝" }}</span>
                <span :class="`rank-badge rank-${a.complexityRank}`">
                  {{ COMPLEXITY_LABELS[a.complexityRank] || `R${a.complexityRank}` }}
                </span>
                <span v-if="a.coopMode" class="coop-badge">Co-op</span>
                <button
                  type="button"
                  class="quick-view-btn"
                  title="Quick view"
                  aria-label="Quick view activity content"
                  @click="openQuickView(a)"
                >👁</button>
                <button
                  type="button"
                  class="share-link-btn"
                  :title="copiedId === a.id ? 'Link copied!' : 'Copy shareable link'"
                  :aria-label="`Copy shareable link for ${a.title}`"
                  @click="copyActivityLink(a.id)"
                >{{ copiedId === a.id ? "✓" : "🔗" }}</button>
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

      <div v-else-if="!generating && !runRunning && !runData" class="empty-lib">
        <p>No activities yet — generate your activity series to get started.</p>
        <button
          class="btn primary"
          :disabled="generating"
          @click="startGeneration"
        >
          {{ generating ? "Starting…" : "Generate activities" }}
        </button>
      </div>

      <!-- Power sections (collapsed by default when activities exist) -->
      <div class="power-sections">
        <!-- A. Syllabus tools -->
        <details
          ref="syllabusToolsEl"
          class="power-section"
          :open="syllabusToolsOpen"
          @toggle="onSyllabusToolsToggle"
        >
          <summary>Syllabus tools</summary>
          <div class="power-body">
            <p class="power-lede">Generate or regenerate the activity series for your curriculum, or delete it to start over.</p>
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
          </div>
        </details>

        <!-- B. Content tools -->
        <details
          v-if="activityStore.activities.length && (!runData || runDone)"
          ref="contentToolsEl"
          class="power-section"
          :open="contentToolsOpen"
          @toggle="onContentToolsToggle"
        >
          <summary>Content tools</summary>
          <div class="power-body plan-card">
            <div class="plan-head">
              <p class="plan-lede">
                Plan how activities connect, preview a sample, then generate or regenerate content for your library.
              </p>
              <button v-if="canBuild" class="btn primary" :disabled="planRunning" @click="planContent">
                {{ planRunning ? "Planning…" : (hasPlans ? "Re-plan content" : "Plan content") }}
              </button>
            </div>
            <p v-if="planError" class="error">{{ planError }}</p>
            <p v-if="hasPlans && !planRunning" class="plan-ready">✓ A plan exists for {{ planSubjectCount }} subject(s). New content will follow it.</p>

            <div v-if="planRunning && planRunSubjects.length" class="plan-progress">
              <div v-for="s in planRunSubjects" :key="s.id" class="subject-row" :class="statusClass(s.status)">
                <span class="status-icon">{{ statusIcon(s.status) }}</span>
                <span class="subject-name">{{ s.name }}</span>
                <span v-if="s.status === 'done'" class="subject-count">{{ s.activityCount }} activities planned</span>
                <span v-else-if="s.status === 'error'" class="subject-err">{{ s.error }}</span>
              </div>
            </div>

            <div class="qa-block">
              <div class="bulk-guidance">
                <label for="bulk-guidance" class="bg-label">
                  Direction for the generator <span class="bg-optional">(optional — applies to every generate &amp; regenerate action below)</span>
                </label>
                <textarea
                  id="bulk-guidance"
                  v-model="bulkGuidance"
                  class="bg-input"
                  :maxlength="GUIDANCE_MAX"
                  rows="3"
                  :disabled="!canBuild"
                  placeholder="Tell the generator why you're regenerating and what to change — e.g. content was too advanced for the children; use simpler language; tie activities more closely to the guiding light; add more real-world examples."
                ></textarea>
                <span class="bg-count">{{ bulkGuidance.length }} / {{ GUIDANCE_MAX }}</span>
              </div>

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
              <p class="qa-hint">Generates real content for the first few activities of one subject so you can judge quality before a full run.</p>
              <p v-if="sampleError" class="error">{{ sampleError }}</p>

              <div class="generate-all">
                <span v-if="missingContentCount" class="ga-count">{{ missingContentCount }} activit{{ missingContentCount === 1 ? "y" : "ies" }} still need content.</span>
                <span v-else class="ga-done">All activities have content ✓</span>
                <button class="btn primary" :disabled="!missingContentCount || startingFull || !canBuild" @click="startFullGeneration">
                  {{ startingFull ? "Starting…" : "Generate all content" }}
                </button>
                <button
                  class="btn secondary"
                  :disabled="!activityStore.activities.length || regeneratingAll || startingFull || !canBuild"
                  title="Overwrite the content of every activity (picks up the latest content improvements)"
                  @click="regenerateAllContent"
                >
                  {{ regeneratingAll ? "Starting…" : "Regenerate all" }}
                </button>
              </div>
              <p class="ga-hint">“Generate all” only fills activities that are missing content. “Regenerate all” overwrites everything.</p>

              <div v-if="regenTypes.length" class="regen-types">
                <span class="rt-label">Or regenerate only certain activity types:</span>
                <div class="rt-chips">
                  <button
                    v-for="t in regenTypes"
                    :key="t"
                    type="button"
                    class="rt-chip"
                    :class="{ on: selectedTypes.includes(t) }"
                    :aria-pressed="selectedTypes.includes(t)"
                    :disabled="!canBuild"
                    @click="toggleType(t)"
                  >
                    <span class="rt-ico">{{ TYPE_ICONS[t] || "📝" }}</span>
                    {{ TYPE_LABELS[t] || t }}
                    <span class="rt-count">{{ typeCounts[t] }}</span>
                  </button>
                </div>
                <div class="rt-actions">
                  <button
                    class="btn secondary"
                    :disabled="!selectedTypes.length || regeneratingTypes || startingFull || regeneratingAll || !canBuild"
                    @click="regenerateSelectedTypes"
                  >
                    {{ regeneratingTypes ? "Starting…" : (selectedTypes.length ? `Regenerate selected (${selectedTypeCount})` : "Regenerate selected") }}
                  </button>
                  <button v-if="selectedTypes.length" class="rt-clear" type="button" @click="selectedTypes = []">Clear</button>
                </div>
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
        </details>

        <!-- C. Activity differentiation audit (read-only) -->
        <details
          v-if="canBuild && activityStore.activities.length"
          class="power-section"
          :open="auditOpen"
          @toggle="onAuditToggle"
        >
          <summary>Differentiation audit</summary>
          <div class="power-body plan-card">
            <div class="plan-head">
              <p class="plan-lede">
                Check whether any skill-paced activities (Noorani Qaida, reading, maths…) are shared by
                several children at different levels — those should be split per child. Read-only: this
                only reports; it changes nothing.
              </p>
              <button class="btn primary" :disabled="auditRunning" @click="runAudit">
                {{ auditRunning ? "Auditing…" : "Run audit" }}
              </button>
            </div>
            <p v-if="auditError" class="error">{{ auditError }}</p>

            <template v-if="auditPlan">
              <p class="plan-ready">
                Scanned {{ auditPlan.summary.total }} activities for {{ auditPlan.children.length }} child(ren).
                <strong>{{ auditPlan.summary.toSplit }}</strong> clubbed across children (should split),
                <strong>{{ auditPlan.summary.toReview }}</strong> co-op skill activities to review.
              </p>

              <!-- Pilot apply: differentiate Noorani Qaida into per-child content. -->
              <div class="generate-all">
                <span class="ga-count">Pilot: give each child their own level-paced version of the Noorani Qaida activities.</span>
                <button class="btn primary" :disabled="diffRunning || auditRunning" @click="differentiateQaida">
                  {{ diffRunning ? "Differentiating…" : "Differentiate Noorani Qaida" }}
                </button>
              </div>
              <p v-if="diffProgress" class="ga-started">{{ diffProgress }}</p>
              <p v-if="diffError" class="error">{{ diffError }}</p>
              <ul v-if="diffItems.length" class="qa-items">
                <li v-for="(it, i) in diffItems" :key="`${it.id}-${i}`" class="qa-item">
                  <div class="qa-item-head">
                    <span class="qa-mark" :class="it.ok ? 'ok' : 'bad'">{{ it.ok ? "✓" : "✗" }}</span>
                    <router-link :to="`/activity/${it.id}`">{{ it.title }}</router-link>
                    <span v-if="it.ok" class="qa-kind">{{ it.children }} child versions</span>
                  </div>
                  <p v-if="!it.ok && it.error" class="qa-reason">{{ it.error }}</p>
                </li>
              </ul>

              <h3 class="qa-title">Flagged activities</h3>
              <ul v-if="auditFlagged.length" class="qa-items">
                <li v-for="a in auditFlagged" :key="a.id" class="qa-item">
                  <div class="qa-item-head">
                    <span class="qa-mark" :class="a.recommendation === 'split-per-child' ? 'bad' : 'ok'">
                      {{ a.recommendation === 'split-per-child' ? 'split' : 'review' }}
                    </span>
                    <router-link :to="`/activity/${a.id}`">{{ a.title }}</router-link>
                    <span class="qa-kind">{{ a.type }}</span>
                    <span class="qa-kind">{{ a.targetNames.join(", ") }}</span>
                  </div>
                  <p class="qa-reason">{{ a.rationale }}</p>
                </li>
              </ul>
              <p v-else class="ga-done">No clubbed skill-paced activities found ✓</p>
            </template>
          </div>
        </details>

        <!-- D. Progression map -->
        <details
          v-if="progression.length && (!runData || runDone)"
          class="power-section"
          :open="progressionOpen"
          @toggle="onProgressionToggle"
        >
          <summary>Progression map</summary>
          <div class="power-body progression">
            <p class="prog-lede">
              How each subject builds from basics (Intro) to Mastery. Scheduled dates appear once you add activities to the planner.
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
        </details>
      </div>
    </template>

    <!-- Quick view drawer — full-width panel sliding in from the right -->
    <Teleport to="body">
      <Transition name="qv">
        <div v-if="quickViewActivity" class="qv-overlay" @click.self="closeQuickView">
          <aside class="qv-drawer" role="dialog" aria-modal="true" aria-label="Activity quick view">
            <header class="qv-head">
              <div class="qv-head-main">
                <span class="qv-icon">{{ TYPE_ICONS[quickViewActivity.type] || "📝" }}</span>
                <div>
                  <h2 class="qv-title">{{ quickViewActivity.title }}</h2>
                  <div class="qv-meta">
                    <span :class="`rank-badge rank-${quickViewActivity.complexityRank}`">
                      {{ COMPLEXITY_LABELS[quickViewActivity.complexityRank] || `R${quickViewActivity.complexityRank}` }}
                    </span>
                    <span class="qv-chip">{{ quickViewActivity.subject }}</span>
                    <span v-if="quickViewActivity.durationMinutes" class="qv-chip">{{ quickViewActivity.durationMinutes }} min</span>
                    <span v-if="quickViewActivity.coopMode" class="qv-chip coop">Co-op</span>
                  </div>
                </div>
              </div>
              <div class="qv-head-actions">
                <button
                  type="button"
                  class="qv-share-btn"
                  :title="copiedId === quickViewActivity.id ? 'Link copied!' : 'Copy shareable link'"
                  aria-label="Copy shareable link"
                  @click="copyActivityLink(quickViewActivity.id)"
                >{{ copiedId === quickViewActivity.id ? "✓ Copied" : "🔗 Copy link" }}</button>
                <router-link :to="`/activity/${quickViewActivity.id}`" class="qv-open-link">Open full activity →</router-link>
                <button type="button" class="qv-close" aria-label="Close quick view" @click="closeQuickView">✕</button>
              </div>
            </header>

            <div class="qv-body">
              <section v-if="quickViewActivity.parentInstructions" class="qv-section">
                <h3 class="qv-section-h">Parent Instructions</h3>
                <p class="qv-text">{{ quickViewActivity.parentInstructions }}</p>
              </section>

              <section v-if="quickViewActivity.exampleWalkthrough" class="qv-section">
                <h3 class="qv-section-h">Example Walkthrough</h3>
                <p class="qv-text walkthrough">{{ quickViewActivity.exampleWalkthrough }}</p>
              </section>

              <section class="qv-section">
                <h3 class="qv-section-h">Activity Content</h3>
                <ActivityContent v-if="quickViewActivity.content" :content="quickViewActivity.content" />
                <p v-else class="qv-empty">
                  No content generated yet for this activity.
                  <router-link :to="`/activity/${quickViewActivity.id}`">Open the activity</router-link> to generate it.
                </p>
              </section>
            </div>
          </aside>
        </div>
      </Transition>
    </Teleport>
  </section>
</template>

<style scoped>
.syllabus { max-width: 860px; }
.lede { color: #475569; margin-bottom: 1rem; font-size: 0.92rem; }

.empty-state { padding: 2rem; text-align: center; color: #64748b; }

/* Status strip */
.status-strip {
  display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap;
  background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px;
  padding: 0.65rem 1rem; margin-bottom: 0.75rem;
}
.status-info { display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; }
.status-title { font-weight: 600; font-size: 0.95rem; }
.status-meta { font-size: 0.8rem; color: #94a3b8; }
.status-actions { flex-shrink: 0; }
.btn-link {
  border: none; background: none; cursor: pointer; font: inherit;
  font-size: 0.85rem; color: #0b1f3a; text-decoration: underline; padding: 0.35rem 0;
}
.btn-link:hover { color: #1e293b; }

/* Action banners */
.banner {
  display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap;
  border-radius: 8px; padding: 0.55rem 0.85rem; margin-bottom: 0.75rem; font-size: 0.88rem;
}
.banner-running { background: #fffbeb; border: 1px solid #fde68a; color: #854d0e; }
.banner-stopped { background: #fff7ed; border: 1px solid #fed7aa; color: #9a3412; margin-bottom: 0.75rem; }
.banner-failed { background: #fff1f2; border: 1px solid #fecdd3; color: #9f1239; }
.banner-missing { background: #f0f9ff; border: 1px solid #bae6fd; color: #0c4a6e; }

.actions { display: flex; align-items: center; gap: 1rem; margin-bottom: 0.75rem; flex-wrap: wrap; }
.activity-count { font-size: 0.85rem; color: #64748b; }

.btn { padding: 0.6rem 1.2rem; border-radius: 8px; border: none; cursor: pointer; font: inherit; }
.btn.primary { background: #0b1f3a; color: #fff; }
.btn.secondary { background: #fff; color: #0b1f3a; border: 1px solid #cbd5e1; }
.btn.secondary:hover:not(:disabled) { background: #f8fafc; }
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
.progress-status.cancelled { background: #ffedd5; color: #9a3412; }
.progress-header .btn-stop {
  margin-left: auto; cursor: pointer; font-size: 0.78rem; font-weight: 600;
  color: #b91c1c; background: #fff; border: 1px solid #fecaca;
  border-radius: 999px; padding: 0.2rem 0.7rem;
}
.progress-header .btn-stop:hover:not(:disabled) { background: #fef2f2; }
.progress-header .btn-stop:disabled { opacity: 0.6; cursor: default; }

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
.library { margin-bottom: 1.5rem; }
.subject-group { margin-bottom: 1.5rem; }
.group-title { font-size: 0.95rem; color: #1e293b; margin: 0 0 0.6rem; padding-bottom: 0.3rem; border-bottom: 1px solid #e2e8f0; }

/* Library search + filters */
.lib-controls {
  background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px;
  padding: 0.85rem 1rem; margin-bottom: 1.25rem;
  display: flex; flex-direction: column; gap: 0.7rem;
}
.lib-filters { font-size: 0.88rem; }
.lib-filters summary {
  cursor: pointer; color: #475569; font-weight: 500; padding: 0.2rem 0;
  list-style: none; display: flex; align-items: center; gap: 0.35rem;
}
.lib-filters summary::-webkit-details-marker { display: none; }
.lib-filters summary::before { content: "▸"; font-size: 0.75rem; color: #94a3b8; }
.lib-filters[open] summary::before { content: "▾"; }
.lib-filters-body { display: flex; flex-direction: column; gap: 0.7rem; padding-top: 0.65rem; }
.lib-search { position: relative; display: flex; align-items: center; }
.lib-search-ico { position: absolute; left: 0.7rem; font-size: 0.85rem; pointer-events: none; opacity: 0.7; }
.lib-search-input {
  width: 100%; padding: 0.55rem 0.7rem 0.55rem 2.1rem;
  border: 1px solid #cbd5e1; border-radius: 8px; font: inherit; background: #fff;
}
.lib-search-input:focus { outline: none; border-color: #0b1f3a; }
.lib-filter-row { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
.lib-filter-label {
  font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
  color: #64748b; min-width: 3rem;
}
.lib-chips { display: flex; flex-wrap: wrap; gap: 0.35rem; }
.lib-chip {
  display: inline-flex; align-items: center; gap: 0.3rem;
  border: 1px solid #cbd5e1; background: #fff; color: #334155;
  border-radius: 999px; padding: 0.25rem 0.65rem; font-size: 0.8rem; cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
}
.lib-chip:hover { background: #f1f5f9; }
.lib-chip.on { background: #0b1f3a; border-color: #0b1f3a; color: #fff; }
.lib-chip-ico { font-size: 0.9rem; }
.lib-select { padding: 0.35rem 0.55rem; border: 1px solid #cbd5e1; border-radius: 8px; font: inherit; background: #fff; }
.lib-result-row { display: flex; align-items: center; gap: 0.75rem; padding-top: 0.15rem; }
.lib-result-count { font-size: 0.8rem; color: #64748b; }
.lib-clear { border: none; background: none; color: #0b1f3a; font-size: 0.8rem; cursor: pointer; text-decoration: underline; }
.lib-clear:hover { color: #1e293b; }
.lib-no-match { color: #94a3b8; font-size: 0.9rem; padding: 0.5rem 0; }

.activities-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 0.75rem; }
.activity-card {
  background: #fff; border: 1px solid #e2e8f0; border-radius: 10px;
  padding: 0.75rem; display: flex; flex-direction: column; gap: 0.4rem;
}
.card-top { display: flex; align-items: center; gap: 0.4rem; }
.quick-view-btn {
  margin-left: auto; border: 1px solid #e2e8f0; background: #fff; color: #475569;
  border-radius: 8px; width: 1.7rem; height: 1.7rem; line-height: 1; cursor: pointer;
  font-size: 0.9rem; display: inline-flex; align-items: center; justify-content: center;
  transition: background 0.12s, border-color 0.12s;
}
.quick-view-btn:hover { background: #f1f5f9; border-color: #cbd5e1; }
.share-link-btn {
  border: 1px solid #e2e8f0; background: #fff; color: #475569;
  border-radius: 8px; width: 1.7rem; height: 1.7rem; line-height: 1; cursor: pointer;
  font-size: 0.85rem; display: inline-flex; align-items: center; justify-content: center;
  transition: background 0.12s, border-color 0.12s;
}
.share-link-btn:hover { background: #f1f5f9; border-color: #cbd5e1; }
.qv-share-btn {
  font-size: 0.82rem; color: #0b1f3a; background: #f1f5f9; border: 1px solid #cbd5e1;
  border-radius: 8px; padding: 0.3rem 0.7rem; cursor: pointer; white-space: nowrap;
}
.qv-share-btn:hover { background: #e2e8f0; }
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

.empty-lib {
  color: #64748b; text-align: center; padding: 2rem 1rem; margin-bottom: 1.5rem;
  background: #f8fafc; border: 1px dashed #e2e8f0; border-radius: 10px;
  display: flex; flex-direction: column; align-items: center; gap: 1rem;
}
.empty-lib p { margin: 0; }

/* Power sections (progressive disclosure) */
.power-sections { margin-top: 2rem; display: flex; flex-direction: column; gap: 0.65rem; }
.power-section {
  border: 1px solid #e2e8f0; border-radius: 10px; background: #fafbfc;
}
.power-section summary {
  cursor: pointer; font-weight: 600; font-size: 0.92rem; color: #334155;
  padding: 0.75rem 1rem; list-style: none; display: flex; align-items: center; gap: 0.4rem;
}
.power-section summary::-webkit-details-marker { display: none; }
.power-section summary::before { content: "▸"; font-size: 0.75rem; color: #94a3b8; }
.power-section[open] summary::before { content: "▾"; }
.power-section[open] summary { border-bottom: 1px solid #e2e8f0; }
.power-body { padding: 0.85rem 1rem 1rem; }
.power-lede { font-size: 0.85rem; color: #64748b; margin: 0 0 0.75rem; }

/* Learning progression flow */
.progression { margin-bottom: 0; }
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
.plan-card { background: transparent; border: none; border-radius: 0; padding: 0; margin-bottom: 0; }
.plan-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
.plan-head h2 { margin: 0; font-size: 1rem; }
.plan-lede { color: #475569; font-size: 0.86rem; margin: 0; flex: 1; min-width: 200px; }
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
.bulk-guidance { display: flex; flex-direction: column; gap: 0.3rem; margin-bottom: 1rem; padding-bottom: 0.85rem; border-bottom: 1px dashed #e2e8f0; }
.bg-label { font-size: 0.82rem; font-weight: 600; color: #334155; }
.bg-optional { font-weight: 400; color: #94a3b8; }
.bg-input {
  width: 100%; box-sizing: border-box; resize: vertical; min-height: 3.2rem;
  font: inherit; font-size: 0.86rem; line-height: 1.4; color: #0f172a;
  padding: 0.5rem 0.6rem; border: 1px solid #cbd5e1; border-radius: 0.5rem;
}
.bg-input:focus { outline: none; border-color: #2563eb; box-shadow: 0 0 0 2px rgba(37,99,235,0.15); }
.bg-input:disabled { background: #f1f5f9; color: #94a3b8; }
.bg-count { align-self: flex-end; font-size: 0.72rem; color: #94a3b8; font-variant-numeric: tabular-nums; }
.generate-all { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; margin-top: 0.9rem; padding-top: 0.85rem; border-top: 1px solid #eef2f7; }
.ga-count { font-size: 0.85rem; color: #334155; }
.ga-done { font-size: 0.85rem; color: #15803d; }
.ga-started { font-size: 0.82rem; color: #15803d; margin: 0.5rem 0 0; }
.ga-hint { font-size: 0.78rem; color: #64748b; margin: 0.45rem 0 0; line-height: 1.5; }

/* Regenerate by activity type (filtered overwrite) */
.regen-types { margin-top: 0.85rem; padding-top: 0.8rem; border-top: 1px dashed #e2e8f0; }
.rt-label { display: block; font-size: 0.82rem; color: #334155; margin-bottom: 0.5rem; }
.rt-chips { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.rt-chip { display: inline-flex; align-items: center; gap: 0.35rem; border: 1px solid #cbd5e1; background: #fff; color: #334155; border-radius: 999px; padding: 0.3rem 0.7rem; font-size: 0.82rem; cursor: pointer; transition: background 0.12s, border-color 0.12s; }
.rt-chip:hover:not(:disabled) { background: #f1f5f9; }
.rt-chip:disabled { opacity: 0.55; cursor: default; }
.rt-chip.on { background: #14532d; border-color: #14532d; color: #fff; }
.rt-ico { font-size: 0.95rem; }
.rt-count { font-size: 0.7rem; font-weight: 700; background: rgba(0,0,0,0.08); border-radius: 999px; padding: 0.02rem 0.4rem; }
.rt-chip.on .rt-count { background: rgba(255,255,255,0.22); }
.rt-actions { display: flex; align-items: center; gap: 0.6rem; margin-top: 0.6rem; }
.rt-clear { border: none; background: none; color: #64748b; font-size: 0.8rem; cursor: pointer; text-decoration: underline; }
.rt-clear:hover { color: #334155; }

/* Quick view drawer */
.qv-overlay {
  position: fixed; inset: 0; z-index: 1000;
  background: rgba(15, 23, 42, 0.45);
  display: flex; justify-content: flex-end;
}
.qv-drawer {
  width: 100%; height: 100%; background: #f8fafc;
  display: flex; flex-direction: column; box-shadow: -8px 0 30px rgba(0, 0, 0, 0.15);
}
.qv-head {
  flex: 0 0 auto; display: flex; align-items: flex-start; justify-content: space-between;
  gap: 1rem; padding: 1.1rem 1.5rem; background: #fff; border-bottom: 1px solid #e2e8f0;
}
.qv-head-main { display: flex; gap: 0.9rem; align-items: flex-start; min-width: 0; }
.qv-icon { font-size: 2rem; line-height: 1; }
.qv-title { margin: 0 0 0.35rem; font-size: 1.2rem; color: #0f172a; }
.qv-meta { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.qv-chip { font-size: 0.75rem; padding: 0.15rem 0.5rem; border-radius: 999px; background: #f1f5f9; color: #475569; }
.qv-chip.coop { background: #e0f2fe; color: #0369a1; }
.qv-head-actions { display: flex; align-items: center; gap: 0.85rem; flex-shrink: 0; }
.qv-open-link { font-size: 0.82rem; color: #0b1f3a; text-decoration: none; white-space: nowrap; }
.qv-open-link:hover { text-decoration: underline; }
.qv-close {
  border: 1px solid #e2e8f0; background: #fff; color: #475569; cursor: pointer;
  width: 2rem; height: 2rem; border-radius: 8px; font-size: 1rem; line-height: 1;
  display: inline-flex; align-items: center; justify-content: center;
}
.qv-close:hover { background: #f1f5f9; }

.qv-body { flex: 1 1 auto; overflow-y: auto; padding: 1.5rem; }
.qv-body > * { max-width: 760px; margin-left: auto; margin-right: auto; }
.qv-section { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 1.25rem; margin-bottom: 1rem; }
.qv-section-h { margin: 0 0 0.75rem; font-size: 0.9rem; color: #334155; text-transform: uppercase; letter-spacing: 0.05em; }
.qv-text { white-space: pre-wrap; color: #1e293b; line-height: 1.7; margin: 0; }
.qv-text.walkthrough { color: #475569; font-style: italic; }
.qv-empty { color: #64748b; font-size: 0.9rem; margin: 0; }

/* Slide-in transition */
.qv-enter-active, .qv-leave-active { transition: opacity 0.2s ease; }
.qv-enter-active .qv-drawer, .qv-leave-active .qv-drawer { transition: transform 0.25s ease; }
.qv-enter-from, .qv-leave-to { opacity: 0; }
.qv-enter-from .qv-drawer, .qv-leave-to .qv-drawer { transform: translateX(100%); }
</style>
