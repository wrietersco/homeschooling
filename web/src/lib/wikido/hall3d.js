// The three.js half of the Perspective Hall — a ring of curved hologram panels
// around the viewer, who stands at the centre of the ring. Loaded lazily (its
// own chunk), only the classes it needs. See hallLayout.js for the maths and
// components/wikido/WikidoPerspectiveHall.vue for the interface around it.
//
//   const hall = createHall3d({ container, items, index, reducedMotion, onFocus, onTap })
//   items: [{ id, title, emoji, color, sub, src }]   (any number — 5 or 500)
//   hall.focus(i)      glide the ring so panel i is in front
//   hall.setArmed(i)   pulse panel i (-1 = none)
//   hall.flyInto()     camera dives into the front panel; resolves when done
//   hall.dispose()
//
// Look: each panel is a cheap custom ShaderMaterial (scan-line shimmer, a light
// sweep, edge glow in the lens colour, a soft flicker on focus and a faint
// chromatic fringe at the rim) over a mip-mapped, anisotropic texture painted at
// high resolution for the panels near the front. Behind the ring: drifting light
// motes, soft light beams in the focused lens colour, a floor with a pulse ring.
// Panels fly into the ring on opening, float gently, tilt with the pointer and
// spring (no wobble) to the next one; the whole thing adapts its pixel ratio to
// keep 60 fps. Only the panels near the front exist as meshes (a small pool) and
// their textures are painted when first needed and freed when they drift away,
// so memory stays flat however many perspectives there are.
import {
  WebGLRenderer, Scene, PerspectiveCamera, Mesh, MeshBasicMaterial, PlaneGeometry, CanvasTexture,
  SRGBColorSpace, LinearMipmapLinearFilter, LinearFilter, Points, BufferGeometry, Float32BufferAttribute,
  RingGeometry, Raycaster, Vector2, AdditiveBlending, DoubleSide, ShaderMaterial, Color, PointsMaterial,
} from "three";
import { VISIBLE, STEP_DEG, panelPose, ringOffset, wrapIndex, corsImageUrl } from "./hallLayout.js";

const RADIUS = 9;
const PANEL_W = 4.2;
const PANEL_H = 3.15;
const LOGICAL_W = 640; // panels are painted in a 640×480 design space...
const LOGICAL_H = 480;
const TIER_HI = 1.6; // ...and rasterised at 1.6× (1024×768) near the front
const TIER_LO = 0.8; // or 0.8× (512×384) further out
const POOL = 2 * VISIBLE + 3;
const KEEP_TEXTURES = VISIBLE + 1; // textures further than this from the front are freed

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const easeOutCubic = (x) => 1 - (1 - x) ** 3;
const easeInCubic = (x) => x * x * x;

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(ctx, text, maxWidth, maxLines) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width > maxWidth && line) {
      lines.push(line);
      line = w;
      if (lines.length === maxLines) break;
    } else line = t;
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines;
}

// Paint one hologram panel into a canvas of any size (design space 640×480):
// artwork (when it has loaded) under a glassy frame, corner brackets, the
// perspective's name and a one-line teaser. Animated glow is added by the shader.
function paintPanel(canvas, item, image) {
  const ctx = canvas.getContext("2d");
  const k = canvas.width / LOGICAL_W;
  const W = LOGICAL_W;
  const H = LOGICAL_H;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.clearRect(0, 0, W, H);
  const c = item.color || "#38bdf8";
  const pad = 14;
  ctx.save();
  roundRect(ctx, pad, pad, W - pad * 2, H - pad * 2, 26);
  ctx.clip();
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, "#0b1230");
  g.addColorStop(1, "#13204a");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  if (image && image.width) {
    // cover-fit, never stretched
    const s = Math.max((W - pad * 2) / image.width, (H - pad * 2) / image.height);
    const dw = image.width * s;
    const dh = image.height * s;
    ctx.drawImage(image, (W - dw) / 2, (H - dh) / 2, dw, dh);
  } else {
    ctx.font = "150px system-ui, 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.globalAlpha = 0.5;
    ctx.fillText(item.emoji || "🔭", W / 2, H / 2 - 30);
    ctx.globalAlpha = 1;
  }
  // a darker band behind the words, a faint blue wash on top
  const tint = ctx.createLinearGradient(0, 0, 0, H);
  tint.addColorStop(0, "rgba(56,189,248,.14)");
  tint.addColorStop(0.45, "rgba(10,18,48,0)");
  tint.addColorStop(1, "rgba(6,10,30,.9)");
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  // name chip, top-left
  ctx.font = "700 28px system-ui, 'Segoe UI', sans-serif";
  const chip = `${item.emoji || ""}  ${item.title || ""}`.trim();
  const cw = Math.min(W - 70, ctx.measureText(chip).width + 44);
  ctx.fillStyle = "rgba(8,14,40,.8)";
  roundRect(ctx, 34, 34, cw, 52, 26);
  ctx.fill();
  ctx.strokeStyle = c;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#f0f9ff";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(chip, 56, 61, cw - 34);

  // big title + teaser, bottom
  ctx.textBaseline = "alphabetic";
  ctx.font = "800 50px system-ui, 'Segoe UI', sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = c;
  ctx.shadowBlur = 16;
  const titleLines = wrapText(ctx, item.title, W - 90, 1);
  ctx.fillText(titleLines[0] || "", 40, H - 90, W - 80);
  ctx.shadowBlur = 0;
  ctx.font = "500 24px system-ui, 'Segoe UI', sans-serif";
  ctx.fillStyle = "rgba(224,242,254,.94)";
  wrapText(ctx, item.sub, W - 90, 2).forEach((l, i) => ctx.fillText(l, 42, H - 52 + i * 29, W - 80));

  // glowing border + corner brackets
  ctx.shadowColor = c;
  ctx.shadowBlur = 20;
  ctx.strokeStyle = c;
  ctx.lineWidth = 4;
  roundRect(ctx, pad, pad, W - pad * 2, H - pad * 2, 26);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "#e0f2fe";
  ctx.lineWidth = 5;
  const L = 34;
  const m = pad + 8;
  for (const [x, y, sx, sy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]]) {
    ctx.beginPath();
    ctx.moveTo(x, y + sy * L);
    ctx.lineTo(x, y);
    ctx.lineTo(x + sx * L, y);
    ctx.stroke();
  }
}

// ── shaders ──────────────────────────────────────────────────────────────────
const PANEL_VERT = /* glsl */ `
  varying vec2 vUv;
  varying float vDepth;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;

const PANEL_FRAG = /* glsl */ `
  uniform sampler2D map;
  uniform vec3 uColor;
  uniform float uTime, uFocus, uAlpha, uArmed, uSeed;
  varying vec2 vUv;
  varying float vDepth;
  void main() {
    vec2 c = vUv - 0.5;
    float edge = max(abs(c.x), abs(c.y)) * 2.0;           // 0 centre … 1 rim
    float ca = 0.0004 + 0.0014 * edge * edge * edge;       // faint chromatic fringe, only at the rim
    vec4 s = texture2D(map, vUv, -0.6);                    // mip bias: crisper text when minified
    vec3 col = vec3(texture2D(map, vUv + vec2(ca, 0.0), -0.6).r, s.g, texture2D(map, vUv - vec2(ca, 0.0), -0.6).b);
    float pulse = 0.5 + 0.5 * sin(uTime * 6.0);
    // scan lines that shimmer, a soft light band sweeping down the panel
    col *= 1.0 - 0.05 * (0.5 + 0.5 * sin(vUv.y * 380.0 - uTime * 3.0));
    float y = fract(uTime * 0.2 + uSeed);
    col += uColor * exp(-pow((vUv.y - y) * 18.0, 2.0)) * (0.05 + 0.12 * uFocus + 0.22 * uArmed);
    // edge glow in the lens colour, stronger when focused / armed
    col += uColor * smoothstep(0.78, 1.0, edge) * (0.30 + 0.55 * uFocus + 0.7 * uArmed * pulse);
    // a quick flicker when the panel lands in front
    float tick = step(0.965, fract(sin(floor(uTime * 9.0) * 12.9898 + uSeed) * 43758.5453));
    col *= 1.0 + 0.07 * uFocus * tick;
    col *= 0.64 + 0.36 * uFocus + 0.10 * uArmed * pulse;
    // distance haze
    col = mix(col, vec3(0.004, 0.012, 0.05), clamp((vDepth - 11.0) / 14.0, 0.0, 1.0) * 0.8);
    gl_FragColor = vec4(col, s.a * uAlpha);
    #include <colorspace_fragment>
  }`;

const BEAM_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const BEAM_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime, uPhase, uIntensity;
  varying vec2 vUv;
  void main() {
    float x = 1.0 - abs(vUv.x * 2.0 - 1.0);
    float a = pow(x, 2.4) * smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.45, vUv.y);
    a *= uIntensity * (0.65 + 0.35 * sin(uTime * 0.6 + uPhase));
    gl_FragColor = vec4(uColor * a, a);
    #include <colorspace_fragment>
  }`;

const MOTE_VERT = /* glsl */ `
  attribute vec3 aSeed;                // x: speed, y: size, z: phase
  uniform float uTime, uPx;
  varying float vTw;
  void main() {
    vec3 p = position;
    p.y = mod(p.y + 7.0 + uTime * aSeed.x, 15.0) - 7.0;
    p.x += sin(uTime * 0.3 + aSeed.z) * 0.4;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vTw = 0.55 + 0.45 * sin(uTime * 1.3 + aSeed.z * 6.0);
    gl_PointSize = aSeed.y * uPx * (22.0 / max(1.0, -mv.z));
    gl_Position = projectionMatrix * mv;
  }`;
const MOTE_FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vTw;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = pow(clamp(1.0 - d, 0.0, 1.0), 2.0) * vTw;
    gl_FragColor = vec4(uColor * a, a);
    #include <colorspace_fragment>
  }`;

export function createHall3d({ container, items, index = 0, reducedMotion = false, onFocus = () => {}, onTap = () => {} }) {
  const width = () => container.clientWidth || 640;
  const height = () => container.clientHeight || 420;

  // ── renderer: antialiased, pixel ratio adapts to the device and to its speed ──
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  const devicePR = window.devicePixelRatio || 1;
  let pixelRatio = Math.min(devicePR, 2);
  if (width() * height() * pixelRatio * pixelRatio > 4.2e6) pixelRatio = Math.max(1.25, Math.sqrt(4.2e6 / (width() * height())));
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(width(), height(), false);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy?.() || 1);
  const canvas = renderer.domElement;
  canvas.style.cssText = "width:100%;height:100%;display:block;touch-action:pan-y;cursor:grab;";
  container.appendChild(canvas);

  const scene = new Scene();
  const camera = new PerspectiveCamera(52, width() / height(), 0.1, 80);
  camera.position.set(0, 0, 0);
  let baseFov = 52;
  // a tall phone screen gets a wider lens so the neighbouring panels still show
  function applyFov() {
    const aspect = width() / height();
    camera.aspect = aspect;
    baseFov = aspect >= 1.2 ? 52 : Math.min(92, 52 + (1.2 - aspect) * 58);
    camera.fov = baseFov;
    camera.updateProjectionMatrix();
  }
  applyFov();

  const tint = new Color(items[index]?.color || "#38bdf8"); // follows the focused lens colour
  const tintTo = new Color(tint);
  const disposables = [];

  // ── the sky: stars, light beams, drifting motes, a floor with a pulse ring ──
  const starPos = [];
  for (let i = 0; i < 420; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 20 + Math.random() * 10;
    starPos.push(Math.sin(a) * r, (Math.random() - 0.5) * 22, -Math.cos(a) * r);
  }
  const starGeo = new BufferGeometry();
  starGeo.setAttribute("position", new Float32BufferAttribute(starPos, 3));
  const starMat = new PointsMaterial({ color: 0x9bd8ff, size: 0.09, transparent: true, opacity: 0.8, blending: AdditiveBlending, depthWrite: false });
  const stars = new Points(starGeo, starMat);
  scene.add(stars);
  disposables.push(starGeo, starMat);

  const beamGeo = new PlaneGeometry(2.6, 15);
  const beams = [];
  for (let b = 0; b < 9; b++) {
    const angle = ((b - 4) / 4) * 1.35;
    const mat = new ShaderMaterial({
      uniforms: { uColor: { value: tint }, uTime: { value: 0 }, uPhase: { value: b * 1.9 }, uIntensity: { value: 0.16 + (b % 3) * 0.05 } },
      vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG, transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide,
    });
    const m = new Mesh(beamGeo, mat);
    const R = 21 + (b % 2) * 2;
    m.position.set(Math.sin(angle) * R, 1, -Math.cos(angle) * R);
    m.rotation.y = -angle;
    m.rotation.z = (b % 2 ? 1 : -1) * 0.05;
    scene.add(m);
    beams.push(m);
    disposables.push(mat);
  }
  disposables.push(beamGeo);

  const MOTES = 170;
  const motePos = [];
  const moteSeed = [];
  for (let i = 0; i < MOTES; i++) {
    const a = (Math.random() - 0.5) * Math.PI * 2.1;
    const r = 5 + Math.random() * 16;
    motePos.push(Math.sin(a) * r, Math.random() * 15 - 7, -Math.cos(a) * r);
    moteSeed.push(0.12 + Math.random() * 0.3, 0.8 + Math.random() * 1.8, Math.random() * 6.28);
  }
  const moteGeo = new BufferGeometry();
  moteGeo.setAttribute("position", new Float32BufferAttribute(motePos, 3));
  moteGeo.setAttribute("aSeed", new Float32BufferAttribute(moteSeed, 3));
  const moteMat = new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPx: { value: pixelRatio }, uColor: { value: tint } },
    vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG, transparent: true, depthWrite: false, blending: AdditiveBlending,
  });
  const motes = new Points(moteGeo, moteMat);
  motes.frustumCulled = false;
  scene.add(motes);
  disposables.push(moteGeo, moteMat);

  const ringMat = new MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.34, blending: AdditiveBlending, depthWrite: false });
  const floorGeos = [new RingGeometry(RADIUS - 0.5, RADIUS - 0.42, 120), new RingGeometry(RADIUS - 2.4, RADIUS - 2.34, 120), new RingGeometry(RADIUS + 2, RADIUS + 2.05, 120)];
  const floors = floorGeos.map((g) => {
    g.rotateX(-Math.PI / 2);
    const m = new Mesh(g, ringMat);
    m.position.y = -2.4;
    scene.add(m);
    disposables.push(g);
    return m;
  });
  disposables.push(ringMat);
  const pulseGeo = new RingGeometry(0.96, 1, 96).rotateX(-Math.PI / 2);
  const pulseMat = new MeshBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false });
  const pulseRing = new Mesh(pulseGeo, pulseMat);
  pulseRing.position.y = -2.38;
  scene.add(pulseRing);
  disposables.push(pulseGeo, pulseMat);
  let pulseT = 1;

  // ── panels: a small reusable pool of curved planes with the hologram shader ──
  const geo = new PlaneGeometry(PANEL_W, PANEL_H, 28, 1);
  {
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const u = p.getX(i) / (PANEL_W / 2);
      p.setZ(i, 0.55 * u * u); // edges swing toward the viewer, like the panels in a cockpit
    }
    geo.computeVertexNormals();
  }
  disposables.push(geo);
  const blank = new CanvasTexture(document.createElement("canvas"));
  disposables.push(blank);
  const pool = [];
  for (let k = 0; k < POOL; k++) {
    const mat = new ShaderMaterial({
      uniforms: {
        map: { value: blank }, uColor: { value: new Color("#38bdf8") }, uTime: { value: 0 },
        uFocus: { value: 0 }, uAlpha: { value: 0 }, uArmed: { value: 0 }, uSeed: { value: Math.random() },
      },
      vertexShader: PANEL_VERT, fragmentShader: PANEL_FRAG, transparent: true, side: DoubleSide, depthWrite: false,
    });
    const mesh = new Mesh(geo, mat);
    mesh.visible = false;
    scene.add(mesh);
    pool.push({ mesh, mat, item: -1, alpha: 0 });
    disposables.push(mat);
  }

  // ── textures: painted when first needed (hi-res near the front), freed when far ──
  const cache = new Map(); // item index -> { tex, canvas, image, tier, dead }
  let n = items.length;
  let dirty = true;
  function makeTexture(e, tier) {
    if (e.tex) e.tex.dispose();
    const cv = document.createElement("canvas");
    cv.width = Math.round(LOGICAL_W * tier);
    cv.height = Math.round(LOGICAL_H * tier);
    e.canvas = cv;
    e.tier = tier;
    paintPanel(cv, e.item, e.image);
    const tex = new CanvasTexture(cv);
    tex.colorSpace = SRGBColorSpace;
    tex.generateMipmaps = true;
    tex.minFilter = LinearMipmapLinearFilter;
    tex.magFilter = LinearFilter;
    tex.anisotropy = maxAniso;
    e.tex = tex;
  }
  function loadImage(e, src, retry) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => {
      if (e.dead) return;
      e.image = img;
      paintPanel(e.canvas, e.item, img);
      e.tex.needsUpdate = true;
      dirty = true;
    };
    img.onerror = () => { if (!e.dead && retry) loadImage(e, `${src}${src.includes("?") ? "&" : "?"}_r=${Date.now()}`, false); };
    img.src = src;
  }
  function textureFor(i, d) {
    let e = cache.get(i);
    const near = Math.abs(d) <= 2.5;
    const far = Math.abs(d) >= 3.5;
    if (!e) {
      e = { item: items[i], tex: null, canvas: null, image: null, tier: 0, dead: false };
      makeTexture(e, near ? TIER_HI : TIER_LO);
      cache.set(i, e);
      if (items[i].src) loadImage(e, corsImageUrl(items[i].src), true);
    } else if ((near && e.tier !== TIER_HI) || (far && e.tier !== TIER_LO)) {
      makeTexture(e, near ? TIER_HI : TIER_LO);
    }
    return e;
  }
  function freeFar(pos) {
    for (const [i, e] of cache) {
      if (Math.abs(ringOffset(i, pos, n)) > KEEP_TEXTURES) {
        e.dead = true;
        e.tex.dispose();
        cache.delete(i);
      }
    }
  }

  // ── motion: `pos` is a (fractional) panel position that springs to `target` ──
  let pos = wrapIndex(index, n);
  let target = pos;
  let vel = 0;
  let lastFocus = wrapIndex(Math.round(pos), n);
  let t0 = performance.now();
  let raf = 0;
  let disposed = false;
  let intro = reducedMotion ? 1 : 0; // panels fly into the ring
  let fly = 0; // camera dive into the front panel: 0 → 1
  let flying = false;
  let flyDone = null;
  let armedIdx = -1;
  let armedAmt = 0;
  const look = { x: 0, y: 0, tx: 0, ty: 0 };
  let slow = 0; // frames over budget, for the adaptive pixel ratio
  let fast = 0;

  function nearest() { return wrapIndex(Math.round(pos), n); }
  function announce() {
    const f = nearest();
    if (f !== lastFocus) {
      lastFocus = f;
      tintTo.set(items[f]?.color || "#38bdf8");
      pulseT = 0;
      onFocus(f);
    }
  }

  // ── pointer: drag to spin the ring, tap a panel; the pointer (or tilt) adds parallax ──
  const ray = new Raycaster();
  const ndc = new Vector2();
  let drag = null;
  function pxPerPanel() { return Math.max(110, width() * 0.2); }
  function down(e) {
    if (flying || (e.button !== undefined && e.button !== 0)) return;
    drag = { id: e.pointerId, x: e.clientX, startX: e.clientX, startY: e.clientY, t: performance.now(), startPos: pos, moved: false, samples: [[performance.now(), e.clientX]] };
    try { canvas.setPointerCapture(e.pointerId); } catch { /* not capturable (synthetic event) */ }
    canvas.style.cursor = "grabbing";
  }
  function move(e) {
    const r = canvas.getBoundingClientRect();
    look.tx = ((e.clientX - r.left) / r.width - 0.5) * 2;
    look.ty = ((e.clientY - r.top) / r.height - 0.5) * 2;
    if (!drag || e.pointerId !== drag.id) { kick(); return; }
    const dx = e.clientX - drag.startX;
    if (Math.abs(dx) > 6 || Math.abs(e.clientY - drag.startY) > 10) drag.moved = true;
    if (drag.moved) {
      pos = drag.startPos - dx / pxPerPanel();
      target = pos;
      vel = (-(e.clientX - drag.samples[drag.samples.length - 1][1]) / pxPerPanel()) * 30;
      drag.samples.push([performance.now(), e.clientX]);
      if (drag.samples.length > 6) drag.samples.shift();
      announce();
      kick();
    }
  }
  function up(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    canvas.style.cursor = "grab";
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (!d.moved && performance.now() - d.t < 450) { tap(e); return; }
    const a = d.samples[0];
    const b = d.samples[d.samples.length - 1];
    const dt = Math.max(16, b[0] - a[0]);
    const velocity = (-(b[1] - a[1]) / pxPerPanel()) / (dt / 1000); // panels per second
    // settle on a whole panel (a flick carries a couple further), staying on the same lap as pos
    target = Math.round(pos) + Math.max(-3, Math.min(3, Math.round(velocity * 0.18)));
    kick();
  }
  function tap(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(pool.filter((p) => p.mesh.visible && p.alpha > 0.15).map((p) => p.mesh), false);
    if (!hits.length) return;
    const idx = hits[0].object.userData.item;
    if (idx === undefined || idx < 0) return;
    if (idx === nearest() && Math.abs(pos - Math.round(pos)) < 0.2) { onTap(idx, true); return; }
    // bring a side panel round to the front (shortest way)
    target = pos + ringOffset(idx, pos, n);
    onTap(idx, false);
    kick();
  }
  function wheel(e) {
    e.preventDefault();
    if (flying) return;
    const dir = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? Math.sign(e.deltaX) : Math.sign(e.deltaY);
    if (!dir) return;
    target = Math.round(target) + dir;
    kick();
  }
  function tilt(e) { // phones/tablets: tilt the device to look around a little
    if (e.gamma == null || drag) return;
    look.tx = Math.max(-1, Math.min(1, e.gamma / 25));
    look.ty = Math.max(-1, Math.min(1, ((e.beta ?? 45) - 45) / 30));
    kick();
  }
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("wheel", wheel, { passive: false });
  if (!reducedMotion) window.addEventListener("deviceorientation", tilt);

  const fresh = [];
  const want = [];
  const used = new Set();
  function applyPoses(time) {
    fresh.length = 0;
    want.length = 0;
    used.clear();
    for (let i = 0; i < n; i++) {
      const d = ringOffset(i, pos, n);
      if (Math.abs(d) <= VISIBLE + 0.5) want.push({ i, d });
    }
    want.sort((a, b) => Math.abs(a.d) - Math.abs(b.d));
    // keep the pool slot a panel already has, give new panels free slots
    for (const w of want.slice(0, POOL)) {
      const slot = pool.findIndex((p, s) => p.item === w.i && !used.has(s));
      if (slot >= 0) { used.add(slot); fresh.push([slot, w]); } else fresh.push([-1, w]);
    }
    for (const f of fresh) {
      if (f[0] >= 0) continue;
      const slot = pool.findIndex((p, s) => !used.has(s));
      if (slot < 0) continue;
      used.add(slot);
      f[0] = slot;
      pool[slot].item = f[1].i;
      pool[slot].mesh.userData.item = f[1].i;
      pool[slot].mat.uniforms.uColor.value.set(items[f[1].i].color || "#38bdf8");
    }
    pool.forEach((p) => { if (!used.has(pool.indexOf(p))) { p.mesh.visible = false; p.item = -1; p.mesh.userData.item = -1; p.alpha = 0; } });
    const sec = time / 1000;
    const flyE = easeInCubic(fly);
    for (const [slot, w] of fresh) {
      const p = pool[slot];
      const u = p.mat.uniforms;
      const tex = textureFor(w.i, w.d).tex;
      if (u.map.value !== tex) u.map.value = tex;
      const pose = panelPose(w.d, { stepDeg: STEP_DEG, radius: RADIUS });
      const a = Math.abs(w.d);
      // entrance: panels fly in from a wider, lower, tilted ring, nearest first
      const e = reducedMotion ? 1 : easeOutCubic(clamp01(intro * 2.2 - a * 0.16));
      const back = (1 + 0.045 * Math.min(a, 3)) * (1 + (1 - e) * 0.45) - 0.04 * pose.focus;
      const angle = pose.angle * (1 + (1 - e) * 0.4);
      const bob = reducedMotion ? 0 : Math.sin(sec * 1.1 + w.i * 1.7) * 0.07 + Math.sin(sec * 0.7 + w.i) * 0.03;
      const sway = reducedMotion ? 0 : Math.sin(sec * 0.8 + w.i * 2.3) * 0.012;
      p.mesh.position.set(Math.sin(angle) * RADIUS * back, bob + 0.1 + 0.1 * pose.focus - (1 - e) * 1.8, -Math.cos(angle) * RADIUS * back);
      p.mesh.rotation.set((1 - e) * 0.5, -angle + (1 - e) * 0.6 * Math.sign(w.d || 1), sway - Math.max(-0.07, Math.min(0.07, vel * 0.012)), "YXZ");
      p.mesh.scale.setScalar(pose.scale * (0.6 + 0.4 * e));
      const out = pose.focus > 0.5 ? 1 : 1 - flyE; // the others melt away during the dive
      p.alpha = pose.opacity * e * out;
      p.mesh.visible = p.alpha > 0.01;
      u.uAlpha.value = p.alpha;
      u.uFocus.value = pose.focus;
      u.uArmed.value = w.i === armedIdx ? armedAmt : 0;
      u.uTime.value = sec;
    }
  }

  function frame(now) {
    raf = 0;
    if (disposed) return;
    const rawDt = (now - t0) / 1000;
    const dt = Math.min(0.05, rawDt);
    t0 = now;
    let moving = false;
    if (!drag) {
      const diff = target - pos;
      if (reducedMotion) { pos = target; vel = 0; }
      else if (Math.abs(diff) > 0.0005 || Math.abs(vel) > 0.001) {
        // critically damped spring: quick, no overshoot wobble
        const k = 70;
        const c = 2 * Math.sqrt(k);
        vel += (diff * k - vel * c) * dt;
        pos += vel * dt;
        moving = true;
      } else { pos = target; vel = 0; }
      announce();
    } else moving = true;

    if (intro < 1) { intro = Math.min(1, intro + dt / 1.5); moving = true; }
    if (flying) {
      fly = Math.min(1, fly + dt / 0.8);
      moving = true;
      if (fly >= 1) { flying = false; flyDone?.(); flyDone = null; }
    }
    armedAmt += ((armedIdx >= 0 ? 1 : 0) - armedAmt) * Math.min(1, dt * 7);
    if (pulseT < 1) { pulseT = Math.min(1, pulseT + dt / 1.1); moving = true; }

    // pointer / tilt parallax, and a slow lens-colour crossfade for the light
    const ease = Math.min(1, dt * 4);
    look.x += (look.tx - look.x) * ease;
    look.y += (look.ty - look.y) * ease;
    const sec = now / 1000;
    if (!reducedMotion) {
      camera.position.set(look.x * 0.32, -look.y * 0.14, -RADIUS * 0.8 * easeInCubic(fly));
      camera.rotation.set(-look.y * 0.02, -look.x * 0.045, 0);
      camera.fov = baseFov - 14 * easeInCubic(fly);
      camera.updateProjectionMatrix();
    }
    tint.lerp(tintTo, Math.min(1, dt * 3));
    ringMat.color.copy(tint);
    pulseMat.color.copy(tint);
    pulseMat.opacity = 0.5 * (1 - pulseT) * (1 - pulseT);
    pulseRing.scale.setScalar(2 + pulseT * 7);
    moteMat.uniforms.uTime.value = sec;
    for (const b of beams) b.material.uniforms.uTime.value = sec;
    if (!reducedMotion) {
      stars.rotation.y += dt * 0.012;
      floors[0].rotation.y = sec * 0.06;
      floors[2].rotation.y = -sec * 0.04;
    }
    applyPoses(now);
    freeFar(pos);
    renderer.render(scene, camera);
    dirty = false;

    // adaptive quality: sustained slow frames → lower the pixel ratio a notch
    if (!reducedMotion && rawDt > 0 && rawDt < 0.5) {
      if (rawDt > 0.028) { slow++; fast = 0; } else { fast++; slow = Math.max(0, slow - 1); }
      if (slow > 25 && pixelRatio > 1) {
        pixelRatio = Math.max(1, pixelRatio - 0.25);
        renderer.setPixelRatio(pixelRatio);
        renderer.setSize(width(), height(), false);
        moteMat.uniforms.uPx.value = pixelRatio;
        slow = 0;
      }
    }
    // keep drawing while anything animates (the gentle float counts, unless reduced)
    if (!disposed && (moving || !reducedMotion || dirty)) raf = requestAnimationFrame(frame);
  }
  function kick() { if (!raf && !disposed) { t0 = performance.now(); raf = requestAnimationFrame(frame); } }
  kick();

  const onVis = () => { if (!document.hidden) kick(); };
  document.addEventListener("visibilitychange", onVis);

  return {
    canvas,
    get index() { return nearest(); },
    get pixelRatio() { return pixelRatio; },
    focus(i) {
      const idx = wrapIndex(i, n);
      target = pos + ringOffset(idx, pos, n);
      kick();
    },
    step(dir) { target = Math.round(target) + dir; kick(); },
    setArmed(i) { armedIdx = i; kick(); },
    // dive the camera into the front panel; resolves when the dive has finished
    flyInto() {
      if (reducedMotion || disposed) return Promise.resolve();
      flying = true;
      kick();
      return new Promise((resolve) => { flyDone = resolve; setTimeout(resolve, 1200); });
    },
    resize() {
      renderer.setSize(width(), height(), false);
      applyFov();
      kick();
    },
    setItems(next) {
      items = next;
      n = items.length;
      for (const e of cache.values()) { e.dead = true; e.tex.dispose(); }
      cache.clear();
      pool.forEach((p) => { p.item = -1; });
      pos = target = wrapIndex(Math.round(pos), n);
      kick();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("deviceorientation", tilt);
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("wheel", wheel);
      for (const e of cache.values()) { e.dead = true; e.tex.dispose(); }
      cache.clear();
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      renderer.forceContextLoss?.();
      flyDone?.();
      canvas.remove();
    },
  };
}
