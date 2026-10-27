<script setup>
// Full read-only preview of a planned activity, opened from the eye on a planner
// card: what to tell the children (in the parent's own language first), the
// walkthrough, and the actual content — then Start or close.
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthStore } from "@/stores/auth";
import { useActivityStore } from "@/stores/activities";
import { useProfilesStore } from "@/stores/profiles";
import ActivityContent from "@/components/ActivityContent.vue";
import SpeakButton from "@/components/SpeakButton.vue";
import ChildAvatar from "@/components/ChildAvatar.vue";
import ActivityArt from "./ActivityArt.vue";

const props = defineProps({
  activityId: { type: String, required: true },
  // The planned block, when previewing from the grid (enables Start + Remove).
  block: { type: Object, default: null },
  dateKey: { type: String, default: "" },
  dayText: { type: String, default: "" },
  tint: { type: Object, default: () => ({ bg: "#F3E8FF", deep: "#7B3FD1" }) },
});
const emit = defineEmits(["close", "remove"]);

const auth = useAuthStore();
const activityStore = useActivityStore();
const profiles = useProfilesStore();

const fetched = ref(null);
const loading = ref(false);
const activity = computed(() =>
  activityStore.activities.find((a) => a.id === props.activityId) || fetched.value
);

watch(() => props.activityId, async (id) => {
  if (!id || activityStore.activities.some((a) => a.id === id) || !auth.familyId) return;
  loading.value = true;
  try {
    const snap = await getDoc(doc(db, "families", auth.familyId, "activities", id));
    fetched.value = snap.exists() ? { id: snap.id, ...snap.data() } : null;
  } finally {
    loading.value = false;
  }
}, { immediate: true });

const src = computed(() => activity.value || props.block || {});
const title = computed(() => src.value.title || src.value.activityTitle || "Activity");

const kids = computed(() => {
  const ids = (src.value.targetChildren || []).filter((id) => profiles.children.some((c) => c.id === id));
  return ids.length ? profiles.children.filter((c) => ids.includes(c.id)) : profiles.children;
});

const nativeText = computed(() => activity.value?.parentInstructionsNative || activity.value?.parentInstructionsTranslit || "");
const nativeIsScript = computed(() => Boolean(activity.value?.parentInstructionsNative));

// Per-child versions, when the content was differentiated.
const childTab = ref("");
const byChildKids = computed(() => {
  const m = activity.value?.contentByChild;
  return m ? kids.value.filter((c) => m[c.id]) : [];
});
watch(byChildKids, (k) => {
  if (k.length && !k.some((c) => c.id === childTab.value)) childTab.value = k[0].id;
}, { immediate: true });
const content = computed(() =>
  (childTab.value && activity.value?.contentByChild?.[childTab.value]) || activity.value?.content || null
);

const confirmRemove = ref(false);

function onKey(e) { if (e.key === "Escape") emit("close"); }
onMounted(() => {
  window.addEventListener("keydown", onKey);
  document.body.style.overflow = "hidden";
});
onUnmounted(() => {
  window.removeEventListener("keydown", onKey);
  document.body.style.overflow = "";
});
</script>

<template>
  <teleport to="body">
    <div class="pv-backdrop" @click.self="emit('close')">
      <div class="pv" role="dialog" aria-modal="true" aria-labelledby="pv-title" :style="{ '--bg': tint.bg, '--deep': tint.deep }">
        <header class="pv-head">
          <div class="pv-art"><ActivityArt :type="src.type" /></div>
          <div class="pv-head-text">
            <h2 id="pv-title" class="pv-title">{{ title }}</h2>
            <div class="pv-chips">
              <span v-if="dayText" class="pv-chip">
                <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3" fill="#fff" /><rect x="3" y="5" width="18" height="5" rx="2" fill="var(--deep)" /></svg>
                {{ dayText }}
              </span>
              <span v-if="src.durationMinutes" class="pv-chip">
                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="#fff" /><path d="M12 7 V12 L15.5 14" stroke="var(--deep)" stroke-width="2.4" fill="none" stroke-linecap="round" /></svg>
                {{ src.durationMinutes }} min
              </span>
              <span class="pv-kids">
                <ChildAvatar v-for="c in kids" :key="c.id" :child="c" :size="30" />
              </span>
            </div>
          </div>
          <button class="pv-close" type="button" aria-label="Close preview" @click="emit('close')">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6 L18 18 M18 6 L6 18" stroke="currentColor" stroke-width="3" stroke-linecap="round" /></svg>
          </button>
        </header>

        <div class="pv-body">
          <p v-if="loading" class="pv-muted">Loading…</p>
          <p v-else-if="!activity" class="pv-muted">This activity’s details aren’t available any more.</p>
          <template v-else>
            <section class="pv-section">
              <div class="pv-section-head">
                <h3>What to do</h3>
                <SpeakButton v-if="nativeText" :text="nativeText" size="sm" label="Listen" />
              </div>
              <p v-if="nativeText" class="pv-instructions" :class="{ 'font-urdu': nativeIsScript, rtl: nativeIsScript }">{{ nativeText }}</p>
              <details v-if="nativeText && activity.parentInstructions" class="pv-english">
                <summary>In English</summary>
                <p class="pv-instructions">{{ activity.parentInstructions }}</p>
              </details>
              <p v-else-if="!nativeText" class="pv-instructions">{{ activity.parentInstructions || "No instructions yet." }}</p>
            </section>

            <section v-if="activity.exampleWalkthrough" class="pv-section">
              <h3>Example</h3>
              <p class="pv-instructions">{{ activity.exampleWalkthrough }}</p>
            </section>

            <section v-if="content" class="pv-section">
              <h3>Activity</h3>
              <div v-if="byChildKids.length > 1" class="pv-tabs">
                <button
                  v-for="c in byChildKids" :key="c.id" type="button"
                  class="pv-tab" :class="{ on: c.id === childTab }" @click="childTab = c.id"
                ><ChildAvatar :child="c" :size="24" /> {{ c.name }}</button>
              </div>
              <ActivityContent :key="childTab || 'all'" :content="content" :audio-overrides="activity.audioOverrides || {}" />
            </section>
          </template>
        </div>

        <footer class="pv-foot">
          <template v-if="block && confirmRemove">
            <span class="pv-confirm">Remove from this day?</span>
            <button class="pv-btn" type="button" @click="confirmRemove = false">No</button>
            <button class="pv-btn danger" type="button" @click="emit('remove')">Yes, remove</button>
          </template>
          <template v-else>
            <button v-if="block" class="pv-btn ghost" type="button" aria-label="Remove from planner" @click="confirmRemove = true">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7 H19 M9 7 V4 H15 V7 M7 7 L8 20 H16 L17 7" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round" /></svg>
              Remove
            </button>
            <span class="pv-spacer"></span>
            <button class="pv-btn" type="button" @click="emit('close')">Close</button>
            <router-link
              class="pv-btn go"
              :to="block ? `/activity/${activityId}?blockId=${block.id}&dateKey=${dateKey}` : `/activity/${activityId}`"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5 L19 12 L8 19 Z" fill="currentColor" /></svg>
              Start
            </router-link>
          </template>
        </footer>
      </div>
    </div>
  </teleport>
</template>

<style scoped>
.pv-backdrop {
  position: fixed; inset: 0; z-index: 200; background: rgba(35, 22, 74, 0.45);
  display: flex; align-items: center; justify-content: center; padding: 16px;
  animation: pv-fade 0.15s ease-out;
}
.pv {
  width: min(760px, 100%); max-height: calc(100vh - 32px); display: flex; flex-direction: column;
  background: #fff; border-radius: 26px; overflow: hidden;
  box-shadow: 0 10px 0 rgba(58, 43, 82, 0.18), 0 24px 60px rgba(35, 22, 74, 0.35);
  animation: pv-pop 0.28s cubic-bezier(0.2, 1.6, 0.4, 1);
  font-family: "Baloo 2", system-ui, sans-serif; color: #3a2b52;
}
.pv-head { display: flex; align-items: center; gap: 14px; padding: 18px 18px 16px; background: var(--bg); border-bottom: 4px solid var(--deep); }
.pv-art { width: 72px; height: 72px; flex-shrink: 0; background: #fff; border-radius: 22px; padding: 8px; box-shadow: inset 0 -4px 0 rgba(0,0,0,.08); }
.pv-head-text { flex: 1; min-width: 0; }
.pv-title { margin: 0 0 6px; font-size: 1.45rem; font-weight: 800; line-height: 1.15; }
.pv-chips { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.pv-chip { display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px 3px 6px; border-radius: 999px; background: rgba(255,255,255,.7); font-weight: 700; font-size: 0.95rem; }
.pv-chip svg { width: 20px; height: 20px; }
.pv-kids { display: inline-flex; }
.pv-kids > * + * { margin-left: -6px; }
.pv-close { align-self: flex-start; width: 44px; height: 44px; border-radius: 50%; border: none; background: #fff; color: #3a2b52; cursor: pointer; display: grid; place-items: center; box-shadow: 0 3px 0 rgba(58,43,82,.2); }
.pv-close svg { width: 20px; height: 20px; }
.pv-body { flex: 1; overflow-y: auto; padding: 6px 20px 18px; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
.pv-section { margin-top: 16px; }
.pv-section h3 { margin: 0 0 6px; font-family: "Baloo 2", system-ui, sans-serif; font-size: 1.1rem; color: var(--deep); }
.pv-section-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.pv-instructions { margin: 0; font-size: 1.05rem; line-height: 1.6; white-space: pre-wrap; color: #2c2140; }
.pv-instructions.rtl { direction: rtl; text-align: right; font-size: 1.25rem; line-height: 2.1; }
.pv-english { margin-top: 8px; }
.pv-english summary { cursor: pointer; color: #6b5f86; font-weight: 600; }
.pv-muted { color: #8b80a3; }
.pv-tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.pv-tab { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px 4px 4px; border-radius: 999px; border: 2px solid #eee; background: #fff; cursor: pointer; font: inherit; font-weight: 700; }
.pv-tab.on { border-color: var(--deep); background: var(--bg); }
.pv-foot { display: flex; align-items: center; gap: 10px; padding: 14px 18px; border-top: 2px solid #f1ecfa; background: #fbf9ff; }
.pv-spacer { flex: 1; }
.pv-confirm { flex: 1; font-weight: 800; font-size: 1.05rem; }
.pv-btn {
  display: inline-flex; align-items: center; gap: 6px; padding: 10px 18px; border-radius: 999px;
  border: none; background: #fff; color: #3a2b52; font: inherit; font-weight: 800; font-size: 1.05rem;
  cursor: pointer; text-decoration: none; box-shadow: inset 0 -3px 0 rgba(58,43,82,.12), 0 3px 0 rgba(58,43,82,.18);
}
.pv-btn svg { width: 20px; height: 20px; }
.pv-btn.ghost { background: transparent; box-shadow: none; color: #b0365e; padding-left: 6px; }
.pv-btn.danger { background: #ff5d8f; color: #fff; }
.pv-btn.go { background: radial-gradient(circle at 32% 28%, #fff, #ffd93d 55%, #ffb340); color: #3a2b52; padding: 10px 24px; }
@keyframes pv-pop { from { transform: scale(0.85); opacity: 0; } to { transform: scale(1); opacity: 1; } }
@keyframes pv-fade { from { opacity: 0; } }
@media (max-width: 600px) {
  .pv-backdrop { padding: 0; align-items: flex-end; }
  .pv { border-radius: 26px 26px 0 0; max-height: 92vh; }
  .pv-art { width: 56px; height: 56px; }
  .pv-title { font-size: 1.2rem; }
}
@media (prefers-reduced-motion: reduce) { .pv, .pv-backdrop { animation: none; } }
</style>
