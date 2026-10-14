---
name: wikido-world
description: >
  Author, illustrate, voice, test and deploy a new Wikido world (topic pack) for
  the Dar-al-Hikmah homeschooling platform. Use whenever the user wants to create,
  add, or ship a new wikido topic/world on any subject ("create a world about X",
  "add a wikido topic", "new wikido world"), or asks to regenerate artwork,
  re-record voiceovers, fix coordinates, or deploy an existing wikido world.
---

# Wikido world authoring

A Wikido "world" is a hand-authored topic pack — an ES module in
`web/src/lib/wikido/topics/<id>.js` plus static art/audio assets. A world goes
live for every family when it is listed in `web/src/lib/wikido/index.js` and
hosting is deployed. There is no runtime generation for bundled worlds; the
model (you) writes the content, and repo scripts generate the artwork and audio.

Field-by-field pack rules live in `references/pack-schema.md` — read it before
writing your first scene. The canonical, working example is
`web/src/lib/wikido/topics/living-things.js`. `docs/wikido.md` documents the
whole feature.

## Workflow

1. **Design the scene graph first.** Sketch it as a comment at the top of the
   pack file (see living-things.js). Rules: one root scene; every hotspot with
   `childSceneId` is a doorway; a scene may have at most **one parent** (a scene
   is reachable by exactly one path), no cycles, every scene reachable from
   `rootSceneId`. Keep depth ≤ 3 and ≤ 8 hotspots per scene. Make doorways the
   user's requested sub-topics so navigation follows the outline they asked for.

2. **Write the pack** at `web/src/lib/wikido/topics/<id>.js`. Copy the
   living-things header comment, `id`, `title`, `emoji`, `tagline`, `cover`,
   `artStyle`, `rootSceneId`, `scenes` shape. Content bar:
   - Audience ≈ ages 7–11: short concrete sentences, second person, wonder.
   - Accuracy is non-negotiable — verify every fact against established science.
     Prefer "most/fewer than" over contested numbers; drop educational myths
     (e.g. "frowning uses more muscles") even if they are popular.
   - Each hotspot: `blurb` one-liner, `info.body` = 2 short paragraphs,
     `fact` = one verified, surprising, citable fact.
   - Each scene: 2–4 sentence `narration` in the same voice, ending with an
     invitation to explore.
   - Every `artPrompt` contains an explicit `COMPOSITION (left to right): …`
     paragraph describing where each anchored object sits, because hotspot x/y
     are authored to that description and refined against the finished image.
   - Reference images as `/wikido/<id>/<sceneId>.svg` placeholders, and make the
     shelf `cover` reuse the root scene's image path (one patch flips both).

3. **Register** the pack in `web/src/lib/wikido/index.js`.

4. **Create placeholder SVGs** at `web/public/wikido/<id>/<sceneId>.svg` (a
   layered gradient + emoji is enough; they are replaced by real art). The
   asset-integrity test fails if any referenced file is missing, so never
   reference a `.jpg` before it exists.

5. **Validate** before generating anything:
   ```
   node -e "import('./web/src/lib/wikido/topics/<id>.js').then(async m => { const { validateTopicPack } = await import('./web/src/lib/wikido/schema.js'); console.log(validateTopicPack(m.default)); })"
   npm --prefix web run test:unit
   ```
   `validateTopicPack` must return `[]`. The web suite also validates every
   registered pack and every referenced asset.

6. **Generate artwork** (one-time, developer environment):
   ```
   node functions/scripts/generate-wikido-art.mjs --topic <id>          # all scenes
   node functions/scripts/generate-wikido-art.mjs --topic <id> --scene <sceneId>   # re-run a scene
   ```
   Needs `GEMINI_API_KEY` in `functions/.secret.local` or the env. The script
   writes `web/public/wikido/<id>/<sceneId>.jpg` and patches the pack's
   `.svg` → `.jpg` (including the shelf cover). Re-run any scene whose art is
   wrong rather than accepting it.

7. **Re-measure hotspots against the real art.** The authored x/y are
   composition-informed guesses. Open each generated image, compare with the
   `COMPOSITION` description, and correct every spot's x/y (percent of image,
   0–100). In the dev app, pressing **H** in Wikido shows a live % crosshair.
   Do not ship coordinates you have not checked against the image.

8. **Record voiceovers** (optional but expected):
   ```
   npm run wikido:audio -- --topic <id>
   ```
   Kokoro TTS writes `audio/<sceneId>[.<hotspotId>].mp3` and patches the
   `audio:` fields. Never hand-write `audio:` fields. Re-run (with `--force`
   or per scene) whenever narration/info wording changes, or the recordings
   drift from the on-screen text.

9. **Test.** `npm --prefix web run test:unit` must fully pass. Functions tests
   are unaffected by content-only changes but run them if you touched
   `functions/`. The e2e wikido spec (`tests/e2e/wikido.spec.js`) runs under
   `npm run test:e2e` (needs Firebase emulators + Java).

10. **Deploy.** Bundled worlds ship with hosting:
    ```
    npm --prefix web run build
    firebase deploy --only hosting
    ```
    (Project: `homeschooling-b3e57`, set in `.firebaserc`. Functions only need
    deploying if you changed `functions/`.)

## Content quality checklist (what review actually checks)

- Every fact is true — including every `fact`. When unsure, cut it.
- No educational myths, no invented statistics, no rounding that flips meaning.
- The scene graph matches the requested outline 1:1 — the user's named topics
  should be visible in the tree, either as doorways or as hotspots.
- Hotspot labels are short and concrete; blurbs make a child want to tap.
- The `COMPOSITION` in each artPrompt and the hotspot coordinates tell the
  same story — after art generation, verify by looking at the image.
