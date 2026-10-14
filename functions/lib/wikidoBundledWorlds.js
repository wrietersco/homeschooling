// Scene ids of the developer-authored (bundled) Wikido packs, mirrored here so
// the publish gate can resolve cross-topic doorways that point at a bundled
// world — Cloud Functions cannot import the web pack modules at runtime.
// web/src/lib/wikido/schema.test.js keeps this manifest in sync with the real
// packs: update it whenever a bundled topic gains or loses scenes.
export const bundledWikidoWorlds = [
  {
    id: "living-things",
    title: "Living Things",
    scenes: [
      "living-things-overview",
      "kinds-of-living-things",
      "types-of-animals",
      "types-of-plants",
      "human-beings",
      "human-body",
    ],
  },
  {
    id: "our-earth",
    title: "Our Amazing Earth",
    scenes: [
      "globe"
    ],
  },
];
