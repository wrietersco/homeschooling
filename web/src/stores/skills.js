// Live skills: the global registry (for picking), the family's adopted skills,
// and per-child skill bindings (childId -> Set of skillIds).
import { defineStore } from "pinia";
import { ref, watch, computed } from "vue";
import { collection, onSnapshot, query, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthStore } from "./auth";
import { useProfilesStore } from "./profiles";

export const useSkillsStore = defineStore("skills", () => {
  const registry = ref([]);       // global skillRegistry
  const familySkills = ref([]);   // families/{id}/skills
  const childBindings = ref({});  // { childId: [{id, name, ...}] }

  let stopRegistry = null;
  let stopFamily = null;
  let childStops = {};

  function unbindFamily() {
    if (stopFamily) { stopFamily(); stopFamily = null; }
    Object.values(childStops).forEach((fn) => fn());
    childStops = {};
    familySkills.value = [];
    childBindings.value = {};
  }

  // Global registry is readable by any signed-in user — bind once.
  function bindRegistry() {
    if (stopRegistry) return;
    stopRegistry = onSnapshot(
      query(collection(db, "skillRegistry"), orderBy("name", "asc")),
      (snap) => { registry.value = snap.docs.map((d) => ({ id: d.id, ...d.data() })); },
      () => { registry.value = []; }
    );
  }

  function bindFamily(familyId) {
    unbindFamily();
    if (!familyId) return;
    stopFamily = onSnapshot(
      collection(db, "families", familyId, "skills"),
      (snap) => { familySkills.value = snap.docs.map((d) => ({ id: d.id, ...d.data() })); },
      () => { familySkills.value = []; }
    );
  }

  function bindChild(familyId, childId) {
    if (childStops[childId]) return;
    childStops[childId] = onSnapshot(
      collection(db, "families", familyId, "children", childId, "skills"),
      (snap) => {
        childBindings.value = {
          ...childBindings.value,
          [childId]: snap.docs.map((d) => ({ id: d.id, ...d.data() })),
        };
      },
      () => {
        childBindings.value = { ...childBindings.value, [childId]: [] };
      }
    );
  }

  const auth = useAuthStore();
  const profiles = useProfilesStore();

  watch(
    () => auth.familyId,
    (id) => {
      bindRegistry();
      bindFamily(id);
    },
    { immediate: true }
  );

  // Keep a binding listener per child.
  watch(
    () => [auth.familyId, profiles.children.map((c) => c.id).join(",")],
    () => {
      const id = auth.familyId;
      if (!id) return;
      profiles.children.forEach((c) => bindChild(id, c.id));
    },
    { immediate: true, deep: true }
  );

  function childHasSkill(childId, skillId) {
    return (childBindings.value[childId] || []).some((s) => s.id === skillId);
  }
  const registryById = computed(() => {
    const m = {};
    registry.value.forEach((s) => { m[s.id] = s; });
    return m;
  });

  return {
    registry, familySkills, childBindings, registryById,
    childHasSkill, bindChild,
  };
});
