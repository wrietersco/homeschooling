import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

// Ask the agent to lay the syllabus onto a week's calendar. `weekDateKeys` is
// the ordered array of 7 YYYY-MM-DD strings for the visible week. Returns
// { configured, runId, scheduled, text }.
export function autoSchedule(weekDateKeys) {
  // The agent's ReAct loop (one schedule_block call per placement) routinely runs
  // longer than the SDK's 70s default callable timeout, which surfaced as a raw
  // "deadline-exceeded" in the planner while the server kept running to completion.
  // Match the client timeout to the server's timeoutSeconds: 300 (see scheduler.js).
  return httpsCallable(functions, "autoSchedule", { timeout: 300000 })({ weekDateKeys }).then((r) => r.data);
}
