// Pure job model behind "Making perspectives": each job makes ONE lens of ONE
// scene in three stages — write (spots + card text) → paint (artwork) → voice
// (narration + every card). Stages run through injected callbacks, so the
// runner unit-tests with stubs and never touches the network.
//
// Partial failure: a failed WRITE stops the job (nothing to paint or voice);
// a failed paint does not stop the voice. Retry re-runs ONLY what failed.
import { perspectiveById, lensEntries, isLensReady, sceneKind, defaultPerspectivesFor, baseSceneId } from "../../../../functions/lib/wikidoPerspectives.js";

export const LENS_STAGES = ["write", "paint", "voice"];
export const STAGE_NAMES = { write: "Spots & cards", paint: "Artwork", voice: "Voice" };

export const jobKey = (topicId, baseId, lens) => `${topicId}:${baseId}:${lens}`;

export function newLensJob({ topicId, baseId, lens, draft = null, focus = "", origin = "manual" }) {
  return {
    key: jobKey(topicId, baseId, lens),
    topicId, baseId, lens, draft, focus, origin,
    sceneId: "",
    stages: { write: "idle", paint: "idle", voice: "idle" },
    errors: {},
    note: "",
  };
}

export const jobFailed = (job) => LENS_STAGES.some((s) => job.stages[s] === "failed");
export const jobDone = (job) => LENS_STAGES.every((s) => job.stages[s] === "done");
export const jobActive = (job) => LENS_STAGES.some((s) => job.stages[s] === "running");
export const jobWaiting = (job) => !jobActive(job) && LENS_STAGES.some((s) => job.stages[s] === "idle") && job.stages.write !== "failed";

// Run every stage not yet done. deps = { write(job) → sceneId, paint(job), voice(job) }.
// onUpdate(job) fires after every change (the caller re-renders). Never throws.
export async function runLensJob(job, deps, onUpdate = () => {}) {
  for (const stage of LENS_STAGES) {
    if (job.stages[stage] === "done") continue;
    if (stage !== "write" && !job.sceneId) break;
    job.stages[stage] = "running";
    delete job.errors[stage];
    onUpdate(job);
    try {
      const out = await deps[stage](job);
      if (stage === "write") job.sceneId = out || job.sceneId;
      job.stages[stage] = "done";
    } catch (e) {
      job.stages[stage] = "failed";
      job.errors[stage] = cleanError(e);
      onUpdate(job);
      if (stage === "write") return job; // nothing exists to paint or voice
      continue;
    } finally {
      job.note = "";
    }
    onUpdate(job);
  }
  return job;
}

// Put failed stages back to idle so the next run picks them up.
export function resetFailed(job) {
  for (const s of LENS_STAGES) if (job.stages[s] === "failed") { job.stages[s] = "idle"; delete job.errors[s]; }
  return job;
}

export function cleanError(e) {
  return String(e?.message || e || "failed").replace(/^(internal|invalid-argument|failed-precondition|already-exists|not-found|resource-exhausted): /i, "").slice(0, 200);
}

// Overall progress over a job list (stages count individually).
export function queueProgress(jobs) {
  let done = 0, failed = 0, total = 0;
  for (const j of jobs) for (const s of LENS_STAGES) {
    total += 1;
    if (j.stages[s] === "done") done += 1;
    if (j.stages[s] === "failed") failed += 1;
  }
  return { done, failed, total, jobs: jobs.length, finished: jobs.filter(jobDone).length };
}

// The default lenses a freshly created scene should get (skipping any it has).
export function defaultLensJobs(pack, topicId, sceneId) {
  const baseId = baseSceneId(pack?.scenes, sceneId);
  const base = pack?.scenes?.[baseId];
  if (!base || (pack.view === "globe" && baseId === pack.rootSceneId)) return [];
  const have = new Set(lensEntries(base, pack.scenes).map((e) => e.id));
  return defaultPerspectivesFor(sceneKind(pack, baseId))
    .filter((lens) => !have.has(lens))
    .map((lens) => newLensJob({ topicId, baseId, lens, origin: "auto" }));
}

// Strip status for one lens scene: spots / art / voice, in plain words.
export function lensStatus(scene) {
  const spots = (scene?.hotspots || []).length;
  const art = /^(https?:\/\/|\/wikido\/)/.test(String(scene?.image?.src || ""));
  const clips = 1 + spots;
  const voiced = (scene?.audio ? 1 : 0) + (scene?.hotspots || []).filter((h) => h.audio).length;
  return { spots, art, clips, voiced, voice: voiced >= clips, ready: isLensReady(scene) && art };
}

// The four things a finished lens needs, for the wizard's last step.
export function lensChecklist(pack, lensSceneId, topicStatus = "draft") {
  const scene = pack?.scenes?.[lensSceneId];
  const st = lensStatus(scene);
  const lens = perspectiveById(scene?.lens);
  return {
    exists: Boolean(scene),
    name: lens?.name || scene?.lens || "",
    rows: [
      { key: "spots", ok: st.spots >= 3, name: "Spots and cards", note: st.spots ? `${st.spots} spots with cards to read` : "No spots yet" },
      { key: "artwork", ok: st.art, name: "Artwork", note: st.art ? "Painted — each spot where its pin sits" : "No picture yet — children won't see this perspective until it is painted" },
      { key: "voice", ok: st.voice, name: "Voice", note: `${st.voiced} of ${st.clips} clips recorded` },
      { key: "published", ok: topicStatus === "published", name: "Published", note: topicStatus === "published" ? "The world is live — this perspective shows once it has artwork" : "The world is still a draft" },
    ],
  };
}
