import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

// Synthesize speech for arbitrary text via the Gemini TTS Cloud Function.
// Returns { configured, url, cached }. The URL is a playable WAV (Storage token
// URL, or a data: URL when Storage is unavailable).
export function synthesizeSpeech({ text, lang, voiceName } = {}) {
  return httpsCallable(functions, "synthesizeSpeech")({ text, lang, voiceName }).then((r) => r.data);
}
