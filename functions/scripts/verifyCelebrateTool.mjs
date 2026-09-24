// Verifies the `celebrate` tool call against the REAL Live API, for the exact
// failure a real session hit: the buddy praised a correct spelling ("That is
// exactly right, Abdul Hadi!") but never called `celebrate`, so no confetti or
// sound fired. This checks two things after strengthening the prompt:
//   1. does the model now call the tool when it praises a correct answer?
//   2. even if it forgets, does the client-side phrase safety net
//      (looksLikeCelebration in web/src/lib/liveAudio.js) catch its own words?
//
// Usage: GEMINI_API_KEY=… node scripts/verifyCelebrateTool.mjs [modelId]
import { GoogleGenAI, Modality } from "@google/genai";
import { buildExploreSystemPrompt, formatChildBrief, EXPLORE_TOOL_DECLARATIONS } from "../agents/explore.js";
import { looksLikeCelebration } from "../../web/src/lib/liveAudio.js";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) { console.error("GEMINI_API_KEY is not set."); process.exit(1); }
const model = process.argv[2] || "gemini-3.8-live";

// The real scenario from the bug report: a spelling task, word-by-word.
const brief = formatChildBrief({
  child: { name: "Abdul Hadi", dob: "2020-01-01", weaknesses: "Hard time remembering vowels in words.", goals: "Learn to spell key vocabulary." },
});
const systemInstruction = buildExploreSystemPrompt({
  mode: "learn",
  brief,
  focus: "spelling practice",
  parentStyle: { replyLength: "short" },
});

const CHILD_TURNS = [
  "(The child has just arrived. Greet them warmly by name and begin.)",
  "Let's spell parents.",
  "p a r e n t s",
  "I have to go now, bye!",
];

const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1alpha" } });
const toolCalls = [];
const replies = [];
let transcript = "";
let resolveTurn = null;
let turnIndex = 0;

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
          toolCalls.push({ name: fc.name, args: fc.args || {}, turn: turnIndex });
          const result = fc.name === "celebrate"
            ? { celebrated: true, note: "The cheer has finished playing. Carry on; don't celebrate this win again." }
            : fc.name.startsWith("record_") || fc.name === "save_interest" ? { saved: true }
            : { skills: [], activities: [], observations: [], matches: [] };
          return { id: fc.id, name: fc.name, response: { result } };
        });
        // Like the app: a celebrate answer is held until the ~2s cheer has played.
        const hold = m.toolCall.functionCalls.some((fc) => fc.name === "celebrate") ? 2500 : 0;
        setTimeout(() => session.sendToolResponse({ functionResponses: responses }), hold);
      }
      if (m.serverContent?.turnComplete) { replies.push(transcript.trim()); transcript = ""; resolveTurn?.(); }
    },
    onerror: (e) => { console.error("live error:", e?.message || e); process.exit(1); },
    onclose: () => resolveTurn?.(),
  },
});

for (const [i, text] of CHILD_TURNS.entries()) {
  turnIndex = i;
  await new Promise((resolve) => {
    resolveTurn = resolve;
    session.sendRealtimeInput({ text });
    setTimeout(resolve, 30000);
  });
}
try { session.close(); } catch { /* already closed */ }

console.log("\nCONVERSATION (buddy's side)");
replies.forEach((r, i) => console.log(`  ${i + 1}. ${r || "(no speech)"}`));

console.log("\nTOOL CALLS");
if (!toolCalls.length) console.log("  (none)");
for (const c of toolCalls) console.log(`  ${c.name}  ${JSON.stringify(c.args).slice(0, 200)}`);

const celebrateCalls = toolCalls.filter((c) => c.name === "celebrate");
const heuristicHits = replies.filter((r) => looksLikeCelebration(r));
const wouldCelebrate = celebrateCalls.length > 0 || heuristicHits.length > 0;
const perTurn = CHILD_TURNS.map((_, i) => celebrateCalls.filter((c) => c.turn === i).length);
const repeated = perTurn.some((n) => n > 1);

console.log("\nCHECKS");
console.log(`  celebrate tool called: ${celebrateCalls.length > 0 ? "YES" : "no"} (${celebrateCalls.length}x)`);
console.log(`  phrase safety net would have caught it: ${heuristicHits.length > 0 ? "YES" : "no"} (${heuristicHits.length} reply/replies)`);
console.log(`  celebrate calls per child turn: ${perTurn.join(", ")} ${repeated ? "(REPEATED — the app plays only the first)" : "(never twice for one win)"}`);
console.log(`  RESULT: the child would ${wouldCelebrate ? "SEE the celebration" : "MISS the celebration"}`);
process.exit(wouldCelebrate && !repeated ? 0 : 1);
