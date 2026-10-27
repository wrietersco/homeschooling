<script setup>
// Activity Player (parent session mode). The guiding parent picks a date, then
// plays through that day's scheduled activities one at a time — reading the
// content aloud with the child, recording completion scores and observations.
// This is the authed, parent-facing counterpart to the link-scoped child view.
import { ref, computed, watch, onMounted } from "vue";
import { collection, query, orderBy, getDocs, doc, getDoc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthStore } from "@/stores/auth";
import { submitScore, addObservation, updateBlockStatus } from "@/services/player";
import { getActivityJourney } from "@/services/brief";
import ActivityContent from "@/components/ActivityContent.vue";
import SpeakButton from "@/components/SpeakButton.vue";
import GuideChat from "@/components/GuideChat.vue";
import ProviderBadge from "@/components/ProviderBadge.vue";
import ActivityArt from "@/components/planner/ActivityArt.vue";
import SkyArt from "@/components/planner/SkyArt.vue";
import ChildAvatar from "@/components/ChildAvatar.vue";
import { tintStyle } from "@/lib/activityTints";
import { hourOf, hourLabel, dayPeriod } from "@/lib/plannerGrid";
import { shiftDateKey, friendlyDay } from "@/lib/playerDay";

const auth = useAuthStore();
const RANK_LABELS = { 1: "Intro", 2: "Basic", 3: "Mid", 4: "Advanced", 5: "Mastery" };

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const dateKey = ref(todayKey());
const blocks = ref([]);
const children = ref([]);
const loadingDay = ref(false);
const index = ref(0);

// Per-activity working state (keyed by block id so it survives navigation).
const activityCache = ref({});   // blockId -> { activity, loading }
const scores = ref({});          // blockId -> { childId: { completed, isDriving } }
const obsText = ref({});         // blockId -> string
const obsChild = ref({});        // blockId -> childId
const blockDone = ref({});       // blockId -> bool
const saving = ref(false);
const saveError = ref("");
const obsSaving = ref(false);
const obsSavedFor = ref("");

const currentBlock = computed(() => blocks.value[index.value] || null);
const currentActivity = computed(() => {
  const b = currentBlock.value;
  return b ? activityCache.value[b.id]?.activity || null : null;
});
const dayHasBlocks = computed(() => blocks.value.length > 0);

// Parent instructions show in the guardian's native language first — mother
// tongue in native script (e.g. Urdu Nastaliq), falling back to the roman
// transliteration; English is kept as a collapsible secondary.
const nativeInstructions = computed(() =>
  currentActivity.value?.parentInstructionsNative || currentActivity.value?.parentInstructionsTranslit || ""
);
const hasNativeInstructions = computed(() => Boolean(nativeInstructions.value));
const nativeIsScript = computed(() => Boolean(currentActivity.value?.parentInstructionsNative));

// Resolve the children this activity is for. The BLOCK's targetChildren win when
// present — a per-child scheduled session (scheduler forChildId) scopes the block
// to one child so the player shows that child's differentiated variant — else we
// use the activity's. The stored ids may be empty OR contain stale/garbage ids
// that don't match any current child; in either case we fall back to ALL children
// so the parent can always record who took part, never a dead-end.
const targetChildren = computed(() => {
  const a = currentActivity.value;
  const b = currentBlock.value;
  if (!a && !b) return [];
  const ids = (b?.targetChildren?.length ? b.targetChildren : a?.targetChildren) || [];
  const matched = ids.length ? children.value.filter((c) => ids.includes(c.id)) : [];
  return matched.length ? matched : children.value;
});

async function loadChildren() {
  if (!auth.familyId) return;
  const snap = await getDocs(collection(db, "families", auth.familyId, "children"));
  children.value = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function loadDay() {
  if (!auth.familyId) return;
  loadingDay.value = true;
  blocks.value = [];
  index.value = 0;
  try {
    const q = query(
      collection(db, "families", auth.familyId, "calendarDays", dateKey.value, "blocks"),
      orderBy("scheduledTime", "asc"),
      orderBy("createdAt", "asc")
    );
    const snap = await getDocs(q);
    blocks.value = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    for (const b of blocks.value) {
      blockDone.value[b.id] = b.status === "done";
      if (!obsChild.value[b.id]) obsChild.value[b.id] = "";
    }
    if (blocks.value.length) await ensureActivity(blocks.value[0]);
  } finally {
    loadingDay.value = false;
  }
}

// Load the full activity doc (for its content + targets) for a block, once.
async function ensureActivity(block) {
  if (!block || activityCache.value[block.id]?.activity) return;
  activityCache.value[block.id] = { activity: null, loading: true };
  try {
    const snap = await getDoc(doc(db, "families", auth.familyId, "activities", block.activityId));
    const activity = snap.exists() ? { id: snap.id, ...snap.data() } : null;
    activityCache.value[block.id] = { activity, loading: false };
  } catch {
    activityCache.value[block.id] = { activity: null, loading: false };
  }
}

// Initialise per-child score rows from the RESOLVED target children (real ids),
// not whatever raw ids the activity stored. Runs whenever the active block or its
// resolved children change, so the scoring checkboxes always bind to a real child.
function ensureScores() {
  const b = currentBlock.value;
  if (!b) return;
  const kids = targetChildren.value;
  if (!kids.length) return;
  const existing = scores.value[b.id] || {};
  const next = {};
  for (const c of kids) next[c.id] = existing[c.id] || { completed: false, isDriving: false };
  scores.value[b.id] = next;
  if (!obsChild.value[b.id]) obsChild.value[b.id] = kids[0].id;
  // Keep the in-focus child valid for the per-child work area.
  if (!kids.some((c) => c.id === activeChildId.value)) activeChildId.value = kids[0].id;
}
watch([currentBlock, targetChildren], ensureScores, { immediate: true });

// Parent "where this fits" journey — single state, reset on navigation.
const journeyOpen = ref(false);
const journeyLoading = ref(false);
const journeyText = ref("");
const journeyError = ref("");
async function toggleJourney() {
  journeyOpen.value = !journeyOpen.value;
  const b = currentBlock.value;
  if (journeyOpen.value && b && !journeyText.value && !journeyLoading.value) {
    journeyLoading.value = true;
    journeyError.value = "";
    try {
      const res = await getActivityJourney(b.activityId);
      if (res?.configured === false) journeyError.value = "The plan brief isn't available yet.";
      else journeyText.value = res?.text || "No journey information yet.";
    } catch (e) {
      journeyError.value = e?.message || "Could not load the plan context.";
    } finally {
      journeyLoading.value = false;
    }
  }
}

function go(to) {
  if (to < 0 || to >= blocks.value.length) return;
  index.value = to;
  saveError.value = "";
  journeyOpen.value = false; journeyText.value = ""; journeyError.value = "";
  ensureActivity(blocks.value[to]);
}

function toggleDriver(blockId, childId) {
  const s = scores.value[blockId];
  for (const cid of Object.keys(s)) s[cid].isDriving = cid === childId && !s[childId].isDriving;
}

const coopMode = computed(() => Boolean(currentActivity.value?.coopMode || currentBlock.value?.coopMode));

// A genuinely *combined* activity is one more than one child does together (a
// co-op). Only then do the instructions + content belong to everyone at once and
// are shown as a single shared block. Otherwise each target child does the
// activity individually, so we frame the content per child rather than merging
// them — even though they share the same generated material, the parent runs and
// scores it separately for each.
const combined = computed(() => coopMode.value && targetChildren.value.length > 1);
const perChild = computed(() => !combined.value && targetChildren.value.length > 1);

// Which child's run is in focus (only meaningful in per-child mode). Kept valid
// against the resolved target children as the block / its children change.
const activeChildId = ref("");
const activeChild = computed(() =>
  targetChildren.value.find((c) => c.id === activeChildId.value) || targetChildren.value[0] || null
);

// In per-child mode, prefer a per-child content variant (content.byChild[childId])
// when one exists — that's how differentiated, level-paced activities (e.g.
// Noorani Qaida) give each child material at their own level. Falls back to the
// shared blob for undifferentiated / co-op activities.
const activeContent = computed(() => {
  const a = currentActivity.value;
  if (!a) return null;
  const byChild = a.contentByChild;
  if (perChild.value && byChild && activeChildId.value && byChild[activeChildId.value]) {
    return byChild[activeChildId.value];
  }
  return a.content || null;
});

// Which provider/model wrote the CURRENTLY ACTIVE content — mirrors activeContent's
// shared-vs-per-child choice above.
const activeProvider = computed(() => {
  const a = currentActivity.value;
  if (!a) return { provider: "", model: "" };
  const byChild = a.contentByChild;
  if (perChild.value && byChild && activeChildId.value && byChild[activeChildId.value]) {
    return { provider: a.differentiatedProvider || "", model: a.differentiatedModel || "" };
  }
  return { provider: a.contentProvider || "", model: a.contentModel || "" };
});

// Persist an accepted per-element voice on the activity (keyed by overrideKey), so it
// replays for everyone and is never re-charged. Mirrors ActivityView's handler.
const voiceSaveError = ref("");
const voiceSavedAt = ref(0);
async function handleVoiceOverride({ key, provider, model, voiceName, url }) {
  const b = currentBlock.value;
  const entry = b && activityCache.value[b.id];
  const a = entry?.activity;
  if (!a || !key || !url) return;
  const payload = { url, provider, model, voiceName };
  voiceSaveError.value = "";
  // Optimistic local update (reassign so the activeContent computed re-reads).
  activityCache.value[b.id] = { ...entry, activity: { ...a, audioOverrides: { ...(a.audioOverrides || {}), [key]: payload } } };
  try {
    await updateDoc(
      doc(db, "families", auth.familyId, "activities", a.id),
      { [`audioOverrides.${key}`]: payload }
    );
    voiceSavedAt.value = Date.now();
  } catch (e) {
    voiceSaveError.value = e?.message || "Couldn't save the voice.";
  }
}

async function saveScores() {
  const b = currentBlock.value;
  const a = currentActivity.value;
  if (!b) return;
  saving.value = true;
  saveError.value = "";
  try {
    const s = scores.value[b.id] || {};
    const drivingChildId = Object.entries(s).find(([, v]) => v.isDriving)?.[0] || null;
    for (const [childId, v] of Object.entries(s)) {
      const child = children.value.find((c) => c.id === childId);
      await submitScore(auth.familyId, {
        activityId: b.activityId,
        activityTitle: b.activityTitle || a?.title || "",
        blockId: b.id,
        dateKey: dateKey.value,
        childId,
        childName: child?.name || childId,
        coopMode: coopMode.value,
        drivingChildId: coopMode.value ? drivingChildId : null,
        sharedSuccess: coopMode.value ? Boolean(drivingChildId) : null,
        completed: v.completed,
        notes: "",
        scoredBy: auth.user?.uid || "",
      });
    }
    await updateBlockStatus(auth.familyId, dateKey.value, b.id, "done");
    blockDone.value[b.id] = true;
    // Advance to the next not-yet-done activity if any.
    const next = blocks.value.findIndex((bl, i) => i > index.value && !blockDone.value[bl.id]);
    if (next !== -1) go(next);
  } catch (e) {
    saveError.value = e?.message || "Failed to save.";
  } finally {
    saving.value = false;
  }
}

// Explicitly un-mark an activity the parent had marked done (e.g. ticked by
// mistake, or the child didn't finish after all).
async function reopenBlock() {
  const b = currentBlock.value;
  if (!b) return;
  saving.value = true;
  saveError.value = "";
  try {
    await updateBlockStatus(auth.familyId, dateKey.value, b.id, "planned");
    blockDone.value[b.id] = false;
  } catch (e) {
    saveError.value = e?.message || "Failed to reopen.";
  } finally {
    saving.value = false;
  }
}

async function saveObservation() {
  const b = currentBlock.value;
  if (!b || !obsText.value[b.id]?.trim()) return;
  obsSaving.value = true;
  try {
    const child = children.value.find((c) => c.id === obsChild.value[b.id]);
    await addObservation(auth.familyId, {
      activityId: b.activityId,
      activityTitle: b.activityTitle || "",
      childId: obsChild.value[b.id],
      childName: child?.name || obsChild.value[b.id],
      text: obsText.value[b.id].trim(),
      authorUid: auth.user?.uid || "",
    });
    obsText.value[b.id] = "";
    obsSavedFor.value = b.id;
    setTimeout(() => { if (obsSavedFor.value === b.id) obsSavedFor.value = ""; }, 2500);
  } catch (e) {
    saveError.value = e?.message || "Failed to save observation.";
  } finally {
    obsSaving.value = false;
  }
}

const completedCount = computed(() => blocks.value.filter((b) => blockDone.value[b.id]).length);

// Copy the current activity's unique id (for sharing / support reference).
const uidCopied = ref(false);
async function copyUid() {
  const id = currentBlock.value?.activityId;
  if (!id) return;
  try {
    await navigator.clipboard.writeText(id);
    uidCopied.value = true;
    setTimeout(() => (uidCopied.value = false), 2000);
  } catch { /* clipboard blocked */ }
}

// In-the-moment context handed to the guide so its answers are about whatever
// activity is open right now (not just the family at large).
const guideOpen = ref(false);
const guideContext = computed(() => {
  const b = currentBlock.value;
  const a = currentActivity.value;
  if (!b) return `On the Activity Player for ${dateKey.value}; nothing scheduled.`;
  const kids = targetChildren.value.map((c) => c.name || c.id).join(", ") || "all children";
  const bits = [
    `On the Activity Player for ${dateKey.value}.`,
    `Current activity: "${b.activityTitle}" (${b.subject}, type ${b.type}, ${RANK_LABELS[b.complexityRank] || "?"}).`,
    `For: ${kids}.`,
  ];
  if (a?.parentInstructions) bits.push(`Parent instructions: ${a.parentInstructions}`);
  return bits.join(" ").slice(0, 600);
});

// ─── Picture-first helpers ───────────────────────────────────────────────────
const dayName = computed(() => friendlyDay(dateKey.value, todayKey()));
const dayWords = computed(() =>
  ["Today", "Tomorrow", "Yesterday"].includes(dayName.value) ? dayName.value.toLowerCase() : dayName.value
);
const dateInput = ref(null);
function shiftDay(n) { dateKey.value = shiftDateKey(dateKey.value, n); }
function openCalendar() {
  const el = dateInput.value;
  if (!el) return;
  try { el.showPicker(); } catch { el.focus(); el.click(); }
}

const allDone = computed(() => dayHasBlocks.value && completedCount.value === blocks.value.length);
// Faces on a rail tile: only the children a block is scoped to (none = everyone).
const kidsFor = (b) => {
  const ids = b?.targetChildren || [];
  return ids.length ? children.value.filter((c) => ids.includes(c.id)) : [];
};

// Tap a child's face to tick / untick that they finished.
function toggleFinished(childId) {
  const row = scores.value[currentBlock.value?.id]?.[childId];
  if (row) row.completed = !row.completed;
}
function tickEveryone() {
  for (const v of Object.values(scores.value[currentBlock.value?.id] || {})) v.completed = true;
}

onMounted(async () => {
  await loadChildren();
  await loadDay();
});
watch(dateKey, () => loadDay());
</script>

<template>
  <div class="play" :style="currentBlock ? tintStyle(currentBlock.type) : null">
    <!-- Header: title, day switcher, a star per activity for progress -->
    <header class="ph">
      <h1 class="ph-title">
        <svg viewBox="0 0 40 40" aria-hidden="true">
          <circle cx="20" cy="20" r="17" fill="#7FE3A6" />
          <circle cx="20" cy="20" r="17" fill="none" stroke="#1E9E5C" stroke-width="2.5" />
          <path d="M16 12 L29 20 L16 28 Z" fill="#fff" stroke="#fff" stroke-width="2" stroke-linejoin="round" />
          <ellipse cx="13" cy="11" rx="5" ry="2.2" fill="#fff" opacity=".45" />
        </svg>
        <span>Play time</span>
      </h1>

      <div class="day-nav">
        <button class="round-btn" aria-label="Previous day" @click="shiftDay(-1)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5 L8 12 L15 19" stroke="currentColor" stroke-width="3.2" fill="none" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </button>
        <button class="day-label" type="button" aria-label="Pick a day" @click="openCalendar">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3" y="5" width="18" height="16" rx="4" fill="#fff" stroke="currentColor" stroke-width="2" />
            <rect x="3" y="5" width="18" height="6" rx="3" fill="#FF8FB1" />
            <path d="M8 3 V7 M16 3 V7" stroke="#7B3FD1" stroke-width="2.4" stroke-linecap="round" />
          </svg>
          {{ dayName }}
          <input ref="dateInput" v-model="dateKey" type="date" class="date-hidden" tabindex="-1" aria-hidden="true" />
        </button>
        <button class="round-btn" aria-label="Next day" @click="shiftDay(1)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5 L16 12 L9 19" stroke="currentColor" stroke-width="3.2" fill="none" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </button>
      </div>

      <div v-if="dayHasBlocks" class="stars" role="img" :aria-label="`${completedCount} of ${blocks.length} done`">
        <svg v-for="(b, i) in blocks" :key="b.id" viewBox="0 0 24 24" class="star" :class="{ on: i < completedCount }" aria-hidden="true">
          <path d="M12 2.5 L14.8 8.6 L21.4 9.3 L16.4 13.7 L17.9 20.3 L12 16.9 L6.1 20.3 L7.6 13.7 L2.6 9.3 L9.2 8.6 Z" />
        </svg>
      </div>
    </header>

    <div v-if="loadingDay" class="state">
      <span class="spinner" aria-hidden="true"></span> Loading the day…
    </div>

    <div v-else-if="!dayHasBlocks" class="state empty">
      <svg viewBox="0 0 120 90" class="empty-art" aria-hidden="true">
        <rect x="14" y="16" width="92" height="66" rx="16" fill="#fff" />
        <rect x="14" y="16" width="92" height="20" rx="12" fill="#FF8FB1" />
        <rect x="34" y="8" width="8" height="18" rx="4" fill="#7B3FD1" /><rect x="78" y="8" width="8" height="18" rx="4" fill="#7B3FD1" />
        <path d="M44 66 Q60 54 76 66" stroke="#C7CDD8" stroke-width="5" fill="none" stroke-linecap="round" />
        <circle cx="46" cy="52" r="4" fill="#C7CDD8" /><circle cx="74" cy="52" r="4" fill="#C7CDD8" />
      </svg>
      <p>Nothing planned for {{ dayWords }}.</p>
      <router-link to="/planner" class="pill-btn gold">Open the Planner</router-link>
    </div>

    <div v-else class="pb">
      <!-- The day's activities as picture tiles (a sky picture instead of a time) -->
      <nav class="rail" aria-label="Activities">
        <button
          v-for="(b, i) in blocks"
          :key="b.id"
          class="tile"
          :class="{ active: i === index, done: blockDone[b.id] }"
          :style="tintStyle(b.type)"
          :aria-label="`${b.activityTitle}${blockDone[b.id] ? ' (done)' : ''}`"
          :title="`${b.activityTitle} · ${hourLabel(hourOf(b.scheduledTime))}`"
          @click="go(i)"
        >
          <span class="tile-art"><ActivityArt :type="b.type" /></span>
          <span class="tile-sky"><SkyArt :period="dayPeriod(hourOf(b.scheduledTime))" /></span>
          <span v-if="kidsFor(b).length" class="tile-kids">
            <ChildAvatar v-for="c in kidsFor(b).slice(0, 3)" :key="c.id" :child="c" :size="22" />
          </span>
          <span v-if="blockDone[b.id]" class="tile-check" aria-hidden="true">✓</span>
        </button>
      </nav>

      <main v-if="currentBlock" class="stage">
        <!-- Big title card: picture, name, and the children's faces -->
        <section class="hero">
          <span class="hero-art"><ActivityArt :type="currentBlock.type" /></span>
          <div class="hero-text">
            <h2>{{ currentBlock.activityTitle }}</h2>
            <div class="hero-kids">
              <span v-for="c in targetChildren" :key="c.id" class="kid-pill">
                <ChildAvatar :child="c" :size="30" />{{ c.name || c.id }}
              </span>
              <span v-if="combined" class="kid-pill together"><ChildAvatar :child="null" :size="30" />Together</span>
            </div>
          </div>
          <span v-if="blockDone[currentBlock.id]" class="hero-done" aria-label="Done">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5 L10 17.5 L19 7" stroke="#fff" stroke-width="3.4" fill="none" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </span>
          <!-- Level, subject, id, share link — tucked away behind "⋯" -->
          <details class="hero-more">
            <summary aria-label="More details">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="2.4" /><circle cx="12" cy="12" r="2.4" /><circle cx="19" cy="12" r="2.4" /></svg>
            </summary>
            <div class="more-body">
              <span :class="`rank-badge rank-${currentBlock.complexityRank}`">{{ RANK_LABELS[currentBlock.complexityRank] }}</span>
              <span class="meta-chip">{{ currentBlock.subject }}</span>
              <span class="meta-chip">{{ hourLabel(hourOf(currentBlock.scheduledTime)) }} · {{ currentBlock.durationMinutes }} min</span>
              <ProviderBadge :provider="activeProvider.provider" :model="activeProvider.model" />
              <button class="uid-chip" :title="uidCopied ? 'Copied!' : 'Activity ID — click to copy'" @click="copyUid">
                <span class="uid-label">ID</span>
                <span class="uid-value">{{ currentBlock.activityId }}</span>
                <span class="uid-copy">{{ uidCopied ? "✓" : "⧉" }}</span>
              </button>
              <router-link class="uid-open" :to="`/activity/${currentBlock.activityId}`">Open / share page →</router-link>
            </div>
          </details>
        </section>

        <div class="cols">
          <!-- The activity itself -->
          <div class="col-main">
            <!-- Each child does it on their own: big face tabs to switch between them -->
            <div v-if="perChild" class="who-tabs" role="tablist" aria-label="Choose a child">
              <button
                v-for="c in targetChildren"
                :key="c.id"
                type="button"
                class="who-tab"
                :class="{ active: c.id === activeChildId }"
                role="tab"
                :aria-selected="c.id === activeChildId"
                @click="activeChildId = c.id"
              >
                <ChildAvatar :child="c" :size="36" />
                <span>{{ c.name || c.id }}</span>
              </button>
            </div>

            <!-- Keyed by the in-focus child so switching tabs re-mounts it
                 (resets per-run UI state like reveals / font size). -->
            <div v-if="activityCache[currentBlock.id]?.loading" class="state"><span class="spinner" aria-hidden="true"></span> Loading activity…</div>
            <div v-else-if="activeContent" class="content-box">
              <ActivityContent
                :key="perChild ? activeChildId : 'all'"
                :content="activeContent"
                :audio-overrides="currentActivity?.audioOverrides || {}"
                :can-edit-voice="true"
                @update:override="handleVoiceOverride"
              />
              <p v-if="voiceSaveError" class="state muted" role="alert">{{ voiceSaveError }}</p>
              <p v-else-if="voiceSavedAt" class="voice-saved" role="status">✓ Voice saved — this element now plays it for everyone.</p>
            </div>
            <p v-else class="card muted">
              No interactive content for this activity yet — follow “What to do”.
            </p>
          </div>

          <!-- What the parent does -->
          <aside class="col-side">
            <!-- What to do — native language first, with a big listen button -->
            <section v-if="currentActivity?.parentInstructions || hasNativeInstructions" class="card how">
              <div class="card-head">
                <svg viewBox="0 0 32 32" class="card-ico" aria-hidden="true">
                  <circle cx="16" cy="11" r="7" fill="#FFB25A" /><path d="M4 30 Q16 14 28 30 Z" fill="#FF8FB1" />
                  <circle cx="13.5" cy="10.5" r="1.3" fill="#3a2b52" /><circle cx="18.5" cy="10.5" r="1.3" fill="#3a2b52" />
                  <path d="M13 14 Q16 16.5 19 14" stroke="#3a2b52" stroke-width="1.4" fill="none" stroke-linecap="round" />
                </svg>
                <h3>What to do</h3>
                <span class="head-end">
                  <SpeakButton :text="nativeInstructions || currentActivity.parentInstructions" size="md" label="Listen" />
                </span>
              </div>
              <template v-if="hasNativeInstructions">
                <p class="how-text" :class="{ 'font-urdu': nativeIsScript, rtl: nativeIsScript }">{{ nativeInstructions }}</p>
                <details v-if="currentActivity.parentInstructions" class="how-en">
                  <summary>In English</summary>
                  <p>{{ currentActivity.parentInstructions }}</p>
                </details>
              </template>
              <p v-else class="how-text">{{ currentActivity.parentInstructions }}</p>
            </section>

            <!-- Who finished? Tap each face, then Done. -->
            <section class="card finish">
              <div class="card-head">
                <svg viewBox="0 0 32 32" class="card-ico" aria-hidden="true">
                  <circle cx="16" cy="16" r="13" fill="#7FE3A6" />
                  <path d="M9 16.5 L14 21.5 L23 11" stroke="#fff" stroke-width="3.6" fill="none" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
                <h3>Who finished?</h3>
                <span class="head-end">
                  <button v-if="targetChildren.length > 1" class="mini-btn" type="button" @click="tickEveryone">Everyone</button>
                </span>
              </div>
              <div v-if="scores[currentBlock.id]" class="faces">
                <div v-for="child in targetChildren" :key="child.id" class="face-wrap">
                  <button
                    type="button"
                    class="face"
                    :class="{ on: scores[currentBlock.id][child.id]?.completed }"
                    :aria-pressed="Boolean(scores[currentBlock.id][child.id]?.completed)"
                    @click="toggleFinished(child.id)"
                  >
                    <ChildAvatar :child="child" :size="58" />
                    <span class="face-tick" aria-hidden="true">✓</span>
                    <span class="face-name">{{ child.name || child.id }}</span>
                  </button>
                  <button
                    v-if="coopMode"
                    type="button"
                    class="driver-btn"
                    :class="{ active: scores[currentBlock.id][child.id]?.isDriving }"
                    title="Led the activity"
                    @click="toggleDriver(currentBlock.id, child.id)"
                  >{{ scores[currentBlock.id][child.id]?.isDriving ? "★ Leader" : "☆ Leader?" }}</button>
                </div>
              </div>
              <p v-if="saveError" class="field-error">{{ saveError }}</p>
              <button class="pill-btn go big" :disabled="saving" @click="saveScores">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5 L10 17.5 L19 7" stroke="currentColor" stroke-width="3.4" fill="none" stroke-linecap="round" stroke-linejoin="round" /></svg>
                {{ saving ? "Saving…" : (blockDone[currentBlock.id] ? "Save again" : "Done!") }}
              </button>
              <button v-if="blockDone[currentBlock.id]" class="link-btn" :disabled="saving" @click="reopenBlock">Not done after all</button>
            </section>

            <!-- A note about how it went -->
            <details class="card note">
              <summary class="card-head">
                <svg viewBox="0 0 32 32" class="card-ico" aria-hidden="true">
                  <rect x="5" y="4" width="20" height="25" rx="4" fill="#fff" stroke="#C39BFF" stroke-width="2.4" />
                  <path d="M10 11 H20 M10 16 H20 M10 21 H16" stroke="#C7CDD8" stroke-width="2.4" stroke-linecap="round" />
                  <path d="M22 26 L29 13 L31.5 14.5 L24.5 27.5 Z" fill="#FFB25A" />
                </svg>
                <h3>Write a note</h3>
              </summary>
              <div v-if="targetChildren.length > 1" class="note-kids">
                <button
                  v-for="c in targetChildren"
                  :key="c.id"
                  type="button"
                  class="note-kid"
                  :class="{ on: obsChild[currentBlock.id] === c.id }"
                  @click="obsChild[currentBlock.id] = c.id"
                ><ChildAvatar :child="c" :size="26" />{{ c.name || c.id }}</button>
              </div>
              <textarea v-model="obsText[currentBlock.id]" class="obs-textarea" rows="3" placeholder="What did you notice?"></textarea>
              <p v-if="obsSavedFor === currentBlock.id" class="success-msg">✓ Note saved.</p>
              <button class="pill-btn" :disabled="obsSaving || !obsText[currentBlock.id]?.trim()" @click="saveObservation">
                {{ obsSaving ? "Saving…" : "Save note" }}
              </button>
            </details>

            <!-- Where this fits in the plan (loaded on first open) -->
            <details class="card" :open="journeyOpen" @toggle="(e) => { if (e.target.open !== journeyOpen) toggleJourney(); }">
              <summary class="card-head">
                <svg viewBox="0 0 32 32" class="card-ico" aria-hidden="true">
                  <circle cx="16" cy="16" r="13" fill="#6FD3FF" />
                  <path d="M16 6 L20 16 L16 26 L12 16 Z" fill="#fff" /><path d="M16 6 L20 16 L12 16 Z" fill="#FF8FB1" />
                </svg>
                <h3>Where this fits</h3>
              </summary>
              <p v-if="journeyLoading" class="muted">Reading the plan…</p>
              <p v-else-if="journeyError" class="field-error">{{ journeyError }}</p>
              <p v-else class="journey-text">{{ journeyText }}</p>
            </details>
          </aside>
        </div>

        <!-- Big arrows between activities -->
        <div class="play-nav">
          <button class="round-btn lg" :disabled="index === 0" aria-label="Previous activity" @click="go(index - 1)">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5 L8 12 L15 19" stroke="currentColor" stroke-width="3.2" fill="none" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </button>
          <div class="dots" aria-hidden="true">
            <span v-for="(b, i) in blocks" :key="b.id" class="dot" :class="{ on: i === index, done: blockDone[b.id] }"></span>
          </div>
          <button class="round-btn lg" :disabled="index >= blocks.length - 1" aria-label="Next activity" @click="go(index + 1)">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5 L16 12 L9 19" stroke="currentColor" stroke-width="3.2" fill="none" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </button>
        </div>
      </main>
    </div>

    <!-- Everything done: a little celebration -->
    <transition name="pop">
      <div v-if="allDone && !loadingDay" class="cheer" role="status">
        <svg viewBox="0 0 48 48" aria-hidden="true">
          <path d="M24 4 L29.6 16.3 L43 17.7 L33 26.6 L35.9 39.8 L24 33 L12.1 39.8 L15 26.6 L5 17.7 L18.4 16.3 Z" fill="#FFD93D" stroke="#E0A800" stroke-width="2" stroke-linejoin="round" />
          <circle cx="19" cy="22" r="2" fill="#3a2b52" /><circle cx="29" cy="22" r="2" fill="#3a2b52" />
          <path d="M19 27 Q24 31 29 27" stroke="#3a2b52" stroke-width="2" fill="none" stroke-linecap="round" />
        </svg>
        <span>All done for {{ dayWords }}! Well done!</span>
      </div>
    </transition>

    <!-- Guide dock: an omniscient, read-only assistant that guides the signed-in
         guardian. It knows who is logged in, remembers their past questions, and
         is handed the activity currently open as context. -->
    <div class="guide-dock" :class="{ open: guideOpen }">
      <button class="guide-fab" @click="guideOpen = !guideOpen" :aria-expanded="guideOpen" :aria-label="guideOpen ? 'Hide guide' : 'Ask the guide'">
        <span class="fab-ico">🧭</span>
        <span class="fab-label">{{ guideOpen ? "Hide guide" : "Ask the guide" }}</span>
      </button>
      <div v-if="guideOpen" class="guide-panel">
        <div class="guide-panel-head">
          <strong>Your guide</strong>
          <span class="guide-sub">Knows your family · remembers this chat</span>
        </div>
        <GuideChat :context="guideContext" placeholder="Ask about this activity or any child…" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.play {
  --ink: #3a2b52;
  --bg: #EEE3FF; --deep: #7B3FD1;
  min-height: calc(100dvh - 64px);
  padding-bottom: 6rem;
  background: linear-gradient(180deg, #b7e7ff 0%, #e6dcff 100%);
  font-family: "Baloo 2", system-ui, -apple-system, "Segoe UI", sans-serif;
  color: var(--ink);
}

/* ─── Header ─────────────────────────────────────────────────────────────── */
.ph { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 12px 16px; }
.ph-title { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 1.4rem; font-weight: 800; }
.ph-title svg { width: 38px; height: 38px; filter: drop-shadow(0 3px 0 rgba(58, 43, 82, 0.18)); }
.day-nav { display: flex; align-items: center; gap: 8px; }
.day-label {
  position: relative; display: inline-flex; align-items: center; gap: 8px; min-width: 170px; height: 44px; justify-content: center;
  border: none; cursor: pointer; font: inherit; font-weight: 800; font-size: 1.1rem; color: var(--ink);
  padding: 0 16px; border-radius: 999px; background: rgba(255, 255, 255, 0.85);
  box-shadow: inset 0 -3px 0 rgba(58, 43, 82, 0.1);
}
.day-label svg { width: 22px; height: 22px; }
.date-hidden { position: absolute; left: 0; bottom: 0; width: 100%; height: 1px; opacity: 0; pointer-events: none; border: 0; padding: 0; }
.stars { display: flex; flex-wrap: wrap; gap: 3px; max-width: 300px; }
.star { width: 26px; height: 26px; fill: rgba(255, 255, 255, 0.75); stroke: rgba(58, 43, 82, 0.18); stroke-width: 1.2; }
.star.on { fill: #FFD93D; stroke: #E0A800; animation: twinkle 0.5s ease-out; }
@keyframes twinkle { 0% { transform: scale(0.4); } 70% { transform: scale(1.25); } 100% { transform: scale(1); } }

/* Chunky game buttons (same as the planner) */
.round-btn, .pill-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px; text-decoration: none;
  border: none; cursor: pointer; font: inherit; font-weight: 800; color: var(--ink); background: #fff;
  box-shadow: inset 0 -3px 0 rgba(58, 43, 82, 0.12), 0 3px 0 rgba(58, 43, 82, 0.2);
  transition: transform 0.1s;
}
.round-btn { width: 44px; height: 44px; border-radius: 50%; flex-shrink: 0; }
.round-btn.lg { width: 56px; height: 56px; }
.round-btn svg { width: 22px; height: 22px; }
.round-btn.lg svg { width: 28px; height: 28px; }
.pill-btn { min-height: 44px; padding: 0 20px; border-radius: 999px; font-size: 1rem; }
.pill-btn svg { width: 22px; height: 22px; }
.round-btn:active:not(:disabled), .pill-btn:active:not(:disabled) { transform: translateY(2px); }
.pill-btn.gold {
  color: #fff; background: radial-gradient(circle at 32% 28%, #e3b6ff, #9b6bff 55%, #7b3fd1);
  box-shadow: inset 0 -4px 0 #5a2aa3, 0 4px 0 rgba(58, 43, 82, 0.25);
}
.pill-btn.go {
  color: #fff; background: radial-gradient(circle at 32% 28%, #9ff0c0, #2fc274 55%, #1e9e5c);
  box-shadow: inset 0 -4px 0 #157a45, 0 4px 0 rgba(58, 43, 82, 0.25);
}
.pill-btn.big { width: 100%; min-height: 56px; font-size: 1.3rem; margin-top: 12px; }
.round-btn:disabled, .pill-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.mini-btn {
  border: 2px solid #7FE3A6; background: #fff; color: #1e7a4c; font: inherit; font-weight: 800;
  font-size: 0.85rem; border-radius: 999px; padding: 2px 12px; cursor: pointer;
}
.link-btn { display: block; margin: 8px auto 0; background: none; border: none; color: #8a7aa3; font: inherit; font-weight: 700; text-decoration: underline; cursor: pointer; }

.state { display: flex; align-items: center; gap: 10px; padding: 2rem 16px; color: #6b5d85; font-weight: 700; }
.state.empty { flex-direction: column; text-align: center; font-size: 1.15rem; }
.state.empty p { margin: 0; }
.empty-art { width: 150px; }
.muted { color: #8a7aa3; }
.spinner { width: 22px; height: 22px; border-radius: 50%; border: 4px solid rgba(123, 63, 209, 0.2); border-top-color: #7b3fd1; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* ─── Body: tile rail + stage ────────────────────────────────────────────── */
.pb { display: flex; gap: 16px; padding: 0 16px; align-items: flex-start; }
.rail {
  position: sticky; top: 76px; display: flex; flex-direction: column; gap: 12px; flex-shrink: 0;
  max-height: calc(100dvh - 96px); overflow-y: auto; padding: 8px 8px 12px;
}
.tile {
  position: relative; display: grid; place-items: center; width: 92px; height: 92px; flex-shrink: 0;
  border: 3px solid transparent; border-radius: 22px; background: var(--bg); cursor: pointer; padding: 0;
  box-shadow: inset 0 -4px 0 color-mix(in srgb, var(--deep) 30%, transparent), 0 3px 0 rgba(58, 43, 82, 0.15);
  transition: transform 0.12s;
}
.tile:hover { transform: translateY(-2px); }
.tile.active { border-color: var(--deep); transform: scale(1.06); }
.tile.done:not(.active) { opacity: 0.7; }
.tile-art { width: 54px; height: 54px; }
.tile-art :deep(svg) { width: 100%; height: 100%; }
.tile-sky { position: absolute; top: 4px; left: 4px; width: 22px; height: 22px; }
.tile-sky :deep(svg) { width: 100%; height: 100%; }
.tile-kids { position: absolute; bottom: -6px; right: -4px; display: flex; }
.tile-kids > * + * { margin-left: -8px; }
.tile-check {
  position: absolute; top: -7px; right: -7px; width: 26px; height: 26px; border-radius: 50%;
  display: grid; place-items: center; background: #2fc274; color: #fff; font-weight: 800; font-size: 0.95rem;
  border: 2px solid #fff; box-shadow: 0 2px 0 rgba(58, 43, 82, 0.2);
}

.stage { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 14px; padding-top: 8px; }

/* Hero card */
.hero {
  position: relative; display: flex; align-items: center; gap: 16px; padding: 14px 56px 14px 18px; border-radius: 26px;
  background: var(--bg); box-shadow: inset 0 -5px 0 color-mix(in srgb, var(--deep) 30%, transparent), 0 4px 0 rgba(58, 43, 82, 0.12);
}
.hero-art { width: 88px; height: 88px; flex-shrink: 0; padding: 8px; box-sizing: border-box; border-radius: 22px; background: #fff; box-shadow: 0 3px 0 rgba(58, 43, 82, 0.12); }
.hero-art :deep(svg) { width: 100%; height: 100%; }
.hero-text { flex: 1; min-width: 0; }
.hero-text h2 { margin: 0 0 6px; font-size: 1.6rem; line-height: 1.15; font-weight: 800; color: var(--ink); }
.hero-kids { display: flex; flex-wrap: wrap; gap: 6px; }
.kid-pill { display: inline-flex; align-items: center; gap: 6px; padding: 2px 12px 2px 2px; border-radius: 999px; background: #fff; font-weight: 800; font-size: 0.95rem; }
.kid-pill.together { background: #e3fbef; color: #1e7a4c; }
.hero-done {
  width: 52px; height: 52px; border-radius: 50%; display: grid; place-items: center; flex-shrink: 0;
  background: radial-gradient(circle at 32% 28%, #9ff0c0, #2fc274 55%, #1e9e5c); box-shadow: inset 0 -4px 0 #157a45;
}
.hero-done svg { width: 30px; height: 30px; }
.hero-more { position: absolute; top: 10px; right: 10px; }
.hero-more summary { list-style: none; cursor: pointer; width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; background: rgba(255, 255, 255, 0.75); }
.hero-more summary::-webkit-details-marker { display: none; }
.hero-more summary svg { width: 20px; height: 20px; fill: #8a7aa3; }
.more-body {
  position: absolute; right: 0; top: 42px; z-index: 5; width: min(340px, 80vw); display: flex; flex-wrap: wrap; gap: 6px;
  padding: 12px; border-radius: 16px; background: #fff; box-shadow: 0 10px 28px rgba(35, 22, 74, 0.2);
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
}
.meta-chip { font-size: 0.75rem; padding: 0.12rem 0.5rem; border-radius: 999px; background: #f1f5f9; color: #475569; }
.rank-badge { font-size: 0.72rem; font-weight: 700; padding: 0.12rem 0.5rem; border-radius: 999px; }
.rank-1 { background: #dcfce7; color: #166534; } .rank-2 { background: #dbeafe; color: #1e40af; }
.rank-3 { background: #fef9c3; color: #854d0e; } .rank-4 { background: #fed7aa; color: #9a3412; }
.rank-5 { background: #f3e8ff; color: #6b21a8; }
.uid-chip { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.7rem; padding: 0.12rem 0.5rem; border-radius: 999px; background: #f8fafc; color: #64748b; border: 1px solid #e2e8f0; cursor: pointer; font-family: inherit; }
.uid-label { font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
.uid-value { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.uid-copy { color: #94a3b8; }
.uid-open { font-size: 0.75rem; color: #2563eb; text-decoration: none; align-self: center; }

/* Two columns on wide screens: the activity, and what the parent does */
.cols { display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 16px; align-items: start; }
.col-main { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.col-side { display: flex; flex-direction: column; gap: 12px; position: sticky; top: 76px; max-height: calc(100dvh - 92px); overflow-y: auto; padding-bottom: 6px; }

.who-tabs { display: flex; flex-wrap: wrap; gap: 8px; }
.who-tab {
  display: inline-flex; align-items: center; gap: 8px; padding: 3px 16px 3px 3px; border-radius: 999px;
  border: 3px solid transparent; background: rgba(255, 255, 255, 0.8); cursor: pointer;
  font: inherit; font-weight: 800; font-size: 1.05rem; color: var(--ink);
  box-shadow: 0 3px 0 rgba(58, 43, 82, 0.12);
}
.who-tab.active { border-color: var(--deep); background: #fff; }

.content-box { background: #fff; border-radius: 22px; padding: 16px; box-shadow: 0 4px 0 rgba(58, 43, 82, 0.1); font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
.voice-saved { color: #6d28d9; font-size: 0.82rem; margin: 0.5rem 0 0; }

.card { background: rgba(255, 255, 255, 0.94); border-radius: 22px; padding: 14px 16px; box-shadow: 0 4px 0 rgba(58, 43, 82, 0.1); }
.card-head { display: flex; align-items: center; gap: 8px; }
.card-head h3 { margin: 0; font-size: 1.15rem; font-weight: 800; }
.head-end { margin-left: auto; display: flex; }
summary.card-head { list-style: none; cursor: pointer; }
summary.card-head::-webkit-details-marker { display: none; }
summary.card-head::after { content: "▾"; margin-left: auto; color: #8a7aa3; font-size: 1.1rem; }
details[open] > summary.card-head::after { content: "▴"; }
details[open] > summary.card-head { margin-bottom: 10px; }
.card-ico { width: 32px; height: 32px; flex-shrink: 0; }

.how-text { margin: 10px 0 0; white-space: pre-wrap; line-height: 1.7; font-size: 1.05rem; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
.how-text.font-urdu { font-size: 1.3rem; line-height: 2.4; }
.how-text.rtl { direction: rtl; text-align: right; }
.how-en { margin-top: 8px; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
.how-en summary { cursor: pointer; color: #8a7aa3; font-weight: 700; font-size: 0.9rem; }
.how-en p { margin: 6px 0 0; white-space: pre-wrap; line-height: 1.6; color: #4b3d63; }

.faces { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 12px; justify-content: center; }
.face-wrap { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.face {
  position: relative; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 8px 10px 6px;
  border: 3px solid transparent; border-radius: 20px; background: #f6f2ff; cursor: pointer; font: inherit; color: var(--ink);
  min-width: 90px; transition: transform 0.1s;
}
.face:active { transform: scale(0.96); }
.face :deep(.avatar) { filter: grayscale(0.6); opacity: 0.75; transition: filter 0.2s, opacity 0.2s; }
.face.on { border-color: #2fc274; background: #e3fbef; }
.face.on :deep(.avatar) { filter: none; opacity: 1; }
.face-name { font-weight: 800; font-size: 1rem; }
.face-tick {
  position: absolute; top: 2px; right: 8px; width: 26px; height: 26px; border-radius: 50%;
  display: grid; place-items: center; background: #e2dcef; color: #fff; font-weight: 800; border: 2px solid #fff;
  transform: scale(0.8); transition: background 0.15s, transform 0.15s;
}
.face.on .face-tick { background: #2fc274; transform: scale(1); }
.driver-btn { font: inherit; font-size: 0.8rem; font-weight: 800; padding: 0 10px; border: 2px solid #f0e2a0; border-radius: 999px; background: #fff; color: #a98608; cursor: pointer; }
.driver-btn.active { background: #FFF8C9; border-color: #E0A800; }

.note-kids { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.note-kid { display: inline-flex; align-items: center; gap: 6px; padding: 2px 12px 2px 2px; border-radius: 999px; border: 2px solid transparent; background: #f6f2ff; cursor: pointer; font: inherit; font-weight: 800; color: var(--ink); }
.note-kid.on { border-color: #C39BFF; background: #fff; }
.obs-textarea { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 2px solid #e2dcef; border-radius: 16px; font: inherit; font-size: 1rem; resize: vertical; margin-bottom: 8px; background: #fff; color: var(--ink); }
.obs-textarea:focus { outline: none; border-color: #C39BFF; }
.journey-text { white-space: pre-wrap; line-height: 1.7; margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
.field-error { color: #b0365e; font-weight: 700; margin: 8px 0 0; }
.success-msg { color: #1e7a4c; font-weight: 700; margin: 0 0 8px; }

.play-nav { display: flex; align-items: center; justify-content: center; gap: 18px; padding: 6px 0; }
.dots { display: flex; gap: 6px; flex-wrap: wrap; justify-content: center; max-width: 60vw; }
.dot { width: 12px; height: 12px; border-radius: 50%; background: rgba(255, 255, 255, 0.85); transition: transform 0.15s; }
.dot.done { background: #7FE3A6; }
.dot.on { background: var(--deep); transform: scale(1.3); }

/* Celebration */
.cheer {
  position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); z-index: 45;
  display: flex; align-items: center; gap: 10px; padding: 8px 20px 8px 10px; border-radius: 999px;
  background: #fff; font-weight: 800; font-size: 1.1rem; box-shadow: 0 10px 28px rgba(35, 22, 74, 0.25);
}
.cheer svg { width: 44px; height: 44px; animation: twinkle 0.6s ease-out; }
.pop-enter-active { transition: transform 0.35s cubic-bezier(0.2, 1.6, 0.4, 1), opacity 0.2s; }
.pop-enter-from { transform: translateX(-50%) scale(0.5); opacity: 0; }

/* ─── Narrower screens ───────────────────────────────────────────────────── */
@media (max-width: 1180px) {
  .cols { grid-template-columns: minmax(0, 1fr); }
  .col-side { position: static; max-height: none; overflow: visible; display: contents; }
  /* Stacked: what-to-do above the activity, finishing below it */
  .col-side .how { order: -1; }
}
@media (max-width: 760px) {
  .ph { padding: 10px 12px; }
  .ph-title { font-size: 1.15rem; }
  .ph-title svg { width: 30px; height: 30px; }
  .day-nav { order: 3; width: 100%; justify-content: space-between; }
  .day-label { flex: 1; min-width: 0; }
  .stars { max-width: 55vw; }
  .star { width: 20px; height: 20px; }
  .pb { flex-direction: column; padding: 0 12px; gap: 6px; }
  .rail {
    position: static; flex-direction: row; max-height: none; overflow-x: auto; overflow-y: visible;
    width: 100%; box-sizing: border-box; padding: 8px 6px 12px;
  }
  .tile { width: 72px; height: 72px; border-radius: 18px; }
  .tile-art { width: 42px; height: 42px; }
  .stage { width: 100%; padding-top: 0; }
  .hero { padding: 12px 48px 12px 12px; gap: 12px; border-radius: 22px; }
  .hero-art { width: 64px; height: 64px; padding: 6px; border-radius: 18px; }
  .hero-text h2 { font-size: 1.25rem; }
  .hero-done { position: absolute; bottom: -10px; right: -6px; width: 40px; height: 40px; }
  .hero-done svg { width: 22px; height: 22px; }
  .content-box { padding: 10px; border-radius: 18px; }
  .guide-fab .fab-label { display: none; }
  .cheer { bottom: 84px; font-size: 1rem; max-width: calc(100vw - 32px); }
}

/* Guide dock — floating bottom-right assistant */
.guide-dock { position: fixed; right: 1rem; bottom: 1rem; z-index: 40; display: flex; flex-direction: column; align-items: flex-end; gap: 0.6rem; }
.guide-fab { display: flex; align-items: center; gap: 0.5rem; background: #3a2b52; color: #fff; border: none; border-radius: 999px; padding: 0.6rem 1rem; cursor: pointer; font: inherit; font-size: 1rem; font-weight: 800; box-shadow: 0 6px 18px rgba(58, 43, 82, 0.3); }
.guide-fab .fab-ico { font-size: 1.2rem; }
.guide-panel { width: min(380px, calc(100vw - 2rem)); background: #fff; border-radius: 18px; padding: 0.9rem; box-shadow: 0 12px 32px rgba(15, 23, 42, 0.18); font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
.guide-panel-head { display: flex; flex-direction: column; gap: 0.1rem; margin-bottom: 0.6rem; }
.guide-panel-head strong { font-size: 0.95rem; color: #0f172a; }
.guide-sub { font-size: 0.72rem; color: #94a3b8; }
</style>
