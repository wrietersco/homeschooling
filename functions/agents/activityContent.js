// Activity content generator — turns a syllabus activity into the *exact*
// thing a child does in the Player, provisioned per activity type (spec §30-48):
//
//   quran          → quran_reading  (the actual verses, word-by-word + qirat voice)
//   noorani_qaida  → qaida_exercise (letter / harakat / joining drills)
//   story_reading  → story          (storybook passage, word/sentence/paragraph voice)
//   mathematics    → problems       (problem sums to solve, with answers + working)
//   computer       → steps          (ordered hands-on worksheet)
//   ai_robotics    → steps
//   physical       → steps
//   teaching       → steps
//
// Content is generated AUTOMATICALLY while the syllabus agent creates each
// activity (see syllabus.js → create_activity, which calls
// generateContentForActivity). A standalone callable also exists so a parent
// can regenerate on demand. Both the parent ActivityView and the child
// ChildPlayerView render the same `content`, and the player token embeds a copy.
//
// All timestamps use new Date() to avoid the admin prototype clash in the notes.
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { resolveCaller } from "../lib/caller.js";
import { runAgent } from "./runtime.js";
import { resolveLlm } from "./agentConfig.js";
import { describeGuardian, summarizeChildPerformance } from "./grounding.js";
import { enrichQuranContent } from "./quranSource.js";
import { generateActivityImage, generateObjectImages } from "./imageGen.js";
import { loadSubjectPlans, buildPlanContextString } from "./contentPlan.js";
import { enforceDailyLimit } from "../lib/rateLimit.js";

// Map an activity type to the content kind the child actually performs. NOTE:
// `quran_reading` is reachable ONLY from type `quran` — Arabic literacy never
// renders Qur'anic verses. Activities with no natural child-facing artifact
// (generic teaching / discussion / games) fall back to parent `tips`.
export function contentKindForType(type) {
  switch (type) {
    case "quran": return "quran_reading";
    case "noorani_qaida": return "qaida_exercise";
    case "conversation": return "dialogue";  // listening & speaking — spoken scene
    case "arabic_reading":
    case "urdu_reading": return "reading";   // RTL graded reading / phonics passage
    case "english_reading":
    case "story_reading": return "story";    // legacy story_reading → English story
    case "mathematics": return "problems";
    case "computer":
    case "ai_robotics":
    case "physical": return "steps";         // procedural worksheet
    case "teaching": return "tips";          // parent-led → facilitation guidance
    default: return "tips";
  }
}

// Default reading language for a type (used when the model omits primaryLang).
function defaultLangForType(type) {
  if (type === "quran" || type === "noorani_qaida" || type === "arabic_reading") return "ar";
  if (type === "urdu_reading") return "ur";
  return "en";
}

// ─── save_content tool declaration ────────────────────────────────────────────
// One call captures the whole structured payload. All sub-structures are
// optional; the model fills only the one matching `kind`.
const SAVE_CONTENT_DECLARATION = {
  name: "save_content",
  description:
    "Save the structured, ready-to-do content for this activity. Fill ONLY the field that matches `kind`. Every Arabic value must be FULLY VOWELED (with harakat).",
  parameters: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        description: "One of: quran_reading, qaida_exercise, reading, story, problems, steps, tips. Must match the requested kind.",
      },
      instructions: { type: "string", description: "One or two sentences telling the child what to do." },
      primaryLang: { type: "string", description: "BCP-47 lang of the main text the child reads, e.g. 'ar', 'en'." },
      usedPassages: {
        type: "array",
        items: { type: "string" },
        description: "List any Qur'anic surah/ayah or named dua/supplication you included in this content (e.g. 'Surah Al-Asr', 'Dua before sleeping'). Used to vary religious content across activities so the same few are not repeated everywhere.",
      },

      // quran_reading — the actual verses, broken into words for word-by-word qirat.
      quran: {
        type: "object",
        description: "The Quran passage for this activity.",
        properties: {
          surahName: { type: "string", description: "e.g. 'Al-Fatihah'." },
          reference: { type: "string", description: "e.g. 'Surah 1:1-7'." },
          verses: {
            type: "array",
            items: {
              type: "object",
              properties: {
                surah: { type: "number", description: "Surah number 1-114 (REQUIRED for recitation audio)." },
                ayah: { type: "number", description: "Ayah number within the surah (REQUIRED for recitation audio). For Al-Fatihah, the Basmalah is ayah 1." },
                arabic: { type: "string", description: "The full ayah in fully-voweled Arabic." },
                transliteration: { type: "string", description: "Latin-script pronunciation of the whole ayah." },
                translation: { type: "string", description: "English meaning of the ayah." },
                words: {
                  type: "array",
                  description: "The ayah split word-by-word so the child can tap each word.",
                  items: {
                    type: "object",
                    properties: {
                      arabic: { type: "string", description: "One Arabic word, fully voweled." },
                      transliteration: { type: "string", description: "Pronunciation of that word." },
                      en: { type: "string", description: "Short English meaning of THIS word (a word-by-word gloss, not the whole-ayah translation)." },
                      ur: { type: "string", description: "Short Urdu meaning of THIS word (in Urdu script)." },
                    },
                    required: ["arabic"],
                  },
                },
              },
              required: ["arabic", "translation"],
            },
          },
        },
        required: ["verses"],
      },

      // qaida_exercise — Noorani Qaida drills.
      exercises: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            instruction: { type: "string" },
            lang: { type: "string" },
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  text: { type: "string", description: "Arabic glyph/word, fully voweled." },
                  transliteration: { type: "string" },
                  en: { type: "string", description: "Short English meaning, when the item is a whole word (omit for bare letters)." },
                  ur: { type: "string", description: "Short Urdu meaning (Urdu script), when the item is a whole word." },
                  hint: { type: "string", description: "Optional makharij/articulation hint." },
                  imageSubject: { type: "string", description: "When this item is a whole WORD naming a concrete object/animal the child should recognise from a picture (e.g. a letter-sound/picture-association drill), give a short ENGLISH description of the object to illustrate, e.g. 'a brown goat'. Omit for bare letters or abstract words." },
                },
                required: ["text"],
              },
            },
          },
          required: ["title", "instruction", "items"],
        },
      },

      // story — a short graded reading passage.
      story: {
        type: "object",
        properties: {
          title: { type: "string" },
          lang: { type: "string" },
          paragraphs: { type: "array", items: { type: "string" } },
          paragraphTranslations: {
            type: "array",
            description: "When the passage is NOT in the family's native language (Urdu) — e.g. an Arabic reading passage — give the translation of EACH paragraph, in the SAME order and count as `paragraphs`. Omit entirely for Urdu passages (native, no translation needed).",
            items: {
              type: "object",
              properties: {
                en: { type: "string", description: "English translation of this paragraph." },
                ur: { type: "string", description: "Urdu translation of this paragraph (Urdu script)." },
              },
            },
          },
          vocab: {
            type: "array",
            items: {
              type: "object",
              properties: {
                word: { type: "string" },
                meaning: { type: "string" },
                imageSubject: { type: "string", description: "When this word names a concrete object/animal a child should identify from a picture (e.g. for a letter-sound/picture-association activity), give a short ENGLISH description of the object to illustrate, e.g. 'a brown goat' for بکری. Omit for abstract words." },
              },
              required: ["word", "meaning"],
            },
          },
          comprehension: { type: "array", items: { type: "string" } },
        },
        required: ["title", "paragraphs"],
      },

      // problems — math problem sums.
      problems: {
        type: "array",
        description: "Problem sums the child solves, easiest first.",
        items: {
          type: "object",
          properties: {
            question: { type: "string", description: "The problem to solve, e.g. '7 + 5 = ?' or a word problem." },
            answer: { type: "string", description: "The correct answer." },
            hint: { type: "string", description: "A hint if the child is stuck. Optional." },
            working: { type: "string", description: "Step-by-step solution to reveal after. Optional." },
          },
          required: ["question", "answer"],
        },
      },

      // steps — ordered hands-on worksheet (computer / robotics / physical / teaching).
      worksheet: {
        type: "object",
        properties: {
          goal: { type: "string", description: "What the child will have done/learned by the end." },
          materials: { type: "array", items: { type: "string" }, description: "Things needed before starting." },
          steps: {
            type: "array",
            items: {
              type: "object",
              properties: {
                instruction: { type: "string", description: "What to do in this step." },
                detail: { type: "string", description: "Extra detail/example for this step. Optional." },
              },
              required: ["instruction"],
            },
          },
          checks: { type: "array", items: { type: "string" }, description: "Questions to confirm understanding." },
        },
        required: ["steps"],
      },

      // tips — parent facilitation guidance for activities with no child artifact.
      tips: {
        type: "object",
        description: "Helpful guidance so the PARENT can run this activity well (used when there's no readable text / problems / steps for the child).",
        properties: {
          tips: { type: "array", items: { type: "string" }, description: "3-6 concrete tips for running the activity effectively." },
          watchFor: { type: "array", items: { type: "string" }, description: "Common pitfalls or signs the child is struggling." },
          encourage: { type: "array", items: { type: "string" }, description: "Encouraging phrases / ways to praise effort." },
        },
        required: ["tips"],
      },

      // dialogue — a practical spoken conversation for listening & speaking.
      dialogue: {
        type: "object",
        description: "A real-life spoken conversation/scene for a Listening & Speaking activity.",
        properties: {
          title: { type: "string" },
          lang: { type: "string", description: "BCP-47 of the spoken lines, e.g. 'ar'." },
          scenario: { type: "string", description: "One short line setting the scene (who is talking and where)." },
          turns: {
            type: "array",
            description: "The conversation, line by line, alternating between speakers.",
            items: {
              type: "object",
              properties: {
                speaker: { type: "string", description: "Display name of the speaker, e.g. 'Mother', 'Yusuf', 'Shopkeeper'." },
                role: { type: "string", description: "One of: parent, child, friend, teacher, shopkeeper, narrator, other — used to give each character a distinct voice." },
                text: { type: "string", description: "The spoken line in the target language (fully voweled if Arabic)." },
                transliteration: { type: "string", description: "Latin-script pronunciation of the line." },
                en: { type: "string", description: "English translation of the line." },
                ur: { type: "string", description: "Urdu translation of the line (Urdu script)." },
              },
              required: ["speaker", "text"],
            },
          },
        },
        required: ["turns"],
      },
    },
    required: ["kind"],
  },
};

// ─── Prompt ───────────────────────────────────────────────────────────────────
function buildSystemPrompt({ activity, kind, guidingLight, children, guardians = [], recentlyUsed = [], childPerformance = "", planContext = "" }) {
  const childLine = children.length
    ? children.map((c) => `${c.name || c.id}${c.dob ? ` (dob ${c.dob})` : ""}`).join("; ")
    : "(none)";
  const guardianLine = guardians.length ? guardians.join("; ") : "(none)";

  const kindGuidance = {
    quran_reading:
      "Provide the ACTUAL Quranic verses for this activity in fully-voweled Arabic. Use only well-known, correct text (prefer short surahs / Juz Amma unless the activity names a specific passage). For EACH verse you MUST give the correct `surah` (1-114) and `ayah` numbers — these drive the real recitation audio — plus the full ayah, its transliteration, its English translation, and a `words` array splitting the ayah word-by-word in order (each with arabic + transliteration + a short word-by-word `en` English gloss + a short `ur` Urdu gloss in Urdu script). Split words exactly as the canonical mushaf does. Keep to the verses this activity covers.",
    qaida_exercise:
      "Produce 3-5 Noorani Qaida drills ordered easiest→hardest (letter recognition → harakat → joining → short words). Every item must be FULLY VOWELED Arabic with a Latin transliteration and, where useful, a makharij hint. For items that are whole WORDS (not bare letters), also give a short English `en` meaning and a short Urdu `ur` meaning. If the activity is a letter-sound / picture-association drill (the child names an object that starts with a letter), set `imageSubject` (a short ENGLISH object description) on those word items so a picture is generated for the child to name.",
    reading:
      "Produce a graded reading passage IN THE ACTIVITY'S TARGET LANGUAGE (Arabic or Urdu — set story.lang to 'ar' or 'ur'). Fill the `story` object. For early ranks focus on letters/phonics and simple words; for later ranks use short sentences/paragraphs with 3-6 vocabulary words and 2-3 comprehension questions. This is language literacy — NOT Qur'an. Keep it modest and aligned with the guiding light. When the passage is in a NON-NATIVE language (the family's native language is Urdu, so this means an Arabic passage), ALSO fill `paragraphTranslations` with the English `en` and Urdu `ur` translation of every paragraph, in the same order and count as `paragraphs`, so the child can read the meaning. For an Urdu passage (native language) omit `paragraphTranslations`. When the activity associates letters or words with pictures (e.g. letter-sound / picture-naming), set `imageSubject` (a short ENGLISH object description, e.g. 'a brown goat') on the vocabulary words that name a concrete object — the system will generate a picture for each so the child can name it.",
    story:
      "Produce ONE short, original ENGLISH story passage of 2-4 short paragraphs at the child's reading level (set story.lang to 'en'). Include 3-6 vocabulary words with simple meanings and 2-3 comprehension questions. The story must embody the guiding light.",
    tips:
      "This activity has no readable text / problems / steps for the child — it's parent-led. Fill the `tips` object with 3-6 concrete tips for running it well, a few things to watch for, and encouraging phrases. Be specific to THIS activity and the children. Do NOT invent verses, drills, or worksheets.",
    problems:
      "Produce 5-10 problem sums matched to the activity's complexity rank. Each problem has the question to solve, the correct answer, an optional hint, and optional step-by-step working. Progress from easier to harder within the set.",
    steps:
      "Break this activity into a clear, ordered worksheet the child can follow: a one-line goal, the materials needed, 4-8 numbered steps (each a concrete action, with optional detail/example), and 2-3 'check' questions to confirm it worked.",
    dialogue:
      "Produce a practical, natural spoken CONVERSATION for a Listening & Speaking activity — a real-life scene (e.g. a parent and child at breakfast, two friends playing, a child and a shopkeeper) matched to the activity's theme. Fill the `dialogue` object: a short `scenario` line and 6-12 alternating `turns`. Each turn needs the speaker's display name, a `role` (parent/child/friend/teacher/shopkeeper/narrator/other) so each character gets a distinct voice, the spoken line in the target language (fully voweled if Arabic), its transliteration, an English `en` translation and an Urdu `ur` translation. Keep lines short, age-appropriate, and useful for daily life.",
  };

  // Anti-repetition (#3): non-Qur'an activities kept defaulting to Al-Fatihah /
  // Al-Ikhlas, which bored families. Push for variety here; dedicated Qur'an
  // activities (quran_reading) are exempt because repetition aids memorisation.
  const varietyBlock = kind === "quran_reading" ? "" : [
    "VARIETY OF RELIGIOUS CONTENT:",
    "- Do NOT default to Surah Al-Fatihah or Surah Al-Ikhlas. The child already meets those in dedicated Qur'an activities.",
    "- If you include a dua or short surah, choose a VARIED, theme-appropriate, lesser-used one; fresh material keeps this engaging.",
    "- Purposeful spaced revisiting of earlier material is welcome, but never repeat the same one or two passages everywhere.",
    recentlyUsed.length ? `- Recently used across this family's activities (avoid repeating unless deliberately revisiting): ${recentlyUsed.slice(-25).join("; ")}.` : "",
    "- After choosing content, record any surah/ayah or named dua you used in the `usedPassages` field.",
  ].filter(Boolean).join("\n");

  return [
    "You are creating the exact, ready-to-do content a child performs for this activity.",
    "",
    `ACTIVITY: ${activity.title}`,
    `Type: ${activity.type} · Complexity rank ${activity.complexityRank || 1}/5 · ~${activity.durationMinutes || 20} min`,
    activity.parentInstructions ? `Parent's plan: ${activity.parentInstructions}` : "",
    "",
    `Guiding light (must be reflected): ${guidingLight || "(not set)"}`,
    `Guardians (parents/teachers): ${guardianLine}`,
    `Children: ${childLine}`,
    childPerformance ? `\n${childPerformance}\nPitch this activity's difficulty to the child(ren) it targets, based on the progress above.` : "",
    // The subject plan (the "canvas") — the agent renders THIS activity's
    // pre-decided objective and weaves it into the surrounding arc.
    planContext ? `\n${planContext}` : "",
    "",
    `REQUIRED CONTENT KIND: ${kind}`,
    kindGuidance[kind] || kindGuidance.steps,
    varietyBlock,
    "",
    "Call save_content exactly once with the structured payload. Do not write any prose outside the tool call.",
  ].filter(Boolean).join("\n");
}

// Real recitation audio from canonical surah:ayah:word numbers.
// Per-ayah: EveryAyah (Mishary Alafasy). Per-word: quran.com word-by-word CDN.
const pad3 = (n) => String(n).padStart(3, "0");
function ayahAudioUrl(surah, ayah) {
  if (!surah || !ayah) return "";
  return `https://everyayah.com/data/Alafasy_128kbps/${pad3(surah)}${pad3(ayah)}.mp3`;
}
function wordAudioUrl(surah, ayah, wordIndex) {
  if (!surah || !ayah || !wordIndex) return "";
  return `https://audio.qurancdn.com/wbw/${pad3(surah)}_${pad3(ayah)}_${pad3(wordIndex)}.mp3`;
}

// ─── Sanitiser — clamp/normalise whatever the model returns ───────────────────
function sanitizeContent(kind, raw, type) {
  const str = (v) => (typeof v === "string" ? v.trim() : "");
  const arr = (v) => (Array.isArray(v) ? v : []);
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const out = {
    kind,
    activityType: type,
    instructions: str(raw.instructions),
    primaryLang: str(raw.primaryLang) || defaultLangForType(type),
    usedPassages: arr(raw.usedPassages).map(str).filter(Boolean).slice(0, 20),
    generatedAt: new Date(),
  };

  if (kind === "quran_reading") {
    const q = raw.quran || {};
    out.quran = {
      surahName: str(q.surahName),
      reference: str(q.reference),
      verses: arr(q.verses).slice(0, 30).map((v) => {
        const surah = num(v.surah);
        const ayah = num(v.ayah);
        let wordIdx = 0;
        return {
          surah,
          ayah,
          arabic: str(v.arabic),
          transliteration: str(v.transliteration),
          translation: str(v.translation),
          audioUrl: ayahAudioUrl(surah, ayah),
          words: arr(v.words).slice(0, 60).map((w) => {
            const word = typeof w === "string"
              ? { arabic: w.trim(), transliteration: "", en: "", ur: "" }
              : { arabic: str(w.arabic), transliteration: str(w.transliteration), en: str(w.en), ur: str(w.ur) };
            if (word.arabic) word.audioUrl = wordAudioUrl(surah, ayah, ++wordIdx);
            return word;
          }).filter((w) => w.arabic),
        };
      }).filter((v) => v.arabic),
    };
  } else if (kind === "qaida_exercise") {
    out.exercises = arr(raw.exercises).slice(0, 10).map((e) => ({
      title: str(e.title),
      instruction: str(e.instruction),
      lang: str(e.lang) || out.primaryLang,
      items: arr(e.items).slice(0, 30).map((it) =>
        typeof it === "string"
          ? { text: it.trim(), transliteration: "", en: "", ur: "", hint: "" }
          : { text: str(it.text), transliteration: str(it.transliteration), en: str(it.en), ur: str(it.ur), hint: str(it.hint), imageSubject: str(it.imageSubject) }
      ).filter((it) => it.text),
    })).filter((e) => e.items.length);
  } else if (kind === "story" || kind === "reading") {
    // `reading` (Arabic/Urdu literacy) reuses the story payload + renderer; the
    // language tag drives RTL + the proper joined-script font.
    const s = raw.story || {};
    const paragraphs = arr(s.paragraphs).map(str).filter(Boolean).slice(0, 8);
    // Per-paragraph translations (en/ur) for non-native passages. Keep aligned to
    // the kept paragraphs; an entry with no text is dropped to a null placeholder.
    const rawTranslations = arr(s.paragraphTranslations).slice(0, 8).map((t) => {
      const en = str(t && t.en);
      const ur = str(t && t.ur);
      return en || ur ? { en, ur } : null;
    });
    const hasTranslations = rawTranslations.some(Boolean);
    out.story = {
      title: str(s.title) || (kind === "reading" ? "Reading" : "Story"),
      lang: str(s.lang) || out.primaryLang,
      paragraphs,
      ...(hasTranslations ? { paragraphTranslations: paragraphs.map((_, i) => rawTranslations[i] || null) } : {}),
      vocab: arr(s.vocab).slice(0, 12).map((v) => ({ word: str(v.word), meaning: str(v.meaning), imageSubject: str(v.imageSubject) })).filter((v) => v.word),
      comprehension: arr(s.comprehension).map(str).filter(Boolean).slice(0, 5),
    };
  } else if (kind === "tips") {
    const t = raw.tips || {};
    out.tips = {
      tips: arr(t.tips).map(str).filter(Boolean).slice(0, 8),
      watchFor: arr(t.watchFor).map(str).filter(Boolean).slice(0, 6),
      encourage: arr(t.encourage).map(str).filter(Boolean).slice(0, 6),
    };
  } else if (kind === "dialogue") {
    const d = raw.dialogue || {};
    out.dialogue = {
      title: str(d.title) || "Conversation",
      lang: str(d.lang) || out.primaryLang,
      scenario: str(d.scenario),
      turns: arr(d.turns).slice(0, 40).map((t) => ({
        speaker: str(t.speaker),
        role: str(t.role).toLowerCase(),
        text: str(t.text),
        transliteration: str(t.transliteration),
        en: str(t.en),
        ur: str(t.ur),
      })).filter((t) => t.text),
    };
  } else if (kind === "problems") {
    out.problems = arr(raw.problems).slice(0, 20).map((p) => ({
      question: str(p.question),
      answer: str(p.answer),
      hint: str(p.hint),
      working: str(p.working),
    })).filter((p) => p.question);
  } else { // steps
    const w = raw.worksheet || {};
    out.worksheet = {
      goal: str(w.goal),
      materials: arr(w.materials).map(str).filter(Boolean).slice(0, 20),
      steps: arr(w.steps).slice(0, 20).map((s) =>
        typeof s === "string"
          ? { instruction: s.trim(), detail: "" }
          : { instruction: str(s.instruction), detail: str(s.detail) }
      ).filter((s) => s.instruction),
      checks: arr(w.checks).map(str).filter(Boolean).slice(0, 8),
    };
  }
  return out;
}

// Did the model actually fill the payload, or call save_content with a hollow
// shell? Forced function calling guarantees the *call* happens, so we must check
// the *content* ourselves — an empty payload should retry / fail loudly rather
// than silently save a blank activity. Returns true when there's nothing usable.
export function isContentEmpty(content) {
  if (!content) return true;
  switch (content.kind) {
    case "quran_reading":
      return !(content.quran?.verses?.length);
    case "qaida_exercise":
      return !(content.exercises?.length);
    case "story":
    case "reading":
      return !(content.story?.paragraphs?.length);
    case "dialogue":
      return !(content.dialogue?.turns?.length);
    case "problems":
      return !(content.problems?.length);
    case "tips":
      return !(content.tips?.tips?.length);
    default: // steps
      return !(content.worksheet?.steps?.length);
  }
}

// Slugify a title for a storage path.
function slugify(s) {
  return String(s || "activity").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "activity";
}

// Turn a failed agent run (no save_content captured) into a human-readable reason
// so the UI/logs can say WHY content generation produced nothing.
export function describeNoContent(result, kind = "") {
  const where = kind ? ` (${kind})` : "";
  switch (result?.stoppedAt) {
    case "truncated":
      return `The model ran out of output space${where} — the response was too large to finish. Try a smaller activity or raise the content token budget.`;
    case "blocked":
      return `The response was filtered${result.blockReason ? ` (${result.blockReason})` : ""}${where}. Try rephrasing the activity.`;
    case "limit":
      return `The agent didn't finish within its step budget${where}.`;
    case "final":
      return `The model replied without calling save_content${where} — no structured content was produced.`;
    default:
      return `Content generation produced nothing${where}.`;
  }
}

// ─── Pure generator — produces content for an activity, no DB access ──────────
// Reused by the syllabus worker (inline, at creation time) and the callable.
// `geminiApiKey` + `storagePrefix` enable storybook image generation for stories.
export async function generateContentForActivity({ activity, children = [], guardians = [], guidingLight = "", childPerformance = "", llm, genConfig, db = null, geminiApiKey = "", storagePrefix = "", planContext = "" }) {
  const kind = contentKindForType(activity.type);
  const familyId = storagePrefix || "";

  // Anti-repetition ledger (#3): read the family's recently-used passages so the
  // prompt can steer non-Qur'an activities away from the same few surahs/duas.
  let recentlyUsed = [];
  if (db && familyId) {
    try {
      const snap = await db.collection("families").doc(familyId).collection("meta").doc("contentUsage").get();
      if (snap.exists) recentlyUsed = (snap.data().recent || []).filter(Boolean).slice(-40);
    } catch (e) { console.warn(`[content] usage-ledger read failed for ${familyId}: ${e?.message || e}`); }
  }

  let captured = null;
  const tools = {
    async save_content(args) {
      captured = sanitizeContent(kind, args || {}, activity.type);
      return { saved: true };
    },
  };
  const system = buildSystemPrompt({ activity, kind, guidingLight, children, guardians, recentlyUsed, childPerformance, planContext });

  // One attempt of the agent. Returns the runAgent result so we can diagnose why
  // it produced no content (the usual culprit is MAX_TOKENS truncating the
  // tool call before save_content fires).
  const baseConfig = genConfig ?? { maxOutputTokens: 4096, temperature: 0.5 };
  async function attempt(config, nudge = "") {
    captured = null;
    return runAgent({
      llm, system,
      toolDeclarations: [SAVE_CONTENT_DECLARATION],
      tools,
      userMessage: `Create the ${kind} content for "${activity.title}" now and call save_content exactly once with valid JSON.${nudge}`,
      maxSteps: 4,
      generationConfig: config,
      // Force the model to emit save_content — it cannot reply with prose and
      // skip the tool (the old "replied without calling save_content" failure).
      // stopAfterTool ends the loop the moment it fires.
      toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["save_content"] } },
      stopAfterTool: "save_content",
    });
  }

  let result = await attempt(baseConfig);
  // Treat a captured-but-empty payload the same as no capture: forced function
  // calling means save_content always fires, so the real failure now is a hollow
  // call (usually the args were truncated). Drop it so the retry can refill.
  if (captured && isContentEmpty(captured)) captured = null;
  // Retry once on failure — give it a bigger output budget (truncation is the
  // most common cause) and an explicit nudge to keep the payload within limits.
  if (!captured) {
    const retryConfig = { ...baseConfig, maxOutputTokens: Math.max(8192, Number(baseConfig.maxOutputTokens) || 0) };
    result = await attempt(retryConfig, " Be concise and stay within the output limit so the JSON is complete.");
    if (captured && isContentEmpty(captured)) captured = null;
  }
  const reason = captured
    ? ""
    : (result?.stoppedAt === "tool"
      ? `The model called save_content but the ${kind} payload was empty — it likely ran out of output space. Try raising the content token budget.`
      : describeNoContent(result, kind));

  // Quran text must be canonical — overwrite the agent's draft Arabic with the
  // verified Quran text/words/audio. Best-effort; never throws.
  if (captured && captured.kind === "quran_reading") {
    try {
      await enrichQuranContent(captured, { db }); // local-first from imported quran/*, API fallback
    } catch (e) {
      console.warn(`[content] quran enrichment failed for "${activity.title}": ${e?.message || e}`);
      if (captured.quran) captured.quran.textSource = "ai_unverified";
    }
  }

  // Storybook illustration for reading stories (spec §41). Best-effort.
  if (captured && captured.kind === "story" && captured.story && geminiApiKey) {
    const scene = `${captured.story.title}. ${(captured.story.paragraphs || [])[0] || ""}`.slice(0, 400);
    const image = await generateActivityImage({
      scene,
      apiKey: geminiApiKey,
      pathHint: `${storagePrefix || "shared"}/${slugify(activity.title)}`,
    });
    if (image) captured.story.image = image;
  }

  // Picture-naming illustrations: letter-sound / picture-association activities
  // ask the child to name an object shown as a picture. The model flags those
  // items with `imageSubject`; generate one clear picture per item (capped,
  // best-effort) and attach it. Covers reading/story vocab and qaida words.
  if (captured && geminiApiKey) {
    const targets = [];
    if ((captured.kind === "story" || captured.kind === "reading") && captured.story) {
      for (const v of captured.story.vocab || []) if (v.imageSubject) targets.push(v);
    } else if (captured.kind === "qaida_exercise") {
      for (const ex of captured.exercises || []) for (const it of ex.items || []) if (it.imageSubject) targets.push(it);
    }
    if (targets.length) {
      const base = `${storagePrefix || "shared"}/${slugify(activity.title)}`;
      const images = await generateObjectImages(
        targets.slice(0, 8).map((t, i) => ({ subject: t.imageSubject, pathHint: `${base}-pic${i + 1}` })),
        { apiKey: geminiApiKey }
      );
      images.forEach((img, i) => { if (img) targets[i].image = img; });
    }
  }

  // Record what this activity used so future activities can vary (#3), then drop
  // the bookkeeping field from the saved content (it's metadata, not for display).
  if (captured) {
    const used = Array.isArray(captured.usedPassages) ? captured.usedPassages : [];
    if (db && familyId && used.length) {
      try {
        const ref = db.collection("families").doc(familyId).collection("meta").doc("contentUsage");
        const merged = [...recentlyUsed, ...used].slice(-60);
        await ref.set({ recent: merged, updatedAt: new Date() }, { merge: true });
      } catch (e) { console.warn(`[content] usage-ledger write failed for ${familyId}: ${e?.message || e}`); }
    }
    delete captured.usedPassages;
  }

  return { kind, content: captured, reason };
}

// Load the family context (children + guardians + guiding light) for generation.
async function loadFamilyContext(db, familyId) {
  const [childrenSnap, guardiansSnap, profileSnap] = await Promise.all([
    db.collection("families").doc(familyId).collection("children").limit(20).get(),
    db.collection("families").doc(familyId).collection("guardians").limit(20).get(),
    db.collection("families").doc(familyId).collection("profile").doc("family").get(),
  ]);
  return {
    children: childrenSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    guardians: guardiansSnap.docs.map((d) => describeGuardian(d.data(), d.id)),
    guidingLight: profileSnap.exists ? (profileSnap.data().guidingLight || "") : "",
  };
}

// ─── Core runner for the callable (loads context, writes to DB) ───────────────
export async function runGenerateContent({ db, familyId, activityId, uid, llm, genConfig }) {
  const activityRef = db
    .collection("families").doc(familyId)
    .collection("activities").doc(activityId);
  const snap = await activityRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "Activity not found.");
  const activity = { id: snap.id, ...snap.data() };

  const { children, guardians, guidingLight } = await loadFamilyContext(db, familyId);
  const childPerformance = await summarizeChildPerformance(db, familyId, children);

  // Plan context (the canvas) — feed this activity its place in the subject arc.
  const plans = await loadSubjectPlans(db, familyId);
  const planContext = activity.subjectId ? buildPlanContextString(plans.get(activity.subjectId), activityId) : "";

  const { kind, content, reason } = await generateContentForActivity({
    activity, children, guardians, guidingLight, childPerformance, llm, genConfig, db,
    geminiApiKey: process.env.GEMINI_API_KEY || "",
    storagePrefix: familyId,
    planContext,
  });
  if (!content) {
    await activityRef.update({ contentError: reason || "No content produced." }).catch(() => {});
    throw new HttpsError("internal", reason || "The content generator did not return any content. Please try again.");
  }

  await activityRef.update({ content, contentGeneratedAt: new Date(), contentBy: uid, contentError: "" });
  return { kind, content };
}

// ─── Backfill — generate content for every activity that lacks it ─────────────
// Processes a bounded batch per call (LLM + image latency) and returns how many
// remain so the client can loop until done. Best-effort per activity: one
// failure never aborts the batch.
export async function runBackfill({ db, familyId, uid, llm, genConfig, limit, shouldCancel = null }) {
  const snap = await db
    .collection("families").doc(familyId)
    .collection("activities").limit(500).get();
  const missing = snap.docs.filter((d) => !d.data().content);
  const total = missing.length;
  if (!total) return { total: 0, processed: 0, remaining: 0 };

  const { children, guardians, guidingLight } = await loadFamilyContext(db, familyId);
  const childPerformance = await summarizeChildPerformance(db, familyId, children);
  // Load all subject plans once per pass; each activity reads its slice (canvas).
  const plans = await loadSubjectPlans(db, familyId);
  const batch = missing.slice(0, limit);

  let processed = 0;
  let cancelled = false;
  for (const d of batch) {
    // Stop promptly if the parent hit "Stop" — checked between activities so an
    // in-flight batch ends within one activity rather than running to completion.
    if (shouldCancel && (await shouldCancel())) { cancelled = true; break; }
    try {
      const activity = { id: d.id, ...d.data() };
      const planContext = activity.subjectId ? buildPlanContextString(plans.get(activity.subjectId), activity.id) : "";
      const { content, reason } = await generateContentForActivity({
        activity, children, guardians, guidingLight, childPerformance, llm, genConfig, db,
        geminiApiKey: process.env.GEMINI_API_KEY || "",
        storagePrefix: familyId,
        planContext,
      });
      if (content) {
        await d.ref.update({ content, contentGeneratedAt: new Date(), contentBy: uid, contentError: "" });
        processed++;
      } else {
        // Record WHY so it's visible instead of a silent skip, then retry later.
        await d.ref.update({ contentError: reason || "No content produced." });
        console.warn(`[content] backfill produced no content for ${d.id} (${activity.type}): ${reason}`);
      }
    } catch (e) {
      // skip this activity; it will be retried on a later backfill pass
      console.warn(`[content] backfill skipped activity ${d.id} in ${familyId}: ${e?.message || e}`);
    }
  }
  return { total, processed, remaining: Math.max(0, total - processed), cancelled };
}

// ─── Callable ─────────────────────────────────────────────────────────────────
export const generateActivityContent = onCall(
  { secrets: ["GEMINI_API_KEY"], timeoutSeconds: 120 },
  async (request) => {
    const { db, uid, familyId } = await resolveCaller(request);
    const activityId = String(request.data?.activityId || "").trim();
    if (!activityId) throw new HttpsError("invalid-argument", "activityId is required.");
    await enforceDailyLimit(db, familyId, "content"); // audit #12

    const { llm, genConfig } = await resolveLlm(db, "content", process.env.GEMINI_API_KEY);
    if (!llm) {
      return { configured: false, text: "Content generation isn't configured — set the GEMINI_API_KEY secret to enable it." };
    }

    const { kind, content } = await runGenerateContent({ db, familyId, activityId, uid, llm, genConfig });
    return { configured: true, kind, content };
  }
);

// Delete the generated content for a single activity, returning it to the
// "no content yet" state. Owner/parent only. Clears the content payload and all
// its bookkeeping (generated-at / by / error) so the activity reads as fresh.
export const deleteActivityContent = onCall({ timeoutSeconds: 30 }, async (request) => {
  const { db, familyId, role } = await resolveCaller(request);
  if (!["owner", "parent"].includes(role)) {
    throw new HttpsError("permission-denied", "Only family owners or parents can delete activity content.");
  }
  const activityId = String(request.data?.activityId || "").trim();
  if (!activityId) throw new HttpsError("invalid-argument", "activityId is required.");

  const ref = db.collection("families").doc(familyId).collection("activities").doc(activityId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Activity not found.");

  await ref.update({
    content: FieldValue.delete(),
    contentGeneratedAt: FieldValue.delete(),
    contentBy: FieldValue.delete(),
    contentError: "",
  });
  return { ok: true };
});

// Bulk backfill — fills content for all activities missing it, a batch at a time.
export const backfillActivityContent = onCall(
  { secrets: ["GEMINI_API_KEY"], timeoutSeconds: 540 },
  async (request) => {
    const { db, uid, familyId } = await resolveCaller(request);
    const { llm, genConfig } = await resolveLlm(db, "content", process.env.GEMINI_API_KEY);
    if (!llm) return { configured: false, total: 0, processed: 0, remaining: 0 };

    const limit = Math.min(12, Math.max(1, Number(request.data?.limit) || 6));
    const { total, processed, remaining } = await runBackfill({ db, familyId, uid, llm, genConfig, limit });
    return { configured: true, total, processed, remaining };
  }
);

// QA SAMPLE — generate (or regenerate) content for just the first N activities
// of ONE subject, inline, so a parent or QA tester can quality-check the impact
// quickly before committing to a full backfill. Uses the subject plan as context
// so even a 2-week sample reads as the coherent opening of the full arc.
export const requestContentSample = onCall(
  { secrets: ["GEMINI_API_KEY"], timeoutSeconds: 540 },
  async (request) => {
    const { db, uid, familyId, role } = await resolveCaller(request);
    if (!["owner", "parent"].includes(role)) {
      throw new HttpsError("permission-denied", "Only family owners or parents can run a content sample.");
    }
    const subjectId = String(request.data?.subjectId || "").trim();
    if (!subjectId) throw new HttpsError("invalid-argument", "subjectId is required.");
    const limit = Math.min(8, Math.max(1, Number(request.data?.limit) || 6));

    const { llm, genConfig } = await resolveLlm(db, "content", process.env.GEMINI_API_KEY);
    if (!llm) return { configured: false, text: "Content generation isn't configured — set the GEMINI_API_KEY secret to enable it." };

    const actSnap = await db.collection("families").doc(familyId)
      .collection("activities").where("subjectId", "==", subjectId).get();
    const activities = actSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (Number(a.complexityRank) || 1) - (Number(b.complexityRank) || 1))
      .slice(0, limit);
    if (!activities.length) return { configured: true, generated: 0, items: [] };

    const { children, guardians, guidingLight } = await loadFamilyContext(db, familyId);
    const childPerformance = await summarizeChildPerformance(db, familyId, children);
    const plans = await loadSubjectPlans(db, familyId);
    const plan = plans.get(subjectId);

    const items = [];
    for (const activity of activities) {
      const aRef = db.collection("families").doc(familyId).collection("activities").doc(activity.id);
      try {
        const planContext = buildPlanContextString(plan, activity.id);
        const { kind, content, reason } = await generateContentForActivity({
          activity, children, guardians, guidingLight, childPerformance, llm, genConfig, db,
          geminiApiKey: process.env.GEMINI_API_KEY || "",
          storagePrefix: familyId,
          planContext,
        });
        if (content) {
          await aRef.update({ content, contentGeneratedAt: new Date(), contentBy: uid, contentError: "" });
        } else {
          // Persist the reason so it's visible on the activity, not just in the sample.
          await aRef.update({ contentError: reason || "No content produced." });
          console.warn(`[content] sample failed for ${activity.id} (${activity.type}): ${reason}`);
        }
        items.push({ id: activity.id, title: activity.title || "Activity", kind, ok: Boolean(content), error: content ? "" : (reason || "No content produced.") });
      } catch (e) {
        const msg = String(e?.message || e).slice(0, 200);
        console.error(`[content] sample errored for ${activity.id}: ${msg}`);
        items.push({ id: activity.id, title: activity.title || "Activity", kind: "", ok: false, error: msg });
      }
    }
    return { configured: true, subjectId, generated: items.filter((i) => i.ok).length, items };
  }
);

// RETRY FAILED — regenerate content for activities that previously failed (they
// carry a `contentError` and have no content). Processes a bounded batch inline
// with plan context and returns per-item results + how many failures remain, so
// the user can click again to chip away at a large backlog. Optionally scoped to
// one subject.
export const regenerateFailedContent = onCall(
  { secrets: ["GEMINI_API_KEY"], timeoutSeconds: 540 },
  async (request) => {
    const { db, uid, familyId, role } = await resolveCaller(request);
    if (!["owner", "parent"].includes(role)) {
      throw new HttpsError("permission-denied", "Only family owners or parents can regenerate content.");
    }
    const subjectId = String(request.data?.subjectId || "").trim();
    const limit = Math.min(15, Math.max(1, Number(request.data?.limit) || 10));

    const { llm, genConfig } = await resolveLlm(db, "content", process.env.GEMINI_API_KEY);
    if (!llm) return { configured: false, text: "Content generation isn't configured — set the GEMINI_API_KEY secret to enable it." };

    const snap = await db.collection("families").doc(familyId).collection("activities").limit(500).get();
    let failed = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((a) => a.contentError && !a.content);
    if (subjectId) failed = failed.filter((a) => a.subjectId === subjectId);
    failed.sort((a, b) => (Number(a.complexityRank) || 1) - (Number(b.complexityRank) || 1));
    const totalFailed = failed.length;
    const batch = failed.slice(0, limit);
    if (!batch.length) return { configured: true, processed: 0, generated: 0, remaining: 0, items: [] };

    const { children, guardians, guidingLight } = await loadFamilyContext(db, familyId);
    const childPerformance = await summarizeChildPerformance(db, familyId, children);
    const plans = await loadSubjectPlans(db, familyId);

    const items = [];
    for (const activity of batch) {
      const aRef = db.collection("families").doc(familyId).collection("activities").doc(activity.id);
      try {
        const planContext = activity.subjectId ? buildPlanContextString(plans.get(activity.subjectId), activity.id) : "";
        const { kind, content, reason } = await generateContentForActivity({
          activity, children, guardians, guidingLight, childPerformance, llm, genConfig, db,
          geminiApiKey: process.env.GEMINI_API_KEY || "",
          storagePrefix: familyId,
          planContext,
        });
        if (content) {
          await aRef.update({ content, contentGeneratedAt: new Date(), contentBy: uid, contentError: "" });
        } else {
          await aRef.update({ contentError: reason || "No content produced." });
          console.warn(`[content] retry still failed for ${activity.id} (${activity.type}): ${reason}`);
        }
        items.push({ id: activity.id, title: activity.title || "Activity", kind, ok: Boolean(content), error: content ? "" : (reason || "No content produced.") });
      } catch (e) {
        const msg = String(e?.message || e).slice(0, 200);
        await aRef.update({ contentError: msg }).catch(() => {});
        items.push({ id: activity.id, title: activity.title || "Activity", kind: "", ok: false, error: msg });
      }
    }
    const generated = items.filter((i) => i.ok).length;
    return { configured: true, processed: batch.length, generated, remaining: Math.max(0, totalFailed - generated), items };
  }
);

// ─── Server-side backfill queue (mirrors the syllabus builder) ────────────────
// The "Preparing activity content" loop used to run in the browser, hammering
// backfillActivityContent batch-by-batch. Instead — exactly like the syllabus
// builder — the client now enqueues ONE request and a scheduled worker drains it
// server-side. The client only watches progress, so closing the tab no longer
// stalls generation.
//
//   requestContentBackfill (onCall) → enqueue contentBackfillQueue/{familyId}
//   contentBackfillWorker (every 1 min) → runContentBackfillQueuePass
//     → runBackfill(one batch) → re-queue until nothing remains
//
// The top-level queue is Admin-SDK-only (clients can't read it, like
// syllabusQueue). Progress is mirrored to families/{familyId}/meta/contentBackfill
// which IS member-readable, so the banner can subscribe to it.
const BACKFILL_QUEUE_COLLECTION = "contentBackfillQueue";
const BACKFILL_BATCH = 8;

// Client-readable progress mirror (meta is covered by canRead in firestore.rules).
function backfillMetaRef(db, familyId) {
  return db.collection("families").doc(familyId).collection("meta").doc("contentBackfill");
}

// Enqueue a server-side backfill for a family. Idempotent: re-queues an existing
// row rather than spawning a duplicate (the queue doc is keyed by familyId). We
// count what's missing up front so the UI has a denominator (total) and a start
// time (for an ETA) the instant the banner appears — before the worker's first
// pass a minute later.
export async function enqueueContentBackfill({ db, familyId, uid }) {
  let total = 0;
  try {
    const snap = await db.collection("families").doc(familyId).collection("activities").limit(500).get();
    total = snap.docs.filter((d) => !d.data().content).length;
  } catch (e) { console.warn(`[content] backfill precount failed for ${familyId}: ${e?.message || e}`); }

  const status = total > 0 ? "queued" : "done";
  await db.collection(BACKFILL_QUEUE_COLLECTION).doc(familyId).set({
    familyId,
    uid: uid || "system",
    status,
    processedTotal: 0,
    updatedAt: new Date(),
  }, { merge: true });
  await backfillMetaRef(db, familyId).set({
    status,
    processed: 0,
    total,
    remaining: total,
    startedAt: new Date(),
    updatedAt: new Date(),
  }, { merge: true });
  return { familyId, status, total };
}

// Drain up to `limit` queued families, one batch each, re-queuing the rest.
export async function runContentBackfillQueuePass({ db, limit = 2 } = {}) {
  const queuedSnap = await db.collection(BACKFILL_QUEUE_COLLECTION)
    .where("status", "==", "queued")
    .limit(limit)
    .get();
  if (queuedSnap.empty) return { processed: 0 };

  const { llm, genConfig } = await resolveLlm(db, "content", process.env.GEMINI_API_KEY);
  if (!llm) {
    for (const q of queuedSnap.docs) {
      const msg = "Content generation isn't configured — set the GEMINI_API_KEY secret to enable it.";
      await q.ref.set({ status: "error", error: msg, updatedAt: new Date() }, { merge: true });
      await backfillMetaRef(db, q.id).set({ status: "error", error: msg, updatedAt: new Date() }, { merge: true });
    }
    return { processed: 0, configured: false };
  }

  let processed = 0;
  for (const q of queuedSnap.docs) {
    // Atomically claim so overlapping worker runs can't double-process a family.
    const claimed = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(q.ref);
      if (!fresh.exists || fresh.data().status !== "queued") return null;
      tx.set(q.ref, { status: "running", claimedAt: new Date(), updatedAt: new Date() }, { merge: true });
      return fresh.data();
    });
    if (!claimed) continue;

    const familyId = claimed.familyId || q.id;
    const uid = claimed.uid || "system";
    try {
      await backfillMetaRef(db, familyId).set({ status: "running", updatedAt: new Date() }, { merge: true });
      // Cancellation check (the parent's "Stop" button): re-read the queue row
      // between activities; a cancel flips its status to "cancelled".
      const shouldCancel = async () => {
        const s = await q.ref.get();
        return s.exists && s.data().status === "cancelled";
      };
      const { processed: batchProcessed, remaining, cancelled } = await runBackfill({
        db, familyId, uid, llm, genConfig, limit: BACKFILL_BATCH, shouldCancel,
      });
      const processedTotal = Number(claimed.processedTotal || 0) + batchProcessed;
      // Honour a stop: finalise as cancelled and do NOT re-queue. Re-check the
      // queue doc too, in case the cancel landed exactly as the batch ended.
      if (cancelled || (await shouldCancel())) {
        await q.ref.set({ status: "cancelled", processedTotal, updatedAt: new Date(), finishedAt: new Date() }, { merge: true });
        await backfillMetaRef(db, familyId).set({
          status: "cancelled", processed: processedTotal,
          remaining: Math.max(0, remaining), updatedAt: new Date(),
        }, { merge: true });
        processed += 1;
        continue;
      }
      // Stop when nothing remains, or when a full batch produced nothing — the
      // leftover activities are failing repeatedly, so spinning won't help.
      const stalled = remaining > 0 && batchProcessed === 0;
      if (remaining <= 0 || stalled) {
        const finalRemaining = Math.max(0, remaining);
        await q.ref.set({
          status: "done", processedTotal, remaining: finalRemaining,
          updatedAt: new Date(), finishedAt: new Date(),
        }, { merge: true });
        await backfillMetaRef(db, familyId).set({
          status: "done", processed: processedTotal,
          total: processedTotal + finalRemaining, remaining: finalRemaining,
          updatedAt: new Date(),
        }, { merge: true });
      } else {
        // More to do — re-queue for the next worker pass.
        await q.ref.set({ status: "queued", processedTotal, remaining, updatedAt: new Date() }, { merge: true });
        await backfillMetaRef(db, familyId).set({
          status: "running", processed: processedTotal,
          total: processedTotal + remaining, remaining, updatedAt: new Date(),
        }, { merge: true });
      }
      processed += 1;
    } catch (e) {
      // Transient failure — re-queue so a later pass retries this family.
      await q.ref.set({
        status: "queued",
        lastError: String(e?.message || e).slice(0, 500),
        updatedAt: new Date(),
      }, { merge: true });
    }
  }
  return { processed, configured: true };
}

// Scheduled drain — the server-side engine, identical cadence to syllabusWorker.
export const contentBackfillWorker = onSchedule(
  { schedule: "every 1 minutes", timeoutSeconds: 540, secrets: ["GEMINI_API_KEY"], maxInstances: 1 },
  async () => {
    await runContentBackfillQueuePass({ db: getFirestore(), limit: 2 });
  }
);

// Callable — the client asks the server to (re)start a backfill, then watches
// meta/contentBackfill for progress. Returns immediately; no work runs here.
export const requestContentBackfill = onCall(
  { timeoutSeconds: 60 },
  async (request) => {
    const { db, uid, familyId } = await resolveCaller(request);
    await enforceDailyLimit(db, familyId, "backfill"); // audit #12
    const result = await enqueueContentBackfill({ db, familyId, uid });
    return { configured: true, ...result };
  }
);

// Mark the family's content backfill cancelled. The worker re-reads the queue row
// between activities and stops promptly; a row still waiting in the queue is never
// claimed once cancelled. Exported (pure) for unit testing.
export async function cancelContentBackfill({ db, familyId, uid }) {
  await db.collection(BACKFILL_QUEUE_COLLECTION).doc(familyId).set(
    { status: "cancelled", cancelledAt: new Date(), cancelledBy: uid || "system", updatedAt: new Date() },
    { merge: true }
  );
  await backfillMetaRef(db, familyId).set(
    { status: "cancelled", updatedAt: new Date() },
    { merge: true }
  );
  return { ok: true, status: "cancelled" };
}

// Callable — the parent's "Stop" button. Owner/parent only.
export const stopContentBackfill = onCall({ timeoutSeconds: 30 }, async (request) => {
  const { db, uid, familyId, role } = await resolveCaller(request);
  if (!["owner", "parent"].includes(role)) {
    throw new HttpsError("permission-denied", "Only family owners or parents can stop content generation.");
  }
  return cancelContentBackfill({ db, familyId, uid });
});
