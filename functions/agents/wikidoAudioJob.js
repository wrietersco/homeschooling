// Wikido Kokoro audio job — the fire-and-forget queue for the free premium
// voice. The studio enqueues ONE job per topic and can close the tab: the
// scheduled worker (wikidoKokoroWorker, every minute) drains the queue clip by
// clip — same shape as the Qaida audio job (job doc + queued/running lease +
// 1-minute scheduled drain). Every finished clip is uploaded and wired into the
// topic as it completes, so progress is never lost and "Generate audios" only
// ever records what is still missing.
//
//   requestWikidoKokoroJob — enqueue (or reset) the topic's job + primer batch
//   stopWikidoKokoroJob    — mark cancelled; the worker finalizes mid-clip
//   getWikidoKokoroJob     — poll the job doc (live progress in the studio)
//   wikidoKokoroWorker     — scheduled drain (maxInstances: 1)
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { slugify } from "../lib/wikidoPack.js";
import { withoutUndefined, wikidoClipText, uploadClip, wireClipAudio, requireSuperAdmin } from "./wikido.js";
import { getKokoroEngine } from "../lib/wikidoKokoro.js";

export const JOBS_COLLECTION = "wikidoAudioJobs";
const STALE_RUNNING_MS = 5 * 60 * 1000;   // reclaim a job stuck "running" this long
const WORK_BUDGET_MS = 480_000;           // per worker pass — the 540s timeout minus slack
const PRIMER_MAX_CLIPS = 2;               // request-time teaser batch so the UI moves at once
const PRIMER_BUDGET_MS = 90_000;

function jobsCol(db) {
  return db.collection(JOBS_COLLECTION);
}
function topicRef(db, topicId) {
  return db.collection("wikidoTopics").doc(topicId);
}

// The exact clip list for a run, snapshot at enqueue time — narration for every
// scene and a card for every spot that lacks a recording (all clips with force).
// Pure + unit-tested.
export function planKokoroClips(pack, { force = false } = {}) {
  const clips = [];
  for (const scene of Object.values(pack?.scenes || {})) {
    if (!scene) continue;
    if (force || !scene.audio) {
      clips.push({ id: scene.id, sceneId: scene.id, hotspotId: "", text: wikidoClipText(scene, "") });
    }
    for (const h of scene.hotspots || []) {
      if (force || !h.audio) {
        clips.push({ id: `${scene.id}.${h.id}`, sceneId: scene.id, hotspotId: h.id, text: wikidoClipText(scene, h.id) });
      }
    }
  }
  return clips.filter((c) => c.text);
}

// Can the worker pick this job up now? Queued always; running only after the
// stale window (a crashed pass), so an active worker is never double-claimed.
export function isActionable(job, nowMs = Date.now()) {
  if (!job) return false;
  if (job.status === "queued") return true;
  if (job.status !== "running") return false;
  const claimedMs = job.claimedAt?.toMillis?.() ?? job.claimedAtMs ?? 0;
  return nowMs - claimedMs > STALE_RUNNING_MS;
}

// Pure reducer: fold one finished clip into the job's clips + counters.
export function markClip(clips, id, outcome) {
  let recorded = 0;
  let failed = 0;
  const next = clips.map((c) => {
    if (c.id !== id) { recorded += c.url ? 1 : 0; failed += c.error ? 1 : 0; return c; }
    const updated = outcome.url ? { ...c, url: outcome.url, error: null } : { ...c, url: null, error: outcome.error || "failed" };
    recorded += updated.url ? 1 : 0;
    failed += updated.error ? 1 : 0;
    return updated;
  });
  return { clips: next, recorded, failed };
}

async function finalizeJob(ref, clips, status) {
  const recorded = clips.filter((c) => c.url).length;
  const failed = clips.filter((c) => c.error).length;
  const patch = { status, clips, recorded, failed, claimedAt: null, updatedAt: new Date(), finishedAt: new Date() };
  if (status === "error") patch.lastError = "synthesis failed";
  await ref.update(withoutUndefined(patch));
}

// Wire one finished clip using a FRESH scene read — the curator may be editing
// the topic mid-run, and a stale hotspots array would drop their edits.
async function wireClipFresh(db, topicId, clip, url) {
  const snap = await topicRef(db, topicId).get();
  const scene = snap.data()?.scenes?.[clip.sceneId];
  if (!scene) throw new Error(`Scene "${clip.sceneId}" no longer exists.`);
  if (clip.hotspotId) {
    if (!(scene.hotspots || []).some((h) => h.id === clip.hotspotId)) throw new Error(`Spot "${clip.hotspotId}" no longer exists.`);
    const hotspots = scene.hotspots.map((h) => (h.id === clip.hotspotId ? { ...h, audio: url } : h));
    await topicRef(db, topicId).update(withoutUndefined({ [`scenes.${clip.sceneId}.hotspots`]: hotspots, updatedAt: Date.now() }));
  } else {
    await topicRef(db, topicId).update(withoutUndefined({ [`scenes.${clip.sceneId}.audio`]: url, updatedAt: Date.now() }));
  }
}

// One drain pass. With `jobRef` it processes exactly that job (the primer);
// otherwise it picks the oldest actionable job in the collection. Stops on the
// time budget / clip cap and re-queues, so the next scheduled run resumes.
// DB interactions are thin; the shape of the run is unit-tested via the pure
// helpers above.
export async function runWikidoKokoroPass({ db = getFirestore(), jobRef = null, budgetMs = WORK_BUDGET_MS, maxClips = Infinity, now = Date.now } = {}) {
  let ref = jobRef;
  if (!ref) {
    const snap = await db.collection(JOBS_COLLECTION).where("status", "in", ["queued", "running"]).get();
    const pick = snap.docs
      .map((d) => ({ ref: d.ref, data: d.data() }))
      .filter(({ data }) => isActionable(data, now()))
      .sort((a, b) => (a.data.startedAt?.toMillis?.() ?? 0) - (b.data.startedAt?.toMillis?.() ?? 0))[0];
    if (!pick) return { processed: 0 };
    ref = pick.ref;
  }

  // claim (idempotent for the primer's fresh job)
  const before = (await ref.get()).data();
  if (!before) return { processed: 0 };
  if (before.status === "cancelled" || before.status === "done") return { processed: 0 };
  await ref.set({ status: "running", claimedAt: new Date(), updatedAt: new Date() }, { merge: true });

  let engine;
  try {
    engine = await getKokoroEngine();
  } catch (e) {
    console.error("[wikidoKokoroWorker] model load failed:", e);
    await ref.update(withoutUndefined({ status: "error", claimedAt: null, lastError: `The Kokoro voice could not load on the server: ${String(e?.message || e).slice(0, 160)}`, updatedAt: new Date(), finishedAt: new Date() }));
    return { processed: 0, error: true };
  }

  const topicId = before.topicId;
  const bucket = getStorage().bucket();
  const started = now();
  let processed = 0;
  let job = (await ref.get()).data();

  for (const pending of job.clips || []) {
    if (processed >= maxClips || now() - started >= budgetMs) break;
    if (pending.url || pending.error) continue;
    job = (await ref.get()).data();
    if (job.status === "cancelled") { await finalizeJob(ref, job.clips || [], "cancelled"); return { processed, cancelled: true }; }
    try {
      const { mp3Base64 } = await engine.generate(pending.text);
      const url = await uploadClip(bucket, topicId, pending, Buffer.from(mp3Base64, "base64"), "mp3", "audio/mpeg");
      await wireClipFresh(db, topicId, pending, url);
      const marked = markClip(job.clips || [], pending.id, { url });
      await ref.update(withoutUndefined({ clips: marked.clips, recorded: marked.recorded, failed: marked.failed, updatedAt: new Date() }));
    } catch (e) {
      console.warn(`[wikidoKokoroWorker] ${topicId}/${pending.id}:`, e?.message || e);
      const marked = markClip(job.clips || [], pending.id, { error: String(e?.message || e).slice(0, 160) });
      await ref.update(withoutUndefined({ clips: marked.clips, recorded: marked.recorded, failed: marked.failed, updatedAt: new Date() }));
    }
    processed += 1;
  }

  job = (await ref.get()).data();
  const clips = job.clips || [];
  const allHandled = clips.length > 0 && clips.every((c) => c.url || c.error);
  if (job.status === "cancelled") {
    await finalizeJob(ref, clips, "cancelled");
    return { processed, cancelled: true };
  }
  if (allHandled) {
    await finalizeJob(ref, clips, "done");
    return { processed, done: true };
  }
  // budget/cap reached — re-queue; the next scheduled minute resumes
  await ref.update(withoutUndefined({ status: "queued", claimedAt: null, updatedAt: new Date() }));
  return { processed, requeued: true };
}

// Enqueue (or reset) the topic's Kokoro job, then voice a small PRIMER batch
// inline so the studio shows immediate movement; the scheduled worker drains
// the rest with the tab closed.
export const requestWikidoKokoroJob = onCall(
  { secrets: [], timeoutSeconds: 180, memory: "2GiB", cpu: 2 },
  async (request) => {
    requireSuperAdmin(request);
    const topicId = slugify(String(request.data?.topicId || ""));
    if (!topicId) throw new HttpsError("invalid-argument", "Missing topic.");
    const force = Boolean(request.data?.force);

    const snap = await topicRef(getFirestore(), topicId).get();
    if (!snap.exists) throw new HttpsError("not-found", "That topic no longer exists.");
    const pack = snap.data();
    const clips = planKokoroClips(pack, { force });

    const ref = jobsCol(getFirestore()).doc(topicId);
    if (!clips.length) {
      await ref.set(withoutUndefined({
        topicId, topicTitle: pack.title || topicId, engine: "kokoro", status: "done", force,
        clips: [], total: 0, recorded: 0, failed: 0, lastError: "",
        claimedAt: null, startedAt: new Date(), finishedAt: new Date(), updatedAt: new Date(),
        createdBy: request.auth?.uid || "",
      }));
      return { status: "done", total: 0, recorded: 0 };
    }
    await ref.set(withoutUndefined({
      topicId, topicTitle: pack.title || topicId, engine: "kokoro", status: "queued", force,
      clips, total: clips.length, recorded: 0, failed: 0, lastError: "",
      claimedAt: null, startedAt: new Date(), finishedAt: null, updatedAt: new Date(),
      createdBy: request.auth?.uid || "",
    }));
    try {
      await runWikidoKokoroPass({ jobRef: ref, maxClips: PRIMER_MAX_CLIPS, budgetMs: PRIMER_BUDGET_MS });
    } catch (e) {
      console.warn(`[requestWikidoKokoroJob] primer pass failed:`, e?.message || e);
    }
    const after = (await ref.get()).data() || {};
    return {
      status: after.status || "queued",
      total: after.total ?? clips.length,
      recorded: after.recorded || 0,
      failed: after.failed || 0,
    };
  }
);

export const stopWikidoKokoroJob = onCall(
  { secrets: [], timeoutSeconds: 30 },
  async (request) => {
    requireSuperAdmin(request);
    const topicId = slugify(String(request.data?.topicId || ""));
    if (!topicId) throw new HttpsError("invalid-argument", "Missing topic.");
    await jobsCol(getFirestore()).doc(topicId).set({ status: "cancelled", updatedAt: new Date() }, { merge: true });
    return { status: "cancelled" };
  }
);

export const getWikidoKokoroJob = onCall(
  { secrets: [], timeoutSeconds: 30 },
  async (request) => {
    requireSuperAdmin(request);
    const topicId = slugify(String(request.data?.topicId || ""));
    if (!topicId) throw new HttpsError("invalid-argument", "Missing topic.");
    const snap = await jobsCol(getFirestore()).doc(topicId).get();
    const job = snap.exists ? snap.data() : null;
    if (job) delete job.clips; // texts are dead weight for a progress poll
    return { job };
  }
);

// Scheduled drain — same cadence/shape as qaidaAudioWorker. maxInstances: 1 +
// the stale-claim window mean a crashed pass is retried, never duplicated.
export const wikidoKokoroWorker = onSchedule(
  { schedule: "every 1 minutes", timeoutSeconds: 540, secrets: [], memory: "2GiB", cpu: 2, maxInstances: 1 },
  async () => { await runWikidoKokoroPass({}); }
);
