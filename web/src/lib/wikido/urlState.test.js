import { describe, it, expect } from "vitest";
import {
  parseAt, formatAt, parseWikidoLocation, buildWikidoLocation,
  reachableSceneIds, cardAvailable, resolveWikidoTarget, coldJourneySegment,
} from "./urlState.js";

const spot = (id, extra = {}) => ({ id, ...extra });
const pack = {
  id: "earth", title: "Earth", view: "globe", rootSceneId: "hub",
  scenes: {
    hub: { id: "hub", title: "Earth", hotspots: [
      spot("pk", { childSceneId: "pakistan", lat: 30, lng: 70 }),
      spot("off", { childSceneId: "hidden", lat: 10, lng: 10, enabled: false }),
      spot("nogeo", { lat: undefined }),
    ] },
    pakistan: { id: "pakistan", title: "Pakistan", hotspots: [spot("lhr", { childSceneId: "lahore" })] },
    lahore: { id: "lahore", title: "Lahore", hotspots: [spot("fort")] },
    hidden: { id: "hidden", title: "Hidden", hotspots: [spot("x")] },
    loose: { id: "loose", title: "Loose", hotspots: [] },
  },
};

describe("parseAt / formatAt", () => {
  it("round-trips lat,lng,zoom", () => {
    expect(parseAt("31.55,74.34,4.5")).toEqual({ lat: 31.55, lng: 74.34, zoom: 4.5 });
    expect(formatAt({ lat: 31.5512, lng: 74.3399, zoom: 4.5049 })).toBe("31.55,74.34,4.5");
  });
  it("accepts lat,lng without zoom and rejects junk", () => {
    expect(parseAt("1,2")).toEqual({ lat: 1, lng: 2, zoom: null });
    for (const bad of ["", "a,b", "91,0", "0,181", "1", "1,2,3,4", "1,2,0.2", undefined, 5]) expect(parseAt(bad)).toBeNull();
  });
});

describe("parseWikidoLocation", () => {
  it("reads topic, scene, card, camera and panel", () => {
    expect(parseWikidoLocation({
      params: { topicId: "earth", sceneId: "lahore" },
      query: { card: "fort", at: "31,74,3", intro: "0" },
    })).toEqual({ topicId: "earth", sceneId: "lahore", card: "fort", at: { lat: 31, lng: 74, zoom: 3 }, intro: false, lens: "" });
  });
  it("is empty for the shelf and drops unsafe ids", () => {
    expect(parseWikidoLocation({ params: {}, query: {} })).toEqual({ topicId: "", sceneId: "", card: "", at: null, intro: null, lens: "" });
    expect(parseWikidoLocation({ params: { topicId: "a b/../" }, query: { card: "<x>", intro: "9" } })).toMatchObject({ topicId: "", card: "", intro: null });
  });
});

describe("buildWikidoLocation", () => {
  it("builds each level of the scheme", () => {
    expect(buildWikidoLocation({})).toEqual({ path: "/wikido", query: {} });
    expect(buildWikidoLocation({ topicId: "earth", sceneId: "hub" }, { rootSceneId: "hub" })).toEqual({ path: "/wikido/earth", query: {} });
    expect(buildWikidoLocation({ topicId: "earth", sceneId: "lahore", card: "fort", intro: false }, { rootSceneId: "hub" }))
      .toEqual({ path: "/wikido/earth/lahore", query: { card: "fort", intro: "0" } });
    expect(buildWikidoLocation({ topicId: "earth", at: { lat: 1.234, lng: 5, zoom: 2 } }).query).toEqual({ at: "1.23,5,2" });
  });
  it("round-trips through parse", () => {
    const state = { topicId: "earth", sceneId: "lahore", card: "fort", at: null, intro: true, lens: "history" };
    const loc = buildWikidoLocation(state, { rootSceneId: "hub" });
    const [, , topicId, sceneId] = loc.path.split("/");
    expect(parseWikidoLocation({ params: { topicId, sceneId }, query: loc.query })).toEqual(state);
  });
});

describe("resolving against a pack", () => {
  it("knows which scenes are reachable (switched-off places and loose scenes are not)", () => {
    expect([...reachableSceneIds(pack)].sort()).toEqual(["hub", "lahore", "pakistan"]);
  });
  it("accepts a valid scene + card", () => {
    expect(resolveWikidoTarget(pack, { sceneId: "lahore", card: "fort" })).toEqual({ sceneId: "lahore", lens: "", displaySceneId: "lahore", card: "fort", notice: "" });
  });
  it("lands on the root for the bare topic URL", () => {
    expect(resolveWikidoTarget(pack, { sceneId: "", card: "" })).toEqual({ sceneId: "hub", lens: "", displaySceneId: "hub", card: "", notice: "" });
  });
  it("falls back to the root, with a notice, for unknown, switched-off and loose scenes", () => {
    for (const sceneId of ["nope", "hidden", "loose"]) {
      const r = resolveWikidoTarget(pack, { sceneId, card: "x" });
      expect(r.sceneId).toBe("hub");
      expect(r.card).toBe("");
      expect(r.notice).toMatch(/isn't open any more/);
    }
  });
  it("drops an unknown card but keeps the scene", () => {
    const r = resolveWikidoTarget(pack, { sceneId: "pakistan", card: "ghost" });
    expect(r.sceneId).toBe("pakistan");
    expect(r.card).toBe("");
    expect(r.notice).toMatch(/card/);
  });
  it("treats disabled or un-pinned hub spots as unavailable cards", () => {
    expect(cardAvailable(pack, "hub", "pk")).toBe(true);
    expect(cardAvailable(pack, "hub", "off")).toBe(false);
    expect(cardAvailable(pack, "hub", "nogeo")).toBe(false);
  });
  it("builds the cold-open journey from natural ancestors", () => {
    expect(coldJourneySegment(pack, "lahore")).toEqual({ topicId: "earth", scenes: ["hub", "pakistan", "lahore"] });
  });
});

describe("perspectives (lens) in the URL", () => {
  const lensPack = JSON.parse(JSON.stringify(pack));
  lensPack.scenes.pakistan.perspectives = [{ id: "history", sceneId: "pakistan-history" }];
  lensPack.scenes["pakistan-history"] = { id: "pakistan-history", title: "Pakistan — History", perspectiveOf: "pakistan", lens: "history", hotspots: [spot("mughals", { childSceneId: "mughal-fort" })] };
  lensPack.scenes["mughal-fort"] = { id: "mughal-fort", title: "Mughal Fort", hotspots: [spot("gate")] };

  it("lens rides as ?lens= and Overview is omitted", () => {
    expect(buildWikidoLocation({ topicId: "earth", sceneId: "pakistan", lens: "history" }).query).toEqual({ lens: "history" });
    expect(buildWikidoLocation({ topicId: "earth", sceneId: "pakistan", lens: "main" }).query).toEqual({});
  });
  it("resolves a lens to its picture, a lens scene id to base + lens, and an unknown lens to the Overview", () => {
    expect(resolveWikidoTarget(lensPack, { sceneId: "pakistan", lens: "history", card: "mughals" }))
      .toEqual({ sceneId: "pakistan", lens: "history", displaySceneId: "pakistan-history", card: "mughals", notice: "" });
    expect(resolveWikidoTarget(lensPack, { sceneId: "pakistan-history", card: "" }))
      .toMatchObject({ sceneId: "pakistan", lens: "history", displaySceneId: "pakistan-history" });
    const food = resolveWikidoTarget(lensPack, { sceneId: "pakistan", lens: "food", card: "" });
    expect(food).toMatchObject({ sceneId: "pakistan", lens: "", displaySceneId: "pakistan" });
    expect(food.notice).toMatch(/main picture/);
  });
  it("scenes opened from a lens are reachable, with the lens in their trail", () => {
    expect(reachableSceneIds(lensPack).has("mughal-fort")).toBe(true);
    expect(resolveWikidoTarget(lensPack, { sceneId: "mughal-fort", card: "gate" })).toMatchObject({ sceneId: "mughal-fort", card: "gate", notice: "" });
    expect(coldJourneySegment(lensPack, "mughal-fort")).toEqual({ topicId: "earth", scenes: ["hub", "pakistan-history", "mughal-fort"] });
    expect(coldJourneySegment(lensPack, "pakistan-history")).toEqual({ topicId: "earth", scenes: ["hub", "pakistan-history"] });
  });
});
