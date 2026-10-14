// Registry of PUBLISHED Wikido topics. A topic goes live for every family the
// moment it's listed here — publishing is a developer action (add the pack file,
// list it, ship it), not a runtime/admin action. See docs/wikido.md.
import livingThings from "./topics/living-things.js";
import ourEarth from "./topics/our-earth.js";

export const wikidoTopicPacks = [livingThings, ourEarth];
