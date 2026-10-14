// Wikido topic pack: LIVING THINGS — hand-curated, kid-friendly (≈ages 7–11).
// Scene graph (each hotspot with childSceneId drills deeper, Gemini-Immersive style):
//
//   living-things-overview           — what makes something alive
//     ├─ kinds-of-living-things      — sorting life into big groups
//     │    ├─ types-of-animals       — mammals, birds, fish, reptiles, amphibians, insects
//     │    └─ types-of-plants        — trees, flowers, grasses, ferns, conifers
//     └─ human-beings                — what human beings are and what makes us special
//          └─ human-body             — bones, muscles, heart, lungs, brain, senses
//
// Hotspot x/y are percentages of the artwork. Artwork is pre-generated in the
// developer environment with functions/scripts/generate-wikido-art.mjs (each
// scene carries its curated `artPrompt`), then hotspot anchors are re-measured
// against the final image (press H in Wikido in dev for a live % crosshair).
export default {
  id: "living-things",
  title: "Living Things",
  emoji: "🌿",
  tagline: "What makes something alive — animals, plants, your body, and you",
  cover: { src: "/wikido/living-things/living-things-overview.jpg", alt: "A sunlit meadow with a deer and her fawn, a great oak tree, a pond with a frog, mushrooms on a mossy log, and a child examining a beetle" },
  rootSceneId: "living-things-overview",
  // Shared style for the topic's pre-generated artwork. Encyclopedia plates:
  // true to life, never abstract — the generators append a realism directive too.
  artStyle:
    "True-to-life, highly detailed naturalistic illustration like a modern children's nature encyclopedia: accurate anatomy, proportions, colors, materials and lighting, fresh morning light, real fur, feather, leaf, bark and water textures; every subject looks the way it really looks. No stylization, no abstraction, no cartoon shapes, no text, no words, no lettering. Wide 16:9 composition.",
  scenes: {
    "living-things-overview": {
      id: "living-things-overview",
      title: "Living Things",
      artPrompt:
        "Sweeping view of a sunlit meadow meeting the edge of a forest on a fresh spring morning. COMPOSITION (left to right): a shallow clear pond in the bottom-LEFT corner with lily pads, a bright green frog sitting on one pad and small fish swimming beneath the surface; on the LEFT THIRD a grand old oak tree with a broad leafy crown and a robin perched on a low branch; across the CENTRE a flowery meadow where a doe and her spotted fawn graze at mid-height; in the CENTRE FOREGROUND a fallen mossy log dotted with clusters of pale mushrooms, a rabbit hopping nearby; on the RIGHT THIRD the forest rises in tall pines; in the RIGHT FOREGROUND a curious young child kneels in the grass examining a shiny beetle through a magnifying glass, a small backpack beside them; a white butterfly and two bees fly among the foreground flowers. Blue sky with soft clouds, warm glowing morning light.",
      image: {
        src: "/wikido/living-things/living-things-overview.jpg",
        alt: "A sunlit meadow: a pond with a frog, an old oak tree, a doe and fawn grazing, mushrooms on a mossy log, and a child examining a beetle with a magnifying glass",
      },
      narration:
        "Look around this meadow — it is crowded with life! The deer, the frog, the oak tree, the mushrooms, even the tiny beetle: they are all alive. But what does being alive really mean? Explore the meadow to discover the signs of life, and then step deeper to meet the great families of living things — and find out where you fit in!",
      audio: "/wikido/living-things/audio/living-things-overview.mp3",
      hotspots: [
        {
          id: "signs-of-life",
          label: "The Signs of Life",
          blurb: "How to tell something is alive",
          x: 41,
          y: 56,
          audio: "/wikido/living-things/audio/living-things-overview.signs-of-life.mp3",
          info: {
            title: "The Signs of Life",
            body: [
              "How can you tell that the deer, the frog and the beetle are alive, but a stone is not? Scientists look for the signs of life: living things grow, need food, breathe, respond to the world around them, and eventually have young of their own.",
              "Living things can also get sick and heal, and — with a microscope — you can see their most amazing secret: every living thing is built from tiny building blocks called cells. You have trillions of them!",
            ],
            fact: "A car can move and use fuel, but it does not grow, heal, or make baby cars — so it is not alive.",
          },
        },
        {
          id: "needs-of-life",
          label: "What Life Needs",
          blurb: "Food, water, air, warmth, space",
          x: 14,
          y: 65,
          audio: "/wikido/living-things/audio/living-things-overview.needs-of-life.mp3",
          info: {
            title: "What Life Needs",
            body: [
              "Every living thing needs the same basic things to survive: energy from food, water, air, warmth, and a place to live that suits it — its habitat.",
              "Different living things get what they need in different ways. Deer eat plants, frogs catch insects, and oak trees make their own food from sunlight, water and air.",
            ],
            fact: "Every place scientists have ever looked for life on Earth — from scorching deserts to the pitch-black deep sea — they have found it. Where there is water, there is usually life.",
          },
        },
        {
          id: "alive-once-never",
          label: "Alive, Once Alive, Never Alive",
          blurb: "Sort everything into three groups",
          x: 44,
          y: 77,
          audio: "/wikido/living-things/audio/living-things-overview.alive-once-never.mp3",
          info: {
            title: "Alive, Once Alive, Never Alive",
            body: [
              "Scientists love sorting! Things that are alive right now include the frog, the oak tree and the mushrooms. Things that were once alive include the mossy log (it was part of a tree), a feather on the ground, and the paper in your notebook.",
              "Things that were never alive include stones, water, sunlight, bicycles and robots. Here is a puzzle: a wooden chair is not alive — but it was made from a tree that was.",
            ],
            fact: "Coal, chalk and some cliffs are made of the squeezed remains of living things that died millions of years ago.",
          },
        },
        {
          id: "life-cycles",
          label: "Life Cycles",
          blurb: "Every living thing has a life story",
          x: 68,
          y: 57,
          audio: "/wikido/living-things/audio/living-things-overview.life-cycles.mp3",
          info: {
            title: "Life Cycles",
            body: [
              "Every living thing has a life story called a life cycle: it is born or hatches, grows, and — if it is lucky — has young of its own before it dies. The butterfly flying past began as an egg, munched leaves as a caterpillar, rested in a hard case called a chrysalis, then emerged with wings.",
              "Life cycles can be very different lengths. Some mayfly adults live for just one day. Some trees live for thousands of years.",
            ],
            fact: "The fawn in the meadow could stand and walk within an hour of being born — a human baby needs about a year!",
          },
        },
        {
          id: "kinds",
          label: "Kinds of Living Things",
          blurb: "Step in and sort all of life",
          x: 24,
          y: 30,
          childSceneId: "kinds-of-living-things",
          audio: "/wikido/living-things/audio/living-things-overview.kinds.mp3",
          info: {
            title: "Kinds of Living Things",
            body: [
              "Scientists have found over two million different kinds of living things on Earth — and there are many more waiting to be discovered.",
              "To make sense of them all, scientists sort living things into big family groups: animals, plants, fungi, and tiny life too small to see. Step in and meet them!",
            ],
            fact: "Scientists describe thousands of species new to science every single year — many are beetles!",
          },
        },
        {
          id: "humans",
          label: "Human Beings",
          blurb: "Where do YOU fit in? Step in",
          x: 83,
          y: 66,
          childSceneId: "human-beings",
          audio: "/wikido/living-things/audio/living-things-overview.humans.mp3",
          info: {
            title: "Human Beings",
            body: [
              "Here is a surprise: you are a living thing too — and an animal! You grow, you need food and air, you respond to the world, and you are made of cells, just like the deer and the oak.",
              "But human beings can do things no other animal can: read, build cities, fly to the Moon, and wonder about life itself. Step in to discover what makes humans special.",
            ],
            fact: "There are now more than eight billion human beings — more than any other large animal on Earth.",
          },
        },
      ],
    },

    "kinds-of-living-things": {
      id: "kinds-of-living-things",
      title: "Kinds of Living Things",
      artPrompt:
        "A lush green valley that gathers every kind of life in one sweeping view, soft morning light. COMPOSITION (left to right): a quiet clear stream enters the valley on the LEFT, a trout visible beneath the surface and a grey heron standing at the bank; in the LEFT FOREGROUND a fallen log carpeted with bright green moss and crowned with clusters of brown mushrooms; in the CENTRE a wide flower meadow busy with a rabbit nibbling, a red fox watching from the tall grass, bees and a dragonfly darting; on the CENTRE-RIGHT a mature broad-leaved tree with a bird's nest hole; on the RIGHT a rocky slope with pine trees and a hazy blue mountain behind; in the RIGHT FOREGROUND a large round magnifying glass leans against a mossy stone with a glistening drop of pond water resting inside it; two birds fly high in the sky.",
      image: {
        src: "/wikido/living-things/kinds-of-living-things.jpg",
        alt: "A green valley: a stream with a heron, a mossy log with mushrooms, a meadow with a rabbit and a fox, a broad tree, pine slopes, and a magnifying glass leaning on a stone",
      },
      narration:
        "Scientists have counted more than two million kinds of living things, so they sort them into big family groups. The animals — like the fox, the heron and the rabbit. The plants — like the tree and the flowers. The fungi — like the mushrooms on the log. And a hidden world of tiny living things, far too small for your eyes. Step into each group and meet its members!",
      audio: "/wikido/living-things/audio/kinds-of-living-things.mp3",
      hotspots: [
        {
          id: "sorting-life",
          label: "Sorting All of Life",
          blurb: "The scientist's big family tree",
          x: 26,
          y: 54,
          audio: "/wikido/living-things/audio/kinds-of-living-things.sorting-life.mp3",
          info: {
            title: "Sorting All of Life",
            body: [
              "With millions of living things to study, scientists group them by their features — what they look like, how they get food, and how they are built inside. The biggest groups are called kingdoms.",
              "The ones you can see every day are animals, plants and fungi. But most kingdoms are made of one-celled living things, far too small to see without a microscope — and they were Earth's only residents for billions of years.",
            ],
            fact: "For most of Earth's history, all life was microscopic. Animals have only existed for the last small slice of time.",
          },
        },
        {
          id: "animals",
          label: "Animals",
          blurb: "Step in and meet the animal groups",
          x: 63,
          y: 68,
          childSceneId: "types-of-animals",
          audio: "/wikido/living-things/audio/kinds-of-living-things.animals.mp3",
          info: {
            title: "Animals",
            body: [
              "Animals are living things that move around, eat other living things for energy, and react quickly to the world. From the trout in the stream to the heron to the buzzing bees, they all breathe oxygen and cannot make their own food.",
              "Scientists sort animals into groups by their bodies: mammals with fur, birds with feathers, fish with gills, and many more. Step in to meet them all!",
            ],
            fact: "There are far more kinds of animals than kinds of plants — insects alone outnumber all other animal groups combined.",
          },
        },
        {
          id: "plants",
          label: "Plants",
          blurb: "Step in and meet the plant kinds",
          x: 60,
          y: 42,
          childSceneId: "types-of-plants",
          audio: "/wikido/living-things/audio/kinds-of-living-things.plants.mp3",
          info: {
            title: "Plants",
            body: [
              "Plants are the world's great cooks: rooted in place, they make their own food from sunlight, water and air. That one trick feeds almost every other living thing on the planet.",
              "From giant trees to soft moss carpets, plants come in amazing varieties. Step in to explore the great plant families!",
            ],
            fact: "Land plants make the oxygen in every breath you take — the leafy world is quietly feeding and breathing for us all.",
          },
        },
        {
          id: "fungi",
          label: "Fungi",
          blurb: "Not plants, not animals — recyclers!",
          x: 36,
          y: 68,
          audio: "/wikido/living-things/audio/kinds-of-living-things.fungi.mp3",
          info: {
            title: "Fungi",
            body: [
              "Mushrooms, toadstools, moulds and yeasts are fungi — a group all their own. They cannot move like animals, but they cannot make their own food like plants either. Instead, they grow into their food and soak it up.",
              "Fungi are nature's recycling team: they break down fallen logs, dead leaves and old fruit, returning the good parts to the soil for plants to use again.",
            ],
            fact: "The yeast that makes bread rise is a living fungus — it breathes out bubbles of gas that puff the dough up!",
          },
        },
        {
          id: "tiny-living-things",
          label: "Tiny Living Things",
          blurb: "A hidden world too small to see",
          x: 86,
          y: 72,
          audio: "/wikido/living-things/audio/kinds-of-living-things.tiny-living-things.mp3",
          info: {
            title: "Tiny Living Things",
            body: [
              "Look through the magnifying glass — and then imagine a microscope thousands of times stronger. A single drop of pond water teems with life: spinning, swimming, nibbling creatures far too small to see.",
              "These tiny living things — bacteria, microscopic algae and more — are the most numerous living things on Earth. They live in soil, oceans, hot springs, clouds, and even inside your body, where trillions of them help you digest your food.",
            ],
            fact: "A single teaspoon of healthy garden soil can hold billions of bacteria — more than the number of people on Earth.",
          },
        },
        {
          id: "where-life-lives",
          label: "Life Is Everywhere",
          blurb: "From deep seas to mountain tops",
          x: 79,
          y: 20,
          audio: "/wikido/living-things/audio/kinds-of-living-things.where-life-lives.mp3",
          info: {
            title: "Life Is Everywhere",
            body: [
              "Living things have conquered nearly every corner of Earth: frogs freeze solid in icy winters and wake up in spring, fish glow in the crushing darkness of the deep sea, and camels cross burning deserts without a drink.",
              "Wherever there is water and a little energy, life finds a way — high on mountains, deep underground, and in boiling hot springs.",
            ],
            fact: "At the bottom of the ocean, entire communities of creatures live around hot springs — without any sunlight at all.",
          },
        },
      ],
    },

    "types-of-animals": {
      id: "types-of-animals",
      title: "Types of Animals",
      artPrompt:
        "A lively watering hole crowded with friendly animal families, golden late-afternoon light. COMPOSITION (left to right): clear water in the LEFT FOREGROUND with two colourful fish visible beneath the surface and a green frog sitting on a lily pad; on the LEFT BANK a crocodile basks with its long scaly tail trailing into the water; in the CENTRE a mother elephant with her calf drink at the water's edge, a lioness resting on a flat warm rock just behind them; on the CENTRE-RIGHT a flock of pink flamingos wades at the water's edge with one taking off, wings spread wide; on the RIGHT a giraffe reaches its long neck into a tree; in the RIGHT FOREGROUND a tortoise plods across warm sand; in the VERY FOREGROUND butterflies, a dragonfly and a line of ants crossing a small stone; a patterned snake coils on a low branch at the FAR RIGHT edge; soft golden sky with a few birds.",
      image: {
        src: "/wikido/living-things/types-of-animals.jpg",
        alt: "A watering hole with fish and a frog in the water, a crocodile on the bank, elephants, a resting lioness, flamingos, a giraffe, a tortoise, ants and butterflies in front",
      },
      narration:
        "Scientists sort the millions of animal kinds into groups by their bodies. Mammals like the elephants have fur and feed their babies milk. Birds like the flamingos have feathers. Fish like these breathe underwater with gills. Reptiles like the crocodile have dry scales, amphibians like the frog live a double life in water and on land, and insects — the ants and butterflies — outnumber all the rest. Tap each group to learn its secrets!",
      audio: "/wikido/living-things/audio/types-of-animals.mp3",
      hotspots: [
        {
          id: "mammals",
          label: "Mammals",
          blurb: "Fur, milk, and warm blood",
          x: 37,
          y: 43,
          audio: "/wikido/living-things/audio/types-of-animals.mammals.mp3",
          info: {
            title: "Mammals",
            body: [
              "Mammals are warm-blooded — they keep their body temperature steady day and night. Most grow fur or hair, and mammal mothers feed their babies milk. Most mammals give birth to live young instead of laying eggs.",
              "Elephants, lions, dogs, whales, bats and you: all mammals. Whales and dolphins may look like fish, but they breathe air, nurse their calves, and are warm-blooded — true mammals that returned to the sea.",
            ],
            fact: "The duck-billed platypus breaks the rules: it has fur and feeds milk to its babies — but it lays eggs!",
          },
        },
        {
          id: "birds",
          label: "Birds",
          blurb: "Feathers, beaks and eggs",
          x: 63,
          y: 55,
          audio: "/wikido/living-things/audio/types-of-animals.birds.mp3",
          info: {
            title: "Birds",
            body: [
              "Birds are the only animals with feathers. They have two legs, two wings, a beak instead of teeth, and hatch from hard-shelled eggs. Like mammals they are warm-blooded, keeping cosy even in winter.",
              "Most birds fly, using hollow bones to stay light — but not all. Penguins 'fly' underwater, and ostriches run across the savanna at highway speed.",
            ],
            fact: "The ostrich is the biggest bird alive — it cannot fly at all, but it can run faster than any Olympic sprinter.",
          },
        },
        {
          id: "fish",
          label: "Fish",
          blurb: "Gills instead of lungs",
          x: 41,
          y: 84,
          audio: "/wikido/living-things/audio/types-of-animals.fish.mp3",
          info: {
            title: "Fish",
            body: [
              "Fish live their whole lives in water. Instead of lungs they breathe with gills, which grab oxygen straight out of the water as it flows past. Most fish are covered in scales, steer with fins, and are cold-blooded.",
              "Most fish lay enormous numbers of eggs — millions at a time for some ocean fish — because only a lucky few will grow up.",
            ],
            fact: "A single cod can lay five million eggs in one season — about the weight of her own body in eggs!",
          },
        },
        {
          id: "reptiles",
          label: "Reptiles",
          blurb: "Scaly skin and leathery eggs",
          x: 17,
          y: 59,
          audio: "/wikido/living-things/audio/types-of-animals.reptiles.mp3",
          info: {
            title: "Reptiles",
            body: [
              "Reptiles — lizards, snakes, turtles and crocodiles — are covered in dry, scaly skin that keeps water inside their bodies. That superpower lets them live in deserts where frogs would dry up.",
              "Most reptiles lay leathery eggs on land. They are cold-blooded, so you often see them basking motionless in the sun to warm up their muscles.",
            ],
            fact: "Snakes smell with their tongues! They flick the forked tongue in and out to collect scent from the air.",
          },
        },
        {
          id: "amphibians",
          label: "Amphibians",
          blurb: "A double life: water AND land",
          x: 37,
          y: 77,
          audio: "/wikido/living-things/audio/types-of-animals.amphibians.mp3",
          info: {
            title: "Amphibians",
            body: [
              "The word amphibian means 'double life' — and that is exactly what frogs, toads and salamanders live. They hatch in water as tadpoles that breathe with gills, then gradually change — a transformation called metamorphosis — into air-breathing adults that walk on land.",
              "Amphibians have smooth, damp skin — and many can actually breathe through it! That is why they must stay near water and moist places.",
            ],
            fact: "The wood frog of North America freezes almost solid in winter — its heart stops — then thaws out alive in spring!",
          },
        },
        {
          id: "insects",
          label: "Insects",
          blurb: "Six legs — and everywhere!",
          x: 53,
          y: 78,
          audio: "/wikido/living-things/audio/types-of-animals.insects.mp3",
          info: {
            title: "Insects",
            body: [
              "Count the ants' legs: six! All insects have six legs and bodies built in three parts, with a tough outside skeleton — an exoskeleton — and feelers called antennae. Butterflies, bees, beetles, ants and dragonflies are all insects.",
              "Insects are the most successful animals on Earth, found on every continent, even frozen Antarctica. Scientists have named about a million kinds — and think millions more are waiting.",
            ],
            fact: "Spiders are NOT insects — they have eight legs, not six. They are arachnids, cousins of scorpions.",
          },
        },
        {
          id: "warm-or-cold",
          label: "Warm or Cold Blooded",
          blurb: "The big split between animal groups",
          x: 54,
          y: 43,
          audio: "/wikido/living-things/audio/types-of-animals.warm-or-cold.mp3",
          info: {
            title: "Warm or Cold Blooded",
            body: [
              "Here is one of the biggest divides in the animal world. Mammals and birds are warm-blooded: their bodies keep a steady temperature, so they stay active in heat, cold, day and night — but they must eat a lot to fuel their inner furnace.",
              "Fish, reptiles and amphibians are cold-blooded: their bodies take on the temperature around them. 'Cold-blooded' does not mean their blood is cold — a lizard basking in the sun is warm and speedy, but on a chilly morning it is slow and sleepy.",
            ],
            fact: "This is why you see crocodiles and lizards lying still in the sun — they are charging their batteries!",
          },
        },
      ],
    },

    "types-of-plants": {
      id: "types-of-plants",
      title: "Types of Plants",
      artPrompt:
        "An abundant walled garden on a hillside in morning sun with pine forest beyond. COMPOSITION (left to right): in the LEFT FOREGROUND a cool shaded corner with mossy stones and tall feathery ferns unfurling; on the LEFT THIRD a huge old apple tree in full leaf heavy with ripe red apples; across the CENTRE a bright flower bed bursting with tall sunflowers, tulips and roses, bees visiting the blooms; in the CENTRE FOREGROUND a neatly mown striped green lawn; on the RIGHT a vegetable patch with rows of lettuces and carrots and a bean trellis; beyond the garden wall on the RIGHT THIRD a ridge of dark green pine trees under the morning sky; a metal watering can and a wicker basket sit by the flower bed; butterflies drift above the flowers.",
      image: {
        src: "/wikido/living-things/types-of-plants.jpg",
        alt: "A walled garden: ferns and mossy stones in the shade, an apple tree full of apples, sunflowers and roses, a striped lawn, a vegetable patch, and pine trees beyond the wall",
      },
      narration:
        "Plants make their own food from sunlight — which makes them the chefs that feed the whole planet. But plants come in many kinds. Great trees like the apple tree, bright flowers like the sunflowers, quiet grasses like the lawn, ancient ferns and mosses in the shady corner, and cone-bearing pines on the ridge. Tap around the garden to meet the plant families!",
      audio: "/wikido/living-things/audio/types-of-plants.mp3",
      hotspots: [
        {
          id: "plant-food",
          label: "How Plants Eat",
          blurb: "Sunlight becomes food — really!",
          x: 60,
          y: 40,
          audio: "/wikido/living-things/audio/types-of-plants.plant-food.mp3",
          info: {
            title: "How Plants Eat",
            body: [
              "Every green leaf is a tiny solar-powered kitchen. Plants take water up through their roots, soak in air through tiny holes in their leaves, and use sunlight to mix them into sugar — the plant's own food. This amazing process is called photosynthesis, which means 'making with light'.",
              "Best of all, plants give away their leftover air: oxygen, the gas you breathe every second of your life. Every breath you take was made by a leaf somewhere.",
            ],
            fact: "Nearly all food on Earth begins with photosynthesis — even pizza, from the wheat in the crust to the grass the cow ate.",
          },
        },
        {
          id: "trees",
          label: "Trees",
          blurb: "The giants of the plant world",
          x: 29,
          y: 48,
          audio: "/wikido/living-things/audio/types-of-plants.trees.mp3",
          info: {
            title: "Trees",
            body: [
              "Trees are the biggest living things on land. A woody trunk lifts their crown high into the sunlight, while roots anchor them against storms and drink for the whole plant. The tallest trees reach higher than a thirty-storey building.",
              "Trees are also among the longest-lived living things — and whole cities of creatures live on them: birds in the crown, beetles under the bark, fungi on the roots.",
            ],
            fact: "Bristlecone pines in California were already old saplings when the Egyptian pyramids were built — nearly 5,000 years ago.",
          },
        },
        {
          id: "flowers",
          label: "Flowers",
          blurb: "A plant's way of making seeds",
          x: 58,
          y: 60,
          audio: "/wikido/living-things/audio/types-of-plants.flowers.mp3",
          info: {
            title: "Flowers",
            body: [
              "A flower is not decoration — it is the plant's way of making seeds. Bright colours and sweet perfume invite bees and butterflies to visit, and as they sip nectar they carry pollen from flower to flower.",
              "After a flower is pollinated, its seeds begin to form — often packed inside a fruit. Apples, cherries and tomatoes are all seed cases that animals eat, spreading the seeds to new places.",
            ],
            fact: "A sunflower 'flower' is really hundreds of tiny flowers packed together in a beautiful spiral.",
          },
        },
        {
          id: "grasses",
          label: "Grasses",
          blurb: "Humble plants that feed the world",
          x: 45,
          y: 83,
          audio: "/wikido/living-things/audio/types-of-plants.grasses.mp3",
          info: {
            title: "Grasses",
            body: [
              "Grass looks simple — but it may be the most important plant family on Earth. Wheat, rice and corn are all grasses, and together they feed more human beings than any other plants.",
              "Grasses grow from the bottom, not the tips, which is why mowing the lawn never hurts it — and why grazing herds can eat grass all year without killing it.",
            ],
            fact: "Bamboo is a giant grass — and one of the fastest-growing plants on Earth, shooting up almost a metre in a single day.",
          },
        },
        {
          id: "ferns-and-mosses",
          label: "Ferns & Mosses",
          blurb: "Ancient plants with no flowers",
          x: 9,
          y: 63,
          audio: "/wikido/living-things/audio/types-of-plants.ferns-and-mosses.mp3",
          info: {
            title: "Ferns & Mosses",
            body: [
              "In the shady corner grow the old-timers. Ferns and mosses existed millions of years before flowers appeared — ferns shaded the feet of the dinosaurs. Neither has flowers, and neither grows from seeds.",
              "Instead, ferns make tiny dust-like spores in brown dots under their leaves, and mosses spread in soft green carpets, soaking up rainwater like a sponge because they have no proper roots.",
            ],
            fact: "The spores under a fern's fronds are so small that thousands of them would fit on this full stop.",
          },
        },
        {
          id: "conifers",
          label: "Conifers",
          blurb: "Needles, cones, and winter green",
          x: 90,
          y: 25,
          audio: "/wikido/living-things/audio/types-of-plants.conifers.mp3",
          info: {
            title: "Conifers",
            body: [
              "On the cold ridge grow the conifers — pines, firs and spruces, the great forests of the mountains and the far north. Instead of flowers they make cones, and instead of broad leaves they grow tough, waxy needles.",
              "Needles can survive freezing snow, so most conifers stay green all year round — that is what 'evergreen' means. Their seeds hide safely inside the woody cones.",
            ],
            fact: "Conifers can live where flowering trees cannot — some grow at the very edge of the Arctic, and one spruce in Sweden is nearly 10,000 years old.",
          },
        },
        {
          id: "seeds-travel",
          label: "Seeds on the Move",
          blurb: "Parachutes, hitchhikers, sailors",
          x: 67,
          y: 68,
          audio: "/wikido/living-things/audio/types-of-plants.seeds-travel.mp3",
          info: {
            title: "Seeds on the Move",
            body: [
              "A plant cannot walk — so its children travel instead. Seeds ride the wind on dandelion parachutes, hitch rides on animal fur with tiny hooks, sail oceans inside floating coconuts, or hide inside tasty fruit that animals carry away and drop far from home.",
              "Each seed carries a whole new plant, waiting. Given warmth, water and light, it will unpack itself and begin to grow.",
            ],
            fact: "One dandelion plant can produce around 2,000 seeds — each with its own tiny built-in parachute.",
          },
        },
      ],
    },

    "human-beings": {
      id: "human-beings",
      title: "Human Beings",
      artPrompt:
        "A warm backyard garden scene full of busy people on a bright weekend morning. COMPOSITION (left to right): on the LEFT a grandfather and a young girl peer together through a telescope on a wooden tripod, pointing up at the sky; in the CENTRE a mother and her son bake bread at a garden table under a leafy tree, flour dust drifting in the light; in the CENTRE FOREGROUND a toddler takes wobbling steps on a red-and-white picnic blanket; on the CENTRE-RIGHT three children kick a football on the lawn; on the RIGHT a father paints a landscape on a wooden easel; on the FAR RIGHT an older boy launches a small model rocket that trails a puff of white smoke upward; a friendly dog runs beside the football children; colourful bunting flags on a washing line, soft morning sun.",
      image: {
        src: "/wikido/living-things/human-beings.jpg",
        alt: "A backyard full of people: a grandfather and girl with a telescope, a mother and son baking, a toddler taking steps, children playing football, a father painting, and a boy launching a model rocket",
      },
      narration:
        "Human beings are living things — animals, in fact. We are mammals, cousins of the great apes, and we walk upright on two legs. But we do things no other animal can: we talk about everything, build tools from ideas, live together in villages and cities, and wonder about the stars. Look at everyone busy in this garden — then step inside your own amazing body!",
      audio: "/wikido/living-things/audio/human-beings.mp3",
      hotspots: [
        {
          id: "what-are-humans",
          label: "What Are Human Beings?",
          blurb: "Animals — with a twist",
          x: 44,
          y: 48,
          audio: "/wikido/living-things/audio/human-beings.what-are-humans.mp3",
          info: {
            title: "What Are Human Beings?",
            body: [
              "Human beings are animals: we move, eat, breathe, grow and respond — all the signs of life. Scientists gave our kind the name Homo sapiens, which means 'wise human'. We are mammals with warm blood, and we belong to the same family group as apes — the primates.",
              "One of our special features is standing tall: we walk upright on two legs, which leaves our hands free to carry, build, paint, wave and hug.",
            ],
            fact: "Our closest living relatives are chimpanzees — we share almost 99% of our DNA with them.",
          },
        },
        {
          id: "curious-minds",
          label: "Curious Minds",
          blurb: "The animal that asks why",
          x: 23,
          y: 42,
          audio: "/wikido/living-things/audio/human-beings.curious-minds.mp3",
          info: {
            title: "Curious Minds",
            body: [
              "Human beings are the question-asking animal. Why is the sky blue? Where does the sun go at night? Our big, hungry brains love to wonder, imagine and figure things out — every invention, from the pencil to the spaceship, began as an idea in someone's head.",
              "Imagination lets us do something no other animal can: picture things that do not exist yet, and then build them.",
            ],
            fact: "Your brain nearly doubles in size in your first year of life — and it is about 2% of your weight but uses a fifth of your energy.",
          },
        },
        {
          id: "language",
          label: "Talking & Words",
          blurb: "Knowledge passed mouth to mouth",
          x: 14,
          y: 60,
          audio: "/wikido/living-things/audio/human-beings.language.mp3",
          info: {
            title: "Talking & Words",
            body: [
              "No other animal comes close to human language. People all over Earth speak around 7,000 different languages, and with words we share anything: what happened yesterday, what we dream of tomorrow, jokes, stories, and instructions for baking bread.",
              "Language lets each generation hand everything it has learned to the next one — that is why knowledge keeps growing, from your grandmother's recipes to rocket science.",
            ],
            fact: "You learned your first language without any lessons at all — just by listening, trying, and making mistakes.",
          },
        },
        {
          id: "makers-tools",
          label: "Makers & Tools",
          blurb: "From stone knives to rockets",
          x: 92,
          y: 52,
          audio: "/wikido/living-things/audio/human-beings.makers-tools.mp3",
          info: {
            title: "Makers & Tools",
            body: [
              "Human beings are the tool-making animal. Our ancient relatives sharpened stone tools over two million years before anyone invented the wheel. Today's tools include aeroplanes, computers and the model rocket on the right — but they all began the same way: someone imagining a solution.",
              "Our hands make it possible: your thumb can touch the tip of each finger, giving you a precise grip almost no other animal has.",
            ],
            fact: "Stone tools are over two million years older than the wheel — humans were inventing for ages before we could roll!",
          },
        },
        {
          id: "living-together",
          label: "Living Together",
          blurb: "Families, teams and communities",
          x: 65,
          y: 58,
          audio: "/wikido/living-things/audio/human-beings.living-together.mp3",
          info: {
            title: "Living Together",
            body: [
              "Human beings are team players. We live in families and communities, share food and jobs, care for the sick, and teach our young. Music, games, art and celebrations bloom in every culture on Earth.",
              "Working together is our superpower. No single person could build a ship, a school or a city — but together, humans have built them all.",
            ],
            fact: "Every human being you will ever meet — all eight billion of us — lives on the same small blue planet.",
          },
        },
        {
          id: "your-body",
          label: "Your Amazing Body",
          blurb: "Step inside — it's incredible!",
          x: 51,
          y: 78,
          childSceneId: "human-body",
          audio: "/wikido/living-things/audio/human-beings.your-body.mp3",
          info: {
            title: "Your Amazing Body",
            body: [
              "The most complicated object you will ever own is your own body. Right now, without you thinking about it, your heart is pumping, your lungs are breathing, your nerves are sending messages faster than a race car, and your bones are holding you up.",
              "Step in for a friendly tour of what is under your skin!",
            ],
            fact: "Laid end to end, the blood vessels inside one person could stretch around the Earth — twice.",
          },
        },
      ],
    },

    "human-body": {
      id: "human-body",
      title: "The Human Body",
      artPrompt:
        "A friendly educational peek-inside-the-body illustration in warm storybook style. COMPOSITION: a large cheerful child figure stands in the CENTRE of the frame facing the viewer, arms held slightly out from the sides; a gentle cutaway reveals the inside of the body in soft rounded colours — a pink brain inside the head, a red heart and two spongy pink lungs in the chest, a J-shaped stomach and coiled intestines in the belly, white bones visible through one leg and one forearm, red muscle fibres visible through the other arm; around the figure small children stand on the ground pointing up curiously; a soft pale blue studio-like background, gentle light; absolutely nothing gory or scary, friendly and cosy medical-storybook mood.",
      image: {
        src: "/wikido/living-things/human-body.jpg",
        alt: "A friendly cutaway of a child figure showing the brain, heart, lungs, stomach, bones and muscles, with smaller children looking up curiously",
      },
      narration:
        "Your body is a bustling city of parts, all working together every second of your life. Bones hold you up and protect your organs. Muscles move you. Your heart pumps blood, your lungs breathe, your stomach turns food into fuel, and your brain runs the whole show. Tap each part of the body to learn what it does — and how to keep it healthy!",
      audio: "/wikido/living-things/audio/human-body.mp3",
      hotspots: [
        {
          id: "skeleton",
          label: "Bones & Skeleton",
          blurb: "Your body's building frame",
          x: 47,
          y: 76,
          audio: "/wikido/living-things/audio/human-body.skeleton.mp3",
          info: {
            title: "Bones & Skeleton",
            body: [
              "Inside you is a living frame of 206 bones called the skeleton. Bones hold you up, let you move, and make new blood cells deep inside. The skull forms a safety helmet for the brain, and the ribs build a cage around the heart and lungs.",
              "Your backbone is not one bone but a stack of small ring-shaped bones called vertebrae — that is why you can bend and twist.",
            ],
            fact: "Babies are born with about 300 bones — many join together as you grow, leaving adults with 206.",
          },
        },
        {
          id: "muscles",
          label: "Muscles",
          blurb: "The pullers that move you",
          x: 57,
          y: 45,
          audio: "/wikido/living-things/audio/human-body.muscles.mp3",
          info: {
            title: "Muscles",
            body: [
              "Muscles are the body's engines: they can tighten and pull. Over 600 muscles tug on your bones to make every movement — running, writing, blinking and smiling. Muscles only pull, never push, so they work in pairs taking turns.",
              "Exercise makes muscles thicker and stronger, and your heart — a muscle that never rests — grows stronger with it too.",
            ],
            fact: "The strongest muscle for its size is in your jaw — the one that chews your food all day.",
          },
        },
        {
          id: "heart-blood",
          label: "Heart & Blood",
          blurb: "A pump that never rests",
          x: 50,
          y: 46,
          audio: "/wikido/living-things/audio/human-body.heart-blood.mp3",
          info: {
            title: "Heart & Blood",
            body: [
              "Your heart is a fist-sized muscle pump tucked a little to the left in your chest. Every beat pushes blood racing through a network of blood vessels — the delivery roads of your body.",
              "Blood carries oxygen and food to every single body part and collects waste on the way back. It also carries tiny bodyguards that fight germs and patch up cuts.",
            ],
            fact: "Your heart beats about 100,000 times a day without ever taking a break — pumping thousands of litres of blood.",
          },
        },
        {
          id: "lungs-breathing",
          label: "Lungs & Breathing",
          blurb: "Two spongy balloons of life",
          x: 46,
          y: 39,
          audio: "/wikido/living-things/audio/human-body.lungs-breathing.mp3",
          info: {
            title: "Lungs & Breathing",
            body: [
              "You carry two soft, spongy lungs in your chest. Breathe in, and they fill with air; the oxygen hops into your blood and is whisked away to fuel your whole body. Breathe out, and you release carbon dioxide — a waste gas that plants gladly use to make their food.",
              "You take about 20,000 breaths every day, mostly without noticing.",
            ],
            fact: "Your left lung is slightly smaller than your right — it leaves room for your heart next door.",
          },
        },
        {
          id: "brain-nerves",
          label: "Brain & Nerves",
          blurb: "The control centre upstairs",
          x: 50,
          y: 17,
          audio: "/wikido/living-things/audio/human-body.brain-nerves.mp3",
          info: {
            title: "Brain & Nerves",
            body: [
              "Your brain is the control centre for everything: every thought, memory, feeling and movement. It contains about 86 billion nerve cells, and it never switches off — even while you sleep, it sorts your memories and keeps your heart beating.",
              "Thin nerves reach from the brain to every corner of your body, carrying messages at up to 400 kilometres per hour — that is why your hand jerks back before you even realise you touched something hot.",
            ],
            fact: "Every time you practise something — a kick, a chord, a times table — your brain rewires itself a little. Practising really does make you better.",
          },
        },
        {
          id: "senses",
          label: "The Senses",
          blurb: "Five doors to the world",
          x: 53,
          y: 28,
          audio: "/wikido/living-things/audio/human-body.senses.mp3",
          info: {
            title: "The Senses",
            body: [
              "Your senses are how the outside world gets in. Eyes catch light, ears catch sound, your nose samples the air, your tongue tastes, and your skin feels touch, warmth and cold.",
              "Your sense organs gather information day and night and send it to the brain, which stitches it together into the world you experience — and your ears do double duty, hiding your sense of balance inside them.",
            ],
            fact: "Your nose is a champion: scientists think people can tell apart around a trillion different smells.",
          },
        },
        {
          id: "stomach-digestion",
          label: "Stomach & Digestion",
          blurb: "The body's fuel factory",
          x: 50,
          y: 58,
          audio: "/wikido/living-things/audio/human-body.stomach-digestion.mp3",
          info: {
            title: "Stomach & Digestion",
            body: [
              "Every bite of food takes an amazing journey. Your mouth chews it small, it slides down the gullet to the stomach, where strong juices churn it into mush. Then a long, coiled tube — the intestine — takes out the good parts: the energy and building materials your body needs.",
              "The whole journey takes a day or two, and your body is very good at wasting nothing it can use.",
            ],
            fact: "Uncoiled, your intestines are several metres long — they fold all that length into your belly like a shoelace in a matchbox.",
          },
        },
        {
          id: "skin",
          label: "Skin",
          blurb: "Your biggest organ — and its coat",
          x: 62,
          y: 66,
          audio: "/wikido/living-things/audio/human-body.skin.mp3",
          info: {
            title: "Skin",
            body: [
              "Skin wraps your whole body in a stretchy, waterproof coat — and it is your biggest organ. It keeps germs and rain out, holds your insides in, and senses the world with millions of touch, heat and cold sensors.",
              "Skin also keeps you at just the right temperature: when you run hot, it makes sweat, and as the sweat dries it carries the heat away.",
            ],
            fact: "Your skin renews itself constantly — you quietly shed thousands of old skin cells every minute and grow new ones.",
          },
        },
      ],
    },
  },
};
