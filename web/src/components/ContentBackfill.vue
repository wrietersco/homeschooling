<script setup>
// Content-backfill PROGRESS indicator. The work runs SERVER-SIDE (a scheduled
// Cloud Function drains the queue); this component only SUBSCRIBES to
// families/{familyId}/meta/contentBackfill to show a small progress card.
//
// It does NOT start anything by itself — generation is begun explicitly by the
// user (the "Generate all content" button on the Syllabus page → requestContentBackfill).
// Auto-starting on load was confusing: it kicked off generation the user never
// asked for and resurrected stale "stopped/done" cards on every reload. So now
// the card only appears for a genuinely ACTIVE run, or for a terminal state we
// actually witnessed during this session — never a leftover doc from a past run.
import { ref, computed, watch, onUnmounted } from "vue";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthStore } from "@/stores/auth";
import { requestContentBackfill, stopContentBackfill } from "@/services/activityContent";

const auth = useAuthStore();

const status = ref("");      // queued | running | done | error | cancelled (server)
const mode = ref("fill");    // fill (missing only) | regenerate (overwrite all)
const processed = ref(0);
const total = ref(0);
const remaining = ref(0);
const startedAtMs = ref(0);
const nowMs = ref(Date.now()); // ticks while running so the ETA counts down
const serverLoaded = ref(false); // true once the first progress snapshot arrives
const stopping = ref(false);     // Stop button in flight
const sawActive = ref(false);    // we witnessed an active run THIS session
let stopProgress = null;
let doneTimer = null;
let ticker = null;

const canWrite = computed(() => auth.role === "owner" || auth.role === "parent");
const running = computed(() => status.value === "queued" || status.value === "running");
const done = computed(() => status.value === "done");
const cancelled = computed(() => status.value === "cancelled");
// Show the card for an active run, or a terminal state we actually saw happen
// this session — never a stale "stopped/done" doc resurrected on reload.
const visible = computed(() => running.value || ((done.value || cancelled.value) && sawActive.value));

const percent = computed(() => (total.value > 0 ? Math.min(100, Math.round((processed.value / total.value) * 100)) : 0));

// Rough ETA from observed throughput: rate = done / elapsed, extrapolated over
// what's left. Honest about uncertainty early on, when there's no rate yet.
// Humanise a duration in minutes into d / h / m, only showing the units needed.
function humanizeMinutes(mins) {
  if (mins <= 1) return "~1 min left";
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m && !d) parts.push(`${m}m`); // drop minutes once we're into days — noise
  return `~${parts.join(" ")} left`;
}
const etaText = computed(() => {
  const left = remaining.value || Math.max(0, total.value - processed.value);
  if (left <= 0) return "finishing up…";
  if (processed.value <= 0 || !startedAtMs.value) return "estimating time…";
  const elapsed = Math.max(1000, nowMs.value - startedAtMs.value);
  const perItem = elapsed / processed.value;
  return humanizeMinutes(Math.ceil((left * perItem) / 60000));
});

// Drive the ETA countdown only while work is in flight.
function ensureTicker(on) {
  if (on && !ticker) ticker = setInterval(() => { nowMs.value = Date.now(); }, 1000);
  if (!on && ticker) { clearInterval(ticker); ticker = null; }
}

// Subscribe to the server's progress mirror so the card reflects real work.
function watchProgress(familyId) {
  if (stopProgress) return;
  stopProgress = onSnapshot(
    doc(db, "families", familyId, "meta", "contentBackfill"),
    (snap) => {
      serverLoaded.value = true; // we now know the server-side state (even if absent)
      if (!snap.exists()) return;
      const d = snap.data() || {};
      status.value = d.status || "";
      mode.value = d.mode === "regenerate" ? "regenerate" : "fill";
      processed.value = Number(d.processed || 0);
      total.value = Number(d.total || 0);
      remaining.value = Number(d.remaining || 0);
      const ts = d.startedAt;
      startedAtMs.value = ts?.toMillis ? ts.toMillis() : (ts?.seconds ? ts.seconds * 1000 : startedAtMs.value);
      nowMs.value = Date.now();
      if (running.value) sawActive.value = true; // remember we saw it run (gates terminal cards)
      ensureTicker(running.value);
      // Auto-dismiss the "ready" card a few seconds after completion.
      if (status.value === "done") {
        if (doneTimer) clearTimeout(doneTimer);
        doneTimer = setTimeout(() => { if (status.value === "done") status.value = ""; }, 6000);
      }
    },
    () => { serverLoaded.value = true; /* permission/transient errors — card stays hidden */ }
  );
}

async function kickoff(familyId) {
  watchProgress(familyId);
  try {
    await requestContentBackfill(); // returns immediately; server does the work
  } catch {
    // per-activity Generate remains as a fallback; keep the UI quiet
  }
}

// Stop button — ask the server to cancel; reflect it immediately so the UI
// doesn't keep showing progress while the worker winds down.
async function onStop() {
  if (stopping.value) return;
  stopping.value = true;
  status.value = "cancelled"; // optimistic; the snapshot confirms
  ensureTicker(false);
  try {
    await stopContentBackfill();
  } catch {
    // if it failed, the live snapshot will correct the status back
  } finally {
    stopping.value = false;
  }
}

// Resume after a stop — re-enqueue and let the worker continue from what's left.
function onResume() {
  sawActive.value = true;
  status.value = "queued";
  kickoff(auth.familyId);
}

// Dismiss the stopped card without resuming.
function dismiss() { status.value = ""; sawActive.value = false; }

// Subscribe to the server's progress whenever a family is in context. We never
// auto-START generation here — only reflect a run the user explicitly began.
watch(
  [() => auth.familyId, canWrite],
  () => {
    if (!auth.familyId || !canWrite.value) return;
    if (!stopProgress) watchProgress(auth.familyId);
  },
  { immediate: true }
);

onUnmounted(() => {
  if (stopProgress) stopProgress();
  if (doneTimer) clearTimeout(doneTimer);
  ensureTicker(false);
});
</script>

<template>
  <transition name="fade">
    <div v-if="visible" class="backfill-card" :class="{ done, stopped: cancelled }">
      <div class="bf-head">
        <span v-if="running" class="spinner" aria-hidden="true"></span>
        <span v-else-if="cancelled" class="check" aria-hidden="true">■</span>
        <span v-else class="check" aria-hidden="true">✓</span>
        <span class="bf-title">
          <template v-if="running">{{ mode === "regenerate" ? "Regenerating activity content" : "Preparing activity content" }}</template>
          <template v-else-if="cancelled">Content generation stopped</template>
          <template v-else>Activity content ready</template>
        </span>
        <span class="bf-count">{{ processed }}<span v-if="total"> / {{ total }}</span></span>
        <button
          v-if="running"
          class="bf-stop"
          type="button"
          :disabled="stopping"
          @click="onStop"
        >{{ stopping ? "Stopping…" : "Stop" }}</button>
      </div>
      <div class="bf-bar"><div class="bf-fill" :style="{ width: percent + '%' }"></div></div>
      <div class="bf-sub">
        <template v-if="running">{{ percent }}% · {{ etaText }}</template>
        <template v-else-if="cancelled">{{ processed }} done · stopped with {{ remaining }} remaining</template>
        <template v-else-if="remaining > 0">{{ processed }} ready · {{ remaining }} couldn't be generated</template>
        <template v-else>All {{ total || processed }} activities ready</template>
      </div>
      <div v-if="cancelled" class="bf-actions">
        <button class="bf-btn primary" type="button" @click="onResume">Resume</button>
        <button class="bf-btn" type="button" @click="dismiss">Dismiss</button>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.backfill-card {
  position: fixed; bottom: 1rem; left: 50%; transform: translateX(-50%);
  z-index: 200; width: min(20rem, calc(100vw - 2rem));
  background: #0b1f3a; color: #fff; padding: 0.7rem 0.95rem; border-radius: 0.75rem;
  font-size: 0.85rem; box-shadow: 0 6px 22px rgba(0,0,0,0.28);
}
.backfill-card.done { background: #15803d; }
.backfill-card.stopped { background: #7c2d12; }
.bf-head { display: flex; align-items: center; gap: 0.5rem; }
.bf-title { font-weight: 600; }
.bf-count { margin-left: auto; font-variant-numeric: tabular-nums; opacity: 0.95; }
.bf-stop {
  margin-left: 0.5rem; flex: none; cursor: pointer;
  background: rgba(255,255,255,0.16); color: #fff;
  border: 1px solid rgba(255,255,255,0.35); border-radius: 999px;
  font-size: 0.72rem; font-weight: 600; padding: 0.15rem 0.6rem;
}
.bf-stop:hover:not(:disabled) { background: rgba(255,255,255,0.28); }
.bf-stop:disabled { opacity: 0.6; cursor: default; }
.bf-actions { display: flex; gap: 0.5rem; margin-top: 0.55rem; }
.bf-btn {
  cursor: pointer; flex: 1; border-radius: 0.5rem; padding: 0.3rem 0.6rem;
  font-size: 0.78rem; font-weight: 600;
  background: rgba(255,255,255,0.14); color: #fff; border: 1px solid rgba(255,255,255,0.3);
}
.bf-btn.primary { background: #fff; color: #7c2d12; border-color: #fff; }
.bf-btn:hover { filter: brightness(1.05); }
.bf-bar {
  margin: 0.5rem 0 0.35rem; height: 6px; border-radius: 999px;
  background: rgba(255,255,255,0.18); overflow: hidden;
}
.bf-fill {
  height: 100%; border-radius: 999px; background: #fff;
  transition: width 0.4s ease;
}
.backfill-card.done .bf-fill { background: rgba(255,255,255,0.95); }
.bf-sub { font-size: 0.76rem; opacity: 0.85; }
.spinner {
  width: 14px; height: 14px; border-radius: 50%; flex: none;
  border: 2px solid rgba(255,255,255,0.4); border-top-color: #fff;
  animation: spin 0.7s linear infinite;
}
.check { font-weight: 700; }
@keyframes spin { to { transform: rotate(360deg); } }
.fade-enter-active, .fade-leave-active { transition: opacity 0.3s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
