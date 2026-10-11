// Wikido topic pack: CIVILIZATIONS — hand-curated, kid-friendly (≈ages 7–11).
// Scene graph (each hotspot with childSceneId drills deeper, Gemini-Immersive style):
//
//   civilizations-overview            — the concept + its aspects
//     ├─ persian-empire               — Persepolis panorama
//     │    ├─ gate-of-all-nations     — the winged-bull gateway
//     │    ├─ tachara                 — the mirror palace
//     │    ├─ royal-road              — the empire's highway
//     │    │    └─ royal-messenger    — the king's rider
//     │    └─ apadana-palace          — the grand audience hall
//     │         └─ bull-capitals      — anatomy of a column top
//     ├─ mesopotamia                  — the first cities
//     │    └─ cuneiform               — the first writing
//     └─ rivers-and-farming           — water makes cities grow
//
// Hotspot x/y are percentages of the artwork. Artwork is pre-generated in the
// developer environment with functions/scripts/generate-wikido-art.mjs (each
// scene carries its curated `artPrompt`), then hotspot anchors are re-measured
// against the final image (press H in Wikido in dev for a live % crosshair).
export default {
  id: "civilizations",
  title: "Civilizations",
  emoji: "🏛️",
  tagline: "How people turned villages into cities, empires, and big ideas",
  cover: { src: "/wikido/civilizations/civilizations-overview.jpg", alt: "An ancient river valley with a mudbrick city, a stone temple, and a palace on a hill" },
  rootSceneId: "civilizations-overview",
  // Shared style for the topic's pre-generated artwork.
  artStyle:
    "Warm, highly detailed cinematic digital illustration with a soft painterly finish, golden-hour lighting, rich stone and earth textures, gentle atmospheric haze, child-friendly storybook realism, no text, no words, no lettering. Wide 16:9 composition.",
  scenes: {
    "civilizations-overview": {
      id: "civilizations-overview",
      title: "Civilizations",
      artPrompt:
        "Sweeping establishing view of an ancient river valley at golden hour, seen from a low hill. COMPOSITION (left to right): a wide blue-green river curves through the bottom-LEFT corner with bright green irrigated farm strips along its banks; on the LEFT THIRD a busy mudbrick city with a huge stepped ziggurat temple tower rises at mid-height; in the CENTRE FOREGROUND a walled town with a wooden gate, tiny market stalls and date palms sits closest to the viewer; on the CENTRE-RIGHT a small white stone temple with columned porch and a sacred flame stands on a low hill; on the RIGHT THIRD a grand palace with a columned terrace and colourful banners crowns a high hill, a pale dirt road winding up to it with a tiny camel caravan. Distant hazy mountains on the horizon, warm glowing sky with a soft sun high on the right.",
      image: {
        src: "/wikido/civilizations/civilizations-overview.jpg",
        alt: "An ancient river valley: farms along a river, a mudbrick city with a ziggurat, a stone temple, and a palace on a distant hill",
      },
      narration:
        "Long ago, most people lived in small villages. Then something amazing happened: they learned to grow extra food, build cities, and share jobs. That big change is called a civilization. Explore this valley to discover what a civilization really is — and then step inside the first cities and one of the greatest empires ever!",
      audio: "/wikido/civilizations/audio/civilizations-overview.mp3",
      hotspots: [
        {
          id: "what-is",
          label: "What is a Civilization?",
          blurb: "Big teams + big ideas",
          x: 50,
          y: 76,
          audio: "/wikido/civilizations/audio/civilizations-overview.what-is.mp3",
          info: {
            title: "What is a Civilization?",
            body: [
              "A civilization is a large group of people who live together in cities and share a way of life — their laws, food, art, games, and stories.",
              "Instead of doing everything alone, people shared the work: farmers grew food, builders raised walls, scribes kept records, and artists made beautiful things. Together they could build what no single family ever could.",
            ],
            fact: "The word civilization comes from civitas, the Latin word for city.",
          },
        },
        {
          id: "first-cities",
          label: "The First Cities",
          blurb: "Step into Mesopotamia",
          x: 16,
          y: 38,
          childSceneId: "mesopotamia",
          audio: "/wikido/civilizations/audio/civilizations-overview.first-cities.mp3",
          info: {
            title: "The First Cities",
            body: [
              "The very first cities grew in a land called Mesopotamia, 'the land between two rivers', about 6,000 years ago.",
              "Cities were noisy, busy places: markets full of traders, workshops full of craftworkers, and giant temple towers called ziggurats rising over the rooftops. Step in and look around!",
            ],
            fact: "The ancient city of Uruk may have been the first city ever — as many as 80,000 people lived there.",
          },
        },
        {
          id: "rivers",
          label: "Rivers & Farming",
          blurb: "Follow the water that feeds everyone",
          x: 31,
          y: 62,
          childSceneId: "rivers-and-farming",
          audio: "/wikido/civilizations/audio/civilizations-overview.rivers.mp3",
          info: {
            title: "Rivers & Farming",
            body: [
              "Every early civilization grew up beside a river. When rivers flooded, they left behind soft, rich mud that was perfect for growing crops.",
              "Farmers learned to dig canals and store grain. With extra food, some people could stop farming and become builders, priests, artists, and kings — that is how cities began.",
            ],
            fact: "Egypt is called 'the gift of the Nile' because its river made the desert bloom.",
          },
        },
        {
          id: "writing",
          label: "Writing & Records",
          blurb: "The first words were shopping lists!",
          x: 67,
          y: 51,
          audio: "/wikido/civilizations/audio/civilizations-overview.writing.mp3",
          info: {
            title: "Writing & Records",
            body: [
              "As cities grew, people needed to remember things: who owned which field, how much grain was stored, who paid their taxes.",
              "Scribes pressed a cut reed into soft clay to make wedge-shaped marks called cuneiform — the world's first writing. Later, writing carried laws, letters, prayers, and stories too.",
            ],
            fact: "The oldest writing was used for records and receipts — not storybooks!",
          },
        },
        {
          id: "empires",
          label: "Great Empires",
          blurb: "Step into the Persian Empire",
          x: 90,
          y: 33,
          childSceneId: "persian-empire",
          audio: "/wikido/civilizations/audio/civilizations-overview.empires.mp3",
          info: {
            title: "Great Empires",
            body: [
              "When one civilization grows strong enough to rule many lands and many peoples, it becomes an empire.",
              "The Persian Empire was the largest the world had ever seen — stretching from Egypt to India, connected by roads, messengers, and one wise idea: let every people keep their own language and customs.",
            ],
            fact: "At its height, nearly half of all the people on Earth lived under Persian rule.",
          },
        },
      ],
    },

    "persian-empire": {
      id: "persian-empire",
      title: "Persian Empire & Persepolis",
      artPrompt:
        "Cinematic wide view of Persepolis, the stone ceremonial terrace of the Persian Empire, seen from its courtyard at golden hour. COMPOSITION (left to right): on the FAR LEFT a massive stone gateway framed by thick walls, flanked by two colossal winged-bull statues with bearded human heads guarding the entrance; LEFT-OF-CENTRE the Apadana audience hall rises behind the terrace, a forest of very tall slim stone columns topped with double-bull capitals under a long wooden roof; on a raised stone platform in the CENTRE-RIGHT a small elegant palace with polished pale stone walls and a bright lapis-blue doorway; a grand double staircase with rows of carved tiny tribute-bearer reliefs descends from the terrace centre; on the FAR RIGHT a rocky mountain slope with a narrow paved royal road switchbacking up to a small watchtower. In the RIGHT FOREGROUND a royal messenger in a light tunic with a leather satchel stands beside a pale horse waiting in the paved courtyard; a row of spearmen guards stands at attention left of the staircase. Warm dusty light, hazy mountains behind.",
      image: {
        src: "/wikido/civilizations/persian-empire.jpg",
        alt: "Persepolis: a grand stone terrace with the Gate of All Nations, the columned Apadana Palace, the small Tachara palace, and the Royal Road winding over the mountains",
      },
      narration:
        "Persepolis was the magnificent ceremonial capital of the Persian Empire, built to impress visitors with grand stone columns and massive gateways. Every spring, people from different lands traveled here to offer gifts to the king. This spectacular gathering place united a diverse population under one powerful, peaceful rule.",
      audio: "/wikido/civilizations/audio/persian-empire.mp3",
      hotspots: [
        {
          id: "gate",
          label: "Gate of All Nations",
          blurb: "Step up to the winged giants",
          x: 17,
          y: 62,
          childSceneId: "gate-of-all-nations",
          audio: "/wikido/civilizations/audio/persian-empire.gate.mp3",
          info: {
            title: "Gate of All Nations",
            body: [
              "Every visitor to Persepolis walked through this mighty gateway, no matter which of the empire's many lands they came from.",
              "It was guarded by lamassu — colossal winged bulls with bearded human heads, meant to protect the king and welcome all peoples.",
            ],
            fact: "Lamassu statues were carved with five legs: from the front the bull stands still, from the side it appears to be walking!",
          },
        },
        {
          id: "apadana",
          label: "Apadana Palace",
          blurb: "The grand audience hall — step inside",
          x: 33,
          y: 30,
          childSceneId: "apadana-palace",
          audio: "/wikido/civilizations/audio/persian-empire.apadana.mp3",
          info: {
            title: "Apadana Palace",
            body: [
              "This was the great audience hall of the kings, big enough for thousands of guests, with seventy-two towering stone columns holding up a wooden roof.",
              "Here the king sat on a high throne, receiving gifts and greetings from envoys of twenty-three different nations.",
            ],
            fact: "The Apadana's columns stood as tall as a six-storey building.",
          },
        },
        {
          id: "tachara",
          label: "Tachara",
          blurb: "Enter the mirror palace",
          x: 66,
          y: 47,
          childSceneId: "tachara",
          audio: "/wikido/civilizations/audio/persian-empire.tachara.mp3",
          info: {
            title: "Tachara",
            body: [
              "This exclusive palace served as the private home of King Darius the Great.",
              "Its stones were polished so smoothly that they reflected light like mirrors, filling the rooms with a glittering glow — a dazzling symbol of royal comfort and power.",
            ],
            fact: "'Tachara' is often translated as 'mirror palace' because of its gleaming polished walls.",
          },
        },
        {
          id: "royal-road",
          label: "Royal Road",
          blurb: "Ride the empire's information highway",
          x: 89,
          y: 46,
          childSceneId: "royal-road",
          audio: "/wikido/civilizations/audio/persian-empire.royal-road.mp3",
          info: {
            title: "Royal Road",
            body: [
              "The Royal Road ran more than 2,500 kilometres across the empire, from near the sea all the way to Persia's heartland.",
              "Stations with fresh horses stood along the way, so royal messengers could race from one end to the other in about a week — lightning speed for the ancient world.",
            ],
            fact: "The Greek writer Herodotus said of these messengers: 'Neither snow nor rain nor heat nor gloom of night stays these couriers.'",
          },
        },
        {
          id: "messenger",
          label: "Royal Messenger",
          blurb: "Ride with the fastest post in the ancient world",
          x: 76,
          y: 80,
          childSceneId: "royal-messenger",
          audio: "/wikido/civilizations/audio/persian-empire.messenger.mp3",
          info: {
            title: "Royal Messenger",
            body: [
              "Royal messengers carried sealed letters along the Royal Road, swapping tired horses for fresh ones at stations the Persians called paradayadava.",
              "Thanks to them, the king could hear of a rebellion on the far frontier and send back his orders within days — which is part of how one ruler could hold such a vast empire together.",
            ],
            fact: "A message could travel 2,000 miles in a week — each rider only carrying it for one day's stretch.",
          },
        },
      ],
    },

    "gate-of-all-nations": {
      id: "gate-of-all-nations",
      title: "Gate of All Nations",
      artPrompt:
        "Close-up of the Gate of All Nations at Persepolis, seen from just inside the entrance passage at golden hour. COMPOSITION: a monumental gateway of huge square stone blocks fills the frame, a tall stone doorway open in the centre; on the LEFT and RIGHT two colossal lamassu statues guard the gate — winged bulls with curly-bearded human heads and tall horned crowns, carved from pale sandstone; through the open doorway a sunlit courtyard with tiny colourful figures of visitors from many nations walks toward the light; a carved border of rosettes runs above the doorway. Strong warm shadows, dust in the light, towering scale.",
      image: {
        src: "/wikido/civilizations/gate-of-all-nations.jpg",
        alt: "The Gate of All Nations: colossal winged-bull statues flanking a tall stone doorway with visitors passing through",
      },
      narration:
        "Every traveler — Babylonian scribes, Egyptian goldsmiths, Greek athletes, Indian spice traders — passed through this single gateway when they arrived at Persepolis. The great lamassu watching over the door reminded everyone whose city they were entering, and welcomed them at the very same time.",
      audio: "/wikido/civilizations/audio/gate-of-all-nations.mp3",
      hotspots: [
        {
          id: "lamassu",
          label: "The Lamassu",
          blurb: "Winged guardian of the gate",
          x: 30,
          y: 50,
          audio: "/wikido/civilizations/audio/gate-of-all-nations.lamassu.mp3",
          info: {
            title: "The Lamassu",
            body: [
              "A lamassu is a mythical guardian: the body of a bull, huge wings of an eagle, and the bearded head of a man wearing a horned crown.",
              "Bull bodies meant strength, wings meant swiftness, and the human head meant wisdom — everything a great guardian needed.",
            ],
            fact: "The lamassu's horns were counted in pairs — more horns meant a more powerful spirit.",
          },
        },
        {
          id: "doorway",
          label: "The Stone Doorways",
          blurb: "Doors big enough for giants",
          x: 50,
          y: 52,
          audio: "/wikido/civilizations/audio/gate-of-all-nations.doorway.mp3",
          info: {
            title: "The Stone Doorways",
            body: [
              "The gate had three doorways: a giant one in the middle for the king on his chariot, and two smaller ones for everyone else.",
              "The doors themselves were wooden, covered in sheets of shining bronze and studded with golden rosettes.",
            ],
            fact: "The tall stone doorway frames were carved with figures of the king under a winged sun disc.",
          },
        },
        {
          id: "visitors",
          label: "Peoples of the Empire",
          blurb: "Everyone passed through here",
          x: 60,
          y: 76,
          audio: "/wikido/civilizations/audio/gate-of-all-nations.visitors.mp3",
          info: {
            title: "Peoples of the Empire",
            body: [
              "Through this door walked envoys from twenty-three nations: Lydians with boots and fine wool, Egyptians in linen, Bactrians leading camels, Ethiopians carrying gifts of gold and ebony.",
              "Each people was welcomed in their own dress and language — the Persian kings believed an empire stayed peaceful when its peoples could stay themselves.",
            ],
            fact: "Carvings on the stairways show each nation clearly — archaeologists can name them by their hats and shoes!",
          },
        },
        {
          id: "builder",
          label: "Xerxes the Builder",
          blurb: "The king who finished the gate",
          x: 50,
          y: 18,
          audio: "/wikido/civilizations/audio/gate-of-all-nations.builder.mp3",
          info: {
            title: "Xerxes the Builder",
            body: [
              "The gate was begun by King Darius the Great and finished by his son Xerxes, who left an inscription over the door.",
              "It says the gate was built 'for the delight of all peoples' — a grand welcome carved in stone.",
            ],
            fact: "The inscription calls Xerxes 'the king of kings' — a title Persian kings loved to use.",
          },
        },
      ],
    },

    "tachara": {
      id: "tachara",
      title: "Tachara — The Mirror Palace",
      artPrompt:
        "Interior of the Tachara palace at Persepolis, warm afternoon light. COMPOSITION: a stone hall with walls of polished pale stone so smooth they glow like mirrors, reflecting the light; tall stone doorways with carved lintels line the left wall; sunlight pours through high windows on the right in bright slanting beams filled with dust motes; the far wall carries carved reliefs of servants carrying food, and guardian lions; a raised stone throne platform at the centre-back; folded woollen rugs in deep red and blue on the polished floor; delicate stone rosettes along the ceiling band. Warm gold and cool stone tones, majestic and calm.",
      image: {
        src: "/wikido/civilizations/tachara.jpg",
        alt: "Inside the Tachara palace: polished stone walls glowing like mirrors, sunbeams through high windows, carved reliefs and red-and-blue rugs",
      },
      narration:
        "This was the private palace of King Darius the Great. Its stones were rubbed and polished until they shone like water, so even a candle flame made the whole room glitter. On winter days the southern windows drank in the sunshine — the mirror palace was built to be the cosiest place in the empire.",
      audio: "/wikido/civilizations/audio/tachara.mp3",
      hotspots: [
        {
          id: "walls",
          label: "Walls of Mirrors",
          blurb: "Stone polished to shine",
          x: 24,
          y: 45,
          audio: "/wikido/civilizations/audio/tachara.walls.mp3",
          info: {
            title: "Walls of Mirrors",
            body: [
              "The stones of Tachara were cut and rubbed until they reflected light like still water — there were no glass mirrors at all; the walls themselves were the mirrors.",
              "When sunlight hit the walls in the afternoon, the whole hall glowed as if it were lit from inside.",
            ],
            fact: "You can still see the polish on Tachara's stones today — more than 2,500 years later!",
          },
        },
        {
          id: "throne",
          label: "The King's Seat",
          blurb: "Where Darius rested his crown",
          x: 65,
          y: 60,
          audio: "/wikido/civilizations/audio/tachara.throne.mp3",
          info: {
            title: "The King's Seat",
            body: [
              "Tachara was the king's private palace — his own rooms, away from the crowds of the great halls.",
              "Here he dined with his family and closest friends on couches of gold and silver, listening to musicians while servants brought fruits and honeyed cakes.",
            ],
            fact: "Persian kings held a special day every year called 'the king's gift day' for giving presents to friends.",
          },
        },
        {
          id: "reliefs",
          label: "Carved Servants & Lions",
          blurb: "Stories carved in the walls",
          x: 82,
          y: 50,
          audio: "/wikido/civilizations/audio/tachara.reliefs.mp3",
          info: {
            title: "Carved Servants & Lions",
            body: [
              "The doorways of Tachara are framed with carvings of servants carrying towels, flower vases and little bottles of oil — everything a royal guest could need.",
              "Lions and monsters guard the corners, chasing away bad luck and evil spirits.",
            ],
            fact: "Each servant carving carries something slightly different — see if you can spot the lotus flowers!",
          },
        },
        {
          id: "winter-sun",
          label: "Winter Sunshine",
          blurb: "A palace built for warm winters",
          x: 90,
          y: 28,
          audio: "/wikido/civilizations/audio/tachara.winter-sun.mp3",
          info: {
            title: "Winter Sunshine",
            body: [
              "Tachara faces south, so the low winter sun streams straight through its tall windows — the palace is cosy even on cold mountain days.",
              "In summer, thick stone walls kept the same rooms cool. The builders understood the sun like a clock.",
            ],
            fact: "Tachara's stone blocks fit so tightly that no mortar was needed — they hold each other in place by weight alone.",
          },
        },
      ],
    },

    "royal-road": {
      id: "royal-road",
      title: "The Royal Road",
      artPrompt:
        "The Persian Royal Road climbing through a high mountain pass at golden hour. COMPOSITION: a narrow paved road of fitted stone slabs switchbacks up the mountainside from the bottom-left to a small stone relay station on a shelf of rock at centre-right; the station is a walled courtyard with a low stable, a small watchtower with a torch, horses dozing at a trough and grooms in tunics; a rider on a galloping horse crosses a stone bridge in the middle distance, dust rising behind; the road continues toward hazy purple peaks with patches of snow; dry grass and wild thyme along the roadside, a pair of eagles high above.",
      image: {
        src: "/wikido/civilizations/royal-road.jpg",
        alt: "The Royal Road switchbacking up a mountain pass to a relay station with horses and a watchtower, a rider crossing a stone bridge",
      },
      narration:
        "The Royal Road stitched the huge empire together — more than 2,500 kilometres of stone-paved way, with 111 stations where royal messengers could rest, eat, and swap for a fresh horse. Ordinary travelers took three months to walk it. The king's letters made the same journey in a week.",
      audio: "/wikido/civilizations/audio/royal-road.mp3",
      hotspots: [
        {
          id: "relay",
          label: "The Relay Station",
          blurb: "Fresh horses, always ready",
          x: 30,
          y: 46,
          audio: "/wikido/civilizations/audio/royal-road.relay.mp3",
          info: {
            title: "The Relay Station",
            body: [
              "Every day's ride apart, a station stood by the road with stables, hay, a hot meal, and fresh horses waiting saddled.",
              "A messenger galloped in, handed over the sealed letter, and a fresh rider shot off again — day or night, in any weather.",
            ],
            fact: "The Persians called these stations paradayadava — 'the place where they keep horses'.",
          },
        },
        {
          id: "watchtower",
          label: "The Watchtower",
          blurb: "Eyes on the pass",
          x: 43,
          y: 35,
          audio: "/wikido/civilizations/audio/royal-road.watchtower.mp3",
          info: {
            title: "The Watchtower",
            body: [
              "Watchtowers stood beside the road on high points, guarding the pass against bandits.",
              "By day a guard watched the road; by night a torch burned at the top so travelers could find the station.",
            ],
            fact: "Some watchtowers passed warnings along with fire signals — a message could leap mountain to mountain faster than any horse.",
          },
        },
        {
          id: "paving",
          label: "Stone Paving",
          blurb: "A road built to last",
          x: 30,
          y: 80,
          audio: "/wikido/civilizations/audio/royal-road.paving.mp3",
          info: {
            title: "Stone Paving",
            body: [
              "The road was paved with fitted stone slabs and drained at the sides, so wagons and riders could cross even after mountain rain.",
              "Building it took years of work by thousands of road-makers, masons and bridge-builders.",
            ],
            fact: "Sections of ancient paved road can still be found today, hidden under grass on hillsides.",
          },
        },
        {
          id: "bridges",
          label: "The Stone Bridge",
          blurb: "Crossing rivers without a boat",
          x: 74,
          y: 77,
          audio: "/wikido/civilizations/audio/royal-road.bridges.mp3",
          info: {
            title: "The Stone Bridge",
            body: [
              "Where the road met a river, Persian builders threw arched stone bridges across, strong enough for chariots and herds.",
              "Arched bridges spread the weight of everything crossing them — a clever shape that engineers still use today.",
            ],
            fact: "Some Persian arched bridges still carry foot traffic after more than 2,000 years.",
          },
        },
      ],
    },

    "royal-messenger": {
      id: "royal-messenger",
      title: "The King's Messenger",
      artPrompt:
        "Close-up of a Persian royal messenger riding a galloping horse along a mountain road at dawn. COMPOSITION: the horse and rider fill the centre of the frame, mid-gallop with mane and tail flying, breath steaming in the cold morning air; the messenger wears a fitted tunic with a belt, a travelling cloak snapping in the wind, and a leather satchel slung across his back holding a rolled letter sealed with clay; his headwrap streams back; behind him the paved road curves past a relay station with a lit torch and a groom holding a fresh horse; low golden sun, long shadows, dust motes sparkling.",
      image: {
        src: "/wikido/civilizations/royal-messenger.jpg",
        alt: "A royal messenger galloping a horse along a mountain road at dawn, a sealed letter in his satchel, a relay station behind",
      },
      narration:
        "This is the fastest post in the ancient world. The messenger rides one day's stretch, hands the sealed letter to a fresh rider, and sleeps while the letter flies on — snow, rain, heat, or darkness never stops it. A royal order can cross the whole empire in seven days.",
      audio: "/wikido/civilizations/audio/royal-messenger.mp3",
      hotspots: [
        {
          id: "letter",
          label: "The Sealed Letter",
          blurb: "Orders no one may open",
          x: 50,
          y: 36,
          audio: "/wikido/civilizations/audio/royal-messenger.letter.mp3",
          info: {
            title: "The Sealed Letter",
            body: [
              "The king's orders were written on a rolled leather or parchment scroll and sealed in clay stamped with the king's own seal.",
              "Nobody along the way was allowed to open it — the seal proved who sent it and kept the words secret.",
            ],
            fact: "Pressing your own special seal into clay worked like a signature — every seal had its own pattern.",
          },
        },
        {
          id: "satchel",
          label: "The Courier's Satchel",
          blurb: "Everything a rider needs",
          x: 44,
          y: 44,
          audio: "/wikido/civilizations/audio/royal-messenger.satchel.mp3",
          info: {
            title: "The Courier's Satchel",
            body: [
              "A messenger travelled light: a waterproof leather satchel for letters, a waterskin, a little bag of barley bread and dates, and a spare headwrap.",
              "Nothing clanked or rattled — a fast courier made no noise for bandits to hear.",
            ],
            fact: "Riders wore no armour at all — speed was their only protection.",
          },
        },
        {
          id: "horse",
          label: "The King's Horses",
          blurb: "Bred for the long road",
          x: 72,
          y: 55,
          audio: "/wikido/civilizations/audio/royal-messenger.horse.mp3",
          info: {
            title: "The King's Horses",
            body: [
              "Royal couriers rode strong Nisaean horses, famous across the ancient world for their speed and stamina.",
              "At every station a fresh, saddled horse stood waiting — the tired one was groomed, fed and rested for the next rider.",
            ],
            fact: "Swapping horses instead of resting them was the trick: the letter travels at full gallop all day long.",
          },
        },
        {
          id: "weather",
          label: "Snow, Rain or Night",
          blurb: "Nothing stops the post",
          x: 12,
          y: 45,
          audio: "/wikido/civilizations/audio/royal-messenger.weather.mp3",
          info: {
            title: "Snow, Rain or Night",
            body: [
              "The Greek writer Herodotus watched this post in action and wrote that neither snow nor rain nor heat nor gloom of night ever kept these couriers from their rounds.",
              "That line was so admired that it now hangs over post offices on the other side of the world, thousands of years later.",
            ],
            fact: "Herodotus's description is now the unofficial motto of the United States Postal Service!",
          },
        },
      ],
    },

    "apadana-palace": {
      id: "apadana-palace",
      title: "Apadana Palace",
      artPrompt:
        "Interior of the Apadana palace audience hall, looking up between giant columns. COMPOSITION: the upper quarter shows massive dark cedar roof beams; below them, giant slim stone columns rise through the whole frame, each crowned with a carved double-bull capital (two bulls back to back) — one column dominating the centre, two more at the left and right edges; the columns have scroll-shaped volutes below the bulls, a collar of carved lotus leaves, and long fluted shafts; behind the columns a stone balustrade wall carved with rows of tiny tribute-bearer reliefs, and in the middle distance a wide ceremonial staircase descends with a few tiny visitors walking on it for scale. Warm sunlight slants through the hall, dust motes in the light, hazy mountains visible between the columns.",
      image: {
        src: "/wikido/civilizations/apadana-palace.jpg",
        alt: "Inside the Apadana: a forest of towering fluted columns topped by bull capitals, a wooden roof above, and a carved staircase with lines of gift-bearers",
      },
      narration:
        "This grand audience hall welcomed guests with seventy-two towering stone pillars and detailed carvings of tribute bearers. Kings used this massive space to receive visitors and show off their vast wealth. This spectacular display of art and architecture helped secure the empire's unity by inspiring absolute awe in every traveler.",
      audio: "/wikido/civilizations/audio/apadana-palace.mp3",
      hotspots: [
        {
          id: "bull-capitals",
          label: "Bull Capitals",
          blurb: "Giant stone bulls hold up the roof — look closer",
          x: 50,
          y: 19,
          childSceneId: "bull-capitals",
          audio: "/wikido/civilizations/audio/apadana-palace.bull-capitals.mp3",
          info: {
            title: "Bull Capitals",
            body: [
              "At the very top of each column sit giant stone bulls, carved back to back.",
              "Their strong backs held the enormous wooden roof beams. Look closer — every part of this column top has a job to do.",
            ],
            fact: "Each bull was carved from a single block of stone heavier than a car.",
          },
        },
        {
          id: "columns",
          label: "Towering Columns",
          blurb: "As tall as a six-storey building",
          x: 25,
          y: 65,
          audio: "/wikido/civilizations/audio/apadana-palace.columns.mp3",
          info: {
            title: "Towering Columns",
            body: [
              "Seventy-two slim columns filled the Apadana, each about 20 metres tall — yet they were assembled from stone drums stacked like beads on a rod.",
              "Their shallow grooves, called flutes, caught the sunlight and made the columns look even taller, like a stone forest.",
            ],
            fact: "Only one Apadana column still stands at Persepolis today — the rest fell over 2,500 years.",
          },
        },
        {
          id: "stairway",
          label: "Stairs of Nations",
          blurb: "23 nations carved in stone",
          x: 67,
          y: 73,
          audio: "/wikido/civilizations/audio/apadana-palace.stairway.mp3",
          info: {
            title: "Stairs of Nations",
            body: [
              "The walls of the great staircase are carved with long lines of people climbing: envoys from twenty-three nations bringing gifts to the king.",
              "Look closely and you can tell them apart by their clothes and hats — Lydians with boots, Ethiopians with gifts of gold, Babylonians in long robes.",
            ],
            fact: "These carvings survive today — a 2,500-year-old parade frozen in stone.",
          },
        },
      ],
    },

    "bull-capitals": {
      id: "bull-capitals",
      title: "Bull Capitals",
      artPrompt:
        "Close-up of a single ancient Persian column capital against a dreamy golden sunset sky with soft clouds, centred in the frame. From top to bottom: a massive dark wooden roof beam; directly beneath it the capital of two large carved stone BULLS standing back to back, their folded legs tucked under their chests, horns curving forward, in pale limestone catching violet-tinted sunset light; below the bulls a pair of elegant scroll-shaped stone volutes like rolled petal fans; below that a collar of carved lotus leaves; and continuing down out of frame a long slim fluted column shaft with dozens of shallow vertical grooves catching the warm light. Architectural detail photography feel, shallow depth of field, majestic and calm.",
      image: {
        src: "/wikido/civilizations/bull-capitals.jpg",
        alt: "Close-up of a single Apadana column: two bulls back to back at the top, scroll-shaped volutes below them, a collar of lotus leaves, and a long fluted shaft",
      },
      narration:
        "These giant stone carvings of double-headed bulls sit at the very top of the palace columns. They were designed to hold up massive wooden roof beams in their cradles. This clever engineering allowed the Apadana Palace to have incredibly wide, open halls that showed off the ultimate power of the Persian Empire.",
      audio: "/wikido/civilizations/audio/bull-capitals.mp3",
      hotspots: [
        {
          id: "impost",
          label: "Double-Bull Impost",
          blurb: "Two bulls, back to back",
          x: 49,
          y: 30,
          audio: "/wikido/civilizations/audio/bull-capitals.impost.mp3",
          info: {
            title: "Double-Bull Impost",
            body: [
              "Two mighty bulls stand back to back at the top of the column, their front legs folded beneath them.",
              "The hollow between their backs made a perfect cradle for the enormous wooden roof beam above — no nails, just clever shapes and gravity.",
            ],
            fact: "'Impost' is the builder's word for the very top block of a column that carries the load.",
          },
        },
        {
          id: "volutes",
          label: "Vertical Volutes",
          blurb: "Giant stone scrolls",
          x: 49,
          y: 53,
          audio: "/wikido/civilizations/audio/bull-capitals.volutes.mp3",
          info: {
            title: "Vertical Volutes",
            body: [
              "Under the bulls curl a pair of scroll shapes, like rolled-up petal fans seen from the side.",
              "They spread the bulls' heavy weight out sideways so the slim column below could carry it.",
            ],
            fact: "'Volute' comes from the Latin word voluta — a scroll.",
          },
        },
        {
          id: "lotus",
          label: "Lotus Collar",
          blurb: "A ring of new life",
          x: 49,
          y: 68,
          audio: "/wikido/civilizations/audio/bull-capitals.lotus.mp3",
          info: {
            title: "Lotus Collar",
            body: [
              "Below the scrolls is a collar of carved lotus leaves, opening like a flower around the column.",
              "In the ancient world the lotus stood for new life and rebirth — a hopeful symbol hiding inside a building!",
            ],
            fact: "Lotus flowers close underwater at night and open fresh every morning.",
          },
        },
        {
          id: "shaft",
          label: "Fluted Shaft",
          blurb: "Grooves that catch the light",
          x: 50,
          y: 85,
          audio: "/wikido/civilizations/audio/bull-capitals.shaft.mp3",
          info: {
            title: "Fluted Shaft",
            body: [
              "The long column below is carved with dozens of shallow grooves called flutes.",
              "Flutes made the column shimmer as the sun moved, and tricked the eye into seeing it as even slimmer and taller. Each column was built from stacked stone drums, flute by flute.",
            ],
            fact: "Some Apadana columns were polished so finely that archaeologists found traces of gold leaf on their tops.",
          },
        },
      ],
    },

    "mesopotamia": {
      id: "mesopotamia",
      title: "Mesopotamia — The First Cities",
      artPrompt:
        "A street-level view inside one of the world's first cities, Mesopotamia, 6,000 years ago, at golden hour. COMPOSITION: on the LEFT a gigantic stepped ziggurat temple tower of mudbrick rises above the rooftops, its wide staircase crowded with tiny worshippers carrying offerings; around it a dense city of flat-roofed mudbrick houses with small high windows and rooftop awnings; in the CENTRE a busy market street with market stalls shaded by woven reed canopies, traders with clay jars of dates, beer and wool, donkeys carrying bundles; on the RIGHT a tree-lined irrigation canal with wooden boats loaded with reed baskets; people in simple wool garments everywhere, warm dusty light, pigeons on the rooftops.",
      image: {
        src: "/wikido/civilizations/mesopotamia.jpg",
        alt: "A Mesopotamian city street: a giant stepped ziggurat, mudbrick houses, a busy market and an irrigation canal with small boats",
      },
      narration:
        "Welcome to Mesopotamia, 'the land between two rivers'. Six thousand years ago the world's first cities rose here, with crowded markets, canals full of boats, and temple towers so tall they seemed to touch the sky. Life in a city needed rules, records, and teamwork — the very beginnings of civilization.",
      audio: "/wikido/civilizations/audio/mesopotamia.mp3",
      hotspots: [
        {
          id: "ziggurat",
          label: "The Ziggurat",
          blurb: "A stairway to the gods",
          x: 24,
          y: 25,
          audio: "/wikido/civilizations/audio/mesopotamia.ziggurat.mp3",
          info: {
            title: "The Ziggurat",
            body: [
              "A ziggurat is a giant stepped tower of mudbrick with a temple on top — the tallest thing in any Sumerian city.",
              "People believed the god of the city lived at the top. Priests climbed the stairs every day with food and drink for the god's statue.",
            ],
            fact: "Ziggurats were as tall as a ten-storey building and took decades to build.",
          },
        },
        {
          id: "mudbrick",
          label: "Houses of Mud and Sun",
          blurb: "Bricks baked by the weather",
          x: 30,
          y: 60,
          audio: "/wikido/civilizations/audio/mesopotamia.mudbrick.mp3",
          info: {
            title: "Houses of Mud and Sun",
            body: [
              "There was little stone or wood here, so people built with mudbricks — clay mixed with reeds and dried in the sun.",
              "Houses huddled together for shade, with flat roofs where families slept on hot nights and cooked their evening meals.",
            ],
            fact: "Mudbrick walls could be written on while still wet — children practised their letters on them!",
          },
        },
        {
          id: "market",
          label: "The Busy Market",
          blurb: "Shopping 6,000 years ago",
          x: 55,
          y: 72,
          audio: "/wikido/civilizations/audio/mesopotamia.market.mp3",
          info: {
            title: "The Busy Market",
            body: [
              "Markets smelled of sesame oil, fresh bread and roasting fish. Traders sold dates, wool blankets, clay pots, onions, and beer drunk through a straw.",
              "There were no coins yet — shoppers paid with barley grain or swapped goods, and sharp-eyed scribes recorded every deal on little clay tablets.",
            ],
            fact: "A wool coat might 'cost' about 300 litres of barley — money you could also make into bread!",
          },
        },
        {
          id: "canal",
          label: "City Canal",
          blurb: "The river comes to town",
          x: 84,
          y: 60,
          audio: "/wikido/civilizations/audio/mesopotamia.canal.mp3",
          info: {
            title: "City Canal",
            body: [
              "Canals brought river water right into the city — for drinking, washing, watering gardens, and floating loaded boats.",
              "Canal mud had to be dredged every year, so the city appointed a special official to keep the water flowing.",
            ],
            fact: "Some Sumerian city canals were so long they needed their own bridges and locks.",
          },
        },
        {
          id: "school",
          label: "The Scribes' School",
          blurb: "Where the first writing was born — step in",
          x: 70,
          y: 65,
          childSceneId: "cuneiform",
          audio: "/wikido/civilizations/audio/mesopotamia.school.mp3",
          info: {
            title: "The Scribes' School",
            body: [
              "In a quiet courtyard near the temple, boys (and a few girls) sat cross-legged with clay tablets, learning to press wedge-shaped letters with a cut reed.",
              "Their school was called the edubba, 'the tablet house'. Lessons began at sunrise and lazy pupils were scolded loudly!",
            ],
            fact: "One ancient school report said: 'You told me to write, but my hand wandered — you beat me.' School was strict!",
          },
        },
      ],
    },

    "cuneiform": {
      id: "cuneiform",
      title: "The First Writing",
      artPrompt:
        "Close-up of a Sumerian scribe's workplace, warm lamplight. COMPOSITION: a low wooden table holding a dozen soft grey clay tablets covered in neat rows of wedge-shaped cuneiform marks, one large tablet propped on a stand at the centre; a scribe's hands hold a cut reed stylus pressing fresh wedges into a soft tablet; around the table a reed pen holder, a bowl of wet clay, a small oil lamp with a steady flame casting warm light, a string of clay counting tokens; faint shadows of a reed screen behind; dust motes in the lamplight, intimate and calm.",
      image: {
        src: "/wikido/civilizations/cuneiform.jpg",
        alt: "A scribe's desk with clay tablets covered in wedge-shaped cuneiform, a reed stylus, an oil lamp and counting tokens",
      },
      narration:
        "Writing began here — not with stories, but with sums! Merchants needed to remember who owed what, so scribes pressed wedge-shaped marks into soft clay. The clay dried hard in the sun, and the record lasted forever. We call the first writing cuneiform, which means 'wedge-shaped'.",
      audio: "/wikido/civilizations/audio/cuneiform.mp3",
      hotspots: [
        {
          id: "stylus",
          label: "The Reed Stylus",
          blurb: "A pen made from a weed",
          x: 17,
          y: 43,
          audio: "/wikido/civilizations/audio/cuneiform.stylus.mp3",
          info: {
            title: "The Reed Stylus",
            body: [
              "The first pen was a river reed cut at an angle into a triangular tip — free, and perfect for pressing sharp wedges into clay.",
              "Pressing straight down made a wedge; dragging made a line. Every letter of cuneiform is built from these two marks.",
            ],
            fact: "Scribes kept their favourite styluses for years — one was found with its owner's name carved on it.",
          },
        },
        {
          id: "wedges",
          label: "Wedges in Clay",
          blurb: "How the letters work",
          x: 48,
          y: 39,
          audio: "/wikido/civilizations/audio/cuneiform.wedges.mp3",
          info: {
            title: "Wedges in Clay",
            body: [
              "Cuneiform began as simple pictures: a circle for the sun, an ear of barley for grain, a jug for beer.",
              "Over hundreds of years the pictures turned into quicker wedge groups — over 600 signs in all. Some signs stood for words, others for sounds, like our letters.",
            ],
            fact: "The sign for 'bread' and the sign for 'water' combined make the sign for 'meal' — writing by recipe!",
          },
        },
        {
          id: "receipt",
          label: "The Tax Receipt",
          blurb: "The world's oldest paperwork",
          x: 30,
          y: 62,
          audio: "/wikido/civilizations/audio/cuneiform.receipt.mp3",
          info: {
            title: "The Tax Receipt",
            body: [
              "The very oldest tablets are receipts and lists: how many sheep entered the city gate, how much barley was paid in tax, who owed the temple five jars of beer.",
              "Only later did people trust writing with letters, prayers, laws, and finally stories and poems.",
            ],
            fact: "The oldest known written story, the Epic of Gilgamesh, was written in cuneiform about the king of Uruk.",
          },
        },
        {
          id: "clay",
          label: "Clay That Lasts Forever",
          blurb: "Why we can still read them",
          x: 56,
          y: 80,
          audio: "/wikido/civilizations/audio/cuneiform.clay.mp3",
          info: {
            title: "Clay That Lasts Forever",
            body: [
              "A scribe wrote while the clay was soft, then left it to dry in the sun — or baked it hard in a kiln for records that mattered.",
              "When later cities burned down, the fire baked buried tablets even harder. Fire that destroyed the houses preserved the writing!",
            ],
            fact: "Archaeologists have found over half a million cuneiform tablets — and many are still waiting to be read.",
          },
        },
      ],
    },

    "rivers-and-farming": {
      id: "rivers-and-farming",
      title: "Rivers of Life",
      artPrompt:
        "Farmers irrigating fields beside a wide river in ancient Mesopotamia at golden hour. COMPOSITION: the river runs along the LEFT edge; in the CENTRE two farmers work a shaduf — a wooden water-lifting pole with a clay counterweight and rope bucket — pouring water into a canal that feeds bright green barley fields; the fields stretch to the right in neat strips with taller crops; a team of oxen pulls a wooden plough in the middle distance; harvest workers with woven baskets on their shoulders walk a path between the field strips; palm trees and a small mudbrick farmhouse with a threshing floor at the RIGHT edge; warm hazy light, dragonflies over the water.",
      image: {
        src: "/wikido/civilizations/rivers-and-farming.jpg",
        alt: "Farmers watering green fields with a shaduf beside a river, oxen ploughing and workers carrying harvest baskets",
      },
      narration:
        "Every civilization begins with food. Here, farmers catch the river's yearly flood in canals, lift the water into their fields, and grow much more barley than the village can eat. That extra food frees builders, potters, priests and kings to do other work — and cities spring up.",
      audio: "/wikido/civilizations/audio/rivers-and-farming.mp3",
      hotspots: [
        {
          id: "shaduf",
          label: "The Shaduf",
          blurb: "A clever water-lifting machine",
          x: 44,
          y: 52,
          audio: "/wikido/civilizations/audio/rivers-and-farming.shaduf.mp3",
          info: {
            title: "The Shaduf",
            body: [
              "A shaduf is a long pole balanced on a post: a bucket on one end, a lump of clay on the other, working like a seesaw.",
              "The farmer pulls down to dip the bucket in the canal, then lets the counterweight lift the full bucket easily — one person can water a whole field all day.",
            ],
            fact: "The shaduf was so useful that farmers used it for more than 3,000 years — some still use it today!",
          },
        },
        {
          id: "canal",
          label: "The Great Canal",
          blurb: "Rivers in the right place",
          x: 52,
          y: 84,
          audio: "/wikido/civilizations/audio/rivers-and-farming.canal.mp3",
          info: {
            title: "The Great Canal",
            body: [
              "Villages dug long canals from the river to their fields, with little gates to let water in or shut it out.",
              "Cleaning and repairing the canals took everyone's help, so villages learned to work together under one leader — good practice for cities.",
            ],
            fact: "One Mesopotamian canal ran for over 100 kilometres — almost as long as a motorway!",
          },
        },
        {
          id: "barley",
          label: "Barley Fields",
          blurb: "The crop that built cities",
          x: 64,
          y: 61,
          audio: "/wikido/civilizations/audio/rivers-and-farming.barley.mp3",
          info: {
            title: "Barley Fields",
            body: [
              "Barley was the great crop of Mesopotamia — it grew well in salty river soil and made bread and beer.",
              "A good harvest meant grain to store for hard years, to feed workers, and to trade with faraway lands.",
            ],
            fact: "Workers were often paid in bread and beer — the standard wages of the ancient world.",
          },
        },
        {
          id: "oxen",
          label: "Oxen & Plough",
          blurb: "Animal power joins the team",
          x: 68,
          y: 45,
          audio: "/wikido/civilizations/audio/rivers-and-farming.oxen.mp3",
          info: {
            title: "Oxen & Plough",
            body: [
              "A wooden plough pulled by a pair of oxen could open far more ground than a farmer with a hoe.",
              "Sowing ploughs even dropped seeds in neat rows as they went — a Mesopotamian invention.",
            ],
            fact: "A seed-plough and a trained team let one farmer feed about fifteen city people.",
          },
        },
      ],
    },
  },
};
