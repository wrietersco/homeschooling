# Wikido — Authoring Guide

**Wikido** ("Wiki Kido") is the platform's immersive picture encyclopedia for children.
Each **topic** is a hand-curated world of full-screen **scenes**; the child taps glowing
**hotspots** on the artwork to read about them, listen to them (TTS), and — when a
hotspot is a doorway — **step inside** to a deeper scene.

Topics are **pre-engineered by developers and published in code**. Nothing is
runtime-AI generated; curation happens entirely in this repository. Scene artwork is
**pre-generated once** in the developer environment with the platform's image model,
and narration/commentary audio is **pre-recorded with Kokoro TTS** (see "Audio"
below). Both are curated and committed.

Example graph for the first topic — 11 scenes, 46 discoveries, four levels deep:

```
Civilizations (topic)
└─ civilizations-overview          — the concept + its aspects
   ├─ persian-empire               — Persepolis panorama
   │    ├─ gate-of-all-nations     — the winged-bull gateway
   │    ├─ tachara                 — the mirror palace
   │    ├─ royal-road              — the empire's highway
   │    │    └─ royal-messenger    — the king's rider
   │    └─ apadana-palace          — the grand audience hall
   │         └─ bull-capitals      — anatomy of a column top
   ├─ mesopotamia                  — the first cities
   │    └─ cuneiform               — the first writing
   └─ rivers-and-farming           — water makes cities grow
```

## Where things live

| What | Path |
| --- | --- |
| Topic pack (content: scenes, hotspots, narration, art prompts) | `web/src/lib/wikido/topics/<topic-id>.js` |
| Topic registry (publish = add here) | `web/src/lib/wikido/index.js` |
| Schema validator (runs on every load + in tests) | `web/src/lib/wikido/schema.js` |
| Art generation script (developer environment only) | `functions/scripts/generate-wikido-art.mjs` |
| Audio generation script (Kokoro TTS, developer environment only) | `functions/scripts/generate-wikido-audio.mjs` |
| Scene artwork (`<scene-id>.jpg`) | `web/public/wikido/<topic-id>/` |
| Narration audio (`<scene-id>[.<hotspot-id>].mp3`) | `web/public/wikido/<topic-id>/audio/` |
| Discovery progress (localStorage) | `web/src/lib/wikido/progress.js` |
| Service the UI talks to | `web/src/services/wikido.js` |
| UI (view + components) | `web/src/views/WikidoView.vue`, `web/src/components/wikido/` |

## Authoring a new topic (checklist)

1. **Write the pack** — copy `topics/civilizations.js` as a template. Fill in:
   - topic `id`, `title`, `emoji`, `tagline`, `cover`, `artStyle` (the shared
     look for the whole topic), `rootSceneId`;
   - one entry per scene: `id`, `title`, `artPrompt` (the scene's curated
     image-generation prompt — spell out the composition left-to-right so the
     landmarks land where your hotspots will point), `narration` ("Read to me"
     text), and 3–5 `hotspots` each with `label`, `blurb`, `x/y` and an
     `info { title, body[], fact? }` card; add `childSceneId` on doorways.
2. **Validate** — `npm --prefix web run test:unit` runs `schema.test.js`, which
   validates every registered pack. The service also validates at runtime and
   `console.error`s loudly on a broken pack (the topic then refuses to open
   rather than showing a child a broken screen).
3. **Generate the artwork** (developer environment):
   ```
   cd functions
   node scripts/generate-wikido-art.mjs                 # all scenes
   node scripts/generate-wikido-art.mjs --scene tachara # re-run one scene
   node scripts/generate-wikido-art.mjs --dry-run       # prompts only
   ```
   Reads `GEMINI_API_KEY` from the env or `functions/.secret.local`, renders
   each `artPrompt` at 16:9 with the platform image model
   (`gemini-3.1-flash-image`), writes `web/public/wikido/<topic>/<scene>.jpg`
   and flips that scene's `image.src` in the pack from the `.svg` placeholder.
   **Curate**: open every image, re-run any scene until it's right, then commit
   the keepers. Placeholder `.svg` files that are still referenced render fine
   in the meantime, so a topic can ship scene-by-scene.
4. **Re-measure hotspots** — the generated art rarely matches your first-guess
   coordinates. Open the topic in dev (`npm --prefix web run dev`) and press
   **H** (or the crosshair chip): a crosshair follows the cursor and reads out
   `x%, y%` of the artwork. Update each hotspot's coordinates in the pack.
5. **Register** — add the pack to `wikidoTopicPacks` in `web/src/lib/wikido/index.js`. That is the entire "publish" step.
6. **Check the drill path** — click through every scene and every
   "Step inside" in the running app.

## Pack schema (enforced by `schema.js`)

```js
{
  id: "civilizations",              // kebab-case slug (route-grade identifier)
  title: "Civilizations",
  emoji: "🏛️",                      // shelf decoration
  tagline: "…",                     // one line on the shelf card
  cover: { src, alt },              // shelf card image (public/ path)
  artStyle: "…",                    // shared look for generated artwork
  rootSceneId: "civilizations-overview",
  scenes: {
    "<scene-id>": {
      id: "<scene-id>",             // must match the key
      title: "Persian Empire & Persepolis",
      artPrompt: "…",               // curated prompt for the art generator
      image: { src: "/wikido/civilizations/persian-empire.jpg", alt: "…" },
      narration: "…",               // "Read to me" text for the whole scene
      // audio: "/wikido/civilizations/tachara.mp3", // optional pre-recorded
      // narration (Kokoro); runtime TTS is used when absent
      hotspots: [
        {
          id: "apadana",            // unique within the scene
          label: "Apadana Palace",  // always-visible pill on the artwork
          blurb: "…",               // short teaser (aria description)
          x: 33, y: 31,             // PERCENT of the image (0–100)
          info: {
            title: "Apadana Palace",
            body: ["Paragraph one…", "Paragraph two…"],
            fact: "Fun fact! …",    // optional, shown in the yellow box
          },
          childSceneId: "apadana-palace",  // optional → "Step inside" doorway
          // audio: "/wikido/civilizations/apadana.mp3", // optional recorded clip;
          // TTS is used when absent (Gemini TTS → device voice fallback)
        },
      ],
    },
  },
}
```

Rules the validator enforces:

- ids are `kebab-case` slugs; hotspot ids unique per scene;
- `x`/`y` are numbers 0–100 (percentages — artwork can be re-exported at any
  resolution without re-measuring);
- every scene has `image {src, alt}`, non-empty `narration` and ≥1 hotspot;
- every hotspot has `label`, `blurb`, and `info { title, body[] }` (+ optional
  `fact`, `audio`);
- `childSceneId` (when present) must reference an existing scene in the same pack;
- `rootSceneId` must reference an existing scene.

## Voice & audio

Two layers:

1. **Published recordings (the default experience).** Every scene narration and
   hotspot card is pre-recorded with **Kokoro TTS** and committed as MP3 under
   `web/public/wikido/<topic>/audio/`. Playback is instant — a plain audio file,
   no network round-trip. Two ways to record:
   - **Hand-authored packs** (developer machine): the batch script.
     ```
     npm run wikido:audio            # all missing clips
     npm run wikido:audio -- --force # re-record everything
     ```
   - **Studio topics** (superadmin, any machine with the bridge running): start
     the local voiceover bridge — `npm run wikido:bridge` — and the Wikido
     Studio detects it automatically. Press "Record all clips" and every scene
     narration + hotspot card is synthesized with Kokoro and attached to the
     topic in Firebase Storage via the superadmin-only `attachWikidoAudio`
     callable. The bridge speaks exactly the text on screen; existing clips are
     skipped unless "re-record all" is checked.
   The bridge speaks **exactly the text the UI reads** (narration = `"<title>.
   <narration>"`; cards = `title + body[] + "Fun fact! <fact>"`). If you change
   wording in a pack, re-record — the unit tests enforce that every referenced
   file actually ships.
2. **Runtime fallback.** `audio:` clips are played via the platform's shared
   `useSpeech()` composable (`SpeakButton audioUrl → playAudio`). When a clip is
   missing, the Gemini-TTS Cloud Function synthesizes the text (cached), falling
   back to the on-device voice when offline. So a topic can publish scene-by-scene:
   unrecorded items still speak.

## Progress

Every scene visit and opened hotspot is recorded per topic in
`localStorage` (`wikido.progress.v1`) and surfaced as "X of Y discovered". It is
device-local by design — a curiosity nudge, not a graded record. If family-scoped
progress is ever needed, swap the internals of `progress.js` for a
`families/{id}` subcollection; nothing else changes.

## Sizing guardrail

Wikido is **desktop-only by design** (`≥940px` viewports). Below that the module
shows a friendly "Wikido loves big screens!" notice instead of a cramped layout.

## Studio editing model (superadmin)

One vocabulary everywhere in the studio: a topic is a **map of scenes**; a scene
is a picture with **spots**; a spot either **shows a fact card** or **opens
another scene**. (The pack data still calls these `scenes`, `hotspots` and
`childSceneId` — only the studio wording changed.)

- **Pins on the picture** — spots are numbered pins over the real artwork; drag
  to place, click to edit. Each spot row states its outcome ("Opens “X”" /
  "Shows a fact card").
- **Map** — status dot per scene (ready / needs artwork / needs attention), a
  "things to fix before publishing" list (orphans, empty scenes, missing art).
- **Scoped delete** — the dialog lists the spots that open the scene and any
  deeper scenes; "delete only this" turns pointing spots into fact spots.
- **Suggest scenes** (`suggestWikidoScenes`, read-only) — chips of AI ideas; a
  click runs the normal `addWikidoChildScene`.
- **Plan a whole branch** (`planWikidoOutline`, read-only) → review/edit the
  outline → **Build**. The studio then creates scenes one at a time through
  `addWikidoChildScene` (draft, validated). A failed scene skips only its own
  subtree; "Stop after this scene" works mid-run; **Undo this build** removes
  exactly the scenes the run created plus the spots that open them.

Safety rails: model output is normalized server-side (`normalizeOutline` /
`normalizeSuggestions`: shape, length, depth ≤ 3, ≤ 4 children per scene, ≤ 12
scenes, duplicates dropped) and one retry covers a malformed answer. Nothing is
published or painted by the builder; artwork and publish stay explicit steps.

Not built yet: vision-based spot placement, automatic reading-level/accuracy QA
pass, and a persisted job record (the build queue lives in the browser tab, so
closing it mid-run leaves the scenes created so far as normal drafts).
