<script setup>
import { ref, computed, watch, onUnmounted } from "vue";
import { useAuthStore } from "@/stores/auth";
import { useActivityStore } from "@/stores/activities";
import { usePlannerStore } from "@/stores/planner";
import { useProfilesStore } from "@/stores/profiles";
import { addBlock, removeBlock } from "@/services/planner";
import { updateGuardian } from "@/services/profiles";
import { autoSchedule } from "@/services/scheduler";

const auth = useAuthStore();
const activityStore = useActivityStore();
const plannerStore = usePlannerStore();
const profilesStore = useProfilesStore();

// ─── Week helpers ────────────────────────────────────────────────────────────
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function startOfWeek(d) {
  const date = new Date(d);
  const day = date.getDay();
  date.setDate(date.getDate() + (day === 0 ? -6 : 1 - day));
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dayLabel(date) {
  const dow = date.getDay();
  return `${DAY_NAMES[dow === 0 ? 6 : dow - 1]} ${date.getDate()}`;
}

// ─── Week state ──────────────────────────────────────────────────────────────
const weekStart = ref(startOfWeek(new Date()));

const weekDays = computed(() =>
  Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart.value, i);
    return { date, dateKey: formatDate(date), label: dayLabel(date) };
  })
);

const weekLabel = computed(() => {
  const s = weekDays.value[0].date;
  const e = weekDays.value[6].date;
  const fmt = (d) => `${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
  return `${fmt(s)} – ${fmt(e)} ${e.getFullYear()}`;
});

function prevWeek() { weekStart.value = addDays(weekStart.value, -7); }
function nextWeek() { weekStart.value = addDays(weekStart.value, 7); }
function goToday() { weekStart.value = startOfWeek(new Date()); }

// ─── Bind store to current week ──────────────────────────────────────────────
watch(
  [() => auth.familyId, weekDays],
  ([fid, days]) => fid ? plannerStore.bind(fid, days.map((d) => d.dateKey)) : plannerStore.unbind(),
  { immediate: true }
);
onUnmounted(() => plannerStore.unbind());

// ─── Drag-and-drop ───────────────────────────────────────────────────────────
const dragging = ref(null);
const dragOverKey = ref(null);

function onDragStart(activity) { dragging.value = activity; }
function onDragEnd() { dragging.value = null; dragOverKey.value = null; }
function onDragOver(key) { dragOverKey.value = key; }
function onDragLeave() { dragOverKey.value = null; }
async function onDrop(dateKey) {
  const a = dragging.value;
  dragging.value = null;
  dragOverKey.value = null;
  if (!a || !auth.familyId) return;
  await doSchedule(a, dateKey, "09:00");
}

// ─── Schedule modal ──────────────────────────────────────────────────────────
const modal = ref(null);
const modalDate = ref("");
const modalTime = ref("09:00");
const scheduling = ref(false);
const schedError = ref("");

function openModal(activity) {
  modal.value = activity;
  modalDate.value = weekDays.value[0].dateKey;
  modalTime.value = "09:00";
  schedError.value = "";
}

function closeModal() { modal.value = null; }

async function confirmSchedule() {
  if (!modal.value) return;
  scheduling.value = true;
  schedError.value = "";
  try {
    await doSchedule(modal.value, modalDate.value, modalTime.value);
    closeModal();
  } catch (e) {
    schedError.value = e.message || "Failed to schedule.";
  } finally {
    scheduling.value = false;
  }
}

async function doSchedule(activity, dateKey, time) {
  await addBlock(auth.familyId, dateKey, {
    activityId: activity.id,
    activityTitle: activity.title,
    subject: activity.subject || "",
    subjectId: activity.subjectId || "",
    type: activity.type || "teaching",
    complexityRank: activity.complexityRank || 1,
    coopMode: Boolean(activity.coopMode),
    targetChildren: activity.targetChildren || [],
    durationMinutes: activity.durationMinutes || 30,
    scheduledTime: time || "09:00",
    notes: "",
    status: "planned",
    createdBy: auth.user?.uid || "",
  });
}

async function doRemove(dateKey, blockId) {
  if (!auth.familyId) return;
  await removeBlock(auth.familyId, dateKey, blockId);
}

// ─── Schedule via agent ──────────────────────────────────────────────────────
const agentScheduling = ref(false);
const agentSchedMsg = ref("");
const agentSchedError = ref("");

async function scheduleViaAgent() {
  if (!auth.familyId || agentScheduling.value) return;
  agentScheduling.value = true;
  agentSchedMsg.value = "";
  agentSchedError.value = "";
  try {
    const keys = weekDays.value.map((d) => d.dateKey);
    const res = await autoSchedule(keys);
    if (res?.configured === false) {
      agentSchedError.value = res.text || "The scheduler isn't configured.";
      return;
    }
    agentSchedMsg.value = `Scheduled ${res.scheduled} activit${res.scheduled === 1 ? "y" : "ies"} across this week. Adjust anything by dragging or removing.`;
    setTimeout(() => (agentSchedMsg.value = ""), 6000);
  } catch (e) {
    agentSchedError.value = e?.message || "Failed to schedule.";
  } finally {
    agentScheduling.value = false;
  }
}

// ─── Guardian availability ───────────────────────────────────────────────────
const WEEKDAYS = [["mon", "Mon"], ["tue", "Tue"], ["wed", "Wed"], ["thu", "Thu"], ["fri", "Fri"], ["sat", "Sat"], ["sun", "Sun"]];
const availOpen = ref(false);
const availDrafts = ref({});   // { [guardianId]: { mon: {enabled,start,end}, ... } }
const availSaving = ref({});
const availSavedId = ref("");

function emptyDay() { return { enabled: false, start: "09:00", end: "12:00" }; }
function toDraft(av) {
  const d = {};
  for (const [k] of WEEKDAYS) {
    const r = Array.isArray(av?.[k]) && av[k][0] ? av[k][0] : null;
    d[k] = r ? { enabled: true, start: r.start || "09:00", end: r.end || "12:00" } : emptyDay();
  }
  return d;
}
function fromDraft(draft) {
  const av = {};
  for (const [k] of WEEKDAYS) av[k] = draft[k]?.enabled ? [{ start: draft[k].start, end: draft[k].end }] : [];
  return av;
}
function openAvailability() {
  availDrafts.value = {};
  for (const g of profilesStore.guardians) availDrafts.value[g.id] = toDraft(g.availability);
  availOpen.value = true;
}
async function saveAvailability(g) {
  availSaving.value = { ...availSaving.value, [g.id]: true };
  try {
    await updateGuardian(auth.familyId, g.id, { availability: fromDraft(availDrafts.value[g.id]) });
    availSavedId.value = g.id;
    setTimeout(() => { if (availSavedId.value === g.id) availSavedId.value = ""; }, 2000);
  } catch (e) {
    alert(e?.message || "Failed to save availability.");
  } finally {
    availSaving.value = { ...availSaving.value, [g.id]: false };
  }
}

// ─── Display helpers ─────────────────────────────────────────────────────────
const TYPE_ICONS = {
  quran: "📖", noorani_qaida: "🔤", story_reading: "📚", mathematics: "🔢",
  computer: "💻", ai_robotics: "🤖", physical: "🏃", teaching: "📝",
};
const RANK_LABELS = { 1: "Intro", 2: "Basic", 3: "Mid", 4: "Adv", 5: "Master" };
</script>

<template>
  <div class="planner">
    <!-- Header + week nav -->
    <div class="planner-header">
      <h1>Activity Planner</h1>
      <div class="week-nav">
        <button class="nav-btn" @click="prevWeek" aria-label="Previous week">‹ Prev</button>
        <span class="week-label">{{ weekLabel }}</span>
        <button class="nav-btn" @click="goToday">Today</button>
        <button class="nav-btn" @click="nextWeek" aria-label="Next week">Next ›</button>
      </div>
      <div class="planner-actions">
        <button class="nav-btn" @click="openAvailability">🗓 Availability</button>
        <button class="nav-btn primary" :disabled="agentScheduling" @click="scheduleViaAgent">
          {{ agentScheduling ? "Scheduling…" : "✨ Schedule via agent" }}
        </button>
      </div>
    </div>

    <!-- Agent scheduling status -->
    <div v-if="agentSchedMsg || agentSchedError" class="sched-status" :class="{ err: agentSchedError }">
      {{ agentSchedError || agentSchedMsg }}
    </div>

    <div class="planner-body">
      <!-- Activity pool (left panel) -->
      <aside class="pool">
        <h2 class="pool-title">Activity Pool</h2>
        <p v-if="!activityStore.activities.length" class="pool-empty">
          No activities yet —
          <router-link to="/syllabus">generate a syllabus first</router-link>.
        </p>
        <template v-else>
          <div v-for="group in activityStore.bySubject" :key="group.subjectId" class="pool-group">
            <h3 class="pool-group-title">{{ group.subject }}</h3>
            <div
              v-for="a in group.items"
              :key="a.id"
              class="pool-card"
              draggable="true"
              @dragstart="onDragStart(a)"
              @dragend="onDragEnd"
              :class="{ 'is-dragging': dragging?.id === a.id }"
            >
              <div class="pool-card-top">
                <span class="type-icon">{{ TYPE_ICONS[a.type] || "📝" }}</span>
                <span :class="`rank-badge rank-${a.complexityRank}`">{{ RANK_LABELS[a.complexityRank] }}</span>
                <span v-if="a.coopMode" class="coop-badge">Co-op</span>
              </div>
              <p class="pool-card-title">{{ a.title }}</p>
              <p class="pool-card-meta">{{ a.durationMinutes }} min</p>
              <button
                class="schedule-btn"
                @click="openModal(a)"
                :aria-label="`Schedule ${a.title}`"
              >+ Schedule</button>
            </div>
          </div>
        </template>
      </aside>

      <!-- Week grid (right panel) -->
      <div class="week-grid">
        <div
          v-for="day in weekDays"
          :key="day.dateKey"
          class="day-col"
          :class="{ 'drag-over': dragOverKey === day.dateKey }"
          @dragover.prevent="onDragOver(day.dateKey)"
          @dragleave.self="onDragLeave"
          @drop.prevent="onDrop(day.dateKey)"
        >
          <div class="day-header">{{ day.label }}</div>
          <div class="day-blocks">
            <div
              v-for="block in plannerStore.dayBlocks[day.dateKey] || []"
              :key="block.id"
              class="block-card"
            >
              <div class="block-top">
                <span class="type-icon sm">{{ TYPE_ICONS[block.type] || "📝" }}</span>
                <span class="block-time">{{ block.scheduledTime }}</span>
                <button
                  class="remove-btn"
                  @click="doRemove(day.dateKey, block.id)"
                  aria-label="Remove block"
                >×</button>
              </div>
              <p class="block-title">{{ block.activityTitle }}</p>
              <div class="block-footer">
                <span :class="`rank-badge rank-${block.complexityRank}`">
                  {{ RANK_LABELS[block.complexityRank] }}
                </span>
                <router-link
                  :to="`/activity/${block.activityId}?blockId=${block.id}&dateKey=${day.dateKey}`"
                  class="view-link"
                >Run →</router-link>
              </div>
            </div>
            <div
              v-if="!(plannerStore.dayBlocks[day.dateKey]?.length)"
              class="drop-hint"
            >
              Drop here
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Schedule modal -->
    <teleport to="body">
      <div v-if="modal" class="modal-backdrop" @click.self="closeModal">
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <h2 id="modal-title" class="modal-h">Schedule Activity</h2>
          <p class="modal-activity">{{ modal.title }}</p>
          <label class="modal-label">
            Day
            <select v-model="modalDate" class="modal-select">
              <option v-for="day in weekDays" :key="day.dateKey" :value="day.dateKey">
                {{ day.label }}
              </option>
            </select>
          </label>
          <label class="modal-label">
            Time
            <input type="time" v-model="modalTime" class="modal-input" />
          </label>
          <p v-if="schedError" class="modal-error" role="alert">{{ schedError }}</p>
          <div class="modal-actions">
            <button class="btn secondary" @click="closeModal">Cancel</button>
            <button class="btn primary" :disabled="scheduling" @click="confirmSchedule">
              {{ scheduling ? "Scheduling…" : "Schedule" }}
            </button>
          </div>
        </div>
      </div>
    </teleport>

    <!-- Guardian availability modal -->
    <teleport to="body">
      <div v-if="availOpen" class="modal-backdrop" @click.self="availOpen = false">
        <div class="modal avail-modal" role="dialog" aria-modal="true" aria-labelledby="avail-title">
          <h2 id="avail-title" class="modal-h">Guardian availability</h2>
          <p class="avail-intro">
            Set when each guardian can guide activities. The “Schedule via agent” planner uses this.
          </p>

          <p v-if="!profilesStore.guardians.length" class="muted">
            No guardians yet — add them in <router-link to="/guardians">Guardians</router-link>.
          </p>

          <div v-for="g in profilesStore.guardians" :key="g.id" class="avail-guardian">
            <div class="avail-g-head">
              <strong>{{ g.name || "Guardian" }}</strong>
              <button class="btn primary sm" :disabled="availSaving[g.id]" @click="saveAvailability(g)">
                {{ availSaving[g.id] ? "Saving…" : (availSavedId === g.id ? "Saved ✓" : "Save") }}
              </button>
            </div>
            <div v-if="availDrafts[g.id]" class="avail-grid">
              <div v-for="[key, label] in WEEKDAYS" :key="key" class="avail-row">
                <label class="avail-day">
                  <input type="checkbox" v-model="availDrafts[g.id][key].enabled" />
                  <span>{{ label }}</span>
                </label>
                <template v-if="availDrafts[g.id][key].enabled">
                  <input type="time" v-model="availDrafts[g.id][key].start" class="avail-time" />
                  <span class="avail-dash">–</span>
                  <input type="time" v-model="availDrafts[g.id][key].end" class="avail-time" />
                </template>
                <span v-else class="avail-off">unavailable</span>
              </div>
            </div>
          </div>

          <div class="modal-actions">
            <button class="btn secondary" @click="availOpen = false">Close</button>
          </div>
        </div>
      </div>
    </teleport>
  </div>
</template>

<style scoped>
/* ─── Layout ─────────────────────────────────────────────────────────────── */
.planner { display: flex; flex-direction: column; height: calc(100vh - 60px); overflow: hidden; }

.planner-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0.75rem 1rem; border-bottom: 1px solid #e2e8f0; flex-shrink: 0;
}
.planner-header h1 { margin: 0; font-size: 1.1rem; }

.week-nav { display: flex; align-items: center; gap: 0.5rem; }
.week-label { font-size: 0.9rem; color: #475569; min-width: 180px; text-align: center; }
.nav-btn {
  padding: 0.35rem 0.75rem; border: 1px solid #cbd5e1; border-radius: 6px;
  background: #fff; cursor: pointer; font-size: 0.85rem; color: #334155;
}
.nav-btn:hover { background: #f1f5f9; }
.nav-btn.primary { background: #0b1f3a; color: #fff; border-color: #0b1f3a; }
.nav-btn.primary:disabled { opacity: 0.6; cursor: not-allowed; }
.nav-btn.primary:hover { background: #13294d; }

.planner-actions { display: flex; align-items: center; gap: 0.5rem; }

.sched-status {
  padding: 0.5rem 1rem; font-size: 0.85rem; color: #15803d; background: #f0fdf4;
  border-bottom: 1px solid #dcfce7; flex-shrink: 0;
}
.sched-status.err { color: #b91c1c; background: #fef2f2; border-color: #fee2e2; }

.planner-body {
  display: flex; flex: 1; overflow: hidden;
}

/* Availability modal */
.avail-modal { width: 460px; max-width: 94vw; max-height: 86vh; overflow-y: auto; }
.avail-intro { margin: 0; font-size: 0.82rem; color: #64748b; }
.avail-guardian { border: 1px solid #e2e8f0; border-radius: 10px; padding: 0.75rem 0.9rem; }
.avail-g-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem; }
.avail-grid { display: flex; flex-direction: column; gap: 0.35rem; }
.avail-row { display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; }
.avail-day { display: flex; align-items: center; gap: 0.4rem; width: 70px; cursor: pointer; }
.avail-time { padding: 0.2rem 0.4rem; border: 1px solid #cbd5e1; border-radius: 6px; font: inherit; font-size: 0.82rem; }
.avail-dash { color: #94a3b8; }
.avail-off { color: #cbd5e1; font-style: italic; }
.btn.sm { padding: 0.25rem 0.7rem; font-size: 0.8rem; }
.muted { color: #64748b; font-size: 0.85rem; }

/* ─── Activity pool ──────────────────────────────────────────────────────── */
.pool {
  width: 230px; flex-shrink: 0; overflow-y: auto;
  border-right: 1px solid #e2e8f0; padding: 0.75rem;
}
.pool-title { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: #94a3b8; margin: 0 0 0.75rem; }
.pool-empty { font-size: 0.85rem; color: #94a3b8; }
.pool-empty a { color: #0b1f3a; }

.pool-group { margin-bottom: 1rem; }
.pool-group-title {
  font-size: 0.75rem; font-weight: 600; color: #64748b; text-transform: uppercase;
  letter-spacing: 0.04em; margin: 0 0 0.4rem; padding-bottom: 0.25rem;
  border-bottom: 1px solid #f1f5f9;
}

.pool-card {
  background: #fff; border: 1px solid #e2e8f0; border-radius: 8px;
  padding: 0.5rem; margin-bottom: 0.4rem; cursor: grab;
  transition: box-shadow 0.15s;
}
.pool-card:hover { box-shadow: 0 2px 8px rgba(0,0,0,.08); }
.pool-card.is-dragging { opacity: 0.4; }

.pool-card-top { display: flex; align-items: center; gap: 0.3rem; margin-bottom: 0.3rem; }
.type-icon { font-size: 0.95rem; }
.type-icon.sm { font-size: 0.8rem; }
.pool-card-title { font-size: 0.82rem; font-weight: 600; margin: 0 0 0.2rem; line-height: 1.3; color: #1e293b; }
.pool-card-meta { font-size: 0.72rem; color: #94a3b8; margin: 0 0 0.4rem; }

.schedule-btn {
  width: 100%; padding: 0.25rem; font-size: 0.75rem; border: 1px solid #cbd5e1;
  border-radius: 5px; background: #f8fafc; cursor: pointer; color: #475569;
}
.schedule-btn:hover { background: #f1f5f9; }

/* ─── Rank badges ────────────────────────────────────────────────────────── */
.rank-badge {
  font-size: 0.62rem; font-weight: 700; padding: 0.1rem 0.35rem;
  border-radius: 999px; background: #e2e8f0; color: #475569;
}
.rank-1 { background: #dcfce7; color: #166534; }
.rank-2 { background: #dbeafe; color: #1e40af; }
.rank-3 { background: #fef9c3; color: #854d0e; }
.rank-4 { background: #fed7aa; color: #9a3412; }
.rank-5 { background: #f3e8ff; color: #6b21a8; }
.coop-badge { font-size: 0.62rem; padding: 0.1rem 0.35rem; border-radius: 999px; background: #e0f2fe; color: #0369a1; }

/* ─── Week grid ──────────────────────────────────────────────────────────── */
.week-grid {
  flex: 1; display: flex; overflow-x: auto;
  gap: 0; /* columns touch */
}

.day-col {
  flex: 1; min-width: 110px; display: flex; flex-direction: column;
  border-right: 1px solid #e2e8f0;
  transition: background 0.1s;
}
.day-col:last-child { border-right: none; }
.day-col.drag-over { background: #eff6ff; }

.day-header {
  font-size: 0.78rem; font-weight: 600; color: #64748b;
  padding: 0.4rem 0.5rem; border-bottom: 1px solid #e2e8f0;
  background: #f8fafc; text-align: center; flex-shrink: 0;
}

.day-blocks {
  flex: 1; overflow-y: auto; padding: 0.4rem; display: flex; flex-direction: column; gap: 0.3rem;
}

.drop-hint {
  flex: 1; min-height: 60px; border: 1.5px dashed #cbd5e1; border-radius: 6px;
  display: flex; align-items: center; justify-content: center;
  font-size: 0.72rem; color: #cbd5e1;
}

.block-card {
  background: #fff; border: 1px solid #e2e8f0; border-radius: 7px;
  padding: 0.4rem 0.5rem; font-size: 0.78rem;
}
.block-top { display: flex; align-items: center; gap: 0.25rem; margin-bottom: 0.2rem; }
.block-time { font-size: 0.7rem; color: #94a3b8; flex: 1; }
.block-title { margin: 0 0 0.25rem; font-weight: 600; color: #1e293b; line-height: 1.3; }
.remove-btn {
  background: none; border: none; cursor: pointer; color: #94a3b8;
  font-size: 0.9rem; line-height: 1; padding: 0 0.1rem;
}
.remove-btn:hover { color: #ef4444; }
.block-footer { display: flex; align-items: center; justify-content: space-between; margin-top: 0.2rem; }
.view-link { font-size: 0.68rem; color: #0b1f3a; text-decoration: none; }
.view-link:hover { text-decoration: underline; }

/* ─── Modal ──────────────────────────────────────────────────────────────── */
.modal-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,0.4);
  display: flex; align-items: center; justify-content: center; z-index: 100;
}
.modal {
  background: #fff; border-radius: 12px; padding: 1.5rem; width: 320px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.15); display: flex; flex-direction: column; gap: 0.75rem;
}
.modal-h { margin: 0; font-size: 1rem; }
.modal-activity { margin: 0; font-weight: 600; color: #1e293b; font-size: 0.9rem; }
.modal-label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.85rem; color: #475569; }
.modal-select, .modal-input {
  padding: 0.4rem 0.6rem; border: 1px solid #cbd5e1; border-radius: 6px;
  font: inherit; background: #fff;
}
.modal-error { color: #b91c1c; font-size: 0.82rem; margin: 0; }
.modal-actions { display: flex; gap: 0.5rem; justify-content: flex-end; }
.btn { padding: 0.5rem 1rem; border-radius: 7px; border: none; cursor: pointer; font: inherit; }
.btn.primary { background: #0b1f3a; color: #fff; }
.btn.secondary { background: #f1f5f9; color: #334155; border: 1px solid #cbd5e1; }
.btn:disabled { opacity: 0.6; cursor: not-allowed; }
</style>
