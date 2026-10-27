// Shrink a picked photo to a small square JPEG data URL (centre-cropped), small
// enough (~15–30 KB) to live right on the child's profile doc — no Storage
// bucket, rules or upload step needed, and it shows everywhere the child does.

// Centre-crop box of a w×h image to a square.
export function squareCrop(w, h) {
  const side = Math.min(w, h);
  return { sx: Math.round((w - side) / 2), sy: Math.round((h - side) / 2), side };
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That file isn't a picture we can read.")); };
    img.src = url;
  });
}

export async function photoToDataUrl(file, size = 256, quality = 0.82) {
  if (!file || !String(file.type || "").startsWith("image/")) throw new Error("Please choose a picture.");
  const img = await loadImage(file);
  const { sx, sy, side } = squareCrop(img.naturalWidth, img.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
  return canvas.toDataURL("image/jpeg", quality);
}
