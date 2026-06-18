import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

// Ask the agent to lay the syllabus onto a week's calendar. `weekDateKeys` is
// the ordered array of 7 YYYY-MM-DD strings for the visible week. Returns
// { configured, runId, scheduled, text }.
export function autoSchedule(weekDateKeys) {
  return httpsCallable(functions, "autoSchedule")({ weekDateKeys }).then((r) => r.data);
}
