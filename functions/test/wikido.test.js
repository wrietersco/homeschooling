// Wikido studio pack helpers — pure-function tests (no network, no Admin SDK).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  slugify,
  uniquePackId,
  countDiscoveries,
  validateTopicPack,
  normalizeGeneratedPack,
  buildTopicPrompt,
  buildChildScenePrompt,
  parseLlmJson,
  buildSpotDetailsPrompt,
  normalizeSpotDetails,
  buildDepthPrompt,
  normalizeDepthPlan,
} from "../lib/wikidoPack.js";
import { audioClipPath, validateAudioPayload } from "../agents/wikido.js";
import { normalizeForSave } from "../lib/wikidoPack.js";

const validPack = {
  id: "the-water-cycle",
  title: "The Water Cycle",
  tagline: "How a drop travels the world",
  emoji: "💧",
  rootSceneId: "overview",
  scenes: {
    overview: {
      id: "overview",
      title: "The Water Cycle",
      image: { src: "https://example.com/overview.jpg", alt: "A valley" },
      narration: "Follow one drop.",
      hotspots: [
        { id: "sun", label: "The Sun", blurb: "The engine", x: 20, y: 10, info: { title: "The Sun", body: ["The sun lifts water."], fact: "Sunlight powers the whole cycle." } },
        { id: "clouds", label: "Clouds", blurb: "Water in the sky", x: 70, y: 20, childSceneId: "clouds-closeup", info: { title: "Clouds", body: ["Droplets gather."], fact: "A cloud can weigh a million pounds." } },
      ],
    },
    "clouds-closeup": {
      id: "clouds-closeup",
      title: "Inside a Cloud",
      image: { src: "https://example.com/cloud.jpg", alt: "A cloud" },
      narration: "Up in the cloud.",
      hotspots: [
        { id: "droplets", label: "Droplets", blurb: "Tiny drops", x: 50, y: 50, info: { title: "Droplets", body: ["Each cloud is made of droplets."] } },
      ],
    },
  },
};

test("slugify produces kebab-case ids", () => {
  assert.equal(slugify("The Water Cycle!"), "the-water-cycle");
  assert.equal(slugify("  Cells & DNA  "), "cells-dna");
  assert.equal(slugify(""), "topic");
});

test("uniquePackId avoids collisions with existing topics", () => {
  assert.equal(uniquePackId("The Water Cycle", []), "the-water-cycle");
  const id = uniquePackId("The Water Cycle", ["the-water-cycle"]);
  assert.match(id, /^the-water-cycle-[a-z0-9]{4}$/);
});

test("countDiscoveries counts hotspots across all scenes", () => {
  assert.equal(countDiscoveries(validPack), 3);
});

test("validateTopicPack accepts a good pack and reports nothing", () => {
  assert.deepEqual(validateTopicPack(validPack), []);
});

test("validateTopicPack requires artwork by default but drafts may omit src", () => {
  const noArt = structuredClone(validPack);
  noArt.scenes.overview.image.src = "";
  assert.ok(validateTopicPack(noArt).some((e) => e.includes("image.src")));
  assert.deepEqual(validateTopicPack(noArt, { allowMissingArtwork: true }).filter((e) => e.includes("image.src")), []);
});

test("validateTopicPack rejects dangling doorways and bad coordinates", () => {
  const broken = structuredClone(validPack);
  broken.scenes.overview.hotspots[1].childSceneId = "atlantis";
  broken.scenes.overview.hotspots[0].x = 140;
  const errors = validateTopicPack(broken);
  assert.ok(errors.some((e) => e.includes('childSceneId "atlantis"')));
  assert.ok(errors.some((e) => e.includes("percentages")));
});

test("normalizeGeneratedPack repairs typical LLM output", () => {
  const { pack, fixes } = normalizeGeneratedPack({
    id: "The Water Cycle!",
    title: "The Water Cycle",
    tagline: "t",
    scenes: [
      {
        id: "Overview Scene",
        title: "Overview",
        narration: "n",
        image: { alt: "art" },
        hotspots: [
          { id: "Sun", label: "Sun", blurb: "b", x: "30", y: 20, info: { title: "Sun", body: ["line"], fact: "f" } },
          { label: "", info: { title: "", body: [] } },
        ],
      },
    ],
  });
  assert.equal(pack.id, "the-water-cycle");
  assert.deepEqual(Object.keys(pack.scenes), ["overview-scene"]);
  const scene = pack.scenes["overview-scene"];
  assert.equal(scene.hotspots.length, 1); // the incomplete hotspot is dropped
  assert.equal(scene.hotspots[0].id, "sun");
  assert.equal(scene.hotspots[0].x, 30); // numeric string coerced
  assert.equal(pack.rootSceneId, "overview-scene"); // root repaired
  assert.ok(fixes.length >= 2);
});

test("normalizeGeneratedPack keeps doorways that still resolve", () => {
  const { pack } = normalizeGeneratedPack({
    id: "t", title: "T", tagline: "t",
    scenes: [
      { id: "a", title: "A", narration: "n", image: { alt: "x" }, hotspots: [{ id: "door", label: "Go", blurb: "b", x: 1, y: 2, childSceneId: "b", info: { title: "Go", body: ["x"] } }] },
      { id: "b", title: "B", narration: "n", image: { alt: "x" }, hotspots: [{ id: "d", label: "D", blurb: "b", x: 1, y: 2, info: { title: "D", body: ["x"] } }] },
    ],
  });
  assert.equal(pack.scenes.a.hotspots[0].childSceneId, "b");
});

test("buildTopicPrompt embeds the subject, angle and schema exemplar", () => {
  const prompt = buildTopicPrompt({ title: "Photosynthesis", angle: "for a 7-year-old gardener", levels: 4 });
  assert.ok(prompt.includes("Photosynthesis"));
  assert.ok(prompt.includes("for a 7-year-old gardener"));
  assert.ok(prompt.includes("childSceneId"));
  assert.ok(prompt.includes("4 levels"));
  assert.ok(prompt.includes("STRICT RULES"));
});

test("buildChildScenePrompt carries parent context and hotspot map", () => {
  const parent = validPack.scenes.overview;
  const prompt = buildChildScenePrompt({ parentScene: parent, siblingTitles: ["Inside a Cloud"], label: "Clouds", focus: "rain formation" });
  assert.ok(prompt.includes("The Water Cycle"));
  assert.ok(prompt.includes("sun,clouds".split(",")[0]) || prompt.includes("The Sun"));
  assert.ok(prompt.includes("The Sun 20,10"));
  assert.ok(prompt.includes("Inside a Cloud"));
  assert.ok(prompt.includes("rain formation"));
});

test("parseLlmJson survives markdown fences and chatter", () => {
  assert.deepEqual(parseLlmJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseLlmJson('Here you go:\n{"a":{"b":2}}\nDone!'), { a: { b: 2 } });
  assert.throws(() => parseLlmJson("no json here"), /did not return JSON/);
});

test("audioClipPath mirrors the pack's storage layout", () => {
  assert.deepEqual(
    audioClipPath("the-water-cycle", "overview"),
    { filePath: "wikido/the-water-cycle/audio/overview.mp3", packField: "audio/overview.mp3" }
  );
  assert.equal(
    audioClipPath("the-water-cycle", "overview", "sun").filePath,
    "wikido/the-water-cycle/audio/overview.sun.mp3"
  );
});

test("validateAudioPayload accepts only reasonably-sized MP3s", () => {
  assert.equal(validateAudioPayload("aGVsbG8=", "audio/mpeg"), null);
  assert.ok(validateAudioPayload("", "audio/mpeg").includes("Missing audio"));
  assert.ok(validateAudioPayload("aGVsbG8=", "audio/wav").includes("MP3"));
  const huge = "A".repeat(6 * 1024 * 1024);
  assert.ok(validateAudioPayload(huge, "audio/mpeg").includes("too large"));
});

test("normalizeForSave repairs exactly what broke prod saves", () => {
  // The studio form strips the pack id, and hand-added hotspots can arrive
  // without ids — both must be repaired before validation, not rejected.
  const incoming = {
    title: "Astronomy: Pulsar Stars!",
    tagline: "t",
    rootSceneId: "astronomy-overview",
    scenes: {
      "astronomy-overview": {
        id: "astronomy-overview",
        title: "Look Up!",
        narration: "n",
        image: { src: "https://x/a.jpg", alt: "a" },
        audio: "https://x/a.mp3",
        hotspots: [
          // no id — repaired from the label
          { label: "Pulsar Beacon", blurb: "b", x: 10, y: 10, info: { title: "Pulsar Beacon", body: ["x"] } },
          // existing recorded hotspot keeps its audio reference
          { id: "crab", label: "Crab", blurb: "b", x: 20, y: 20, audio: "https://x/crab.mp3", info: { title: "Crab", body: ["x"] } },
        ],
      },
    },
  };
  const { pack, errors } = normalizeForSave(incoming, "astronomy-pulsar-stars");
  assert.deepEqual(errors, []);
  assert.equal(pack.id, "astronomy-pulsar-stars");
  const spots = pack.scenes["astronomy-overview"].hotspots;
  assert.equal(spots[0].id, "pulsar-beacon");
  assert.equal(spots[0].audio, undefined);
  assert.equal(spots[1].audio, "https://x/crab.mp3"); // recordings survive
  assert.equal(pack.scenes["astronomy-overview"].audio, "https://x/a.mp3");
});

// ── suggest deeper scenes ─────────────────────────────────────────────────────
import { buildSuggestPrompt, normalizeSuggestions } from "../lib/wikidoPack.js";

test("buildSuggestPrompt names the parent and forbids existing scenes", () => {
  const p = buildSuggestPrompt({
    topicTitle: "Space",
    parentScene: { title: "The Sun", narration: "A star.", hotspots: [{ label: "Corona" }] },
    existingTitles: ["The Sun", "Galaxies"],
  });
  assert.match(p, /"Space"/);
  assert.match(p, /Corona/);
  assert.match(p, /The Sun, Galaxies/);
});

test("normalizeSuggestions drops malformed, duplicate and already-existing entries", () => {
  const out = normalizeSuggestions(
    {
      suggestions: [
        { label: "Solar Flares", focus: "Eruptions on the sun", why: "Explosive!" },
        { label: "solar flares!", focus: "dup of the first" },
        { label: "Galaxies", focus: "already exists" },
        { label: "", focus: "no label" },
        { label: "No focus" },
        "not an object",
        { label: "Sunspots", focus: "Cool dark patches", why: 42 },
      ],
    },
    ["Galaxies"]
  );
  assert.deepEqual(out.map((s) => s.label), ["Solar Flares", "Sunspots"]);
  assert.equal(out[1].why, "42");
});

test("normalizeSuggestions tolerates garbage and caps the list", () => {
  assert.deepEqual(normalizeSuggestions(null), []);
  assert.deepEqual(normalizeSuggestions({ suggestions: "nope" }), []);
  const many = { suggestions: Array.from({ length: 9 }, (_, i) => ({ label: `Scene ${i}`, focus: "f" })) };
  assert.equal(normalizeSuggestions(many).length, 5);
});

// ── outline planning ──────────────────────────────────────────────────────────
import { buildOutlinePrompt, normalizeOutline, OUTLINE_LIMITS } from "../lib/wikidoPack.js";

const node = (label, children) => ({ label, focus: `${label} focus`, ...(children ? { children } : {}) });

test("buildOutlinePrompt states size limits and existing scenes", () => {
  const p = buildOutlinePrompt({ topicTitle: "Space", parentScene: { title: "Sun", narration: "n", hotspots: [] }, existingTitles: ["Moon"], total: 6, depth: 2 });
  assert.match(p, /about 6 new scenes/);
  assert.match(p, /Moon/);
  assert.match(p, new RegExp(`at most ${OUTLINE_LIMITS.maxChildren} children`));
});

test("normalizeOutline keeps a clean tree intact", () => {
  const { outline, trimmed } = normalizeOutline({ outline: [node("A", [node("A1"), node("A2")]), node("B")] });
  assert.equal(trimmed, false);
  assert.deepEqual(outline.map((n) => n.label), ["A", "B"]);
  assert.deepEqual(outline[0].children.map((n) => n.label), ["A1", "A2"]);
});

test("normalizeOutline enforces total, depth, breadth and de-duplication", () => {
  // depth: level-4 nodes are dropped
  const deep = normalizeOutline({ outline: [node("L1", [node("L2", [node("L3", [node("L4")])])])] });
  assert.equal(deep.trimmed, true);
  assert.equal(deep.outline[0].children[0].children[0].children.length, 0);
  // breadth: at most maxChildren per parent
  const wide = normalizeOutline({ outline: Array.from({ length: 9 }, (_, i) => node(`S${i}`)) });
  assert.equal(wide.outline.length, OUTLINE_LIMITS.maxChildren);
  // total cap keeps the shallow (most important) scenes first
  const capped = normalizeOutline(
    { outline: [node("A", [node("A1"), node("A2")]), node("B", [node("B1")])] },
    [],
    { ...OUTLINE_LIMITS, maxTotal: 3 }
  );
  assert.deepEqual(capped.outline.map((n) => n.label), ["A", "B"]);
  assert.equal(capped.outline[0].children.length + capped.outline[1].children.length, 1);
  // duplicates (of each other and of existing scenes) are dropped
  const dup = normalizeOutline({ outline: [node("Sun"), node("moon!"), node("Moon")] }, ["Sun"]);
  assert.deepEqual(dup.outline.map((n) => n.label), ["moon!"]);
});

test("normalizeOutline survives garbage and malformed nodes", () => {
  assert.deepEqual(normalizeOutline(undefined).outline, []);
  assert.deepEqual(normalizeOutline({ outline: [null, 3, { label: "x" }, { focus: "y" }] }).outline, []);
});

// ── topic delete removes its files ────────────────────────────────────────────
import { topicStoragePrefix } from "../agents/wikido.js";

test("topicStoragePrefix scopes cleanup to exactly one topic's folder", () => {
  assert.equal(topicStoragePrefix("astronomy"), "wikido/astronomy/");
  // trailing slash: deleting "astronomy" must not match "astronomy-pulsars/…"
  assert.equal("wikido/astronomy-pulsars/s1.png".startsWith(topicStoragePrefix("astronomy")), false);
  assert.equal("wikido/astronomy/s1.png".startsWith(topicStoragePrefix("astronomy")), true);
  // matches where artwork and audio are actually written
  assert.ok(audioClipPath("astronomy", "s1").filePath.startsWith(topicStoragePrefix("astronomy")));
  // junk ids are slugified — the prefix is always ONE folder, never bucket-wide
  for (const junk of ["", "../..", undefined, "a/b"]) {
    assert.match(topicStoragePrefix(junk), /^wikido\/[a-z0-9-]+\/$/);
  }
});

test("buildSpotDetailsPrompt embeds scene, picture, position and doorway context", () => {
  const scene = {
    id: "overview", title: "Look Up!", narration: "What if we could fly?",
    artPrompt: "A bright MOON on the LEFT, a child with a TELESCOPE on the RIGHT.",
    hotspots: [{ id: "moon", label: "The Moon" }, { id: "scope", label: "Telescope" }],
  };
  const spot = { id: "moon", label: "New spot", x: 22, y: 30, childSceneId: "moon-surface" };
  const prompt = buildSpotDetailsPrompt({
    topicTitle: "The Night Sky", artStyle: "Painterly night blues.", scene, spot,
    siblingLabels: ["Telescope"], childSceneTitle: "The Moon's Surface", hint: "mention the craters",
  });
  assert.ok(prompt.includes("The Night Sky"));
  assert.ok(prompt.includes("Look Up!"));
  assert.ok(prompt.includes("The Moon's Surface")); // doorway destination
  assert.ok(prompt.includes("Telescope"));          // siblings to avoid
  assert.ok(prompt.includes("22%"));                // position
  assert.ok(prompt.includes("mention the craters"));
  assert.ok(prompt.includes("DOORWAY"));
});

test("normalizeSpotDetails coerces the model answer and rejects empties", () => {
  const { spot, errors } = normalizeSpotDetails({
    label: " The Moon ", blurb: "Our closest neighbour",
    info: { title: "The Moon", body: ["Grey and dusty.", ""], fact: "It drifts 3.8 cm away each year." },
  });
  assert.deepEqual(errors, []);
  assert.equal(spot.label, "The Moon");
  assert.equal(spot.blurb, "Our closest neighbour");
  assert.deepEqual(spot.info.body, ["Grey and dusty."]);
  assert.equal(spot.info.fact, "It drifts 3.8 cm away each year.");

  const bad = normalizeSpotDetails({ label: "", blurb: "x", info: { title: "", body: [] } });
  assert.equal(bad.errors.length >= 2, true);
  assert.equal(bad.spot.info.body.length, 0);
});

test("buildDepthPrompt presents the whole topic tree for assessment", () => {
  const pack = {
    title: "The Night Sky",
    scenes: {
      root: { id: "root", title: "Look Up!", narration: "What if we could fly?", hotspots: [
        { id: "d-moon", label: "The Moon", childSceneId: "moon" },
        { id: "f-star", label: "Stars" },
      ] },
      moon: { id: "moon", title: "The Moon's Surface", narration: "Grey and dusty.", hotspots: [{ id: "c", label: "Craters" }] },
    },
  };
  const prompt = buildDepthPrompt({ pack, maxScenes: 3 });
  assert.ok(prompt.includes("The Night Sky"));
  assert.ok(prompt.includes('parentSceneId: root'));
  assert.ok(prompt.includes("The Moon → \"The Moon's Surface\"")); // doorway
  assert.ok(prompt.includes("fact spots: Stars"));                 // leaf spots
  assert.ok(prompt.includes("up to 3 NEW deeper scenes"));
});

test("normalizeDepthPlan validates parents, dedupes and caps the budget", () => {
  const pack = {
    scenes: {
      root: { id: "root", title: "Root", hotspots: [] },
      thin: { id: "thin", title: "Thin", hotspots: [] },
    },
  };
  const raw = {
    additions: [
      { parentSceneId: "root", label: "Cities of Light", focus: "how cities glow", children: [{ label: "Streetlights", focus: "f" }] },
      { parentSceneId: "root", label: "Cities of Light", focus: "duplicate branch" }, // duplicate branch dropped
      { parentSceneId: "ghost", label: "Nowhere", focus: "missing parent" },           // dropped
      { parentSceneId: "thin", label: "Deep Underground", focus: "f" },                // fits the budget
      { parentSceneId: "thin", label: "Over budget", focus: "f" },                     // budget exhausted
    ],
  };
  const { branches } = normalizeDepthPlan(raw, pack, 3);
  assert.equal(branches.length, 2);
  assert.equal(branches[0].parentSceneId, "root");
  assert.equal(branches[0].outline[0].children[0].label, "Streetlights");
  assert.equal(branches[1].parentSceneId, "thin");
});
