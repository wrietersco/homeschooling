// Wikido Kokoro audio job — pure-function tests (job planning, claimability,
// clip progress reducer). No network, no Admin SDK, no model.
import { test } from "node:test";
import assert from "node:assert/strict";
import { planKokoroClips, isActionable, markClip } from "../agents/wikidoAudioJob.js";

const pack = {
  id: "space",
  title: "Space",
  scenes: {
    universe: {
      id: "universe",
      title: "The Universe",
      narration: "Everything began here.",
      audio: "https://x/universe-old.mp3", // already recorded
      hotspots: [
        { id: "galaxy", label: "Galaxy", info: { title: "Galaxy", body: ["Spiral arms."], fact: "We live in one." } },
        { id: "size", label: "How big?", info: { title: "How big?", body: ["Vast."] } },
      ],
    },
    "galaxy-scene": {
      id: "galaxy-scene",
      title: "What is a Galaxy?",
      narration: "A city of stars.",
      hotspots: [],
    },
  },
};

test("planKokoroClips snapshots every clip that lacks a recording, speaking the UI text", () => {
  const clips = planKokoroClips(pack);
  assert.deepEqual(clips.map((c) => c.id), ["universe.galaxy", "universe.size", "galaxy-scene"]);
  assert.equal(clips[0].sceneId, "universe");
  assert.equal(clips[0].hotspotId, "galaxy");
  assert.equal(clips[0].text, "Galaxy Spiral arms. Fun fact! We live in one.");
  assert.equal(clips[2].text, "What is a Galaxy?. A city of stars.");
  // recorded narration skipped unless forced
  assert.ok(clips.every((c) => c.id !== "universe"));
  const forced = planKokoroClips(pack, { force: true });
  assert.deepEqual(forced.map((c) => c.id), ["universe", "universe.galaxy", "universe.size", "galaxy-scene"]);
  // degenerate packs never crash
  assert.deepEqual(planKokoroClips(null), []);
});

test("isActionable claims queued jobs and reclaims stale running ones", () => {
  const now = 1_000_000;
  const minutes = (m) => ({ toMillis: () => now - m * 60_000 });
  assert.equal(isActionable({ status: "queued" }, now), true);
  assert.equal(isActionable({ status: "running", claimedAt: minutes(1) }, now), false); // an active worker owns it
  assert.equal(isActionable({ status: "running", claimedAt: minutes(6) }, now), true);  // crashed pass → reclaim
  assert.equal(isActionable({ status: "done" }, now), false);
  assert.equal(isActionable({ status: "cancelled" }, now), false);
  assert.equal(isActionable({ status: "error" }, now), false);
  assert.equal(isActionable(null, now), false);
});

test("markClip folds one finished clip in and recounts honestly", () => {
  const clips = [
    { id: "a", url: null, error: null },
    { id: "b", url: "https://x/b.mp3", error: null },
    { id: "c", url: null, error: "inference failed" },
  ];
  const after = markClip(clips, "a", { url: "https://x/a.mp3" });
  assert.equal(after.recorded, 2); // b (already) + a (just now)
  assert.equal(after.failed, 1);   // c
  assert.equal(after.clips[0].url, "https://x/a.mp3");

  const failed = markClip(after.clips, "b", { error: "storage down" });
  assert.equal(failed.recorded, 1);
  assert.equal(failed.failed, 2);
  assert.equal(failed.clips[1].error, "storage down");
  // marking an unknown id changes nothing but keeps counters truthful
  const untouched = markClip(failed.clips, "ghost", { url: "https://x/g.mp3" });
  assert.equal(untouched.recorded, 1);
  assert.deepEqual(untouched.clips, failed.clips);
});
