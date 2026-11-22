// Canvas rendering for the Wikido 3D globe — shared by the child explorer
// (WikidoGlobe) and the superadmin studio editor (WikidoGlobeEditor), so both
// draw the identical planet: ocean, graticule, country borders (real Natural
// Earth outlines when the lazy borders dataset is loaded; a stylized fallback
// until then), limb shading and the place pins' boundary rings.
import { latLngToVec3, projectVec, horizonBlend, screenToLatLng, DEG } from "./projection";
import { LANDMASSES } from "./land";
import {
  TILE_ATTRIBUTION, TILE_PX, getTile, latToTileY, lngToTileX, tileLat, tileLng, tileZoomFor,
} from "./tiles";

// Past this globe radius (px) canvas coordinates get too large to trust: the
// planet disc, gradients and country polygons are then drawn clipped to the
// viewport ("deep" mode), and street-level map tiles fade in over the land.
export const DEEP_RADIUS = 6000;

// Normalized blend of two unit vectors (exact enough for tiny segments).
export function mix(a, b, t) {
  const x = a.x + (b.x - a.x) * t;
  const y = a.y + (b.y - a.y) * t;
  const z = a.z + (b.z - a.z) * t;
  const len = Math.hypot(x, y, z) || 1;
  return { x: x / len, y: y / len, z: z / len };
}

// Build the vec3 ring for a lat/lng polyline. Consecutive longitudes are
// unfolded ±360 so antimeridian-crossing rings stay whole.
export function ringVecs(list, rot) {
  const vecs = [];
  let prevLng = null;
  for (const [lng0, lat] of list) {
    let lng = lng0;
    if (prevLng !== null) {
      while (lng - prevLng > 180) lng -= 360;
      while (lng - prevLng < -180) lng += 360;
    }
    prevLng = lng;
    vecs.push(latLngToVec3(lat, lng, rot));
  }
  return vecs;
}

// Trace an open polyline, cutting at the horizon (visible→hidden edges leave
// the path at the limb; hidden→visible edges re-enter it).
export function strokeSegments(g, vecs, cx, cy, r) {
  let penDown = false;
  for (let i = 0; i < vecs.length - 1; i += 1) {
    const a = vecs[i];
    const b = vecs[i + 1];
    const aV = a.z > 0;
    const bV = b.z > 0;
    if (aV && bV) {
      const p = projectVec(a, cx, cy, r);
      if (!penDown) { g.moveTo(p.x, p.y); penDown = true; }
      else g.lineTo(p.x, p.y);
    } else if (aV && !bV) {
      const q = projectVec(mix(a, b, horizonBlend(a, b)), cx, cy, r);
      if (penDown) g.lineTo(q.x, q.y);
      else g.moveTo(q.x, q.y);
      penDown = false;
    } else if (!aV && bV) {
      const q = projectVec(mix(b, a, horizonBlend(b, a)), cx, cy, r);
      g.moveTo(q.x, q.y);
      penDown = true;
    }
  }
}

// ── deep-zoom clipping ────────────────────────────────────────────────────────
// Sutherland–Hodgman against the (padded) viewport, for closed fills.
function clipPolygon(pts, x0, y0, x1, y1) {
  let out = pts;
  const edges = [
    [(p) => p.x >= x0, (a, b) => ({ x: x0, y: a.y + ((b.y - a.y) * (x0 - a.x)) / (b.x - a.x) })],
    [(p) => p.x <= x1, (a, b) => ({ x: x1, y: a.y + ((b.y - a.y) * (x1 - a.x)) / (b.x - a.x) })],
    [(p) => p.y >= y0, (a, b) => ({ y: y0, x: a.x + ((b.x - a.x) * (y0 - a.y)) / (b.y - a.y) })],
    [(p) => p.y <= y1, (a, b) => ({ y: y1, x: a.x + ((b.x - a.x) * (y1 - a.y)) / (b.y - a.y) })],
  ];
  for (const [inside, cut] of edges) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i += 1) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      if (inside(cur)) {
        if (!inside(prev)) out.push(cut(prev, cur));
        out.push(cur);
      } else if (inside(prev)) {
        out.push(cut(prev, cur));
      }
    }
    if (!out.length) break;
  }
  return out;
}

// Liang–Barsky: the part of segment a→b inside the box, or null.
function clipSegment(a, b, x0, y0, x1, y1) {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x - x0, x1 - a.x, a.y - y0, y1 - a.y];
  for (let i = 0; i < 4; i += 1) {
    if (p[i] === 0) {
      if (q[i] < 0) return null;
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) {
        if (t > t1) return null;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return null;
        if (t < t1) t1 = t;
      }
    }
  }
  return [{ x: a.x + t0 * dx, y: a.y + t0 * dy }, { x: a.x + t1 * dx, y: a.y + t1 * dy }];
}

// Visible sub-polylines of a vec3 ring (cut at the horizon) as screen points.
function ringSubpaths(vecs, cx, cy, r) {
  const paths = [];
  let cur = null;
  const push = (v) => {
    const p = projectVec(v, cx, cy, r);
    if (!cur) { cur = []; paths.push(cur); }
    cur.push({ x: p.x, y: p.y });
  };
  for (let i = 0; i < vecs.length - 1; i += 1) {
    const a = vecs[i];
    const b = vecs[i + 1];
    const aV = a.z > 0;
    const bV = b.z > 0;
    if (aV && bV) {
      if (!cur) push(a);
      push(b);
    } else if (aV && !bV) {
      if (!cur) push(a);
      push(mix(a, b, horizonBlend(a, b)));
      cur = null;
    } else if (!aV && bV) {
      cur = null;
      push(mix(b, a, horizonBlend(b, a)));
      push(b);
    }
  }
  return paths;
}

// One polygon at deep zoom: fill (clipped, even-odd) + stroke (clipped segments).
function drawPolygonDeep(g, rings, cx, cy, r, rot, box) {
  const [x0, y0, x1, y1] = box;
  const subs = [];
  for (const ring of rings) subs.push(...ringSubpaths(ringVecs(ring, rot), cx, cy, r));
  g.beginPath();
  let any = false;
  for (const path of subs) {
    if (path.length < 3) continue;
    const clipped = clipPolygon(path, x0, y0, x1, y1);
    if (clipped.length < 3) continue;
    any = true;
    g.moveTo(clipped[0].x, clipped[0].y);
    for (let i = 1; i < clipped.length; i += 1) g.lineTo(clipped[i].x, clipped[i].y);
    g.closePath();
  }
  if (any) g.fill("evenodd");
  // borders: per-segment clipping, so the clip box adds no false edges
  g.beginPath();
  for (const path of subs) {
    for (let i = 0; i < path.length - 1; i += 1) {
      const seg = clipSegment(path[i], path[i + 1], x0, y0, x1, y1);
      if (!seg) continue;
      g.moveTo(seg[0].x, seg[0].y);
      g.lineTo(seg[1].x, seg[1].y);
    }
  }
  g.stroke();
}

// Lay the street-map tiles over the view. Each tile is placed with an affine
// transform through three projected corners (tiles are tiny next to the sphere).
function drawTiles(g, view, alpha, onTile) {
  const { w, h, rot, r, dpr } = view;
  const cx = w / 2;
  const cy = h / 2;
  const geo = { cx, cy, r };
  const corners = [[0, 0], [w, 0], [0, h], [w, h], [cx, cy]].map(([sx, sy]) => screenToLatLng(sx, sy, rot, geo));
  const centre = corners[4];
  const lngs = corners.map((c) => {
    let d = c.lng - centre.lng;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    return centre.lng + d;
  });
  const lats = corners.map((c) => c.lat);
  const pxPerDeg = r * DEG * Math.cos(Math.min(85, Math.abs(centre.lat)) * DEG);
  const z = tileZoomFor(pxPerDeg);
  const n = 2 ** z;
  const xa = Math.floor(lngToTileX(Math.min(...lngs), z));
  const xb = Math.floor(lngToTileX(Math.max(...lngs), z));
  const yb = Math.floor(latToTileY(Math.min(...lats), z));
  const ya = Math.floor(latToTileY(Math.max(...lats), z));
  if ((xb - xa + 1) * (yb - ya + 1) > 80) return;
  g.save();
  g.globalAlpha = alpha;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  const proj = (lat, lng) => projectVec(latLngToVec3(lat, lng, rot), cx, cy, r);
  const k = 1 / TILE_PX;
  for (let ty = Math.max(0, ya); ty <= Math.min(n - 1, yb); ty += 1) {
    for (let tx = xa; tx <= xb; tx += 1) {
      const img = getTile(z, ((tx % n) + n) % n, ty, onTile);
      if (!img) continue;
      const nw = proj(tileLat(ty, z), tileLng(tx, z));
      const ne = proj(tileLat(ty, z), tileLng(tx + 1, z));
      const sw = proj(tileLat(ty + 1, z), tileLng(tx, z));
      g.setTransform(
        dpr * (ne.x - nw.x) * k, dpr * (ne.y - nw.y) * k,
        dpr * (sw.x - nw.x) * k, dpr * (sw.y - nw.y) * k,
        dpr * nw.x, dpr * nw.y,
      );
      g.drawImage(img, 0, 0, TILE_PX + 0.6, TILE_PX + 0.6);
    }
  }
  g.restore();
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// Deep zoom (a city, a landmark): no planet disc — the view is a window onto
// flat-ish ground. Ocean colour, clipped country land, then street tiles.
function drawDeep(g, view, opts, dpr) {
  const { w, h, rot, r } = view;
  const cx = w / 2;
  const cy = h / 2;
  g.fillStyle = "#9CC7EE";
  g.fillRect(0, 0, w, h);
  const box = [-40, -40, w + 40, h + 40];
  g.fillStyle = "#7FC98F";
  g.strokeStyle = "rgba(23, 66, 40, 0.7)";
  g.lineWidth = 2;
  if (opts.borders) {
    for (const polys of Object.values(opts.borders)) {
      for (const rings of polys) drawPolygonDeep(g, rings, cx, cy, r, rot, box);
    }
  } else {
    for (const land of LANDMASSES) drawPolygonDeep(g, [land.points], cx, cy, r, rot, box);
  }

  if (opts.tiles !== false) {
    const alpha = 1;
    drawTiles(g, { ...view, dpr }, alpha, opts.onTile);
    g.font = "600 11px system-ui, sans-serif";
    g.textBaseline = "top";
    const tw = g.measureText(TILE_ATTRIBUTION).width;
    g.fillStyle = "rgba(255,255,255,0.78)";
    g.fillRect(6, 6, tw + 10, 17);
    g.fillStyle = "#334";
    g.fillText(TILE_ATTRIBUTION, 11, 9);
  }

  // pin marker rings keep a fixed, legible size at depth
  for (const ring of opts.rings || []) {
    if (!(ring.opacity > 0.02)) continue;
    g.strokeStyle = `rgba(255, 253, 247, ${0.95 * ring.opacity})`;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(ring.x, ring.y, ring.radius, 0, Math.PI * 2);
    g.stroke();
  }
}

// Fill one polygon (outer ring + holes) as a single path — filled with
// "evenodd" so enclaves (Lesotho in South Africa) read correctly.
function fillPolygon(g, rings, cx, cy, r, rot) {
  g.beginPath();
  for (const ring of rings) strokeSegments(g, ringVecs(ring, rot), cx, cy, r);
  g.closePath();
}

// One full frame. view = { w, h, rot, r }; opts:
//   borders — COUNTRY_BORDERS (iso2 → polygon rings) or null (stylized land)
//   rings   — [{ x, y, radius, opacity }] boundary rings under the pins
export function drawGlobe(g, view, opts = {}) {
  const { w, h, rot, r } = view;
  if (!g || !w || !h) return;
  const dpr = opts.dpr || window.devicePixelRatio || 1;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2;

  if (r > DEEP_RADIUS) {
    drawDeep(g, view, opts, dpr);
    return;
  }

  // atmosphere halo
  const halo = g.createRadialGradient(cx, cy, r * 0.92, cx, cy, r * 1.14);
  halo.addColorStop(0, "rgba(125, 211, 252, 0)");
  halo.addColorStop(0.55, "rgba(125, 211, 252, 0.34)");
  halo.addColorStop(1, "rgba(125, 211, 252, 0)");
  g.fillStyle = halo;
  g.beginPath();
  g.arc(cx, cy, r * 1.14, 0, Math.PI * 2);
  g.fill();

  // ocean
  const ocean = g.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r * 1.05);
  ocean.addColorStop(0, "#8ECAFF");
  ocean.addColorStop(0.55, "#3E8DE3");
  ocean.addColorStop(1, "#1E3FA0");
  g.fillStyle = ocean;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();

  // graticule
  g.strokeStyle = "rgba(255, 255, 255, 0.14)";
  g.lineWidth = 1;
  g.beginPath();
  for (let lng = -180; lng < 180; lng += 30) {
    const line = [];
    for (let lat = -80; lat <= 80; lat += 8) line.push([lng, lat]);
    strokeSegments(g, ringVecs(line, rot), cx, cy, r);
  }
  for (const lat of [-60, -30, 0, 30, 60]) {
    const line = [];
    for (let lng = -180; lng <= 180; lng += 8) line.push([lng, lat]);
    strokeSegments(g, ringVecs(line, rot), cx, cy, r);
  }
  g.stroke();

  // land: real country polygons when the borders dataset is loaded — each
  // polygon fills with even-odd (enclaves) and its rings stroke as the
  // political borders; otherwise the stylized continents stand in.
  g.fillStyle = "#7FC98F";
  if (opts.borders) {
    g.strokeStyle = "rgba(23, 66, 40, 0.55)";
    g.lineWidth = 1;
    for (const polys of Object.values(opts.borders)) {
      for (const rings of polys) {
        fillPolygon(g, rings, cx, cy, r, rot);
        g.fill("evenodd");
        g.stroke();
      }
    }
  } else {
    g.strokeStyle = "rgba(20, 60, 40, 0.35)";
    g.lineWidth = 1;
    for (const land of LANDMASSES) {
      g.beginPath();
      strokeSegments(g, ringVecs(land.points, rot), cx, cy, r);
      g.closePath();
      g.fill();
      g.stroke();
    }
  }

  // place boundary rings (cities and landmarks) under their pins
  for (const ring of opts.rings || []) {
    if (!(ring.opacity > 0.02)) continue;
    g.strokeStyle = `rgba(255, 253, 247, ${0.85 * ring.opacity})`;
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(ring.x, ring.y, ring.radius, 0, Math.PI * 2);
    g.stroke();
  }

  // limb shading sells the sphere
  const shade = g.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.4, cx, cy, r * 1.02);
  shade.addColorStop(0, "rgba(255, 255, 240, 0.10)");
  shade.addColorStop(0.62, "rgba(10, 12, 40, 0)");
  shade.addColorStop(1, "rgba(8, 8, 34, 0.62)");
  g.fillStyle = shade;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();

  // crisp rim
  g.strokeStyle = "rgba(190, 225, 255, 0.55)";
  g.lineWidth = 1.5;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.stroke();
}
