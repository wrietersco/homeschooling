// Explore — a live, voice-to-voice companion for ONE child, built on the Gemini
// Live API. The browser talks to Gemini directly (low latency), but never holds
// the API key: this module mints a short-lived, single-use EPHEMERAL TOKEN whose
// model, system instruction, voice and tools are locked server-side
// (liveConnectConstraints), so the child's context can't be tampered with.
//
// Efficient access to the child's data is two-tier:
//   1. A compact BRIEF is built in parallel, capped queries and baked into the
//      system instruction — the model "already knows" the child at hello. It
//      carries the child's PROFILE IN FULL (the parents' own words: strengths,
//      what they're still building, goals, comments) plus interests, skills and
//      recent progress. Time-sensitive notes deliberately stay out of it.
//   2. Everything deeper — including parent observations, which age quickly — is
//      fetched ON DEMAND through small child-scoped, read-mostly tools
//      (exploreTool callable), each capped in size. The model only pays for
//      detail it actually asks for.
// Three narrow writes exist so the companion gets smarter over time: it can save
// an interest (feeds the next brief), leave a learning note for the parents (an
// observation), and file SESSION HIGHLIGHTS — a small, free-shaped JSON record of
// what was worked on and how it went, which is what parents read afterwards.
// Everything is tenant- and child-scoped from the verified caller — the client
// never supplies a familyId.
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { GoogleGenAI, Modality } from "@google/genai";
import { resolveCaller } from "../lib/caller.js";
import { familyPaths } from "../lib/paths.js";
import { enforceDailyLimit } from "../lib/rateLimit.js";
import { loadAgentConfig, isLiveModelId } from "./agentConfig.js";
import {
  LIVE_VOICES,
  liveThinkingLevels,
  liveRequiresThinking,
  liveVoicesFor,
  liveModelUnreliable,
} from "./modelCatalog.js";
import { testLiveModel } from "./liveTest.js";
import { withCurrentDate } from "../lib/dateContext.js";

export const MODES = ["explore", "learn"];
const RESULT_CHARS = 2500; // cap on any single tool result fed back to the model

// ── Pure helpers (unit-tested) ───────────────────────────────────────────────

export function ageFromDob(dob, now = new Date()) {
  const d = new Date(dob);
  if (!dob || Number.isNaN(d.getTime())) return null;
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age -= 1;
  return age >= 0 && age < 19 ? age : null;
}

const clip = (v, n = 160) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

// The parents' own writing about their child is the most durable, most relevant
// thing the buddy can know, so it goes in whole rather than trimmed to a line.
// (A textarea's worth of text is a few dozen tokens — cheap next to getting the
// child wrong.) The cap only exists to stop a pathological paste.
const CHILD_FIELD_MAX = 1200;

// Compact, prompt-ready description of the child. `data` is the already-fetched
// slice: { child, family, skills, interests, scores }.
//
// Deliberately NOT here: parent observations. They are point-in-time notes that
// age badly — "struggled with the k sound" stops being true and starts being
// misleading — so the buddy fetches them with get_observations when a moment
// actually calls for it, and the room they freed goes to the child's profile.
export function formatChildBrief(data = {}, now = new Date()) {
  const { child = {}, family = {}, skills = [], interests = [], scores = [] } = data;
  const age = ageFromDob(child.dob, now);
  const who = child.name || "this child";
  const lines = [`CHILD: ${child.name || "the child"}${age !== null ? `, age ${age}` : ""}.`];
  if (child.strengths) lines.push(`Strengths: ${clip(child.strengths, CHILD_FIELD_MAX)}`);
  if (child.weaknesses) lines.push(`Still building: ${clip(child.weaknesses, CHILD_FIELD_MAX)}`);
  if (child.goals) lines.push(`Goals the parents have for ${who}: ${clip(child.goals, CHILD_FIELD_MAX)}`);
  if (child.comments) lines.push(`What the parents say about ${who}: ${clip(child.comments, CHILD_FIELD_MAX)}`);
  if (family.guidingLight) lines.push(`Family guiding light (honour it): ${clip(family.guidingLight, 600)}`);
  if (interests.length) {
    lines.push(`Interests he/she has shown (most frequent first): ${interests.map((i) => i.topic).join(", ")}`);
  }
  if (skills.length) {
    lines.push(`Skills currently being developed: ${skills.map((s) => s.name).filter(Boolean).slice(0, 12).join(", ")}`);
  }
  if (scores.length) {
    const done = scores.filter((s) => s.completed).length;
    const titles = scores.slice(0, 5).map((s) => clip(s.activityTitle, 60)).filter(Boolean);
    lines.push(`Recent activities: ${done}/${scores.length} completed lately${titles.length ? ` (e.g. ${titles.join("; ")})` : ""}.`);
  }
  return lines.join("\n");
}

const COMMON_RULES = [
  "You are speaking ALOUD with a young child through a voice conversation. Keep every turn short (1–3 sentences),",
  "warm and full of energy, then hand the turn back with a question or an invitation. Never lecture.",
  "Use the child's name. Speak in the language the child speaks to you in.",
  "Everything must be safe, gentle and age-appropriate. If the child raises something frightening, unsafe or",
  "inappropriate, kindly steer to something wonderful and suggest talking to a parent. Never ask for personal",
  "details like address, school or passwords. You are a friendly companion, not a person — never pretend otherwise.",
  "If you are unsure of a fact, say so playfully rather than inventing it.",
  "You already know the child from the brief below — it is current, so trust it. For deeper detail (past progress,",
  "skills, what the parents have observed before, curriculum) call a tool instead of guessing — but only when it",
  "will genuinely help the moment, and never narrate tool use.",
  "When the child reveals a lasting interest, call save_interest. In learning mode, call record_learning_note",
  "when you notice real progress or a struggle worth telling the parents.",
  "KEEP A RECORD FOR THE PARENTS: call record_session_highlights EACH TIME a piece of work finishes — a word finally",
  "said right, a concept that clicked or stayed stuck, a question that showed what the child does or doesn't",
  "understand — and once more before you say goodbye. Fill in the numbers honestly (count the tries as they happen).",
  "Write only the pedagogical facts, never the conversation itself. Do not mention that you are keeping notes.",
  "CALL THE TOOL celebrate EVERY SINGLE TIME you praise a correct answer or a finished task — for example any time",
  "you say something like 'that's exactly right', 'you did it', 'well done', 'perfect', 'you nailed it' or 'great",
  "job'. Call it in THE SAME TURN as that praise — never say the praise without also calling the tool. It bursts",
  "confetti and plays a cheer sound the child can see and hear, so skipping it means they miss the celebration.",
  "Do NOT call it for small talk, partial progress, or an incorrect attempt — only for a genuine win. Never mention",
  "or describe the celebration yourself — the screen does that; just keep talking naturally.",
  "Call celebrate ONCE per win, never twice for the same moment. After calling it, pause: the app plays the cheer",
  "and only answers the tool once the cheer has finished, so wait for that result before you speak again. The cheer",
  "sound (e.g. 'Masha'Allah! Well done!', 'Yay! You did it!', clapping) comes from the app, NOT from the child —",
  "never reply to it, repeat it, or celebrate again because of it.",
].join(" ");

const MODE_PROMPTS = {
  explore: [
    "MODE: EXPLORATION — you are a Pixar-style storyteller and curious guide. Bring the world to life:",
    "vivid, sensory, funny mini-stories with characters, wonder and surprises; playful sound effects and voices;",
    "big feelings ('Wow!', 'Guess what?'). Follow the child's curiosity wherever it goes — whatever he/she asks",
    "about, explore it together, connect it to the things he/she already loves, and plant a tiny hook ('and do you",
    "know what's hiding inside?') so the adventure keeps unfolding. Teach through story, never through lists.",
    "Open by greeting the child by name and offering two or three exciting things to explore based on their interests.",
  ].join(" "),
  learn: [
    "MODE: LEARNING — you are a patient, joyful tutor. The child picks the focus (it might be speech and",
    "articulation, mathematics, reading, or any concept). Teach in tiny steps: show one idea, let the child try,",
    "check understanding with a question, then adapt — simpler if stuck, a stretch if easy. Praise effort and",
    "specific progress, never just 'good job'. Make mistakes safe and fun.",
    "For speech/articulation: model the target sound slowly and clearly, invite the child to repeat, give gentle",
    "specific feedback ('nice — now let your tongue tap the top'), and celebrate each try. For maths: use concrete",
    "everyday objects and let the child do the thinking. Use get_skills/get_recent_progress to pitch the level.",
    "BE HONEST AND PRECISE — a tutor who says 'well done' to a wrong answer teaches the wrong thing.",
    "Before every reply, silently decide: did the child say exactly the target? Compare sound by sound (for 'cat': k-a-t).",
    "If it was correct, say so and name what was good. If it was NOT correct or you are not sure what you heard, say so",
    "kindly and specifically ('I heard fat — that starts with f. Cat starts with a k sound at the back of your throat.'),",
    "model the target slowly, and ask for one more try. Never praise an attempt as correct unless it was, and never move",
    "to a new word until the current one is right or you've tried twice (then reassure and come back to it later).",
    "Work on ONE target at a time. Keep track of the target word and the child's attempts across turns — do not lose it.",
    "Never repeat your previous sentence; each turn must move the lesson forward.",
    "Open by greeting the child by name and asking (or confirming) what they'd like to learn today.",
  ].join(" "),
};

// The parents' delivery choices, as directives rather than hints. They are stated
// LAST (just before the brief) and in imperative form on purpose: a free-text note
// like "speak less and slow" loses to a thousand words of style guidance above it,
// while "ONE short sentence per turn" does not. They still never outrank safety.
const PACE_RULES = {
  slow: "SPEAK SLOWLY. Short phrases with a clear pause between them. Never rush a sentence, and leave a beat of silence after you finish so the child has time to think and answer.",
  normal: "",
};
const LENGTH_RULES = {
  tiny: "SAY VERY LITTLE. ONE short sentence per turn — then stop and let the child speak. Never two ideas in one turn.",
  short: "Keep every turn to one or two short sentences, then hand the turn back.",
  normal: "",
};
const LANGUAGE_RULES = {
  auto: "",
  english: "SPEAK ENGLISH ONLY, even if the child speaks to you in another language — this overrides the earlier instruction to match the child's language. Use simple, everyday words a young child knows.",
  urdu: "SPEAK URDU ONLY, even if the child speaks to you in another language — this overrides the earlier instruction to match the child's language. Use simple, everyday words a young child knows.",
  arabic: "SPEAK ARABIC ONLY, even if the child speaks to you in another language — this overrides the earlier instruction to match the child's language. Use simple, everyday words a young child knows.",
};

// One block of parent instructions, or "" when the parents changed nothing.
export function formatParentStyle(style = {}) {
  const rules = [
    PACE_RULES[style.pace] || "",
    LENGTH_RULES[style.replyLength] || "",
    LANGUAGE_RULES[style.language] || "",
  ].filter(Boolean);
  if (style.avoid) rules.push(`BE CAREFUL: ${clip(style.avoid, PARENT_AVOID_MAX)}`);
  if (style.notes) rules.push(clip(style.notes, PARENT_NOTES_MAX));
  if (!rules.length) return "";
  return [
    "HOW THE PARENTS WANT YOU TO TALK TO THEIR CHILD — these are instructions, not suggestions.",
    "Follow every one of them on every single turn. They override the general style guidance above,",
    "but they never override the safety rules.",
    ...rules.map((r) => `• ${r}`),
  ].join("\n");
}

export function buildExploreSystemPrompt({ mode, brief, focus = "", platform = "", parentStyle = {} }) {
  const m = MODES.includes(mode) ? mode : "explore";
  const parts = [];
  if (platform) parts.push(platform);
  parts.push(COMMON_RULES, MODE_PROMPTS[m]);
  if (focus) parts.push(`TODAY'S FOCUS requested by the child/parent: ${clip(focus, 200)}`);
  const style = formatParentStyle(typeof parentStyle === "string" ? { notes: parentStyle } : parentStyle);
  if (style) parts.push(style);
  parts.push(brief);
  return withCurrentDate(parts.join("\n\n"));
}

// ── Session highlights ───────────────────────────────────────────────────────
// The buddy files its own pedagogical notes as it goes. The SHAPE IS DELIBERATELY
// FREE: a speech session might record {sound:"k", attempts:4, mastered:true} and a
// maths one {concept:"sharing 10 sweets", hints_needed:2, stuck_on:"remainders"} —
// forcing both into one schema would lose exactly the detail that makes the record
// worth reading. What is NOT free is the size and the content: this sanitizer
// keeps the record small, shallow and free of transcript, because an unbounded
// model-written object is a write amplification and a privacy problem.
export const HIGHLIGHT_LIMITS = { keys: 12, depth: 3, string: 200, array: 10, json: 1200, perSession: 12 };

// Recursively keep only small, plain JSON values. Returns undefined for anything
// that can't be stored (functions, nested junk, empty containers).
function pruneValue(v, depth = 1) {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "string") {
    const t = v.replace(/\s+/g, " ").trim();
    return t ? t.slice(0, HIGHLIGHT_LIMITS.string) : undefined;
  }
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "boolean") return v;
  if (depth >= HIGHLIGHT_LIMITS.depth) return undefined; // too deep to be a highlight
  if (Array.isArray(v)) {
    const out = v.map((x) => pruneValue(x, depth + 1)).filter((x) => x !== undefined).slice(0, HIGHLIGHT_LIMITS.array);
    return out.length ? out : undefined;
  }
  if (typeof v === "object") {
    const out = {};
    let n = 0;
    for (const [k, val] of Object.entries(v)) {
      if (n >= HIGHLIGHT_LIMITS.keys) break;
      const key = String(k).replace(/[^\w .-]/g, "").slice(0, 40);
      if (!key) continue;
      const pruned = pruneValue(val, depth + 1);
      if (pruned === undefined) continue;
      out[key] = pruned;
      n++;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return undefined;
}

// Accepts the model's argument — a JSON string (what the tool asks for) or an
// object — and returns a storable highlight, or null if there's nothing usable.
export function sanitizeHighlights(raw) {
  let value = raw;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return null;
    try {
      value = JSON.parse(text);
    } catch {
      // The model wrote prose instead of JSON. Keep it rather than lose the note.
      return { note: text.replace(/\s+/g, " ").slice(0, HIGHLIGHT_LIMITS.string) };
    }
  }
  if (Array.isArray(value)) value = { items: value };
  if (!value || typeof value !== "object") return null;
  let out = pruneValue(value, 1);
  if (!out || typeof out !== "object" || Array.isArray(out)) return null;
  // Last resort: drop keys until the whole record fits the size budget.
  while (JSON.stringify(out).length > HIGHLIGHT_LIMITS.json) {
    const keys = Object.keys(out);
    if (keys.length <= 1) return { note: JSON.stringify(out).slice(0, HIGHLIGHT_LIMITS.string) };
    delete out[keys[keys.length - 1]];
  }
  return out;
}

// The named arguments above, plus whatever the model put in `extra`, folded into
// one record. Named fields win over `extra` on a key clash — they are the ones
// with a defined meaning. Anything unusable is simply dropped by sanitizeHighlights.
export function highlightsFromArgs(args = {}) {
  // Legacy shape (a single JSON string) still stores, so an in-flight session
  // during a deploy doesn't lose its notes.
  if (typeof args.highlights === "string" && !args.topic) return sanitizeHighlights(args.highlights);
  const { extra, ...named } = args;
  let base = {};
  if (extra) {
    const parsed = sanitizeHighlights(extra);
    if (parsed) base = parsed;
  }
  return sanitizeHighlights({ ...base, ...named });
}

// Tools the live model may call. Every one is answered by `exploreTool`.
export const EXPLORE_TOOL_DECLARATIONS = [
  { name: "get_skills", description: "The skills this child is currently developing, with how central each is (extent 1-5).", parameters: { type: "object", properties: {} } },
  {
    name: "get_recent_progress",
    description: "The child's recent scored activities (title, completed, date) to pitch difficulty and refer to things they've done.",
    parameters: { type: "object", properties: { limit: { type: "number", description: "max 20" } } },
  },
  {
    name: "get_observations",
    description: "Recent notes parents/teachers wrote about this child.",
    parameters: { type: "object", properties: { limit: { type: "number", description: "max 10" } } },
  },
  {
    name: "find_learning_topics",
    description: "Search this family's curriculum/activities for topics related to a keyword, so you can connect the conversation to what the child is studying.",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  {
    name: "save_interest",
    description: "Remember a topic the child is genuinely interested in, so future conversations start from it.",
    parameters: { type: "object", properties: { topic: { type: "string", description: "2-4 words, e.g. 'space rockets'" } }, required: ["topic"] },
  },
  {
    name: "record_learning_note",
    description: "Leave a short note for the parents about real progress or a struggle you noticed (learning mode).",
    parameters: { type: "object", properties: { note: { type: "string" } }, required: ["note"] },
  },
  {
    name: "record_session_highlights",
    // Named fields, not one free JSON blob: a real Live run showed the model
    // answering a "write me JSON" parameter with a prose sentence, which loses
    // exactly the facts parents want (which concept, how many tries). Function
    // calling fills named arguments reliably — so the pedagogical core is named,
    // and `extra` keeps the record free-shaped for whatever else mattered today.
    description:
      "File a brief pedagogical record of a moment in THIS conversation, for the parents to read afterwards. Call it EVERY time something is worth reporting — a word finally said right, a concept that clicked or did not, a question that revealed what the child does or doesn't understand — and once more before you say goodbye. Never include the conversation itself, only what was worked on and how it went.",
    parameters: {
      type: "object",
      properties: {
        topic: { type: "string", description: 'What was worked on, in the child\'s terms. E.g. "the k sound at the start of words", "sharing 10 sweets between 2".' },
        attempts: { type: "number", description: "How many tries the child took before getting it right. Count them honestly, 1 if first time." },
        tries_to_understand: { type: "number", description: "How many explanations or hints it took before the idea clicked." },
        outcome: { type: "string", description: 'How it ended: "mastered", "improving", "struggling", or "explored" for a non-lesson chat.' },
        struggled_with: { type: "string", description: "The specific thing that was hard, if any." },
        what_helped: { type: "string", description: "What made it click — the example, the trick, the encouragement." },
        extra: { type: "string", description: 'Anything else worth recording this time, as a small JSON object. E.g. {"asked_about":"why trains have wheels","mood":"excited"}. Optional.' },
      },
      required: ["topic"],
    },
  },
  {
    name: "celebrate",
    description:
      "Trigger a fun on-screen celebration (confetti + a cheer sound) for the child RIGHT NOW. Call it the moment " +
      "the child completes a task, gets an answer right, or finishes something they were working on. Use it for " +
      "genuine completions/wins only — never for every turn or ordinary chat — so it stays a special moment. " +
      "Call it at most once per win. The result arrives only after the cheer has finished playing — wait for it " +
      "before speaking again, and don't react to the cheer sound (it's the app, not the child).",
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string", description: "1-4 words: what was completed, e.g. 'said the k sound' or 'finished the story'." },
      },
    },
  },
];

const slug = (s) => clip(s, 40).toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, "-").replace(/^-|-$/g, "");

const tsMs = (t) => (t?.toMillis ? t.toMillis() : t instanceof Date ? t.getTime() : Number(t) || 0);

// Cap a tool result's serialized size so one call can never flood the live context.
export function capResult(result, max = RESULT_CHARS) {
  const json = JSON.stringify(result);
  if (json.length <= max) return result;
  return { truncated: true, preview: json.slice(0, max) };
}

// Tool implementations bound to ONE verified family + child (and, for the
// highlights write, ONE verified session).
export function createExploreTools({ db, familyId, childId, uid, sessionId = "" }) {
  const p = familyPaths(db, familyId);
  return {
    async get_skills() {
      const snap = await p.child(childId).collection("skills").limit(30).get();
      return { skills: snap.docs.map((d) => ({ name: d.data().name, category: d.data().category, extent: d.data().extent })) };
    },
    async get_recent_progress({ limit } = {}) {
      const n = Math.min(Math.max(1, Number(limit) || 10), 20);
      const snap = await p.scores().where("childId", "==", childId).orderBy("scoredAt", "desc").limit(n).get();
      return {
        activities: snap.docs.map((d) => {
          const s = d.data();
          return { title: clip(s.activityTitle, 80), completed: !!s.completed, date: s.dateKey || "" };
        }),
      };
    },
    async get_observations({ limit } = {}) {
      const n = Math.min(Math.max(1, Number(limit) || 5), 10);
      const snap = await p.observations().where("childId", "==", childId).limit(30).get();
      const rows = snap.docs
        .map((d) => d.data())
        .sort((a, b) => tsMs(b.createdAt) - tsMs(a.createdAt))
        .slice(0, n);
      return { observations: rows.map((o) => ({ text: clip(o.text, 240), about: clip(o.activityTitle, 60) })) };
    },
    async find_learning_topics({ query } = {}) {
      const q = clip(query, 60).toLowerCase();
      if (!q) return { matches: [] };
      const snap = await p.activities().limit(300).get();
      const matches = snap.docs
        .map((d) => d.data())
        .filter((a) => `${a.title || ""} ${a.description || ""} ${a.topic || ""}`.toLowerCase().includes(q))
        .slice(0, 8)
        .map((a) => ({ title: clip(a.title, 80), type: a.type || "" }));
      return { matches };
    },
    async save_interest({ topic } = {}) {
      const id = slug(topic);
      if (!id) return { saved: false };
      const ref = p.child(childId).collection("interests").doc(id);
      const snap = await ref.get();
      await ref.set(
        { topic: clip(topic, 60), count: (snap.exists ? Number(snap.data().count) || 0 : 0) + 1, lastAt: new Date(), source: "explore" },
        { merge: true }
      );
      return { saved: true };
    },
    // The confetti+sound are triggered client-side the instant this tool call
    // arrives (no round trip needed for the celebration itself); this is only
    // the function response the model needs to keep the conversation going.
    async celebrate({ reason } = {}) {
      return { celebrated: true, reason: clip(reason, 60) };
    },
    // Appends to this session's highlights. Capped per session so a chatty model
    // can't grow the document without bound; newest entries win.
    async record_session_highlights(args = {}) {
      const entry = highlightsFromArgs(args);
      if (!entry || !sessionId) return { saved: false };
      const ref = p.family().collection("exploreSessions").doc(sessionId);
      const snap = await ref.get();
      if (!snap.exists || snap.data().childId !== childId) return { saved: false };
      const existing = Array.isArray(snap.data().highlights) ? snap.data().highlights : [];
      // The model files as it goes and again at goodbye, so the same topic often
      // arrives twice. Keep the later record (it knows how the moment ended)
      // rather than showing parents the same lesson twice.
      const sameTopic = (a, b) => clip(a?.topic, 60).toLowerCase() === clip(b?.topic, 60).toLowerCase();
      const kept = entry.topic ? existing.filter((e) => !sameTopic(e, entry)) : existing;
      const next = [...kept, { ...entry, at: new Date() }].slice(-HIGHLIGHT_LIMITS.perSession);
      await ref.set({ highlights: next }, { merge: true });
      return { saved: true };
    },
    async record_learning_note({ note } = {}) {
      const text = clip(note, 400);
      if (!text) return { saved: false };
      await p.observations().add({
        childId, text, activityTitle: "Explore conversation", authorUid: uid, source: "explore", createdAt: new Date(),
      });
      return { saved: true };
    },
  };
}

// The session config may only carry features the CHOSEN model supports: a
// thinking level on a model without thinking closes the socket with "Thinking
// level is not supported for this model", which the child sees as "the buddy
// couldn't connect". So the model's catalog entry decides:
//   • no thinking at all        → never send a level, whatever was configured
//   • thinking + required       → send the configured level, or "low" by default
//   • thinking + optional       → send a level only if a valid one was configured
export function thinkingConfigFor(cfg = {}) {
  const levels = liveThinkingLevels(cfg.model);
  if (!levels.length) return {};
  const level = levels.includes(cfg.thinkingLevel)
    ? cfg.thinkingLevel
    : liveRequiresThinking(cfg.model)
      ? (levels.includes("low") ? "low" : levels[0])
      : "";
  return level ? { thinkingConfig: { thinkingLevel: level } } : {};
}

// ── Parent (family) settings ─────────────────────────────────────────────────
// Parents tune the buddy at families/{f}/meta/explore. They choose from SERVER-
// validated options only (a voice from the verified list, "fast" vs "thinks
// harder" for Learning, a shorter session, a few notes) — never a raw model id —
// and the superadmin's Platform config stays the ceiling and the source of models.
export const PARENT_NOTES_MAX = 500;
export const PARENT_AVOID_MAX = 300;
// Delivery choices a parent may set. Enums (not free text) so they can be turned
// into unambiguous directives, and so the panel can offer them as one tap.
export const PACES = ["normal", "slow"];
export const REPLY_LENGTHS = ["normal", "short", "tiny"];
export const LANGUAGES = ["auto", "english", "urdu", "arabic"];
// How the screen celebrates a win (sound played from files saved in the web app;
// see web/src/lib/celebration.js, kept in step by a test).
export const CELEBRATIONS = ["mashallah_clap", "mashallah", "barakallah", "clapping", "cheer", "chime", "mix", "none"];
export const DEFAULT_CELEBRATION = "mashallah_clap";
export const EXTENDED_LEVELS = ["low", "medium", "high"];

// `caps` (from exploreCapabilities) is optional: when given, a preference the
// platform's models can't honour is dropped instead of stored, so a switch that
// disappears from the panel doesn't linger in the saved document.
export function sanitizeFamilySettings(raw = {}, caps = null) {
  const out = {};
  const voices = caps?.voices?.length ? caps.voices : LIVE_VOICES;
  if (voices.includes(raw.voiceName)) out.voiceName = raw.voiceName;
  if (raw.learnStyle === "fast" || (raw.learnStyle === "thinking" && (!caps || caps.canThink))) out.learnStyle = raw.learnStyle;
  if (PACES.includes(raw.pace)) out.pace = raw.pace;
  if (REPLY_LENGTHS.includes(raw.replyLength)) out.replyLength = raw.replyLength;
  if (LANGUAGES.includes(raw.language)) out.language = raw.language;
  if (CELEBRATIONS.includes(raw.celebration)) out.celebration = raw.celebration;
  if (typeof raw.avoid === "string") {
    const avoid = raw.avoid.replace(/\s+/g, " ").trim().slice(0, PARENT_AVOID_MAX);
    if (avoid) out.avoid = avoid;
  }
  const levels = caps ? caps.thinkingLevels || [] : EXTENDED_LEVELS;
  if (levels.includes(raw.thinkingLevel)) out.thinkingLevel = raw.thinkingLevel;
  const mins = Math.round(Number(raw.sessionMinutes));
  if (Number.isFinite(mins) && mins > 0) out.sessionMinutes = Math.max(5, Math.min(30, mins));
  if (typeof raw.notes === "string") out.notes = raw.notes.replace(/\s+/g, " ").trim().slice(0, PARENT_NOTES_MAX);
  return out;
}

// The Live model a "Thinks harder" conversation runs on: the platform's Learning
// model when it can actually reason, otherwise the catalog's thinking model. When
// no thinking model exists at all this returns "" and the caller stays on the fast
// model — the option is hidden in the UI in that case (see exploreCapabilities).
// No automatic fallback any more: the only thinking Live models verified so far
// either say "a system error occurred" mid-lesson (3.8 extended thinking) or
// sometimes speak their own tool call aloud (3.1 Flash Live), so "thinks harder"
// is offered only when the superadmin deliberately picks a thinking model that
// isn't flagged `unreliable` in the catalog.
function thinkingModelFor(platformLearnModel) {
  if (liveThinkingLevels(platformLearnModel).length && !liveModelUnreliable(platformLearnModel)) return platformLearnModel;
  return "";
}

// Merge the platform config with a family's (sanitized) preferences for one mode.
// Whatever comes out, the settings must FIT the resolved model: a thinking level
// or a voice the model doesn't support is dropped here rather than being sent to
// the Live API, which would refuse the session.
export function applyFamilySettings(cfg, famRaw, mode) {
  const fam = sanitizeFamilySettings(famRaw);
  const platformLearnModel = isLiveModelId(cfg.learnModel) ? cfg.learnModel : cfg.model;
  let model = cfg.model;
  let thinkingLevel = cfg.thinkingLevel;
  if (mode === "learn") {
    const wantsThinking = fam.learnStyle ? fam.learnStyle === "thinking" : platformLearnModel !== cfg.model;
    const thinkingModel = thinkingModelFor(platformLearnModel);
    model = wantsThinking && thinkingModel ? thinkingModel : cfg.model;
    thinkingLevel = fam.thinkingLevel || cfg.learnThinkingLevel || cfg.thinkingLevel;
  } else if (fam.thinkingLevel) {
    thinkingLevel = fam.thinkingLevel;
  }
  // A level the resolved model doesn't accept is not a setting — it's a broken
  // session. (A family that picked "medium" for Learning must not carry it into
  // an Exploration conversation on a model with no thinking.)
  const levels = liveThinkingLevels(model);
  thinkingLevel = levels.includes(thinkingLevel) ? thinkingLevel : "";
  // Same for the voice: keep the family's choice only if this model speaks it.
  const voices = liveVoicesFor(model);
  const voiceName = [fam.voiceName, cfg.voiceName, "Puck"].find((v) => voices.includes(v)) || voices[0];
  // The platform limit is a ceiling; a family can only shorten a conversation.
  const platformMinutes = cfg.sessionMinutes || 20;
  return {
    model,
    thinkingLevel,
    voiceName,
    sessionMinutes: Math.min(platformMinutes, fam.sessionMinutes || platformMinutes),
    // How the parents want the buddy to speak. Purely a prompt concern — no model
    // supports or refuses these, so they are never capability-gated.
    style: {
      pace: fam.pace || "normal",
      replyLength: fam.replyLength || "normal",
      language: fam.language || "auto",
      avoid: fam.avoid || "",
      notes: fam.notes || "",
    },
    notes: fam.notes || "",
    celebration: fam.celebration || DEFAULT_CELEBRATION,
  };
}

// What the parent's Buddy-settings panel may offer, derived from the models the
// superadmin actually configured. The panel hides anything not in here, so a
// parent is never shown a switch the platform's models can't honour.
export function exploreCapabilities(cfg = {}) {
  const platformLearnModel = isLiveModelId(cfg.learnModel) ? cfg.learnModel : cfg.model;
  const thinkingModel = thinkingModelFor(platformLearnModel);
  return {
    voices: liveVoicesFor(cfg.model),
    canThink: !!thinkingModel,
    thinkingLevels: liveThinkingLevels(thinkingModel),
    maxMinutes: cfg.sessionMinutes || 20,
  };
}

// ── Data assembly ────────────────────────────────────────────────────────────

// Fetch the brief's slice in ONE parallel round of small, capped reads.
async function loadBriefData(db, familyId, childId) {
  const p = familyPaths(db, familyId);
  const settle = async (fn, fallback) => {
    try { return await fn(); } catch (e) { console.warn(`[explore] brief read failed: ${e?.message || e}`); return fallback; }
  };
  const [childSnap, profileSnap, skills, interests, scores] = await Promise.all([
    p.child(childId).get(),
    p.profile().get(),
    settle(async () => (await p.child(childId).collection("skills").limit(12).get()).docs.map((d) => d.data()), []),
    settle(async () => (await p.child(childId).collection("interests").orderBy("count", "desc").limit(8).get()).docs.map((d) => d.data()), []),
    settle(async () => (await p.scores().where("childId", "==", childId).orderBy("scoredAt", "desc").limit(15).get()).docs.map((d) => d.data()), []),
  ]);
  if (!childSnap.exists) return null;
  return { child: childSnap.data(), family: profileSnap.exists ? profileSnap.data() : {}, skills, interests, scores };
}

// ── Callables ────────────────────────────────────────────────────────────────

// Start a session: validate the child belongs to the caller's family, assemble
// the brief, and mint a locked, single-use ephemeral token.
export const startExploreSession = onCall({ secrets: ["GEMINI_API_KEY"], timeoutSeconds: 30 }, async (request) => {
  const { db, uid, familyId } = await resolveCaller(request);
  const childId = String(request.data?.childId || "");
  const mode = MODES.includes(request.data?.mode) ? request.data.mode : "explore";
  const focus = String(request.data?.focus || "").slice(0, 200);
  if (!childId) throw new HttpsError("invalid-argument", "Pick a child first.");
  if (!process.env.GEMINI_API_KEY) {
    return { configured: false, message: "Explore isn't configured yet — set the GEMINI_API_KEY secret." };
  }
  const [data, cfg, famSnap] = await Promise.all([
    loadBriefData(db, familyId, childId),
    loadAgentConfig(db, "explore"),
    settingsDoc(db, familyId, childId, mode).get().catch(() => null),
  ]);
  await enforceDailyLimit(db, familyId, "explore", cfg.dailySessions || 30);
  if (!data) throw new HttpsError("not-found", "That child isn't in your family.");

  // Platform config (superadmin) ⊕ this family's own preferences (parents).
  const eff = applyFamilySettings(cfg, famSnap?.exists ? famSnap.data() : {}, mode);
  const sessionMinutes = eff.sessionMinutes;
  const model = eff.model;
  const systemInstruction = buildExploreSystemPrompt({
    mode,
    focus,
    brief: formatChildBrief(data),
    platform: (cfg.systemInstructions || "").trim(),
    parentStyle: eff.style,
  });
  const liveConfig = {
    responseModalities: [Modality.AUDIO],
    systemInstruction,
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: eff.voiceName } } },
    tools: [{ functionDeclarations: EXPLORE_TOOL_DECLARATIONS }],
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    // Google caps audio-only Live sessions at ~15 min; a sliding window lets a
    // conversation run to the configured length by trimming the oldest turns.
    contextWindowCompression: { slidingWindow: {} },
    ...thinkingConfigFor({ model, thinkingLevel: eff.thinkingLevel }),
  };

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { apiVersion: "v1alpha" } });
  // NOTE: minting a token does not validate the model id — a wrong id only fails
  // when the browser connects. The superadmin Platform "Preview" test connects for
  // real, so a bad model is caught there before it's saved.
  let token;
  try {
    token = await ai.authTokens.create({
      config: {
        uses: 1,
        expireTime: new Date(Date.now() + sessionMinutes * 60_000).toISOString(),
        newSessionExpireTime: new Date(Date.now() + 3 * 60_000).toISOString(),
        liveConnectConstraints: { model, config: liveConfig },
      },
    });
  } catch (e) {
    console.warn(`[explore] token mint failed for ${model}: ${e?.message || e}`);
    throw new HttpsError("internal", `Couldn't start the live voice: ${String(e?.message || e).slice(0, 200)}`);
  }

  const sessionRef = await familyPaths(db, familyId).family().collection("exploreSessions").add({
    childId, mode, focus, uid, model, startedAt: new Date(), status: "started",
  });
  return {
    configured: true,
    token: token.name,
    model,
    sessionId: sessionRef.id,
    childName: data.child.name || "",
    maxMinutes: sessionMinutes,
    celebration: eff.celebration,
    config: liveConfig, // the client must present the same config; the token enforces it
  };
});

// Read / write this family's Explore preferences. Both go through the server so
// values are validated (verified voice list, clamped ranges, capped notes) and
// only owners/parents can change them.
//
// Scoped to ONE child and ONE mode: a note like "Hadi is practising k and s
// sounds" or a same-day task is specific to that child, and a delivery style
// picked for Learning (short, careful answers) is often wrong for freewheeling
// Exploration. Storing one shared document meant every child and every mode
// saw the same notes and dials — a task written for one child leaked to a
// sibling's conversation. Each (child, mode) pair now gets its own document.
const settingsDoc = (db, familyId, childId, mode) =>
  familyPaths(db, familyId).family().collection("meta").doc(`explore_${childId}_${mode}`);

function modeOf(raw) {
  return MODES.includes(raw) ? raw : "explore";
}

async function requireOwnChild(db, familyId, childId) {
  if (!childId) throw new HttpsError("invalid-argument", "childId required.");
  const snap = await familyPaths(db, familyId).child(childId).get();
  if (!snap.exists) throw new HttpsError("not-found", "That child isn't in your family.");
}

// `capabilities` tells the panel what the platform's CURRENT models can honour
// (which voices, whether "Thinks harder" exists at all, which levels), so it only
// ever shows switches that will work.
export const getExploreSettings = onCall(async (request) => {
  const { db, familyId } = await resolveCaller(request);
  const childId = String(request.data?.childId || "");
  const mode = modeOf(request.data?.mode);
  await requireOwnChild(db, familyId, childId);
  const [snap, cfg] = await Promise.all([settingsDoc(db, familyId, childId, mode).get(), loadAgentConfig(db, "explore")]);
  return {
    settings: sanitizeFamilySettings(snap.exists ? snap.data() : {}),
    capabilities: exploreCapabilities(cfg),
  };
});

export const saveExploreSettings = onCall(async (request) => {
  const { db, uid, familyId, role } = await resolveCaller(request);
  if (!["owner", "parent"].includes(role)) throw new HttpsError("permission-denied", "Only a parent can change the buddy's settings.");
  const childId = String(request.data?.childId || "");
  const mode = modeOf(request.data?.mode);
  await requireOwnChild(db, familyId, childId);
  const cfg = await loadAgentConfig(db, "explore");
  const clean = sanitizeFamilySettings(request.data?.settings || {}, exploreCapabilities(cfg));
  // Replace (not merge) so cleared fields, like empty notes, actually clear.
  await settingsDoc(db, familyId, childId, mode).set({ ...clean, childId, mode, updatedAt: new Date(), updatedBy: uid });
  return { settings: clean, capabilities: exploreCapabilities(cfg) };
});

// Let a parent hear a voice before choosing it: one short real Live greeting in
// that voice (a few cents), rate-limited per family per day.
export const previewExploreVoice = onCall({ secrets: ["GEMINI_API_KEY"], timeoutSeconds: 60 }, async (request) => {
  const { db, familyId } = await resolveCaller(request);
  const voiceName = String(request.data?.voiceName || "");
  if (!LIVE_VOICES.includes(voiceName)) throw new HttpsError("invalid-argument", "Unknown voice.");
  if (!process.env.GEMINI_API_KEY) return { configured: false };
  await enforceDailyLimit(db, familyId, "exploreVoice", 30);
  const cfg = await loadAgentConfig(db, "explore");
  try {
    const r = await testLiveModel({
      apiKey: process.env.GEMINI_API_KEY,
      model: cfg.model,
      voiceName,
      prompt: "Say hello to a child in one short, warm sentence and say you can't wait to explore together.",
    });
    return { configured: true, ok: true, url: r.url, transcript: r.transcript };
  } catch (e) {
    return { configured: true, ok: false, error: String(e?.message || e).slice(0, 200) };
  }
});

// Answer one of the live model's tool calls. Scoped to the caller's family and
// a child that family owns; results are size-capped.
export const exploreTool = onCall(async (request) => {
  const { db, uid, familyId } = await resolveCaller(request);
  const childId = String(request.data?.childId || "");
  const name = String(request.data?.name || "");
  const sessionId = String(request.data?.sessionId || "").slice(0, 60);
  if (!childId) throw new HttpsError("invalid-argument", "childId required.");
  if (!EXPLORE_TOOL_DECLARATIONS.some((d) => d.name === name)) throw new HttpsError("invalid-argument", "Unknown tool.");
  const childSnap = await familyPaths(db, familyId).child(childId).get();
  if (!childSnap.exists) throw new HttpsError("not-found", "That child isn't in your family.");
  const impl = createExploreTools({ db, familyId, childId, uid, sessionId })[name];
  try {
    return { result: capResult(await impl(request.data?.args || {})) };
  } catch (e) {
    console.warn(`[explore] tool ${name} failed: ${e?.message || e}`);
    return { result: { error: "That lookup didn't work; carry on without it." } };
  }
});

// Close out a session record with a short transcript excerpt for the parents.
export const endExploreSession = onCall(async (request) => {
  const { db, familyId } = await resolveCaller(request);
  const id = String(request.data?.sessionId || "");
  if (!id) throw new HttpsError("invalid-argument", "sessionId required.");
  const ref = familyPaths(db, familyId).family().collection("exploreSessions").doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Unknown session.");
  const transcript = Array.isArray(request.data?.transcript) ? request.data.transcript.slice(-40) : [];
  await ref.set(
    {
      status: "ended",
      endedAt: new Date(),
      transcript: transcript.map((t) => ({ role: t?.role === "child" ? "child" : "guide", text: clip(t?.text, 400) })),
    },
    { merge: true }
  );
  return { ok: true };
});
