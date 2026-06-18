// Demo-data seeder.
// createDemoData(db, familyId, uid) — pure Firestore writes, testable and scriptable.
// seedDemoFamily — superadmin-only onCall that creates a demo auth user + seeds data.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

// ── Fixed IDs so seeder is idempotent ───────────────────────────────────────
const C1 = "ch_yusuf";
const C2 = "ch_maryam";
const S1 = "subj_quran";
const S2 = "subj_maths";
const S3 = "subj_arabic";
const S4 = "subj_science";
const CURR = "curr_2025_26";

const PROFILE = {
  familyName: "Al-Hassan Family",
  guidingLight:
    "To raise children who love Allah, serve their community, and think critically about the world around them.",
  goalMode: "individual",
};

const GUARDIANS = [
  {
    id: "gd_ibrahim",
    name: "Ibrahim Al-Hassan",
    dob: "1985-03-14",
    occupation: "Software Engineer",
    motherTongue: "Arabic",
    likes: "Reading, hiking, astronomy",
    goals: "Build strong Islamic identity and love of learning",
  },
  {
    id: "gd_fatima",
    name: "Fatima Al-Hassan",
    dob: "1988-09-22",
    occupation: "Former Teacher",
    motherTongue: "Arabic",
    likes: "Cooking, art, gardening",
    goals: "Nurture creativity and compassion in our children",
  },
];

const CHILDREN = [
  {
    id: C1,
    name: "Yusuf",
    dob: "2015-03-14",
    strengths: "Curious, strong at maths, asks deep questions",
    weaknesses: "Easily distracted, rushes through reading",
    comments: "Loves science experiments and outdoor activities",
  },
  {
    id: C2,
    name: "Maryam",
    dob: "2017-09-22",
    strengths: "Creative, loves stories, kind to others",
    weaknesses: "Can be shy, needs encouragement to try new things",
    comments: "Enjoys drawing and listening to Arabic stories",
  },
];

const SKILLS = [
  { id: "sk_arabic", name: "Arabic", category: "Language" },
  { id: "sk_quran", name: "Quran", category: "Islamic Studies" },
  { id: "sk_thinking", name: "Critical Thinking", category: "Life Skills" },
];

const CURRICULUM = {
  title: "2025-2026 Islamic Homeschool Programme",
  objectives:
    "Develop strong Quranic foundation, Arabic literacy, mathematical reasoning, and critical thinking grounded in Islamic values.",
  content:
    "Quran recitation with tajweed, Arabic reading and writing, mathematics through real-world problem solving, science through observation and experiments.",
  instruction:
    "Inquiry-led learning with daily Quran time, guided discovery in maths and science, stories to build language and moral reasoning.",
  assessment:
    "Completion-based — mastery at each level before advancing. Co-op activities reward teamwork over individual competition.",
  guidingLightSnapshot: PROFILE.guidingLight,
  status: "active",
  subjectCount: 4,
};

const SUBJECTS = [
  {
    id: S1,
    name: "Quran Recitation",
    goals: "Memorise 5 new surahs, improve tajweed, recite with confidence and understanding.",
    competencies: ["Accurate recitation", "Tajweed rules applied", "Surah meanings understood"],
    gradingStandards: "Fluent recitation without prompting = mastery",
  },
  {
    id: S2,
    name: "Mathematics",
    goals: "Master multiplication tables, fractions, and applied word problems.",
    competencies: ["Times tables 1-12", "Simple fractions", "Multi-step word problems"],
    gradingStandards: "3 consecutive correct attempts without support = mastery",
  },
  {
    id: S3,
    name: "Arabic Language",
    goals: "Read short passages fluently, write basic sentences, expand vocabulary to 200 words.",
    competencies: ["Phonics and letter forms", "Short text reading", "Basic sentence writing"],
    gradingStandards: "Correct reading/writing without spelling errors = mastery",
  },
  {
    id: S4,
    name: "Science & Nature",
    goals: "Observe the natural world, form hypotheses, and connect findings to the signs of Allah.",
    competencies: ["Scientific observation", "Simple experiments", "Recording findings"],
    gradingStandards: "Accurate written observations and ability to explain findings = mastery",
  },
];

const ACTIVITIES = [
  // Quran Recitation (5 activities)
  {
    id: "act_q1",
    title: "Al-Fatiha Daily Recitation",
    type: "quran",
    subject: "Quran Recitation",
    subjectId: S1,
    complexityRank: 1,
    coopMode: false,
    targetChildren: [C1, C2],
    durationMinutes: 10,
    parentInstructions:
      "Listen to each child recite Al-Fatiha. Prompt only if they pause for more than 3 seconds. Note which words need work.",
    exampleWalkthrough:
      "Yusuf recites clearly but rushes 'maaliki yawm ad-deen'. Pause him, model it slowly, have him repeat three times.",
    content: {
      kind: "quran_reading",
      activityType: "quran",
      instructions: "Read each ayah aloud. Tap any single word to hear it recited, or 'Recite ayah' for the whole verse.",
      primaryLang: "ar",
      quran: {
        surahName: "Al-Fatihah",
        reference: "Surah 1:1-4",
        textSource: "curated",
        verses: [
          {
            surah: 1, ayah: 1,
            arabic: "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ",
            transliteration: "Bismi-llāhi r-raḥmāni r-raḥīm",
            translation: "In the name of Allah, the Most Gracious, the Most Merciful.",
            audioUrl: "https://everyayah.com/data/Alafasy_128kbps/001001.mp3",
            words: [
              { arabic: "بِسْمِ", transliteration: "bismi", audioUrl: "https://audio.qurancdn.com/wbw/001_001_001.mp3" },
              { arabic: "اللَّهِ", transliteration: "llāhi", audioUrl: "https://audio.qurancdn.com/wbw/001_001_002.mp3" },
              { arabic: "الرَّحْمَٰنِ", transliteration: "r-raḥmāni", audioUrl: "https://audio.qurancdn.com/wbw/001_001_003.mp3" },
              { arabic: "الرَّحِيمِ", transliteration: "r-raḥīm", audioUrl: "https://audio.qurancdn.com/wbw/001_001_004.mp3" },
            ],
          },
          {
            surah: 1, ayah: 2,
            arabic: "الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ",
            transliteration: "Al-ḥamdu li-llāhi rabbi l-ʿālamīn",
            translation: "All praise is for Allah, Lord of all the worlds.",
            audioUrl: "https://everyayah.com/data/Alafasy_128kbps/001002.mp3",
            words: [
              { arabic: "الْحَمْدُ", transliteration: "al-ḥamdu", audioUrl: "https://audio.qurancdn.com/wbw/001_002_001.mp3" },
              { arabic: "لِلَّهِ", transliteration: "li-llāhi", audioUrl: "https://audio.qurancdn.com/wbw/001_002_002.mp3" },
              { arabic: "رَبِّ", transliteration: "rabbi", audioUrl: "https://audio.qurancdn.com/wbw/001_002_003.mp3" },
              { arabic: "الْعَالَمِينَ", transliteration: "l-ʿālamīn", audioUrl: "https://audio.qurancdn.com/wbw/001_002_004.mp3" },
            ],
          },
          {
            surah: 1, ayah: 3,
            arabic: "الرَّحْمَٰنِ الرَّحِيمِ",
            transliteration: "Ar-raḥmāni r-raḥīm",
            translation: "The Most Gracious, the Most Merciful.",
            audioUrl: "https://everyayah.com/data/Alafasy_128kbps/001003.mp3",
            words: [
              { arabic: "الرَّحْمَٰنِ", transliteration: "ar-raḥmāni", audioUrl: "https://audio.qurancdn.com/wbw/001_003_001.mp3" },
              { arabic: "الرَّحِيمِ", transliteration: "r-raḥīm", audioUrl: "https://audio.qurancdn.com/wbw/001_003_002.mp3" },
            ],
          },
          {
            surah: 1, ayah: 4,
            arabic: "مَالِكِ يَوْمِ الدِّينِ",
            transliteration: "Māliki yawmi d-dīn",
            translation: "Master of the Day of Judgement.",
            audioUrl: "https://everyayah.com/data/Alafasy_128kbps/001004.mp3",
            words: [
              { arabic: "مَالِكِ", transliteration: "māliki", audioUrl: "https://audio.qurancdn.com/wbw/001_004_001.mp3" },
              { arabic: "يَوْمِ", transliteration: "yawmi", audioUrl: "https://audio.qurancdn.com/wbw/001_004_002.mp3" },
              { arabic: "الدِّينِ", transliteration: "d-dīn", audioUrl: "https://audio.qurancdn.com/wbw/001_004_003.mp3" },
            ],
          },
        ],
      },
    },
  },
  {
    id: "act_q2",
    title: "Surah Al-Ikhlas & Al-Falaq Pair",
    type: "quran",
    subject: "Quran Recitation",
    subjectId: S1,
    complexityRank: 2,
    coopMode: true,
    targetChildren: [C1, C2],
    durationMinutes: 20,
    parentInstructions:
      "Children take turns leading and echoing. One recites a verse, the other echoes. Swap after each surah.",
    exampleWalkthrough:
      "Yusuf leads Al-Ikhlas, Maryam echoes. Then Maryam leads Al-Falaq, Yusuf corrects gently if she stumbles.",
  },
  {
    id: "act_q3",
    title: "Al-Baqarah: First Five Ayahs",
    type: "quran",
    subject: "Quran Recitation",
    subjectId: S1,
    complexityRank: 3,
    coopMode: false,
    targetChildren: [C1],
    durationMinutes: 25,
    parentInstructions:
      "Work through the first 5 ayahs with Yusuf. Focus on the alif-lam-meem opening and distinguishing similar sounds. Use the written mushaf, not audio.",
    exampleWalkthrough:
      "Point to each word as Yusuf reads. When he reaches 'yuminoona' ask what belief (iman) means before continuing.",
  },
  {
    id: "act_q4",
    title: "Tajweed Rule: Noon Saakinah",
    type: "quran",
    subject: "Quran Recitation",
    subjectId: S1,
    complexityRank: 4,
    coopMode: false,
    targetChildren: [C1, C2],
    durationMinutes: 30,
    parentInstructions:
      "Teach the four rules of noon saakinah (idghaam, ikhfaa, iqlaab, idhhaar) using colour-coded examples. Children identify and name each rule.",
    exampleWalkthrough:
      "Draw a chart with each rule and one example. Quiz: 'min rabbikum — which rule?' Answer: idghaam. Repeat with 5 examples each.",
  },
  {
    id: "act_q5",
    title: "Surah Yaseen: Verses 1-12 with Meanings",
    type: "quran",
    subject: "Quran Recitation",
    subjectId: S1,
    complexityRank: 5,
    coopMode: false,
    targetChildren: [C1],
    durationMinutes: 45,
    parentInstructions:
      "Read verses 1-12 with Yusuf. After each verse, discuss its meaning in simple English. Ask him to connect the verse to something in his daily life.",
    exampleWalkthrough:
      "Verse 9 ('We have put yokes on their necks'): ask what a yoke is, then discuss how arrogance can blind a person to truth.",
  },
  // Mathematics (5 activities)
  {
    id: "act_m1",
    title: "Counting in Arabic Numbers",
    type: "mathematics",
    subject: "Mathematics",
    subjectId: S2,
    complexityRank: 1,
    coopMode: false,
    targetChildren: [C2],
    durationMinutes: 15,
    parentInstructions:
      "Practice counting objects 1-20, naming each number in Arabic then English. Use dates, marbles, or books as counters.",
    exampleWalkthrough:
      "Hold up pencils. Maryam counts: waahid, ithnaan, thalaatha… Then write numerals 1-10 together.",
    content: {
      kind: "problems",
      activityType: "mathematics",
      instructions: "Count carefully and write your answer. Tap 'Check answer' to see if you're right.",
      primaryLang: "en",
      problems: [
        { question: "How many is: 🍎🍎🍎 ?", answer: "3 (thalaatha)", hint: "Count each apple once.", working: "1, 2, 3 → three apples." },
        { question: "Count: 2 + 3 = ?", answer: "5 (khamsa)", hint: "Start at 2 and count up 3 more.", working: "2 → 3, 4, 5." },
        { question: "Which is bigger: 7 or 4?", answer: "7", hint: "Bigger means more.", working: "7 comes after 4 when counting." },
        { question: "What comes after 9?", answer: "10 (ʿashara)", hint: "Keep counting: …8, 9, ?", working: "9 then 10." },
      ],
    },
  },
  {
    id: "act_m2",
    title: "Times Tables 2s and 5s",
    type: "mathematics",
    subject: "Mathematics",
    subjectId: S2,
    complexityRank: 2,
    coopMode: true,
    targetChildren: [C1, C2],
    durationMinutes: 20,
    parentInstructions:
      "Yusuf teaches Maryam the 2s and 5s using call-and-response. Yusuf says the problem, Maryam answers. Then swap for the second table.",
    exampleWalkthrough:
      "Yusuf: '2 times 4?' Maryam: '8!' After 5 correct, Maryam teaches Yusuf the 5s table back.",
  },
  {
    id: "act_m3",
    title: "Fractions on a Number Line",
    type: "mathematics",
    subject: "Mathematics",
    subjectId: S2,
    complexityRank: 3,
    coopMode: false,
    targetChildren: [C1],
    durationMinutes: 25,
    parentInstructions:
      "Draw a number line 0-1. Ask Yusuf to place ½, ¼, ¾. Then introduce thirds. Connect to dividing oranges for real-world meaning.",
    exampleWalkthrough:
      "Cut an orange into 4 pieces. 'If you eat 1 piece, what fraction?' Place ¼ on the number line together.",
  },
  {
    id: "act_m4",
    title: "Multi-step Word Problems",
    type: "mathematics",
    subject: "Mathematics",
    subjectId: S2,
    complexityRank: 4,
    coopMode: false,
    targetChildren: [C1],
    durationMinutes: 35,
    parentInstructions:
      "Give Yusuf 3 multi-step problems. He must write working out step by step and re-read the question after each step.",
    exampleWalkthrough:
      "'A farmer has 144 dates. He gives 1/3 to neighbours and sells half the rest. How many kept?' 144÷3=48, 96÷2=48. Keeps 48.",
  },
  {
    id: "act_m5",
    title: "Islamic Finance: Zakat Calculation",
    type: "mathematics",
    subject: "Mathematics",
    subjectId: S2,
    complexityRank: 5,
    coopMode: false,
    targetChildren: [C1],
    durationMinutes: 40,
    parentInstructions:
      "Explain zakat (2.5% on savings above nisab) to Yusuf. Give 4 savings amounts and ask him to calculate zakat owed. Discuss why this system exists.",
    exampleWalkthrough:
      "Savings: £4,000. Zakat: 4000 × 0.025 = £100. Ask: 'What does this money do for the ummah?'",
  },
  // Arabic Language (5 activities)
  {
    id: "act_a1",
    title: "Arabic Alphabet Tracing",
    type: "noorani_qaida",
    subject: "Arabic Language",
    subjectId: S3,
    complexityRank: 1,
    coopMode: false,
    targetChildren: [C2],
    durationMinutes: 15,
    parentInstructions:
      "Use dotted-line tracing worksheet. Maryam traces each letter once, saying its name as she traces. Help her hold the pencil correctly.",
    exampleWalkthrough:
      "She traces 'alif' — straight line downward. Then 'baa' — a curved bowl with a dot underneath. Check she lifts the pencil to add dots.",
    content: {
      kind: "qaida_exercise",
      activityType: "noorani_qaida",
      instructions: "Tap each letter to hear it, then say it aloud before tracing.",
      primaryLang: "ar",
      exercises: [
        {
          title: "Recognise the letters",
          instruction: "Point to each letter and say its name out loud.",
          lang: "ar",
          items: [
            { text: "ا", transliteration: "alif", hint: "Throat — a straight line." },
            { text: "ب", transliteration: "baa", hint: "One dot below." },
            { text: "ت", transliteration: "taa", hint: "Two dots above." },
            { text: "ث", transliteration: "thaa", hint: "Three dots above." },
          ],
        },
        {
          title: "Short vowels (harakat)",
          instruction: "Blend each letter with its vowel and read the sound.",
          lang: "ar",
          items: [
            { text: "بَ", transliteration: "ba", hint: "Fatha — open 'a'." },
            { text: "بِ", transliteration: "bi", hint: "Kasra — 'i' below." },
            { text: "بُ", transliteration: "bu", hint: "Dhamma — 'u' above." },
          ],
        },
      ],
    },
  },
  {
    id: "act_a2",
    title: "Phonics Blending: Short Vowels",
    type: "noorani_qaida",
    subject: "Arabic Language",
    subjectId: S3,
    complexityRank: 2,
    coopMode: false,
    targetChildren: [C1, C2],
    durationMinutes: 20,
    parentInstructions:
      "Using flashcards with fatha, kasra, dhamma, blend consonant+vowel combinations. Each child reads 10 cards then writes 5 combinations.",
    exampleWalkthrough:
      "Card: ب + َ = 'ba'. Card: ب + ِ = 'bi'. After 5 cards, Yusuf writes his own: ka, ki, ku, ta, ti.",
  },
  {
    id: "act_a3",
    title: "Short Story Reading: Hassan and the Camel",
    type: "story_reading",
    subject: "Arabic Language",
    subjectId: S3,
    complexityRank: 3,
    coopMode: true,
    targetChildren: [C1, C2],
    durationMinutes: 25,
    parentInstructions:
      "Read 'Hassan wal-Jamal' together — Yusuf reads one line, Maryam the next. After, ask 3 comprehension questions in English.",
    exampleWalkthrough:
      "'Where did Hassan find the camel?' They point to the text. Encourage one new Arabic word in their answer.",
    content: {
      kind: "story",
      activityType: "story_reading",
      instructions: "Read together. Tap any word to hear it, a sentence to hear the line, or a paragraph to hear it all.",
      primaryLang: "en",
      story: {
        title: "Hassan and the Camel",
        lang: "en",
        paragraphs: [
          "Hassan woke early and could not find his father's camel. The pen by the well was empty, and the rope lay broken on the sand.",
          "He followed the deep footprints past the date palms. The sun was warm, but Hassan said Bismillah and kept walking, trusting that Allah would help him.",
          "At last he saw the camel resting in the shade of a tall rock, chewing slowly. Hassan spoke softly, took the rope, and led her home. His father smiled and said, 'You were patient and kind. Well done.'",
        ],
        vocab: [
          { word: "camel", meaning: "a large desert animal that can travel far without water" },
          { word: "footprints", meaning: "marks left on the ground by feet" },
          { word: "patient", meaning: "able to wait calmly without giving up" },
        ],
        comprehension: [
          "Why could Hassan not find the camel at first?",
          "What did Hassan say before he started walking?",
          "How do we know Hassan was kind to the camel?",
        ],
      },
    },
  },
  {
    id: "act_a4",
    title: "Sentence Construction: My Family",
    type: "teaching",
    subject: "Arabic Language",
    subjectId: S3,
    complexityRank: 4,
    coopMode: false,
    targetChildren: [C1],
    durationMinutes: 30,
    parentInstructions:
      "Yusuf writes 5 simple Arabic sentences about his family using: هذا/هذه + name + يعمل/تعمل. Model the first together, then he completes independently.",
    exampleWalkthrough:
      "Model: هذا أبي إبراهيم. يعمل مهندساً. Then Yusuf writes about Fatima, himself, and his sister.",
  },
  {
    id: "act_a5",
    title: "Short Paragraph: My Favourite Day",
    type: "teaching",
    subject: "Arabic Language",
    subjectId: S3,
    complexityRank: 5,
    coopMode: false,
    targetChildren: [C1],
    durationMinutes: 40,
    parentInstructions:
      "Yusuf writes a 4-5 sentence Arabic paragraph about his favourite day. Must include 2 adjectives and one time expression (صباحاً/مساءً).",
    exampleWalkthrough:
      "يومُ الجُمُعةِ هو يومي المُفضَّل. نذهبُ إلى المسجدِ صباحاً. Correct together, circling new vocabulary.",
  },
  // Science & Nature (5 activities)
  {
    id: "act_s1",
    title: "Plant Observation Journal",
    type: "teaching",
    subject: "Science & Nature",
    subjectId: S4,
    complexityRank: 1,
    coopMode: false,
    targetChildren: [C1, C2],
    durationMinutes: 20,
    parentInstructions:
      "Observe one plant for 10 minutes. Each child draws it and writes 3 observations: colour, smell, texture.",
    exampleWalkthrough:
      "Maryam: 'green leaves, smells strong, soft and bumpy'. Yusuf adds: 'insects visit it, spreads along the ground'.",
  },
  {
    id: "act_s2",
    title: "Water Cycle in a Bag",
    type: "teaching",
    subject: "Science & Nature",
    subjectId: S4,
    complexityRank: 2,
    coopMode: true,
    targetChildren: [C1, C2],
    durationMinutes: 30,
    parentInstructions:
      "Seal water in a zip-lock bag, tape to a sunny window. Check hourly. After 3 hours observe condensation and discuss evaporation, condensation, precipitation.",
    exampleWalkthrough:
      "After 2 hours: 'What is that mist?' Yusuf: 'water turned to vapour and cooled'. Connect: 'Allah sends rain this way — subhanAllah'.",
  },
  {
    id: "act_s3",
    title: "Seed Germination Experiment",
    type: "teaching",
    subject: "Science & Nature",
    subjectId: S4,
    complexityRank: 3,
    coopMode: false,
    targetChildren: [C1],
    durationMinutes: 35,
    parentInstructions:
      "Set up 3 bean seeds: sunlight+water, dark+water, sunlight+no water. Predict which grows best. Record observations daily for one week.",
    exampleWalkthrough:
      "Day 5: 'Seed 1 has a 2cm root. Seed 2 is pale. Seed 3 unchanged.' Yusuf concludes: 'plants need both water AND light'.",
  },
  {
    id: "act_s4",
    title: "Simple Circuit with LED and Buzzer",
    type: "computer",
    subject: "Science & Nature",
    subjectId: S4,
    complexityRank: 4,
    coopMode: true,
    targetChildren: [C1, C2],
    durationMinutes: 40,
    parentInstructions:
      "Build a basic circuit: battery + wire + LED + switch. Replace LED with buzzer. Ask: what happens when the circuit breaks?",
    exampleWalkthrough:
      "Yusuf connects battery to LED — it lights up. Maryam adds the switch. Then Yusuf adds a buzzer: 'needs 2 batteries for more current'.",
  },
  {
    id: "act_s5",
    title: "Design and Present an Experiment",
    type: "teaching",
    subject: "Science & Nature",
    subjectId: S4,
    complexityRank: 5,
    coopMode: false,
    targetChildren: [C1],
    durationMinutes: 50,
    parentInstructions:
      "Yusuf chooses a question, designs an experiment (control + variable), runs it for 5 days, records data, and presents findings to the family.",
    exampleWalkthrough:
      "Hypothesis: 'Plants grow faster with Quran audio.' Two pots, identical setup except audio. After 5 days measure stem heights and present.",
  },
];

// ── Date helpers ─────────────────────────────────────────────────────────────
function toDateKey(d) {
  return d.toISOString().slice(0, 10);
}

function mondayOfWeek(ref) {
  const d = new Date(ref);
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

// ── createDemoData ────────────────────────────────────────────────────────────
// Writes all demo data for a single family. Safe to call repeatedly — uses
// fixed IDs so each run overwrites cleanly rather than duplicating.
export async function createDemoData(db, familyId, uid) {
  const root = db.collection("families").doc(familyId);
  const now = new Date();

  // ── Family root + profile ──────────────────────────────────────────────────
  await root.set({
    name: PROFILE.familyName,
    ownerUid: uid,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });

  await root.collection("profile").doc("family").set({
    ...PROFILE,
    updatedAt: now,
    updatedBy: uid,
  });

  await root.collection("meta").doc("app").set({
    seeded: true,
    timezone: "Europe/London",
    createdAt: now,
  });

  // ── Members ────────────────────────────────────────────────────────────────
  await root.collection("members").doc(uid).set({
    role: "owner",
    displayName: "Ibrahim Al-Hassan",
    email: "demo@daralhikmah.app",
    joinedAt: now,
  });

  // ── Guardians ─────────────────────────────────────────────────────────────
  for (const { id, ...rest } of GUARDIANS) {
    await root.collection("guardians").doc(id).set({ ...rest, createdAt: now });
  }

  // ── Children ──────────────────────────────────────────────────────────────
  for (const { id, ...rest } of CHILDREN) {
    await root.collection("children").doc(id).set({ ...rest, createdAt: now });
  }

  // ── Skills + per-child bindings ───────────────────────────────────────────
  for (const { id, ...rest } of SKILLS) {
    await root.collection("skills").doc(id).set({ ...rest, createdAt: now });
    for (const childId of [C1, C2]) {
      await root
        .collection("children")
        .doc(childId)
        .collection("skills")
        .doc(id)
        .set({ bound: true, addedAt: now });
    }
  }

  // ── Curriculum ────────────────────────────────────────────────────────────
  await root.collection("curriculum").doc(CURR).set({ ...CURRICULUM, createdAt: now, createdBy: uid });

  for (const { id, ...rest } of SUBJECTS) {
    await root.collection("curriculum").doc(CURR).collection("subjects").doc(id).set({
      ...rest,
      createdAt: now,
    });
  }

  // ── Activities ────────────────────────────────────────────────────────────
  for (const { id, ...rest } of ACTIVITIES) {
    await root.collection("activities").doc(id).set({ ...rest, createdAt: now, createdBy: uid });
  }

  // ── Calendar blocks: current week Mon–Fri, 2 blocks per day ──────────────
  const monday = mondayOfWeek(now);
  const weekBlocks = [
    // Monday
    { dateOffset: 0, blockId: "blk_mon_1", activityId: "act_q1", scheduledTime: "09:00", status: "planned" },
    { dateOffset: 0, blockId: "blk_mon_2", activityId: "act_m1", scheduledTime: "10:00", status: "planned" },
    // Tuesday
    { dateOffset: 1, blockId: "blk_tue_1", activityId: "act_a1", scheduledTime: "09:00", status: "planned" },
    { dateOffset: 1, blockId: "blk_tue_2", activityId: "act_s1", scheduledTime: "10:30", status: "planned" },
    // Wednesday
    { dateOffset: 2, blockId: "blk_wed_1", activityId: "act_q2", scheduledTime: "09:00", status: "planned" },
    { dateOffset: 2, blockId: "blk_wed_2", activityId: "act_m2", scheduledTime: "10:00", status: "planned" },
    // Thursday
    { dateOffset: 3, blockId: "blk_thu_1", activityId: "act_a2", scheduledTime: "09:00", status: "planned" },
    { dateOffset: 3, blockId: "blk_thu_2", activityId: "act_s2", scheduledTime: "10:30", status: "planned" },
    // Friday
    { dateOffset: 4, blockId: "blk_fri_1", activityId: "act_q3", scheduledTime: "09:00", status: "planned" },
    { dateOffset: 4, blockId: "blk_fri_2", activityId: "act_m3", scheduledTime: "11:00", status: "planned" },
  ];

  for (const { dateOffset, blockId, activityId, scheduledTime, status } of weekBlocks) {
    const dateKey = toDateKey(addDays(monday, dateOffset));
    const activity = ACTIVITIES.find((a) => a.id === activityId);
    // Create the parent calendarDays doc so collection queries return it.
    await root.collection("calendarDays").doc(dateKey).set({ date: dateKey, createdAt: now }, { merge: true });
    await root
      .collection("calendarDays")
      .doc(dateKey)
      .collection("blocks")
      .doc(blockId)
      .set({
        activityId,
        activityTitle: activity?.title || activityId,
        subject: activity?.subject || "",
        subjectId: activity?.subjectId || "",
        type: activity?.type || "teaching",
        complexityRank: activity?.complexityRank || 1,
        coopMode: activity?.coopMode || false,
        targetChildren: activity?.targetChildren || [],
        durationMinutes: activity?.durationMinutes || 30,
        scheduledTime,
        notes: "",
        status,
        createdBy: uid,
        createdAt: now,
      });
  }

  // ── Last week: completed blocks with scores ───────────────────────────────
  const lastMonday = mondayOfWeek(addDays(monday, -7));
  const pastBlocks = [
    { dateOffset: 0, blockId: "blk_lmon_1", activityId: "act_q1", scheduledTime: "09:00" },
    { dateOffset: 1, blockId: "blk_ltue_1", activityId: "act_m1", scheduledTime: "09:00" },
    { dateOffset: 2, blockId: "blk_lwed_1", activityId: "act_a1", scheduledTime: "09:00" },
  ];

  for (const { dateOffset, blockId, activityId, scheduledTime } of pastBlocks) {
    const dateKey = toDateKey(addDays(lastMonday, dateOffset));
    const activity = ACTIVITIES.find((a) => a.id === activityId);
    await root.collection("calendarDays").doc(dateKey).set({ date: dateKey, createdAt: addDays(now, -7) }, { merge: true });
    await root
      .collection("calendarDays")
      .doc(dateKey)
      .collection("blocks")
      .doc(blockId)
      .set({
        activityId,
        activityTitle: activity?.title || activityId,
        subject: activity?.subject || "",
        subjectId: activity?.subjectId || "",
        type: activity?.type || "teaching",
        complexityRank: activity?.complexityRank || 1,
        coopMode: activity?.coopMode || false,
        targetChildren: activity?.targetChildren || [],
        durationMinutes: activity?.durationMinutes || 30,
        scheduledTime,
        notes: "",
        status: "done",
        createdBy: uid,
        createdAt: addDays(now, -7),
      });
  }

  // ── Scores ────────────────────────────────────────────────────────────────
  const scores = [
    { id: "sc_1", activityId: "act_q1", childId: C1, coopMode: false, drivingChildId: null, sharedSuccess: false, completed: true, scoredBy: uid },
    { id: "sc_2", activityId: "act_q1", childId: C2, coopMode: false, drivingChildId: null, sharedSuccess: false, completed: true, scoredBy: uid },
    { id: "sc_3", activityId: "act_m1", childId: C2, coopMode: false, drivingChildId: null, sharedSuccess: false, completed: true, scoredBy: uid },
    { id: "sc_4", activityId: "act_a1", childId: C2, coopMode: false, drivingChildId: null, sharedSuccess: false, completed: false, scoredBy: uid },
  ];

  for (const { id, ...rest } of scores) {
    await root.collection("scores").doc(id).set({ ...rest, scoredAt: addDays(now, -7) });
  }

  // ── Observations ──────────────────────────────────────────────────────────
  const observations = [
    {
      id: "obs_1",
      activityId: "act_q1",
      childId: C1,
      text: "Yusuf recited Al-Fatiha with beautiful focus today. He self-corrected 'maaliki' without prompting — a real improvement from last week.",
      authorUid: uid,
    },
    {
      id: "obs_2",
      activityId: "act_m1",
      childId: C2,
      text: "Maryam counted to 15 in Arabic entirely independently, then asked to do it again. Her confidence is growing noticeably.",
      authorUid: uid,
    },
    {
      id: "obs_3",
      activityId: "act_a1",
      childId: C2,
      text: "Struggled with the letter 'ain today — needed several attempts. Will revisit with a tracing game tomorrow before moving on.",
      authorUid: uid,
    },
  ];

  for (const { id, ...rest } of observations) {
    await root.collection("observations").doc(id).set({ ...rest, createdAt: addDays(now, -7) });
  }
}

// ── seedDemoFamily (Cloud Function) ─────────────────────────────────────────
// Creates a demo auth user (demo@daralhikmah.app / demo123456) and seeds a
// complete family under familyId "demo-al-hassan". Safe to call repeatedly.
export const seedDemoFamily = onCall(async (request) => {
  if (request.auth?.token?.platformRole !== "superadmin") {
    throw new HttpsError("permission-denied", "Superadmin only.");
  }

  const db = getFirestore();
  const auth = getAuth();
  const email = "demo@daralhikmah.app";
  const password = "demo123456";
  const familyId = "demo-al-hassan";

  // Create or retrieve the demo user.
  let uid;
  try {
    const existing = await auth.getUserByEmail(email);
    uid = existing.uid;
  } catch {
    const created = await auth.createUser({ email, password, displayName: "Ibrahim Al-Hassan" });
    uid = created.uid;
  }

  // Write users/{uid} so the auth store recognises the family on login.
  await db.collection("users").doc(uid).set({
    familyId,
    role: "owner",
    email,
    displayName: "Ibrahim Al-Hassan",
    createdAt: new Date(),
  });

  // Set custom claims so security rules pass immediately.
  const existing = (await auth.getUser(uid)).customClaims || {};
  await auth.setCustomUserClaims(uid, { ...existing, familyId, role: "owner" });

  await createDemoData(db, familyId, uid);

  return { familyId, uid, email, password };
});
