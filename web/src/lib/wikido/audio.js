// Wikido audio URL resolution.
//
// Studio-attached voiceovers live in Firebase Storage (public download-token
// URLs). In production those URLs play directly. In the dev emulator the object
// is hosted by the STORAGE EMULATOR, so a prod-host URL 403s — rewrite it to
// the emulator host (web/src/lib/firebase.js points the storage client at
// localhost:9199 in dev).
import { isEmulator } from "@/lib/firebase";

const PROD_HOST = "https://firebasestorage.googleapis.com/v0/b";
const EMULATOR_HOST = "http://localhost:9199/v0/b";

export function resolveWikidoAudioUrl(url) {
  if (!url || !isEmulator) return url;
  return url.startsWith(PROD_HOST) ? url.replace(PROD_HOST, EMULATOR_HOST) : url;
}
