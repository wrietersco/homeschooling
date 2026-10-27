<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from "vue";
import { useAuthStore } from "@/stores/auth";
import { useActivityStore } from "@/stores/activities";
import { usePlannerStore } from "@/stores/planner";
import { useProfilesStore } from "@/stores/profiles";
import { addBlock, removeBlock, clearBlocks, moveBlock } from "@/services/planner";
import { updateGuardian } from "@/services/profiles";
import { autoSchedule } from "@/services/scheduler";
import { usePointerDrag } from "@/composables/usePointerDrag";
import { HOURS, hourLabel, dayPeriod, hourOf, withHour, bucketByHour, firstBusyHour } from "@/lib/plannerGrid";
import ActivityArt from "@/components/planner/ActivityArt.vue";
import SkyArt from "@/components/planner/SkyArt.vue";
import ActivityPreview from "@/components/planner/ActivityPreview.vue";
import ChildAvatar from "@/components/ChildAvatar.vue";

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

const todayKey = ref(formatDate(new Date()));
const nowHour = ref(new Date().getHours());
const clock = setInterval(() => {
  todayKey.value = formatDate(new Date());
  nowHour.value = new Date().getHours();
}, 60_000);
onUnmounted(() => clearInterval(clock));

// ─── Week state ──────────────────────────────────────────────────────────────
const weekStart = ref(startOfWeek(new Date()));

const weekDays = computed(() =>
  Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart.value, i);
    const dow = date.getDay();
    const name = DAY_NAMES[dow === 0 ? 6 : dow - 1];
    return { date, dateKey: formatDate(date), name, num: date.getDate(), label: `${name} ${date.getDate()}` };
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

// ─── Phone vs. wide screen ───────────────────────────────────────────────────
// On a phone the matrix shows one day at a time (day bubbles on top switch it,
// and a card dropped on a bubble moves to that day). Wider screens see the week.
const mq = typeof window !== "undefined" ? window.matchMedia("(max-width: 760px)") : null;
const isPhone = ref(Boolean(mq?.matches));
const onMq = (e) => { isPhone.value = e.matches; };
mq?.addEventListener("change", onMq);
onUnmounted(() => mq?.removeEventListener("change", onMq));

const selectedDayKey = ref("");
watch(weekDays, (days) => {
  if (!days.some((d) => d.dateKey === selectedDayKey.value)) {
    selectedDayKey.value = days.some((d) => d.dateKey === todayKey.value) ? todayKey.value : days[0].dateKey;
  }
}, { immediate: true });

const visibleDays = computed(() =>
  isPhone.value ? weekDays.value.filter((d) => d.dateKey === selectedDayKey.value) : weekDays.value
);

const dayLabelFor = (key) => {
  const d = weekDays.value.find((x) => x.dateKey === key);
  return d ? `${d.name} ${d.num}` : key;
};

// ─── Matrix data ─────────────────────────────────────────────────────────────
const buckets = computed(() => {
  const out = {};
  for (const d of weekDays.value) out[d.dateKey] = bucketByHour(plannerStore.dayBlocks[d.dateKey]);
  return out;
});
const busyHours = computed(() => {
  const s = new Set();
  for (const d of visibleDays.value) for (const h of Object.keys(buckets.value[d.dateKey] || {})) s.add(Number(h));
  return s;
});
const dayCount = (key) => plannerStore.dayBlocks[key]?.length || 0;

// Open the grid scrolled to the morning (or the earliest planned hour).
const scrollEl = ref(null);
const hourRowRefs = {};
async function scrollToHour(h) {
  await nextTick();
  const row = hourRowRefs[h];
  const el = scrollEl.value;
  if (!row || !el) return;
  const head = el.querySelector(".day-head");
  const headH = head && getComputedStyle(head).display !== "none" ? head.offsetHeight : 0;
  el.scrollTop += row.getBoundingClientRect().top - el.getBoundingClientRect().top - headH;
}
// Each day's blocks arrive on their own, so keep re-aiming for a moment after
// the week loads; after that the parent's own scrolling wins.
let autoScrollUntil = 0;
watch(weekStart, () => { autoScrollUntil = Date.now() + 2500; }, { immediate: true });
watch(() => plannerStore.dayBlocks, (blocks) => {
  if (Date.now() < autoScrollUntil) scrollToHour(firstBusyHour(blocks));
}, { deep: true });

// Keep the page exactly one screen tall under the sticky nav (it can wrap on phones).
const navH = ref(60);
let navObs = null;
onMounted(() => {
  const nav = document.querySelector("header.nav");
  if (nav && "ResizeObserver" in window) {
    navObs = new ResizeObserver(() => { navH.value = nav.offsetHeight; });
    navObs.observe(nav);
  }
  scrollToHour(firstBusyHour(plannerStore.dayBlocks));
});
onUnmounted(() => navObs?.disconnect());

// ─── Colours per activity type (the games' tile palette) ─────────────────────
const TINTS = {
  quran: { bg: "#DDF8E8", deep: "#1E9E5C" },
  noorani_qaida: { bg: "#D9F7F2", deep: "#149485" },
  arabic_reading: { bg: "#DDF8E8", deep: "#1E9E5C" },
  urdu_reading: { bg: "#FFEBD3", deep: "#C96F1E" },
  english_reading: { bg: "#DBF3FF", deep: "#1D7FBE" },
  story_reading: { bg: "#EEE3FF", deep: "#7B3FD1" },
  conversation: { bg: "#FFE3EC", deep: "#D6457C" },
  mathematics: { bg: "#FFF8C9", deep: "#A98608" },
  computer: { bg: "#DBF3FF", deep: "#1D7FBE" },
  ai_robotics: { bg: "#FFE6DC", deep: "#D1502A" },
  physical: { bg: "#FFE6DC", deep: "#D1502A" },
  teaching: { bg: "#EEE3FF", deep: "#7B3FD1" },
};
const tintOf = (type) => TINTS[type] || TINTS.teaching;
const tintStyle = (type) => ({ "--bg": tintOf(type).bg, "--deep": tintOf(type).deep });

const TYPE_LABELS = {
  quran: "Quran", noorani_qaida: "Qaida",
  arabic_reading: "Arabic reading", urdu_reading: "Urdu reading", english_reading: "English reading",
  story_reading: "Story", conversation: "Conversation",
  mathematics: "Mathematics", computer: "Computer", ai_robotics: "AI & Robotics", physical: "Physical", teaching: "Teaching",
};

// A target id only counts if it matches a real child doc. Stale/garbage ids
// (e.g. names the syllabus model guessed before the binding fix) are ignored, so
// such an activity reads as "applies to all children" instead of vanishing.
const validChildIds = computed(() => new Set(profilesStore.children.map((c) => c.id)));
function effectiveTargets(a) {
  return (a.targetChildren || []).filter((id) => validChildIds.value.has(id));
}
// Faces on a card: the targeted children, or one "everyone" bubble.
function kidsFor(a) {
  const ids = effectiveTargets(a);
  if (!ids.length) return profilesStore.children.length > 1 ? [null] : profilesStore.children;
  return profilesStore.children.filter((c) => ids.includes(c.id));
}

// ─── Scheduling writes ───────────────────────────────────────────────────────
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

const toast = ref("");
let toastTimer = 0;
function flash(msg) {
  toast.value = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = ""), 2600);
}

// ─── Drag and drop (mouse + press-and-hold on phones) ────────────────────────
let dwellTimer = 0;
function onHover(target) {
  clearTimeout(dwellTimer);
  // Holding a card over another day's bubble on a phone opens that day, so the
  // card can then be dropped at an exact hour there.
  if (target?.key?.startsWith("pill|") && isPhone.value && target.date !== selectedDayKey.value) {
    dwellTimer = setTimeout(() => { selectedDayKey.value = target.date; }, 650);
  }
}

async function onDropped(payload, target) {
  if (!payload || !target?.date || !auth.familyId) return;
  try {
    if (payload.kind === "pool") {
      const hour = target.hour ?? 9;
      await doSchedule(payload.activity, target.date, withHour("", hour));
      flash(`Added to ${dayLabelFor(target.date)}, ${hourLabel(hour)}`);
    } else {
      const { block, dateKey } = payload;
      const hour = target.hour ?? hourOf(block.scheduledTime);
      const time = withHour(block.scheduledTime, hour);
      if (dateKey === target.date && time === block.scheduledTime) return;
      await moveBlock(auth.familyId, dateKey, target.date, block, time);
      flash(`Moved to ${dayLabelFor(target.date)}, ${hourLabel(hour)}`);
    }
  } catch (e) {
    flash(e?.message || "Couldn't move that — please try again.");
  }
}

const { drag, start: startDrag } = usePointerDrag({ onDrop: onDropped, onHover, scrollEl });

const dragTitle = computed(() => drag.payload?.activity?.title || drag.payload?.block?.activityTitle || "");
const dragType = computed(() => drag.payload?.activity?.type || drag.payload?.block?.type || "teaching");
const isDraggingBlock = (id) => drag.active && drag.payload?.block?.id === id;

// The phone's activity drawer slides away as soon as a card is picked up from
// it, so the day underneath is free to drop on.
watch(() => drag.active, (on) => {
  if (on && drag.payload?.kind === "pool" && isPhone.value) poolOpen.value = false;
});

// ─── Activity drawer ─────────────────────────────────────────────────────────
const poolOpen = ref(!isPhone.value);
const poolQuery = ref("");
const poolType = ref("");
const poolChildId = ref("");
const availableTypes = computed(() =>
  [...new Set(activityStore.activities.map((a) => a.type))].sort((a, b) => (TYPE_LABELS[a] || a).localeCompare(TYPE_LABELS[b] || b))
);

const filteredGroups = computed(() => {
  const q = poolQuery.value.trim().toLowerCase();
  const items = activityStore.activities.filter((a) => {
    if (poolType.value && a.type !== poolType.value) return false;
    if (poolChildId.value) {
      const t = effectiveTargets(a);
      // No resolvable targets = applies to all children, so it matches any filter.
      if (t.length && !t.includes(poolChildId.value)) return false;
    }
    if (q) {
      const hay = `${a.title || ""} ${a.subject || ""} ${TYPE_LABELS[a.type] || a.type}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const map = {};
  for (const a of items) {
    const key = a.subjectId || "__unknown__";
    if (!map[key]) map[key] = { subjectId: key, subject: a.subject || key, items: [] };
    map[key].items.push(a);
  }
  return Object.values(map);
});
const hasFilter = computed(() => Boolean(poolQuery.value.trim() || poolType.value || poolChildId.value));
const filteredCount = computed(() => filteredGroups.value.reduce((n, g) => n + g.items.length, 0));
function clearFilters() { poolQuery.value = ""; poolType.value = ""; poolChildId.value = ""; }

// ─── "When?" picker (tap + on an activity instead of dragging) ──────────────
const modal = ref(null);
const modalDate = ref("");
const modalHour = ref(9);
const scheduling = ref(false);
const schedError = ref("");
const PICK_HOURS = HOURS.filter((h) => h >= 5 && h <= 22);

function openModal(activity) {
  modal.value = activity;
  modalDate.value = isPhone.value ? selectedDayKey.value : (weekDays.value.find((d) => d.dateKey === todayKey.value)?.dateKey || weekDays.value[0].dateKey);
  modalHour.value = 9;
  schedError.value = "";
}
function closeModal() { modal.value = null; }

async function confirmSchedule() {
  if (!modal.value) return;
  scheduling.value = true;
  schedError.value = "";
  try {
    await doSchedule(modal.value, modalDate.value, withHour("", modalHour.value));
    flash(`Added to ${dayLabelFor(modalDate.value)}, ${hourLabel(modalHour.value)}`);
    if (isPhone.value) selectedDayKey.value = modalDate.value;
    scrollToHour(modalHour.value);
    closeModal();
  } catch (e) {
    schedError.value = e.message || "Failed to schedule.";
  } finally {
    scheduling.value = false;
  }
}

// ─── Preview (eye) ───────────────────────────────────────────────────────────
const preview = ref(null); // { activityId, block?, dateKey?, type }
function openPreview(activityId, type, block = null, dateKey = "") {
  preview.value = { activityId, type, block, dateKey };
}
async function removeFromPreview() {
  const p = preview.value;
  preview.value = null;
  if (!p?.block || !auth.familyId) return;
  await removeBlock(auth.familyId, p.dateKey, p.block.id);
  flash("Removed");
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
    agentSchedMsg.value = `Planned ${res.scheduled} activit${res.scheduled === 1 ? "y" : "ies"} this week. Hold and drag any card to move it.`;
    setTimeout(() => (agentSchedMsg.value = ""), 6000);
  } catch (e) {
    agentSchedError.value = e?.message || "Failed to schedule.";
  } finally {
    agentScheduling.value = false;
  }
}

// ─── Clear all planned items for the week ────────────────────────────────────
const weekBlockCount = computed(() =>
  weekDays.value.reduce((n, d) => n + (plannerStore.dayBlocks[d.dateKey]?.length || 0), 0)
);
const clearConfirm = ref(false);
const clearing = ref(false);

function openClearConfirm() {
  if (weekBlockCount.value) clearConfirm.value = true;
}

async function confirmClearWeek() {
  if (!auth.familyId || clearing.value) return;
  clearing.value = true;
  agentSchedError.value = "";
  try {
    const removed = await clearBlocks(auth.familyId, weekDays.value.map((d) => d.dateKey));
    clearConfirm.value = false;
    agentSchedMsg.value = `Cleared ${removed} planned item${removed === 1 ? "" : "s"} from this week.`;
    setTimeout(() => (agentSchedMsg.value = ""), 6000);
  } catch (e) {
    agentSchedError.value = e?.message || "Failed to clear the week.";
  } finally {
    clearing.value = false;
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
</script>

<template>
  <div class="planner" :class="{ phone: isPhone, dragging: drag.active }" :style="{ height: `calc(100dvh - ${navH}px)` }">
    <!-- Header: week + three big actions -->
    <header class="ph">
      <h1 class="ph-title">
        <svg viewBox="0 0 40 40" aria-hidden="true">
          <rect x="4" y="7" width="32" height="29" rx="8" fill="#fff" />
          <rect x="4" y="7" width="32" height="10" rx="6" fill="#FF8FB1" />
          <rect x="11" y="3" width="4" height="9" rx="2" fill="#7B3FD1" /><rect x="25" y="3" width="4" height="9" rx="2" fill="#7B3FD1" />
          <circle cx="14" cy="25" r="3" fill="#FFB25A" /><circle cx="26" cy="25" r="3" fill="#6FD3FF" />
        </svg>
        <span>Activity Planner</span>
      </h1>

      <div class="week-nav">
        <button class="round-btn" aria-label="Previous week" @click="prevWeek">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5 L8 12 L15 19" stroke="currentColor" stroke-width="3.2" fill="none" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </button>
        <span class="week-label">{{ weekLabel }}</span>
        <button class="round-btn" aria-label="Next week" @click="nextWeek">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5 L16 12 L9 19" stroke="currentColor" stroke-width="3.2" fill="none" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </button>
        <button class="pill-btn" @click="goToday">Today</button>
      </div>

      <div class="ph-actions">
        <button class="pill-btn gold" :disabled="agentScheduling" @click="scheduleViaAgent">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 L14 9 L21 11 L14 13 L12 20 L10 13 L3 11 L10 9 Z" fill="#fff" /><circle cx="19" cy="4" r="1.6" fill="#fff" /></svg>
          <span>{{ agentScheduling ? "Planning…" : "Plan my week" }}</span>
        </button>
        <button class="round-btn" title="When are guardians free?" aria-label="Availability" @click="openAvailability">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.4" /><path d="M12 7 V12 L15.5 14" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" /></svg>
        </button>
        <button
          class="round-btn danger"
          :disabled="!weekBlockCount"
          :title="weekBlockCount ? 'Remove everything planned this week' : 'Nothing planned this week'"
          aria-label="Clear all"
          @click="openClearConfirm"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7 H19 M9 7 V4 H15 V7 M7 7 L8 20 H16 L17 7" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </button>
      </div>
    </header>

    <div v-if="agentSchedMsg || agentSchedError" class="sched-status" :class="{ err: agentSchedError }">
      {{ agentSchedError || agentSchedMsg }}
    </div>

    <div class="pb">
      <!-- Activity drawer (side panel on wide screens, bottom sheet on phones) -->
      <aside class="pool" :class="{ open: poolOpen }" aria-label="Activities">
        <div class="pool-head">
          <h2 class="pool-title">Activities</h2>
          <button class="round-btn sm" aria-label="Hide activities" @click="poolOpen = false">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path v-if="isPhone" d="M6 9 L12 15 L18 9" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round" /><path v-else d="M15 5 L8 12 L15 19" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </button>
        </div>
        <p v-if="activityStore.activities.length" class="pool-tip">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 11 V5 a2 2 0 0 1 4 0 V11 M13 9 a2 2 0 0 1 4 0 V15 a6 6 0 0 1 -6 6 H10 a5 5 0 0 1 -4.2 -2.3 L3.5 15 a1.8 1.8 0 0 1 2.9 -2 L9 15" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" /></svg>
          {{ isPhone ? "Press, hold and drag a card onto a time" : "Drag a card onto a time" }}
        </p>

        <div class="pool-scroll">
          <p v-if="!activityStore.activities.length" class="pool-empty">
            No activities yet —
            <router-link to="/syllabus">generate a syllabus first</router-link>.
          </p>
          <template v-else>
            <div class="pool-filters">
              <input v-model="poolQuery" class="pool-search" type="search" placeholder="Search…" aria-label="Search activities" />
              <div v-if="profilesStore.children.length > 1" class="chip-row" role="group" aria-label="Filter by child">
                <button
                  v-for="c in profilesStore.children" :key="c.id" type="button"
                  class="face-chip" :class="{ on: poolChildId === c.id }" :aria-pressed="poolChildId === c.id"
                  @click="poolChildId = poolChildId === c.id ? '' : c.id"
                ><ChildAvatar :child="c" :size="30" /><span>{{ c.name }}</span></button>
              </div>
              <div v-if="availableTypes.length > 1" class="chip-row types" role="group" aria-label="Filter by activity type">
                <button
                  v-for="t in availableTypes" :key="t" type="button"
                  class="type-chip" :class="{ on: poolType === t }" :style="tintStyle(t)"
                  :title="TYPE_LABELS[t] || t" :aria-label="TYPE_LABELS[t] || t" :aria-pressed="poolType === t"
                  @click="poolType = poolType === t ? '' : t"
                ><ActivityArt :type="t" /></button>
              </div>
              <p v-if="hasFilter" class="pool-count">
                {{ filteredCount }} match{{ filteredCount === 1 ? "" : "es" }}
                <button type="button" class="linkish" @click="clearFilters">Show all</button>
              </p>
            </div>

            <p v-if="!filteredGroups.length" class="pool-empty">No activities match these filters.</p>

            <div v-for="group in filteredGroups" :key="group.subjectId" class="pool-group">
              <h3 class="pool-group-title">{{ group.subject }}</h3>
              <div
                v-for="a in group.items"
                :key="a.id"
                class="card pool-card"
                :class="{ ghosted: drag.active && drag.payload?.activity?.id === a.id }"
                :style="tintStyle(a.type)"
                @pointerdown="startDrag($event, { kind: 'pool', activity: a })"
                @contextmenu.prevent
              >
                <span class="card-art"><ActivityArt :type="a.type" /></span>
                <span class="card-main">
                  <span class="card-title">{{ a.title }}</span>
                  <span class="card-kids"><ChildAvatar v-for="(c, i) in kidsFor(a)" :key="c?.id || i" :child="c" :size="22" /></span>
                </span>
                <span class="card-btns">
                  <button class="eye-btn" type="button" :aria-label="`Preview ${a.title}`" @click="openPreview(a.id, a.type)">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12 Q12 3 22 12 Q12 21 2 12 Z" fill="#fff" stroke="currentColor" stroke-width="2" /><circle cx="12" cy="12" r="3.6" fill="currentColor" /></svg>
                  </button>
                  <button class="add-btn" type="button" :aria-label="`Schedule ${a.title}`" @click="openModal(a)">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5 V19 M5 12 H19" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" /></svg>
                  </button>
                </span>
              </div>
            </div>
          </template>
        </div>
      </aside>

      <!-- The matrix: hours down the side, days across the top -->
      <section class="board">
        <!-- Phone: day bubbles (tap to switch; drop a card on one to move it there) -->
        <div v-if="isPhone" class="day-pills">
          <button
            v-for="d in weekDays" :key="d.dateKey" type="button"
            class="day-pill"
            :class="{ on: d.dateKey === selectedDayKey, today: d.dateKey === todayKey, over: drag.overKey === `pill|${d.dateKey}` }"
            :data-drop="`pill|${d.dateKey}`" :data-date="d.dateKey" data-hour=""
            @click="selectedDayKey = d.dateKey"
          >
            <span class="dp-name">{{ d.name }}</span>
            <span class="dp-num">{{ d.num }}</span>
            <span v-if="dayCount(d.dateKey)" class="dp-dot">{{ dayCount(d.dateKey) }}</span>
          </button>
        </div>

        <div ref="scrollEl" class="grid-scroll">
          <div class="grid" :style="{ gridTemplateColumns: `var(--time-col) repeat(${visibleDays.length}, minmax(${isPhone ? 0 : 128}px, 1fr))` }">
            <!-- Header row -->
            <div class="corner"></div>
            <div
              v-for="d in visibleDays" :key="`h-${d.dateKey}`"
              class="day-head" :class="{ today: d.dateKey === todayKey }"
            >
              <span class="dh-name">{{ d.name }}</span>
              <span class="dh-num">{{ d.num }}</span>
              <span v-if="d.dateKey === todayKey" class="dh-today">Today</span>
            </div>

            <!-- One row per hour -->
            <template v-for="h in HOURS" :key="h">
              <div
                :ref="(el) => { if (el) hourRowRefs[h] = el; }"
                class="time-cell" :class="[dayPeriod(h), { quiet: !busyHours.has(h) && dayPeriod(h) === 'night' }]"
              >
                <span class="tc-sky"><SkyArt :period="dayPeriod(h)" /></span>
                <span class="tc-label">{{ hourLabel(h) }}</span>
              </div>
              <div
                v-for="d in visibleDays" :key="`${d.dateKey}-${h}`"
                class="cell"
                :class="[dayPeriod(h), {
                  quiet: !busyHours.has(h) && dayPeriod(h) === 'night',
                  over: drag.overKey === `${d.dateKey}|${h}`,
                  now: d.dateKey === todayKey && h === nowHour,
                  todaycol: d.dateKey === todayKey,
                }]"
                :data-drop="`${d.dateKey}|${h}`" :data-date="d.dateKey" :data-hour="h"
              >
                <div
                  v-for="b in buckets[d.dateKey]?.[h] || []"
                  :key="b.id"
                  class="card block-card"
                  :class="{ ghosted: isDraggingBlock(b.id), done: b.status === 'done' }"
                  :style="tintStyle(b.type)"
                  @pointerdown="startDrag($event, { kind: 'block', block: b, dateKey: d.dateKey })"
                  @contextmenu.prevent
                >
                  <span class="card-art"><ActivityArt :type="b.type" /></span>
                  <span class="card-title">{{ b.activityTitle }}</span>
                  <span class="card-foot">
                    <span class="card-kids"><ChildAvatar v-for="(c, i) in kidsFor(b)" :key="c?.id || i" :child="c" :size="24" /></span>
                    <button class="eye-btn" type="button" :aria-label="`Preview ${b.activityTitle}`" @click="openPreview(b.activityId, b.type, b, d.dateKey)">
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12 Q12 3 22 12 Q12 21 2 12 Z" fill="#fff" stroke="currentColor" stroke-width="2" /><circle cx="12" cy="12" r="3.6" fill="currentColor" /></svg>
                    </button>
                  </span>
                  <span v-if="b.status === 'done'" class="done-badge" title="Done">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#3DDC97" /><path d="M7 12.5 L10.5 16 L17 9" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round" /></svg>
                  </span>
                </div>
                <span v-if="drag.overKey === `${d.dateKey}|${h}`" class="drop-bubble">{{ hourLabel(h) }}</span>
              </div>
            </template>
          </div>
        </div>

        <!-- Open the drawer again -->
        <button v-if="!poolOpen" class="fab" type="button" @click="poolOpen = true">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5 V19 M5 12 H19" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" /></svg>
          <span>Add activity</span>
        </button>
      </section>
    </div>

    <!-- The card under the finger while dragging -->
    <teleport to="body">
      <div
        v-if="drag.active" class="drag-ghost" :style="{ left: `${drag.x}px`, top: `${drag.y}px`, ...tintStyle(dragType) }"
        aria-hidden="true"
      >
        <span class="card-art"><ActivityArt :type="dragType" /></span>
        <span class="card-title">{{ dragTitle }}</span>
      </div>
    </teleport>

    <div v-if="toast" class="toast" role="status">{{ toast }}</div>

    <!-- Preview -->
    <ActivityPreview
      v-if="preview"
      :activity-id="preview.activityId"
      :block="preview.block"
      :date-key="preview.dateKey"
      :day-text="preview.block ? `${dayLabelFor(preview.dateKey)} · ${hourLabel(hourOf(preview.block.scheduledTime))}` : ''"
      :tint="tintOf(preview.type)"
      @close="preview = null"
      @remove="removeFromPreview"
    />

    <!-- When? picker -->
    <teleport to="body">
      <div v-if="modal" class="modal-backdrop" @click.self="closeModal">
        <div class="modal when" role="dialog" aria-modal="true" aria-labelledby="modal-title" :style="tintStyle(modal.type)">
          <div class="when-head">
            <span class="card-art lg"><ActivityArt :type="modal.type" /></span>
            <div>
              <h2 id="modal-title" class="modal-h">When?</h2>
              <p class="modal-activity">{{ modal.title }}</p>
            </div>
          </div>
          <div class="when-days" role="radiogroup" aria-label="Day">
            <button
              v-for="d in weekDays" :key="d.dateKey" type="button" role="radio"
              class="day-pill" :class="{ on: modalDate === d.dateKey, today: d.dateKey === todayKey }"
              :aria-checked="modalDate === d.dateKey" @click="modalDate = d.dateKey"
            ><span class="dp-name">{{ d.name }}</span><span class="dp-num">{{ d.num }}</span></button>
          </div>
          <div class="when-hours" role="radiogroup" aria-label="Time">
            <button
              v-for="h in PICK_HOURS" :key="h" type="button" role="radio"
              class="hour-chip" :class="[dayPeriod(h), { on: modalHour === h }]"
              :aria-checked="modalHour === h" @click="modalHour = h"
            ><span class="hc-sky"><SkyArt :period="dayPeriod(h)" /></span>{{ hourLabel(h) }}</button>
          </div>
          <p v-if="schedError" class="modal-error" role="alert">{{ schedError }}</p>
          <div class="modal-actions">
            <button class="btn secondary" @click="closeModal">Cancel</button>
            <button class="btn primary" :disabled="scheduling" @click="confirmSchedule">
              {{ scheduling ? "Adding…" : "Add" }}
            </button>
          </div>
        </div>
      </div>
    </teleport>

    <!-- Clear-all confirmation modal -->
    <teleport to="body">
      <div v-if="clearConfirm" class="modal-backdrop" @click.self="clearConfirm = false">
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="clear-title">
          <h2 id="clear-title" class="modal-h">Clear this week?</h2>
          <p class="modal-activity">
            This removes all {{ weekBlockCount }} planned item{{ weekBlockCount === 1 ? "" : "s" }}
            for {{ weekLabel }}. This can’t be undone.
          </p>
          <div class="modal-actions">
            <button class="btn secondary" :disabled="clearing" @click="clearConfirm = false">Cancel</button>
            <button class="btn danger" :disabled="clearing" @click="confirmClearWeek">
              {{ clearing ? "Clearing…" : "Clear all" }}
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
            Set when each guardian can guide activities. “Plan my week” uses this.
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
.planner {
  --ink: #3a2b52;
  --time-col: 92px;
  display: flex; flex-direction: column; overflow: hidden;
  background: linear-gradient(180deg, #b7e7ff 0%, #e6dcff 100%);
  font-family: "Baloo 2", system-ui, -apple-system, "Segoe UI", sans-serif;
  color: var(--ink);
}
.planner.dragging { cursor: grabbing; }

.ph {
  display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
  padding: 10px 16px; flex-shrink: 0;
}
.ph-title { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 1.35rem; font-weight: 800; }
.ph-title svg { width: 36px; height: 36px; filter: drop-shadow(0 3px 0 rgba(58, 43, 82, 0.18)); }
.week-nav { display: flex; align-items: center; gap: 8px; }
.week-label {
  min-width: 190px; text-align: center; font-weight: 800; font-size: 1.05rem;
  padding: 6px 14px; border-radius: 999px; background: rgba(255, 255, 255, 0.75);
}
.ph-actions { display: flex; align-items: center; gap: 8px; }

/* Chunky game buttons */
.round-btn, .pill-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  border: none; cursor: pointer; font: inherit; font-weight: 800; color: var(--ink); background: #fff;
  box-shadow: inset 0 -3px 0 rgba(58, 43, 82, 0.12), 0 3px 0 rgba(58, 43, 82, 0.2);
  transition: transform 0.1s;
}
.round-btn { width: 44px; height: 44px; border-radius: 50%; }
.round-btn.sm { width: 36px; height: 36px; }
.round-btn svg { width: 22px; height: 22px; }
.pill-btn { height: 44px; padding: 0 18px; border-radius: 999px; font-size: 1rem; }
.pill-btn svg { width: 20px; height: 20px; }
.round-btn:active, .pill-btn:active { transform: translateY(2px); }
.pill-btn.gold {
  color: #fff; background: radial-gradient(circle at 32% 28%, #e3b6ff, #9b6bff 55%, #7b3fd1);
  box-shadow: inset 0 -4px 0 #5a2aa3, 0 4px 0 rgba(58, 43, 82, 0.25);
}
.round-btn.danger { color: #d6457c; }
.round-btn:disabled, .pill-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.sched-status {
  margin: 0 16px 8px; padding: 8px 14px; border-radius: 14px; font-weight: 700;
  color: #1e7a4c; background: #e3fbef; flex-shrink: 0;
}
.sched-status.err { color: #b0365e; background: #ffe3ec; }

.pb { display: flex; flex: 1; min-height: 0; position: relative; }

/* ─── Activity drawer ────────────────────────────────────────────────────── */
.pool {
  width: 300px; flex-shrink: 0; display: none; flex-direction: column; min-height: 0;
  margin: 0 0 12px 12px; background: rgba(255, 255, 255, 0.88); border-radius: 22px;
  box-shadow: 0 4px 0 rgba(58, 43, 82, 0.12);
}
.pool.open { display: flex; }
.pool-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 12px 0 16px; }
.pool-title { margin: 0; font-size: 1.15rem; font-weight: 800; }
.pool-tip { display: flex; align-items: center; gap: 6px; margin: 4px 16px 6px; font-size: 0.9rem; font-weight: 600; color: #6b5f86; }
.pool-tip svg { width: 20px; height: 20px; flex-shrink: 0; }
.pool-scroll { flex: 1; overflow-y: auto; padding: 4px 12px 16px; }
.pool-empty { color: #6b5f86; font-weight: 600; }
.pool-filters { display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px; }
.pool-search {
  width: 100%; padding: 8px 14px; border: 2px solid #ece6fa; border-radius: 999px;
  font: inherit; font-size: 0.95rem; background: #fff;
}
.chip-row { display: flex; flex-wrap: wrap; gap: 6px; }
.face-chip {
  display: inline-flex; align-items: center; gap: 4px; padding: 2px 10px 2px 2px; flex-shrink: 0;
  border: 2px solid transparent; border-radius: 999px; background: #fff; cursor: pointer; font: inherit; font-weight: 700; color: var(--ink);
}
.face-chip.on { border-color: #7b3fd1; background: #f3e8ff; }
.type-chip {
  width: 40px; height: 40px; padding: 5px; flex-shrink: 0; border-radius: 12px; cursor: pointer;
  border: 2px solid transparent; background: var(--bg);
}
.type-chip.on { border-color: var(--deep); }
.pool-count { margin: 0; font-size: 0.85rem; color: #6b5f86; display: flex; gap: 8px; align-items: center; }
.linkish { background: none; border: none; padding: 0; font: inherit; font-weight: 700; color: #7b3fd1; cursor: pointer; }
.pool-group { margin-bottom: 12px; }
.pool-group-title { margin: 6px 4px; font-size: 0.85rem; font-weight: 800; color: #8b80a3; text-transform: uppercase; letter-spacing: 0.04em; }

/* ─── Cards ──────────────────────────────────────────────────────────────── */
.card {
  position: relative; display: flex; align-items: center; gap: 8px;
  padding: 6px 6px 6px 6px; border-radius: 16px; background: var(--bg);
  box-shadow: inset 0 -3px 0 color-mix(in srgb, var(--deep) 35%, transparent), 0 2px 0 rgba(58, 43, 82, 0.12);
  cursor: grab; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;
  touch-action: manipulation;
}
.card.ghosted { opacity: 0.35; }
.pool-card { margin-bottom: 8px; }
.card-art {
  width: 40px; height: 40px; flex-shrink: 0; padding: 4px; border-radius: 12px; background: #fff;
  pointer-events: none;
}
.card-art.lg { width: 60px; height: 60px; border-radius: 18px; }
.card-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.card-title {
  font-weight: 700; font-size: 0.95rem; line-height: 1.2; color: var(--ink);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.card-kids { display: flex; }
.card-kids > * + * { margin-left: -5px; }
.card-btns { display: flex; flex-direction: column; gap: 4px; }
.eye-btn, .add-btn {
  width: 36px; height: 36px; flex-shrink: 0; border-radius: 50%; border: none; cursor: pointer;
  display: grid; place-items: center; background: #fff; color: var(--deep);
  box-shadow: 0 2px 0 rgba(58, 43, 82, 0.18);
}
.eye-btn svg, .add-btn svg { width: 22px; height: 22px; }
.add-btn { background: var(--deep); color: #fff; }
/* Week cards are narrow: picture + title on top, faces + eye underneath. */
.block-card { display: grid; grid-template-columns: 34px 1fr; align-items: start; gap: 4px 8px; }
.block-card .card-art { width: 34px; height: 34px; padding: 3px; border-radius: 10px; }
.block-card .card-title { -webkit-line-clamp: 3; font-size: 0.92rem; align-self: center; }
.card-foot { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; }
.block-card .eye-btn { width: 32px; height: 32px; }
.block-card.done { opacity: 0.8; }
.done-badge { position: absolute; top: -7px; left: -7px; width: 24px; height: 24px; }
.done-badge svg { width: 100%; height: 100%; }

/* ─── Matrix ─────────────────────────────────────────────────────────────── */
.board { flex: 1; min-width: 0; display: flex; flex-direction: column; position: relative; }
.grid-scroll {
  flex: 1; overflow: auto; margin: 0 12px 12px; border-radius: 22px; background: #fff;
  box-shadow: 0 4px 0 rgba(58, 43, 82, 0.12); overscroll-behavior: contain;
}
.grid { display: grid; min-width: 100%; }
.corner, .day-head { position: sticky; top: 0; z-index: 3; background: #fff; border-bottom: 3px solid #f0eafb; }
.corner { left: 0; z-index: 4; }
.day-head { display: flex; align-items: baseline; justify-content: center; gap: 6px; padding: 10px 6px 8px; }
.dh-name { font-weight: 800; font-size: 1.05rem; }
.dh-num { font-weight: 800; font-size: 1.05rem; color: #8b80a3; }
.day-head.today { background: #fff7cf; }
.day-head.today .dh-num { color: var(--ink); }
.dh-today { font-size: 0.75rem; font-weight: 800; padding: 0 8px; border-radius: 999px; background: #ffd93d; }

.time-cell {
  position: sticky; left: 0; z-index: 2; display: flex; align-items: center; gap: 6px;
  padding: 6px 8px; min-height: 76px; border-bottom: 2px dashed #f0eafb; background: #fff;
}
.tc-sky { width: 28px; height: 28px; flex-shrink: 0; }
.tc-label { font-weight: 800; font-size: 0.98rem; white-space: nowrap; }
.time-cell.night { background: #eef0ff; }
.time-cell.dawn { background: #fff5df; }
.time-cell.dusk { background: #ffefe8; }

.cell {
  position: relative; display: flex; flex-direction: column; gap: 6px;
  min-height: 76px; padding: 6px; border-bottom: 2px dashed #f0eafb; border-left: 2px solid #f6f2fd;
}
.cell.night { background: #f7f8ff; }
.cell.dawn { background: #fffbf0; }
.cell.dusk { background: #fff8f4; }
.cell.todaycol { background-image: linear-gradient(rgba(255, 217, 61, 0.08), rgba(255, 217, 61, 0.08)); }
.cell.now { box-shadow: inset 0 0 0 3px #ffd93d; }
.time-cell.quiet, .cell.quiet { min-height: 44px; }
.cell.over { background: #e6dcff; box-shadow: inset 0 0 0 3px #9b6bff; }
.drop-bubble {
  position: absolute; right: 8px; bottom: 6px; padding: 0 10px; border-radius: 999px;
  background: #7b3fd1; color: #fff; font-weight: 800; font-size: 0.85rem; pointer-events: none;
}

/* ─── Phone day bubbles ──────────────────────────────────────────────────── */
.day-pills { display: flex; gap: 6px; padding: 0 12px 10px; overflow-x: auto; flex-shrink: 0; }
.day-pill {
  position: relative; flex: 1 0 44px; display: flex; flex-direction: column; align-items: center;
  padding: 4px 0; border: none; border-radius: 16px; background: #fff; cursor: pointer;
  font: inherit; color: var(--ink); box-shadow: 0 3px 0 rgba(58, 43, 82, 0.15);
}
.dp-name { font-size: 0.8rem; font-weight: 700; }
.dp-num { font-size: 1.2rem; font-weight: 800; line-height: 1.1; }
.day-pill.today { background: #fff7cf; }
.day-pill.on { background: #7b3fd1; color: #fff; }
.day-pill.over { background: #9b6bff; color: #fff; transform: scale(1.08); }
.dp-dot {
  position: absolute; top: -4px; right: -2px; min-width: 18px; height: 18px; padding: 0 4px; border-radius: 999px;
  background: #ff5d8f; color: #fff; font-size: 0.7rem; font-weight: 800; line-height: 18px;
}

.fab {
  position: absolute; left: 24px; bottom: 26px; z-index: 5;
  display: inline-flex; align-items: center; gap: 6px; height: 52px; padding: 0 20px 0 14px;
  border: none; border-radius: 999px; cursor: pointer; font: inherit; font-weight: 800; font-size: 1.05rem;
  color: #3a2b52; background: radial-gradient(circle at 32% 28%, #fff, #ffd93d 55%, #ffb340);
  box-shadow: inset 0 -4px 0 #c97f1e, 0 5px 0 rgba(58, 43, 82, 0.25), 0 10px 16px rgba(58, 43, 82, 0.22);
}
.fab svg { width: 24px; height: 24px; }

.toast {
  position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 150;
  padding: 10px 20px; border-radius: 999px; background: #3a2b52; color: #fff; font-weight: 700;
  box-shadow: 0 6px 20px rgba(35, 22, 74, 0.3); animation: pop 0.25s cubic-bezier(0.2, 1.6, 0.4, 1);
}

/* ─── Phone layout ───────────────────────────────────────────────────────── */
.planner.phone { --time-col: 70px; }
.phone .ph { padding: 8px 12px; gap: 8px; }
.phone .ph-title { font-size: 1.1rem; }
.phone .ph-title svg { width: 28px; height: 28px; }
.phone .week-nav { order: 3; width: 100%; justify-content: center; }
.phone .week-label { min-width: 0; flex: 1; font-size: 0.95rem; }
.phone .pill-btn.gold span { display: none; }
.phone .pill-btn.gold { width: 44px; padding: 0; }
.phone .tc-label { font-size: 0.85rem; }
.phone .tc-sky { width: 22px; height: 22px; }
.phone .time-cell { flex-direction: column; justify-content: center; gap: 0; padding: 4px; }
.phone .grid-scroll { margin: 0 8px 8px; }
.phone .corner, .phone .day-head { display: none; } /* the day bubbles already say which day */
.phone .pool {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 120; width: auto; height: 70vh; margin: 0;
  display: flex; border-radius: 24px 24px 0 0; background: #fff;
  box-shadow: 0 -10px 30px rgba(35, 22, 74, 0.25);
  transform: translateY(105%); transition: transform 0.25s ease;
}
.phone .pool.open { transform: none; }
.phone .fab { left: 50%; transform: translateX(-50%); bottom: 22px; }

/* ─── Modals ─────────────────────────────────────────────────────────────── */
.modal-backdrop {
  position: fixed; inset: 0; background: rgba(35, 22, 74, 0.45);
  display: flex; align-items: center; justify-content: center; z-index: 200; padding: 16px;
}
.modal {
  background: #fff; border-radius: 24px; padding: 1.4rem; width: 360px; max-width: 100%;
  box-shadow: 0 8px 0 rgba(58, 43, 82, 0.18), 0 20px 50px rgba(35, 22, 74, 0.3);
  display: flex; flex-direction: column; gap: 0.75rem; color: #3a2b52;
  font-family: "Baloo 2", system-ui, sans-serif; animation: pop 0.25s cubic-bezier(0.2, 1.6, 0.4, 1);
}
.modal-h { margin: 0; font-size: 1.3rem; font-weight: 800; }
.modal-activity { margin: 0; font-weight: 600; color: #4b3d68; font-size: 1rem; }
.modal-error { color: #b0365e; font-size: 0.9rem; margin: 0; }
.modal-actions { display: flex; gap: 0.5rem; justify-content: flex-end; }
.btn { padding: 0.55rem 1.3rem; border-radius: 999px; border: none; cursor: pointer; font: inherit; font-weight: 800; font-size: 1rem; }
.btn.primary { background: #7b3fd1; color: #fff; box-shadow: inset 0 -3px 0 #5a2aa3; }
.btn.secondary { background: #f3eefc; color: #3a2b52; }
.btn.danger { background: #ff5d8f; color: #fff; }
.btn:disabled { opacity: 0.6; cursor: not-allowed; }
.btn.sm { padding: 0.25rem 0.8rem; font-size: 0.85rem; }

.modal.when { width: 520px; }
.when-head { display: flex; align-items: center; gap: 12px; padding: 10px; border-radius: 18px; background: var(--bg); }
.when-days { display: flex; gap: 6px; }
.when-days .day-pill { flex: 1 1 0; min-width: 0; box-shadow: 0 2px 0 rgba(58, 43, 82, 0.15); background: #f6f2fd; }
.when-days .day-pill.today { background: #fff7cf; }
.when-days .day-pill.on { background: #7b3fd1; color: #fff; }
.when-hours { display: grid; grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); gap: 6px; max-height: 40vh; overflow-y: auto; padding: 2px; }
.hour-chip {
  display: flex; align-items: center; gap: 4px; padding: 6px 8px; border-radius: 14px; border: 2px solid transparent;
  background: #fff; cursor: pointer; font: inherit; font-weight: 800; color: #3a2b52; box-shadow: 0 2px 0 rgba(58, 43, 82, 0.12);
}
.hour-chip.dawn { background: #fff5df; }
.hour-chip.day { background: #fffbe6; }
.hour-chip.dusk { background: #ffefe8; }
.hour-chip.night { background: #eef0ff; }
.hour-chip.on { border-color: #7b3fd1; background: #f3e8ff; }
.hc-sky { width: 22px; height: 22px; flex-shrink: 0; }

/* Availability modal */
.avail-modal { width: 460px; max-height: 86vh; overflow-y: auto; font-family: system-ui, sans-serif; }
.avail-intro { margin: 0; font-size: 0.85rem; color: #64748b; }
.avail-guardian { border: 2px solid #f0eafb; border-radius: 14px; padding: 0.75rem 0.9rem; }
.avail-g-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem; }
.avail-grid { display: flex; flex-direction: column; gap: 0.35rem; }
.avail-row { display: flex; align-items: center; gap: 0.5rem; font-size: 0.9rem; }
.avail-day { display: flex; align-items: center; gap: 0.4rem; width: 70px; cursor: pointer; }
.avail-time { padding: 0.2rem 0.4rem; border: 1px solid #cbd5e1; border-radius: 8px; font: inherit; font-size: 0.85rem; }
.avail-dash { color: #94a3b8; }
.avail-off { color: #cbd5e1; font-style: italic; }
.muted { color: #64748b; font-size: 0.85rem; }

@keyframes pop { from { transform: scale(0.85); opacity: 0; } }
.toast { animation-name: toast-pop; }
@keyframes toast-pop { from { transform: translateX(-50%) scale(0.85); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .modal, .toast { animation: none; } .phone .pool { transition: none; } }
</style>

<style>
/* The floating card under the pointer (teleported to <body>, so unscoped). */
.drag-ghost {
  position: fixed; z-index: 300; pointer-events: none;
  display: flex; align-items: center; gap: 8px; max-width: 240px; padding: 6px 12px 6px 6px;
  border-radius: 16px; background: var(--bg); color: #3a2b52;
  font-family: "Baloo 2", system-ui, sans-serif; font-weight: 700;
  transform: translate(-30%, -60%) rotate(-3deg) scale(1.06);
  box-shadow: 0 14px 28px rgba(35, 22, 74, 0.3), inset 0 -3px 0 var(--deep);
}
.drag-ghost .card-art { width: 40px; height: 40px; padding: 4px; border-radius: 12px; background: #fff; flex-shrink: 0; }
.drag-ghost .card-title { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.2; }
body.pointer-dragging, body.pointer-dragging * { cursor: grabbing !important; user-select: none !important; -webkit-user-select: none !important; }
</style>
