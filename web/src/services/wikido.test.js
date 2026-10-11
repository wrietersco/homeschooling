import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { listWikidoTopics, getWikidoTopic } from "./wikido.js";
import { wikidoTopicPacks } from "@/lib/wikido";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("wikido service", () => {
  it("lists every published topic as a shelf summary", () => {
    const topics = listWikidoTopics();
    expect(topics.map((t) => t.id)).toEqual(wikidoTopicPacks.map((p) => p.id));
    for (const t of topics) {
      expect(t.title).toBeTruthy();
      expect(t.tagline).toBeTruthy();
      expect(t.cover.src).toMatch(/^\/wikido\//);
      expect(t.sceneCount).toBeGreaterThan(0);
    }
  });

  it("returns the full validated pack for a known topic", () => {
    const pack = getWikidoTopic("civilizations");
    expect(pack).not.toBeNull();
    expect(pack.scenes[pack.rootSceneId]).toBeTruthy();
    // every childSceneId reference resolves
    for (const scene of Object.values(pack.scenes)) {
      for (const spot of scene.hotspots) {
        if (spot.childSceneId) expect(pack.scenes[spot.childSceneId]).toBeTruthy();
      }
    }
  });

  it("returns null for an unknown topic", () => {
    expect(getWikidoTopic("atlantis")).toBeNull();
  });

  it("ships every referenced image and audio clip as a real asset", () => {
    // Publish integrity: a pack that references a missing file would show a
    // child a broken picture or a silent Listen button — fail loudly here.
    for (const pack of wikidoTopicPacks) {
      for (const assetPath of [pack.cover.src, ...Object.values(pack.scenes).flatMap((s) => [s.image.src, s.audio, ...s.hotspots.map((h) => h.audio)])]) {
        if (!assetPath) continue;
        expect(existsSync(path.join(webRoot, "public", assetPath)), assetPath).toBe(true);
      }
    }
  });
});
