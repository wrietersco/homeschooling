import { describe, it, expect } from "vitest";
import {
  stepOrder, placeChecklist, leftToDo, catalogChoices, cityChoices, locatePlace, sceneQuery, levelForKind, kindForLevel,
} from "./placeWizard";
import { globeDirectory } from "../../../../functions/lib/wikidoGlobe.js";

const pack = (hotspots, scenes = {}) => ({
  view: "globe",
  rootSceneId: "hub",
  scenes: { hub: { id: "hub", hotspots }, ...scenes },
});

describe("placeWizard", () => {
  it("orders steps by whether the spot is already located", () => {
    expect(stepOrder(true)).toEqual(["kind", "pick", "spot", "scene", "on"]);
    expect(stepOrder(false)).toEqual(["kind", "pick", "scene", "spot", "on"]);
  });

  it("maps kinds and levels", () => {
    expect(levelForKind("landmark")).toBe("location");
    expect(kindForLevel("location")).toBe("landmark");
    expect(kindForLevel("country")).toBe("country");
  });

  it("checklist: a pin with no scene needs a scene first", () => {
    const spot = { id: "pakistan", enabled: false };
    const c = placeChecklist(pack([spot]), spot);
    expect(c).toMatchObject({ pinned: true, scene: false, on: false, complete: false, firstStep: "scene" });
    expect(c.missing).toEqual(["scene", "on"]);
    expect(leftToDo(c)[0]).toMatch(/scene/);
  });

  it("checklist: scene + art + voice + on is complete", () => {
    const spot = { id: "pk", childSceneId: "pk-s", audio: "a.mp3" };
    const p = pack([spot], { "pk-s": { id: "pk-s", image: { src: "/wikido/x.png" }, audio: "b.mp3" } });
    const c = placeChecklist(p, spot);
    expect(c.complete).toBe(true);
    expect(c.missing).toEqual([]);
  });

  it("checklist: missing artwork/voice are listed but scene is done", () => {
    const spot = { id: "pk", childSceneId: "pk-s" };
    const p = pack([spot], { "pk-s": { id: "pk-s", image: { src: "" } } });
    const c = placeChecklist(p, spot);
    expect(c.missing).toEqual(["artwork", "voice"]);
    expect(c.firstStep).toBe("on");
  });

  it("catalog choices mark places already on the globe", () => {
    const dir = globeDirectory(pack([{ id: "pakistan", label: "Pakistan", level: "country", lat: 30, lng: 69, enabled: false }]));
    const rows = catalogChoices(dir, "country", "pak");
    expect(rows).toHaveLength(1);
    expect(rows[0].added).toBe(true);
    expect(catalogChoices(dir, "continent").length).toBeGreaterThan(3);
  });

  it("finds a country's cities, capital first", () => {
    const list = cityChoices("pk");
    expect(list.length).toBeGreaterThan(1);
    expect(list[0].capital).toBe(true);
    expect(cityChoices("pk", "lah").map((c) => c.name)).toContain("Lahore");
  });

  it("locates known cities and leaves landmarks to the model", () => {
    expect(locatePlace("city", "Lahore", "pk")).toMatchObject({ level: "city", name: "Lahore" });
    expect(locatePlace("landmark", "Eiffel Tower", "fr")).toBeNull();
    expect(locatePlace("city", "", "pk")).toBeNull();
  });

  it("builds the agent query", () => {
    expect(sceneQuery({ kind: "country", name: "Pakistan" })).toBe("Pakistan");
    expect(sceneQuery({ kind: "landmark", name: "Eiffel Tower", countryName: "France", located: false })).toBe("Eiffel Tower, France");
    expect(sceneQuery({ kind: "city", name: "Lahore", countryName: "Pakistan", located: true })).toBe("Lahore");
  });
});
