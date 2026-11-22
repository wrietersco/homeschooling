// The studio's "Making perspectives" queue: lens jobs (see
// lib/wikido/perspectiveJobs.js) run one at a time in the background while the
// curator keeps working. Two safety nets keep the curator's edits and the
// server in agreement:
//   • a server lock — Save and every perspective server step take turns, so a
//     full-document save can never land in the middle of a perspective write;
//   • a patch log — each finished step is applied to the edited form AND its
//     saved snapshot (no false "unsaved edits"), and re-applied after a reload
//     whose fetch started before the step landed (no stale overwrite).
import { ref } from "vue";
import { newLensJob, runLensJob, resetFailed, jobWaiting, jobActive } from "@/lib/wikido/perspectiveJobs";

export function createMutex() {
  let tail = Promise.resolve();
  let held = 0;
  return {
    run(fn) {
      const result = tail.then(() => { held += 1; return fn(); }).finally(() => { held -= 1; });
      tail = result.catch(() => {});
      return result;
    },
    get busy() { return held > 0; },
  };
}

export function useLensQueue(deps) {
  const jobs = ref([]);
  let pumping = false;

  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      for (;;) {
        const next = jobs.value.find(jobWaiting);
        if (!next) break;
        await runLensJob(next, deps, () => { jobs.value = [...jobs.value]; });
        jobs.value = [...jobs.value];
      }
    } finally {
      pumping = false;
    }
  }

  // Add jobs (a lens already queued for that scene is not added twice).
  function enqueue(list) {
    const added = [];
    for (const spec of list) {
      const job = spec.stages ? spec : newLensJob(spec);
      const existing = jobs.value.find((j) => j.key === job.key);
      if (existing) { added.push(existing); continue; }
      jobs.value = [...jobs.value, job];
      added.push(jobs.value[jobs.value.length - 1]);
    }
    pump();
    return added;
  }
  const find = (key) => jobs.value.find((j) => j.key === key) || null;
  function retry(key) {
    const job = find(key);
    if (!job || jobActive(job)) return;
    resetFailed(job);
    jobs.value = [...jobs.value];
    pump();
  }
  function retryAll() {
    for (const j of jobs.value) if (!jobActive(j)) resetFailed(j);
    jobs.value = [...jobs.value];
    pump();
  }
  function dismiss(key) {
    jobs.value = jobs.value.filter((j) => j.key !== key || jobActive(j));
  }
  function clearFinished() {
    jobs.value = jobs.value.filter((j) => jobActive(j) || jobWaiting(j));
  }
  return { jobs, enqueue, find, retry, retryAll, dismiss, clearFinished };
}

// Patches that must survive a reload whose data was fetched before they landed.
export function createPatchLog() {
  let log = []; // [{ topicId, at, apply }]
  return {
    record(topicId, apply) { log.push({ topicId, at: Date.now(), apply }); },
    // after loading a doc fetched at `fetchedAt`: re-apply newer patches, forget older ones
    replay(topicId, fetchedAt, target) {
      log = log.filter((p) => p.at > fetchedAt);
      for (const p of log) if (p.topicId === topicId) p.apply(target);
    },
  };
}
