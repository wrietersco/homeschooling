// Reproduces "You nailed it! I am sorry, but a system error occurred" after a
// celebrate call, using the app's exact Live config for a given model.
// Usage: GEMINI_API_KEY=… node scripts/reproCelebrateError.mjs [model] [holdMs] [thinkingLevel]
import { GoogleGenAI, Modality } from "@google/genai";
import { buildExploreSystemPrompt, formatChildBrief, EXPLORE_TOOL_DECLARATIONS, thinkingConfigFor } from "../agents/explore.js";

const model = process.argv[2] || "gemini-3.8-live-extended-thinking";
const holdMs = Number(process.argv[3] ?? 2500);
const thinkingLevel = process.argv[4] || "low";
const brief = formatChildBrief({ child: { name: "Abdul Hadi", dob: "2020-01-01", goals: "Grammar: nouns and verbs." } });
const systemInstruction = buildExploreSystemPrompt({ mode: "learn", brief, focus: "nouns", parentStyle: { replyLength: "short" } });
const config = {
  responseModalities: [Modality.AUDIO], systemInstruction,
  speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } },
  ...(process.env.NOTOOLS ? {} : { tools: [{ functionDeclarations: EXPLORE_TOOL_DECLARATIONS }] }),
  inputAudioTranscription: {}, outputAudioTranscription: {},
  contextWindowCompression: { slidingWindow: {} },
  ...thinkingConfigFor({ model, thinkingLevel }),
};
const TURNS = ["(The child has just arrived. Greet them warmly by name and begin.)", "nouns", "Okay.", "fan", "cup", "bye"];
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { apiVersion: "v1alpha" } });
const t0 = Date.now(); const ts = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(5);
let out = ""; let resolveTurn;
const flushOut = () => { if (out) { console.log(`${ts()} BUDDY: ${out}`); out = ""; } };
const session = await ai.live.connect({ model, config, callbacks: {
  onmessage: (m) => {
    if (process.env.RAW) { const c = JSON.parse(JSON.stringify(m)); for (const p of c.serverContent?.modelTurn?.parts || []) if (p.inlineData) p.inlineData = "<audio>"; if (!(c.serverContent?.modelTurn?.parts || []).every((p) => p.inlineData) || !c.serverContent?.modelTurn) console.log(ts(), "RAW", JSON.stringify(c).slice(0, 600)); }
    const keys = Object.keys(m).filter((k) => !["serverContent"].includes(k) && m[k] !== undefined);
    if (m.serverContent?.outputTranscription?.text) out += m.serverContent.outputTranscription.text;
    if (m.toolCallCancellation) { flushOut(); console.log(`${ts()} TOOL CALL CANCELLED ${JSON.stringify(m.toolCallCancellation)}`); }
    if (m.serverContent?.interrupted) console.log(`${ts()} interrupted`);
    if (m.toolCall) {
      flushOut();
      for (const fc of m.toolCall.functionCalls) console.log(`${ts()} TOOL ${fc.name} ${JSON.stringify(fc.args)} id=${fc.id}`);
      const functionResponses = m.toolCall.functionCalls.map((fc) => ({ id: fc.id, name: fc.name, response: { result: fc.name === "celebrate"
        ? { celebrated: true, note: "The cheer has finished playing. Carry on; don't celebrate this win again." }
        : { saved: true } } }));
      const hold = m.toolCall.functionCalls.some((f) => f.name === "celebrate") ? holdMs : 0;
      setTimeout(() => { console.log(`${ts()} -> tool response sent`); session.sendToolResponse({ functionResponses }); }, hold);
    }
    if (keys.length && !m.toolCall && !m.toolCallCancellation && !m.setupComplete && !m.usageMetadata) console.log(`${ts()} msg ${keys.join(",")}`);
    if (m.serverContent?.turnComplete) {
      flushOut(); console.log(`${ts()} [turnComplete ${m.serverContent.interactionStatus || ""}]`);
      // Like a patient child: answer only once the buddy is really done (IDLE).
      if (process.env.PATIENT ? m.serverContent.interactionStatus !== "IN_PROGRESS" : true) setTimeout(() => resolveTurn?.(), 2500);
    }
  },
  onerror: (e) => console.log("ERROR", e?.message || e),
  onclose: (e) => { console.log(`${ts()} CLOSED ${e?.code} ${e?.reason}`); resolveTurn?.(); },
} });
for (const text of TURNS) {
  console.log(`${ts()} CHILD: ${text}`);
  await new Promise((r) => { resolveTurn = r; session.sendRealtimeInput({ text }); setTimeout(r, 30000); });
}
flushOut(); session.close(); process.exit(0);
