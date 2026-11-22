import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import WikidoArtworkPlan from "./WikidoArtworkPlan.vue";

const scene = () => ({
  id: "asia",
  hotspots: [
    { id: "india", label: "India", x: 45.7, y: 58.7, childSceneId: "in" },
    { id: "everest", label: "Everest", x: 41, y: 22 },
  ],
});

describe("WikidoArtworkPlan", () => {
  it("lists every spot with its visual subject and position, and edits the visual", async () => {
    const s = scene();
    const w = mount(WikidoArtworkPlan, { props: { scene: s, scenes: { in: { title: "Inside India" } } } });
    const text = w.text();
    expect(text).toContain("India");
    expect(text).toContain("Inside India");
    expect(text).toContain("centre, mid-ground");
    expect(text).toContain("upper centre, background");
    const inputs = w.findAll("input");
    expect(inputs).toHaveLength(2);
    expect(inputs[0].attributes("placeholder")).toContain("Taj Mahal");
    await inputs[0].setValue("a tiger in a mangrove");
    expect(s.hotspots[0].visual).toBe("a tiger in a mangrove");
    await inputs[0].setValue("");
    expect(s.hotspots[0].visual).toBeUndefined();
  });
});
