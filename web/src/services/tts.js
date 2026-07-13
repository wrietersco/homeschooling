import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

// Synthesize speech for arbitrary text via the TTS Cloud Function. Returns
// { configured, url, cached }. The URL is a playable WAV (Storage token URL, or a
// data: URL when Storage is unavailable). `provider`/`model` are optional — passing
// them regenerates the audio in a specific provider's voice (the per-element voice
// picker); omitted, the platform-configured voice is used. `contentKind` (e.g.
// "quran", "story", "tips") selects a default emotional tone fitting that kind of
// content — the server picks a sensible reading style automatically.
export function synthesizeSpeech({ text, lang, voiceName, provider, model, contentKind } = {}) {
  return httpsCallable(functions, "synthesizeSpeech")({ text, lang, voiceName, provider, model, contentKind }).then((r) => r.data);
}

// The consolidated voice catalog the per-element voice picker renders: voices from
// both providers, each provider's regeneration model, and whether it's configured.
// Module-cached — the catalog is static for a session, so one round-trip is enough.
let _catalogPromise = null;
export function getTtsVoiceCatalog() {
  if (!_catalogPromise) {
    _catalogPromise = httpsCallable(functions, "getTtsVoiceCatalog")({})
      .then((r) => r.data)
      .catch((e) => { _catalogPromise = null; throw e; }); // let a failed load retry
  }
  return _catalogPromise;
}
