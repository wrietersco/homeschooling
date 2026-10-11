import { describe, it, expect } from "vitest";
import { spotOutcome, sceneStatus, descendantSceneIds, deletePlan, deleteSceneFrom, topicHealth, spotNeedsDetails } from "./studioModel";

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
});

describe("sceneStatus", () => {
  it("flags missing artwork, spots and broken links", () => {
    const s = scenes();
    expect(sceneStatus(s, s.root).key).toBe("ready");
    expect(sceneStatus(s, s.leaf).key).toBe("needs-artwork");
    expect(sceneStatus(s, { ...s.mid, hotspots: [] }).key).toBe("needs-spots");
    expect(sceneStatus(s, { ...s.mid, hotspots: [spot("q", "gone")] }).key).toBe("broken-link");
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
  });

  it("deleting with deeper scenes removes the subtree and leaves no dangling links", () => {
    const next = deleteSceneFrom(scenes(), "mid", { withDeeper: true });
    expect(Object.keys(next)).toEqual(["root"]);
    expect(next.root.hotspots.every((h) => !h.childSceneId)).toBe(true);
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
