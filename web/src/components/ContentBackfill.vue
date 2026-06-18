<script setup>
// Background auto-backfill: when a parent/owner has activities that were created
// before auto-content, generate their content automatically (no per-activity
// clicking). Runs once per session, batch by batch, with a small progress
// banner. Idempotent — only ever touches activities still missing content.
import { ref, computed, watch } from "vue";
import { useActivityStore } from "@/stores/activities";
import { useAuthStore } from "@/stores/auth";
import { backfillActivityContent } from "@/services/activityContent";

const activities = useActivityStore();
const auth = useAuthStore();

const running = ref(false);
const done = ref(false);
const processed = ref(0);
const target = ref(0);
let started = false;

const canWrite = computed(() => auth.role === "owner" || auth.role === "parent");
const missingCount = computed(() => activities.activities.filter((a) => !a.content).length);

async function runLoop() {
  if (running.value) return;
  running.value = true;
  processed.value = 0;
  target.value = missingCount.value;
  try {
    let guard = 0;
    while (guard++ < 60) {
      const res = await backfillActivityContent(6);
      if (!res || res.configured === false || !res.total) break;
      processed.value += res.processed || 0;
      if (res.total > target.value) target.value = res.total + processed.value;
      if (res.remaining <= 0) break;
      if ((res.processed || 0) === 0) break; // persistent failures — stop looping
    }
    done.value = true;
  } catch {
    // surface nothing intrusive; per-activity Generate remains as a fallback
  } finally {
    running.value = false;
    setTimeout(() => (done.value = false), 5000);
  }
}

watch(
  [() => auth.familyId, () => activities.loading, missingCount, canWrite],
  () => {
    if (started || running.value) return;
    if (!auth.familyId || !canWrite.value || activities.loading) return;
    if (missingCount.value > 0) { started = true; runLoop(); }
  },
  { immediate: true }
);
</script>

<template>
  <transition name="fade">
    <div v-if="running || done" class="backfill-banner" :class="{ done }">
      <span v-if="running" class="spinner" aria-hidden="true"></span>
      <span v-if="running">
        Preparing activity content… {{ processed }}<span v-if="target">/{{ target }}</span>
      </span>
      <span v-else>✓ Activity content ready</span>
    </div>
  </transition>
</template>

<style scoped>
.backfill-banner {
  position: fixed; bottom: 1rem; left: 50%; transform: translateX(-50%);
  z-index: 200; display: flex; align-items: center; gap: 0.6rem;
  background: #0b1f3a; color: #fff; padding: 0.6rem 1.1rem; border-radius: 999px;
  font-size: 0.88rem; box-shadow: 0 4px 16px rgba(0,0,0,0.25);
}
.backfill-banner.done { background: #15803d; }
.spinner {
  width: 14px; height: 14px; border-radius: 50%;
  border: 2px solid rgba(255,255,255,0.4); border-top-color: #fff;
  animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.fade-enter-active, .fade-leave-active { transition: opacity 0.3s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
