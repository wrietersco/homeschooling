import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { reactive } from "vue";
import WikidoAddSceneWizard from "./WikidoAddSceneWizard.vue";

const sp = (id, child) => ({ id, label: id, x: 30, y: 30, ...(child ? { childSceneId: child } : {}) });
function setup(extra = {}, start = { parentId: "uk" }) {
  const pack = reactive({
    rootSceneId: "root",
    scenes: {
      root: { id: "root", title: "Earth", image: { src: "" }, hotspots: [sp("uk", "uk")] },
      uk: { id: "uk", title: "United Kingdom", image: { src: "" }, hotspots: [] },
      full: { id: "full", title: "Crowded", image: { src: "" }, hotspots: Array.from({ length: 8 }, (_, i) => sp("f" + i)) },
    },
  });
  const props = {
    pack,
    topicStatus: "draft",
    start,
    isDirty: false,
    suggest: vi.fn(async () => ({ suggestions: [{ label: "Big Ben", focus: "the clock", why: "A famous clock" }] })),
    planOutline: vi.fn(async () => ({ outline: [{ label: "A", focus: "a", children: [{ label: "A1", focus: "a1", children: [] }] }, { label: "B", focus: "b", children: [] }] })),
    createScene: vi.fn(async ({ label }) => {
      const id = "n_" + label.replace(/\W/g, "").toLowerCase();
      pack.scenes[id] = { id, title: label, image: { src: "" }, hotspots: [] };
      pack.scenes.uk.hotspots.push(sp("s_" + id, id));
      return { sceneId: id, title: label };
    }),
    adopt: vi.fn(async () => {}),
    paintArt: vi.fn(async () => null),
    recordVoice: vi.fn(async () => null),
    publish: vi.fn(async () => null),
    goToScene: vi.fn(),
    ...extra,
  };
  const wrapper = mount(WikidoAddSceneWizard, { props, attachTo: document.body });
  return { wrapper, pack, props };
}
const body = () => document.body.textContent.replace(/\s+/g, " ");
const find = (label) => [...document.body.querySelectorAll("button")].find((b) => b.textContent.includes(label));
const click = async (label) => {
  const btn = find(label);
  expect(btn, `button “${label}”`).toBeTruthy();
  btn.click();
  await flushPromises();
};
const type = async (selector, value) => {
  const el = document.body.querySelector(selector);
  el.value = value;
  el.dispatchEvent(new Event("input"));
  await flushPromises();
};
const nextBtn = () => [...document.body.querySelectorAll(".wz-next button")].pop();

describe("WikidoAddSceneWizard", () => {
  it("preselects the parent and lists full pictures as unavailable", async () => {
    const { wrapper } = setup();
    expect(body()).toContain("Step 1 of 5");
    expect(body()).toContain("Earth › United Kingdom");
    const crowded = [...document.body.querySelectorAll(".wz-row")].find((r) => r.textContent.includes("Crowded"));
    expect(crowded.disabled).toBe(true);
    expect(nextBtn().disabled).toBe(false);
    wrapper.unmount();
  });

  it("blocks Next with a reason until a parent is chosen", async () => {
    const { wrapper } = setup({}, {});
    expect(nextBtn().disabled).toBe(true);
    expect(body()).toContain("Choose the scene it should open from.");
    await click("United Kingdom");
    expect(nextBtn().disabled).toBe(false);
    wrapper.unmount();
  });

  it("types a scene, reviews it, creates it and lands on the checklist", async () => {
    const { wrapper, props } = setup();
    await click("Next");
    expect(body()).toContain("What is it about?");
    expect(nextBtn().disabled).toBe(true);
    await click("I'll type it");
    await type("input[placeholder='e.g. Inside a Volcano']", "Inside a Volcano");
    await click("Next");
    expect(body()).toContain("Check and create");
    expect(body()).toContain("Inside a Volcano");
    await click("Create it");
    await flushPromises();
    expect(props.createScene).toHaveBeenCalledWith({ parentSceneId: "uk", label: "Inside a Volcano", focus: "" });
    expect(props.adopt).toHaveBeenCalled();
    await click("Next");
    expect(body()).toContain("Step 5 of 5");
    expect(body()).toContain("Spot on the parent picture");
    await click("Paint it");
    expect(props.paintArt).toHaveBeenCalledWith("n_insideavolcano");
    wrapper.unmount();
  });

  it("suggests ideas and uses the clicked one", async () => {
    const { wrapper, props } = setup();
    await click("Next");
    await click("Suggest ideas");
    await click("Get ideas");
    expect(props.suggest).toHaveBeenCalledWith("uk");
    await click("Big Ben");
    expect(nextBtn().disabled).toBe(false);
    await click("Next");
    expect(body()).toContain("Big Ben");
    wrapper.unmount();
  });

  it("shows a friendly error with Try again when creating fails", async () => {
    let calls = 0;
    const { wrapper, props } = setup({
      createScene: vi.fn(async () => {
        calls += 1;
        if (calls === 1) throw new Error("internal: deadline exceeded");
        return { sceneId: "x", title: "X" };
      }),
    });
    await click("Next");
    await click("I'll type it");
    await type("input[placeholder='e.g. Inside a Volcano']", "Volcano");
    await click("Next");
    await click("Create it");
    expect(body()).toContain("That took too long");
    await click("Try again");
    expect(props.createScene).toHaveBeenCalledTimes(2);
    expect(find("Try again")).toBeFalsy();
    wrapper.unmount();
  });

  it("drafts a branch outline, lets you remove a scene, and builds the rest", async () => {
    const { wrapper, props } = setup();
    await click("Next");
    await click("A whole branch");
    await click("Draft an outline");
    expect(document.body.querySelectorAll(".wz-orow").length).toBe(3);
    await click("Remove");
    await click("Next");
    expect(body()).toContain("New scenes (");
    await click("Create it");
    await flushPromises();
    expect(props.createScene).toHaveBeenCalled();
    wrapper.unmount();
  });
});
