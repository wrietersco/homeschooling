// The three.js half of the Perspective Hall — a ring of curved hologram panels
// around the viewer, who stands at the centre of the ring. Loaded lazily (its
// own chunk), only the classes it needs. See hallLayout.js for the maths and
// components/wikido/WikidoPerspectiveHall.vue for the interface around it.
//
//   const hall = createHall3d({ container, items, index, reducedMotion, onFocus, onTap })
//   items: [{ id, title, emoji, color, sub, src }]   (any number — 5 or 500)
//   hall.focus(i)  glide the ring so panel i is in front
//   hall.dispose()
//
// Only the panels near the front exist as meshes (a small pool), and a panel's
// texture is painted the first time it comes into view and thrown away when it
// drifts far off, so memory stays flat however many perspectives there are.
import {
  WebGLRenderer, Scene, PerspectiveCamera, Mesh, MeshBasicMaterial, PlaneGeometry, CanvasTexture,
  SRGBColorSpace, LinearFilter, Fog, Points, BufferGeometry, Float32BufferAttribute, PointsMaterial,
  RingGeometry, Raycaster, Vector2, AdditiveBlending, DoubleSide,
} from "three";
import { VISIBLE, STEP_DEG, panelPose, ringOffset, wrapIndex } from "./hallLayout.js";

const RADIUS = 9;
const PANEL_W = 4.2;
const PANEL_H = 3.15;
const TEX_W = 640;
const TEX_H = 480;
const POOL = 2 * VISIBLE + 3;
const KEEP_TEXTURES = VISIBLE + 4; // textures further than this from the front are freed

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

// Paint one hologram panel: artwork (when it has loaded) under a glassy frame,
// corner brackets, scan lines, the perspective's name and a one-line teaser.
function paintPanel(canvas, item, image) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  const c = item.color || "#38bdf8";
  ctx.clearRect(0, 0, W, H);
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
    const s = Math.max((W - pad * 2) / image.width, (H - pad * 2) / image.height);
    const dw = image.width * s;
    const dh = image.height * s;
    ctx.globalAlpha = 0.92;
    ctx.drawImage(image, (W - dw) / 2, (H - dh) / 2, dw, dh);
    ctx.globalAlpha = 1;
  } else {
    ctx.font = "150px system-ui, 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.globalAlpha = 0.5;
    ctx.fillText(item.emoji || "🔭", W / 2, H / 2 - 30);
    ctx.globalAlpha = 1;
  }
  // blue holographic wash + a darker band behind the words
  const tint = ctx.createLinearGradient(0, 0, 0, H);
  tint.addColorStop(0, "rgba(56,189,248,.16)");
  tint.addColorStop(0.5, "rgba(10,18,48,0)");
  tint.addColorStop(1, "rgba(6,10,30,.88)");
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(125,211,252,.10)";
  ctx.lineWidth = 1;
  for (let y = pad; y < H; y += 6) { ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.stroke(); }
  ctx.restore();

  // name chip, top-left
  ctx.font = "700 30px system-ui, 'Segoe UI', sans-serif";
  const chip = `${item.emoji || ""}  ${item.title || ""}`.trim();
  const cw = Math.min(W - 70, ctx.measureText(chip).width + 44);
  ctx.fillStyle = "rgba(8,14,40,.78)";
  roundRect(ctx, 34, 34, cw, 54, 27);
  ctx.fill();
  ctx.strokeStyle = c;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#f0f9ff";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(chip, 56, 62, cw - 34);

  // big title + teaser, bottom
  ctx.textBaseline = "alphabetic";
  ctx.font = "800 46px system-ui, 'Segoe UI', sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = c;
  ctx.shadowBlur = 18;
  const titleLines = wrapText(ctx, item.title, W - 90, 1);
  ctx.fillText(titleLines[0] || "", 40, H - 86, W - 80);
  ctx.shadowBlur = 0;
  ctx.font = "500 25px system-ui, 'Segoe UI', sans-serif";
  ctx.fillStyle = "rgba(224,242,254,.92)";
  wrapText(ctx, item.sub, W - 90, 2).forEach((l, i) => ctx.fillText(l, 42, H - 48 + i * 30, W - 80));

  // glowing border + corner brackets
  ctx.shadowColor = c;
  ctx.shadowBlur = 22;
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

export function createHall3d({ container, items, index = 0, reducedMotion = false, onFocus = () => {}, onTap = () => {} }) {
  const width = () => container.clientWidth || 640;
  const height = () => container.clientHeight || 420;
  const renderer = new WebGLRenderer({ antialias: false, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(width(), height(), false);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.style.cssText = "width:100%;height:100%;display:block;touch-action:pan-y;cursor:grab;";
  container.appendChild(canvas);

  const scene = new Scene();
  scene.fog = new Fog(0x050a1f, 13, 26);
  const camera = new PerspectiveCamera(52, width() / height(), 0.1, 80);
  camera.position.set(0, 0, 0);
  // a tall phone screen gets a wider lens so the neighbouring panels still show
  function applyFov() {
    const aspect = width() / height();
    camera.aspect = aspect;
    camera.fov = aspect >= 1.2 ? 52 : Math.min(92, 52 + (1.2 - aspect) * 58);
    camera.updateProjectionMatrix();
  }
  applyFov();

  // ── the sky: slow stars + a faint floor ring, so the hall feels like a place ──
  const starPos = [];
  for (let i = 0; i < 420; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 18 + Math.random() * 10;
    starPos.push(Math.sin(a) * r, (Math.random() - 0.5) * 22, -Math.cos(a) * r);
  }
  const starGeo = new BufferGeometry();
  starGeo.setAttribute("position", new Float32BufferAttribute(starPos, 3));
  const starMat = new PointsMaterial({ color: 0x9bd8ff, size: 0.09, transparent: true, opacity: 0.8, fog: false, blending: AdditiveBlending, depthWrite: false });
  const stars = new Points(starGeo, starMat);
  scene.add(stars);
  const floorGeo = new RingGeometry(RADIUS - 0.5, RADIUS - 0.42, 96);
  floorGeo.rotateX(-Math.PI / 2);
  const floorMat = new MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.35, blending: AdditiveBlending, depthWrite: false });
  const floor = new Mesh(floorGeo, floorMat);
  floor.position.y = -2.4;
  scene.add(floor);
  const floor2 = new Mesh(new RingGeometry(RADIUS - 2.4, RADIUS - 2.34, 96).rotateX(-Math.PI / 2), floorMat);
  floor2.position.y = -2.4;
  scene.add(floor2);

  // ── panels: a small reusable pool of curved planes ──
  const geo = new PlaneGeometry(PANEL_W, PANEL_H, 22, 1);
  {
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const u = p.getX(i) / (PANEL_W / 2);
      p.setZ(i, 0.55 * u * u); // edges swing toward the viewer, like the panels in a cockpit
    }
    geo.computeVertexNormals();
  }
  const pool = [];
  for (let k = 0; k < POOL; k++) {
    const mat = new MeshBasicMaterial({ transparent: true, side: DoubleSide, depthWrite: false, fog: true, opacity: 0 });
    const mesh = new Mesh(geo, mat);
    mesh.visible = false;
    scene.add(mesh);
    pool.push({ mesh, mat, item: -1 });
  }

  // textures: painted when first needed, freed when far away
  const cache = new Map(); // item index -> { tex, canvas, image }
  let n = items.length;
  function textureFor(i) {
    let e = cache.get(i);
    if (e) return e;
    const cv = document.createElement("canvas");
    cv.width = TEX_W;
    cv.height = TEX_H;
    paintPanel(cv, items[i], null);
    const tex = new CanvasTexture(cv);
    tex.colorSpace = SRGBColorSpace;
    tex.minFilter = LinearFilter;
    tex.generateMipmaps = false;
    e = { tex, canvas: cv, image: null, dead: false };
    cache.set(i, e);
    const src = items[i].src;
    if (src) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        if (e.dead) return;
        e.image = img;
        paintPanel(cv, items[i], img);
        tex.needsUpdate = true;
        dirty = true;
      };
      img.src = src;
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
  let dirty = true;
  let t0 = performance.now();
  let raf = 0;
  let disposed = false;
  const lookX = { cur: 0, to: 0 };

  function nearest() { return wrapIndex(Math.round(pos), n); }
  function announce() {
    const f = nearest();
    if (f !== lastFocus) { lastFocus = f; onFocus(f); }
  }

  // ── pointer: drag to spin the ring, tap a panel ──
  const ray = new Raycaster();
  const ndc = new Vector2();
  let drag = null;
  function pxPerPanel() { return Math.max(110, width() * 0.2); }
  function down(e) {
    if (e.button !== undefined && e.button !== 0) return;
    drag = { id: e.pointerId, x: e.clientX, startX: e.clientX, startY: e.clientY, t: performance.now(), startPos: pos, moved: false, samples: [[performance.now(), e.clientX]] };
    try { canvas.setPointerCapture(e.pointerId); } catch { /* not capturable (synthetic event) */ }
    canvas.style.cursor = "grabbing";
  }
  function move(e) {
    const r = canvas.getBoundingClientRect();
    lookX.to = ((e.clientX - r.left) / r.width - 0.5) * 2;
    if (!drag || e.pointerId !== drag.id) { dirty = true; return; }
    const dx = e.clientX - drag.startX;
    if (Math.abs(dx) > 6 || Math.abs(e.clientY - drag.startY) > 10) drag.moved = true;
    if (drag.moved) {
      pos = drag.startPos - dx / pxPerPanel();
      target = pos;
      vel = 0;
      drag.samples.push([performance.now(), e.clientX]);
      if (drag.samples.length > 6) drag.samples.shift();
      announce();
      dirty = true;
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
    dirty = true;
    kick();
  }
  function tap(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(pool.filter((p) => p.mesh.visible && p.mat.opacity > 0.15).map((p) => p.mesh), false);
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
    const dir = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? Math.sign(e.deltaX) : Math.sign(e.deltaY);
    if (!dir) return;
    target = Math.round(target) + dir;
    kick();
  }
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("wheel", wheel, { passive: false });

  function applyPoses(time) {
    const fresh = [];
    const want = [];
    for (let i = 0; i < n; i++) {
      const d = ringOffset(i, pos, n);
      if (Math.abs(d) <= VISIBLE + 0.5) want.push({ i, d });
    }
    want.sort((a, b) => Math.abs(a.d) - Math.abs(b.d));
    const used = new Set();
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
      pool[slot].mat.map = textureFor(f[1].i).tex;
      pool[slot].mat.needsUpdate = true;
    }
    pool.forEach((p, s) => { if (!used.has(s)) { p.mesh.visible = false; p.item = -1; p.mesh.userData.item = -1; } });
    for (const [slot, w] of fresh) {
      const p = pool[slot];
      const pose = panelPose(w.d, { stepDeg: STEP_DEG, radius: RADIUS });
      const back = 1 + 0.045 * Math.min(Math.abs(w.d), 3); // neighbours sit a little further back
      const bob = reducedMotion ? 0 : Math.sin(time * 0.0011 + w.i * 1.7) * 0.07;
      p.mesh.visible = pose.opacity > 0.01;
      p.mesh.position.set(Math.sin(pose.angle) * RADIUS * back, bob + 0.1, -Math.cos(pose.angle) * RADIUS * back);
      p.mesh.rotation.y = -pose.angle;
      p.mesh.scale.setScalar(pose.scale);
      p.mat.opacity = pose.opacity * (0.72 + 0.28 * pose.focus);
    }
  }

  function frame(now) {
    raf = 0;
    if (disposed) return;
    const dt = Math.min(0.05, (now - t0) / 1000);
    t0 = now;
    let moving = false;
    if (!drag) {
      const diff = target - pos;
      if (reducedMotion) { pos = target; vel = 0; }
      else if (Math.abs(diff) > 0.0005 || Math.abs(vel) > 0.001) {
        // critically damped spring: quick, no overshoot wobble
        const k = 60;
        const c = 2 * Math.sqrt(k);
        vel += (diff * k - vel * c) * dt;
        pos += vel * dt;
        moving = true;
      } else { pos = target; vel = 0; }
      announce();
    } else moving = true;
    lookX.cur += (lookX.to - lookX.cur) * Math.min(1, dt * 4);
    camera.rotation.y = reducedMotion ? 0 : -lookX.cur * 0.05;
    stars.rotation.y += reducedMotion ? 0 : dt * 0.01;
    floor.rotation.y = floor2.rotation.y = reducedMotion ? 0 : now * 0.00006;
    applyPoses(now);
    freeFar(pos);
    renderer.render(scene, camera);
    dirty = false;
    // keep drawing while anything animates (the gentle bob counts, unless reduced)
    if (!disposed && (moving || !reducedMotion || dirty)) raf = requestAnimationFrame(frame);
  }
  function kick() { if (!raf && !disposed) { t0 = performance.now(); raf = requestAnimationFrame(frame); } }
  kick();

  const onVis = () => { if (!document.hidden) kick(); };
  document.addEventListener("visibilitychange", onVis);

  return {
    canvas,
    get index() { return nearest(); },
    focus(i) {
      const idx = wrapIndex(i, n);
      target = pos + ringOffset(idx, pos, n);
      kick();
    },
    step(dir) { target = Math.round(target) + dir; kick(); },
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
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("wheel", wheel);
      for (const e of cache.values()) { e.dead = true; e.tex.dispose(); }
      cache.clear();
      pool.forEach((p) => p.mat.dispose());
      geo.dispose(); starGeo.dispose(); starMat.dispose(); floorGeo.dispose(); floor2.geometry.dispose(); floorMat.dispose();
      renderer.dispose();
      renderer.forceContextLoss?.();
      canvas.remove();
    },
  };
}
