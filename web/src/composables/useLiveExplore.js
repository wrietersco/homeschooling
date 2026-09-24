// Live voice conversation with Gemini for the Explore feature.
//
// Flow: the server (startExploreSession) validates the child, builds their brief
// and returns a locked single-use token; this composable opens the Live websocket
// with it, streams the microphone up (16 kHz PCM) and plays Gemini's voice back
// (24 kHz PCM), relays the model's tool calls to the server (exploreTool) and keeps
// a running transcript. All audio/transcript maths lives in lib/liveAudio.js.
import { computed, onBeforeUnmount, ref } from "vue";
import { GoogleGenAI } from "@google/genai";
import { startExploreSession, callExploreTool, endExploreSession } from "@/services/explore";
import {
  OUTPUT_RATE, micChunkToBase64, base64ToFloat, rms, appendTranscript, playCelebrationChime, looksLikeCelebration,
  CELEBRATION_CHIME_SECONDS,
} from "@/lib/liveAudio";
import { DEFAULT_CELEBRATION, celebrationSources, resolveCelebration } from "@/lib/celebration";

// AudioWorklet that forwards raw mic frames to the main thread.
const WORKLET_SRC = `
class Tap extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor("mic-tap", Tap);`;

function withTimeout(promise, ms, message) {
  let t;
  return Promise.race([
    promise,
    new Promise((_, rej) => { t = setTimeout(() => rej(new Error(message)), ms); }),
  ]).finally(() => clearTimeout(t));
}

export function useLiveExplore() {
  const state = ref("idle"); // idle | connecting | live | ended | error
  const error = ref("");
  const turns = ref([]);
  const micLevel = ref(0);
  const speaking = ref(false); // Gemini's voice is playing
  const muted = ref(false);
  const secondsLeft = ref(0);
  const childName = ref("");
  // Bumped to Date.now() each time the buddy calls the `celebrate` tool — a
  // view watches this to burst confetti in step with the cheer sound below.
  const celebrateAt = ref(0);
  const celebrateReason = ref("");

  let session = null;
  let sessionId = "";
  let activeChildId = "";
  let micCtx = null;
  let micStream = null;
  let micNode = null;
  let outCtx = null;
  let playHead = 0;
  let sources = new Set();
  let timer = 0;
  let closing = false;
  // Running buffer of the buddy's CURRENT turn's transcript, for the celebration
  // safety net below; reset whenever the child speaks again.
  let guideBuffer = "";
  // ONE celebration per win: the tool call and the transcript safety net both
  // land on the same moment (sometimes seconds apart), so the flag, not a
  // timer, decides. Only the child genuinely speaking again re-arms it.
  let celebratedThisTurn = false;
  // outCtx time at which the cheer clip finishes. Until then (plus a short echo
  // tail) the mic is not forwarded, so the model never hears the app's own
  // "Masha'Allah! Well done!" as the child talking and celebrates again.
  let celebrationEndsAt = 0;
  const ECHO_TAIL_S = 0.6;
  let burstTimers = [];
  // The parent's chosen celebration sound for this child (from the server), and
  // its saved recordings decoded into the buddy's playback context.
  let celebrationChoice = DEFAULT_CELEBRATION;
  let celebrationBuffers = new Map();
  let lastCelebrationSrc = "";

  const isLive = computed(() => state.value === "live");

  // Decoded into the SAME AudioContext as the buddy's voice: it was unlocked by
  // the Start click, so these can never be blocked by the browser's autoplay
  // rules the way a fresh <audio> element mid-conversation can be.
  async function loadCelebrationSounds(choice) {
    celebrationChoice = choice || DEFAULT_CELEBRATION;
    celebrationBuffers = new Map();
    const ctx = outCtx;
    await Promise.all(celebrationSources(celebrationChoice).map(async (src) => {
      try {
        const bytes = await (await fetch(src)).arrayBuffer();
        if (ctx && ctx === outCtx) celebrationBuffers.set(src, await ctx.decodeAudioData(bytes));
      } catch { /* a missing clip falls back to the chime below */ }
    }));
  }

  // Queues the cheer IN the buddy's voice timeline: right after the speech
  // already scheduled (the praise), and pushes the play head past it so any
  // further speech waits for the cheer instead of talking over it.
  // Returns the clip's start time in outCtx time.
  function scheduleCelebrationSound() {
    const startAt = Math.max(outCtx.currentTime + 0.05, playHead);
    const pick = resolveCelebration(celebrationChoice, { previous: lastCelebrationSrc });
    let seconds = 0;
    const buf = pick?.kind === "file" ? celebrationBuffers.get(pick.src) : null;
    if (buf) {
      lastCelebrationSrc = pick.src;
      const src = outCtx.createBufferSource();
      src.buffer = buf;
      src.connect(outCtx.destination);
      src.start(startAt);
      seconds = buf.duration || 0;
    } else if (pick) {
      // "chime", or a saved recording that failed to load
      playCelebrationChime(outCtx, startAt);
      seconds = CELEBRATION_CHIME_SECONDS;
    }
    celebrationEndsAt = Math.max(celebrationEndsAt, startAt + seconds);
    playHead = Math.max(playHead, celebrationEndsAt);
    return startAt;
  }

  function micGated() {
    return !!outCtx && outCtx.currentTime < celebrationEndsAt + ECHO_TAIL_S;
  }

  // Milliseconds until the current cheer (and its echo tail) is over.
  function msUntilCelebrationEnds() {
    if (!outCtx || !celebrationEndsAt) return 0;
    return Math.max(0, (celebrationEndsAt + ECHO_TAIL_S - outCtx.currentTime) * 1000);
  }

  // Shared by the `celebrate` tool call and the transcript safety net below, so
  // the two paths can never double-fire for the same win. Returns how long (ms)
  // until the cheer has finished, so the tool call can hold the model until then.
  function fireCelebration(reason = "") {
    if (!outCtx) return 0;
    if (celebratedThisTurn) return msUntilCelebrationEnds();
    celebratedThisTurn = true;
    const startAt = scheduleCelebrationSound();
    // Confetti lands with the sound, not ahead of it.
    const burst = () => { celebrateReason.value = reason; celebrateAt.value = Date.now(); };
    const delayMs = (startAt - outCtx.currentTime) * 1000;
    if (delayMs > 250) burstTimers.push(setTimeout(burst, delayMs));
    else burst();
    return msUntilCelebrationEnds();
  }

  function fail(message) {
    error.value = message;
    state.value = "error";
    cleanup();
  }

  // ── Playback ───────────────────────────────────────────────────────────────
  function playChunk(b64) {
    if (!outCtx) return;
    const samples = base64ToFloat(b64);
    const buf = outCtx.createBuffer(1, samples.length, OUTPUT_RATE);
    buf.copyToChannel(samples, 0);
    const src = outCtx.createBufferSource();
    src.buffer = buf;
    src.connect(outCtx.destination);
    playHead = Math.max(playHead, outCtx.currentTime + 0.02);
    src.start(playHead);
    playHead += buf.duration;
    speaking.value = true;
    sources.add(src);
    src.onended = () => {
      sources.delete(src);
      if (!sources.size) speaking.value = false;
    };
  }

  // The child talked over Gemini: drop everything queued so it stops instantly.
  // A cheer already playing is left to finish, and new speech still queues after it.
  function interruptPlayback() {
    for (const s of sources) {
      try { s.stop(); } catch { /* already stopped */ }
    }
    sources.clear();
    playHead = celebrationEndsAt;
    speaking.value = false;
  }

  // ── Microphone ─────────────────────────────────────────────────────────────
  async function startMic() {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    micCtx = new AudioContext();
    const source = micCtx.createMediaStreamSource(micStream);
    const send = (float32) => {
      micLevel.value = rms(float32);
      // Don't feed the mic while muted (the child can still hear Gemini), nor
      // while the cheer plays: the model would hear it as the child.
      if (!session || muted.value || micGated()) return;
      session.sendRealtimeInput({
        audio: { data: micChunkToBase64(float32, micCtx.sampleRate), mimeType: "audio/pcm;rate=16000" },
      });
    };
    const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: "application/javascript" }));
    await micCtx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    micNode = new AudioWorkletNode(micCtx, "mic-tap");
    micNode.port.onmessage = (e) => send(e.data);
    source.connect(micNode); // not connected onward: no mic monitoring/echo
  }

  // ── Live messages ──────────────────────────────────────────────────────────
  async function onMessage(msg) {
    const sc = msg.serverContent;
    if (sc) {
      if (sc.interrupted) {
        interruptPlayback();
        guideBuffer = "";
      }
      for (const part of sc.modelTurn?.parts || []) {
        if (part.inlineData?.data) playChunk(part.inlineData.data);
      }
      if (sc.inputTranscription?.text) {
        turns.value = appendTranscript(turns.value, "child", sc.inputTranscription.text);
        // The child is speaking again — the buddy's next reply is a new turn,
        // and a new win can be celebrated.
        guideBuffer = "";
        celebratedThisTurn = false;
      }
      if (sc.outputTranscription?.text) {
        turns.value = appendTranscript(turns.value, "guide", sc.outputTranscription.text);
        // SAFETY NET: the model is told to call `celebrate` alongside praise like
        // "that's exactly right", but a real session showed it can say the praise
        // and skip the tool call. Its own transcribed speech already carries the
        // signal, so scan it too — capped and reset per turn (see declaration).
        guideBuffer = (guideBuffer + sc.outputTranscription.text).slice(-300);
        if (!celebratedThisTurn && looksLikeCelebration(guideBuffer)) fireCelebration("");
      }
    }
    if (msg.toolCall?.functionCalls?.length) {
      const asked = session; // a late reply must never reach a newer session
      const functionResponses = await Promise.all(
        msg.toolCall.functionCalls.map(async (fc) => {
          // Handled entirely on the device — no server round trip needed for a
          // confetti burst, so the celebration lands the instant the model asks.
          // The answer is held until the cheer has finished: the model waits for
          // a tool result, so it can't talk over the cheer or pile a second one on.
          if (fc.name === "celebrate") {
            const waitMs = fireCelebration(String(fc.args?.reason || ""));
            if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
            return { id: fc.id, name: fc.name, response: { result: {
              celebrated: true,
              note: "The cheer has finished playing. Carry on; don't celebrate this win again.",
            } } };
          }
          let result;
          try {
            result = await callExploreTool({ childId: activeChildId, name: fc.name, args: fc.args || {}, sessionId });
          } catch {
            result = { error: "That lookup didn't work; carry on without it." };
          }
          return { id: fc.id, name: fc.name, response: { result } };
        })
      );
      if (asked && session === asked) asked.sendToolResponse({ functionResponses });
    }
    if (msg.goAway) stop();
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  async function start({ childId, mode, focus = "" }) {
    if (state.value === "connecting" || state.value === "live") return;
    error.value = "";
    turns.value = [];
    closing = false;
    guideBuffer = "";
    celebratedThisTurn = false;
    celebrationEndsAt = 0;
    lastCelebrationSrc = "";
    state.value = "connecting";
    activeChildId = childId;
    // Browsers only let audio start from a user gesture, and that permission
    // lapses after a few seconds — so create + resume the playback context NOW,
    // synchronously in the click, before any network round trip.
    try {
      outCtx = new AudioContext({ sampleRate: OUTPUT_RATE });
      outCtx.resume().catch(() => {});
    } catch {
      return fail("This device can't play the buddy's voice.");
    }
    try {
      // Ask for the microphone FIRST: the permission prompt can take a while, and
      // the server's token only allows a short window to open the session.
      await startMic();

      const s = await startExploreSession({ childId, mode, focus });
      if (!s.configured) return fail(s.message || "Explore isn't set up yet.");
      sessionId = s.sessionId;
      childName.value = s.childName || "";
      loadCelebrationSounds(s.celebration); // in the background — the greeting needn't wait
      secondsLeft.value = (s.maxMinutes || 20) * 60;

      const ai = new GoogleGenAI({ apiKey: s.token, httpOptions: { apiVersion: "v1alpha" } });
      session = await withTimeout(ai.live.connect({
        model: s.model,
        config: s.config,
        callbacks: {
          onopen: () => {},
          onmessage: (m) => onMessage(m).catch(() => {}),
          onerror: (e) => fail(e?.message || "The connection dropped."),
          onclose: (e) => {
            if (closing) return;
            if (state.value === "live") stop();
            else if (state.value === "connecting") fail(e?.reason ? `The buddy couldn't connect: ${e.reason}` : "The buddy couldn't connect. Please try again.");
          },
        },
      }), 20000, "The buddy took too long to answer. Check your internet connection (a VPN or proxy can block live voice), then try again.");
      state.value = "live";
      // Kick off the first turn so the companion greets the child.
      const hello = "(The child has just arrived. Greet them warmly by name and begin.)";
      try { session.sendRealtimeInput({ text: hello }); } catch { session.sendClientContent({ turns: hello, turnComplete: true }); }

      timer = setInterval(() => {
        secondsLeft.value -= 1;
        if (secondsLeft.value <= 0) stop();
      }, 1000);
    } catch (e) {
      // Firebase reports a request that never reached the server (proxy/VPN/offline)
      // as a bare "internal" — say what it really means.
      const network = e?.code === "functions/internal" && (e?.message === "internal" || !navigator.onLine)
        || e?.code === "functions/unavailable" || e?.code === "functions/deadline-exceeded";
      if (network) {
        return fail("Can't reach the buddy's server. Please check your internet connection (and any VPN or proxy), then try again.");
      }
      const denied = e?.name === "NotAllowedError" || e?.name === "NotFoundError" || e?.name === "NotReadableError";
      const noMic = e?.name === "NotSupportedError" || !navigator.mediaDevices;
      fail(
        denied ? "Please allow the microphone so we can talk."
          : noMic ? "This device or browser can't use the microphone here."
          : e?.message || "Couldn't start."
      );
    }
  }

  function cleanup() {
    clearInterval(timer);
    timer = 0;
    burstTimers.forEach(clearTimeout);
    burstTimers = [];
    celebrationEndsAt = 0;
    interruptPlayback();
    try { micNode?.disconnect(); } catch { /* ignore */ }
    micStream?.getTracks().forEach((t) => t.stop());
    micCtx?.close().catch(() => {});
    outCtx?.close().catch(() => {});
    micNode = micStream = micCtx = outCtx = null;
    micLevel.value = 0;
    try { session?.close(); } catch { /* ignore */ }
    session = null;
  }

  async function stop() {
    if (closing) return;
    closing = true;
    const wasLive = state.value === "live";
    cleanup();
    if (wasLive) state.value = "ended";
    if (sessionId) {
      endExploreSession(sessionId, turns.value).catch(() => {});
      sessionId = "";
    }
  }

  function toggleMute() {
    muted.value = !muted.value;
  }

  function reset() {
    state.value = "idle";
    error.value = "";
    turns.value = [];
  }

  onBeforeUnmount(() => { if (!closing) stop(); });

  return {
    state, isLive, error, turns, micLevel, speaking, muted, secondsLeft, childName,
    celebrateAt, celebrateReason, start, stop, toggleMute, reset,
  };
}
