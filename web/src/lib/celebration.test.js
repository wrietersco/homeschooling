import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  CELEBRATION_SOUNDS, CELEBRATION_VALUES, DEFAULT_CELEBRATION, MIX_POOL, celebrationSources, resolveCelebration,
} from "./celebration";

const PUBLIC = resolve(__dirname, "../../public");

describe("celebration sounds", () => {
  it("every recording is saved in the app as a playable 24 kHz WAV (nothing generated at runtime)", () => {
    const files = CELEBRATION_SOUNDS.filter((s) => s.src);
    expect(files.length).toBeGreaterThanOrEqual(5);
    for (const s of files) {
      const path = resolve(PUBLIC, `.${s.src}`);
      expect(existsSync(path), s.src).toBe(true);
      const b = readFileSync(path);
      expect(b.toString("ascii", 0, 4)).toBe("RIFF");
      expect(b.toString("ascii", 8, 12)).toBe("WAVE");
      expect(b.readUInt32LE(24)).toBe(24000); // same rate as the buddy's voice context: no resampling
      const seconds = b.readUInt32LE(40) / (24000 * 2);
      expect(seconds, s.src).toBeGreaterThan(1);
      expect(seconds, s.src).toBeLessThan(6);
    }
  });

  it("offers Masha'Allah and clapping, and defaults to them together", () => {
    expect(CELEBRATION_VALUES).toEqual(expect.arrayContaining(["mashallah", "clapping", "mashallah_clap", "none", "mix"]));
    expect(DEFAULT_CELEBRATION).toBe("mashallah_clap");
  });

  it("the server accepts exactly the choices the panel offers", () => {
    const server = readFileSync(resolve(__dirname, "../../../functions/agents/explore.js"), "utf8");
    const list = server.match(/export const CELEBRATIONS = \[([^\]]+)\]/)[1].match(/"([^"]+)"/g).map((v) => v.slice(1, -1));
    expect(list).toEqual(CELEBRATION_VALUES);
    expect(server).toMatch(new RegExp(`DEFAULT_CELEBRATION = "${DEFAULT_CELEBRATION}"`));
  });

  it("resolves each choice to what should play", () => {
    expect(resolveCelebration("mashallah")).toEqual({ kind: "file", src: "/audio/celebrate/mashallah.wav" });
    expect(resolveCelebration("clapping")).toEqual({ kind: "file", src: "/audio/celebrate/clapping.wav" });
    expect(resolveCelebration("chime")).toEqual({ kind: "chime" });
    expect(resolveCelebration("none")).toBeNull();
    // Anything unknown falls back to the default rather than going silent.
    expect(resolveCelebration("bogus")).toEqual({ kind: "file", src: "/audio/celebrate/mashallah-clap.wav" });
  });

  it("'surprise me' picks a recording and never repeats the previous one", () => {
    const srcs = MIX_POOL.map((s) => s.src);
    let previous = "";
    for (let i = 0; i < 40; i++) {
      const pick = resolveCelebration("mix", { previous });
      expect(pick.kind).toBe("file");
      expect(srcs).toContain(pick.src);
      expect(pick.src).not.toBe(previous);
      previous = pick.src;
    }
    // rand() at its extreme edge can't index past the pool.
    expect(resolveCelebration("mix", { rand: () => 0.9999999 }).kind).toBe("file");
  });

  it("preloads only what the choice needs", () => {
    expect(celebrationSources("mashallah")).toEqual(["/audio/celebrate/mashallah.wav"]);
    expect(celebrationSources("mix")).toHaveLength(MIX_POOL.length);
    expect(celebrationSources("chime")).toEqual([]);
    expect(celebrationSources("none")).toEqual([]);
  });
});
