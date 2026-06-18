// Family store — live tenant data for the current user's family: the family
// doc, profile (name + guiding light), and members. Bound when a familyId is
// known and torn down on sign-out / family change.
import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { doc, collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthStore } from "./auth";

export const useFamilyStore = defineStore("family", () => {
  const family = ref(null);
  const profile = ref(null);
  const members = ref([]);
  const loading = ref(false);

  let stops = [];
  function unbind() {
    stops.forEach((fn) => fn());
    stops = [];
    family.value = null;
    profile.value = null;
    members.value = [];
  }

  function bind(familyId) {
    unbind();
    if (!familyId) return;
    loading.value = true;
    const root = doc(db, "families", familyId);
    stops.push(
      onSnapshot(root, (snap) => {
        family.value = snap.exists() ? { id: snap.id, ...snap.data() } : null;
        loading.value = false;
      })
    );
    stops.push(
      onSnapshot(doc(db, "families", familyId, "profile", "family"), (snap) => {
        profile.value = snap.exists() ? snap.data() : null;
      })
    );
    stops.push(
      onSnapshot(collection(db, "families", familyId, "members"), (snap) => {
        members.value = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
      })
    );
  }

  // Auto-bind to the auth store's current family.
  const auth = useAuthStore();
  watch(
    () => auth.familyId,
    (id) => bind(id),
    { immediate: true }
  );

  return { family, profile, members, loading, bind, unbind };
});
