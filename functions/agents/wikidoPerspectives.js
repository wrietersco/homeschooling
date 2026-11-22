// Wikido Perspectives — write ONE lens of a scene (History, Culture, Food…).
// The studio then paints it (generateWikidoSceneImage) and voices it (any
// voiceover path) exactly like any other scene: a lens IS a scene with a
// back-link to its base (see functions/lib/wikidoPerspectives.js).
//
//   writeWikidoPerspective({ topicId, sceneId, lens, focus?, dryRun?, draft? })
//     dryRun -> { scene } (nothing saved: the wizard's preview)
//     draft  -> saves that previewed scene instead of writing a new one
//     else   -> writes with the scene writer and saves
//   Saves touch only scenes.<lensScene> and scenes.<base>.perspectives.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { resolveLlm } from "./agentConfig.js";
import { requireSuperAdmin, withoutUndefined } from "./wikido.js";
import { slugify, parseLlmJson, countDiscoveries } from "../lib/wikidoPack.js";
import { isGlobeHub } from "../lib/wikidoGlobe.js";
import {
  perspectiveById, isPerspectiveId, baseSceneId, lensEntries, lensSceneId, sceneKind,
  buildPerspectivePrompt, buildLensScene, withLensEntry, MAX_LENSES_PER_SCENE,
} from "../lib/wikidoPerspectives.js";

export const writeWikidoPerspective = onCall(
  { secrets: ["GEMINI_API_KEY"], timeoutSeconds: 240 },
  async (request) => {
    requireSuperAdmin(request);
    const topicId = slugify(String(request.data?.topicId || ""));
    const askedId = slugify(String(request.data?.sceneId || ""));
    const lensId = String(request.data?.lens || "");
    const focus = String(request.data?.focus || "").trim().slice(0, 300);
    const dryRun = Boolean(request.data?.dryRun);
    const draft = request.data?.draft && typeof request.data.draft === "object" ? request.data.draft : null;
    if (!topicId || !askedId) throw new HttpsError("invalid-argument", "Missing topic or scene.");
    if (!isPerspectiveId(lensId)) throw new HttpsError("invalid-argument", "Choose a perspective from the list.");

    const docRef = getFirestore().collection("wikidoTopics").doc(topicId);
    const snap = await docRef.get();
    if (!snap.exists) throw new HttpsError("not-found", "That topic no longer exists.");
    const pack = snap.data();
    const baseId = baseSceneId(pack.scenes, askedId);
    const base = pack.scenes?.[baseId];
    if (!base) throw new HttpsError("invalid-argument", "That scene no longer exists — save your edits first.");
    if (isGlobeHub(pack, baseId)) throw new HttpsError("failed-precondition", "The globe itself has no perspectives — open a place and add them there.");
    const lens = perspectiveById(lensId);
    const existing = lensEntries(base, pack.scenes);
    if (existing.some((e) => e.id === lensId)) {
      throw new HttpsError("already-exists", `“${base.title}” already has the ${lens.name} perspective.`);
    }
    if (existing.length >= MAX_LENSES_PER_SCENE) {
      throw new HttpsError("failed-precondition", `A scene can have at most ${MAX_LENSES_PER_SCENE} perspectives.`);
    }

    const sceneId = lensSceneId(pack.scenes, baseId, lensId);
    let built = draft ? buildLensScene(draft, { baseId, base, lensId, sceneId }) : null;
    if (!built) {
      if (!process.env.GEMINI_API_KEY) throw new HttpsError("failed-precondition", "Set the GEMINI_API_KEY secret.");
      const { llm, genConfig, provider } = await resolveLlm(getFirestore(), "wikido", { gemini: process.env.GEMINI_API_KEY });
      if (!llm) throw new HttpsError("failed-precondition", `The text model provider "${provider}" has no API key set.`);
      const system = buildPerspectivePrompt({
        topicTitle: pack.title, artStyle: pack.artStyle, base, lens: lensId, kind: sceneKind(pack, baseId), focus,
        otherLenses: existing.map((e) => perspectiveById(e.id)?.name || e.id),
      });
      let lastError = "";
      for (let attempt = 0; attempt < 2 && !built; attempt++) {
        try {
          const res = await llm.generate({
            system,
            contents: [{ role: "user", parts: [{ text: `Write the ${lens.name} perspective of "${base.title}" now. Output the JSON object only.` }] }],
            config: { ...genConfig, temperature: genConfig?.temperature ?? 0.8, maxOutputTokens: Math.max(genConfig?.maxOutputTokens || 0, 8192) },
          });
          const out = buildLensScene(parseLlmJson(res.text), { baseId, base, lensId, sceneId });
          if (out.errors.length) lastError = out.errors.join(" · ");
          else built = out;
        } catch (e) {
          lastError = String(e?.message || e).slice(0, 200);
        }
      }
      if (!built) throw new HttpsError("internal", `The ${lens.name} perspective could not be written: ${lastError || "no answer"}. Press Try again.`);
    }
    if (built.errors.length) throw new HttpsError("invalid-argument", `That preview is incomplete: ${built.errors.join(" · ")}`);
    if (dryRun) return { sceneId, baseId, scene: built.scene, saved: false };

    const perspectives = withLensEntry(base, lensId, sceneId);
    const scenes = { ...pack.scenes, [sceneId]: built.scene, [baseId]: { ...base, perspectives } };
    await docRef.update(withoutUndefined({
      [`scenes.${sceneId}`]: built.scene,
      [`scenes.${baseId}.perspectives`]: perspectives,
      discoveryCount: countDiscoveries({ scenes }),
      updatedAt: Date.now(),
    }));
    return { sceneId, baseId, scene: built.scene, perspectives, saved: true };
  }
);
