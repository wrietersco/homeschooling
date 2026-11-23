// Perspective Hall layout — pure maths, no DOM and no three.js.
//
// The hall is a ring of hologram panels around the viewer (who stands at the
// centre). Only the panels near the front are ever drawn, so 5 or 500
// perspectives cost the same: panel i sits at a signed offset d from the
// focused one (wrapped around the ring), and anything past `VISIBLE` steps is
// skipped. Swiping just changes the focus position.

export const STEP_DEG = 27; // angle between neighbouring panels
export const VISIBLE = 6; // panels drawn each side of the focused one

// Signed shortest offset of index i from position `pos` on a ring of n panels,
// in (-n/2, n/2]. `pos` may be fractional (mid-swipe).
export function ringOffset(i, pos, n) {
  if (n <= 0) return 0;
  let d = (((i - pos) % n) + n) % n; // 0..n
  if (d > n / 2) d -= n;
  return d;
}

// Which panels to draw for a fractional focus position: [{ i, d }], nearest first.
export function visiblePanels(pos, n, visible = VISIBLE) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = ringOffset(i, pos, n);
    if (Math.abs(d) <= visible + 0.5) out.push({ i, d });
  }
  return out.sort((a, b) => Math.abs(a.d) - Math.abs(b.d));
}

// Pose of a panel at offset d: angle round the ring, how big, how bright.
// The ring is small and cosy for a few panels and never so tight that
// neighbours overlap; with many panels the same angular step keeps every
// visible panel the same size.
export function panelPose(d, { stepDeg = STEP_DEG, radius = 9, visible = VISIBLE } = {}) {
  const a = Math.abs(d);
  const angle = (d * stepDeg * Math.PI) / 180;
  return {
    angle, // radians, 0 = straight ahead; panel centre = (sin a·R, 0, -cos a·R)
    x: Math.sin(angle) * radius,
    z: -Math.cos(angle) * radius,
    // the focused panel stands forward; the rest shrink smoothly with distance
    scale: a <= 1 ? 1.1 - 0.18 * a : Math.max(0.6, 0.92 - (a - 1) * 0.06),
    opacity: Math.max(0, Math.min(1, 1 - Math.max(0, a - (visible - 3)) / 3)),
    focus: Math.max(0, 1 - a), // 1 when centred, 0 a whole step away
  };
}

// Clamp or wrap a target index onto the ring.
export const wrapIndex = (i, n) => (n > 0 ? ((i % n) + n) % n : 0);

// Where a swipe should settle: round a fractional position (plus a flick
// velocity, in panels per second) to the panel to centre.
export function settleIndex(pos, velocity = 0, n = 1) {
  const flick = Math.max(-3, Math.min(3, Math.round(velocity * 0.18)));
  return wrapIndex(Math.round(pos) + flick, n);
}

// The shortest signed number of steps from the current position to a target index.
export function stepsTo(pos, target, n) {
  return ringOffset(target, pos, n);
}

// The text a panel carries (kept short: it is drawn onto a texture).
export function panelCaption(lens) {
  const scene = lens?.scene;
  const spots = Array.isArray(scene?.hotspots) ? scene.hotspots.length : 0;
  const tagline = lens?.lens?.description || "";
  return {
    title: lens?.lens?.name || "Overview",
    emoji: lens?.lens?.emoji || "🔭",
    color: lens?.lens?.color || "#38bdf8",
    sub: tagline ? String(tagline).slice(0, 90) : spots ? `${spots} things to discover` : "Look around",
    spots,
  };
}
