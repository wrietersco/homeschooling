import { describe, it, expect } from "vitest";
import {
  DEG, ZOOM_MIN, ZOOM_MAX, LEVEL_ZOOM, clampZoom, clampRotation, latLngToVec3,
  projectSpot, screenToLatLng, horizonBlend, levelVisibleAtZoom, spotOpacityAtZoom,
  currentLevelAtZoom,
  nextLevelZoom,
  formatLatLng,
} from "./projection";

const len = (v) => Math.hypot(v.x, v.y, v.z);

describe("globe projection", () => {
  it("keeps every rotated unit vector on the unit sphere", () => {
    for (const lat of [-90, -45, 0, 45, 90]) {
      for (const lng of [-180, -90, 0, 90, 180]) {
        const v = latLngToVec3(lat, lng, { lambda: 30, phi: -20 });
        expect(len(v)).toBeCloseTo(1, 10);
      }
    }
  });

  it("brings the rotated point to face the viewer (z = 1)", () => {
    const v = latLngToVec3(30, 120, { lambda: 120, phi: 30 });
    expect(v.z).toBeCloseTo(1, 10);
    expect(v.x).toBeCloseTo(0, 10);
    expect(v.y).toBeCloseTo(0, 10);
  });

  it("hides the antipodes and straddles the horizon", () => {
    expect(latLngToVec3(30, 120, { lambda: -60, phi: -30 }).z).toBeCloseTo(-1, 10);
    // 90° away sits on the limb
    const limb = latLngToVec3(0, 90, { lambda: 0, phi: 0 });
    expect(limb.z).toBeCloseTo(0, 10);
    expect(limb.x).toBeCloseTo(1, 10);
  });

  it("projects spots to screen coordinates with visibility and depth", () => {
    const cam = { cx: 400, cy: 300, r: 200 };
    const front = projectSpot(22, 70, { lambda: 70, phi: 22 }, cam);
    expect(front.visible).toBe(true);
    expect(front.x).toBeCloseTo(400, 6);
    expect(front.y).toBeCloseTo(300, 6);
    expect(front.depth).toBeCloseTo(1, 6);

    const east = projectSpot(0, 160, { lambda: 70, phi: 0 }, cam);
    expect(east.visible).toBe(true);
    expect(east.x).toBeGreaterThan(400); // to the right of centre

    const back = projectSpot(22, 70, { lambda: -110, phi: -22 }, cam);
    expect(back.visible).toBe(false);
  });

  it("finds the horizon crossing between a visible and a hidden point", () => {
    // along the equator the blend stays on a great circle, so the crossing is
    // exactly 90° from the viewer
    const a = latLngToVec3(0, 80, { lambda: 0, phi: 0 }); // z > 0
    const b = latLngToVec3(0, 110, { lambda: 0, phi: 0 }); // z < 0
    expect(a.z).toBeGreaterThan(0);
    expect(b.z).toBeLessThan(0);
    const t = horizonBlend(a, b);
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThan(1);
    // the straight-line clip lands a fraction of a degree from the true limb
    // (chord vs arc) — far below anything visible on a stylized globe
    expect(Math.abs(80 + (110 - 80) * t - 90)).toBeLessThan(0.2);
  });

  it("inverts screen positions back to lat/lng (the studio pin drag)", () => {
    const cam = { cx: 400, cy: 300, r: 200 };
    const rot = { lambda: 70, phi: 22 };
    // round-trips hold for the VISIBLE hemisphere — where drags happen
    for (const [lat, lng] of [[30.4, 69.3], [0, 0], [55, 140], [-30, 20], [35.7, 139.7]]) {
      const p = projectSpot(lat, lng, rot, cam);
      expect(p.visible, `${lat},${lng}`).toBe(true);
      const back = screenToLatLng(p.x, p.y, rot, cam);
      expect(back.lat).toBeCloseTo(lat, 6);
      expect(back.lng).toBeCloseTo(lng, 6);
    }
  });

  it("clamps off-planet drags onto the limb instead of flipping to the far side", () => {
    const cam = { cx: 400, cy: 300, r: 200 };
    const rot = { lambda: 70, phi: 22 };
    // far outside the disk: pinned to the horizon
    const edge = screenToLatLng(400 + 500, 300, rot, cam);
    const vec = latLngToVec3(edge.lat, edge.lng, rot);
    expect(vec.z).toBeCloseTo(0, 6); // exactly on the limb, never behind
  });

  it("clamps zoom and rotation into safe ranges", () => {
    expect(clampZoom(0.2)).toBe(ZOOM_MIN);
    expect(clampZoom(99)).toBe(ZOOM_MAX);
    expect(clampRotation({ lambda: 270, phi: 120 })).toEqual({ lambda: -90, phi: 85 });
    expect(clampRotation({ lambda: -200, phi: -120 })).toEqual({ lambda: 160, phi: -85 });
  });

  it("shows ONE layer at a time — parents hide as the child zooms deeper", () => {
    expect(LEVEL_ZOOM).toEqual({ country: 1, city: 2.2, location: 3.8 });

    // zoomed out: countries only
    expect(levelVisibleAtZoom("country", ZOOM_MIN)).toBe(true);
    expect(levelVisibleAtZoom("city", ZOOM_MIN)).toBe(false);
    expect(levelVisibleAtZoom("location", ZOOM_MIN)).toBe(false);

    // inside the city band: countries have handed over, landmarks wait
    expect(levelVisibleAtZoom("country", 3)).toBe(false);
    expect(levelVisibleAtZoom("city", 3)).toBe(true);
    expect(levelVisibleAtZoom("location", 3)).toBe(false);

    // inside the location band: cities hide too
    expect(levelVisibleAtZoom("city", ZOOM_MAX)).toBe(false);
    expect(levelVisibleAtZoom("location", ZOOM_MAX)).toBe(true);

    // the hand-over is a gentle cross-fade, not a pop
    expect(spotOpacityAtZoom("country", ZOOM_MIN)).toBeCloseTo(1, 12);
    expect(spotOpacityAtZoom("country", 2)).toBeLessThan(1);
    expect(spotOpacityAtZoom("country", 2.2)).toBeCloseTo(0, 12); // parent fully hidden
    expect(spotOpacityAtZoom("city", 2)).toBeGreaterThan(0);
    expect(spotOpacityAtZoom("city", 2)).toBeLessThan(1);
    expect(spotOpacityAtZoom("city", 2.2)).toBeCloseTo(1, 12);
    expect(spotOpacityAtZoom("city", 3.6)).toBeLessThan(1);
    expect(spotOpacityAtZoom("city", 3.8)).toBeCloseTo(0, 12);
    expect(spotOpacityAtZoom("location", 3.6)).toBeGreaterThan(0);
    expect(spotOpacityAtZoom("location", 4.5)).toBeCloseTo(1, 12);
  });

  it("names the layer the child is inside and where each hand-over happens", () => {
    expect(currentLevelAtZoom(ZOOM_MIN)).toBe("country");
    expect(currentLevelAtZoom(3)).toBe("city");
    expect(currentLevelAtZoom(4)).toBe("location");
    expect(nextLevelZoom("country")).toBe(2.2);
    expect(nextLevelZoom("city")).toBe(3.8);
    expect(nextLevelZoom("location")).toBe(Infinity);
  });

  it("formats coordinates for the studio readout", () => {
    expect(formatLatLng(31.55, 74.34)).toBe("31.6°N, 74.3°E");
    expect(formatLatLng(-22.91, -43.17)).toBe("22.9°S, 43.2°W");
    expect(180 / Math.PI).toBeCloseTo(1 / DEG, 6);
  });
});
