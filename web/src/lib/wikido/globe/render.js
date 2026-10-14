// Canvas rendering for the Wikido 3D globe — shared by the child explorer
// (WikidoGlobe) and the superadmin studio editor (WikidoGlobeEditor), so both
// draw the identical planet: ocean, graticule, country borders (real Natural
// Earth outlines when the lazy borders dataset is loaded; a stylized fallback
// until then), limb shading and the place pins' boundary rings.
import { latLngToVec3, projectVec, horizonBlend } from "./projection";
import { LANDMASSES } from "./land";

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
