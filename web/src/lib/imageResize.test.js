import { describe, it, expect } from "vitest";
import { squareCrop, photoToDataUrl } from "./imageResize";

describe("imageResize", () => {
  it("centre-crops landscape and portrait images to a square", () => {
    expect(squareCrop(400, 200)).toEqual({ sx: 100, sy: 0, side: 200 });
    expect(squareCrop(300, 500)).toEqual({ sx: 0, sy: 100, side: 300 });
    expect(squareCrop(256, 256)).toEqual({ sx: 0, sy: 0, side: 256 });
  });

  it("rejects files that aren't pictures", async () => {
    await expect(photoToDataUrl(new File(["x"], "a.txt", { type: "text/plain" }))).rejects.toThrow(/picture/);
    await expect(photoToDataUrl(null)).rejects.toThrow(/picture/);
  });
});
