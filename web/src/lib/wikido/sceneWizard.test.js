import { describe, it, expect } from "vitest";
import { branchChecklist, parentChoices, sceneChecklist, scenePath, spotRoom, whatBlock } from "./sceneWizard";

const sp = (id, child) => ({ id, label: id, ...(child ? { childSceneId: child } : {}) });
const pack = {
  rootSceneId: "root",
  scenes: {
    root: { id: "root", title: "Earth", image: { src: "https://x/a.png" }, hotspots: [sp("uk", "uk")] },
    uk: { id: "uk", title: "United Kingdom", image: { src: "" }, hotspots: [sp("lon", "lon"), ...Array.from({ length: 7 }, (_, i) => sp("f" + i))] },
    lon: { id: "lon", title: "London", image: { src: "/wikido/l.png" }, audio: "a.mp3", hotspots: [] },
  },
};

describe("sceneWizard", () => {
  it("builds the tree path", () => {
    expect(scenePath(pack, "lon")).toEqual(["Earth", "United Kingdom", "London"]);
  });
  it("lists parents with room and filters by path text", () => {
    const all = parentChoices(pack);
    expect(all.map((c) => c.id)).toEqual(["root", "uk", "lon"]);
    expect(all.find((c) => c.id === "uk").full).toBe(true);
    expect(spotRoom(pack, "root")).toBe(7);
    expect(parentChoices(pack, "united").map((c) => c.id)).toEqual(["uk", "lon"]);
  });
  it("hides the globe hub as a parent", () => {
    expect(parentChoices({ ...pack, view: "globe" }).map((c) => c.id)).toEqual(["uk", "lon"]);
  });
  it("explains why Next is blocked on the what step", () => {
    const base = { mode: "", label: "", focus: "", picked: null, outlineCount: 0, room: 5, topLevel: 0, busy: false };
    expect(whatBlock(base)).toMatch(/Choose/);
    expect(whatBlock({ ...base, mode: "type" })).toMatch(/Type/);
    expect(whatBlock({ ...base, mode: "type", label: "Volcano" })).toBe("");
    expect(whatBlock({ ...base, mode: "ideas" })).toMatch(/Get ideas/);
    expect(whatBlock({ ...base, mode: "branch", outlineCount: 6, topLevel: 6, room: 5 })).toMatch(/room for 5/);
    expect(whatBlock({ ...base, mode: "branch", outlineCount: 4, topLevel: 3, room: 5 })).toBe("");
  });
  it("checks what a scene still needs", () => {
    const c = sceneChecklist(pack, "lon", "draft");
    expect(c).toMatchObject({ scene: true, artwork: true, voice: true, spot: true, published: false, next: "published" });
    const u = sceneChecklist(pack, "uk", "published");
    expect(u.missing).toEqual(["artwork", "voice"]);
    expect(u.next).toBe("artwork");
    expect(sceneChecklist(pack, "nope").missing[0]).toBe("scene");
  });
  it("sums a branch", () => {
    expect(branchChecklist(pack, ["uk", "lon"], "draft")).toMatchObject({ total: 2, scenes: 2, artwork: 1, voice: 1, spots: 2 });
  });
});
