import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { reactive } from "vue";
import WikidoAddPerspectiveWizard from "./WikidoAddPerspectiveWizard.vue";
import WikidoPerspectiveStrip from "./WikidoPerspectiveStrip.vue";

const spot = (id) => ({ id, label: id, blurb: `${id}!`, x: 30, y: 40, info: { title: id, body: ["x"] } });
function pack() {
  return {
    view: "globe", rootSceneId: "earth",
    scenes: {
      earth: { id: "earth", title: "Earth", hotspots: [{ id: "pk", label: "Pakistan", level: "country", childSceneId: "pakistan" }] },
      pakistan: { id: "pakistan", title: "Pakistan", narration: "n", image: { src: "https://x/p.png", alt: "p" }, hotspots: [spot("a")], perspectives: [{ id: "history", sceneId: "pakistan-history" }] },
      "pakistan-history": { id: "pakistan-history", title: "Pakistan — History", narration: "n", perspectiveOf: "pakistan", lens: "history", image: { src: "", alt: "h" }, hotspots: [spot("b"), spot("c"), spot("d")] },
    },
  };
}

function mountWizard(over = {}) {
  const jobs = reactive([]);
  const props = {
    pack: pack(),
    sceneId: "pakistan",
    jobs,
    preview: vi.fn(async (lens) => ({ title: `Pakistan — ${lens}`, narration: "Read me", hotspots: [spot("biryani"), spot("chai"), spot("mango")] })),
    start: vi.fn((lens, draft) => {
      const job = { key: `t:pakistan:${lens}`, lens, draft, sceneId: "", stages: { write: "running", paint: "idle", voice: "idle" }, errors: {}, note: "" };
      jobs.push(job);
      return job;
    }),
    retry: vi.fn(),
    publish: vi.fn(async () => null),
    ...over,
  };
  return { w: mount(WikidoAddPerspectiveWizard, { props, attachTo: document.body, global: { stubs: { Teleport: true } } }), props, jobs };
}

describe("Add a perspective wizard", () => {
  it("recommends place lenses first and marks the ones already added", () => {
    const { w } = mountWizard();
    const cards = w.findAll(".lens-card");
    expect(cards.length).toBeGreaterThanOrEqual(6);
    expect(cards[0].text()).toMatch(/History/);
    expect(cards[0].classes()).toContain("taken");
    expect(cards[0].text()).toMatch(/Already added/);
    expect(cards[1].text()).toMatch(/Culture/);
    expect(w.text()).toMatch(/is a country/);
  });

  it("pick → preview (spots listed, nothing saved) → make with the previewed draft → checklist", async () => {
    const { w, props, jobs } = mountWizard();
    const next = () => w.findAll(".wz-foot .btn.primary")[0];
    expect(next().attributes("disabled")).toBeDefined();
    await w.findAll(".lens-card").find((c) => /Food/.test(c.text())).trigger("click");
    await next().trigger("click");
    await flushPromises();
    expect(props.preview).toHaveBeenCalledWith("food", "");
    expect(w.findAll(".lens-spots li").map((l) => l.find("strong").text())).toEqual(["biryani", "chai", "mango"]);
    expect(props.start).not.toHaveBeenCalled();
    await next().trigger("click"); // Make it →
    await flushPromises();
    expect(props.start).toHaveBeenCalledWith("food", expect.objectContaining({ narration: "Read me" }), "");
    expect(next().attributes("disabled")).toBeDefined(); // still working
    // the queue reports a failed paint: retry offered, Next allowed (spots exist)
    Object.assign(jobs[0].stages, { write: "done", paint: "failed", voice: "done" });
    jobs[0].sceneId = "pakistan-history";
    jobs[0].errors.paint = "blocked";
    await flushPromises();
    expect(w.text()).toMatch(/blocked/);
    await w.findAll(".wz-actions-col .btn")[0].trigger("click");
    expect(props.retry).toHaveBeenCalledWith("t:pakistan:food");
    await next().trigger("click");
    expect(w.text()).toMatch(/What's next/);
    expect(w.findAll(".wz-steps li").map((li) => li.classes().includes("ok"))).toEqual([true, false, false, false]);
  });
});

describe("perspective strip", () => {
  it("shows Overview + each lens with spots / art / voice, and emits select / add", async () => {
    const w = mount(WikidoPerspectiveStrip, { props: { pack: pack(), sceneId: "pakistan", jobs: [] } });
    const chips = w.findAll(".lens-chip");
    expect(chips.map((c) => c.find(".name").text())).toEqual(["Overview", "History"]);
    expect(chips[1].text()).toMatch(/● 3/);
    expect(chips[1].text()).toMatch(/🎨✗/);
    expect(chips[1].text()).toMatch(/🔊0\/4/);
    await chips[1].find(".lens-chip-main").trigger("click");
    expect(w.emitted("select")[0]).toEqual(["pakistan-history"]);
    await w.find(".add").trigger("click");
    expect(w.emitted("add")).toHaveLength(1);
  });
});
