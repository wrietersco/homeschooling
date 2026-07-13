import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

// AI explanation of where a single activity sits in the overall plan — for
// parents who guide the child without seeing the full planner/syllabus.
export const getActivityJourney = (activityId) =>
  httpsCallable(functions, "getActivityJourney")({ activityId }).then((r) => r.data);

// Manually rebuild the single-source-of-truth knowledge brief.
export const rebuildKnowledgeBrief = () =>
  httpsCallable(functions, "rebuildKnowledgeBrief")({}).then((r) => r.data);
