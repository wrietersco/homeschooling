<script setup>
// The STUDIO's globe editor: the superadmin sees the planet — with real
// country borders — and every pinned place on it. Pins can be dragged to a
// new position (an optional correction: by default the system pre-saves each
// place's coordinates from the gazetteer), and clicking a pin opens its editor
// row. Dragging the planet itself spins it; buttons/wheel zoom.
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  ZOOM_MAX, ZOOM_MIN, clampRotation, clampZoom, decimalsForZoom, dragRates, focusZoomForLevel, formatLatLng,
  formatSpan, projectSpot, screenToLatLng, spanKmAtZoom, zoomFactor,
} from "@/lib/wikido/globe/projection";
import { DEEP_RADIUS, drawGlobe } from "@/lib/wikido/globe/render";
import OsmAttribution from "@/components/wikido/OsmAttribution.vue";

const props = defineProps({
  spots: { type: Array, default: () => [] }, // hub hotspots (lat/lng doorways)
  selectedId: { type: String, default: "" },
  // catalog places the system knows but this globe has not added yet — drawn as
  // faint dots at their known coordinates; clicking one adds it (switched off)
  ghosts: { type: Array, default: () => [] },
  // zoom used when the editor opens already facing a selected pin; 0 = pick by
  // the pin's kind (continent / country / city / landmark)
  focusZoom: { type: Number, default: 0 },
});
const emit = defineEmits(["select", "relocate", "add-place", "view"]);
const RADIUS_FACTOR = 0.42;

const rot = ref(clampRotation({ lambda: 70, phi: 22 }));
const zoom = ref(ZOOM_MIN);
const wrapEl = ref(null);
const canvasEl = ref(null);
const size = ref({ w: 0, h: 0 });
const borders = ref(null); // lazy Natural Earth outlines (stylized until then)
const readout = ref("");

let ctx = null;
let needsDraw = true;
let ro = null;
let raf = 0;

import("@/lib/wikido/globe/borders.js")
  .then((m) => {
    borders.value = m.COUNTRY_BORDERS;
    needsDraw = true;
  })
  .catch(() => { /* the stylized fallback is already on screen */ });

function globeRadius() {
  const { w, h } = size.value;
  return Math.max(10, Math.min(w, h) * RADIUS_FACTOR * Math.sqrt(zoom.value));
}

function geometry() {
  const { w, h } = size.value;
  return { cx: w / 2, cy: h / 2, r: globeRadius() };
}

// a pin far outside the window (deep zoom flings it millions of pixels away) is
// not drawn — except the one being dragged
const dragId = ref("");
function nearWindow(p, w, h, id) {
  return id === dragId.value || (p.x > -150 && p.x < w + 150 && p.y > -150 && p.y < h + 150);
}

// pin numbers follow the studio's places list (doorway order), not depth
const numbering = computed(() => new Map(props.spots.map((s, i) => [s.id, i + 1])));

// every pin, front hemisphere only, far first
const placed = computed(() => {
  const { w, h } = size.value;
  if (!w || !h) return [];
  const { cx, cy, r } = geometry();
  return props.spots
    .filter((s) => Number.isFinite(+s.lat) && Number.isFinite(+s.lng))
    .map((spot) => {
      const p = projectSpot(+spot.lat, +spot.lng, rot.value, { cx, cy, r });
      return { spot, ...p };
    })
    .filter((p) => p.visible && nearWindow(p, w, h, p.spot.id))
    .sort((a, b) => a.depth - b.depth);
});

// how wide the window is, once zoomed in far enough to matter
const scaleLabel = computed(() => {
  const { w, h } = size.value;
  if (!w || zoom.value < 300) return "";
  return `≈ ${formatSpan(spanKmAtZoom(zoom.value, Math.min(w, h), RADIUS_FACTOR))} across`;
});

const levelClass = (level) => `lvl-${level || "city"}`;

// the not-yet-added catalog places on the visible hemisphere (far first)
const ghostsPlaced = computed(() => {
  const { w, h } = size.value;
  if (!w || !h) return [];
  const { cx, cy, r } = geometry();
  const taken = new Set(props.spots.map((s) => s.id));
  return props.ghosts
    .filter((place) => !taken.has(place.spotId))
    .map((place) => ({ place, ...projectSpot(+place.lat, +place.lng, rot.value, { cx, cy, r }) }))
    .filter((p) => p.visible && nearWindow(p, w, h, ""))
    .sort((a, b) => a.depth - b.depth);
});

// ── drawing ───────────────────────────────────────────────────────────────────
const tilesShown = ref(false);
function draw() {
  const g = ctx;
  const { w, h } = size.value;
  if (!g || !w || !h) return;
  const { cx, cy, r } = geometry();
  tilesShown.value = r > DEEP_RADIUS;
  const rings = placed.value
    .filter((p) => p.spot.level !== "country" && p.spot.level !== "continent")
    .map((p) => ({ x: p.x, y: p.y, radius: Math.min(11 * Math.sqrt(zoom.value), 28), opacity: 1 }));
  drawGlobe(g, { w, h, rot: rot.value, r }, {
    borders: borders.value, rings, dpr: window.devicePixelRatio || 1, onTile: () => { needsDraw = true; },
  });
}

function frame() {
  if (anim) stepRotationAnim();
  if (needsDraw) {
    needsDraw = false;
    draw();
  }
  raf = requestAnimationFrame(frame);
}

// ── resize ────────────────────────────────────────────────────────────────────
function resize() {
  const el = wrapEl.value;
  const canvas = canvasEl.value;
  if (!el || !canvas) return;
  const w = el.clientWidth;
  const h = el.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  try {
    ctx = canvas.getContext ? canvas.getContext("2d") : null;
  } catch {
    ctx = null; // jsdom has no canvas — the DOM overlay still works
  }
  size.value = { w, h };
  needsDraw = true;
}

// ── interaction ───────────────────────────────────────────────────────────────
const pointers = new Map();
let pinch = null;
let drag = null; // planet spin
let pinDrag = null; // pin relocation
const dragging = ref(false);

function onPointerDown(e) {
  if (e.target.closest?.(".wd-e-btn")) return; // zoom buttons keep their taps
  e.target.setPointerCapture?.(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: zoom.value };
    drag = null;
    return;
  }
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY, lambda: rot.value.lambda, phi: rot.value.phi, moved: false };
}

function onPointerMove(e) {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch.dist > 0) zoomTo(pinch.zoom * Math.pow(dist / pinch.dist, Math.log10(Math.max(1, pinch.zoom)) > 2 ? 3 : 1.5));
    return;
  }
  if (pinDrag && e.pointerId === pinDrag.id) {
    const rect = canvasEl.value.getBoundingClientRect();
    const { cx, cy, r } = geometry();
    const { lat, lng } = screenToLatLng(e.clientX - rect.left, e.clientY - rect.top, rot.value, { cx, cy, r });
    pinDrag.moved = true;
    pinDrag.lat = Math.round(lat * 1e6) / 1e6; // ~0.1 m: accurate even at the deepest zoom
    pinDrag.lng = Math.round(lng * 1e6) / 1e6;
    readout.value = `${pinDrag.spot.label}: ${formatLatLng(lat, lng, Math.max(4, decimalsForZoom(zoom.value)))} — unsaved`;
    emit("relocate", pinDrag.spot.id, pinDrag.lat, pinDrag.lng);
    needsDraw = true;
    return;
  }
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < 5) return;
  drag.moved = true;
  dragging.value = true;
  const k = dragRates(zoom.value, drag.phi);
  rot.value = clampRotation({ lambda: drag.lambda - dx * k.lng, phi: drag.phi + dy * k.lat });
  needsDraw = true;
}

function onPointerUp(e) {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (pinDrag && e.pointerId === pinDrag.id) {
    const movedPin = pinDrag;
    pinDrag = null;
    dragId.value = "";
    if (!movedPin.moved) emit("select", movedPin.spot.id);
    return;
  }
  if (drag && e.pointerId === drag.id) {
    if (!drag.moved) dragging.value = false;
    drag = null;
  }
}

// A planet-drag must not also tap through to a pin underneath.
function onClickCapture(e) {
  if (!dragging.value) return;
  dragging.value = false;
  e.stopPropagation();
  e.preventDefault();
}

function startPinDrag(e, spot) {
  e.stopPropagation();
  e.target.setPointerCapture?.(e.pointerId);
  pinDrag = { id: e.pointerId, spot, moved: false };
  dragId.value = spot.id;
}

function onWheel(e) {
  e.preventDefault();
  const f = zoomFactor(zoom.value, 1.13);
  zoomTo(zoom.value * (e.deltaY < 0 ? f : 1 / f));
}

function zoomTo(target) {
  zoom.value = clampZoom(target);
  needsDraw = true;
  emit("view", { zoom: zoom.value, decimals: decimalsForZoom(zoom.value) });
}

// the zoom that suits a place of this kind (continent … landmark)
function focusZoomFor(spot) {
  if (props.focusZoom > 0) return clampZoom(props.focusZoom);
  const { w, h } = size.value;
  return focusZoomForLevel(spot?.level, Math.min(w, h) || 400, RADIUS_FACTOR);
}

// glide to a pin AND zoom to its level; asking again from there goes deeper
function zoomToSpot(spot) {
  if (!spot || !Number.isFinite(+spot.lat) || !Number.isFinite(+spot.lng)) return;
  const want = focusZoomFor(spot);
  const deeper = zoom.value >= want * 0.9 ? zoom.value * zoomFactor(zoom.value, 1.35) ** 3 : want;
  animateRotationTo({ lambda: +spot.lng, phi: +spot.lat }, clampZoom(deeper));
}
function zoomToSelected() {
  zoomToSpot(props.spots.find((s) => s.id === props.selectedId));
}
function zoomStep(dir) {
  const f = zoomFactor(zoom.value, 1.35);
  zoomTo(zoom.value * (dir > 0 ? f : 1 / f));
}
function resetView() {
  zoomTo(ZOOM_MIN);
  animateRotationTo({ lambda: 70, phi: 22 });
}

// glide a chosen pin to the front when it is selected from the list
let anim = null;
watch(
  () => props.selectedId,
  (id) => {
    const spot = props.spots.find((s) => s.id === id);
    if (spot && Number.isFinite(+spot.lat)) animateRotationTo({ lambda: +spot.lng, phi: +spot.lat });
  }
);
function animateRotationTo(target, zoomTarget) {
  const from = { ...rot.value };
  const to = clampRotation(target);
  let dLambda = to.lambda - from.lambda;
  if (dLambda > 180) dLambda -= 360;
  if (dLambda < -180) dLambda += 360;
  const z0 = zoom.value;
  const z1 = zoomTarget ? clampZoom(zoomTarget) : z0;
  anim = { from, dLambda, dPhi: to.phi - from.phi, t: 0, z0, z1, step: z1 === z0 ? 0.055 : 0.03 };
}
function stepRotationAnim() {
  const a = anim;
  a.t = Math.min(1, a.t + a.step);
  const e = a.t < 0.5 ? 2 * a.t * a.t : 1 - Math.pow(-2 * a.t + 2, 2) / 2;
  if (a.z1 !== a.z0) zoomTo(Math.exp(Math.log(a.z0) + (Math.log(a.z1) - Math.log(a.z0)) * e));
  rot.value = clampRotation({ lambda: a.from.lambda + a.dLambda * e, phi: a.from.phi + a.dPhi * e });
  needsDraw = true;
  if (a.t >= 1) anim = null;
}

defineExpose({ setZoom: zoomTo, zoom, rot, resize });

onMounted(() => {
  resize();
  // opened with a pin already chosen (the add-a-place wizard): start facing it
  const focus = props.spots.find((s) => s.id === props.selectedId);
  if (focus && Number.isFinite(+focus.lat) && Number.isFinite(+focus.lng)) {
    rot.value = clampRotation({ lambda: +focus.lng, phi: +focus.lat });
    zoom.value = focusZoomFor(focus);
    emit("view", { zoom: zoom.value, decimals: decimalsForZoom(zoom.value) });
  }
  if (typeof ResizeObserver !== "undefined") {
    ro = new ResizeObserver(resize);
    ro.observe(wrapEl.value);
  }
  raf = requestAnimationFrame(frame);
});
onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  ro?.disconnect();
});
</script>

<template>
  <div ref="wrapEl" class="wd-e" :class="{ 'has-open': Boolean(selectedId) }">
    <canvas ref="canvasEl" class="wd-e-planet" @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp" @pointercancel="onPointerUp" @wheel="onWheel" @click.capture="onClickCapture"></canvas>
    <OsmAttribution :show="tilesShown" />

    <!-- every continent/country the system knows but this globe hasn't added:
         a faint dot already sitting at its real coordinates. Click to add it. -->
    <button
      v-for="g in ghostsPlaced"
      :key="`ghost-${g.place.spotId}`"
      type="button"
      class="wd-e-ghost"
      :class="levelClass(g.place.level)"
      :style="{ left: `${g.x}px`, top: `${g.y}px`, zIndex: 2 + Math.round(g.depth * 10) }"
      :aria-label="`Add ${g.place.name} to the globe (switched off until it has scenes)`"
      :title="`${g.place.name} — ${formatLatLng(+g.place.lat, +g.place.lng)}. Click to add it (switched off).`"
      @click.stop="emit('add-place', g.place.spotId)"
    ></button>

    <!-- pinned places; drag one to relocate, click to open its editor row -->
    <button
      v-for="(p, i) in placed"
      :key="p.spot.id"
      type="button"
      class="wd-e-pin"
      :class="[levelClass(p.spot.level), { selected: p.spot.id === selectedId, off: p.spot.enabled === false }]"
      :style="{ left: `${p.x}px`, top: `${p.y}px`, zIndex: 5 + Math.round(p.depth * 20) }"
      :aria-label="`Spot ${numbering.get(p.spot.id)}: ${p.spot.label}${p.spot.enabled === false ? ' (switched off)' : ''} — drag to relocate`"
      :title="`${p.spot.label} — ${formatLatLng(+p.spot.lat, +p.spot.lng)} (${p.spot.level}${p.spot.enabled === false ? ', switched off' : ''}). Drag to relocate; double-click to zoom in.`"
      @pointerdown="startPinDrag($event, p.spot)"
      @dblclick.stop="zoomToSpot(p.spot)"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >{{ numbering.get(p.spot.id) }}</button>

    <div class="wd-e-tools" role="group" aria-label="Editor globe zoom">
      <button v-if="selectedId" type="button" class="wd-e-btn" aria-label="Zoom to this pin" title="Zoom to this pin (double-clicking a pin does the same)" @click="zoomToSelected"><span class="material-symbols-rounded">my_location</span></button>
      <button type="button" class="wd-e-btn" aria-label="Zoom in" :disabled="zoom >= ZOOM_MAX" @click="zoomStep(1)"><span class="material-symbols-rounded">add</span></button>
      <button type="button" class="wd-e-btn" aria-label="Zoom out" :disabled="zoom <= ZOOM_MIN" @click="zoomStep(-1)"><span class="material-symbols-rounded">remove</span></button>
      <button type="button" class="wd-e-btn" aria-label="Reset view" title="Back to the whole Earth" @click="resetView"><span class="material-symbols-rounded">public</span></button>
    </div>
    <p class="wd-e-readout" role="status">{{ readout || scaleLabel }}</p>
  </div>
</template>

<style scoped>
.wd-e { position: relative; width: 100%; aspect-ratio: 1 / 1; max-height: 460px; overflow: hidden; border-radius: 14px; background: radial-gradient(120% 100% at 50% 0%, #241548 0%, #191033 60%, #0D0719 100%); }
.wd-e-planet { position: absolute; inset: 0; touch-action: none; cursor: grab; }
.wd-e-planet:active { cursor: grabbing; }

.wd-e-pin {
  position: absolute;
  transform: translate(-50%, -50%);
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 3px solid #fff;
  background: #7C3AED;
  color: #fff;
  font-weight: 800;
  font-size: 0.72rem;
  font-family: inherit;
  cursor: grab;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45);
  display: grid;
  place-items: center;
  padding: 0;
  touch-action: none;
}
.wd-e-pin:active { cursor: grabbing; }
.wd-e-pin.lvl-city { background: #0D9488; }
.wd-e-pin.lvl-location { background: #EA580C; }
.wd-e-pin.lvl-continent { background: #BE185D; }
/* a place that is known but switched off: hollow and dim, never on the kids' globe */
.wd-e-pin.off { background: rgba(30, 18, 52, .75); border-style: dashed; opacity: 0.8; }

.wd-e-ghost {
  position: absolute;
  transform: translate(-50%, -50%);
  width: 11px;
  height: 11px;
  padding: 0;
  border-radius: 50%;
  border: 1.5px solid rgba(255, 255, 255, .55);
  background: rgba(255, 255, 255, .14);
  cursor: pointer;
}
.wd-e-ghost.lvl-continent { width: 15px; height: 15px; border-color: rgba(244, 114, 182, .9); background: rgba(190, 24, 93, .25); }
.wd-e-ghost:hover { background: rgba(253, 230, 138, .75); border-color: #FDE68A; }
.wd-e-pin.selected { box-shadow: 0 0 0 4px rgba(124, 58, 237, 0.45), 0 2px 8px rgba(0, 0, 0, 0.4); transform: translate(-50%, -50%) scale(1.15); }

.wd-e-tools { position: absolute; right: 10px; bottom: 10px; display: flex; flex-direction: column; gap: 0.35rem; }
.wd-e-btn {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 1.5px solid rgba(255, 255, 255, .4);
  background: rgba(30, 18, 52, .68);
  color: #FFF7EA;
  cursor: pointer;
  font-family: inherit;
}
.wd-e-btn:hover:not(:disabled) { background: rgba(76, 29, 149, .85); }
.wd-e-btn:disabled { opacity: 0.35; cursor: default; }
.wd-e-btn .material-symbols-rounded { font-size: 20px; }

.wd-e-readout {
  position: absolute;
  left: 10px;
  bottom: 10px;
  margin: 0;
  max-width: 70%;
  padding: 0.3rem 0.6rem;
  border-radius: 8px;
  background: rgba(20, 10, 40, .8);
  color: #FDE68A;
  font-size: 0.75rem;
  font-weight: 700;
  pointer-events: none;
}
.wd-e-readout:empty { display: none; }
</style>
