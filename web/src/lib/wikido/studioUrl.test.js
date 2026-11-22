import { describe, it, expect } from "vitest";
import { parseStudioLocation, buildStudioLocation, childLinkFor, sameLocation } from "./studioUrl.js";

describe("studio URL state", () => {
  it("reads world, scene, spot, wizard and tree filters", () => {
    expect(parseStudioLocation({
      params: { topicId: "earth", sceneId: "lahore" },
      query: { spot: "fort", wizard: "place", q: "mos", status: "draft,done" },
    })).toEqual({ topicId: "earth", sceneId: "lahore", spot: "fort", wizard: "place", q: "mos", statuses: ["draft", "done"] });
  });
  it("is empty for the bare studio and drops junk", () => {
    expect(parseStudioLocation({ params: {}, query: {} })).toEqual({ topicId: "", sceneId: "", spot: "", wizard: "", q: "", statuses: [] });
    expect(parseStudioLocation({ params: { topicId: "a/b" }, query: { wizard: "evil", status: "<x>" } })).toMatchObject({ topicId: "", wizard: "", statuses: [] });
  });
  it("builds paths, collapsing the entrance scene, and round-trips", () => {
    expect(buildStudioLocation({})).toEqual({ path: "/platform/wikido", query: {} });
    expect(buildStudioLocation({ topicId: "earth", sceneId: "hub" }, { rootSceneId: "hub" })).toEqual({ path: "/platform/wikido/earth", query: {} });
    const state = { topicId: "earth", sceneId: "lahore", spot: "fort", wizard: "scene", q: "mos", statuses: ["draft", "done"] };
    const loc = buildStudioLocation(state, { rootSceneId: "hub" });
    expect(loc.path).toBe("/platform/wikido/earth/lahore");
    const [, , , topicId, sceneId] = loc.path.split("/");
    expect(parseStudioLocation({ params: { topicId, sceneId }, query: loc.query })).toEqual({ ...state, statuses: ["done", "draft"] });
  });
  it("makes the child deep link", () => {
    expect(childLinkFor("earth", "lahore", "hub")).toBe("/wikido/earth/lahore");
    expect(childLinkFor("earth", "hub", "hub")).toBe("/wikido/earth");
    expect(childLinkFor("earth", "lahore", "hub", "fort")).toBe("/wikido/earth/lahore?card=fort");
  });
  it("compares locations to the current route", () => {
    expect(sameLocation({ path: "/a", query: { q: "x" } }, { path: "/a", query: { q: "x" } })).toBe(true);
    expect(sameLocation({ path: "/a", query: {} }, { path: "/a", query: { q: "x" } })).toBe(false);
  });
});
