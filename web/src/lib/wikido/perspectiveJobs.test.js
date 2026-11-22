import { describe, expect, it, vi } from "vitest";
import { newLensJob, runLensJob, resetFailed, queueProgress, defaultLensJobs, lensStatus, lensChecklist, jobDone, jobFailed } from "./perspectiveJobs";

const stub = (over = {}) => ({
  write: vi.fn(async () => "asia-history"),
  paint: vi.fn(async () => {}),
  voice: vi.fn(async () => {}),
  ...over,
});

describe("lens job runner", () => {
  it("runs write → paint → voice and records the lens scene id", async () => {
    const job = newLensJob({ topicId: "t", baseId: "asia", lens: "history" });
    const deps = stub();
    const seen = [];
    await runLensJob(job, deps, (j) => seen.push({ ...j.stages }));
    expect(jobDone(job)).toBe(true);
    expect(job.sceneId).toBe("asia-history");
    expect(deps.paint).toHaveBeenCalledWith(job);
    expect(seen[0]).toEqual({ write: "running", paint: "idle", voice: "idle" });
  });

  it("a failed write stops the job; retry re-runs only what failed", async () => {
    const job = newLensJob({ topicId: "t", baseId: "asia", lens: "history" });
    const deps = stub({ write: vi.fn().mockRejectedValueOnce(new Error("internal: model busy")).mockResolvedValue("asia-history") });
    await runLensJob(job, deps);
    expect(job.stages).toEqual({ write: "failed", paint: "idle", voice: "idle" });
    expect(job.errors.write).toBe("model busy");
    expect(deps.paint).not.toHaveBeenCalled();
    resetFailed(job);
    await runLensJob(job, deps);
    expect(jobDone(job)).toBe(true);
    expect(deps.write).toHaveBeenCalledTimes(2);
  });

  it("a failed paint still voices; retry paints only", async () => {
    const job = newLensJob({ topicId: "t", baseId: "asia", lens: "food" });
    const deps = stub({ paint: vi.fn().mockRejectedValueOnce(new Error("blocked")).mockResolvedValue() });
    await runLensJob(job, deps);
    expect(job.stages).toEqual({ write: "done", paint: "failed", voice: "done" });
    expect(jobFailed(job)).toBe(true);
    resetFailed(job);
    await runLensJob(job, deps);
    expect(deps.write).toHaveBeenCalledTimes(1);
    expect(deps.voice).toHaveBeenCalledTimes(1);
    expect(deps.paint).toHaveBeenCalledTimes(2);
    expect(queueProgress([job])).toMatchObject({ done: 3, failed: 0, total: 3, finished: 1 });
  });
});

describe("defaults + status", () => {
  const globe = {
    view: "globe", rootSceneId: "earth",
    scenes: {
      earth: { hotspots: [{ id: "pk", level: "country", childSceneId: "pakistan" }] },
      pakistan: { title: "Pakistan", perspectives: [{ id: "culture", sceneId: "pakistan-culture" }] },
      "pakistan-culture": { title: "x", perspectiveOf: "pakistan", lens: "culture" },
    },
  };
  it("a new place gets History, Culture, Architecture (minus what it has); the globe hub gets none", () => {
    expect(defaultLensJobs(globe, "t", "pakistan").map((j) => j.lens)).toEqual(["history", "architecture"]);
    expect(defaultLensJobs(globe, "t", "earth")).toEqual([]);
    expect(defaultLensJobs(globe, "t", "pakistan-culture").map((j) => j.baseId)).toEqual(["pakistan", "pakistan"]);
  });
  it("a non-place topic scene gets topic lenses", () => {
    const body = { rootSceneId: "body", scenes: { body: { title: "The Human Body" } } };
    expect(defaultLensJobs(body, "t", "body").map((j) => j.lens)).toEqual(["how-it-works", "discoveries", "up-close"]);
  });
  it("status and checklist read spots / art / voice", () => {
    const s = { lens: "food", image: { src: "https://x/y.png" }, audio: "a", hotspots: [{ id: "a", audio: "u" }, { id: "b" }, { id: "c", audio: "u" }] };
    expect(lensStatus(s)).toMatchObject({ spots: 3, art: true, clips: 4, voiced: 3, voice: false });
    const c = lensChecklist({ scenes: { f: s } }, "f", "published");
    expect(c.name).toBe("Food");
    expect(c.rows.map((r) => r.ok)).toEqual([true, true, false, true]);
  });
});
