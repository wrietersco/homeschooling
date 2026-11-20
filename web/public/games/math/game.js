/* ============================================================
   Math Games · Division — a playful ruler-cutting game
   Vanilla JS + SVG. No frameworks, no build step.
   ============================================================ */
'use strict';

/* ---------- tiny helpers ---------- */
const $ = s => document.querySelector(s);
const SVGNS = 'http://www.w3.org/2000/svg';
function el(tag, attrs, parent) {
  const n = document.createElementNS(SVGNS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------- easing ---------- */
const easeOutCubic   = t => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = t => t < .5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2;
const easeOutBack    = t => { const c = 1.70158; return 1 + (c+1)*Math.pow(t-1,3) + c*Math.pow(t-1,2); };
const easeOutBounce  = t => { const n1=7.5625, d1=2.75;
  if (t < 1/d1) return n1*t*t;
  if (t < 2/d1) return n1*(t -= 1.5/d1)*t + .75;
  if (t < 2.5/d1) return n1*(t -= 2.25/d1)*t + .9375;
  return n1*(t -= 2.625/d1)*t + .984375; };

function tween(dur, step, end, ease = easeOutCubic) {
  const t0 = performance.now(); let stop = false, raf;
  (function fr(now) {
    if (stop) return;
    const t = clamp((now - t0) / dur, 0, 1);
    step(ease(t), t);
    if (t < 1) raf = requestAnimationFrame(fr); else { stop = true; end && end(); }
  })(t0);
  return () => { stop = true; cancelAnimationFrame(raf); };
}

/* ---------- colors ---------- */
const COLORS = ['#6FD6A8','#6FB9F2','#FF8FA3','#B492F5','#FFAB6B','#8EDB6C','#F2C14E','#7FD8D8'];
const MAIN_COLOR = '#FFC94D', GRAY = '#C7CCD4';
function shade(hex, f) { // f in -1..1
  const n = parseInt(hex.slice(1), 16);
  const m = c => Math.round(f < 0 ? c*(1+f) : c + (255-c)*f);
  return '#' + [m(n>>16), m((n>>8)&255), m(n&255)].map(c => c.toString(16).padStart(2,'0')).join('');
}
function ensureGrad(color) {
  const id = 'g' + color.slice(1);
  if ($('#' + id)) return id;
  const lg = el('linearGradient', { id, x1:0, y1:0, x2:0, y2:1 }, defs);
  el('stop', { offset:'0%',  'stop-color': shade(color, .30) }, lg);
  el('stop', { offset:'100%','stop-color': shade(color, -.08) }, lg);
  return id;
}

/* ---------- audio (tiny synth, no files needed) ---------- */
let AC = null, muted = false;
function ensureAC() {
  if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
  AC && AC.state === 'suspended' && AC.resume();
}
document.addEventListener('pointerdown', ensureAC, { once: true });
function tone(f0, f1, dur, type = 'sine', vol = .2, delay = 0) {
  if (!AC || muted) return;
  const t = AC.currentTime + delay;
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(.0001, t + dur);
  o.connect(g).connect(AC.destination);
  o.start(t); o.stop(t + dur + .02);
}
const blip  = () => tone(660, 660, .07, 'triangle', .12);
const popS  = () => tone(300, 820, .16, 'sine', .22);
const sad   = () => tone(280, 160, .30, 'sawtooth', .07);
const snip  = () => { tone(1500, 900, .06, 'square', .10); tone(1500, 900, .06, 'square', .10, .09); };
const chime = () => [523, 659, 784, 1047].forEach((f, i) => tone(f, f, .32, 'sine', .14, i * .08));

/* ---------- constants & state ---------- */
const CM = 6;        // pixels per cm
const RH = 64;       // ruler height
const VGAP = 96;     // vertical gap between a scale and its pieces row
const SNAP_Y = (RH + VGAP) / 2;  // vertical magnet lattice for dragged pieces
const isMobile = () => matchMedia('(max-width:700px)').matches;

const defs = $('#defs');
const world = $('#world');
const svg = $('#canvas');

// dotted "graph paper" that pans/zooms with the world → the canvas feels unlimited
const dots = el('pattern', { id:'dots', width:34, height:34, patternUnits:'userSpaceOnUse' }, defs);
el('circle', { cx:2, cy:2, r:1.7, fill:'#CBE4F0' }, dots);

let scales = [], byId = new Map(), selId = null, preview = null, colorIdx = 0, nextId = 1;
let view = { tx: innerWidth / 2, ty: innerHeight * .38, k: 1 };
function applyView() { world.setAttribute('transform', `translate(${view.tx} ${view.ty}) scale(${view.k})`); }
applyView();

const sel = () => byId.get(selId);

/* ---------- ruler rendering ---------- */
function makeScale(len, color, opts = {}) {
  const s = { id: nextId++, len, color, rows: [], parentId: null, x: 0, y: 0, dy: 0, pop: 1,
              remainder: !!opts.remainder, off: { dx: 0, dy: 0 }, ax: 0, ay: 0, drag: false };
  s.g = el('g', { class: 'scale' + (s.remainder ? ' remainder' : '') }, $('#scalesLayer'));
  s.g.dataset.id = s.id;
  byId.set(s.id, s); scales.push(s);
  render(s);
  return s;
}

function render(s) {
  s.g.innerHTML = '';
  const w = s.len * CM;
  s.ring = el('rect', { class:'ring', x:-8, y:-8, width:w+16, height:RH+16, rx:17, stroke: shade(s.color,-.35) }, s.g);
  el('rect', { class:'body', x:0, y:0, width:w, height:RH, rx:12,
               fill:`url(#${ensureGrad(s.color)})`, stroke: shade(s.color,-.38), 'stroke-width':2 }, s.g);
  if (w >= 120) el('circle', { cx:16, cy:RH/2, r:6, fill:'#FFF9EC', stroke: shade(s.color,-.28), 'stroke-width':2.5 }, s.g);
  const step = s.len <= 130 ? 1 : (s.len <= 320 ? 5 : 10);
  for (let i = 0; i <= s.len; i += step) {
    const x = i * CM, major = i % 10 === 0, mid = i % 5 === 0 && !major;
    el('line', { class:'tick', x1:x, y1:2, x2:x, y2: major ? 22 : mid ? 15 : 9,
                 'stroke-width': major ? 2.6 : mid ? 1.9 : 1.3 }, s.g);
    if (major) {
      // skip the last major label when the odd end label (like 33) sits too close
      const tooCloseToEnd = s.len % 10 !== 0 && s.len - i < 5 && i !== s.len;
      if (!tooCloseToEnd) el('text', { class:'ticknum', x: clamp(x, 9, w - 9), y:42 }, s.g).textContent = i;
    }
  }
  if (s.len % 10 !== 0) { // label an odd end like 33
    el('line', { class:'tick', x1:w, y1:2, x2:w, y2:22, 'stroke-width':2.6 }, s.g);
    el('text', { class:'ticknum', x: clamp(w, 9, w - 9), y:42 }, s.g).textContent = s.len;
  }
  el('text', { class:'lenlabel', x:w/2, y:-12, fill: shade(s.color,-.45) }, s.g)
    .textContent = s.remainder ? `${s.len} cm left over` : `${s.len} cm`;
  place(s);
}

function place(s) {
  const w = s.len * CM, cx = w/2, cy = RH/2;
  const p = s.pop ?? 1;
  s.g.setAttribute('transform',
    `translate(${s.x} ${s.y + (s.dy||0)}) translate(${cx} ${cy}) scale(${p}) translate(${-cx} ${-cy})`);
  s.g.setAttribute('opacity', clamp(p * 1.8, 0, 1));
  s.g.classList.toggle('movable', s.parentId != null);
  s.g.classList.toggle('sel', s.id === selId);
}

function jiggle(s) {
  tween(420, (e, t) => { s.dy = Math.sin(t * Math.PI * 3) * 5 * (1 - t); place(s); },
    () => { s.dy = 0; place(s); });
}

/* ---------- tree layout: rows sit edge-to-edge, exactly in line with their scale ---------- */
function span(s) {
  let w = s.len * CM;
  s.rows.forEach(row => {
    const rw = row.reduce((a, k) => a + span(k), 0);
    w = Math.max(w, rw);
  });
  return w;
}
function subtreeH(s) {
  let h = RH;
  s.rows.forEach(row => { h += VGAP + Math.max(...row.map(subtreeH)); });
  return h;
}
// every cut row starts at its parent's left edge, so pieces never stick out of the scale
function layout() {
  const root = scales.find(s => !s.parentId);
  if (!root) return;
  (function assign(s, left, y) {
    const sp = span(s);
    s.tx = left + sp/2 - s.len*CM/2; s.ty = y;
    let cy = y + RH + VGAP;
    s.rows.forEach(row => {
      const bandH = Math.max(...row.map(subtreeH));
      let cx = s.tx;
      row.forEach(k => { assign(k, cx, cy); cx += span(k); });
      cy += bandH + VGAP;
    });
  })(root, -span(root)/2, 0);
}
function eachSub(s, fn) { fn(s); s.rows.forEach(r => r.forEach(k => eachSub(k, fn))); }
function moveTo(s, X, Y, animate) {
  if (s.drag) return; // being dragged by the kid
  const fx = s.x, fy = s.y;
  if (!animate || (Math.abs(fx - X) < .5 && Math.abs(fy - Y) < .5)) { s.x = X; s.y = Y; place(s); return; }
  s.tw && s.tw();
  s.tw = tween(520, e => { s.x = fx + (X - fx) * e; s.y = fy + (Y - fy) * e; place(s); },
    () => { s.x = X; s.y = Y; place(s); });
}
// slide everything to its slot + accumulated drag offsets (a dragged piece carries its subtree)
function reposition(animate = true, skip = []) {
  const root = scales.find(s => !s.parentId);
  if (!root) return;
  (function walk(s, ax, ay) {
    s.ax = ax; s.ay = ay;
    if (!skip.includes(s.id)) moveTo(s, s.tx + ax + s.off.dx, s.ty + ay + s.off.dy, animate);
    s.rows.forEach(row => row.forEach(k => walk(k, ax + s.off.dx, ay + s.off.dy)));
  })(root, 0, 0);
}

/* ---------- view helpers ---------- */
let viewTw = null;
function tweenView(target, dur = 700) {
  viewTw && viewTw();
  const s = { ...view };
  viewTw = tween(dur, e => {
    view.tx = s.tx + (target.tx - s.tx) * e;
    view.ty = s.ty + (target.ty - s.ty) * e;
    view.k  = s.k * Math.pow(target.k / s.k, e);
    applyView();
  }, () => viewTw = null, easeInOutCubic);
}
function fitView(animate = true, dur = 750) {
  if (!scales.length) return;
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  scales.forEach(s => {
    // bound the FINAL positions (slot + drag offsets) so mid-animation states don't skew the fit
    const x = s.tx + s.ax + s.off.dx, y = s.ty + s.ay + s.off.dy;
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + s.len * CM); maxY = Math.max(maxY, y + RH);
  });
  // grow the box a bit so length labels ("33 cm", "1 cm left over") never clip at the view edge
  minX -= 60; maxX += 90; minY -= 34; maxY += 6;
  const bw = Math.max(maxX - minX, 200), bh = Math.max(maxY - minY, 120);
  const m = isMobile();
  const availW = m ? innerWidth - 28 : Math.max(innerWidth - 370, 320);
  const availH = m ? innerHeight - 250 : innerHeight - 280;
  const k = clamp(Math.min(availW / bw, availH / bh), .3, 1.5);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const target = {
    tx: (m ? innerWidth / 2 : availW / 2 + 24) - cx * k,
    ty: (m ? 108 + availH / 2 : 90 + (innerHeight - 170) / 2) - cy * k, k };
  if (animate) tweenView(target, dur); else { view = target; applyView(); }
}

/* ---------- pan / zoom / piece-drag / long-press (touch + mouse) ---------- */
const ptrs = new Map();
let panInfo = null, pinch = null, moved = false, downId = null, pieceDrag = null;
let pressTimer = null, pressPt = null, splitPreview = null, confirmLoop = false;
svg.addEventListener('pointerdown', e => {
  $('#book').classList.remove('open'); // tapping the canvas closes the mobile book
  if (pieceDrag) return;               // one piece at a time
  try { svg.setPointerCapture(e.pointerId); } catch (_) {}
  // self-heal stale pointers whose pointerup was lost: a lone finger idle for
  // 3s is orphaned, and 2+ lingering fingers block every new gesture
  if (ptrs.size === 1) {
    const [only] = ptrs.values();
    if (performance.now() - (only.t || 0) > 3000) ptrs.clear();
  } else if (ptrs.size >= 2) {
    ptrs.clear();
  }
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() });
  if (ptrs.size === 1) {
    panInfo = { tx0: view.tx, ty0: view.ty, x: e.clientX, y: e.clientY };
    moved = false;
    pieceDrag = null;
    const g = e.target.closest && e.target.closest('.scale');
    downId = g ? +g.dataset.id : null;
    // holding a ruler still opens the split-here controls
    clearTimeout(pressTimer);
    if (downId != null) {
      pressPt = { x: e.clientX, y: e.clientY };
      pressTimer = setTimeout(fireLongPress, 650);
    }
  } else if (ptrs.size === 2 && !pieceDrag) {
    clearTimeout(pressTimer); pressTimer = null; // a pinch is not a hold
    const [a, b] = [...ptrs.values()];
    pinch = { d: Math.hypot(a.x-b.x, a.y-b.y), k0: view.k, cx:(a.x+b.x)/2, cy:(a.y+b.y)/2, tx0: view.tx, ty0: view.ty };
  }
});
svg.addEventListener('pointermove', e => {
  if (!ptrs.has(e.pointerId)) return;
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() });
  if (pinch && ptrs.size === 2) {
    const [a, b] = [...ptrs.values()];
    const k = clamp(pinch.k0 * Math.hypot(a.x-b.x, a.y-b.y) / pinch.d, .3, 3);
    const wx = (pinch.cx - pinch.tx0) / pinch.k0, wy = (pinch.cy - pinch.ty0) / pinch.k0;
    view.k = k; view.tx = pinch.cx - wx * k; view.ty = pinch.cy - wy * k;
    applyView(); moved = true;
  } else if (panInfo && ptrs.size === 1) {
    const dx = e.clientX - panInfo.x, dy = e.clientY - panInfo.y;
    if (pressTimer && Math.abs(dx) + Math.abs(dy) > 8) { clearTimeout(pressTimer); pressTimer = null; }
    if (!moved && downId != null && Math.abs(dx) + Math.abs(dy) > 8) {
      const s = byId.get(downId);
      if (s && s.parentId != null) startPieceDrag(s, e); // a piece under the finger moves, not the canvas
    }
    if (pieceDrag) { dragMove(e); return; }
    if (Math.abs(dx) + Math.abs(dy) > 6) { moved = true; svg.classList.add('panning'); }
    if (moved) { view.tx = panInfo.tx0 + dx; view.ty = panInfo.ty0 + dy; applyView(); }
  }
});
function endPtr(e) {
  try { svg.releasePointerCapture(e.pointerId); } catch (_) {}
  ptrs.delete(e.pointerId);
  if (ptrs.size < 2) pinch = null;
  if (ptrs.size === 0) {
    svg.classList.remove('panning');
    clearTimeout(pressTimer); pressTimer = null;
    if (pieceDrag) endPieceDrag();
    else if (!moved) {
      if (downId != null) select(downId);
      else if (preview || splitPreview) cancelPreview();
      else { selId = null; scales.forEach(place); hidePieceBar(); setHint('Tap a ruler to pick it up! 🖐'); }
    }
    panInfo = null; downId = null;
  }
}
svg.addEventListener('pointerup', endPtr);
svg.addEventListener('pointercancel', endPtr);
svg.addEventListener('wheel', e => {
  e.preventDefault();
  zoomAt(e.clientX, e.clientY, clamp(view.k * Math.exp(-e.deltaY * .0013), .3, 3));
}, { passive: false });
function zoomAt(sx, sy, k2) {
  const k1 = view.k, wx = (sx - view.tx) / k1, wy = (sy - view.ty) / k1;
  view.k = k2; view.tx = sx - wx * k2; view.ty = sy - wy * k2;
  applyView();
}

/* ---------- selection ---------- */
function select(id) {
  if ((preview || splitPreview) && (preview || splitPreview).id !== id) cancelPreview();
  selId = id;
  scales.forEach(place);
  const s = byId.get(id);
  if (s) {
    blip(); jiggle(s);
    if (s.parentId != null) {
      showPieceBar();
      setHint('Drag it anywhere, cut it smaller, or use the buttons! ✨');
    } else {
      hidePieceBar();
      setHint('Got it! Tap ✂️ Cut or 📏 Size for this ruler.');
    }
  }
}

/* ---------- number pad ---------- */
let padCtx = null;
(function buildPad() {
  const pad = $('#pad');
  ['1','2','3','4','5','6','7','8','9','⌫','0','✓'].forEach(k => {
    const b = document.createElement('button');
    b.className = 'key' + (k === '⌫' ? ' alt' : k === '✓' ? ' ok' : '');
    b.textContent = k;
    b.addEventListener('click', () => padKey(k));
    pad.appendChild(b);
  });
})();
function openPad(opts) {
  if (preview) cancelPreview();
  // `edited` turns false on open: the pre-filled start value behaves like a
  // calculator's selected text — the first digit the kid presses replaces it.
  padCtx = { ...opts, val: opts.start != null ? String(opts.start) : '', edited: false };
  $('#mTitle').textContent = padCtx.title;
  $('#mRange').textContent = `between ${padCtx.min} and ${padCtx.max} ${padCtx.unit}`;
  $('#mUnit').textContent = ' ' + padCtx.unit;
  drawVal();
  $('#modal').hidden = false;
  blip();
}
function closePad() { padCtx = null; $('#modal').hidden = true; }
function drawVal() { $('#mValue').textContent = padCtx.val || '—'; }
function padKey(k) {
  if (!padCtx) return;
  if (k === '✓') { submitPad(); return; }
  const maxDigits = String(padCtx.max).length;
  if (k === '⌫') { padCtx.val = padCtx.val.slice(0, -1); padCtx.edited = true; }
  else {
    if (!padCtx.edited) { padCtx.val = ''; padCtx.edited = true; }
    if (padCtx.val.length < maxDigits) padCtx.val += k;
  }
  blip(); drawVal();
}
function submitPad() {
  const v = parseInt(padCtx.val, 10);
  if (!v || v < padCtx.min || v > padCtx.max) {
    const d = $('#mDisplay');
    d.classList.remove('err'); void d.offsetWidth; d.classList.add('err');
    sad(); toast(`Pick a number from ${padCtx.min} to ${padCtx.max}! 🙈`);
    padCtx.val = ''; // clear the bad number so the kid can type a fresh one
    drawVal();
    return;
  }
  const ok = padCtx.ok; closePad(); ok(v);
}
$('#mClose').addEventListener('click', closePad);
$('#modal').addEventListener('pointerdown', e => { if (e.target.id === 'modal') closePad(); });

/* ---------- tool 1: Scale Setter ---------- */
$('#tRuler').addEventListener('click', () => {
  const s = sel();
  if (!s) { toast('Tap a ruler first! 👆'); sad(); return; }
  openPad({
    title: 'How long should this ruler be?',
    unit: 'cm', min: 10, max: 500, start: s.len,
    ok: v => setSize(s, v),
  });
});
function setSize(s, v) {
  const from = s.len;
  tween(650, e => { s.len = Math.round(from + (v - from) * e); render(s); layout(); reposition(false); },
    () => { s.len = v; render(s); layout(); reposition(true); fitView(); }, easeOutCubic);
  popS(); layout(); reposition(false);
  setHint(`${v} cm! Now tap ✂️ Cut to split it!`);
}

/* ---------- tool 2: Partition Maker ---------- */
$('#tCut').addEventListener('click', () => {
  const s = sel();
  if (!s) { toast('Tap a ruler first! 👆'); sad(); return; }
  if (Math.floor(s.len) < 2) { toast('This piece is too tiny to cut! 🐜'); sad(); return; }
  const maxN = Math.max(2, Math.min(12, Math.floor(s.len)));
  openPad({
    title: 'Cut into how many pieces?',
    unit: 'pieces', min: 2, max: maxN,
    ok: n => startPreview(s, n),
  });
});

function startPreview(s, n) {
  hidePieceBar();
  preview = { id: s.id, n };
  const w = s.len * CM, pw = w / n;
  const layer = $('#previewLayer');
  layer.innerHTML = '';
  const pg = el('g', {}, layer);
  pg.setAttribute('transform', `translate(${s.x} ${s.y})`);
  for (let i = 1; i < n; i++) el('line', { class:'cutline', x1:i*pw, y1:-6, x2:i*pw, y2:RH+6 }, pg);
  for (let i = 0; i < n; i++) if (i % 2) el('rect', { class:'segTint', x:i*pw, y:0, width:pw, height:RH, rx:4 }, pg);
  $('#confirmText').textContent = `Cut into ${n} pieces?`;
  $('#confirmBar').hidden = false;
  startConfirmLoop();
  blip();
  setHint('Look at the lines! Tap the green ✔ to cut!');
}
function positionConfirm() {
  const st = preview || splitPreview;
  const s = st && byId.get(st.id);
  if (!s) { confirmLoop = false; return; }
  const pv = $('#previewLayer').firstElementChild;
  if (pv) pv.setAttribute('transform', `translate(${s.x} ${s.y})`); // cut lines stay glued to the ruler
  const bar = $('#confirmBar');
  const sx = (st.cm ? s.x + st.cm * CM : s.x + s.len * CM / 2) * view.k + view.tx;
  const sy = s.y * view.k + view.ty;
  const m = isMobile();
  const x = clamp(sx, bar.offsetWidth / 2 + 8, innerWidth - bar.offsetWidth / 2 - 8);
  const y = clamp(sy - 14, bar.offsetHeight + (m ? 110 : 90), innerHeight - (m ? 160 : 140));
  bar.style.left = x + 'px'; bar.style.top = y + 'px';
  requestAnimationFrame(positionConfirm);
}
function startConfirmLoop() {
  if (confirmLoop) return;
  confirmLoop = true;
  requestAnimationFrame(positionConfirm);
}
function cancelPreview() {
  preview = null;
  splitPreview = null;
  $('#previewLayer').innerHTML = '';
  $('#confirmBar').hidden = true;
  setHint('Tap a ruler to pick it up! 🖐');
}
$('#btnNo').addEventListener('click', () => { blip(); cancelPreview(); });
$('#btnYes').addEventListener('click', () => { if (splitPreview) confirmSplit(); else confirmCut(); });

function confirmCut() {
  if (!preview) return;
  const s = byId.get(preview.id), n = preview.n, L = s.len;
  const q = Math.floor(L / n), r = L - q * n;
  cancelPreview();
  snip();

  const newIds = [];
  const row = [];
  for (let i = 0; i < n; i++) {
    const k = makeScale(q, COLORS[colorIdx++ % COLORS.length]);
    k.parentId = s.id; row.push(k); newIds.push(k.id);
  }
  if (r > 0) {
    const k = makeScale(r, GRAY, { remainder: true });
    k.parentId = s.id; row.push(k); newIds.push(k.id);
  }
  // every cut keeps its own row; rows stay sorted biggest pieces on top
  let at = s.rows.findIndex(existing => existing[0].len < q);
  if (at === -1) at = s.rows.length;
  s.rows.splice(at, 0, row);
  layout();                  // slots only — pieces never stick out of their scale
  reposition(true, newIds);  // slide existing pieces to their new spots

  const bx = s.ax + s.off.dx, by = s.ay + s.off.dy; // spawn under the scale as it is now
  spawnRow(s, newIds);

  confettiAt((s.x + s.len * CM / 2) * view.k + view.tx, (s.y + RH / 2) * view.k + view.ty);
  chime();
  addCard({ L, n, q, r });
  fitView(true, 780);
  let msg;
  if (s.rows.length === 1)
    msg = r > 0 ? `${n} pieces of ${q} cm + ${r} cm left over! 🎉`
                : `${n} pieces of ${q} cm each! Cut again for a new row! ✂️`;
  else if (at === s.rows.length - 1)
    msg = `New row of ${q} cm pieces — smallest at the bottom! Cut again? ✂️`;
  else
    msg = `${q} cm pieces! Bigger rows stay on top 📊`;
  setHint(msg);
}

// staggered pop-in of a freshly cut row, right under its scale
function spawnRow(s, ids) {
  const bx = s.ax + s.off.dx, by = s.ay + s.off.dy; // spawn under the scale as it is now
  ids.forEach((id, i) => {
    const k = byId.get(id);
    k.x = k.tx + bx; k.y = k.ty + by - 42; k.pop = 0; place(k);
    setTimeout(() => {
      tween(520, e => { k.pop = e; place(k); }, null, easeOutBack);
      tween(520, e => { k.y = (k.ty + by - 42) + 42 * e; place(k); });
      popS();
    }, 130 + i * 110);
  });
}

/* ---------- long-press → split a ruler at any point ---------- */
function fireLongPress() {
  pressTimer = null;
  if (pieceDrag || !pressPt) return;
  const s = byId.get(downId);
  if (!s || s.len < 2) { tone(300, 180, .18, 'sawtooth', .07); toast('This piece is too tiny to cut! 🐜'); return; }
  const wx = (pressPt.x - view.tx) / view.k;
  const cm = clamp(Math.round((wx - s.x) / CM), 1, s.len - 1);
  cancelPreview();
  selId = s.id; scales.forEach(place); hidePieceBar();
  splitPreview = { id: s.id, cm };
  const layer = $('#previewLayer');
  layer.innerHTML = '';
  const g = el('g', {}, layer);
  g.setAttribute('transform', `translate(${s.x} ${s.y})`);
  el('line', { class: 'cutline', x1: cm * CM, y1: -6, x2: cm * CM, y2: RH + 6 }, g);
  el('rect', { class: 'segTint', x: cm * CM, y: 0, width: s.len * CM - cm * CM, height: RH, rx: 4 }, g);
  $('#confirmText').textContent = `Cut at ${cm} cm?`;
  $('#confirmBar').hidden = false;
  startConfirmLoop();
  blip();
  setHint(`Split into ${cm} cm and ${s.len - cm} cm? Tap the green ✓!`);
}
function confirmSplit() {
  if (!splitPreview) return;
  const s = byId.get(splitPreview.id), a = splitPreview.cm, b = s.len - a, L = s.len;
  cancelPreview();
  snip();
  const row = [];
  for (let i = 0; i < 2; i++) {
    const k = makeScale(i ? b : a, COLORS[colorIdx++ % COLORS.length]);
    k.parentId = s.id; row.push(k);
  }
  // rows stay sorted biggest-first; inside the row, the left piece stays left
  let at = s.rows.findIndex(existing => existing[0].len < a);
  if (at === -1) at = s.rows.length;
  s.rows.splice(at, 0, row);
  layout();
  const newIds = row.map(k => k.id);
  reposition(true, newIds);
  spawnRow(s, newIds);
  confettiAt((s.x + a * CM) * view.k + view.tx, (s.y + RH / 2) * view.k + view.ty);
  chime();
  addSplitCard({ L, a, b });
  fitView(true, 780);
  setHint(`${a} + ${b} = ${L} cm! Hold another ruler to split it too! ✂️`);
}

/* ---------- drag, snap, remove & re-home pieces ---------- */
let barLoop = false;
function showPieceBar() {
  const s = sel();
  const bar = $('#pieceBar');
  if (!s || s.parentId == null) { hidePieceBar(); return; }
  $('#pHome').style.display = (s.off.dx || s.off.dy) ? '' : 'none';
  bar.hidden = false;
  if (!barLoop) { barLoop = true; requestAnimationFrame(posPieceBar); }
}
function posPieceBar() {
  const bar = $('#pieceBar'), s = sel();
  if (bar.hidden || !s) { barLoop = false; return; }
  const sx = (s.x + s.len * CM / 2) * view.k + view.tx;
  const sy = s.y * view.k + view.ty;
  bar.style.left = clamp(sx, bar.offsetWidth / 2 + 8, innerWidth - bar.offsetWidth / 2 - 8) + 'px';
  bar.style.top = clamp(sy - 12, bar.offsetHeight + (isMobile() ? 106 : 80), innerHeight - (isMobile() ? 160 : 130)) + 'px';
  requestAnimationFrame(posPieceBar);
}
function hidePieceBar() { $('#pieceBar').hidden = true; barLoop = false; }
function startPieceDrag(s, e) {
  cancelPreview();
  moved = true;
  selId = s.id; scales.forEach(place);
  hidePieceBar();
  s.drag = true;
  s.tw && s.tw();
  const wx = (e.clientX - view.tx) / view.k, wy = (e.clientY - view.ty) / view.k;
  pieceDrag = { id: s.id, gx: wx - s.x, gy: wy - s.y };
  setHint('Drag it anywhere — it snaps into line! 🧲');
  tone(480, 700, .08, 'sine', .1);
}
function dragMove(e) {
  const s = byId.get(pieceDrag.id);
  if (!s) return;
  const wx = (e.clientX - view.tx) / view.k, wy = (e.clientY - view.ty) / view.k;
  const ddx = (wx - pieceDrag.gx) - s.x, ddy = (wy - pieceDrag.gy) - s.y;
  eachSub(s, n => { n.x += ddx; n.y += ddy; n.tw && n.tw(); place(n); });
}
function endPieceDrag() {
  const s = byId.get(pieceDrag.id);
  pieceDrag = null;
  if (!s) return;
  s.drag = false;
  // magnetic snap: x to the main scale's cm marks, y to a tidy row lattice
  const root = scales.find(x => !x.parentId);
  const originX = root.tx ?? root.x;
  const sx = originX + Math.round((s.x - originX) / CM) * CM;
  const sy = Math.round(s.y / SNAP_Y) * SNAP_Y;
  const ddx = sx - s.x, ddy = sy - s.y;
  s.off.dx += ddx; s.off.dy += ddy;
  eachSub(s, n => {
    const fx = n.x, fy = n.y;
    n.tw && n.tw();
    n.tw = tween(320, e => { n.x = fx + ddx * e; n.y = fy + ddy * e; place(n); },
      () => { n.x = fx + ddx; n.y = fy + ddy; place(n); });
  });
  tone(860, 520, .06, 'square', .12);
  showPieceBar();
}
$('#pHome').addEventListener('click', () => { const s = sel(); s && homePiece(s); });
$('#pTrash').addEventListener('click', () => { const s = sel(); s && removePiece(s); });
function homePiece(s) {
  const ddx = (s.tx + s.ax) - s.x, ddy = (s.ty + s.ay) - s.y;
  s.off.dx = 0; s.off.dy = 0;
  eachSub(s, n => {
    const fx = n.x, fy = n.y;
    n.tw && n.tw();
    n.tw = tween(420, e => { n.x = fx + ddx * e; n.y = fy + ddy * e; place(n); },
      () => { n.x = fx + ddx; n.y = fy + ddy; place(n); });
  });
  popS(); showPieceBar();
  setHint('Back in line with its scale! 📏');
}
function removePiece(s) {
  hidePieceBar();
  const p = byId.get(s.parentId);
  if (p) {
    p.rows.forEach(r => { const i = r.indexOf(s); if (i > -1) r.splice(i, 1); });
    p.rows = p.rows.filter(r => r.length);
  }
  selId = null; scales.forEach(place);
  const nodes = []; eachSub(s, n => nodes.push(n));
  nodes.forEach(n => { n.tw && n.tw(); scales = scales.filter(x => x !== n); byId.delete(n.id); });
  nodes.forEach((n, i) => setTimeout(() => {
    const y0 = n.y;
    tween(360, e2 => { n.y = y0 - 200 * e2; n.pop = 1 - e2; place(n); }, () => n.g.remove());
  }, i * 45));
  tone(500, 140, .25, 'sawtooth', .09);
  setHint('Piece removed! 🧹');
  setTimeout(() => fitView(true, 600), 460);
}

/* ---------- math book sheet (mobile) ---------- */
$('#bookBtn').addEventListener('click', () => { $('#book').classList.toggle('open'); blip(); });
$('#bookClose').addEventListener('click', () => $('#book').classList.remove('open'));

/* ---------- math book cards: the problem resolves step by step ---------- */
const chd = (str, cls = '', base = 0, dt = 45) =>
  `<span class="${cls}">${[...String(str)].map((c, i) =>
    `<span class="ch" style="animation-delay:${Math.round(base + i * dt)}ms">${c}</span>`).join('')}</span>`;
function addCard({ L, n, q, r }) {
  const card = document.createElement('div');
  card.className = 'card';
  const prod = q * n;
  const digits = String(q).length;
  // the long division resolves like a pencil: problem → roof → quotient → product → remainder
  const tRoof = 750, tQ = 1500, tProd = tQ + digits * 160 + 150, tLine = tProd + 280, tRem = tLine + 320;
  const qDigits = [...String(q)].map((d, i) =>
    `<span class="ch" style="animation-delay:${tQ + i * 160}ms">${d}</span>`).join('');
  const remInline = r > 0 ? `<span class="rem">${chd('r ' + r, '', tRem)}</span>`
                          : `<span class="rem zero">${chd('✨', '', tRem)}</span>`;
  const remBox = r > 0 ? `${r}<span class="rlab">left over</span>`
                       : `0 <span class="star">⭐</span><span class="rlab">nothing left!</span>`;
  card.innerHTML = `
    <div class="eq">${chd(L,'a')}${chd('÷','op',135)}${chd(n,'b',225)}
      ${chd('=','op',tQ)}${chd(q,'q',tQ + 60,60)}<small>${chd('cm','',tQ + 60 + digits * 60,40)}</small>${remInline}</div>
    <div class="bracketWrap"><div class="bracket">
      <div class="divisor step" style="--d:${tRoof}ms">${n}</div>
      <div class="roofbox">
        <div class="quotient">${qDigits}</div>
        <div class="dividend step" style="--d:${tRoof + 120}ms">${L}</div>
        <div class="product step" style="--d:${tProd}ms">${prod}</div>
        <div class="rline" style="--d:${tLine}ms"></div>
        <div class="remainder step" style="--d:${tRem}ms">${remBox}</div>
      </div>
    </div></div>`;
  const cards = $('#cards');
  cards.prepend(card);
  while (cards.children.length > 24) cards.lastChild.remove();
  const bc = $('#bookCount');
  bc.hidden = false; bc.textContent = cards.children.length;
  // soft pencil ticks as each step lands
  [tRoof, tQ, tProd, tLine, tRem].forEach(t => setTimeout(() => tone(620, 860, .05, 'sine', .06), t));
}
// a long-press split isn't division — it's a number-decomposition story
function addSplitCard({ L, a, b }) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <div class="eq">${chd(L,'a')}${chd('=','op',135)}${chd(a,'b',225)}${chd('+','op',450)}${chd(b,'q',540)}<small>${chd('cm','',780,40)}</small><span class="rem zero">${chd('✨', '', 920)}</span></div>
    <div class="splitNote">${chd('split at ' + a + ' cm', '', 1050, 30)}</div>`;
  const cards = $('#cards');
  cards.prepend(card);
  while (cards.children.length > 24) cards.lastChild.remove();
  const bc = $('#bookCount');
  bc.hidden = false; bc.textContent = cards.children.length;
  [760, 1000].forEach(t => setTimeout(() => tone(620, 860, .05, 'sine', .06), t));
}

/* ---------- confetti ---------- */
function confettiAt(x, y) {
  const fx = $('#fx');
  const colors = ['#FF8FA3','#6FD6A8','#6FB9F2','#FFC94D','#B492F5','#FFAB6B'];
  const parts = [];
  for (let i = 0; i < 30; i++) {
    const d = document.createElement('div');
    d.className = 'conf';
    d.style.background = colors[i % colors.length];
    d.style.borderRadius = Math.random() < .4 ? '50%' : '3px';
    const sz = 7 + Math.random() * 8;
    d.style.width = sz + 'px'; d.style.height = sz + 'px';
    fx.appendChild(d);
    parts.push({ d, x, y, vx: (Math.random()-.5)*11, vy: -4 - Math.random()*7.5,
                 r: Math.random()*360, vr: (Math.random()-.5)*22, life: 1 });
  }
  (function fr() {
    let alive = false;
    parts.forEach(p => {
      p.vy += .32; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.life -= .011;
      if (p.life > 0 && p.y < innerHeight + 30) {
        alive = true;
        p.d.style.transform = `translate(${p.x}px,${p.y}px) rotate(${p.r}deg)`;
        p.d.style.opacity = Math.min(1, p.life * 2);
      } else p.d.remove();
    });
    if (alive) requestAnimationFrame(fr);
  })();
}

/* ---------- toast & hint ---------- */
let toastT = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => t.hidden = true, 2000);
}
function setHint(text) {
  const h = $('#hint');
  h.textContent = text;
  h.classList.remove('pop'); void h.offsetWidth; h.classList.add('pop');
}

/* ---------- fit / sound / reset ---------- */
$('#tFit').addEventListener('click', () => { fitView(true, 600); blip(); });
$('#tSound').addEventListener('click', e => {
  muted = !muted;
  e.currentTarget.innerHTML = (muted ? '🔇' : '🔊') + '<span>Sound</span>';
  if (!muted) blip();
});
let resetArm = false, resetT = null;
$('#tReset').addEventListener('click', e => {
  const btn = e.currentTarget; // capture now: currentTarget is null inside timers
  if (!resetArm) {
    resetArm = true;
    btn.classList.add('arm');
    toast('Tap again to start over! 🔄');
    resetT = setTimeout(() => { resetArm = false; btn.classList.remove('arm'); }, 2000);
    return;
  }
  clearTimeout(resetT); resetArm = false;
  btn.classList.remove('arm');
  doReset();
});
function doReset() {
  cancelPreview(); closePad(); hidePieceBar();
  $('#book').classList.remove('open');
  const old = scales;
  scales = []; byId = new Map(); selId = null; colorIdx = 0; preview = null;
  $('#cards').innerHTML = '';
  const bc = $('#bookCount'); bc.hidden = true; bc.textContent = '0';
  old.forEach((s, i) => {
    const y0 = s.y;
    setTimeout(() => tween(320, e2 => { s.y = y0 - 260 * e2; s.pop = 1 - e2; place(s); },
      () => s.g.remove()), i * 40);
  });
  chime();
  setTimeout(() => { initWorld(true); fitView(true); }, old.length * 40 + 380);
  setHint('Fresh start! ✨');
}

/* ---------- world init & intro ---------- */
function initWorld(drop) {
  const root = makeScale(100, MAIN_COLOR);
  root.x = -100 * CM / 2; root.y = 0;
  layout(); reposition(false);
  selId = root.id;
  place(root);
  if (drop) {
    root.y = -340; root.pop = 0; place(root);
    tween(820, e => { root.y = -340 + 340 * e; place(root); }, null, easeOutBounce);
    tween(500, e => { root.pop = e; place(root); }, null, easeOutBack);
  }
}
let started = false;
$('#btnStart').addEventListener('click', () => {
  if (started) return; // guard against double-click spawning two rulers
  started = true;
  ensureAC();
  $('#intro').classList.add('hide');
  initWorld(true);
  fitView(false); // size the ruler to the screen (crucial on phones)
  chime();
  setTimeout(() => confettiAt(innerWidth / 2, innerHeight * .4), 350);
  setHint('Tap ✂️ to split equally — or HOLD a ruler to cut it anywhere!');
});

/* ---------- misc ---------- */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closePad(); cancelPreview(); hidePieceBar(); }
});
document.addEventListener('gesturestart', e => e.preventDefault()); // stop iOS page zoom
svg.addEventListener('contextmenu', e => e.preventDefault());       // no long-press menu

// carry the app context (?from=/ when opened from Dar-al-Hikmah OS) back to the hub.
// The back target is computed from this page's own path, so it works no matter
// which directory the game is served from (/games/math/ inside the app, / here).
{
  const q = location.search;
  const base = location.pathname.replace(/division\.html$/, "");
  const b = document.getElementById('backBtn');
  if (b) b.href = base + 'index.html' + q;
  const ib = document.querySelector('.introBack');
  if (ib) ib.href = base + 'index.html' + q;
}
addEventListener('resize', applyView);
