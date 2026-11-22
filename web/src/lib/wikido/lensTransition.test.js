import { describe, it, expect } from "vitest";
import { coverFit, transitionMode, playLensTurn } from "./lensTransition";

describe("lens turn", () => {
  it("picks webgl, css without WebGL, and a fade for reduced motion", () => {
    expect(transitionMode({ reduced: false, webgl: true })).toBe("webgl");
    expect(transitionMode({ reduced: false, webgl: false })).toBe("css");
    expect(transitionMode({ reduced: true, webgl: true })).toBe("fade");
  });
  it("cover-fits a picture onto a face of another shape", () => {
    expect(coverFit(16 / 9, 16 / 9)).toEqual({ rx: 1, ry: 1, ox: 0, oy: 0 });
    const wide = coverFit(2, 1);
    expect(wide.rx).toBeCloseTo(0.5);
    expect(wide.ox).toBeCloseTo(0.25);
    const tall = coverFit(1, 2);
    expect(tall.ry).toBeCloseTo(0.5);
    expect(tall.oy).toBeCloseTo(0.25);
  });
  it("css and fade turns put an overlay up and take it down; nothing to turn → no overlay", async () => {
    const box = document.createElement("div");
    document.body.appendChild(box);
    for (const mode of ["css", "fade"]) {
      const turn = await playLensTurn({ container: box, fromSrc: "/a.png", toSrc: "/b.png", mode });
      expect(turn.mode).toBe(mode);
      expect(box.querySelector(".wd-lens-turn")).not.toBeNull();
      await turn.covered;
      await turn.done;
      expect(box.querySelector(".wd-lens-turn")).toBeNull();
    }
    const none = await playLensTurn({ container: box, fromSrc: "", toSrc: "/b.png" });
    expect(none.mode).toBe("none");
  });
});
