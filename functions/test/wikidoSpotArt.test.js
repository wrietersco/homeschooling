import test from "node:test";
import assert from "node:assert/strict";
import {
  positionPhrase, deterministicVisual, spotVisual, needsVisualSuggestion, describeSpots,
  mergeVisuals, buildSpotArtDirection, buildVisualSuggestionPrompt, normalizeVisualSuggestions,
} from "../lib/wikidoSpotArt.js";
import { composeSceneArtPrompt } from "../lib/wikidoPack.js";

const spot = (id, label, x, y, extra = {}) => ({ id, label, blurb: `${label} blurb`, x, y, info: { title: label, body: [`${label} teaches something.`] }, ...extra });

export const ASIA = {
  id: "asia", title: "Asia",
  hotspots: [
    spot("everest", "Everest", 41, 22),
    spot("wall", "Great Wall", 73, 52, { visual: "the Great Wall of China winding along a ridge" }),
    spot("tiger", "Tiger", 12, 78),
    spot("spices", "Spices", 80, 80),
    spot("city", "City skyline", 66, 28),
    spot("india", "India", 45.7, 58.7, { childSceneId: "india-scene" }),
    spot("monastery", "Monastery", 36, 62),
  ],
};
const scenes = { asia: ASIA, "india-scene": { id: "india-scene", title: "Inside India" } };

test("positionPhrase turns x/y into plain layout language", () => {
  assert.equal(positionPhrase(50, 50), "centre, mid-ground");
  assert.equal(positionPhrase(12, 78), "lower-left, foreground");
  assert.equal(positionPhrase(80, 80), "lower-right, foreground");
  assert.equal(positionPhrase(41, 22), "upper centre, background");
  assert.equal(positionPhrase(20, 50), "left, mid-ground");
  assert.equal(positionPhrase(85, 15), "upper-right, background");
  assert.equal(positionPhrase(undefined, "x"), "centre, mid-ground");
});

test("abstract labels become concrete visuals; stored visual wins", () => {
  assert.match(deterministicVisual("India"), /Taj Mahal/);
  assert.match(deterministicVisual("Culture of Egypt"), /costumes|festival/);
  assert.equal(deterministicVisual("Everest"), "");
  assert.equal(spotVisual({ label: "India" }).includes("Taj Mahal"), true);
  assert.equal(spotVisual({ label: "India", visual: "a tiger in a mangrove" }), "a tiger in a mangrove");
  assert.equal(spotVisual({ label: "Everest" }), "Everest");
  assert.equal(needsVisualSuggestion({ label: "Everest" }), true);
  assert.equal(needsVisualSuggestion({ label: "India" }), false);
  assert.equal(needsVisualSuggestion({ label: "Everest", visual: "x" }), false);
});

test("direction includes ALL spots with position, teaching, child title; no text in picture", () => {
  const d = buildSpotArtDirection(ASIA.hotspots, { scenes });
  for (const label of ["Everest", "Great Wall", "Tiger", "Spices", "City skyline", "Monastery"]) assert.ok(d.includes(label), label);
  assert.ok(d.includes("Taj Mahal"));                 // India → landmark
  assert.ok(d.includes('Represents "India"'));
  assert.ok(d.includes('Inside India'));              // child scene title
  assert.ok(d.includes("Great Wall of China winding")); // stored visual
  assert.ok(d.includes("upper centre, background"));
  assert.ok(d.includes("lower-left, foreground"));
  assert.ok(d.includes("centre, mid-ground"));
  assert.ok(d.includes("teaches something"));
  assert.ok(/do not draw any text/i.test(d));
  assert.equal(d.split("\n- ").length, 8);          // 7 spot lines
  assert.equal(buildSpotArtDirection([]), "");
});

test("direction stays within the length budget even with many verbose spots", () => {
  const many = Array.from({ length: 30 }, (_, i) => spot(`s${i}`, `Spot ${i}`, (i * 7) % 100, (i * 13) % 100, { info: { title: "t", body: ["x".repeat(400)] } }));
  const d = buildSpotArtDirection(many);
  assert.ok(d.length < 4200, String(d.length));
  assert.equal(d.split("\n- ").length, 15);         // capped at 14 spots
});

test("describeSpots rows for the Studio preview and mergeVisuals", () => {
  const rows = describeSpots(ASIA, scenes);
  assert.equal(rows.length, 7);
  assert.deepEqual(rows[5], { id: "india", n: 6, label: "India", visual: rows[5].visual, stored: false, position: "centre, mid-ground", childTitle: "Inside India" });
  assert.equal(rows[1].stored, true);
  const sc = { hotspots: [{ id: "a" }, { id: "b", visual: "keep" }] };
  assert.equal(mergeVisuals(sc, { a: "an apple", b: "keep", zzz: "no" }), 1);
  assert.equal(sc.hotspots[0].visual, "an apple");
});

test("visual suggestion prompt + normalizer", () => {
  const p = buildVisualSuggestionPrompt({ sceneTitle: "Asia", spots: [spot("india", "India", 1, 1)] });
  assert.ok(p.includes("Taj Mahal") && p.includes('"id": "india"'));
  const out = normalizeVisualSuggestions({ visuals: [{ id: "india", visual: "  a  mosque " }, { id: "ghost", visual: "x" }, { id: "india2", visual: "" }] }, [{ id: "india" }]);
  assert.deepEqual(out, { india: "a mosque" });
  assert.deepEqual(normalizeVisualSuggestions(null, []), {});
});

test("full Asia prompt: spots included, realism last", () => {
  const prompt = composeSceneArtPrompt({ artStyle: "Encyclopedia plate.", artPrompt: "A panoramic view of Asia.", spots: ASIA.hotspots, scenes });
  assert.ok(prompt.startsWith("Encyclopedia plate."));
  assert.ok(prompt.includes("Taj Mahal"));
  assert.ok(prompt.endsWith("every object remains recognizably real."));
  if (process.env.SHOW_PROMPT) console.log(prompt);
});
