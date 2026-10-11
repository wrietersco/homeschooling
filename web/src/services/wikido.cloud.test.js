import { describe, it, expect, vi, beforeEach } from "vitest";
import { listWikidoTopics, fetchCloudTopics, loadWikidoTopic, getWikidoTopic } from "./wikido.js";
import civilizations from "@/lib/wikido/topics/civilizations.js";

// jsdom lacks ResizeObserver — the explorer's cover-placement composable
// guards on it, but the global must exist for the view to mount.
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });

// A generated studio topic (Storage image URLs, no recorded audio — the runtime
// TTS fallback covers it).
const cloudPack = {
  id: "the-water-cycle",
  title: "The Water Cycle",
  emoji: "💧",
  tagline: "How a drop travels the world",
  rootSceneId: "overview",
  status: "published",
  discoveryCount: 2,
  scenes: {
    overview: {
      id: "overview",
      title: "The Water Cycle",
      image: { src: "https://firebasestorage.googleapis.com/x/overview.jpg", alt: "A valley" },
      narration: "Follow one drop.",
      hotspots: [
        { id: "sun", label: "The Sun", blurb: "The engine", x: 20, y: 10, info: { title: "The Sun", body: ["The sun lifts water."], fact: "Sunlight powers it all." } },
        { id: "clouds", label: "Clouds", blurb: "Water in the sky", x: 70, y: 20, childSceneId: "cloud", info: { title: "Clouds", body: ["Droplets gather."], fact: "Clouds are heavy." } },
      ],
    },
    cloud: {
      id: "cloud",
      title: "Inside a Cloud",
      image: { src: "https://firebasestorage.googleapis.com/x/cloud.jpg", alt: "A cloud" },
      narration: "Up high.",
      hotspots: [
        { id: "droplets", label: "Droplets", blurb: "Tiny drops", x: 50, y: 50, info: { title: "Droplets", body: ["Each cloud is droplets."] } },
      ],
    },
  },
};
const draftPack = { ...structuredClone(cloudPack), id: "draft-topic", title: "Unpublished Experiment", status: "draft" };

vi.mock("@/lib/firebase", () => ({
  db: {},
  auth: { currentUser: null },
  isEmulator: true,
}));

// the explorer reads the caller's role only to decide whether drafts preview
vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({ isSuperAdmin: false }),
}));

const docsMock = vi.hoisted(() => ({ all: [], filtered: [] }));
vi.mock("firebase/firestore", () => ({
  collection: (d, name) => ({ name }),
  query: (...args) => args,
  where: (field, op, value) => ({ field, op, value }),
  doc: (d, c, id) => ({ c, id }),
  getDocs: vi.fn(async (q) => {
    // the "published" query is recognised by its where clause
    const rows = Array.isArray(q) ? docsMock.filtered : docsMock.all;
    return { docs: rows.map((data) => ({ id: data.id, exists: true, data: () => data })) };
  }),
  getDoc: vi.fn(async (ref) => {
    const row = docsMock.all.find((d) => d.id === ref.id);
    return { id: ref.id, exists: () => Boolean(row), data: () => row };
  }),
}));

import WikidoView from "@/views/WikidoView.vue";

beforeEach(() => {
  docsMock.all = [cloudPack, draftPack];
  docsMock.filtered = [cloudPack];
});

describe("wikido cloud topics", () => {
  it("fetchCloudTopics returns published studio topics with shelf summaries", async () => {
    const topics = await fetchCloudTopics({ includeDrafts: false });
    expect(topics).toHaveLength(1);
    expect(topics[0].id).toBe("the-water-cycle");
    expect(topics[0].source).toBe("cloud");
    expect(topics[0].draft).toBe(false);
    expect(topics[0].sceneCount).toBe(2);
    expect(topics[0].discoveryCount).toBe(3);
    expect(topics[0].cover.src).toContain("firebasestorage");
  });

  it("superadmins also receive drafts, marked as previews", async () => {
    const topics = await fetchCloudTopics({ includeDrafts: true });
    expect(topics.map((t) => t.status !== undefined)).toBeTruthy();
    expect(topics.find((t) => t.id === "draft-topic")?.draft).toBe(true);
  });

  it("loadWikidoTopic resolves cloud packs and caches them", async () => {
    const pack = await loadWikidoTopic("the-water-cycle");
    expect(pack.title).toBe("The Water Cycle");
    // second load comes from cache without a fetch
    const again = await loadWikidoTopic("the-water-cycle");
    expect(again).toBe(pack);
    expect(loadWikidoTopic("unknown-topic")).resolves.toBeNull();
  });

  it("bundled packs still load synchronously", async () => {
    const pack = await loadWikidoTopic("civilizations");
    expect(pack.id).toBe("civilizations");
    expect(pack.scenes[pack.rootSceneId].hotspots.length).toBeGreaterThan(3);
  });

  it("invalid cloud packs are refused (a broken studio save never reaches a child)", async () => {
    docsMock.all = [{ ...cloudPack, id: "broken", scenes: { ...cloudPack.scenes, overview: { ...cloudPack.scenes.overview, hotspots: [] } } }];
    const topic = await loadWikidoTopic("broken");
    expect(topic).toBeNull();
    expect((await fetchCloudTopics({ includeDrafts: true }))).toHaveLength(0);
  });

  it("the explorer shelf merges bundled topics with published studio topics", async () => {
    const w = await mountView();
    await new Promise((r) => setTimeout(r, 0));
    const titles = w.findAll(".wd-topic-name").map((n) => n.text());
    expect(titles).toContain("Civilizations");
    expect(titles).toContain("The Water Cycle");
    // drafts never reach the child-facing shelf
    expect(titles).not.toContain(draftPack.title);
  });

  it("opening a cloud topic loads its pack and enters the root scene", async () => {
    const w = await mountView();
    await new Promise((r) => setTimeout(r, 0));
    const card = w.findAll(".wd-topic").find((c) => c.text().includes("The Water Cycle"));
    await card.trigger("click");
    await new Promise((r) => setTimeout(r, 0));
    expect(w.find(".wd-title").text()).toBe("The Water Cycle");
    expect(w.findAll(".wd-hot")).toHaveLength(2);
  });

  it("the shelf filters out drafts even if a query ever returns them", async () => {
    docsMock.filtered = [cloudPack, draftPack]; // pretend a stale draft slipped in
    const w = await mountView();
    await new Promise((r) => setTimeout(r, 0));
    const titles = w.findAll(".wd-topic-name").map((n) => n.text());
    expect(titles).toContain("The Water Cycle");
    expect(titles).not.toContain(draftPack.title);
  });
});

// Mount the real view with the router + speech + progress pieces it touches.
async function mountView() {
  const { mount } = await import("@vue/test-utils");
  const { createRouter, createMemoryHistory } = await import("vue-router");
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/", component: { template: "<div />" } }, { path: "/wikido", component: WikidoView }],
  });
  await router.push("/wikido");
  await router.isReady();
  return mount(WikidoView, { global: { plugins: [router] } });
}

void getWikidoTopic;
void listWikidoTopics;
void civilizations;
