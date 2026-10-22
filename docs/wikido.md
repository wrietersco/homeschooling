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

Example graph for the flagship topic — 6 scenes, 40 discoveries, three levels deep:

```
Living Things (topic)
└─ living-things-overview         — what makes something alive
   ├─ kinds-of-living-things      — sorting life into big groups
   │    ├─ types-of-animals       — mammals, birds, fish, reptiles, amphibians, insects
   │    └─ types-of-plants        — trees, flowers, grasses, ferns, conifers
   └─ human-beings                — what human beings are and what makes us special
        └─ human-body             — bones, muscles, heart, lungs, brain, senses
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
| Globe world rules (hub + geo spots, shared with the server) | `functions/lib/wikidoGlobe.js` |
| Gazetteer — countries, capitals, major cities + place resolver | `functions/lib/wikidoGazetteer.js` |
| Globe math (projection, inverse pin-drag, zoom LOD) | `web/src/lib/wikido/globe/projection.js` |
| Shared planet renderer (borders, land, rings) | `web/src/lib/wikido/globe/render.js` + `land.js` + generated `borders.js` |
| Border codegen (Natural Earth 110m → ISO2) | `web/scripts/generate-globe-borders.mjs` |
| 3D globe explorer | `web/src/components/wikido/WikidoGlobe.vue` |
| Studio globe editor (borders + draggable pins) | `web/src/components/platform/WikidoGlobeEditor.vue` |

## Authoring a new topic (checklist)

1. **Write the pack** — copy `topics/living-things.js` as a template. Fill in:
   - topic `id`, `title`, `emoji`, `tagline`, `cover`, `artStyle` (the shared
     look for the whole topic — keep it true-to-life: Wikido pictures are
     encyclopedia plates, not abstract or cartoon art); `rootSceneId`;
   - one entry per scene: `id`, `title`, `artPrompt` (the scene's curated
     image-generation prompt — spell out the composition left-to-right so the
     landmarks land where your hotspots will point), `narration` ("Read to me"
     text), and 3–5 `hotspots` each with `label`, `blurb`, `x/y` and an
     `info { title, body[], fact? }` card; add `childSceneId` on doorways (and
     `childTopicId` for a doorway into another world — see "Cross-topic
     doorways" below).
2. **Validate** — `npm --prefix web run test:unit` runs `schema.test.js`, which
   validates every registered pack. The service also validates at runtime and
   `console.error`s loudly on a broken pack (the topic then refuses to open
   rather than showing a child a broken screen).
3. **Generate the artwork** (developer environment):
   ```
   cd functions
   node scripts/generate-wikido-art.mjs                 # all scenes
   node scripts/generate-wikido-art.mjs --scene human-body # re-run one scene
   node scripts/generate-wikido-art.mjs --dry-run       # prompts only
   ```
   Reads `GEMINI_API_KEY` from the env or `functions/.secret.local`, renders
   each `artPrompt` at 16:9 with the platform image model
   (`gemini-3.1-flash-image`), writes `web/public/wikido/<topic>/<scene>.jpg`
   and flips that scene's `image.src` in the pack from the `.svg` placeholder.
   Every prompt — here and in the studio's runtime generator — is sent with the
   shared encyclopedia-realism directive (`WIKIDO_REALISM_DIRECTIVE` in
   `functions/lib/wikidoPack.js`) appended last, so scene art stays true to
   life even if a pack's own `artStyle` drifts.
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

## Cross-topic doorways (worlds that reference each other)

Topics are independent worlds, but real subjects merge — Planet Earth belongs to
Astronomy *and* is home to every Living Thing. A hotspot may therefore open a
scene in a **different topic**: set both `childTopicId` (the other pack's id)
and `childSceneId` (a scene id **in that pack's namespace**) on the hotspot:

```js
{
  id: "door-to-living-things",
  label: "What Are Plants?",
  blurb: "Barley and palms are plants — visit another world",
  x: 87, y: 58,
  childTopicId: "living-things",     // the OTHER world
  childSceneId: "types-of-plants",   // scene inside THAT pack
  info: { title: "…", body: ["…"], fact: "…" },
}
```

Rules and behaviour:

- `childTopicId` must differ from the pack's own id; internal doorways never
  set it. It always requires a `childSceneId`.
- Cross-topic edges are invisible to the local scene tree: the target scene
  keeps its own hierarchy, and a world-door never creates parents, cycles or
  ordering inside this pack (`tree.js` and `wikidoHierarchy.js` skip them).
- The explorer keeps a **journey**: stepping through a world-door loads the
  other world and lands on the target scene with its own ancestors as trail.
  Breadcrumbs span worlds, so a crumb from the previous world steps back across.
- The doorway wears gold (explorer icon `travel_explore`, card chip "A doorway
  to another world", button "Step into <world>").
- A door whose target world is not on the shelf (draft or unpublished) stays
  **dormant**: the card explains "That world isn't open yet" instead of breaking.
- No bundled world currently ships with a world-door; the field rules and
  registry resolution are exercised by `schema.test.js` (which hangs synthetic
  doors on a pack copy) and enforced by the publish gate in
  `functions/agents/wikido.js` (against
  the Firestore catalog + the bundled mirror in
  `functions/lib/wikidoBundledWorlds.js`, kept in sync by a test) for studio
  topics.

## Pack schema (enforced by `schema.js`)

```js
{
  id: "living-things",              // kebab-case slug (route-grade identifier)
  title: "Living Things",
  emoji: "🌿",                      // shelf decoration
  tagline: "…",                     // one line on the shelf card
  cover: { src, alt },              // shelf card image (public/ path)
  artStyle: "…",                    // shared look for generated artwork
  rootSceneId: "living-things-overview",
  scenes: {
    "<scene-id>": {
      id: "<scene-id>",             // must match the key
      title: "Human Beings",
      artPrompt: "…",               // curated prompt for the art generator
      image: { src: "/wikido/living-things/human-beings.jpg", alt: "…" },
      narration: "…",               // "Read to me" text for the whole scene
      // audio: "/wikido/living-things/human-beings.mp3", // optional pre-recorded
      // narration (Kokoro); runtime TTS is used when absent
      hotspots: [
        {
          id: "your-body",          // unique within the scene
          label: "Your Amazing Body", // always-visible pill on the artwork
          blurb: "…",               // short teaser (aria description)
          x: 33, y: 31,             // PERCENT of the image (0–100)
          info: {
            title: "Your Amazing Body",
            body: ["Paragraph one…", "Paragraph two…"],
            fact: "Fun fact! …",    // optional, shown in the yellow box
          },
          childSceneId: "human-body",      // optional → "Step inside" doorway
          // childTopicId: "astronomy",    // optional → cross-topic doorway:
          // childSceneId then names a scene in THAT pack (see above)
          // audio: "/wikido/living-things/human-beings.your-body.mp3", // optional clip;
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
- `childSceneId` (when present) must reference an existing scene in the same
  pack — except on cross-topic doorways (a `childTopicId` different from the
  pack's id), where it names a scene in the other pack and is resolved
  registry-wide by the tests / publish gate;
- `childTopicId` (when present) must be a kebab-case slug different from the
  pack's own id, and always paired with `childSceneId`;
- `rootSceneId` must reference an existing scene.

## Voice & audio

Two layers:

1. **Published recordings (the default experience).** Every scene narration and
   hotspot card is pre-recorded and committed under
   `web/public/wikido/<topic>/audio/`. Playback is instant — a plain audio file,
   no network round-trip. Three ways to record:
   - **Hand-authored packs** (developer machine): the batch script.
     ```
     npm run wikido:audio            # all missing clips
     npm run wikido:audio -- --force # re-record everything
     ```
   - **Studio, engine picker (superadmin).** The studio's Voiceovers panel
     offers two categorical engines behind one **Generate audios** button:
     - **Premium — Kokoro** (limitless, free): the same Kokoro-82M voice the
       local bridge uses, with two ways to run it. On the **platform's
       servers** — the production path, and fire-and-forget: pressing
       **Generate audios** with the bridge offline ENQUEUES one job per topic
       (`requestWikidoKokoroJob`, superadmin-only) and the studio can be
       closed. A scheduled worker (`wikidoKokoroWorker`, every minute,
       `maxInstances: 1`) drains the queue clip by clip — the q8 model is
       BUNDLED in the function package (`functions/models/kokoro`, ~89 MB; no
       API key, nothing billed per clip, warm instances reuse the loaded
       model) — uploading each MP3 and wiring the pack's audio fields as it
       lands, so a closed tab loses nothing. The studio polls the job for
       progress (with a Stop-the-queue button); reopening the topic picks a
       running job back up, and a finished run announces itself. Clips that
       fail are marked on the job; pressing Generate audios again records only
       what is still missing. A small primer batch is synthesized at enqueue
       time so progress moves immediately. Through the **local bridge**
       (`npm run wikido:bridge`) when the studio is served locally — the
       studio detects a running bridge, missing clips also record
       automatically, and each MP3 is attached through the superadmin-only
       `attachWikidoAudio` callable; a **▶ Start the bridge** button (visible
       only in the locally-served studio) spawns the process and reports its
       real state: pid, engine answering, or — if the process dies — its exit
       code and last output lines.
     - **Paid premium — <configured model>** (platform limits apply): the
       superadmin-only `generateWikidoAudios` callable records the clips with
       the platform's configured speech model (AI configuration → tts — Gemini
       by default, billed per clip against the shared speech capacity), uploads
       the WAVs to Storage, and wires the pack's audio fields. Works from any
       machine, bridge or no bridge.
     In both cases the studio sends clip ids in chunks of five with live
     progress, the texts come from the **saved** topic (the studio saves
     first), existing clips are skipped unless "re-record all" is checked, and
     the paid path stops early with a clear message when the shared speech
     pool runs dry. The picker defaults to whichever engine is usable (bridge
     up → Kokoro, down → paid) until the curator chooses one themselves.
   - **Studio, scoped recording (superadmin).** The scene editor has its own
     voice picker plus a **🔊 Record this scene** button (narration + every
     spot on it), and every spot row has a **🔊** button — each records exactly
     the targeted clips, always re-recording even when audio exists (a scoped
     run is explicit). The engine is whichever voice is picked at that moment,
     and **voices may be mixed per spot**: record one place in free Kokoro and
     another in the paid voice. With the bridge offline, a scoped Kokoro run
     uses the synchronous `generateWikidoKokoroAudios` callable (small scopes
     finish while you watch; the fire-and-forget queue stays topic-wide). Each
     recording stores **which voice made it** (`audioEngine: "kokoro" |
     "paid"` on the clip), shown as a badge in the spot list.
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

## Sizing: desktop and mobile

Wikido is immersive on both. Desktop shows the cinematic full-bleed `cover`
crop. On phone-sized viewports (`≤939px`) the picture is ENLARGED past the
screen bounds (cover-fit × 1.25) inside a pannable artwork layer: one finger
drags it right/left/top/bottom to discover spots, the page itself never
scrolls (no scrollbars — the layer slides under the fixed chrome). A gesture
only becomes a pan after ~6px of movement, so taps on spots still tap, and a
drag's trailing click is swallowed so panning never opens a card. The scene
shows a "Drag to explore" hint until the first pan, and the narration card
starts folded so it never hides the picture; the selected-spot card opens as a
bottom sheet. Pins keep their raw picture percentages inside the layer, so
they stay glued to what they mark wherever it is panned.

## Studio editing model (superadmin)

One vocabulary everywhere in the studio: a topic is a **map of scenes**; a scene
is a picture with **spots**; a spot either **shows a fact card**, **opens
another scene**, or **opens another world** (cross-topic doorway). (The pack
data still calls these `scenes`, `hotspots`, `childSceneId` and `childTopicId`
— only the studio wording changed.)

- **Pins on the picture** — spots are numbered pins over the real artwork; drag
  to place, click to edit. Each spot row states its outcome ("Opens “X”" /
  "Shows a fact card").
- **Shared scenes** — one scene may open from MANY doorways: several spots in
  one picture, spots deep in other branches, and world-doors from other topics.
  Link, don't copy: a scene like "Badshahi Mosque" is written, painted,
  spotted and voiced ONCE while history, architecture, religion and trip
  worlds all door into it. The scene's editor names every doorway that opens
  it ("Opened from: …"), says "Shared scene — opened from N doorways", and the
  map lists it once under its primary parent. Moving a scene re-hangs only its
  own (primary) doorway — links from other spots stay. Deleting a branch never
  removes a scene some other spot still opens. Cycles stay impossible: a
  spot's doorway picker disables the scene's own ancestors.
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
- **✦ Add more depth** (`planWikidoDepth`, read-only assessment then the same
  guarded build) — the agent assesses the whole topic and grows the thinnest
  branches. The optional **direction textbox** next to the button steers where
  the new depth goes (e.g. "more about how animals sense the world"); left
  empty, the curator decides on its own. The direction is capped at 300
  characters and treated as the highest-priority instruction in the assessment.
- **✦ Re-link misplaced scenes** (`planWikidoRelinks`, read-only) — the agent
  studies the whole topic's hierarchy (titles, narrations, spot labels,
  doorways) and proposes where every unreachable scene (a "Fix these before
  saving: … is unreachable from root" blocker) or misplaced scene belongs. The
  studio applies the moves through the same guarded helpers as the map's
  drag-and-drop, relabels the new doorways, and lists each move with its reason
  above the map — nothing is written until the curator saves.

Safety rails: model output is normalized server-side (`normalizeOutline` /
`normalizeSuggestions`: shape, length, depth ≤ 3, ≤ 4 children per scene, ≤ 12
scenes, duplicates dropped) and one retry covers a malformed answer. Nothing is
published or painted by the builder; artwork and publish stay explicit steps.

Not built yet: automatic reading-level/accuracy QA pass, and a persisted job
record (the build queue lives in the browser tab, so closing it mid-run leaves
the scenes created so far as normal drafts).

## Student background music

The student explorer plays four calm cinematic recordings by Scott Buckley:
Aurora, Reverie, First Snow and Permafrost. Original MP3s and provenance are in
`web/public/wikido/music/`; each recording is licensed under CC BY 4.0 for
commercial use with attribution. Keep the source and license credits in
`Music options → Music credits` and the accompanying `CREDITS.md`.

Music starts when a student opens a world, stays continuous across scenes and
world doorways, and stops when returning to the shelf or leaving Wikido. Default
volume is 12% (maximum 25%); narration or TTS preparation lowers it to at most
2.5%. The default shuffle bag plays each track once before reshuffling without
an immediate repeat. Students can mute, change volume, skip tracks, or repeat
one track. Preferences stay in browser storage. Hidden tabs pause playback.
If a browser blocks autoplay, the Play music button or the next exploration
gesture starts it. Failed files are skipped with a bounded retry path.


## Visual spot placement

In the superadmin Studio, hold a numbered spot on the scene artwork and drag it
with a mouse, pen, or touch. The pin preserves the grabbed offset, and the X/Y
readout shows image percentages. Press **Save spot positions** directly below
the artwork to persist all current world edits through the existing superadmin
save endpoint. Clicking without dragging still opens the spot editor.

Placement accounts for cropped artwork and responsive resizing. Interrupted
pointer gestures restore the previous coordinates; failed saves retain edits
and display an error beside the save control for retry. No artwork regeneration
is required after moving spots.


## Agent-placed spot coordinates

Every artwork generation is **spot-aware** and returns coordinates for its spots
in the same breath as the picture. The image prompt lists each spot the scene
carries (label, what it describes, where its pin currently sits) and orders the
painter to make every one of them clearly visible; the model then answers with
the picture PLUS a JSON of the exact percentages where it painted each spot
(`buildSpotArtDirection` in `functions/lib/wikidoPack.js`). The system moves the
pins onto those coordinates, the curator fine-tunes by dragging. A scene
without spots generates exactly as before — nothing to place.

A vision pass double-checks the finished picture and fills only the spots the
painter didn't report (some image-model versions answer with the picture alone;
one fallback retry covers that). Regenerating artwork re-runs the whole pass
and the studio applies the fresh coordinates automatically.

**✦ Auto-adjust spots** (next to **Save spot positions**) runs that vision pass
on demand against the scene's current picture — for pictures painted before
the pass existed, or after the curator dragged pins away. It is enabled only once
the scene has artwork, because that picture is the coordinate source. The move
is persisted server-side and reported ("Auto-adjusted 2 of 3 spots"); drag to
fine-tune and save as usual. Bundled (hand-authored) artwork keeps its
hand-placed pins — the pass needs a generated, hosted picture to read.

**✦ Auto-adjust all spots** (toolbar) runs the same pass across the whole
topic: every scene with generated artwork is re-read and re-placed in one run.
Each scene is persisted as it finishes (a failure keeps earlier progress), and
the studio reloads the pins from the saved topic afterwards. Scenes without
generated artwork are skipped and counted in the report.


## Globe worlds (view: "globe") — the 3D Earth

A globe topic is **another form of immersive view**: instead of entering through a
picture, the child lands on a playable 3D Earth — drag to spin it, pinch/scroll or
the +/− buttons to zoom, and tap the glowing place spots to open their info cards
and step inside (the same journey machinery, info cards, TTS and progress as every
other world). Globe worlds carry **no bundled content**: every scene is generated
by the superadmin through the Studio — an image scene painted by the same artwork
pipeline as every other world, pinned onto the planet.

The data model stays a normal pack, with three additions:

- The pack carries `view: "globe"`; its ROOT scene is the **globe hub** — it
  renders no artwork (the globe is drawn by code) and may have zero hotspots
  while the world is fresh. Its narration is the welcome text.
- The hub's hotspots are **globe spots**: doorways carrying `lat`/`lng`
  (degrees), a `level` (`"country"`, `"city"` or `"location"`) and optionally a
  `countryId` (ISO-3166 alpha-2). Everything else (label, blurb, info card,
  audio) works exactly as on a picture.
- The zoom is the level of detail, and the layers are **exclusive**: country
  spots show first; zoom into the city band and the country pins fade away,
  replaced by city pins; zoom again and only landmark pins remain
  (`LEVEL_ZOOM` in `web/src/lib/wikido/globe/projection.js`).

The planet itself is drawn from **real geography**: country borders come from
Natural Earth 110m (public domain), generated into
`web/src/lib/wikido/globe/borders.js` by
`web/scripts/generate-globe-borders.mjs` (re-run it after editing the
gazetteer). Countries fill the land and stroke their political borders —
enclaves included — and city/landmark pins wear a boundary ring while their
layer is active. Both the child explorer and the studio editor render the same
planet through `web/src/lib/wikido/globe/render.js`; the stylized continents in
`land.js` stand in only until the borders chunk loads.

The sequence children explore in is simply the hub's doorway order — the map's
reorder controls and the spot ↑/↓ buttons set it, as in picture worlds.

### Growing a globe world (superadmin)

1. **Create the world** — the Studio's create form has a "🌍 3D globe world"
   checkbox (`createWikidoGlobeTopic`). The model writes only the shelf copy and
   the welcome narration; a flaky answer falls back to deterministic copy.
2. **Pin places by name** — type "Pakistan", "Lahore" or "Eiffel Tower" into the
   "Pin a place" bar (`generateWikidoGlobeScene`). The system resolves WHERE the
   place is from the bundled **gazetteer** (`functions/lib/wikidoGazetteer.js` —
   every country with its capital plus ~270 major cities, alias-tolerant: "USA",
   "uk", "Türkiye" all resolve); anything the gazetteer doesn't know (landmarks,
   natural wonders) is resolved by the model with real coordinates. The agent
   then writes the scene (title, narration, art prompt, 3–5 fact hotspots) and
   pins the doorway spot on the hub at the place's coordinates with the right
   level. The scene is a normal draft scene — press **Generate artwork** and the
   same image pipeline paints it (spot placement included). A place already
   pinned is refused, not duplicated.
3. **Paint, curate, publish** — artwork, voiceovers, spot details and the
   publish gate work as everywhere else. The hub itself is skipped by artwork
   generation (it renders code, not a picture); the Studio shows the **globe
   editor** in its place — the same bordered planet with every pinned place on
   it. Pins are numbered like the places list, clicking one opens its editor
   row, and a pin can be **dragged to a new position** (the editor inverts the
   projection back to lat/lng). Dragging is optional fine-tuning: every place's
   coordinates are pre-saved from the gazetteer when it is pinned, so pins sit
   exactly right by default, and a drag stays unsaved until Save edits. The
   bundled **Our Amazing Earth** world ships as this empty shell — open it in
   the Studio and pin away.

Deeper scenes under a place still work the picture-world way (a doorway on
Pakistan's artwork opens a deeper scene) — the globe is the top-level map, the
scene trees inside stay untouched.

## Editing bundled worlds in Studio

Superadmins can select a bundled world and use the normal scene, spot, artwork,
voiceover, and hierarchy editor. Its first save creates a draft in `wikidoTopics`
under the same topic ID, preserving the complete bundled content and asset paths.
Publish uses the normal validation gate. Students see the published override in
place of the bundled version, with a single shelf entry. Until publication, the
original bundled world remains available to students; superadmins can preview
the draft. Existing saved edits take precedence over future app bundles.

**Restore bundled version** deletes the override and its generated Storage
assets, returning to the original shipped content. The static bundled artwork
and recordings remain intact. Editing access stays superadmin-only.


Scene deletion saves replace the complete scene map, so Firestore recursive
merging cannot restore removed scenes. Removing a local doorway confirms and
removes its branch. Deleting only a scene promotes its children to its parent;
deleting the entire branch removes its descendants — except descendants that
are SHARED (also opened from a spot outside the branch), which stay standing
for their other doors.

Save/publish repairs disconnected leftovers from older edits and missing
local targets, and restores a missing external-world ID only when the target
has one unambiguous owning world. Repairs preserve fact-card content and leave
ambiguous links for validation. The original pack is retained in the topic's
`editBackups` subcollection before an automatic repair is persisted.
