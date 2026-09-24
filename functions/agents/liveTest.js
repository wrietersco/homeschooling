// Health check for a Gemini Live model + voice. Mirrors the PRODUCTION path
// exactly: mint a locked single-use ephemeral token, open a Live session with it,
// ask the model to say a short hello, and measure what comes back. Used by the
// superadmin Platform "Preview" button and by ad-hoc verification scripts.
import { GoogleGenAI, Modality } from "@google/genai";
import { pcmToWav } from "./tts.js";

const OUT_RATE = 24000;

export async function testLiveModel({
  apiKey,
  model,
  voiceName = "Puck",
  systemInstruction = "You are a friendly companion for a young child. Keep replies to one short sentence.",
  prompt = "Say a warm hello to Hadi in one short sentence.",
  thinkingLevel = "",
  timeoutMs = 25000,
  now = () => Date.now(),
}) {
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set.");
  const t0 = now();
  const config = {
    responseModalities: [Modality.AUDIO],
    systemInstruction,
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
    outputAudioTranscription: {},
    contextWindowCompression: { slidingWindow: {} },
    ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}),
  };
  const minter = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1alpha" } });
  const token = await minter.authTokens.create({
    config: {
      uses: 1,
      expireTime: new Date(Date.now() + 5 * 60_000).toISOString(),
      newSessionExpireTime: new Date(Date.now() + 2 * 60_000).toISOString(),
      liveConnectConstraints: { model, config },
    },
  });
  const tokenMs = now() - t0;

  const client = new GoogleGenAI({ apiKey: token.name, httpOptions: { apiVersion: "v1alpha" } });
  const chunks = [];
  let transcript = "";
  let firstAudioMs = null;
  let closeReason = "";
  let session;

  const turn = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`No complete reply within ${timeoutMs / 1000}s${closeReason ? ` (closed: ${closeReason})` : ""}.`)), timeoutMs);
    const done = () => { clearTimeout(timer); resolve(); };
    client.live
      .connect({
        model,
        config,
        callbacks: {
          onopen: () => {},
          onmessage: (m) => {
            for (const p of m.serverContent?.modelTurn?.parts || []) {
              if (p.inlineData?.data) {
                if (firstAudioMs === null) firstAudioMs = now() - t0;
                chunks.push(Buffer.from(p.inlineData.data, "base64"));
              }
            }
            if (m.serverContent?.outputTranscription?.text) transcript += m.serverContent.outputTranscription.text;
            if (m.serverContent?.turnComplete) done();
          },
          onerror: (e) => { clearTimeout(timer); reject(new Error(e?.message || "Live connection error")); },
          onclose: (e) => { closeReason = e?.reason || ""; if (!chunks.length) { clearTimeout(timer); reject(new Error(`Connection closed${closeReason ? `: ${closeReason}` : ""}`)); } },
        },
      })
      .then((s) => {
        session = s;
        try { s.sendRealtimeInput({ text: prompt }); } catch { s.sendClientContent({ turns: prompt, turnComplete: true }); }
      })
      .catch((e) => { clearTimeout(timer); reject(e); });
  });

  try {
    await turn;
  } finally {
    try { session?.close(); } catch { /* ignore */ }
  }
  const pcm = Buffer.concat(chunks);
  if (!pcm.length) throw new Error("The model replied without any audio.");
  const wav = pcmToWav(pcm, { sampleRate: OUT_RATE });
  return {
    latencyMs: now() - t0,
    tokenMs,
    firstAudioMs,
    audioSeconds: Number((pcm.length / 2 / OUT_RATE).toFixed(2)),
    transcript: transcript.trim(),
    url: `data:audio/wav;base64,${wav.toString("base64")}`,
  };
}
