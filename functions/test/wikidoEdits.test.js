import { test } from "node:test";
import assert from "node:assert/strict";
import { repairWikidoEdits } from "../lib/wikidoEdits.js";
import { normalizeForSave, validateTopicPack } from "../lib/wikidoPack.js";
import livingThings from "../../web/src/lib/wikido/topics/living-things.js";
import { bundledWikidoWorlds } from "../lib/wikidoBundledWorlds.js";

// living-things ships without world doors, so the repair rules hang a legacy
// leftover on a copy: a childSceneId whose world id was already stripped, the
// way older saves stored a cross-topic doorway.
function withLegacyDoor() {
  const pack = structuredClone(livingThings);
  pack.scenes["human-beings"].hotspots.push({
    id: "door-to-ancient-worlds",
    label: "From Villages to Cities",
    blurb: "Visit another world",
    x: 72,
    y: 84,
    childSceneId: "ancient-worlds-overview",
    info: { title: "From Villages to Cities", body: ["Cities began in river valleys long ago."] },
  });
  return pack;
}
const ancientWorldsMirror = { id: "ancient-worlds", title: "Ancient Worlds", scenes: ["ancient-worlds-overview"] };

test("repairs a deleted Mammals branch and a legacy external door without changing other content", () => {
  const input = withLegacyDoor();
  input.scenes["what-are-mammals"] = { ...structuredClone(input.scenes["human-body"]), id: "what-are-mammals", title: "What are Mammals?" };
  const door = input.scenes["human-beings"].hotspots.find(h => h.id === "door-to-ancient-worlds");
  const { pack, repairs } = repairWikidoEdits(input, [...bundledWikidoWorlds, ancientWorldsMirror]);
  assert.equal(pack.scenes["what-are-mammals"], undefined);
  assert.equal(pack.scenes["human-beings"].hotspots.find(h => h.id === door.id).childTopicId, "ancient-worlds");
  assert.equal(repairs.length, 2);
  assert.ok(input.scenes["what-are-mammals"]); // source is available for backup
  assert.deepEqual(validateTopicPack(normalizeForSave(pack, pack.id).pack), []);
  assert.deepEqual(repairWikidoEdits(pack, [...bundledWikidoWorlds, ancientWorldsMirror]).repairs, []);
});

test("does not guess ambiguous external destinations or remove reachable descendants", () => {
  const input = withLegacyDoor();
  const { pack } = repairWikidoEdits(input, [...bundledWikidoWorlds, ancientWorldsMirror, { id: "other", scenes: ["ancient-worlds-overview"] }]);
  assert.equal(pack.scenes["human-beings"].hotspots.find(h => h.id === "door-to-ancient-worlds").childTopicId, undefined);
  assert.ok(pack.scenes["human-body"]);
});


test("deleted scene links become facts, while a cloud override resolves once", () => {
  const input = withLegacyDoor();
  const spot = input.scenes["types-of-animals"].hotspots[0];
  spot.childSceneId = "gone-mammals";
  const { pack } = repairWikidoEdits(input, [...bundledWikidoWorlds, { id: "ancient-worlds", scenes: { "ancient-worlds-overview": {} } }]);
  assert.equal(pack.scenes["types-of-animals"].hotspots[0].childSceneId, undefined);
  assert.deepEqual(pack.scenes["types-of-animals"].hotspots[0].info, spot.info);
  assert.equal(pack.scenes["human-beings"].hotspots.find(h => h.id === "door-to-ancient-worlds").childTopicId, "ancient-worlds");
});
