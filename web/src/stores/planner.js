// Week-scoped live store for calendarDays blocks. Maintains one onSnapshot
// listener per day of the selected week; tears them all down and re-binds
// when the week or family changes.
import { defineStore } from "pinia";
import { ref } from "vue";
import { collection, query, orderBy, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";

export const usePlannerStore = defineStore("planner", () => {
  // { "YYYY-MM-DD": [block, ...] }
  const dayBlocks = ref({});
  const unsubs = [];

  function bind(familyId, dateKeys) {
    unsubs.forEach((fn) => fn());
    unsubs.length = 0;
    dayBlocks.value = Object.fromEntries(dateKeys.map((k) => [k, []]));

    for (const dateKey of dateKeys) {
      const q = query(
        collection(db, "families", familyId, "calendarDays", dateKey, "blocks"),
        orderBy("scheduledTime", "asc"),
        orderBy("createdAt", "asc")
      );
      const unsub = onSnapshot(
        q,
        (snap) => { dayBlocks.value[dateKey] = snap.docs.map((d) => ({ id: d.id, ...d.data() })); },
        () => { dayBlocks.value[dateKey] = []; }
      );
      unsubs.push(unsub);
    }
  }

  function unbind() {
    unsubs.forEach((fn) => fn());
    unsubs.length = 0;
    dayBlocks.value = {};
  }

  return { dayBlocks, bind, unbind };
});
