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

// The loaded tile image, or null (and a load is started; onLoad fires when it lands).
export function getTile(z, x, y, onLoad) {
  if (typeof Image === "undefined") return null;
  const key = `${z}/${x}/${y}`;
  let entry = cache.get(key);
  if (!entry) {
    const img = new Image();
    entry = { img, ok: false };
    img.onload = () => {
      entry.ok = true;
      onLoad?.();
    };
    img.onerror = () => {
      entry.failed = true; // stays cached: an offline map must not re-request every frame
    };
    img.decoding = "async";
    img.src = tileUrl(z, x, y);
    cache.set(key, entry);
    if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value);
  } else {
    // refresh recency
    cache.delete(key);
    cache.set(key, entry);
  }
  return entry.ok ? entry.img : null;
}
