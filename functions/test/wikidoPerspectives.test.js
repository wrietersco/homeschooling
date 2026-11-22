// Wikido Perspectives — catalog, kinds/ranking, scene-graph helpers, validation.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PERSPECTIVES, PERSPECTIVE_GROUPS, perspectiveById, isPerspectiveId, MAIN_LENS,
  rankPerspectives, defaultPerspectivesFor, sceneKind, sceneChildIds, sceneLenses,
  validatePerspectives, pruneUnreadyLenses, dropUnreadyLenses, lensSceneId, buildPerspectivePrompt,
  baseSceneId, reachableIds,
} from "../lib/wikidoPerspectives.js";
import { validateTopicPack, normalizeGeneratedPack } from "../lib/wikidoPack.js";
import { validateSceneHierarchy } from "../lib/wikidoHierarchy.js";

const spot = (id, extra = {}) => ({ id, label: id, blurb: `${id}!`, x: 30, y: 40, info: { title: id, body: [`About ${id}.`] }, ...extra });
const scene = (id, extra = {}) => ({ id, title: id, narration: `${id} story`, image: { src: `/wikido/${id}.png`, alt: id }, hotspots: [spot(`${id}-a`)], ...extra });

function lensPack() {
  return {
    id: "asia-world", title: "Asia", tagline: "Asia", rootSceneId: "asia",
    scenes: {
      asia: scene("asia", { perspectives: [{ id: "history", sceneId: "asia-history" }, { id: "food", sceneId: "asia-food" }] }),
      "asia-history": scene("asia-history", { perspectiveOf: "asia", lens: "history", hotspots: [spot("silk-road", { childSceneId: "silk-road" })] }),
      "asia-food": scene("asia-food", { perspectiveOf: "asia", lens: "food" }),
      "silk-road": scene("silk-road"),
    },
  };
}

test("catalog: unique ids, complete fields, required lenses present", () => {
  const ids = PERSPECTIVES.map((x) => x.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(PERSPECTIVES.length >= 30);
  const groups = new Set(PERSPECTIVE_GROUPS.map((g) => g.id));
  for (const x of PERSPECTIVES) {
    assert.match(x.id, /^[a-z][a-z-]*$/);
    for (const f of ["name", "emoji", "description", "spots", "art"]) assert.ok(String(x[f]).trim(), `${x.id}.${f}`);
    assert.match(x.color, /^#[0-9a-f]{6}$/i);
    assert.ok(groups.has(x.group), `${x.id} group`);
    assert.ok(x.bestFor.length > 0);
    assert.ok(!ids.includes(MAIN_LENS));
  }
  for (const need of ["map", "geography", "landscapes", "climate", "wildlife", "people", "languages", "beliefs", "culture", "food", "arts",
    "architecture", "history", "geo-history", "political-history", "cultural-history", "government", "economy", "defence", "science",
    "sports", "famous-people", "daily-life", "how-it-works"]) {
    assert.ok(isPerspectiveId(need), need);
  }
  assert.equal(perspectiveById(MAIN_LENS).name, "Overview");
  assert.equal(perspectiveById("nope"), null);
});

test("ranking + defaults: places get History/Culture/Architecture first, topics get topic lenses", () => {
  assert.deepEqual(defaultPerspectivesFor("country"), ["history", "culture", "architecture"]);
  assert.deepEqual(defaultPerspectivesFor("city"), ["history", "culture", "architecture"]);
  assert.deepEqual(defaultPerspectivesFor("topic"), ["how-it-works", "discoveries", "up-close"]);
  const country = rankPerspectives("country");
  assert.deepEqual(country.slice(0, 3).map((x) => x.id), ["history", "culture", "architecture"]);
  assert.equal(country.length, PERSPECTIVES.length); // nothing is hidden, only ordered
  const topic = rankPerspectives("topic");
  assert.equal(topic[0].id, "how-it-works");
  assert.ok(topic.findIndex((x) => x.id === "government") > topic.findIndex((x) => x.id === "life-cycle"));
  assert.equal(topic.find((x) => x.id === "government").suits, false);
});

test("sceneKind: globe pin level, landmark words, picture worlds default to topic", () => {
  const globe = {
    view: "globe", rootSceneId: "earth",
    scenes: {
      earth: { hotspots: [{ id: "pk", level: "country", childSceneId: "pakistan" }, { id: "lh", level: "city", childSceneId: "lahore" }] },
      pakistan: { title: "Pakistan" }, lahore: { title: "Lahore" }, mosque: { title: "Badshahi Mosque" },
      "pakistan-food": { title: "x", perspectiveOf: "pakistan", lens: "food" },
    },
  };
  assert.equal(sceneKind(globe, "pakistan"), "country");
  assert.equal(sceneKind(globe, "lahore"), "city");
  assert.equal(sceneKind(globe, "mosque"), "landmark");
  assert.equal(sceneKind(globe, "pakistan-food"), "country"); // a lens is judged by its base
  assert.equal(sceneKind({ rootSceneId: "b", scenes: { b: { title: "The Human Body" } } }, "b"), "topic");
  assert.equal(sceneKind({ rootSceneId: "b", scenes: { b: { title: "Heart", kind: "landmark" } } }, "b"), "landmark");
});

test("graph helpers: lens links are edges; lenses listed Overview first", () => {
  const pack = lensPack();
  assert.deepEqual(sceneChildIds(pack.scenes.asia), ["asia-history", "asia-food"]);
  assert.deepEqual([...reachableIds(pack.scenes, "asia")].sort(), ["asia", "asia-food", "asia-history", "silk-road"]);
  assert.deepEqual(sceneLenses(pack.scenes, "asia-food").map((l) => l.id), ["main", "history", "food"]);
  assert.equal(baseSceneId(pack.scenes, "asia-food"), "asia");
  assert.equal(lensSceneId(pack.scenes, "asia", "history"), "asia-history-2");
  assert.equal(lensSceneId(pack.scenes, "asia", "map"), "asia-map");
});

test("validation: a valid lens pack passes both validators; hierarchy sees lens children", () => {
  const pack = lensPack();
  assert.deepEqual(validateTopicPack(pack), []);
  assert.deepEqual(validateSceneHierarchy(pack.scenes, "asia", pack.id), []);
  // without the lens link, the lens scene and its child are unreachable
  const broken = structuredClone(pack);
  broken.scenes.asia.perspectives = [];
  const errs = validateTopicPack(broken);
  assert.ok(errs.some((e) => e.includes("does not list this perspective")));
  assert.ok(errs.some((e) => e.includes(`"silk-road" is unreachable`)));
});

test("validation: rejects bad lens structure", () => {
  const cases = [
    [(p) => { p.scenes.asia.perspectives[0].id = "nonsense"; }, "from the catalog"],
    [(p) => { p.scenes.asia.perspectives.push({ id: "history", sceneId: "asia-food" }); }, "listed twice"],
    [(p) => { p.scenes["asia-food"].perspectiveOf = "silk-road"; }, `must say perspectiveOf "asia"`],
    [(p) => { p.scenes["asia-food"].lens = "map"; }, `must say lens "food"`],
    [(p) => { p.scenes["asia-food"].perspectives = []; }, "cannot have perspectives of its own"],
    [(p) => { p.scenes["silk-road"].hotspots.push(spot("x", { childSceneId: "asia-food" })); }, "opens the perspective picture"],
    [(p) => { p.scenes.asia.perspectives[1].sceneId = "ghost"; }, `"ghost" has no matching scene`],
  ];
  for (const [mutate, expect] of cases) {
    const p = lensPack();
    mutate(p);
    const errs = validatePerspectives(p.scenes, p.rootSceneId);
    assert.ok(errs.some((e) => e.includes(expect)), `${expect}: ${errs.join(" | ")}`);
  }
  const globe = lensPack();
  assert.ok(validatePerspectives(globe.scenes, "asia", { hubId: "asia" }).some((e) => e.includes("globe hub")));
});

test("unready lenses are unlisted and their only-through scenes dropped; loose scenes untouched", () => {
  const pack = lensPack();
  pack.scenes["asia-history"].image.src = ""; // still being painted
  pack.scenes.loose = scene("loose");
  const scenes = pruneUnreadyLenses(pack.scenes);
  assert.deepEqual(scenes.asia.perspectives.map((e) => e.id), ["food"]);
  const out = dropUnreadyLenses(pack);
  assert.ok(!out.scenes["asia-history"] && !out.scenes["silk-road"]);
  assert.ok(out.scenes.loose, "a scene that was already loose stays for strict checks to report");
  const ready = lensPack();
  assert.equal(dropUnreadyLenses(ready), ready); // nothing to do → same object
});

test("normalizeGeneratedPack keeps perspective fields through a save", () => {
  const { pack } = normalizeGeneratedPack(lensPack());
  assert.deepEqual(pack.scenes.asia.perspectives, [{ id: "history", sceneId: "asia-history" }, { id: "food", sceneId: "asia-food" }]);
  assert.equal(pack.scenes["asia-food"].perspectiveOf, "asia");
  assert.equal(pack.scenes["asia-food"].lens, "food");
});

test("buildPerspectivePrompt carries lens guidance and avoids repeating the overview", () => {
  const prompt = buildPerspectivePrompt({ topicTitle: "Earth", base: lensPack().scenes.asia, lens: "architecture", kind: "country", focus: "mosques" });
  assert.match(prompt, /ARCHITECTURE/);
  assert.match(prompt, /do NOT repeat them/);
  assert.match(prompt, /asia-a/);
  assert.match(prompt, /mosques/);
  assert.match(prompt, /"hotspots"/);
});

test("buildLensScene: complete spots kept (max 8), back-link + art guidance stamped, thin answers rejected", async () => {
  const { buildLensScene, withLensEntry } = await import("../lib/wikidoPerspectives.js");
  const spots = Array.from({ length: 10 }, (_, i) => ({ label: `Thing ${i % 9}`, blurb: "b", info: { body: ["text"] }, ...(i === 0 ? { x: "oops" } : { x: 20, y: 30 }) }));
  spots.push({ label: "", info: { body: ["x"] } });
  const out = buildLensScene({ scene: { narration: "Long ago…", artPrompt: "A timeline.", hotspots: spots } }, { baseId: "asia", base: { title: "Asia" }, lensId: "history", sceneId: "asia-history" });
  assert.deepEqual(out.errors, []);
  assert.equal(out.scene.hotspots.length, 8);
  assert.equal(out.scene.perspectiveOf, "asia");
  assert.equal(out.scene.lens, "history");
  assert.equal(out.scene.title, "Asia — History");
  assert.match(out.scene.artPrompt, /^A timeline\. Perspective: History\./);
  assert.ok(out.scene.hotspots.every((h) => h.x >= 6 && h.x <= 94));
  assert.equal(new Set(out.scene.hotspots.map((h) => h.id)).size, 8);
  assert.ok(buildLensScene({ narration: "x", hotspots: spots.slice(0, 2) }, { baseId: "a", lensId: "food", sceneId: "a-food" }).errors[0].includes("at least 3"));
  assert.ok(buildLensScene({ hotspots: spots }, { baseId: "a", lensId: "food", sceneId: "a-food" }).errors[0].includes("narration"));
  assert.deepEqual(withLensEntry({ perspectives: [{ id: "food", sceneId: "a-food" }] }, "map", "a-map"), [{ id: "food", sceneId: "a-food" }, { id: "map", sceneId: "a-map" }]);
});

test("sceneKind: a picture world about a real country or city is a place", () => {
  assert.equal(sceneKind({ rootSceneId: "p", scenes: { p: { title: "Pakistan" } } }, "p"), "country");
  assert.equal(sceneKind({ rootSceneId: "p", scenes: { p: { title: "Lahore" } } }, "p"), "city");
  assert.equal(sceneKind({ rootSceneId: "p", scenes: { p: { title: "Asia" } } }, "p"), "region");
  assert.equal(sceneKind({ rootSceneId: "p", scenes: { p: { title: "The Human Heart" } } }, "p"), "topic");
});
