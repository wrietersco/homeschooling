import { describe, it, expect, vi } from "vitest";
import { planVoiceoverClips, checkVoiceoverBridge, synthesizeOnBridge, startVoiceoverBridge, bridgeLauncherStatus } from "./wikidoAdmin.js";
import { sortStudioTopics } from "./wikidoAdmin.js";

const pack = {
  id: "t",
  scenes: {
    a: {
      id: "a",
      title: "Scene A",
      narration: "Hello there.",
      hotspots: [
        { id: "sun", label: "Sun", info: { title: "The Sun", body: ["It shines."], fact: "It is bright." } },
        { id: "moon", label: "Moon", audio: "https://x/moon.mp3", info: { title: "The Moon", body: ["It glows."] } },
      ],
    },
    b: { id: "b", title: "Scene B", narration: "Deep dive.", audio: "https://x/b.mp3", hotspots: [] },
  },
};

describe("sortStudioTopics", () => {
  it("orders by the explicit order field, unordered topics last alphabetically", () => {
    const topics = [
      { id: "zeta", title: "Zeta", order: null },
      { id: "beta", title: "Beta", order: 1 },
      { id: "alpha", title: "Alpha", order: 0 },
      { id: "mid", title: "Mid", order: null },
    ];
    expect(sortStudioTopics(topics).map((t) => t.id)).toEqual(["alpha", "beta", "mid", "zeta"]);
  });

  it("does not mutate the input", () => {
    const topics = [{ id: "b", title: "B", order: 1 }, { id: "a", title: "A", order: 0 }];
    sortStudioTopics(topics);
    expect(topics.map((t) => t.id)).toEqual(["b", "a"]);
  });
});

describe("planVoiceoverClips", () => {
  it("plans every scene and hotspot that lacks a recording, speaking exactly what the UI reads", () => {
    const items = planVoiceoverClips(pack);
    // "a.moon" and "b" already have recordings — skipped
    expect(items.map((i) => i.id)).toEqual(["a", "a.sun"]);
    expect(items[0].text).toBe("Scene A. Hello there.");
    expect(items[1].text).toBe("The Sun It shines. Fun fact! It is bright.");
    void items;
  });

  it("re-records everything with force", () => {
    expect(planVoiceoverClips(pack, { force: true }).map((i) => i.id)).toEqual(["a", "a.sun", "a.moon", "b"]);
  });

  it("handles empty packs", () => {
    expect(planVoiceoverClips(null)).toEqual([]);
  });
});

describe("voiceover bridge client", () => {
  it("detects an online bridge", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, engine: "kokoro", voice: "af_heart", model: "Kokoro-82M" }) }));
    const status = await checkVoiceoverBridge();
    expect(status.online).toBe(true);
    expect(status.engine).toBe("kokoro");
  });

  it("reports offline when the bridge is not running", async () => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    const status = await checkVoiceoverBridge();
    expect(status.online).toBe(false);
  });

  it("sends items to the bridge and returns results", async () => {
    const fetchMock = vi.fn(async (url, opts) => ({
      ok: true,
      json: async () => ({ results: [{ id: "a", mp3: "QQ==", seconds: 2.1 }], failed: [] }),
    }));
    globalThis.fetch = fetchMock;
    const res = await synthesizeOnBridge("http://localhost:8787", [{ id: "a", text: "Hello" }]);
    expect(res.results[0].mp3).toBe("QQ==");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:8787/generate");
    expect(JSON.parse(init.body).items[0].text).toBe("Hello");
  });
});

describe("bridge launcher client (dev server)", () => {
  it("start reports the launched process when the launcher answers", async () => {
    globalThis.fetch = vi.fn(async (url) => ({
      ok: true,
      json: async () => ({ ok: true, pid: 7, alive: true, url }),
    }));
    const res = await startVoiceoverBridge();
    expect(res).toMatchObject({ supported: true, ok: true, pid: 7 });
  });

  it("start is unsupported when there is no launcher (production hosting, fetch failure, or HTML)", async () => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    expect((await startVoiceoverBridge()).supported).toBe(false);
    // a rewrite to the SPA's index.html is not JSON → unsupported, not a crash
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => { throw new Error("Unexpected token <"); } }));
    expect((await startVoiceoverBridge()).supported).toBe(false);
    // the launcher answered with a business error → still unsupported, reason carried
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: false, error: "Bridge script not found: x" }) }));
    const res = await startVoiceoverBridge();
    expect(res.supported).toBe(false);
    expect(res.error).toContain("not found");
  });

  it("status reports the real process state", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, managed: true, alive: false, pid: 7, exit: { code: 1 }, output: ["boom"] }),
    }));
    const res = await bridgeLauncherStatus();
    expect(res).toMatchObject({ supported: true, alive: false, exit: { code: 1 }, output: ["boom"] });
    globalThis.fetch = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    expect((await bridgeLauncherStatus()).supported).toBe(false);
  });
});
