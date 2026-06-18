// Live guardians + children for the current family.
import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { collection, onSnapshot, query, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthStore } from "./auth";

export const useProfilesStore = defineStore("profiles", () => {
  const guardians = ref([]);
  const children = ref([]);

  let stops = [];
  function unbind() {
    stops.forEach((fn) => fn());
    stops = [];
    guardians.value = [];
    children.value = [];
  }

  function bind(familyId) {
    unbind();
    if (!familyId) return;
    stops.push(
      onSnapshot(
        query(collection(db, "families", familyId, "guardians"), orderBy("createdAt", "asc")),
        (snap) => { guardians.value = snap.docs.map((d) => ({ id: d.id, ...d.data() })); },
        () => { guardians.value = []; }
      )
    );
    stops.push(
      onSnapshot(
        query(collection(db, "families", familyId, "children"), orderBy("createdAt", "asc")),
        (snap) => { children.value = snap.docs.map((d) => ({ id: d.id, ...d.data() })); },
        () => { children.value = []; }
      )
    );
  }

  const auth = useAuthStore();
  watch(() => auth.familyId, (id) => bind(id), { immediate: true });

  return { guardians, children, bind, unbind };
});
