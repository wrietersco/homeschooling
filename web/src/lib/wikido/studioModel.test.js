import { describe, it, expect } from "vitest";
import { spotOutcome, sceneStatus, descendantSceneIds, deletePlan, deleteSceneFrom, topicHealth, spotNeedsDetails, bundledTopicSummaries } from "./studioModel";

const img = { src: "https://x/y.png", alt: "a" };
const spot = (id, childSceneId) => ({ id, label: id, x: 1, y: 1, blurb: `The ${id} teaser.`, info: { title: id, body: [`About ${id}.`], fact: `A ${id} fact.` }, ...(childSceneId ? { childSceneId } : {}) });
const scenes = () => ({
  root: { id: "root", title: "Root", image: img, hotspots: [spot("a", "mid"), spot("f")] },
  mid: { id: "mid", title: "Mid", image: img, hotspots: [spot("b", "leaf")] },
  leaf: { id: "leaf", title: "Leaf", image: { src: "", alt: "a" }, hotspots: [spot("c")] },
});

describe("spotOutcome", () => {
  it("describes facts, scene links and broken links", () => {
    const s = scenes();
    expect(spotOutcome(s, spot("f")).kind).toBe("fact");
    expect(spotOutcome(s, spot("a", "mid"))).toMatchObject({ kind: "scene", targetId: "mid", text: "Opens “Mid”" });
    expect(spotOutcome(s, spot("z", "gone")).kind).toBe("broken");
  });

  it("describes cross-topic doorways as doors into another world", () => {
    const s = scenes();
    const worlds = new Map([["astronomy", { id: "astronomy", title: "Astronomy", status: "published", scenes: { "solar-system": { id: "solar-system", title: "The Solar System" } } }]]);
    const worldDoor = { ...spot("w", "solar-system"), childTopicId: "astronomy" };

    expect(spotOutcome(s, worldDoor, worlds)).toMatchObject({
      kind: "world",
      worldId: "astronomy",
      text: "Opens “The Solar System” in the world “Astronomy”",
    });
    // without the worlds catalog the door still reads sensibly
    expect(spotOutcome(s, worldDoor)).toMatchObject({ kind: "world", text: /another world/ });
    // a draft world says so
    const draft = new Map([["astronomy", { ...worlds.get("astronomy"), status: "draft" }]]);
    expect(spotOutcome(s, worldDoor, draft).text).toContain("(draft)");
    // an unknown world says which one is missing
    expect(spotOutcome(s, worldDoor, new Map()).text).toContain("astronomy");
  });
});

describe("sceneStatus", () => {
  it("flags missing artwork, spots and broken links", () => {
    const s = scenes();
    expect(sceneStatus(s, s.root).key).toBe("ready");
    expect(sceneStatus(s, s.leaf).key).toBe("needs-artwork");
    expect(sceneStatus(s, { ...s.mid, hotspots: [] }).key).toBe("needs-spots");
    expect(sceneStatus(s, { ...s.mid, hotspots: [spot("q", "gone")] }).key).toBe("broken-link");
  });

  it("treats cross-topic doorways as healthy when their world is known", () => {
    const s = scenes();
    const worldDoor = { ...spot("w", "solar-system"), childTopicId: "astronomy" };
    const worlds = new Map([["astronomy", { id: "astronomy", title: "Astronomy", status: "published" }]]);
    expect(sceneStatus(s, { ...s.mid, hotspots: [worldDoor] }, worlds).key).toBe("ready");
    // …and needs attention when the world is unknown
    expect(sceneStatus(s, { ...s.mid, hotspots: [worldDoor] }, new Map()).key).toBe("broken-link");
  });
});

describe("delete helpers", () => {
  it("lists the subtree and who opens the scene", () => {
    const s = scenes();
    expect(descendantSceneIds(s, "mid").sort()).toEqual(["leaf", "mid"]);
    expect(deletePlan(s, "mid")).toEqual({
      deeper: ["Leaf"],
      openedBy: [{ sceneId: "root", spotId: "a", label: "a", sceneTitle: "Root" }],
    });
  });

  it("deleting only the scene turns pointing spots back into facts", () => {
    const next = deleteSceneFrom(scenes(), "mid");
    expect(Object.keys(next)).toEqual(["root", "leaf"]);
    expect(next.root.hotspots[0].childSceneId).toBeUndefined();
    expect(next.root.hotspots.some(h => h.childSceneId === "leaf")).toBe(true);
  });

  it("deleting with deeper scenes removes the subtree and leaves no dangling links", () => {
    const next = deleteSceneFrom(scenes(), "mid", { withDeeper: true });
    expect(Object.keys(next)).toEqual(["root"]);
    expect(next.root.hotspots.every((h) => !h.childSceneId)).toBe(true);
  });

  it("a scene SHARED with the rest of the topic survives deleting the branch that also opens it", () => {
    const s = scenes();
    s.root.hotspots.push(spot("a2", "leaf")); // leaf is now opened from root AND mid
    // leaf is no longer "only through mid", so deleting mid keeps it standing
    expect(descendantSceneIds(s, "mid")).toEqual(["mid"]);
    expect(deletePlan(s, "mid").deeper).toEqual([]);
    const next = deleteSceneFrom(s, "mid", { withDeeper: true });
    expect(Object.keys(next).sort()).toEqual(["leaf", "root"]);
    expect(next.root.hotspots.some((h) => h.childSceneId === "leaf")).toBe(true);
  });

  it("deletePlan names EVERY doorway that opens a shared scene", () => {
    const s = scenes();
    s.root.hotspots.push(spot("a2", "mid"));
    expect(deletePlan(s, "mid").openedBy.map((o) => o.spotId).sort()).toEqual(["a", "a2"]);
  });
});

describe("topicHealth", () => {
  it("reports orphans and missing artwork in plain language", () => {
    const s = scenes();
    s.orphan = { id: "orphan", title: "Orphan", image: img, hotspots: [spot("o")] };
    const issues = topicHealth(s, "root");
    expect(issues.find((i) => i.sceneId === "orphan").level).toBe("error");
    expect(issues.find((i) => i.sceneId === "leaf").text).toMatch(/artwork/);
  });

  it("is clean for a healthy topic", () => {
    const s = scenes();
    s.leaf.image = img;
    expect(topicHealth(s, "root")).toEqual([]);
  });

  it("warns about cross-topic doorways into unknown or draft worlds", () => {
    const s = scenes();
    s.leaf.image = img;
    s.leaf.hotspots = [{ ...spot("w", "solar-system"), childTopicId: "astronomy" }];
    const worlds = new Map([["astronomy", { id: "astronomy", title: "Astronomy", status: "published" }]]);
    expect(topicHealth(s, "root", worlds)).toEqual([]);

    const unknown = topicHealth(s, "root", new Map());
    expect(unknown.some((i) => i.level === "warn" && i.text.includes("unknown world"))).toBe(true);

    const draft = topicHealth(s, "root", new Map([["astronomy", { id: "astronomy", title: "Astronomy", status: "draft" }]]));
    expect(draft.some((i) => i.level === "warn" && i.text.includes("still a draft"))).toBe(true);
  });
});

import { undoBuiltScenes } from "./studioModel";

describe("undoBuiltScenes", () => {
  it("removes the built scenes and the spots that opened them, keeping everything else", () => {
    const s = scenes();
    const next = undoBuiltScenes(s, ["mid", "leaf"]);
    expect(Object.keys(next)).toEqual(["root"]);
    expect(next.root.hotspots.map((h) => h.id)).toEqual(["f"]);
    expect(Object.keys(s)).toHaveLength(3); // input untouched
  });
});

describe("spotNeedsDetails", () => {
  it("flags the placeholder content a fresh spot is created with", () => {
    const fresh = {
      id: "spot-1", label: "New spot", blurb: "A short teaser", x: 50, y: 50,
      info: { title: "New discovery", body: ["Explain it in one child-friendly paragraph.", "Add a second paragraph if it needs more."], fact: "One surprising, true fact." },
    };
    expect(spotNeedsDetails(fresh).needs).toBe(true);
  });

  it("flags empty fields as needing details", () => {
    const empty = { id: "s", label: "The Moon", blurb: "", info: { title: "The Moon", body: ["x"] } };
    expect(spotNeedsDetails(empty)).toEqual({ needs: true, reason: "empty" });
  });

  it("passes real, written details", () => {
    const written = {
      id: "s", label: "The Moon", blurb: "Our closest neighbour", x: 20, y: 30,
      info: { title: "The Moon", body: ["Grey, dusty and full of craters."], fact: "It drifts away from us every year." },
    };
    expect(spotNeedsDetails(written)).toEqual({ needs: false, reason: null });
  });

  it("detects placeholders even when the curator changes one field", () => {
    const halfEdited = {
      id: "s", label: "The Moon", blurb: "A short teaser", // teaser still placeholder
      info: { title: "The Moon", body: ["Real text now."], fact: "Real fact." },
    };
    expect(spotNeedsDetails(halfEdited).needs).toBe(true);
  });
});

describe("topicHealth placeholder reporting", () => {
  it("warns about spots with placeholder details and suggests the agent", () => {
    const scenes = {
      root: {
        id: "root", title: "Looking Up", image: { src: "https://x/a.jpg", alt: "a" },
        hotspots: [
          { id: "s1", label: "The Moon", blurb: "Real teaser", childSceneId: "moon", x: 10, y: 10, info: { title: "The Moon", body: ["Real."] } },
          { id: "s2", label: "New spot", blurb: "A short teaser", x: 50, y: 50, info: { title: "New discovery", body: ["Explain it in one child-friendly paragraph."], fact: "One surprising, true fact." } },
        ],
      },
      moon: { id: "moon", title: "The Moon's Surface", image: { src: "https://x/m.jpg", alt: "m" }, hotspots: [] },
    };
    const issues = topicHealth(scenes, "root");
    const warn = issues.find((i) => i.text.includes("placeholder details"));
    expect(warn?.level).toBe("warn");
    expect(warn?.sceneId).toBe("root");
  });
});

describe("bundledTopicSummaries", () => {
  const packs = [
    {
      id: "living-things", title: "Living Things", tagline: "t", emoji: "🌿",
      rootSceneId: "root",
      scenes: {
        root: { id: "root", hotspots: [{ id: "a" }, { id: "b" }] },
        leaf: { id: "leaf", hotspots: [{ id: "c" }] },
      },
    },
  ];

  it("summarises every bundled pack with a bundled flag and discovery counts", () => {
    const [summary] = bundledTopicSummaries(packs);
    expect(summary).toMatchObject({
      id: "living-things", title: "Living Things", emoji: "🌿",
      rootSceneId: "root", discoveryCount: 3, status: "bundled", bundled: true,
    });
    expect(Object.keys(summary.scenes)).toEqual(["root", "leaf"]);
  });

  it("flags unsaved entries as bundled so the studio can create their first draft", () => {
    expect(bundledTopicSummaries(packs).every((t) => t.bundled && t.status === "bundled")).toBe(true);
    expect(bundledTopicSummaries([])).toEqual([]);
  });
});
