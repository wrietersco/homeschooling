# Wikido pack schema (hand-authored packs)

Validator: `web/src/lib/wikido/schema.js` (`validateTopicPack` must return `[]`).
Hierarchy rules: `functions/lib/wikidoHierarchy.js` (single parent, acyclic,
reachable from root, no doorway back to the root).

```js
{
  id: "living-things",        // kebab-case slug, matches the filename and asset dir
  title: "Living Things",
  emoji: "🌿",                 // shelf decoration
  tagline: "…",               // one line on the shelf card
  cover: { src, alt },        // shelf card image; reuse the root scene's path
  artStyle: "…",              // topic-wide style prepended to every artPrompt;
                              // always ends with "no text, no words, no lettering. Wide 16:9 composition."
  rootSceneId: "<scene-id>",
  scenes: {
    "<scene-id>": {           // key must equal scene.id, kebab-case slug
      id: "<scene-id>",
      title: "…",
      artPrompt: "… COMPOSITION (left to right): …",   // curated, versioned with the content
      image: { src: "/wikido/<id>/<sceneId>.svg", alt: "…" }, // svg → .jpg patched by the art script
      narration: "…",         // "Read to me" text; 2–4 sentences
      audio: "/wikido/<id>/audio/<sceneId>.mp3",       // OPTIONAL — written by the audio script, never by hand
      hotspots: [             // 1–8 per scene; order = sibling order for doorways
        {
          id: "spot-id",      // kebab-case, unique within the scene
          label: "Short pill label",
          blurb: "One-line teaser (hover/aria)",
          x: 33, y: 31,       // PERCENT of the image (0–100), re-measured after art
          audio: "…",         // OPTIONAL — audio script
          info: {
            title: "…",
            body: ["Paragraph one…", "Paragraph two…"],  // non-empty array of non-empty strings
            fact: "Fun fact! …",                          // optional, must be true
          },
          childSceneId: "other-scene",   // optional → doorway ("Step inside")
        },
      ],
    },
  },
}
```

## Hard rules that fail tests or runtime

- `x`/`y` must be finite numbers in 0–100.
- Every `childSceneId` must reference an existing scene; hierarchy must be a
  single-parent tree rooted at `rootSceneId` (no cycles, no orphans).
- `info.body` paragraphs and `narration` must be non-empty (whitespace fails).
- Every referenced `image.src`, `audio`, and `cover.src` must exist on disk
  under `web/public/` — enforced by `web/src/services/wikido.test.js`.
- Scene count / depth are not schema-enforced, but keep ≤ 8 hotspots per scene
  (the studio tree mover enforces this) and depth ≤ 3 (the studio outline caps).

## Naming and paths

- Pack file: `web/src/lib/wikido/topics/<id>.js`, default-exported.
- Assets: `web/public/wikido/<id>/<sceneId>.jpg` and
  `web/public/wikido/<id>/audio/<sceneId>[.<spotId>].mp3`.
- Audio file naming comes from the audio script: scene clip is `<sceneId>.mp3`,
  a hotspot clip is `<sceneId>.<spotId>.mp3`.
