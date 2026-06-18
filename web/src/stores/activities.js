// Live store for a family's generated activities. Binds an onSnapshot listener
// ordered by complexityRank asc, createdAt asc so activities are always shown
// basic → advanced within each subject.
import { defineStore } from "pinia";
import { ref, computed, watch } from "vue";
import { collection, query, orderBy, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthStore } from "./auth";

export const useActivityStore = defineStore("activities", () => {
  const activities = ref([]);
  const loading = ref(false);

  // Activities grouped by subjectId, sorted basic→advanced within each group.
  const bySubject = computed(() => {
    const map = {};
    for (const a of activities.value) {
      const key = a.subjectId || "__unknown__";
      if (!map[key]) map[key] = { subjectId: key, subject: a.subject || key, items: [] };
      map[key].items.push(a);
    }
    return Object.values(map);
  });

  let stop = null;

  function bind(familyId) {
    if (stop) { stop(); stop = null; }
    if (!familyId) { activities.value = []; return; }
    loading.value = true;
    const q = query(
      collection(db, "families", familyId, "activities"),
      orderBy("complexityRank", "asc"),
      orderBy("createdAt", "asc")
    );
    stop = onSnapshot(q, (snap) => {
      activities.value = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      loading.value = false;
    });
  }

  function unbind() {
    if (stop) { stop(); stop = null; }
    activities.value = [];
  }

  const auth = useAuthStore();
  watch(
    () => auth.familyId,
    (id) => (id ? bind(id) : unbind()),
    { immediate: true }
  );

  return { activities, bySubject, loading };
});
