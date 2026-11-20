/* ============================================================
   Math Games · Division — a playful ruler-cutting game
   Vanilla JS + SVG. No frameworks, no build step.

   World units are centimetres. CM (pixels per cm) follows the
   root ruler, so a 1 cm scale fills the canvas exactly like a
   100 cm one — and its millimetres are big enough to count.
   Millimetre ticks always exist on every scale; they sit as
   faint lines from a distance and come into focus as the kid
   zooms (map-style level of detail).
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
const round2 = x => Math.round(x * 100) / 100;
function fmt(x) { // kid-friendly length text: 3.333→"3.33", 2.50→"2.5", 4→"4"
  return String(parseFloat((Math.round(x * 100) / 100).toFixed(2)));
}

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
const ROOTW = 620;  // world px the ROOT ruler always spans, whatever its length in cm
let   CM    = 6;    // pixels per cm — adapts to the root ruler (100 cm → 6, 1 cm → 620)
const RH = 64;      // ruler height
const VGAP = 96;    // vertical gap between a scale and its pieces row
const SNAP_Y = (RH + VGAP) / 2;  // vertical magnet lattice for dragged pieces
const MINK = .22, MAXK = 400;   // zoom limits: from far above to deep inside one millimetre
const isMobile = () => matchMedia('(max-width:700px)').matches;

const defs = $('#defs');
const world = $('#world');
const svg = $('#canvas');

// dotted "graph paper" that pans/zooms with the world → the canvas feels unlimited.
// the tile is resized with the zoom so the dots stay a calm, constant screen texture.
const dotsPat = el('pattern', { id:'dots', width:34, height:34, patternUnits:'userSpaceOnUse' }, defs);
const dotC = el('circle', { cx:2, cy:2, r:1.7, fill:'#CBE4F0' }, dotsPat);

// screen-space label layer (declared early: applyView flags it every frame)
const overlay = el('g', { id: 'overlay' }, svg);
let overlayDirty = true;
let retickT = null, lastRetick = 0;

let scales = [], byId = new Map(), selId = null, preview = null, colorIdx = 0, nextId = 1;
let view = { tx: innerWidth / 2, ty: innerHeight * .38, k: 1 };
function applyView() {
  world.setAttribute('transform', `translate(${view.tx} ${view.ty}) scale(${view.k})`);
  const g = Math.max(view.k, .01);
  dotsPat.setAttribute('width', 34 / g);
  dotsPat.setAttribute('height', 34 / g);
  dotC.setAttribute('cx', 2 / g); dotC.setAttribute('cy', 2 / g); dotC.setAttribute('r', 1.7 / g);
  // the grid rect only covers the visible window: a full-world rect would ask
  // the browser to paint a million pattern tiles when zoomed in deep
  const gridRect = $('#grid');
  gridRect.setAttribute('x', -view.tx / g - 40);
  gridRect.setAttribute('y', -view.ty / g - 40);
  gridRect.setAttribute('width', innerWidth / g + 80);
  gridRect.setAttribute('height', innerHeight / g + 80);
  updateLOD();
  // deep zoom: drop-shadow filters and marching dashes on a screen-filling
  // ruler would ask the browser to repaint a quarter-million-px layer each frame
  svg.classList.toggle('deep', view.k > 5);
  scheduleRetick();
  overlayDirty = true;
}
applyView();

const sel = () => byId.get(selId);

/* ---------- ruler rendering ---------- */
function makeScale(len, color, opts = {}) {
  const s = { id: nextId++, len, color, rows: [], parentId: null, x: 0, y: 0, dy: 0, pop: 1,
              remainder: !!opts.remainder, partial: !!opts.partial, off: { dx: 0, dy: 0 }, ax: 0, ay: 0, drag: false,
              numG: null, numEls: [], lenEl: null };
  s.g = el('g', { class: 'scale' + (s.remainder ? ' remainder' : '') }, $('#scalesLayer'));
  s.g.dataset.id = s.id;
  byId.set(s.id, s); scales.push(s);
  render(s);
  return s;
}

// Ticks live in five stroke paths — 10cm · 5cm · 1cm · 5mm · 1mm — so even a
// 500 cm scale carries all its millimetres as pure geometry. updateLOD() fades
// each density in as the kid zooms, exactly like a map reveals street detail.
// Tick heights breathe with the px-per-cm: a close-up 1 cm ruler gets tall,
// finger-readable millimetre marks; the classic 100 cm view keeps its fine lines.
function tickHeights() {
  const mmw = CM / 10;
  return {
    m1:  clamp(mmw * .55, 4.5, 15),
    m5:  clamp(mmw * .8,  6.5, 21),
    low: clamp(mmw * 1.5, 9,   30),
    mid: clamp(mmw * 2.1, 15,  38),
    maj: clamp(mmw * 3.4, 22,  46),
  };
}
function render(s, fast) {
  s.g.innerHTML = '';
  s.ticked = !fast;
  const w = s.len * CM;
  const T = tickHeights();
  s.ring = el('rect', { class:'ring', x:-8, y:-8, width:w+16, height:RH+16, rx:17, stroke: shade(s.color,-.35) }, s.g);
  el('rect', { class:'body', x:0, y:0, width:w, height:RH, rx:12,
               fill:`url(#${ensureGrad(s.color)})`, stroke: shade(s.color,-.38), 'stroke-width':2 }, s.g);
  if (w >= 120) el('circle', { cx:16, cy:RH/2, r:6, fill:'#FFF9EC', stroke: shade(s.color,-.28), 'stroke-width':2.5 }, s.g);

  let dMaj = '', dMid = '', dLow = '', dM5 = '', dM1 = '';
  const N = Math.floor(s.len + 1e-9);
  for (let i = 0; i <= N; i++) {
    const x = (i * CM).toFixed(2);
    if (i % 10 === 0)      dMaj += `M${x} 2V${T.maj}`;
    else if (i % 5 === 0)  dMid += `M${x} 2V${T.mid}`;
    else                   dLow += `M${x} 2V${T.low}`;
  }
  if (Math.abs(s.len / 10 - Math.round(s.len / 10)) > 1e-9) // an odd or decimal end (33, 2.5…)
    dMaj += `M${w.toFixed(2)} 2V${T.maj}`;
  if (!fast) {
    const M = Math.round(s.len * 10);
    for (let i = 1; i < M; i++) {
      if (i % 10 === 0) continue;                        // whole cm is already ticked
      const x = (i * CM / 10).toFixed(2);
      if (i % 5 === 0) dM5 += `M${x} 2V${T.m5}`; else dM1 += `M${x} 2V${T.m1}`;
    }
  }
  s.pMaj = dMaj && el('path', { class:'tick', d:dMaj, 'stroke-width':2.6 }, s.g);
  s.pMid = dMid && el('path', { class:'tick', d:dMid, 'stroke-width':1.9 }, s.g);
  s.pLow = dLow && el('path', { class:'tick', d:dLow, 'stroke-width':1.3 }, s.g);
  s.pM5  = dM5  && el('path', { class:'tick mm', d:dM5, 'stroke-width':1.1 }, s.g);
  s.pM1  = dM1  && el('path', { class:'tick mm', d:dM1, 'stroke-width':1 }, s.g);
  if (!fast) rebuildNums(s);
  place(s);
}

// zoom level-of-detail: millimetres start as barely-visible whisper lines and
// sharpen as the kid zooms in. cm/5cm ticks fade out only when hopelessly dense.
function updateLOD() {
  if (typeof syncZoomBtns === 'function' && $('#zIn')) syncZoomBtns();
  const spx = CM * view.k, mm = spx / 10;
  const ramp = (v, a, b) => clamp((v - a) / (b - a), 0, 1);
  const oLow = ramp(spx, 1.2, 2.2);
  const oMid = ramp(spx, .8, 1.8);
  const oM5  = ramp(mm, 2.6, 7);
  const oM1  = mm < 1.35 ? 0 : .15 + .85 * ramp(mm, 1.35, 6.5);
  scales.forEach(s => {
    vis(s.pLow, oLow); vis(s.pMid, oMid);
    vis(s.pM5, oM5);   vis(s.pM1, oM1);
  });
}
function vis(p, o) {
  if (!p) return;
  if (o <= .01) { p.style.visibility = 'hidden'; p.style.opacity = 0; }
  else { p.style.visibility = ''; p.style.opacity = o.toFixed(3); }
}

/* ---------- screen-space labels ----------
   Ruler numbers and length labels live OUTSIDE the world transform, so they
   keep a comfy reading size whether the kid is looking at 500 cm from orbit
   or is deep inside one centimetre counting millimetres. */
(function overlayLoop() {
  if (overlayDirty) { overlayDirty = false; updateNums(); }
  requestAnimationFrame(overlayLoop);
})();

function rebuildNums(s) {
  if (s.numG) s.numG.remove();
  s.numG = el('g', {}, overlay);
  s.numEls = [];
  if (!s.lenEl) s.lenEl = el('text', { class: 'lenlabel', fill: shade(s.color, -.45) }, overlay);
  s.lenEl.textContent = s.remainder ? `${fmt(s.len)} cm left over` : s.partial ? `${fmt(s.len)} cm part` : `${fmt(s.len)} cm`;

  const k = view.k;
  const wl = -view.tx / k, wr = (innerWidth - view.tx) / k;  // visible world-x window
  // numbered marks: the densest step that still leaves ≥46px between numbers
  const step = [1, 5, 10, 25, 50].find(t => t * CM * k >= 46) || 50;
  const from = Math.max(0, Math.floor((wl - s.x) / CM / step) * step);
  const to = Math.min(s.len, (wr - s.x) / CM);
  for (let v = from; v <= to + 1e-9 && s.numEls.length < 90; v += step) {
    // skip the last grid number when the odd end label (33.33…) sits too close
    if (v < s.len - 1e-9 && s.len - v < step * .6) continue;
    const t = el('text', { class: 'ticknum' }, s.numG);
    t.textContent = fmt(v);
    s.numEls.push({ e: t, cm: v, mm: false });
  }
  if (Math.abs(s.len / step - Math.round(s.len / step)) > 1e-9) { // label the odd end (33, 2.5…)
    const t = el('text', { class: 'ticknum' }, s.numG);
    t.textContent = fmt(s.len);
    s.numEls.push({ e: t, cm: s.len, mm: false });
  }
  // millimetre labels as decimal centimetres: 0.1, 0.2 … 0.9, 1.1 … — so every
  // little line says what it is. Dense → only the 5 mm marks (0.5, 1.5 …).
  const mmPx = CM * k / 10;
  const mmStep = mmPx >= 30 ? 1 : mmPx >= 9 ? 5 : 0;
  if (mmStep) {
    const a = Math.max(1, Math.floor((wl - s.x) / CM * 10));
    const b = Math.min(Math.round(s.len * 10) - 1, Math.ceil((wr - s.x) / CM * 10));
    for (let i = a; i <= b && s.numEls.length < 200; i++) {
      if (i % 10 === 0 || i % mmStep !== 0) continue;           // whole cm is already numbered
      const t = el('text', { class: 'ticknum mmnum' + (i % 5 === 0 ? ' half' : '') }, s.numG);
      t.textContent = fmt(i / 10);
      s.numEls.push({ e: t, cm: i / 10, mm: true });
    }
  }
  overlayDirty = true;
}

function updateNums() {
  const k = view.k, tx = view.tx, ty = view.ty;
  scales.forEach(s => {
    const top = (s.y + (s.dy || 0)) * k + ty;
    const shown = s.pop >= .99;
    if (s.lenEl) {
      if (!shown) s.lenEl.style.display = 'none';
      else {
        s.lenEl.style.display = '';
        s.lenEl.setAttribute('x', (s.x + s.len * CM / 2) * k + tx);
        s.lenEl.setAttribute('y', clamp(top - clamp(12 * k, 10, 26), 16, innerHeight - 16));
      }
    }
    if (!s.numG) return;
    if (!shown || !s.numEls.length) { s.numG.style.display = 'none'; return; }
    s.numG.style.display = '';
    // numbers ride just below the ruler's top edge, but stay pinned on screen
    // when deep zoom has pushed that edge past the viewport
    // labels sit just BELOW the tallest tick tip so digits never touch the lines
    const yCm = clamp(top + Math.max(26, tickHeights().maj * k + 16), 16, innerHeight - 16);
    const yMm = yCm;
    s.numEls.forEach(ne => {
      const x = (s.x + ne.cm * CM) * k + tx;
      if (x < -60 || x > innerWidth + 60) { ne.e.style.display = 'none'; return; }
      ne.e.style.display = '';
      ne.e.setAttribute('x', x);
      ne.e.setAttribute('y', ne.mm ? yMm : yCm);
    });
  });
}

function scheduleRetick() {
  clearTimeout(retickT);
  // while panning/zooming continuously, still refresh at least every 400ms
  const wait = performance.now() - lastRetick > 400 ? 0 : 150;
  retickT = setTimeout(() => {
    lastRetick = performance.now();
    scales.forEach(s => { if (s.ticked) rebuildNums(s); });
  }, wait);
}

function place(s) {
  const w = s.len * CM, cx = w/2, cy = RH/2;
  const p = s.pop ?? 1;
  s.g.setAttribute('transform',
    `translate(${s.x} ${s.y + (s.dy||0)}) translate(${cx} ${cy}) scale(${p}) translate(${-cx} ${-cy})`);
  s.g.setAttribute('opacity', clamp(p * 1.8, 0, 1));
  s.g.classList.toggle('movable', s.parentId != null);
  s.g.classList.toggle('sel', s.id === selId);
  overlayDirty = true;
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
  const bookHid = document.body.classList.contains('bookOff');
  const availW = m || bookHid ? innerWidth - 28 : Math.max(innerWidth - 370, 320);
  const availH = m ? innerHeight - 250 : innerHeight - 280;
  const k = clamp(Math.min(availW / bw, availH / bh), .22, 2.2);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const target = {
    tx: (m || bookHid ? innerWidth / 2 : availW / 2 + 24) - cx * k,
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
    const k = clamp(pinch.k0 * Math.hypot(a.x-b.x, a.y-b.y) / pinch.d, MINK, MAXK);
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
  zoomAt(e.clientX, e.clientY, clamp(view.k * Math.exp(-e.deltaY * .0013), MINK, MAXK));
}, { passive: false });
// ＋ / － / 🔬 buttons: smooth zoom around the middle of the visible canvas
function canvasCenter() {
  const off = !isMobile() && !document.body.classList.contains('bookOff');
  return { x: off ? (innerWidth - 330) / 2 : innerWidth / 2, y: innerHeight * .42 };
}
function zoomTo(k2) {
  k2 = clamp(k2, MINK, MAXK);
  const c = canvasCenter(), wx = (c.x - view.tx) / view.k, wy = (c.y - view.ty) / view.k;
  tweenView({ k: k2, tx: c.x - wx * k2, ty: c.y - wy * k2 }, 320);
  setTimeout(syncZoomBtns, 340);
}
function syncZoomBtns() {
  $('#zIn').disabled = view.k >= MAXK * .999;
  $('#zOut').disabled = view.k <= MINK * 1.001;
  const mmPx = CM * view.k / 10;
  $('#mmLegend').hidden = !(scales.length && mmPx >= 7);
}
$('#zIn').addEventListener('click', () => { blip(); zoomTo(view.k * 2); });
$('#zOut').addEventListener('click', () => { blip(); zoomTo(view.k / 2); });
$('#zMax').addEventListener('click', () => { blip(); zoomTo(MAXK); toast('Zoomed all the way in! 🔬'); });
function zoomAt(sx, sy, k2) {
  const k1 = view.k, wx = (sx - view.tx) / k1, wy = (sy - view.ty) / k1;
  view.k = k2; view.tx = sx - wx * k2; view.ty = sy - wy * k2;
  applyView();
  syncZoomBtns();
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

/* ---------- number pad (knows decimals — 2.5 cm rulers are welcome) ---------- */
let padCtx = null;
(function buildPad() {
  const pad = $('#pad');
  ['1','2','3','4','5','6','7','8','9','⌫','0','.','✓'].forEach(k => {
    const b = document.createElement('button');
    b.className = 'key' + (k === '⌫' ? ' alt' : k === '✓' ? ' ok' : k === '.' ? ' dot' : '');
    b.textContent = k;
    b.addEventListener('click', () => padKey(k));
    pad.appendChild(b);
  });
})();
function openPad(opts) {
  if (preview) cancelPreview();
  // `edited` turns false on open: the pre-filled start value behaves like a
  // calculator's selected text — the first digit the kid presses replaces it.
  padCtx = { dec: 0, ...opts, val: opts.start != null ? String(opts.start) : '', edited: false };
  $('#mTitle').textContent = padCtx.title;
  $('#mRange').textContent = `between ${fmt(padCtx.min)} and ${fmt(padCtx.max)} ${padCtx.unit}`
                          + (padCtx.dec ? ' · decimals ok!' : '');
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
  const maxLen = String(padCtx.max).length + (padCtx.dec ? padCtx.dec + 1 : 0);
  if (k === '⌫') { padCtx.val = padCtx.val.slice(0, -1); padCtx.edited = true; }
  else if (k === '.') {
    if (!padCtx.dec || padCtx.val.includes('.')) { nudgePad(); return; }
    if (!padCtx.edited) { padCtx.val = '0'; padCtx.edited = true; }
    if (padCtx.val.length < maxLen + 1) padCtx.val += '.';
  }
  else {
    if (!padCtx.edited) { padCtx.val = ''; padCtx.edited = true; }
    if (padCtx.val.length < maxLen) padCtx.val += k;
    else { nudgePad(); return; }
  }
  blip(); drawVal();
}
function nudgePad() { // a gentle "not this key" shake
  const d = $('#mDisplay');
  d.classList.remove('err'); void d.offsetWidth; d.classList.add('err');
  tone(220, 180, .1, 'sine', .06);
}
function submitPad() {
  const v = parseFloat(padCtx.val);
  if (isNaN(v) || v < padCtx.min - 1e-9 || v > padCtx.max + 1e-9) {
    const d = $('#mDisplay');
    d.classList.remove('err'); void d.offsetWidth; d.classList.add('err');
    sad(); toast(`Pick a number from ${fmt(padCtx.min)} to ${fmt(padCtx.max)}! 🙈`);
    padCtx.val = ''; // clear the bad number so the kid can type a fresh one
    drawVal();
    return;
  }
  const r = Math.round(v * 10 ** padCtx.dec) / 10 ** padCtx.dec;
  const ok = padCtx.ok; closePad(); ok(r);
}
$('#mClose').addEventListener('click', closePad);
$('#modal').addEventListener('pointerdown', e => { if (e.target.id === 'modal') closePad(); });

/* ---------- tool 1: Scale Setter ---------- */
$('#tRuler').addEventListener('click', () => {
  const s = sel();
  if (!s) { toast('Tap a ruler first! 👆'); sad(); return; }
  openPad({
    title: 'How long should this ruler be?',
    unit: 'cm', min: 1, max: 500, dec: 1, start: Math.round(s.len * 10) / 10,
    ok: v => setSize(s, v),
  });
});
function setSize(s, v) {
  const from = s.len, isRoot = s.parentId == null;
  tween(650, e => {
    s.len = from + (v - from) * e;
    // the root always spans ROOTW world px: a 1 cm ruler is drawn as big as a
    // 100 cm one — only its graduations get finer or coarser
    if (isRoot) CM = ROOTW / Math.max(s.len, .25);
    rerender(true); layout(); reposition(false);
  }, () => {
    s.len = v;
    if (isRoot) CM = ROOTW / v;
    rerender(false); layout(); reposition(true); fitView();
  }, easeOutCubic);
  popS(); layout(); reposition(false);
  setHint(v < 3 ? `${fmt(v)} cm! A tiny ruler — count its millimetres! 🔬`
                : `${fmt(v)} cm! Now tap ✂️ Cut to split it!`);
}
function rerender(fast) {
  scales.forEach(x => render(x, fast));
  updateLOD();
}

/* ---------- tool 2: Partition Maker ---------- */
$('#tCut').addEventListener('click', () => {
  const s = sel();
  if (!s) { toast('Tap a ruler first! 👆'); sad(); return; }
  if (s.len < 0.2 + 1e-9) { toast('This piece is too tiny to cut! 🐜'); sad(); return; }
  const maxN = clamp(Math.floor(round2(s.len) * 10), 2, 12); // every piece stays ≥ 1 mm
  openPad({
    title: 'Cut into how many parts?',
    unit: 'parts', min: 2, max: maxN, dec: 1,   // 5, 5.1, 5.5 … are all welcome
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
  const cnt = Math.ceil(n - 1e-9);                    // 5.5 parts → five whole pieces + half a piece
  for (let i = 1; i < cnt; i++) el('line', { class:'cutline', x1:i*pw, y1:-6, x2:i*pw, y2:RH+6 }, pg);
  for (let i = 0; i < cnt; i++) if (i % 2) el('rect', { class:'segTint', x:i*pw, y:0, width:Math.min(pw, w - i*pw), height:RH, rx:4 }, pg);
  $('#confirmText').textContent = `Cut into ${fmt(n)} parts?`;
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
  // decimal division: each piece is the share rounded DOWN to 2 decimals, so
  // the leftover is never negative (10 ÷ 3 → 3.33 cm each, 0.01 cm left over)
  const q = Math.floor(L / n * 100 + 1e-9) / 100;
  let r = round2(L - q * n); if (r < 0) r = 0;
  cancelPreview();
  snip();

  const newIds = [];
  const row = [];
  const whole = Math.floor(n + 1e-9);
  const partLen = round2((n - whole) * q);            // 5.5 parts: the last piece is only half-size
  for (let i = 0; i < whole; i++) {
    const k = makeScale(q, COLORS[colorIdx++ % COLORS.length]);
    k.parentId = s.id; row.push(k); newIds.push(k.id);
  }
  if (partLen >= 0.1) {
    const k = makeScale(partLen, COLORS[colorIdx++ % COLORS.length], { partial: true });
    k.parentId = s.id; row.push(k); newIds.push(k.id);
  }
  if (r >= 0.1) { // a leftover of at least 1 mm gets its own grey piece
    const k = makeScale(r, GRAY, { remainder: true });
    k.parentId = s.id; row.push(k); newIds.push(k.id);
  }
  // every cut keeps its own row; rows stay sorted biggest pieces on top
  let at = s.rows.findIndex(existing => existing[0].len < q - 1e-9);
  if (at === -1) at = s.rows.length;
  s.rows.splice(at, 0, row);
  layout();                  // slots only — pieces never stick out of their scale
  reposition(true, newIds);  // slide existing pieces to their new spots

  spawnRow(s, newIds);

  confettiAt((s.x + s.len * CM / 2) * view.k + view.tx, (s.y + RH / 2) * view.k + view.ty);
  chime();
  addCard({ L, n, q });
  fitView(true, 780);
  let msg;
  if (s.rows.length === 1)
    msg = whole !== n ? `${whole} pieces of ${fmt(q)} cm + one part of ${fmt(partLen)} cm! 🎉`
        : r === 0 ? `${n} pieces of ${fmt(q)} cm each! Cut again for a new row! ✂️`
        : r >= 0.1 ? `${n} pieces of ${fmt(q)} cm + ${fmt(r)} cm left over! 🎉`
        : `${n} pieces of ${fmt(q)} cm each — the ${fmt(r)} cm leftover is too tiny to see! 🎉`;
  else if (at === s.rows.length - 1)
    msg = `New row of ${fmt(q)} cm pieces — smallest at the bottom! Cut again? ✂️`;
  else
    msg = `${fmt(q)} cm pieces! Bigger rows stay on top 📊`;
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
function snapCm() { // snap to the finest marks the kid can currently see on screen
  const spx = CM * view.k, mm = spx / 10;
  return mm >= 6 ? 0.1 : spx >= 6 ? 1 : spx >= 3 ? 5 : 10;
}
function fireLongPress() {
  pressTimer = null;
  if (pieceDrag || !pressPt) return;
  const s = byId.get(downId);
  if (!s) return;
  const snap = snapCm();
  if (s.len < snap * 2 - 1e-9) { tone(300, 180, .18, 'sawtooth', .07); toast('This piece is too tiny to cut! 🐜'); return; }
  const wx = (pressPt.x - view.tx) / view.k;
  const cm = clamp(Math.round((wx - s.x) / CM / snap) * snap, snap, round2(s.len - snap));
  cancelPreview();
  selId = s.id; scales.forEach(place); hidePieceBar();
  splitPreview = { id: s.id, cm };
  const layer = $('#previewLayer');
  layer.innerHTML = '';
  const g = el('g', {}, layer);
  g.setAttribute('transform', `translate(${s.x} ${s.y})`);
  el('line', { class:'cutline', x1: cm * CM, y1: -6, x2: cm * CM, y2: RH + 6 }, g);
  el('rect', { class:'segTint', x: cm * CM, y: 0, width: s.len * CM - cm * CM, height: RH, rx: 4 }, g);
  $('#confirmText').textContent = `Cut at ${fmt(cm)} cm?`;
  $('#confirmBar').hidden = false;
  startConfirmLoop();
  blip();
  setHint(`Split into ${fmt(cm)} cm and ${fmt(s.len - cm)} cm? Tap the green ✓!`);
}
function confirmSplit() {
  if (!splitPreview) return;
  const s = byId.get(splitPreview.id), a = round2(splitPreview.cm), b = round2(s.len - a), L = s.len;
  cancelPreview();
  snip();
  const row = [];
  for (let i = 0; i < 2; i++) {
    const k = makeScale(i ? b : a, COLORS[colorIdx++ % COLORS.length]);
    k.parentId = s.id; row.push(k);
  }
  // rows stay sorted biggest-first; inside the row, the left piece stays left
  let at = s.rows.findIndex(existing => existing[0].len < a - 1e-9);
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
  setHint(`${fmt(a)} + ${fmt(b)} = ${fmt(L)} cm! Hold another ruler to split it too! ✂️`);
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
function clearOverlayOf(n) {
  n.numG && n.numG.remove(); n.numG = null;
  n.lenEl && n.lenEl.remove(); n.lenEl = null;
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
    tween(360, e2 => { n.y = y0 - 200 * e2; n.pop = 1 - e2; place(n); }, () => { n.g.remove(); clearOverlayOf(n); });
  }, i * 45));
  tone(500, 140, .25, 'sawtooth', .09);
  setHint('Piece removed! 🧹');
  setTimeout(() => fitView(true, 600), 460);
}

/* ---------- math book sheet (mobile) ---------- */
// Mobile: slide-up sheet. Desktop: the side book can be hidden to give the canvas the whole screen.
function bookOff(off) {
  document.body.classList.toggle('bookOff', off);
  setTimeout(syncZoomBtns, 600);
  try { localStorage.setItem('mathBookOff', off ? '1' : ''); } catch (_) {}
  if (!isMobile()) fitView(true, 500);
}
$('#bookBtn').addEventListener('click', () => {
  if (isMobile()) $('#book').classList.toggle('open');
  else bookOff(!document.body.classList.contains('bookOff'));
  blip();
});
$('#bookClose').addEventListener('click', () => {
  if (isMobile()) $('#book').classList.remove('open'); else bookOff(true);
});
try { if (!isMobile() && localStorage.getItem('mathBookOff')) document.body.classList.add('bookOff'); } catch (_) {}

/* ---------- math book cards: the problem resolves step by step ---------- */
const chd = (str, cls = '', base = 0, dt = 45) =>
  `<span class="${cls}">${[...String(str)].map((c, i) =>
    `<span class="ch" style="animation-delay:${Math.round(base + i * dt)}ms">${c}</span>`).join('')}</span>`;
// Long division, digit by digit, exactly as a kid writes it on paper.
function longDivision(L, N, qDecWanted) {
  const ls = fmt(L), dpos = ls.indexOf('.');
  const dp = dpos < 0 ? 0 : ls.length - dpos - 1;
  const D = ls.replace('.', '').split('').map(Number);
  const intLen = D.length - dp;
  const total = D.length + Math.max(0, qDecWanted - dp);
  const steps = [];
  let cur = 0, lead = true;
  for (let i = 0; i < total; i++) {
    const d = i < D.length ? D[i] : 0;
    cur = cur * 10 + d;
    const qd = Math.floor(cur / N), prod = qd * N, rem = cur - prod;
    const skip = lead && qd === 0 && i < intLen - 1;   // leading zeros of the whole-number part
    if (qd > 0) lead = false;
    steps.push({ i, d, chunk: cur, qd, prod, rem, skip, pad: i >= D.length });
    cur = rem;
  }
  return { steps, total, intLen, D };
}

/* The Math Book card: the kid drives the solution. Every press of "Next" reveals ONE
   small thing — pick the digits, ask "how many fit?", subtract — and animated arrows
   show where each number travelled. Stage 0 = the problem alone; last stage = the answer. */
function addCard({ L, n, q }) {
  const card = document.createElement('div');
  card.className = 'card';
  const decN = !Number.isInteger(n);
  const scale = decN ? 10 : 1;                         // 67 ÷ 2.5 → 670 ÷ 25 (make the divisor whole)
  const Ls = round2(L * scale), N = Math.round(n * scale);
  const qs = fmt(q);
  const qDec = qs.includes('.') ? qs.length - qs.indexOf('.') - 1 : 0;
  const { steps, total, intLen, D } = longDivision(Ls, N, qDec);
  const S = steps.filter(st => !st.skip).map((st, j) => ({ ...st, j, a: 1 + 3 * j, b: 2 + 3 * j, c: 3 + 3 * j }));
  const m = S.length, FIN = 3 * m + 1;
  const last = S[m - 1];
  const remInt = last.rem;
  const remTrue = round2(remInt / Math.pow(10, total - intLen) / scale);
  const hasRem = remInt > 0;
  const cw = 'var(--cw)';
  const cell = (ch, col, id, st, cls = '') =>
    `<span class="dc sv ${cls}" data-st="${st}" data-id="${id}${col}">${ch}</span>`;
  const row = (name, start, inner, cls = '') =>
    `<div class="rw ${cls}" data-row="${name}" style="padding-left:calc(${cw}*${start})">${inner}</div>`;

  // dividend: always visible; zeros we add after the decimal point appear at their step
  const dRow = Array.from({ length: total }, (_, k) => {
    const padz = k >= D.length, st = S.find(x => x.i === k);
    return `<span class="dc${k === intLen && k > 0 ? ' dpt' : ''}${padz ? ' padz sv' : ''}" data-id="d${k}"${
      padz && st ? ` data-st="${st.a}"` : ''}>${padz ? 0 : D[k]}</span>`;
  }).join('');

  // quotient cells
  let qCells = '';
  const allZeroInt = steps.every(st => st.i >= intLen || st.qd === 0);
  if (allZeroInt) qCells += `<span class="dc q sv" data-st="${S[0].a}" data-id="qz" style="left:calc(${cw}*${intLen - 1})">0</span>`;
  const ptStep = total > intLen && intLen > 0 ? S.find(x => x.i === intLen) : null;
  if (ptStep) qCells += `<span class="qpt sv" data-st="${ptStep.a}" data-id="qpt" style="left:calc(${cw}*${intLen})">.</span>`;
  S.forEach(st => { qCells += `<span class="dc q sv" data-st="${st.b}" data-id="q${st.i}" style="left:calc(${cw}*${st.i})">${st.qd}</span>`; });

  // the working rows
  let work = '';
  const lines = [];
  S.forEach((st, j) => {
    const prevRem = j > 0 ? String(S[j - 1].rem) : '';
    const Lcells = j === 0 ? st.i + 1 : prevRem.length + 1;
    const ps = String(st.prod);
    work += row(`P${j}`, st.i + 1 - ps.length,
      [...ps].map((ch, k) => cell(ch, st.i + 1 - ps.length + k, `p${j}_`, st.b, k === 0 ? 'first' : '')).join(''), 'prod');
    work += `<div class="rline sv" data-row="line${j}" data-st="${st.b}" style="margin-left:calc(${cw}*${st.i + 1 - Lcells});width:calc(${cw}*${Lcells})"></div>`;
    // the row below the line: this step's remainder (+ the next digit brought down)
    const rs = String(st.rem), e = st.i;
    const nextS = S[j + 1];
    let inner = [...rs].map((ch, k) =>
      cell(ch, e + 1 - rs.length + k, `r${j + 1}_`, st.c, 'rm' + (st.rem === 0 && nextS ? ' z' : ''))).join('');
    let len = rs.length;
    if (nextS) { inner += cell(nextS.d, nextS.i, `r${j + 1}_`, nextS.a, 'br'); len += 1; }
    else inner += hasRem
      ? `<span class="rlab sv" data-st="${st.c}">left over</span>`
      : `<span class="star sv" data-st="${st.c}">⭐</span>`;
    work += row(`R${j + 1}`, e + 1 - rs.length, inner, 'remr');
  });

  // narration, one line per stage
  const nar = [];
  nar[0] = decN
    ? `${fmt(n)} has a decimal point, so make it whole: multiply both numbers by 10 → ${fmt(Ls)} ÷ ${N}. Now press <b>Next</b>!`
    : `Let's share <b>${fmt(L)}</b> into <b>${n}</b> equal parts. Press <b>Next</b> and I'll show every step!`;
  S.forEach((st, j) => {
    const pre = [];
    if (st.i === intLen && intLen > 0 && total > intLen) pre.push('Put a <b>decimal point</b> in the answer.');
    if (j === 0) {
      nar[st.a] = (pre.length ? pre.join(' ') + ' ' : '') + `Look at the first digits: <b>${st.chunk}</b>. They are big enough to share.`;
    } else {
      pre.push(st.pad ? `No digits left! Add a <b>0</b> and bring it down → <b>${st.chunk}</b>.`
                      : `<b>Bring down</b> the ${st.d} → <b>${st.chunk}</b>.`);
      nar[st.a] = pre.join(' ');
    }
    nar[st.b] = `How many ${N}s fit in ${st.chunk}? <b>${st.qd}</b>! Write ${st.qd} on top. Then multiply: <b>${N} × ${st.qd} = ${st.prod}</b>.`;
    nar[st.c] = `<b>Subtract</b>: ${st.chunk} − ${st.prod} = <b>${st.rem}</b>. ` +
      (j === m - 1 ? (st.rem === 0 ? 'Nothing left — all shared! ⭐' : `${st.rem} is left over.`)
                   : (st.rem === 0 ? 'Zero left. On to the next digit.' : `${st.rem} stays and the next digit joins it.`));
  });
  nar[FIN] = `Answer: <b>${fmt(L)} ÷ ${fmt(n)} = ${qs}</b> cm ${hasRem ? `(and ${fmt(remTrue)} left over)` : '🎉'}`;
  const words = nar.map((t, k) => `<div class="nl sv" data-st="${k}"><i>${k === 0 ? '▶' : k === FIN ? '✓' : k}</i><span>${t}</span></div>`).join('');

  card.innerHTML = `
    <div class="eq"><span class="frac"><span class="num">${chd(fmt(L),'a')}</span><span class="bar"></span><span class="den">${chd(fmt(n),'b',225)}</span></span>
      <span class="op">=</span><span class="ans sv" data-st="${FIN}">${hasRem ? `${qs} <small>r ${fmt(remTrue)}</small>` : qs} <small>cm</small> ✨</span><span class="ans q0">?</span></div>
    <div class="words">${words}</div>
    <div class="bracketWrap"><div class="bracket">
      <div class="divisor">${N}${decN ? '<em>×10</em>' : ''}</div>
      <div class="roofbox">
        <div class="wk" style="width:calc(${cw}*${total})">
          <div class="quotient">${qCells}</div>
          <div class="rw dividend" data-row="dv">${dRow}</div>
          ${work}
          <svg class="arrows" aria-hidden="true"><defs><marker id="ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#F2557B"/></marker></defs></svg>
        </div>
      </div>
    </div>
    <div class="ctl">
      <button data-a="restart" title="Start again">⏮</button>
      <button data-a="back" title="Go back one step">◀</button>
      <button class="next" data-a="next">Next ▶</button>
      <button data-a="play" title="Play automatically">⏩</button>
    </div>
    <div class="prog"></div>
    </div>`;

  // ---- the stage engine
  const wk = card.querySelector('.wk'), arrows = card.querySelector('.arrows');
  let stage = 0, timer = null;
  const $q = sel => wk.querySelector(sel);
  const cwPx = () => (wk.querySelector('.dc') || { offsetWidth: 21 }).offsetWidth || 21;
  const rowEl = name => wk.querySelector(`[data-row="${name}"]`);
  const colX = c => (c + .5) * cwPx();
  const NS = 'http://www.w3.org/2000/svg';
  function arrow(d, delay = 0) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d); p.setAttribute('class', 'arr'); p.setAttribute('marker-end', 'url(#ah)');
    p.style.animationDelay = delay + 'ms';
    arrows.appendChild(p);
    const len = p.getTotalLength ? p.getTotalLength() : 60;
    p.style.strokeDasharray = len; p.style.strokeDashoffset = len;
  }
  function drawArrows() {
    [...arrows.querySelectorAll('.arr')].forEach(p => p.remove());
    if (stage < 1 || stage > 3 * m) return;
    const j = Math.floor((stage - 1) / 3), ph = (stage - 1) % 3, st = S[j], W = cwPx();
    const dv = rowEl('dv'), qEl = $q('.quotient');
    const rightLane = total * W + 12;
    const qMid = qEl.offsetTop + qEl.offsetHeight / 2;
    if (ph === 0) {
      if (st.i === intLen && intLen > 0 && total > intLen) {          // decimal point rises to the answer
        const x = intLen * W + 1;
        arrow(`M${x} ${dv.offsetTop + 4} L${x} ${qEl.offsetTop + qEl.offsetHeight + 2}`);
      }
      if (j > 0) {                                                  // bring the digit straight down
        const R = rowEl(`R${j}`), x = colX(st.i);
        arrow(`M${x} ${dv.offsetTop + dv.offsetHeight - 2} L${x} ${R.offsetTop + 3}`, st.i === intLen ? 350 : 0);
      }
    } else if (ph === 1) {
      const srcRow = j === 0 ? dv : rowEl(`R${j}`);
      const sx = (st.i + 1) * W - 1, sy = srcRow.offsetTop + srcRow.offsetHeight / 2;
      const qx = (st.i + 1) * W - 1;
      arrow(`M${sx} ${sy} C${rightLane} ${sy} ${rightLane} ${qMid} ${qx} ${qMid}`);
      const P = rowEl(`P${j}`), py = P.offsetTop + P.offsetHeight / 2, l2 = rightLane + 12;
      arrow(`M${qx} ${qMid + 6} C${l2} ${qMid + 6} ${l2} ${py} ${(st.i + 1) * W - 1} ${py}`, 650);
    } else {
      const ln = rowEl(`line${j}`), R = rowEl(`R${j + 1}`), x = colX(st.i);
      arrow(`M${x} ${ln.offsetTop - 14} L${x} ${R.offsetTop + 4}`);
    }
    arrows.querySelectorAll('.arr').forEach(p => { p.style.animationName = 'arrDraw'; });
  }
  function render() {
    card.querySelectorAll('[data-st]').forEach(e => {
      const v = +e.dataset.st;
      e.classList.toggle('on', v <= stage);
      e.classList.toggle('new', v === stage && stage > 0);
    });
    card.querySelector('.ans.q0').style.display = stage >= FIN ? 'none' : '';
    // highlight the digits we are looking at in the dividend
    wk.querySelectorAll('.dividend .dc').forEach((c, k) => c.classList.toggle('hl', stage === S[0].a && k <= S[0].i));
    card.querySelectorAll('.nl').forEach(e => e.classList.toggle('cur', +e.dataset.st === stage));
    card.querySelector('.prog').textContent = stage === 0 ? `${m} steps to solve` : stage >= FIN ? 'Done! 🎉' : `Step ${Math.floor((stage - 1) / 3) + 1} of ${m}`;
    const nb = card.querySelector('.next');
    nb.textContent = stage >= FIN ? 'Replay ↺' : stage === 0 ? 'Start ▶' : 'Next ▶';
    card.querySelector('[data-a=back]').disabled = stage === 0;
    card.querySelector('[data-a=restart]').disabled = stage === 0;
    drawArrows();
    if (stage > 0) card.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  function go(s2, quiet) {
    stage = clamp(s2, 0, FIN);
    render();
    if (!quiet) tone(520 + stage * 18, 760 + stage * 18, .06, 'sine', .07);
    if (stage >= FIN) { stopPlay(); chime(); }
  }
  function stopPlay() { clearInterval(timer); timer = null; card.querySelector('[data-a=play]').classList.remove('on'); }
  card.addEventListener('click', e => {
    const b = e.target.closest('button[data-a]');
    if (!b) return;
    const a = b.dataset.a;
    if (a === 'next') { stopPlay(); go(stage >= FIN ? 0 : stage + 1); }
    else if (a === 'back') { stopPlay(); go(stage - 1); }
    else if (a === 'restart') { stopPlay(); go(0); }
    else if (a === 'play') {
      if (timer) { stopPlay(); return; }
      if (stage >= FIN) go(0, true);
      b.classList.add('on');
      timer = setInterval(() => { if (!card.isConnected) return stopPlay(); go(stage + 1); }, 2600);
    }
  });
  card.dataset.stages = FIN;
  card._go = go;

  const cards = $('#cards');
  cards.prepend(card);
  while (cards.children.length > 24) cards.lastChild.remove();
  const bc = $('#bookCount');
  bc.hidden = false; bc.textContent = cards.children.length;
  // the book may be hidden right now: say so with a little bounce on its button
  if (document.body.classList.contains('bookOff')) {
    const bb = $('#bookBtn'); bb.classList.remove('ping'); void bb.offsetWidth; bb.classList.add('ping');
  }
  setTimeout(() => render(), 650);   // measure arrows once the card has finished sliding in
  render();
}
// a long-press split isn't division — it's a number-decomposition story
function addSplitCard({ L, a, b }) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <div class="eq">${chd(fmt(L),'a')}${chd('=','op',135)}${chd(fmt(a),'b',225)}${chd('+','op',450)}${chd(fmt(b),'q',540)}<small>${chd('cm','',780,40)}</small><span class="rem zero">${chd('✨', '', 920)}</span></div>
    <div class="splitNote">${chd('split at ' + fmt(a) + ' cm', '', 1050, 30)}</div>`;
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
      () => { s.g.remove(); clearOverlayOf(s); }), i * 40);
  });
  chime();
  setTimeout(() => { initWorld(true); fitView(true); }, old.length * 40 + 380);
  setHint('Fresh start! ✨');
}

/* ---------- world init & intro ---------- */
function initWorld(drop) {
  CM = 6; // 100 cm ruler → the classic 6 px/cm canvas
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
