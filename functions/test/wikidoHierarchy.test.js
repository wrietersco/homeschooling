import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSceneHierarchy, validateDeclaredHierarchy } from "../lib/wikidoHierarchy.js";
import { normalizeGeneratedPack, validateTopicPack } from "../lib/wikidoPack.js";
import { validateTopicPack as validateWebPack } from "../../web/src/lib/wikido/schema.js";
import { generateReviewedTopic } from "../lib/wikidoGeneration.js";

const scene = (title, hotspots = []) => ({ title, narration: title, image: { src: "art", alt: title }, hotspots: [{ id: "fact", label: title, blurb: title, x: 50, y: 50, info: { title, body: [title] } }, ...hotspots] });
const pack = () => ({ id: "living-things", title: "Living Things", tagline: "Explore", rootSceneId: "root", scenes: {
  root: scene("Living Things", [{ id: "plants", childSceneId: "plants" }, { id: "humans", childSceneId: "humans" }]),
  plants: scene("Plants", [{ id: "kinds", childSceneId: "kinds" }]),
  kinds: scene("Kinds of Plants"), humans: scene("Human Beings"),
}, hierarchy: { sceneId: "root", children: [
  { sceneId: "plants", hotspotId: "plants", children: [{ sceneId: "kinds", hotspotId: "kinds", children: [] }] },
  { sceneId: "humans", hotspotId: "humans", children: [] },
] } });

function completePack() {
  const p = pack();
  for (const s of Object.values(p.scenes)) {
    s.hotspots = s.hotspots.map((h) => ({ ...s.hotspots[0], ...h }));
  }
  return p;
}

function modelReplies(replies) {
  const calls = [];
  return { calls, llm: { generate: async (input) => {
    calls.push(input);
    assert.ok(replies.length, "unexpected model call");
    return { text: JSON.stringify(replies.shift()) };
  } } };
}

test("generation requires an explicit hierarchy before independent review", async () => {
  const bad = completePack();
  delete bad.hierarchy;
  const { llm, calls } = modelReplies([bad, completePack(), { valid: true, issues: [] }]);
  const result = await generateReviewedTopic({ llm, title: "Living Things" });
  assert.equal(calls.length, 3);
  assert.ok(calls[1].contents[0].parts[0].text.includes("hierarchy nodes require"));
  assert.ok(calls[2].system.includes("Review"));
  assert.equal(result.pack.hierarchy, undefined); // editable doorways remain canonical
  assert.deepEqual(validateTopicPack(result.pack), []);
});

test("semantic rejection feeds corrections back to generation and is rechecked", async () => {
  const { llm, calls } = modelReplies([
    completePack(), { valid: false, issues: ["Plant kinds must stay under Plants, not Human Beings"] },
    completePack(), { valid: true, issues: [] },
  ]);
  await generateReviewedTopic({ llm, title: "Living Things" });
  assert.equal(calls.length, 4);
  assert.ok(calls[2].contents[0].parts[0].text.includes("Plant kinds must stay under Plants"));
});

test("persistent review failure never returns a saveable pack", async () => {
  const { llm } = modelReplies([
    completePack(), { valid: false, issues: ["Misplaced child"] },
    completePack(), { valid: true, issues: ["Still misplaced"] },
  ]);
  await assert.rejects(generateReviewedTopic({ llm, title: "Living Things" }), /Still misplaced/);
});

test("checks explicit generator hierarchy against doorways, coverage and order", () => {
  const p = pack();
  assert.deepEqual(validateDeclaredHierarchy(p, p.hierarchy), []);
  const wrong = structuredClone(p.hierarchy);
  wrong.children[1].children = wrong.children[0].children;
  wrong.children[0].children = [];
  assert.ok(validateDeclaredHierarchy(p, wrong).some((e) => e.includes('"humans" → "kinds"')));
  assert.ok(validateDeclaredHierarchy(p, null).length);
  assert.deepEqual(normalizeGeneratedPack(p).pack.hierarchy, p.hierarchy);
});

test("rejects multiple parents, root backlinks, cycles and disconnected scenes", () => {
  const p = pack();
  assert.deepEqual(validateSceneHierarchy(p.scenes, p.rootSceneId), []);
  p.scenes.humans.hotspots.push({ id: "wrong", childSceneId: "kinds" });
  assert.ok(validateSceneHierarchy(p.scenes, "root").some((e) => e.includes("multiple")));
  p.scenes.kinds.hotspots.push({ id: "loop", childSceneId: "root" });
  const errors = validateSceneHierarchy(p.scenes, "root");
  assert.ok(errors.some((e) => e.includes("cycle")));
  assert.ok(errors.some((e) => e.includes("root scene")));
  p.scenes.lost = scene("Lost");
  for (const validator of [validateTopicPack, validateWebPack]) {
    assert.ok(validator(p).some((e) => e.includes('"lost" is unreachable')));
    assert.ok(validator(p).some((e) => e.includes("multiple")));
  }
});

// ── Cross-topic doorways ──────────────────────────────────────────────────────
import {
  isCrossTopicDoorway, crossTopicDoorways, validatePackCrossTopicDoorways, validateCrossTopicDoorways,
} from "../lib/wikidoHierarchy.js";
import { bundledWikidoWorlds } from "../lib/wikidoBundledWorlds.js";
import { wikidoTopicPacks } from "../../web/src/lib/wikido/index.js";

const astronomyWorld = () => ({
  id: "astronomy", title: "Astronomy", tagline: "t", rootSceneId: "space",
  scenes: {
    space: scene("Space", [{ id: "sun", childSceneId: "sun-closeup" }]),
    "sun-closeup": scene("The Sun"),
  },
});

test("detects cross-topic doorways and skips them in the local hierarchy", () => {
  const world = astronomyWorld();
  world.scenes.space.hotspots.push({ id: "to-earth", childTopicId: "planet-earth", childSceneId: "earth-overview" });
  // scene() prepends a fact spot, so "sun" sits at index 1
  assert.equal(isCrossTopicDoorway(world.scenes.space.hotspots[1], "astronomy"), false); // local doorway
  assert.equal(isCrossTopicDoorway(world.scenes.space.hotspots[2], "astronomy"), true); // world doorway
  // a spot with childTopicId is a world door even when the slug collides locally
  // …and never counts as a local edge (no "multiple parents", no cycle)
  world.scenes["sun-closeup"].hotspots.push({ id: "collide", childTopicId: "planet-earth", childSceneId: "sun-closeup" });
  assert.deepEqual(validateSceneHierarchy(world.scenes, "space", "astronomy"), []);
  assert.deepEqual(crossTopicDoorways(world), [
    { sceneId: "space", spotId: "to-earth", topicId: "planet-earth", targetSceneId: "earth-overview" },
    { sceneId: "sun-closeup", spotId: "collide", topicId: "planet-earth", targetSceneId: "sun-closeup" },
  ]);
  // without the pack id, any declared childTopicId counts as cross (safe default)
  assert.equal(isCrossTopicDoorway(world.scenes.space.hotspots[2]), true);
});

test("resolves cross-topic doorways against a registry of known worlds", () => {
  const earth = { id: "planet-earth", title: "Planet Earth", tagline: "t", rootSceneId: "earth", scenes: {
    earth: scene("Earth", [{ id: "to-space", childTopicId: "astronomy", childSceneId: "space" }]),
  } };
  const world = astronomyWorld();
  world.scenes.space.hotspots.push({ id: "to-earth", childTopicId: "planet-earth", childSceneId: "earth" });
  // two worlds linking to each other resolve cleanly, in both directions
  assert.deepEqual(validatePackCrossTopicDoorways(earth, [world]), []);
  assert.deepEqual(validateCrossTopicDoorways([earth, world]), []);

  // dangling world
  assert.ok(validatePackCrossTopicDoorways(earth, []).some((e) => e.includes('childTopicId "astronomy" is not a known topic')));
  // dangling scene inside a known world
  earth.scenes.earth.hotspots.find((h) => h.id === "to-space").childSceneId = "no-such-scene";
  assert.ok(validatePackCrossTopicDoorways(earth, [world]).some((e) => e.includes('does not exist in topic "astronomy"')));
  earth.scenes.earth.hotspots.find((h) => h.id === "to-space").childSceneId = "space";
  // a pack never checks its own id as a cross-topic target — that is a
  // validator-level error, not a registry error
  const selfish = structuredClone(earth);
  selfish.scenes.earth.hotspots[0] = { id: "self", label: "Self", blurb: "b", x: 10, y: 10, info: { title: "Self", body: ["b"] }, childTopicId: "planet-earth", childSceneId: "earth" };
  assert.deepEqual(validatePackCrossTopicDoorways(selfish, [world]), []);
  // …but both validators reject the self reference outright
  assert.ok(validateWebPack(selfish).some((e) => e.includes("must name a DIFFERENT topic")));
  assert.ok(validateTopicPack(selfish).some((e) => e.includes("must name a DIFFERENT topic")));
});

test("normalization keeps childTopicId on saved spots", () => {
  const p = pack();
  p.scenes.root.hotspots.push({ id: "world-door", label: "Space", blurb: "b", x: 10, y: 10, info: { title: "Space", body: ["b"] }, childTopicId: "astronomy", childSceneId: "space" });
  const { pack: normalized } = normalizeGeneratedPack(p);
  const saved = normalized.scenes.root.hotspots.find((h) => h.id === "world-door");
  assert.equal(saved.childTopicId, "astronomy");
  assert.equal(saved.childSceneId, "space");
  // shape-valid for both validators (the target lives outside this pack)
  assert.ok(!validateTopicPack(normalized, { allowMissingArtwork: true }).some((e) => e.includes("childTopicId")));
});

test("the bundled-worlds manifest mirrors the published packs", () => {
  assert.deepEqual(
    bundledWikidoWorlds.map((w) => ({ id: w.id, scenes: [...w.scenes].sort() })),
    wikidoTopicPacks.map((p) => ({ id: p.id, scenes: Object.keys(p.scenes).sort() }))
  );
  // the real published cross-topic doorways resolve against the registry
  assert.deepEqual(validateCrossTopicDoorways(wikidoTopicPacks), []);
});

test("registry entries may list scenes as an array (the bundled-worlds mirror shape)", () => {
  const earth = { id: "planet-earth", title: "Planet Earth", tagline: "t", rootSceneId: "earth", scenes: {
    earth: scene("Earth", [{ id: "to-plants", childTopicId: "living-things", childSceneId: "types-of-plants" }]),
  } };
  assert.deepEqual(validatePackCrossTopicDoorways(earth, [{ id: "living-things", scenes: ["types-of-plants"] }]), []);
  earth.scenes.earth.hotspots[1].childSceneId = "no-such-scene";
  assert.ok(validatePackCrossTopicDoorways(earth, [{ id: "living-things", scenes: ["types-of-plants"] }]).some((e) => e.includes('does not exist in topic "living-things"')));
});
