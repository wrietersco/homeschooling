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
import { resolveCaller } from "../lib/caller.js";
import { runAgent } from "./runtime.js";
import { resolveLlm } from "./agentConfig.js";
import { describeGuardian } from "./grounding.js";
import { enrichQuranContent } from "./quranSource.js";
import { generateActivityImage } from "./imageGen.js";

// Map an activity type to the content kind the child actually performs.
export function contentKindForType(type) {
  switch (type) {
    case "quran": return "quran_reading";
    case "noorani_qaida": return "qaida_exercise";
    case "story_reading": return "story";
    case "mathematics": return "problems";
    case "computer":
    case "ai_robotics":
    case "physical":
    case "teaching":
    default:
      return "steps";
  }
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
        description: "One of: quran_reading, qaida_exercise, story, problems, steps. Must match the requested kind.",
      },
      instructions: { type: "string", description: "One or two sentences telling the child what to do." },
      primaryLang: { type: "string", description: "BCP-47 lang of the main text the child reads, e.g. 'ar', 'en'." },

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
                  hint: { type: "string", description: "Optional makharij/articulation hint." },
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
          vocab: {
            type: "array",
            items: { type: "object", properties: { word: { type: "string" }, meaning: { type: "string" } }, required: ["word", "meaning"] },
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
    },
    required: ["kind"],
  },
};

// ─── Prompt ───────────────────────────────────────────────────────────────────
function buildSystemPrompt({ activity, kind, guidingLight, children, guardians = [] }) {
  const childLine = children.length
    ? children.map((c) => `${c.name || c.id}${c.dob ? ` (dob ${c.dob})` : ""}`).join("; ")
    : "(none)";
  const guardianLine = guardians.length ? guardians.join("; ") : "(none)";

  const kindGuidance = {
    quran_reading:
      "Provide the ACTUAL Quranic verses for this activity in fully-voweled Arabic. Use only well-known, correct text (prefer short surahs / Juz Amma unless the activity names a specific passage). For EACH verse you MUST give the correct `surah` (1-114) and `ayah` numbers — these drive the real recitation audio — plus the full ayah, its transliteration, its English translation, and a `words` array splitting the ayah word-by-word in order (each with arabic + transliteration). Split words exactly as the canonical mushaf does. Keep to the verses this activity covers.",
    qaida_exercise:
      "Produce 3-5 Noorani Qaida drills ordered easiest→hardest (letter recognition → harakat → joining → short words). Every item must be FULLY VOWELED Arabic with a Latin transliteration and, where useful, a makharij hint.",
    story:
      "Produce ONE short, original story passage of 2-4 short paragraphs at the child's reading level. Include 3-6 vocabulary words with simple meanings and 2-3 comprehension questions. The story must embody the guiding light.",
    problems:
      "Produce 5-10 problem sums matched to the activity's complexity rank. Each problem has the question to solve, the correct answer, an optional hint, and optional step-by-step working. Progress from easier to harder within the set.",
    steps:
      "Break this activity into a clear, ordered worksheet the child can follow: a one-line goal, the materials needed, 4-8 numbered steps (each a concrete action, with optional detail/example), and 2-3 'check' questions to confirm it worked.",
  };

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
    "",
    `REQUIRED CONTENT KIND: ${kind}`,
    kindGuidance[kind] || kindGuidance.steps,
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
    primaryLang: str(raw.primaryLang) || (type === "quran" || type === "noorani_qaida" ? "ar" : "en"),
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
              ? { arabic: w.trim(), transliteration: "" }
              : { arabic: str(w.arabic), transliteration: str(w.transliteration) };
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
          ? { text: it.trim(), transliteration: "", hint: "" }
          : { text: str(it.text), transliteration: str(it.transliteration), hint: str(it.hint) }
      ).filter((it) => it.text),
    })).filter((e) => e.items.length);
  } else if (kind === "story") {
    const s = raw.story || {};
    out.story = {
      title: str(s.title) || "Story",
      lang: str(s.lang) || out.primaryLang,
      paragraphs: arr(s.paragraphs).map(str).filter(Boolean).slice(0, 8),
      vocab: arr(s.vocab).slice(0, 12).map((v) => ({ word: str(v.word), meaning: str(v.meaning) })).filter((v) => v.word),
      comprehension: arr(s.comprehension).map(str).filter(Boolean).slice(0, 5),
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

// Slugify a title for a storage path.
function slugify(s) {
  return String(s || "activity").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "activity";
}

// ─── Pure generator — produces content for an activity, no DB access ──────────
// Reused by the syllabus worker (inline, at creation time) and the callable.
// `geminiApiKey` + `storagePrefix` enable storybook image generation for stories.
export async function generateContentForActivity({ activity, children = [], guardians = [], guidingLight = "", llm, genConfig, geminiApiKey = "", storagePrefix = "" }) {
  const kind = contentKindForType(activity.type);
  let captured = null;
  const tools = {
    async save_content(args) {
      captured = sanitizeContent(kind, args || {}, activity.type);
      return { saved: true };
    },
  };
  const system = buildSystemPrompt({ activity, kind, guidingLight, children, guardians });
  await runAgent({
    llm,
    system,
    toolDeclarations: [SAVE_CONTENT_DECLARATION],
    tools,
    userMessage: `Create the ${kind} content for "${activity.title}" now and call save_content once.`,
    maxSteps: 4,
    generationConfig: genConfig ?? { maxOutputTokens: 4096, temperature: 0.5 },
  });

  // Quran text must be canonical — overwrite the agent's draft Arabic with the
  // verified Quran Foundation text/words/audio. Best-effort; never throws.
  if (captured && captured.kind === "quran_reading") {
    try {
      await enrichQuranContent(captured);
    } catch {
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

  return { kind, content: captured };
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

  const { kind, content } = await generateContentForActivity({
    activity, children, guardians, guidingLight, llm, genConfig,
    geminiApiKey: process.env.GEMINI_API_KEY || "",
    storagePrefix: familyId,
  });
  if (!content) throw new HttpsError("internal", "The content generator did not return any content. Please try again.");

  await activityRef.update({ content, contentGeneratedAt: new Date(), contentBy: uid });
  return { kind, content };
}

// ─── Backfill — generate content for every activity that lacks it ─────────────
// Processes a bounded batch per call (LLM + image latency) and returns how many
// remain so the client can loop until done. Best-effort per activity: one
// failure never aborts the batch.
export async function runBackfill({ db, familyId, uid, llm, genConfig, limit }) {
  const snap = await db
    .collection("families").doc(familyId)
    .collection("activities").limit(500).get();
  const missing = snap.docs.filter((d) => !d.data().content);
  const total = missing.length;
  if (!total) return { total: 0, processed: 0, remaining: 0 };

  const { children, guardians, guidingLight } = await loadFamilyContext(db, familyId);
  const batch = missing.slice(0, limit);

  let processed = 0;
  for (const d of batch) {
    try {
      const { content } = await generateContentForActivity({
        activity: { id: d.id, ...d.data() }, children, guardians, guidingLight, llm, genConfig,
        geminiApiKey: process.env.GEMINI_API_KEY || "",
        storagePrefix: familyId,
      });
      if (content) {
        await d.ref.update({ content, contentGeneratedAt: new Date(), contentBy: uid });
        processed++;
      }
    } catch {
      // skip this activity; it will be retried on a later backfill pass
    }
  }
  return { total, processed, remaining: Math.max(0, total - processed) };
}

// ─── Callable ─────────────────────────────────────────────────────────────────
export const generateActivityContent = onCall(
  { secrets: ["GEMINI_API_KEY", "QURAN_CLIENT_ID", "QURAN_CLIENT_SECRET"], timeoutSeconds: 120 },
  async (request) => {
    const { db, uid, familyId } = await resolveCaller(request);
    const activityId = String(request.data?.activityId || "").trim();
    if (!activityId) throw new HttpsError("invalid-argument", "activityId is required.");

    const { llm, genConfig } = await resolveLlm(db, "content", process.env.GEMINI_API_KEY);
    if (!llm) {
      return { configured: false, text: "Content generation isn't configured — set the GEMINI_API_KEY secret to enable it." };
    }

    const { kind, content } = await runGenerateContent({ db, familyId, activityId, uid, llm, genConfig });
    return { configured: true, kind, content };
  }
);

// Bulk backfill — fills content for all activities missing it, a batch at a time.
export const backfillActivityContent = onCall(
  { secrets: ["GEMINI_API_KEY", "QURAN_CLIENT_ID", "QURAN_CLIENT_SECRET"], timeoutSeconds: 540 },
  async (request) => {
    const { db, uid, familyId } = await resolveCaller(request);
    const { llm, genConfig } = await resolveLlm(db, "content", process.env.GEMINI_API_KEY);
    if (!llm) return { configured: false, total: 0, processed: 0, remaining: 0 };

    const limit = Math.min(12, Math.max(1, Number(request.data?.limit) || 6));
    const { total, processed, remaining } = await runBackfill({ db, familyId, uid, llm, genConfig, limit });
    return { configured: true, total, processed, remaining };
  }
);
