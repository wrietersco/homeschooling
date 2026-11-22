// Pure math for the Wikido 3D globe: orthographic projection of lat/lng onto a
// spinning sphere, and the zoom thresholds that decide which spot levels are
// visible. No DOM, no canvas — everything here unit-tests directly.

export const DEG = Math.PI / 180;
export const ZOOM_MIN = 1;
// Zoom is a squared magnification: the globe's radius on screen grows with
// sqrt(zoom). 2e9 ⇒ ~45,000× the whole-Earth view, i.e. a ~350 m wide window
// on a phone-sized map — one landmark fills the screen.
export const ZOOM_MAX = 2e9;
export const EARTH_RADIUS_KM = 6371;

// Zoom threshold per spot level. The globe opens at country level; zooming in
// once reveals city spots, once more reveals location spots (landmarks).
export const LEVEL_ZOOM = { country: 1, city: 2.2, location: 3.8 };

// Continent pins are the widest layer: a globe that has any shows them at the
// fully zoomed-out view, and country pins then wait until this zoom to appear
// (a globe with no continent pins is unchanged — countries show from the start).
export const COUNTRY_ZOOM_WITH_CONTINENTS = 1.7;

export const SPOT_LEVELS = ["continent", "country", "city", "location"];

// 0 at country-scale zooms → 1 once zoomed far in (about zoom 3000+). Drives the
// things that must change smoothly with depth: bigger zoom steps, drag speed.
export function deepWeight(zoom) {
  const t = (Math.log10(Math.max(1, Number(zoom) || 1)) - 0.5) / 3;
  return Math.min(1, Math.max(0, t));
}

// Logarithmic zoom steps: a button click / wheel notch / pinch multiplies the
// zoom by `base` at world scale and by base³ deep down, so ~25 clicks span the
// whole range instead of ~70.
export function zoomFactor(zoom, base) {
  return Math.pow(base, 1 + 2 * deepWeight(zoom));
}

// Drag speed (degrees per pixel) so the ground tracks the finger: slower as
// you zoom in, and longitude is stretched by 1/cos(lat) once zoomed in (the
// view is near-flat there, a degree of longitude is shorter away from the
// equator).
export function dragRates(zoom, phi) {
  const k = 0.2495 / Math.sqrt(Math.max(1, zoom));
  const w = deepWeight(zoom);
  const cos = Math.max(0.15, Math.cos((Number(phi) || 0) * DEG));
  return { lng: k * (1 + (1 / cos - 1) * w), lat: k };
}

// ── zoom ⇄ real-world scale ───────────────────────────────────────────────────
// `radiusFactor` is the editor/explorer's fraction of the shorter canvas side
// used as the globe radius at zoom 1 (0.42 / 0.38).
export function pixelsPerKm(zoom, minDim, radiusFactor) {
  return (minDim * radiusFactor * Math.sqrt(zoom)) / EARTH_RADIUS_KM;
}
export function spanKmAtZoom(zoom, minDim, radiusFactor) {
  return minDim / pixelsPerKm(zoom, minDim, radiusFactor);
}
export function zoomForSpanKm(km, minDim, radiusFactor) {
  const ppk = minDim / Math.max(0.01, km);
  const z = Math.pow((ppk * EARTH_RADIUS_KM) / (minDim * radiusFactor), 2);
  return clampZoom(z);
}
export function formatSpan(km) {
  if (km >= 1000) return `${Math.round(km / 100) * 100} km`;
  if (km >= 10) return `${Math.round(km)} km`;
  if (km >= 1) return `${km.toFixed(1)} km`;
  return `${Math.round(km * 1000)} m`;
}
// How wide a view should be when we zoom TO a place of this level.
export const FOCUS_SPAN_KM = { continent: 9000, country: 1800, city: 30, location: 1.2 };
export function focusZoomForLevel(level, minDim = 400, radiusFactor = 0.42) {
  const km = FOCUS_SPAN_KM[level] ?? FOCUS_SPAN_KM.city;
  // continents/countries never zoom closer than the whole-planet view allows
  return Math.max(ZOOM_MIN * 1.4, zoomForSpanKm(km, minDim, radiusFactor));
}
// Decimals worth showing for a lat/lng at this zoom (1 ≈ 11 km … 6 ≈ 0.1 m).
export function decimalsForZoom(zoom) {
  const z = Number(zoom) || 1;
  if (z < 20) return 1;
  if (z < 300) return 2;
  if (z < 3e4) return 3;
  if (z < 3e6) return 4;
  if (z < 3e8) return 5;
  return 6;
}

export function clampZoom(z) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(z) || ZOOM_MIN));
}

// λ wraps to −180…180; φ stops just short of the poles so the spin never flips.
export function clampRotation(rot) {
  let lambda = ((Number(rot?.lambda) || 0) + 180) % 360;
  if (lambda < 0) lambda += 360;
  lambda -= 180;
  const phi = Math.min(85, Math.max(-85, Number(rot?.phi) || 0));
  return { lambda, phi };
}

// Unit vector of a lat/lng in the CAMERA frame. rot = { lambda, phi } is the
// geographic point currently facing the viewer; z > 0 is the visible
// hemisphere, z ≤ 0 is around the back.
export function latLngToVec3(lat, lng, rot = { lambda: 0, phi: 0 }) {
  const lam = (Number(lng) - rot.lambda) * DEG;
  const phiRad = Number(lat) * DEG;
  const rotPhi = (Number(rot.phi) || 0) * DEG;
  const cosPhi = Math.cos(phiRad);
  const x = cosPhi * Math.sin(lam);
  const y = Math.sin(phiRad);
  const z = cosPhi * Math.cos(lam);
  const c = Math.cos(rotPhi);
  const s = Math.sin(rotPhi);
  return { x, y: y * c - z * s, z: y * s + z * c };
}

// Screen position of a unit vector on a globe of radius r centred at (cx, cy).
export function projectVec(v, cx, cy, r) {
  return { x: cx + v.x * r, y: cy - v.y * r, z: v.z };
}

// Everything the globe layer needs to place one spot: screen position, whether
// it is on the visible hemisphere, and z (depth — nearer spots draw on top).
export function projectSpot(lat, lng, rot, { cx, cy, r }) {
  const v = latLngToVec3(lat, lng, rot);
  const p = projectVec(v, cx, cy, r);
  return { x: p.x, y: p.y, z: v.z, visible: v.z > 0, depth: v.z };
}

// The inverse: a screen position back to lat/lng (the pin-drag relocation in
// the studio). Points beyond the limb are clamped onto it, so a dragged pin
// never flips to the far side. Only the front hemisphere is addressable.
export function screenToLatLng(sx, sy, rot, { cx, cy, r }) {
  let x = (Number(sx) - cx) / r;
  let y = -(Number(sy) - cy) / r;
  const d2 = x * x + y * y;
  if (d2 > 1) {
    const k = 1 / Math.sqrt(d2);
    x *= k;
    y *= k;
  }
  const z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
  // undo the camera tilt around the x-axis
  const c = Math.cos((Number(rot?.phi) || 0) * DEG);
  const s = Math.sin((Number(rot?.phi) || 0) * DEG);
  const y1 = y * c + z * s;
  const z1 = -y * s + z * c;
  const lat = Math.asin(Math.max(-1, Math.min(1, y1))) / DEG;
  let lng = Math.atan2(x, z1) / DEG + (Number(rot?.lambda) || 0);
  lng = ((lng + 180) % 360 + 360) % 360 - 180;
  return { lat, lng };
}

// Normalized linear blend of two unit vectors (exact enough for tiny segments).
function mixVec(a, b, t) {
  const x = a.x + (b.x - a.x) * t;
  const y = a.y + (b.y - a.y) * t;
  const z = a.z + (b.z - a.z) * t;
  const len = Math.hypot(x, y, z) || 1;
  return { x: x / len, y: y / len, z: z / len };
}

// Where a visible→hidden segment crosses the horizon (z = 0), as a blend factor
// from a toward b. a must be visible (z > 0), b hidden (z ≤ 0). Bisection keeps
// it stable without a closed form over the normalization.
export function horizonBlend(a, b) {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i += 1) {
    const mid = (lo + hi) / 2;
    if (mixVec(a, b, mid).z > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// ── zoom-based level of detail ────────────────────────────────────────────────
// The layers are EXCLUSIVE: each spot level owns a zoom band and the parent
// layer hides inside it. Zoomed out you see countries; zoom into a country's
// band and its pin fades away, replaced by that country's city pins; zoom
// again and only landmark pins remain. A level fades in during the last
// stretch before its threshold and fades out as the next layer takes over.
const FADE = 0.4;

function smoothstep(t) {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

// The zoom at which a level's layer begins. `continents` says the globe has
// continent pins, which pushes the country layer out to make room for them.
function enterZoom(level, continents) {
  if (level === "continent") return ZOOM_MIN;
  if (level === "country" && continents) return COUNTRY_ZOOM_WITH_CONTINENTS;
  return LEVEL_ZOOM[level] ?? ZOOM_MIN;
}

// The zoom at which the NEXT deeper layer takes over (Infinity for the last).
export function nextLevelZoom(level, { continents = false } = {}) {
  if (level === "continent") return COUNTRY_ZOOM_WITH_CONTINENTS;
  if (level === "country") return LEVEL_ZOOM.city;
  if (level === "city") return LEVEL_ZOOM.location;
  return Infinity;
}

// How visible a spot level is at this zoom: 0 (hidden) … 1 (fully shown).
// Pass { continents: true } when the globe carries continent pins.
export function spotOpacityAtZoom(level, zoom, { continents = false } = {}) {
  const enter = enterZoom(level, continents);
  const fadeIn = enter <= ZOOM_MIN ? 1 : smoothstep((zoom - (enter - FADE)) / FADE);
  const exit = nextLevelZoom(level, { continents });
  const fadeOut = exit === Infinity ? 1 : 1 - smoothstep((zoom - (exit - FADE)) / FADE);
  return Math.min(fadeIn, fadeOut);
}

export function levelVisibleAtZoom(level, zoom, opts) {
  return spotOpacityAtZoom(level, zoom, opts) > 0.001;
}

// The layer the child is currently "inside": the deepest fully-shown level.
export function currentLevelAtZoom(zoom, { continents = false } = {}) {
  if (zoom >= LEVEL_ZOOM.location) return "location";
  if (zoom >= LEVEL_ZOOM.city) return "city";
  if (continents && zoom < COUNTRY_ZOOM_WITH_CONTINENTS) return "continent";
  return "country";
}

// Readable coordinate readout for the studio: 31.5°N, 74.3°E
export function formatLatLng(lat, lng, decimals = 1) {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lng >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(decimals)}°${ns}, ${Math.abs(lng).toFixed(decimals)}°${ew}`;
}
