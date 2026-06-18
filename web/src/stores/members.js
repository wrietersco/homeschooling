// Live store for family members. Used to populate the guardian → member binding
// dropdown and to show pending invites in the profile view.
import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthStore } from "./auth";

export const useMembersStore = defineStore("members", () => {
  const members = ref([]);
  let stop = null;

  function bind(familyId) {
    if (stop) { stop(); stop = null; }
    if (!familyId) { members.value = []; return; }
    stop = onSnapshot(
      collection(db, "families", familyId, "members"),
      (snap) => { members.value = snap.docs.map((d) => ({ uid: d.id, ...d.data() })); },
      () => { members.value = []; }
    );
  }

  function unbind() {
    if (stop) { stop(); stop = null; }
    members.value = [];
  }

  const auth = useAuthStore();
  watch(() => auth.familyId, (id) => (id ? bind(id) : unbind()), { immediate: true });

  return { members };
});
