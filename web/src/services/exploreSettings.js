import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import { normalizeSettings, normalizeCapabilities } from "@/lib/exploreOptions";

// This family's own Explore preferences for ONE child and ONE mode (parents edit
// these; the server validates them and applies them on top of the platform
// config when a conversation starts). Scoped per child+mode because a note like
// "Hadi is practising k and s sounds" or a same-day task is specific to that
// child, and a delivery style picked for Learning is often wrong for freewheeling
// Exploration. `capabilities` describes what the platform's current Live models
// support, so the panel can hide any control those models would reject.
export async function loadExploreSettings(childId, mode) {
  const r = await httpsCallable(functions, "getExploreSettings")({ childId, mode });
  const capabilities = normalizeCapabilities(r.data?.capabilities);
  return { settings: normalizeSettings(r.data?.settings, capabilities), capabilities };
}

export async function saveExploreSettings(childId, mode, settings, capabilities) {
  const caps = normalizeCapabilities(capabilities);
  const r = await httpsCallable(functions, "saveExploreSettings")({
    childId, mode, settings: normalizeSettings(settings, caps),
  });
  const saved = normalizeCapabilities(r.data?.capabilities ?? caps);
  return { settings: normalizeSettings(r.data?.settings, saved), capabilities: saved };
}

// One short real greeting in the chosen voice -> { ok, url, transcript } (a data: WAV).
export async function previewExploreVoice(voiceName) {
  return (await httpsCallable(functions, "previewExploreVoice")({ voiceName })).data;
}
