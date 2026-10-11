// Cover-crop mapping for spot pins.
//
// Artwork is displayed with `object-fit: cover` (full-bleed, cinematic), which
// CROPS the picture whenever the container's aspect ratio differs from the
// artwork's. A spot pinned at "40%, 30%" of the PICTURE therefore lands at a
// different point of the SCREEN. This maps picture-percentage coordinates
// through the exact cover transform so pins land on the object they mark,
// in any container, at any window size.

export function coverMap(percentX, percentY, containerW, containerH, imgW, imgH) {
  const cw = Math.max(1, containerW || 0);
  const ch = Math.max(1, containerH || 0);
  const iw = imgW || 1920; // generated artwork is 16:9 — sensible defaults
  const ih = imgH || 1080; // until the real dimensions load
  const scale = Math.max(cw / iw, ch / ih);
  const shownW = iw * scale;
  const shownH = ih * scale;
  const offX = (cw - shownW) / 2;
  const offY = (ch - shownH) / 2;
  return {
    left: offX + (percentX / 100) * shownW,
    top: offY + (percentY / 100) * shownH,
  };
}
