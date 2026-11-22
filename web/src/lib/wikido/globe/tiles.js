// Street-level map tiles for the deepest zoom levels of the 3D globe.
//
// The bundled country outlines are a ~1:110m dataset: perfect for the whole
// planet, useless once you are looking at one landmark. Past a certain zoom the
// globe lays standard OpenStreetMap raster tiles over the vector land (free,
// no API key; attribution is drawn on the canvas — see render.js). Tiles load
// lazily and are cached; if the network is offline the vector land just stays.

export const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const TILE_ATTRIBUTION = "© OpenStreetMap contributors";
export const TILE_MAX_Z = 19;
const TILE_PX = 256;
const MAX_CACHED = 400;

export { TILE_PX };

// Web-Mercator maths ─ tile (x, y, z) ⇄ lat/lng.
export function tileLng(x, z) {
  return (x / 2 ** z) * 360 - 180;
}
export function tileLat(y, z) {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (Math.atan(Math.sinh(n)) * 180) / Math.PI;
}
export function lngToTileX(lng, z) {
  return ((lng + 180) / 360) * 2 ** z;
}
export function latToTileY(lat, z) {
  const rad = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z;
}

// Pick the tile zoom whose tiles are about one tile-size on screen.
// pxPerDeg = screen pixels per degree of longitude at the view centre.
export function tileZoomFor(pxPerDeg) {
  const z = Math.round(Math.log2((360 * Math.max(1e-9, pxPerDeg)) / TILE_PX));
  return Math.max(0, Math.min(TILE_MAX_Z, z));
}

const cache = new Map(); // key → { img, ok }

export function tileUrl(z, x, y) {
  return TILE_URL.replace("{z}", z).replace("{x}", x).replace("{y}", y);
}

// OSM tile usage policy: keep concurrent downloads small and never fetch tiles
// the viewer has already moved away from. Requests wait in a queue; only tiles
// still wanted (asked for within the last STALE_MS) are actually downloaded.
const MAX_INFLIGHT = 4;
const STALE_MS = 2500;
const queue = []; // entries waiting to start
let inflight = 0;

function pump() {
  const now = Date.now();
  while (inflight < MAX_INFLIGHT && queue.length) {
    const entry = queue.pop(); // newest request first: what the view needs now
    if (now - entry.wanted > STALE_MS) {
      entry.cancelled = true; // drop; it will be re-queued if it is needed again
      entry.queued = false;
      cache.delete(entry.key);
      entry.onLoad?.(); // repaint: if the view still needs it, it is re-queued fresh
      continue;
    }
    entry.queued = false;
    inflight += 1;
    const done = () => {
      inflight -= 1;
      pump();
    };
    const img = entry.img;
    img.onload = () => {
      entry.ok = true;
      entry.onLoad?.();
      done();
    };
    img.onerror = () => {
      entry.failed = true; // stays cached: an offline map must not re-request every frame
      done();
    };
    img.decoding = "async";
    img.src = entry.url;
  }
}

// The loaded tile image, or null (and a load is queued; onLoad fires when it lands).
export function getTile(z, x, y, onLoad) {
  if (typeof Image === "undefined") return null;
  const key = `${z}/${x}/${y}`;
  let entry = cache.get(key);
  if (!entry) {
    entry = { key, img: new Image(), ok: false, queued: true, wanted: Date.now(), onLoad, url: tileUrl(z, x, y) };
    cache.set(key, entry);
    queue.push(entry);
    if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value);
    pump();
  } else {
    entry.wanted = Date.now();
    if (onLoad) entry.onLoad = onLoad;
    // refresh recency
    cache.delete(key);
    cache.set(key, entry);
  }
  return entry.ok ? entry.img : null;
}
