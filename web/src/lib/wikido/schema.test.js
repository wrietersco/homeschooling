import { describe, it, expect } from "vitest";
import { validateTopicPack } from "./schema.js";
import civilizations from "./topics/civilizations.js";

// The published Civilizations pack must always pass its own schema — it is the
// executable documentation of what a valid pack looks like.
describe("wikido topic schema", () => {
  it("accepts the published civilizations pack", () => {
    expect(validateTopicPack(civilizations)).toEqual([]);
  });

  it("rejects a hotspot pointing at a scene that does not exist", () => {
    const broken = {
      ...civilizations,
      scenes: {
        ...civilizations.scenes,
        "civilizations-overview": {
          ...civilizations.scenes["civilizations-overview"],
          hotspots: civilizations.scenes["civilizations-overview"].hotspots.map((h) =>
            h.id === "empires" ? { ...h, childSceneId: "atlantis" } : h
          ),
        },
      },
    };
    const errors = validateTopicPack(broken);
    expect(errors.some((e) => e.includes('childSceneId "atlantis"'))).toBe(true);
  });

  it("rejects hotspot coordinates outside 0–100", () => {
    const pack = structuredClone(civilizations);
    pack.scenes["bull-capitals"].hotspots[0].x = 140;
    const errors = validateTopicPack(pack);
    expect(errors.some((e) => e.includes("x/y must be percentages"))).toBe(true);
  });

  it("rejects a scene without narration or an unknown rootSceneId", () => {
    const noNarration = structuredClone(civilizations);
    noNarration.scenes["tachara-note"] = {
      id: "tachara-note",
      title: "Broken",
      image: { src: "/wikido/x.svg", alt: "x" },
      narration: "   ",
      hotspots: [{ id: "a", label: "A", blurb: "b", x: 10, y: 10, info: { title: "T", body: ["p"] } }],
    };
    const errors = validateTopicPack(noNarration);
    expect(errors.some((e) => e.includes("narration"))).toBe(true);

    const badRoot = { ...civilizations, rootSceneId: "nope" };
    expect(validateTopicPack(badRoot).some((e) => e.includes("rootSceneId"))).toBe(true);
  });

  it("rejects hotspots missing the info card content", () => {
    const pack = structuredClone(civilizations);
    delete pack.scenes["bull-capitals"].hotspots[1].info;
    const errors = validateTopicPack(pack);
    expect(errors.some((e) => e.includes("info { title, body } is required"))).toBe(true);
  });
});
