# Wikido Perspectives

A scene can be seen through several **perspectives** ("lenses"): the same place
(say *Pakistan*) as History, Culture, Architecture, Food, a Map… Each lens is a
full picture of its own: artwork, numbered spots with cards and voiceover, and
optional deeper child scenes.

## Data model — a lens is just another scene

```
scenes: {
  pakistan: {                       // the base scene = the "Overview" lens
    title, narration, image, hotspots,
    perspectives: [                 // optional, ordered; absent = one picture only
      { id: "history",      sceneId: "pakistan-history" },
      { id: "culture",      sceneId: "pakistan-culture" },
      { id: "architecture", sceneId: "pakistan-architecture" },
    ],
  },
  "pakistan-history": {             // an ordinary scene…
    perspectiveOf: "pakistan",      // …that belongs to its base scene
    lens: "history",
    title, narration, image, artPrompt, hotspots,   // spots may open child scenes
  },
}
```

* **Backward compatible, no migration.** A scene without `perspectives` is its
  own single (Overview) lens. Nothing existing changes.
* **Every pipeline is reused unchanged**: artwork (`generateWikidoSceneImage`,
  the spot-aware prompt from `wikidoSpotArt.js`), spot auto-adjust, spot-card
  writer, all voiceover paths (clip ids stay `sceneId.hotspotId`), Kokoro job.
* **Edges.** The scene graph now has two edge kinds: doorways (a spot's
  `childSceneId`) and lens links (`perspectives[].sceneId`). One helper,
  `sceneChildIds()` in `functions/lib/wikidoPerspectives.js`, returns both, and
  every walker uses it: hierarchy validation (web + functions), the child
  loader's reachability pruning, loose scenes, the Studio tree, delete plans.
* **Rules** (validated): a lens scene is never the root, never has lenses of its
  own, is never also opened by a spot, its `perspectiveOf` names the base that
  lists it, `lens` is a catalog id, one entry per lens id per scene; the globe
  hub has no lenses.
* **Unfinished lenses never break a world.** The child loader drops a lens whose
  scene has no artwork or no spots (and its now-unreachable children), exactly
  like switched-off globe places. The publish checklist lists them as notes.

## Catalog — `functions/lib/wikidoPerspectives.js`

Hardcoded, shared by web and functions. ~40 lenses, each with `id`, kid-friendly
`name`, `emoji`, `color`, one-line `description`, `bestFor` (country, region,
city, landmark, topic), `spots` guidance (what the spots should be) and `art`
guidance (composition/style). Groups: Land & nature, People & culture, Past,
How a country works, Ideas & achievements, and generic lenses for non-place
topics (How it works, Parts & pieces, Up close, Life cycle, Discoveries,
Record breakers, Around the world, Staying safe & healthy…).

`sceneKind(pack, sceneId)` infers country / region / city / landmark / topic
(globe hub spot level, then title heuristics). `rankPerspectives(kind)` orders
the catalog for that kind; `defaultPerspectivesFor(kind)` = History, Culture,
Architecture for places, How it works, Discoveries (history of discovery) and
Up close for topics.

## Generation flow

* New callable `writeWikidoPerspective({ topicId, sceneId, lens, focus?, dryRun?, draft? })`
  writes one lens scene with the scene writer (prompt = base scene + catalog
  guidance + "don't repeat the Overview's spots"). `dryRun` returns the draft
  without saving (the wizard's preview); `draft` saves a previewed draft
  unchanged. Saving writes only `scenes.<lensScene>` and
  `scenes.<base>.perspectives` (field paths, no clobbering).
* Per lens the studio runs three stages — **write → paint → voice** — through
  `web/src/lib/wikido/perspectiveJobs.js` (pure, tested runner): stage status,
  progress, partial failure, *retry only what failed*.
* **Defaults**: after any new scene (Add-a-scene wizard, Add-a-place wizard /
  pin-a-place, Add more depth, outline build, single layer) the studio queues
  History, Culture and Architecture (or the topic defaults) for it, fully done.
  A studio toggle can switch the auto-lenses off. The queue shows in a
  "Making perspectives" tray with per-lens stage chips and Retry.
* A studio-side write lock makes Save wait for an in-flight server step, and
  each finished step is patched into BOTH the form and its saved snapshot, so
  unsaved edits are never lost and dirty-state stays truthful.

## Studio UX

* **Perspective strip** on every non-hub scene: one chip per lens (Overview +
  each added lens) showing spots / art / voice status; click to edit that lens
  with the normal editor; ＋ Add a perspective.
* **Add a perspective wizard** (same stepper style as the other wizards):
  1 *Pick a lens* — big recommended cards ranked for this scene's kind, already
  added ones marked; 2 *Preview* — the spots it will create (regenerate
  possible); 3 *Making it* — write/paint/voice progress with retry;
  4 *What's next* — checklist (spots, art, voice, published) + one-click fixes.
* "✦ Add more depth" keeps working; its new scenes get default lenses, and its
  result note offers "＋ Add a perspective" for the selected scene.

## Child experience

* `WikidoLensSwitcher.vue`: big touch chips (emoji + name, lens colour) at the
  bottom of a scene that has lenses; swipe-free, one tap.
* Transition: `lensTransition.js` lazy-loads three.js (`three@0.170.0`, pinned)
  and plays a short rotating-prism turn: the old artwork on one face, the new on
  the next, slight depth parallax, ~650 ms, then hands back to the normal scene.
  Falls back to a CSS 3D card flip without WebGL, and a plain cross-fade when
  `prefers-reduced-motion` is set. Rendering stops and disposes after each turn
  (nothing runs while a child explores), so low-end tablets stay smooth.
* URL: `?lens=<id>` on the scene URL (omitted for Overview); a link to a lens
  scene id resolves to its base scene + `lens`. Doorways from a lens open child
  scenes as usual; breadcrumbs go back to the base scene on that lens.
