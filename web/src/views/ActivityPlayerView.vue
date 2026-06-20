<script setup>
// Activity Player (parent session mode). The guiding parent picks a date, then
// plays through that day's scheduled activities one at a time — reading the
// content aloud with the child, recording completion scores and observations.
// This is the authed, parent-facing counterpart to the link-scoped child view.
import { ref, computed, watch, onMounted } from "vue";
import { collection, query, orderBy, getDocs, doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthStore } from "@/stores/auth";
import { submitScore, addObservation, updateBlockStatus } from "@/services/player";
import { getActivityJourney } from "@/services/brief";
import ActivityContent from "@/components/ActivityContent.vue";
import SpeakButton from "@/components/SpeakButton.vue";

const auth = useAuthStore();

const TYPE_ICONS = {
  quran: "📖", noorani_qaida: "🔤",
  arabic_reading: "📗", urdu_reading: "📙", english_reading: "📘", story_reading: "📚", conversation: "💬",
  mathematics: "🔢", computer: "💻", ai_robotics: "🤖", physical: "🏃", teaching: "📝",
};
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

// Resolve the children this activity is for. The stored targetChildren may be
// empty OR contain stale/garbage ids that don't match any current child — in
// either case we fall back to ALL children so the parent can always record who
// took part (and always sees a name), never a dead-end "No children assigned".
const targetChildren = computed(() => {
  const a = currentActivity.value;
  if (!a && !currentBlock.value) return [];
  const ids = (a?.targetChildren?.length ? a.targetChildren : currentBlock.value?.targetChildren) || [];
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

onMounted(async () => {
  await loadChildren();
  await loadDay();
});
watch(dateKey, () => loadDay());
</script>

<template>
  <div class="session">
    <!-- Header: date picker + progress -->
    <div class="session-head">
      <div>
        <h1>Activity Player</h1>
        <p class="sub">Run the day's activities together and record how they went.</p>
      </div>
      <div class="day-pick">
        <label class="date-label">
          Day
          <input type="date" v-model="dateKey" class="date-input" />
        </label>
        <span v-if="dayHasBlocks" class="progress-chip">
          {{ completedCount }} / {{ blocks.length }} done
        </span>
      </div>
    </div>

    <div v-if="loadingDay" class="state">Loading the day…</div>

    <div v-else-if="!dayHasBlocks" class="state empty">
      <p>Nothing scheduled for this day.</p>
      <router-link to="/planner" class="btn secondary">Open the Planner</router-link>
    </div>

    <template v-else>
      <!-- Activity strip (jump between activities) -->
      <div class="strip">
        <button
          v-for="(b, i) in blocks"
          :key="b.id"
          class="strip-item"
          :class="{ active: i === index, done: blockDone[b.id] }"
          @click="go(i)"
        >
          <span class="strip-ico">{{ TYPE_ICONS[b.type] || "📝" }}</span>
          <span class="strip-time">{{ b.scheduledTime }}</span>
          <span v-if="blockDone[b.id]" class="strip-check">✓</span>
        </button>
      </div>

      <!-- Current activity -->
      <div v-if="currentBlock" class="play-card">
        <div class="play-head">
          <span class="play-ico">{{ TYPE_ICONS[currentBlock.type] || "📝" }}</span>
          <div class="play-titles">
            <h2>{{ currentBlock.activityTitle }}</h2>
            <div class="play-meta">
              <span :class="`rank-badge rank-${currentBlock.complexityRank}`">{{ RANK_LABELS[currentBlock.complexityRank] }}</span>
              <span class="meta-chip">{{ currentBlock.subject }}</span>
              <span class="meta-chip">{{ currentBlock.scheduledTime }} · {{ currentBlock.durationMinutes }} min</span>
              <span v-if="blockDone[currentBlock.id]" class="meta-chip done-chip">Done ✓</span>
            </div>
            <div v-if="targetChildren.length" class="play-children">
              <span class="for-label">For</span>
              <span v-for="c in targetChildren" :key="c.id" class="child-chip">{{ c.name || c.id }}</span>
              <span v-if="coopMode" class="child-chip coop">Co-op (together)</span>
              <span v-else-if="targetChildren.length > 1" class="child-chip both">Combined</span>
            </div>
          </div>
        </div>

        <!-- Parent instructions -->
        <details v-if="currentActivity?.parentInstructions" class="collapse">
          <summary>Parent instructions</summary>
          <p class="collapse-body">{{ currentActivity.parentInstructions }}</p>
          <div v-if="currentActivity.parentInstructionsTranslit" class="mt-instructions">
            <div class="mt-head">
              <span class="mt-label">In your language</span>
              <SpeakButton
                :text="currentActivity.parentInstructionsNative || currentActivity.parentInstructionsTranslit"
                size="sm"
                label="Listen"
              />
            </div>
            <p class="mt-translit">{{ currentActivity.parentInstructionsTranslit }}</p>
          </div>
        </details>

        <!-- Ready-to-do content -->
        <div v-if="activityCache[currentBlock.id]?.loading" class="state">Loading activity…</div>
        <div v-else-if="currentActivity?.content" class="content-box">
          <ActivityContent :content="currentActivity.content" />
        </div>
        <p v-else class="state muted">
          No interactive content for this activity yet — follow the instructions above.
        </p>

        <!-- Where this fits in the plan -->
        <section class="record">
          <button class="journey-toggle" @click="toggleJourney" :aria-expanded="journeyOpen">
            <span>🧭 Where this fits in the plan</span>
            <span class="chev">{{ journeyOpen ? "▲" : "▼" }}</span>
          </button>
          <div v-if="journeyOpen" class="journey-body">
            <p v-if="journeyLoading" class="muted">Reading the plan…</p>
            <p v-else-if="journeyError" class="field-error">{{ journeyError }}</p>
            <p v-else class="journey-text">{{ journeyText }}</p>
          </div>
        </section>

        <!-- Completion -->
        <section class="record">
          <h3>Mark completion</h3>
          <p v-if="blockDone[currentBlock.id]" class="done-banner">
            ✓ This activity is marked <strong>done</strong> for {{ dateKey }}.
          </p>
          <p v-else class="record-hint">Tick each child who completed this activity, then save to mark it done.</p>
          <template v-if="scores[currentBlock.id]">
            <div v-if="coopMode" class="coop-note">Co-op activity — optionally mark the driving child.</div>
            <div class="score-rows">
              <div v-for="child in targetChildren" :key="child.id" class="score-row">
                <label class="score-check">
                  <input type="checkbox" v-model="scores[currentBlock.id][child.id].completed" />
                  <span>{{ child.name || child.id }}</span>
                  <span class="score-state" :class="{ on: scores[currentBlock.id][child.id]?.completed }">
                    {{ scores[currentBlock.id][child.id]?.completed ? "Completed" : "Not done" }}
                  </span>
                </label>
                <button v-if="coopMode" class="driver-btn" :class="{ active: scores[currentBlock.id][child.id]?.isDriving }" @click="toggleDriver(currentBlock.id, child.id)">
                  {{ scores[currentBlock.id][child.id]?.isDriving ? "★ Driver" : "Driver?" }}
                </button>
              </div>
            </div>
            <p v-if="saveError" class="field-error">{{ saveError }}</p>
            <div class="record-actions">
              <button class="btn primary" :disabled="saving" @click="saveScores">
                {{ saving ? "Saving…" : (blockDone[currentBlock.id] ? "Update & continue" : "Save & mark done") }}
              </button>
              <button v-if="blockDone[currentBlock.id]" class="btn secondary" :disabled="saving" @click="reopenBlock">
                Mark not done
              </button>
            </div>
          </template>
        </section>

        <!-- Observation -->
        <section class="record">
          <h3>Observation</h3>
          <div v-if="targetChildren.length" class="obs-row">
            <select v-model="obsChild[currentBlock.id]" class="obs-select">
              <option v-for="c in targetChildren" :key="c.id" :value="c.id">{{ c.name || c.id }}</option>
            </select>
          </div>
          <textarea v-model="obsText[currentBlock.id]" class="obs-textarea" rows="3" placeholder="What did you notice?"></textarea>
          <p v-if="obsSavedFor === currentBlock.id" class="success-msg">✓ Observation saved.</p>
          <button class="btn secondary" :disabled="obsSaving || !obsText[currentBlock.id]?.trim()" @click="saveObservation">
            {{ obsSaving ? "Saving…" : "Save observation" }}
          </button>
        </section>

        <!-- Nav -->
        <div class="play-nav">
          <button class="btn secondary" :disabled="index === 0" @click="go(index - 1)">← Previous</button>
          <span class="nav-count">{{ index + 1 }} of {{ blocks.length }}</span>
          <button class="btn secondary" :disabled="index >= blocks.length - 1" @click="go(index + 1)">Next →</button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.session { max-width: 720px; margin: 0 auto; padding-bottom: 3rem; }
.session-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; flex-wrap: wrap; margin-bottom: 1rem; }
.session-head h1 { margin: 0; font-size: 1.4rem; }
.sub { margin: 0.25rem 0 0; color: #64748b; font-size: 0.85rem; }
.day-pick { display: flex; align-items: center; gap: 0.75rem; }
.date-label { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.78rem; color: #64748b; }
.date-input { padding: 0.4rem 0.5rem; border: 1px solid #cbd5e1; border-radius: 8px; font: inherit; }
.progress-chip { background: #f1f5f9; color: #334155; font-size: 0.8rem; font-weight: 600; padding: 0.3rem 0.7rem; border-radius: 999px; align-self: flex-end; }

.state { padding: 2rem 0; color: #94a3b8; }
.state.empty { display: flex; flex-direction: column; gap: 1rem; align-items: flex-start; }
.muted { color: #94a3b8; }

.strip { display: flex; gap: 0.4rem; overflow-x: auto; padding: 0.25rem 0 0.75rem; }
.strip-item { position: relative; display: flex; flex-direction: column; align-items: center; gap: 0.1rem; min-width: 60px; padding: 0.45rem 0.5rem; border: 1px solid #e2e8f0; border-radius: 10px; background: #fff; cursor: pointer; font-size: 0.7rem; color: #64748b; }
.strip-item.active { border-color: #0b1f3a; background: #0b1f3a; color: #fff; }
.strip-item.done:not(.active) { background: #f0fdf4; border-color: #bbf7d0; }
.strip-ico { font-size: 1.1rem; }
.strip-check { position: absolute; top: -6px; right: -6px; background: #16a34a; color: #fff; width: 16px; height: 16px; border-radius: 50%; font-size: 0.65rem; display: flex; align-items: center; justify-content: center; }

.play-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem; }
.play-head { display: flex; gap: 0.75rem; align-items: flex-start; }
.play-ico { font-size: 2rem; }
.play-titles h2 { margin: 0 0 0.35rem; font-size: 1.2rem; color: #0f172a; }
.play-meta { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.meta-chip { font-size: 0.72rem; padding: 0.12rem 0.5rem; border-radius: 999px; background: #f1f5f9; color: #475569; }
.done-chip { background: #dcfce7; color: #166534; }
.rank-badge { font-size: 0.7rem; font-weight: 700; padding: 0.12rem 0.5rem; border-radius: 999px; }
.rank-1 { background: #dcfce7; color: #166534; } .rank-2 { background: #dbeafe; color: #1e40af; }
.rank-3 { background: #fef9c3; color: #854d0e; } .rank-4 { background: #fed7aa; color: #9a3412; }
.rank-5 { background: #f3e8ff; color: #6b21a8; }

.play-children { display: flex; flex-wrap: wrap; align-items: center; gap: 0.35rem; margin-top: 0.5rem; }
.for-label { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #94a3b8; margin-right: 0.1rem; }
.child-chip { font-size: 0.72rem; font-weight: 600; padding: 0.12rem 0.55rem; border-radius: 999px; background: #e0e7ff; color: #3730a3; }
.child-chip.coop { background: #e0f2fe; color: #0369a1; }
.child-chip.both { background: #dcfce7; color: #166534; }

.collapse { background: #f8fafc; border-radius: 10px; padding: 0.6rem 0.8rem; }
.collapse summary { cursor: pointer; font-size: 0.85rem; color: #475569; }
.collapse-body { margin: 0.5rem 0 0; white-space: pre-wrap; color: #1e293b; line-height: 1.6; }
.mt-instructions { margin-top: 0.6rem; padding-top: 0.5rem; border-top: 1px dashed #e2e8f0; }
.mt-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; margin-bottom: 0.3rem; }
.mt-label { font-size: 0.68rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; }
.mt-translit { white-space: pre-wrap; color: #334155; line-height: 1.6; margin: 0; }
.content-box { background: #fbfdff; border: 1px solid #eef2f7; border-radius: 12px; padding: 1rem; }

.record { border-top: 1px solid #f1f5f9; padding-top: 0.9rem; }
.record h3 { margin: 0 0 0.6rem; font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; }
.journey-toggle { display: flex; align-items: center; justify-content: space-between; width: 100%; background: none; border: none; cursor: pointer; font: inherit; font-size: 0.92rem; font-weight: 600; color: #334155; padding: 0; }
.journey-toggle .chev { color: #94a3b8; font-size: 0.8rem; }
.journey-body { margin-top: 0.6rem; }
.journey-text { white-space: pre-wrap; color: #1e293b; line-height: 1.7; margin: 0; }
.record-hint { font-size: 0.82rem; color: #64748b; margin: 0 0 0.6rem; }
.done-banner { font-size: 0.85rem; color: #166534; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 0.4rem 0.6rem; margin: 0 0 0.6rem; }
.record-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.score-state { font-size: 0.7rem; font-weight: 600; padding: 0.08rem 0.45rem; border-radius: 999px; background: #f1f5f9; color: #94a3b8; }
.score-state.on { background: #dcfce7; color: #166534; }
.coop-note { background: #f0f9ff; color: #0369a1; padding: 0.35rem 0.6rem; border-radius: 6px; font-size: 0.82rem; margin-bottom: 0.5rem; }
.score-rows { display: flex; flex-direction: column; gap: 0.4rem; margin-bottom: 0.75rem; }
.score-row { display: flex; align-items: center; gap: 0.75rem; }
.score-check { display: flex; align-items: center; gap: 0.5rem; cursor: pointer; flex: 1; font-weight: 500; color: #1e293b; }
.driver-btn { font-size: 0.72rem; padding: 0.18rem 0.55rem; border: 1px solid #cbd5e1; border-radius: 999px; background: #f8fafc; color: #64748b; cursor: pointer; }
.driver-btn.active { background: #fef9c3; border-color: #d97706; color: #92400e; }

.obs-row { margin-bottom: 0.5rem; }
.obs-select { padding: 0.3rem 0.5rem; border: 1px solid #cbd5e1; border-radius: 6px; font: inherit; }
.obs-textarea { width: 100%; box-sizing: border-box; padding: 0.6rem; border: 1px solid #cbd5e1; border-radius: 8px; font: inherit; font-size: 0.9rem; resize: vertical; margin-bottom: 0.5rem; }

.play-nav { display: flex; align-items: center; justify-content: space-between; border-top: 1px solid #f1f5f9; padding-top: 0.85rem; }
.nav-count { font-size: 0.8rem; color: #94a3b8; }

.btn { padding: 0.5rem 1.1rem; border-radius: 8px; border: none; cursor: pointer; font: inherit; font-size: 0.9rem; }
.btn.primary { background: #0b1f3a; color: #fff; }
.btn.secondary { background: #f1f5f9; color: #334155; border: 1px solid #cbd5e1; }
.btn:disabled { opacity: 0.55; cursor: not-allowed; }
.field-error { color: #b91c1c; font-size: 0.82rem; margin: 0.3rem 0; }
.success-msg { color: #15803d; font-size: 0.85rem; margin: 0 0 0.5rem; }
</style>
