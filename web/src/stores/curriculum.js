// Live Pinia store for a family's curriculum documents. Binds an onSnapshot
// listener to families/{id}/curriculum ordered by createdAt desc so the most
// recent plan surfaces first. Subjects subcollection is loaded on-demand in
// the view (too granular for a always-on listener).
import { defineStore } from "pinia";
import { ref, computed, watch } from "vue";
import { collection, query, orderBy, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthStore } from "./auth";

export const useCurriculumStore = defineStore("curriculum", () => {
  const curricula = ref([]);
  const loading = ref(false);

  // The most recent active plan; falls back to the newest draft if none active.
  const active = computed(
    () => curricula.value.find((c) => c.status === "active") || curricula.value[0] || null
  );

  let stop = null;

  function bind(familyId) {
    if (stop) { stop(); stop = null; }
    if (!familyId) { curricula.value = []; return; }
    loading.value = true;
    const q = query(
      collection(db, "families", familyId, "curriculum"),
      orderBy("createdAt", "desc")
    );
    stop = onSnapshot(q, (snap) => {
      curricula.value = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      loading.value = false;
    });
  }

  function unbind() {
    if (stop) { stop(); stop = null; }
    curricula.value = [];
  }

  const auth = useAuthStore();
  watch(
    () => auth.familyId,
    (id) => (id ? bind(id) : unbind()),
    { immediate: true }
  );

  return { curricula, active, loading };
});
