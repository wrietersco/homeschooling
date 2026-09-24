// Verifies the LIVE buddy's behaviour against the REAL API, using the app's own
// system prompt and tool declarations: does it actually call the tools we ask it
// to (especially record_session_highlights, which is optional and easy for a model
// to ignore), does the highlight it writes survive sanitizeHighlights, and does it
// obey the parents' delivery instructions (one short English sentence per turn)?
//
// A scripted "child" plays a speech lesson over text turns — the same socket the
// browser uses, minus the microphone.
//
// Usage: GEMINI_API_KEY=… node scripts/verifyExploreTools.mjs [modelId]
import { GoogleGenAI, Modality } from "@google/genai";
import {
  buildExploreSystemPrompt,
  formatChildBrief,
  EXPLORE_TOOL_DECLARATIONS,
  sanitizeHighlights,
  highlightsFromArgs,
} from "../agents/explore.js";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) { console.error("GEMINI_API_KEY is not set."); process.exit(1); }
const model = process.argv[2] || "gemini-3.8-live";

// The child a parent would actually have configured.
const brief = formatChildBrief({
  child: { name: "Hadi", dob: "2020-03-01", strengths: "Loves trains and rockets; great memory for stories.", weaknesses: "The k sound at the start of words comes out as t.", goals: "Say k words clearly; read the Qaida.", comments: "Gets discouraged quickly if corrected too often." },
  family: { guidingLight: "Quran first, then the world." },
  skills: [{ name: "Phonics" }],
  interests: [{ topic: "trains" }],
  scores: [{ completed: true, activityTitle: "Letter K" }],
});
const systemInstruction = buildExploreSystemPrompt({
  mode: "learn",
  brief,
  focus: "speech and articulation practice",
  parentStyle: { pace: "slow", replyLength: "tiny", language: "english", avoid: "Never mention that he stammers.", notes: "" },
});

// A child who gets it wrong twice, then right.
const CHILD_TURNS = [
  "(The child has just arrived. Greet them warmly by name and begin.)",
  "tite",
  "tite",
  "kite!",
  "I have to go now, bye!",
];

const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1alpha" } });
const toolCalls = [];
const replies = [];
let transcript = "";
let resolveTurn = null;

const session = await ai.live.connect({
  model,
  config: {
    responseModalities: [Modality.AUDIO],
    systemInstruction,
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } },
    tools: [{ functionDeclarations: EXPLORE_TOOL_DECLARATIONS }],
    outputAudioTranscription: {},
    contextWindowCompression: { slidingWindow: {} },
  },
  callbacks: {
    onopen: () => {},
    onmessage: (m) => {
      if (m.serverContent?.outputTranscription?.text) transcript += m.serverContent.outputTranscription.text;
      if (m.toolCall?.functionCalls?.length) {
        const responses = m.toolCall.functionCalls.map((fc) => {
          toolCalls.push({ name: fc.name, args: fc.args || {} });
          // Answer exactly as exploreTool would, so the lesson keeps moving.
          const result = fc.name.startsWith("record_") || fc.name === "save_interest"
            ? { saved: true }
            : { skills: [{ name: "Phonics" }], activities: [], observations: [], matches: [] };
          return { id: fc.id, name: fc.name, response: { result } };
        });
        session.sendToolResponse({ functionResponses: responses });
      }
      if (m.serverContent?.turnComplete) { replies.push(transcript.trim()); transcript = ""; resolveTurn?.(); }
    },
    onerror: (e) => { console.error("live error:", e?.message || e); process.exit(1); },
    onclose: () => resolveTurn?.(),
  },
});

for (const text of CHILD_TURNS) {
  await new Promise((resolve) => {
    resolveTurn = resolve;
    session.sendRealtimeInput({ text });
    setTimeout(resolve, 30000); // never hang on a turn the model drops
  });
}
try { session.close(); } catch { /* already closed */ }

// ── Report ───────────────────────────────────────────────────────────────────
console.log("\nCONVERSATION (buddy's side)");
replies.forEach((r, i) => console.log(`  ${i + 1}. ${r || "(no speech)"}`));

console.log("\nTOOL CALLS");
if (!toolCalls.length) console.log("  (none)");
for (const c of toolCalls) console.log(`  ${c.name}  ${JSON.stringify(c.args).slice(0, 300)}`);

const highlightCalls = toolCalls.filter((c) => c.name === "record_session_highlights");
console.log("\nHIGHLIGHTS AS STORED (after sanitizeHighlights)");
for (const c of highlightCalls) console.log(`  ${JSON.stringify(highlightsFromArgs(c.args))}`);

const spoken = replies.filter(Boolean);
const sentences = spoken.map((r) => (r.match(/[.!?]+/g) || []).length || 1);
const nonAscii = spoken.filter((r) => /[؀-ۿऀ-ॿ]/.test(r)).length;
const checks = [
  ["buddy filed session highlights", highlightCalls.length > 0],
  ["every highlight stores cleanly", highlightCalls.length > 0 && highlightCalls.every((c) => highlightsFromArgs(c.args))],
  ["highlights are structured, not prose", highlightCalls.some((c) => { const h = highlightsFromArgs(c.args); return h && !("note" in h) && Object.keys(h).length >= 2; })],
  ["the attempt count was recorded", highlightCalls.some((c) => Number.isFinite(Number(c.args.attempts)) || Number.isFinite(Number(c.args.tries_to_understand)))],
  ["kept turns very short (<= 2 sentences)", sentences.every((n) => n <= 2)],
  ["spoke English only", nonAscii === 0],
];
console.log("");
for (const [label, ok] of checks) console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
