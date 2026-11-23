import { corsImageUrl } from "./hallLayout.js";
// The "lens turn": when a child switches a scene's perspective, the picture
// turns like a prism — the old artwork on the face we look at, the new one on
// the next face — with a slight pull-back for depth, then hands the screen
// back to the ordinary scene underneath.
//
//   webgl  three.js (lazy-loaded, its own chunk) — a box whose faces carry the
//          two artworks, cover-fitted. Renders only during the ~0.7 s turn and
//          disposes everything after, so nothing runs while a child explores.
//   css    no WebGL: the same turn as a CSS 3D cube.
//   fade   prefers-reduced-motion: a short cross-fade, no movement.
//
// playLensTurn() resolves `covered` once the overlay shows the OLD picture
// (the caller may then swap the scene underneath) and `done` when it is gone.

const DURATION = 700;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2); // easeInOutCubic

export function prefersReducedMotion() {
  try { return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches); } catch { return false; }
}

let webglOk = null;
export function hasWebGL() {
  if (webglOk !== null) return webglOk;
  try {
    const c = document.createElement("canvas");
    webglOk = Boolean(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    webglOk = false;
  }
  return webglOk;
}

export function transitionMode({ reduced = prefersReducedMotion(), webgl = hasWebGL() } = {}) {
  if (reduced) return "fade";
  return webgl ? "webgl" : "css";
}

// cover-fit of an image (aspect ia) onto a face (aspect fa): texture repeat/offset
export function coverFit(ia, fa) {
  if (!(ia > 0) || !(fa > 0)) return { rx: 1, ry: 1, ox: 0, oy: 0 };
  if (ia > fa) { const rx = fa / ia; return { rx, ry: 1, ox: (1 - rx) / 2, oy: 0 }; }
  const ry = ia / fa;
  return { rx: 1, ry, ox: 0, oy: (1 - ry) / 2 };
}

// Load an image, resolving (never rejecting) within `timeout` ms: true = ready.
const loaded = new Map();
export function preloadImage(src, timeout = 1500) {
  if (!src) return Promise.resolve(false);
  if (loaded.get(src) === true) return Promise.resolve(true);
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = "async";
    img.crossOrigin = "anonymous"; // same CORS mode as the WebGL texture load, so it warms the same cache entry
    const t =setTimeout(() => resolve(false), timeout);
    img.onload = () => { clearTimeout(t); loaded.set(src, true); resolve(true); };
    img.onerror = () => { clearTimeout(t); resolve(false); };
    img.src = corsImageUrl(src);
  });
}

function overlay(container) {
  const el = document.createElement("div");
  el.className = "wd-lens-turn";
  Object.assign(el.style, {
    position: "absolute", inset: "0", zIndex: "45", pointerEvents: "none", overflow: "hidden",
    background: "#140B20", transition: "opacity 160ms ease", opacity: "1",
  });
  container.appendChild(el);
  return el;
}
const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function fadeOut(el) {
  el.style.opacity = "0";
  await wait(170);
  el.remove();
}

// ── modes ─────────────────────────────────────────────────────────────────────
async function playFade(container, fromSrc) {
  const el = overlay(container);
  el.style.background = `#140B20 center / cover no-repeat url("${fromSrc}")`;
  el.style.transition = "opacity 260ms ease";
  await frame();
  return { covered: Promise.resolve(), done: (async () => { await wait(40); await fadeOut(el); })() };
}

async function playCss(container, fromSrc, toSrc, direction) {
  const el = overlay(container);
  const w = container.clientWidth || window.innerWidth;
  el.style.perspective = `${Math.round(w * 1.6)}px`;
  const cube = document.createElement("div");
  Object.assign(cube.style, {
    position: "absolute", inset: "0", transformStyle: "preserve-3d",
    transform: `translateZ(${-w / 2}px) rotateY(0deg)`, transition: `transform ${DURATION}ms cubic-bezier(.65,0,.35,1)`,
  });
  const face = (src, rot) => {
    const f = document.createElement("div");
    Object.assign(f.style, {
      position: "absolute", inset: "0", backfaceVisibility: "hidden",
      background: `#140B20 center / cover no-repeat url("${src}")`,
      transform: `rotateY(${rot}deg) translateZ(${w / 2}px)`,
    });
    return f;
  };
  cube.append(face(fromSrc, 0), face(toSrc, 90 * direction));
  el.appendChild(cube);
  await frame();
  await frame();
  cube.style.transform = `translateZ(${-w / 2}px) rotateY(${-90 * direction}deg)`;
  return { covered: Promise.resolve(), done: (async () => { await wait(DURATION + 30); await fadeOut(el); })() };
}

// The 3D module is fetched ahead of time (idle) once a scene has lenses, so
// the first turn starts at once even on a slow tablet.
let turnModule = null;
const loadTurn3d = () => (turnModule ||= import("./lensTurn3d.js").catch((e) => { turnModule = null; throw e; }));
export function warmLensTurn() {
  if (transitionMode() !== "webgl") return;
  const go = () => loadTurn3d().catch(() => {});
  if ("requestIdleCallback" in window) window.requestIdleCallback(go, { timeout: 4000 });
  else setTimeout(go, 1500);
}

async function playWebgl(container, fromSrc, toSrc, direction) {
  // the old picture covers the screen at once; the prism takes over when ready
  const el = overlay(container);
  el.style.background = `#140B20 center / cover no-repeat url("${fromSrc}")`;
  const { createTurn3d } = await loadTurn3d().catch((e) => { el.remove(); throw e; });
  const width = container.clientWidth || window.innerWidth;
  const height = container.clientHeight || window.innerHeight;
  const turn3d = createTurn3d({ width, height });
  Object.assign(turn3d.canvas.style, { width: "100%", height: "100%", display: "block" });
  el.appendChild(turn3d.canvas);
  const [from, to] = await Promise.all([turn3d.loadTexture(fromSrc), turn3d.loadTexture(toSrc)]);
  if (!from || !to) {
    // a picture that refuses to become a texture (e.g. no CORS) → CSS turn
    turn3d.dispose();
    const css = await playCss(container, fromSrc, toSrc, direction);
    el.remove();
    return css;
  }
  const render = turn3d.build({ from, to, direction, fit: coverFit });
  render(0);
  let resolveDone;
  const done = new Promise((r) => { resolveDone = r; });
  const start = performance.now();
  const tick = (now) => {
    const t = Math.min(1, (now - start) / DURATION);
    render(ease(t));
    if (t < 1) requestAnimationFrame(tick);
    else fadeOut(el).then(() => { turn3d.dispose(); resolveDone(); });
  };
  requestAnimationFrame(tick);
  return { covered: Promise.resolve(), done };
}

// Play one turn inside `container` (position: relative/fixed). Never throws:
// any failure degrades to the next simpler mode, and a missing picture skips
// the effect entirely.
export async function playLensTurn({ container, fromSrc, toSrc, direction = 1, mode = transitionMode() }) {
  const none = { covered: Promise.resolve(), done: Promise.resolve(), mode: "none" };
  if (!container || !fromSrc || !toSrc) return none;
  const dir = direction < 0 ? -1 : 1;
  try {
    if (mode === "fade") return { ...(await playFade(container, fromSrc)), mode };
    if (mode === "webgl") {
      try {
        return { ...(await playWebgl(container, fromSrc, toSrc, dir)), mode };
      } catch (e) {
        console.warn("[wikido] 3D lens turn unavailable, using CSS:", e?.message || e);
        container.querySelectorAll(".wd-lens-turn").forEach((n) => n.remove());
      }
    }
    return { ...(await playCss(container, fromSrc, toSrc, dir)), mode: "css" };
  } catch {
    container.querySelectorAll(".wd-lens-turn").forEach((n) => n.remove());
    return none;
  }
}
