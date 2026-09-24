import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// A fake Live socket: captures the callbacks so the test can play server messages.
let callbacks;
const session = { sendRealtimeInput: vi.fn(), sendToolResponse: vi.fn(), sendClientContent: vi.fn(), close: vi.fn() };
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    constructor() { this.live = { connect: async (opts) => { callbacks = opts.callbacks; return session; } }; }
  },
}));

const startExploreSession = vi.fn();
const callExploreTool = vi.fn();
vi.mock("@/services/explore", () => ({
  startExploreSession: (...a) => startExploreSession(...a),
  callExploreTool: (...a) => callExploreTool(...a),
  endExploreSession: vi.fn(async () => {}),
}));

// Used outside a component here, so there's no unmount to hook.
vi.mock("vue", async (orig) => ({ ...(await orig()), onBeforeUnmount: () => {} }));

import { useLiveExplore } from "./useLiveExplore";

// Every sound the buddy plays goes through one of these buffer sources.
// `started` lists what played; `timeline` also records WHEN it was scheduled.
let started;
let timeline;
let contexts; // [0] is the buddy's playback context (created first, in the click)
let micNode;
const CLIP_SECONDS = 1.5;
class FakeAudioContext {
  constructor() {
    this.currentTime = 0; this.sampleRate = 24000; this.destination = {}; this.audioWorklet = { addModule: async () => {} };
    contexts.push(this);
  }
  resume() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
  createMediaStreamSource() { return { connect() {} }; }
  createBuffer() { return { duration: 0.1, copyToChannel() {} }; }
  async decodeAudioData(bytes) { return { decodedFrom: new TextDecoder().decode(bytes), duration: CLIP_SECONDS }; }
  createBufferSource() {
    const s = {
      connect() {}, stop() {}, buffer: null, onended: null,
      start: (at = 0) => { started.push(s.buffer); timeline.push({ at, kind: s.buffer.decodedFrom ? "cheer" : "voice" }); },
    };
    return s;
  }
  createOscillator() { started.push({ chimeNote: true }); return { connect() {}, start() {}, stop() {}, frequency: {} }; }
  createGain() { return { connect() {}, gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} } }; }
}

const flush = () => vi.advanceTimersByTimeAsync(0);
const voiceChunk = { serverContent: { modelTurn: { parts: [{ inlineData: { data: "AAAAAA==" } }] } } };
const celebrateCall = (id = "f1", args = {}) => ({ toolCall: { functionCalls: [{ id, name: "celebrate", args }] } });
// Runs a tool-call message to completion — the reply is held until the cheer ends.
async function toolCall(msg) {
  const done = callbacks.onmessage(msg);
  await vi.advanceTimersByTimeAsync(10_000);
  await done;
}

async function startSession(celebration) {
  startExploreSession.mockResolvedValue({
    configured: true, token: "t", model: "m", sessionId: "s1", childName: "Hadi", maxMinutes: 20, celebration, config: {},
  });
  const live = useLiveExplore();
  await live.start({ childId: "c1", mode: "learn" });
  await flush(); await flush(); // let the saved sounds load and decode
  return live;
}

describe("useLiveExplore — celebrating a win", () => {
  beforeEach(() => {
    started = [];
    timeline = [];
    contexts = [];
    callbacks = null;
    session.sendToolResponse.mockClear();
    session.sendRealtimeInput.mockClear();
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal("AudioWorkletNode", class { constructor() { this.port = {}; micNode = this; } connect() {} disconnect() {} });
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) }, onLine: true });
    URL.createObjectURL = () => "blob:x";
    URL.revokeObjectURL = () => {};
    // The "saved file" is its own path, so the test can see which recording played.
    vi.stubGlobal("fetch", async (src) => ({ arrayBuffer: async () => new TextEncoder().encode(src).buffer }));
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-09-24T10:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("a `celebrate` tool call plays the parent's chosen recording, signals the overlay and answers the model", async () => {
    const live = await startSession("clapping");
    expect(live.state.value).toBe("live");
    await toolCall(celebrateCall("f1", { reason: "spelled parents" }));

    expect(started).toContainEqual(expect.objectContaining({ decodedFrom: "/audio/celebrate/clapping.wav" }));
    expect(live.celebrateAt.value).toBeGreaterThan(0);
    expect(live.celebrateReason.value).toBe("spelled parents");
    // Answered on the device — the server tool endpoint is never called for it.
    expect(callExploreTool).not.toHaveBeenCalled();
    expect(session.sendToolResponse).toHaveBeenCalledWith({
      functionResponses: [{ id: "f1", name: "celebrate", response: { result: expect.objectContaining({ celebrated: true }) } }],
    });
  });

  it("each child gets their own sound: Masha'Allah for one choice, silence for 'none'", async () => {
    const a = await startSession("mashallah");
    await toolCall(celebrateCall("f1"));
    expect(started).toContainEqual(expect.objectContaining({ decodedFrom: "/audio/celebrate/mashallah.wav" }));
    a.stop();

    started = [];
    const b = await startSession("none");
    await toolCall(celebrateCall("f2"));
    expect(started).toEqual([]); // no sound…
    expect(b.celebrateAt.value).toBeGreaterThan(0); // …but the confetti and balloons still come
  });

  it("praise without a tool call still celebrates (safety net), and one win never celebrates twice", async () => {
    const live = await startSession("mashallah_clap");
    callbacks.onmessage({ serverContent: { outputTranscription: { text: "That is exactly right, Abdul Hadi!" } } });
    expect(started).toContainEqual(expect.objectContaining({ decodedFrom: "/audio/celebrate/mashallah-clap.wav" }));
    const first = live.celebrateAt.value;
    expect(first).toBeGreaterThan(0);

    // The model ALSO calls the tool for the same moment → no second burst.
    await toolCall(celebrateCall("f1"));
    expect(started).toHaveLength(1);
    expect(live.celebrateAt.value).toBe(first);

    // The next win, a few seconds later, celebrates again.
    vi.setSystemTime(new Date("2026-09-24T10:00:05Z"));
    contexts[0].currentTime = 5; // the first cheer has finished playing
    callbacks.onmessage({ serverContent: { inputTranscription: { text: "a b l u" } } });
    callbacks.onmessage({ serverContent: { outputTranscription: { text: "You did it!" } } });
    expect(started).toHaveLength(2);
    expect(live.celebrateAt.value).toBeGreaterThan(first);
  });

  it("a correction is never celebrated", async () => {
    const live = await startSession("clapping");
    callbacks.onmessage({ serverContent: { outputTranscription: { text: "Close! That's not quite right — let's try again." } } });
    expect(started).toEqual([]);
    expect(live.celebrateAt.value).toBe(0);
  });

  it("falls back to the chime if a saved recording can't be loaded", async () => {
    vi.stubGlobal("fetch", async () => { throw new Error("offline"); });
    await startSession("clapping");
    await toolCall(celebrateCall("f1"));
    expect(started.some((s) => s.chimeNote)).toBe(true);
  });

  it("the cheer waits for the praise already queued, and the buddy's next words wait for the cheer", async () => {
    await startSession("clapping");
    callbacks.onmessage(voiceChunk); // "That's exactly right!" is already queued to play
    const praiseEnds = 0.02 + 0.1;
    const reply = callbacks.onmessage(celebrateCall("f1"));
    await flush();
    callbacks.onmessage(voiceChunk); // the buddy carries on talking
    await vi.advanceTimersByTimeAsync(10_000);
    await reply;

    const [praise, cheer, next] = timeline;
    expect(praise.kind).toBe("voice");
    expect(cheer.kind).toBe("cheer");
    expect(cheer.at).toBeCloseTo(praiseEnds);
    expect(next.kind).toBe("voice");
    expect(next.at).toBeGreaterThanOrEqual(cheer.at + CLIP_SECONDS);
  });

  it("holds the model's tool answer until the cheer has finished playing", async () => {
    await startSession("clapping");
    const reply = callbacks.onmessage(celebrateCall("f1"));
    await vi.advanceTimersByTimeAsync(CLIP_SECONDS * 1000 - 100);
    expect(session.sendToolResponse).not.toHaveBeenCalled(); // still cheering — the model must wait
    await vi.advanceTimersByTimeAsync(2000);
    await reply;
    expect(session.sendToolResponse).toHaveBeenCalledTimes(1);
  });

  it("the mic isn't forwarded while the cheer plays, so the model never hears it as the child", async () => {
    await startSession("mashallah_clap");
    const out = contexts[0];
    const frame = new Float32Array(480).fill(0.1);
    micNode.port.onmessage({ data: frame });
    expect(session.sendRealtimeInput).toHaveBeenCalledTimes(1);

    const reply = callbacks.onmessage(celebrateCall("f1"));
    session.sendRealtimeInput.mockClear();
    out.currentTime = 0.8; // mid-cheer
    micNode.port.onmessage({ data: frame });
    expect(session.sendRealtimeInput).not.toHaveBeenCalled();

    out.currentTime = 5; // cheer (and its echo tail) long over
    micNode.port.onmessage({ data: frame });
    expect(session.sendRealtimeInput).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    await reply;
  });

  it("one win cheers once, however many times the model praises or calls the tool before the child speaks", async () => {
    await startSession("cheer");
    callbacks.onmessage({ serverContent: { outputTranscription: { text: "Well done!" } } });
    await toolCall(celebrateCall("f1"));
    vi.setSystemTime(new Date("2026-09-24T10:00:10Z")); // long after — a timer alone would let this through
    callbacks.onmessage({ serverContent: { outputTranscription: { text: " You did it! Great job!" } } });
    await toolCall(celebrateCall("f2"));
    expect(started.filter((b) => b.decodedFrom)).toHaveLength(1);
    // Both tool calls are still answered, so the model isn't left hanging.
    expect(session.sendToolResponse).toHaveBeenCalledTimes(2);
  });

  it("the child interrupting the buddy doesn't cut the cheer or let new speech overlap it", async () => {
    await startSession("clapping");
    const reply = callbacks.onmessage(celebrateCall("f1"));
    await flush();
    callbacks.onmessage({ serverContent: { interrupted: true } });
    callbacks.onmessage(voiceChunk);
    const cheer = timeline.find((t) => t.kind === "cheer");
    const next = timeline.filter((t) => t.kind === "voice").pop();
    expect(next.at).toBeGreaterThanOrEqual(cheer.at + CLIP_SECONDS);
    await vi.advanceTimersByTimeAsync(10_000);
    await reply;
  });
});
