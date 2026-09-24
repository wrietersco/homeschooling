<!-- Phonics Playground — a full-screen, free-play sound-building game.
     Any signed-in child can use it; no curriculum assignment is involved.

     How it fits together:
     • Right vertical panel: cute A–Z alphabet blocks. Tap = hear the sound;
       drag onto the canvas = drop a block.
     • Spacebar: a blobby key at the bottom. Tap it (mobile) or press the
       physical Space key (keyboard) to append ONE empty space block to the
       row being built — the next block dropped at the row's end attaches
       after it, so children compose phrases ("cat[ ]sat"). Its ONLY job is
       making spaces; speaking belongs to the golden speakers.
     • Golden speakers: the bubble on a joined row speaks that row (phrase
       included); the big golden speaker in the top bar reads EVERYTHING on
       the canvas like a sentence. Either way each segment is spoken as its
       dictionary word or — for nonsense builds — as its sound-formed
       respelling (x+qu is heard as "kskw"), so children learn what their
       combined letters sound like even when they don't make a real word.
     • Canvas: an ENDLESS plane of sky — drag any empty part of it (or scroll
       the mouse wheel) to pan around; the compass button re-centres the view
       on the blocks. Blocks snap to nearby blocks, and the joined row
       instantly plays its sounds in sequence ("c…a…t") so the child hears how
       combined sounds form. Real words are celebrated with confetti.
     • Audio: bundled "pure sound" recordings per phoneme (/audio/phonics,
       MIT-licensed — see ATTRIBUTION.md there). TTS speaks the blended word.
       The word-voice picker lists every Gemini voice from the shared TTS voice
       catalog (badged "Gemini") alongside installed device voices ("Device");
       "auto" is the Leda teacher voice that matches the phoneme clips, and a
       notice explains when the AI voice falls back to the device voice (e.g.
       the daily AI-voice budget being reached).
     • Portrait phones are gated behind a friendly "rotate your device"
       prompt, with a fullscreen + landscape-lock shortcut where the browser
       allows it (Android Chrome; iOS only supports manual rotation).

     Dragging uses Pointer Events (mouse + touch) rather than HTML5 DnD, with
     `touch-action` set per surface so scrolling and drag-to-canvas never
     fight. -->
<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useSpeech } from "@/composables/useSpeech";
import { getTtsVoiceCatalog } from "@/services/tts";
import { rowSpeech, unitsForIds } from "@/lib/phonicsRules";
import {
  GEMINI_TEACHER_VOICE,
  geminiVoicePref,
  isGeminiVoicePref,
  resolveWordVoice,
} from "@/lib/wordVoicePrefs";
import {
  ALPHA_BLOCKS,
  CLIP_BASE,
  SPACE_ID,
  SOUNDS,
  SOUND_BY_ID,
  colorFor,
} from "@/lib/phonicsData";
import { loadCanvas, saveCanvas } from "@/lib/phonicsSave";
import { useAuthStore } from "@/stores/auth";

const router = useRouter();
const auth = useAuthStore();
// lastError carries the most recent TTS failure (e.g. the daily AI-voice budget
// being reached) so the settings panel can explain a silent voice fallback.
const { speak, stop: stopSpeech, lastError } = useSpeech();

/* ── Voice-fallback toast ───────────────────────────────────────────────── */
// When the AI voice can't play (daily budget reached, offline, …) the shared
// pipeline silently swaps in the device voice — without this toast the child
// just hears "the voice didn't change" and the parent can't tell why.
const voiceToast = ref("");
let voiceToastTimer = 0;
watch(lastError, (err) => {
  if (!err) return;
  voiceToast.value = /daily limit/i.test(String(err))
    ? "AI voices are used up for today — the device voice is filling in."
    : "AI voice unavailable right now — the device voice is filling in.";
  clearTimeout(voiceToastTimer);
  voiceToastTimer = setTimeout(() => (voiceToast.value = ""), 4500);
});

/* ── Audio: bundled phoneme clips ───────────────────────────────────────── */
let seqToken = 0; // bumped to cancel a running "joined sounds" chain
const activePulse = ref(null); // { key, idxs } — tiles currently sounding as one unit

function clipUrl(id) {
  return CLIP_BASE + SOUND_BY_ID[id].clip + ".m4a";
}

function preloadClips() {
  for (const s of SOUNDS) {
    const a = new Audio(clipUrl(s.id));
    a.preload = "auto";
    a.load();
  }
}

function playOne(id) {
  if (id === SPACE_ID) return; // a space is silence, not a sound
  stopSeq();
  const a = new Audio(clipUrl(id));
  a.play().catch(() => {});
}

function stopSeq() {
  seqToken += 1;
  activePulse.value = null;
}

// Play pronunciation UNITS in order with a small gap — this is the "joined
// sound" a child hears the moment blocks snap together. Units come from the
// phonicsRules engine, so merged sounds (c+h → "ch") play as ONE clip and all
// of the unit's tiles light up together, showing which blocks joined.
function playSeq(units, { gap = 220, onEach = null, onDone = null } = {}) {
  stopSeq();
  const my = seqToken;
  let i = 0;
  const step = () => {
    if (my !== seqToken) return;
    if (i >= units.length) {
      if (onDone) onDone();
      return;
    }
    const unit = units[i++];
    if (onEach) onEach(unit);
    const a = new Audio(clipUrl(unit.clip));
    let advanced = false;
    const next = () => {
      if (advanced || my !== seqToken) return;
      advanced = true;
      setTimeout(step, gap);
    };
    a.onended = next;
    a.onerror = next;
    a.play().catch(next);
  };
  step();
}

/* ── Word voice (cog menu) ──────────────────────────────────────────────── */
// The whole-word voice is the child's/parent's choice: "auto" uses the online
// Gemini teacher voice (Leda + the "vocab" tone), which matches the female
// voice of the bundled phoneme recordings; any other Gemini voice from the
// shared TTS voice catalog, or an installed device voice, can be picked
// instead. Choice persists in localStorage.
const WORD_VOICE_KEY = "phonics-word-voice";
const wordVoicePref = ref("auto");
const systemVoices = ref([]);
const settingsOpen = ref(false);

// Extra Gemini voices come from the shared TTS voice catalog (module-cached in
// the service — one round trip per session). Unconfigured/offline just leaves
// the list empty: Auto (still Gemini Leda) and device voices keep working.
const geminiVoices = ref([]);
const geminiVoicesLoading = ref(true);
const extraGeminiVoices = computed(() => geminiVoices.value.filter((v) => v !== GEMINI_TEACHER_VOICE));

try {
  wordVoicePref.value = localStorage.getItem(WORD_VOICE_KEY) || "auto";
} catch {
  /* private mode — just don't persist */
}

function loadGeminiVoices() {
  getTtsVoiceCatalog()
    .then((catalog) => {
      const g = catalog?.providers?.gemini;
      geminiVoices.value = g?.available ? g.voices || [] : [];
    })
    .catch(() => {}) // offline / unconfigured — Auto still works
    .finally(() => {
      geminiVoicesLoading.value = false;
      // A stored Gemini pick that can't be served anymore falls back to Auto.
      if (isGeminiVoicePref(wordVoicePref.value) && !geminiVoices.value.length) {
        wordVoicePref.value = "auto";
        try {
          localStorage.setItem(WORD_VOICE_KEY, "auto");
        } catch {
          /* ignore */
        }
      }
    });
}

function refreshSystemVoices() {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  systemVoices.value = window.speechSynthesis.getVoices() || [];
}

const sortedSystemVoices = computed(() =>
  [...systemVoices.value].sort((a, b) => {
    const en = (v) => (v.lang?.toLowerCase().startsWith("en") ? 0 : 1);
    return en(a) - en(b) || (a.name || "").localeCompare(b.name || "");
  }),
);

function setWordVoice(uri) {
  wordVoicePref.value = uri;
  try {
    localStorage.setItem(WORD_VOICE_KEY, uri);
  } catch {
    /* ignore */
  }
  // Instant sample so the choice is easy to hear.
  speakWord("cat", "pp-sample");
}

// Speak a whole word with the chosen voice: a picked device voice plays
// directly through speechSynthesis; "auto" or a picked Gemini voice goes
// through the shared TTS pipeline. The provider is pinned to "gemini" so the
// pick is honored even if the platform's configured TTS provider differs
// (without it the server coerces the voice name onto its configured provider).
function speakWord(text, id) {
  stopSpeech();
  const pick = resolveWordVoice(wordVoicePref.value, systemVoices.value);
  if (pick.kind === "device" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.voice = pick.voice;
    u.lang = pick.voice.lang;
    u.rate = 0.75;
    window.speechSynthesis.speak(u);
    return;
  }
  speak(text, "en", {
    rate: 0.75,
    voiceName: pick.kind === "gemini" ? pick.voiceName : GEMINI_TEACHER_VOICE,
    provider: "gemini",
    contentKind: "vocab",
    id,
  });
}

/* ── Landscape gate (portrait phones) ───────────────────────────────────── */
// A page can't force the device orientation; the closest is requesting
// fullscreen and then locking to landscape, which Android Chrome allows from
// a user gesture. Where neither exists (iOS Safari), the rotate prompt simply
// asks the child to turn the device — the game stays gated until they do.
const canAutoLandscape =
  typeof document !== "undefined" &&
  (typeof document.documentElement.requestFullscreen === "function" ||
    typeof window.screen?.orientation?.lock === "function");

async function enterLandscape() {
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen();
    }
    if (window.screen?.orientation?.lock) await window.screen.orientation.lock("landscape");
  } catch {
    /* refused or unsupported — manual rotation still unlocks the game */
  }
}

/* ── Canvas state ───────────────────────────────────────────────────────── */
// A "group" is one row on the canvas: 1 tile = a lone block, N tiles = a
// joined word-in-progress. soundIds are ordered left → right.
const groups = ref([]);
let groupSeq = 0;
const wordsBuilt = ref(0);

// Measure the CSS-var tile size (clamp() resolves to px here).
const tileProbe = ref(null);
const tileW = () => (tileProbe.value ? tileProbe.value.offsetWidth : 70);

const canvasEl = ref(null);
const trashEl = ref(null);

/* ── Infinite canvas pan ────────────────────────────────────────────────── */
// The canvas is an endless plane: blocks live at fixed "world" coordinates
// and the viewport pans across them. Dragging empty sky (or the mouse wheel)
// moves the viewport; nothing is ever clamped back inside the screen. The
// compass button flies the view back to the blocks so nothing gets lost.
const pan = ref({ x: 0, y: 0 });
const panning = ref(false);
let panGesture = null; // { pointerId, startX, startY, panX, panY }

function onCanvasDown(e) {
  if (e.button !== undefined && e.button !== 0) return;
  panGesture = {
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    panX: pan.value.x,
    panY: pan.value.y,
  };
  window.addEventListener("pointermove", onPanMove, { passive: false });
  window.addEventListener("pointerup", onPanUp);
  window.addEventListener("pointercancel", onPanUp);
}

function onPanMove(e) {
  const g = panGesture;
  if (!g || e.pointerId !== g.pointerId) return;
  e.preventDefault();
  const dx = e.clientX - g.startX;
  const dy = e.clientY - g.startY;
  if (!panning.value && Math.hypot(dx, dy) > 4) panning.value = true;
  if (!panning.value) return;
  pan.value = { x: g.panX + dx, y: g.panY + dy };
}

function onPanUp(e) {
  if (panGesture && e.pointerId !== undefined && e.pointerId !== panGesture.pointerId) return;
  panGesture = null;
  panning.value = false;
  releasePanListeners();
}

function releasePanListeners() {
  window.removeEventListener("pointermove", onPanMove);
  window.removeEventListener("pointerup", onPanUp);
  window.removeEventListener("pointercancel", onPanUp);
}

function onWheelPan(e) {
  pan.value = { x: pan.value.x - e.deltaX, y: pan.value.y - e.deltaY };
}

// Centre the viewport on the blocks (or return to the origin when empty).
function recenter() {
  const el = canvasEl.value;
  if (!el || !groups.value.length) {
    pan.value = { x: 0, y: 0 };
    return;
  }
  const size = tileW();
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const g of groups.value) {
    minX = Math.min(minX, g.x);
    maxX = Math.max(maxX, g.x + g.soundIds.length * size);
    minY = Math.min(minY, g.y);
    maxY = Math.max(maxY, g.y + size);
  }
  // A world point w renders at w + pan, so pan = viewportCentre - contentCentre.
  pan.value = {
    x: (el.clientWidth - (minX + maxX)) / 2,
    y: (el.clientHeight - (minY + maxY)) / 2,
  };
}

/* ── Drag engine (Pointer Events) ───────────────────────────────────────── */
// drag is either:
//  • mode "ghost" — a chip/block lifted off a panel, not yet on the canvas
//  • mode "row"   — a canvas row being carried (fromIndex -1) or one tile
//                   extracted out of a joined row (fromIndex ≥ 0; the origin
//                   row keeps its remaining tiles and can be re-snap-joined)
const drag = ref(null);

function startDrag(e, payload) {
  if (e.button !== undefined && e.button !== 0) return;
  stopSeq();
  stopSpeech();
  drag.value = {
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    clientX: e.clientX,
    clientY: e.clientY,
    moved: false,
    overCanvas: false,
    overTrash: false,
    snap: null,
    ...payload,
  };
  window.addEventListener("pointermove", onDragMove, { passive: false });
  window.addEventListener("pointerup", onDragUp);
  window.addEventListener("pointercancel", onDragCancel);
}

function onDragMove(e) {
  const d = drag.value;
  if (!d || e.pointerId !== d.pointerId) return;
  e.preventDefault();
  if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 6) d.moved = true;
  if (!d.moved) return;
  d.clientX = e.clientX;
  d.clientY = e.clientY;

  const r = canvasEl.value.getBoundingClientRect();
  const size = tileW();
  const w = d.soundIds.length * size;
  const px = e.clientX - r.left;
  const py = e.clientY - r.top;
  d.overCanvas = px > -size * 0.4 && py > -size * 0.4 && px < r.width + size * 0.4 && py < r.height + size * 0.4;
  // World-space position under the pointer (viewport coords minus the pan).
  const wx = px - pan.value.x;
  const wy = py - pan.value.y;
  d.x = wx - w / 2;
  d.y = wy - size / 2;
  d.pointerCanvasX = wx;
  d.w = w;

  const t = trashEl.value ? trashEl.value.getBoundingClientRect() : null;
  d.overTrash = !!t && e.clientX >= t.left && e.clientX <= t.right && e.clientY >= t.top && e.clientY <= t.bottom;
  d.snap = d.overTrash ? null : findSnap(d, r);
}

// Nearest joined neighbour the carried row would snap to. The pointer must be
// just outside the row's horizontal span (or over it) and vertically aligned.
function findSnap(d, canvasRect) {
  const size = tileW();
  const SNAP = size * 0.95;
  let best = null;
  for (const g of groups.value) {
    if (d.fromGroupKey === g.key && d.fromIndex === -1) continue; // carrying itself
    const gy = g.y;
    if (Math.abs(d.y - gy) > size * 0.7) continue;
    const gx = g.x;
    const gw = g.soundIds.length * size;
    const withinX = d.pointerCanvasX > gx - SNAP && d.pointerCanvasX < gx + gw + SNAP;
    if (!withinX) continue;
    const side = d.pointerCanvasX < gx + gw / 2 ? "left" : "right";
    const dist = side === "left" ? Math.abs(d.pointerCanvasX - gx) : Math.abs(d.pointerCanvasX - (gx + gw));
    if (!best || dist < best.dist) best = { key: g.key, side, dist };
  }
  return best ? { key: best.key, side: best.side } : null;
}

function onDragUp(e) {
  const d = drag.value;
  if (!d || e.pointerId !== d.pointerId) return;
  releaseListeners();
  drag.value = null;
  if (!d.moved) {
    handleTap(d);
    return;
  }
  if (d.overTrash) {
    commitRemove(d);
    return;
  }
  if (!d.overCanvas) {
    // Released over a panel / outside — ghost lifts vanish; extracted tiles
    // simply stay where they were (the origin row never lost them).
    return;
  }
  if (d.snap) commitMerge(d);
  else commitPlace(d);
}

function onDragCancel() {
  drag.value = null;
  releaseListeners();
}

function releaseListeners() {
  window.removeEventListener("pointermove", onDragMove);
  window.removeEventListener("pointerup", onDragUp);
  window.removeEventListener("pointercancel", onDragCancel);
}

// Taps (no drag): canvas tiles + alphabet blocks play their sound.
function handleTap(d) {
  if (d.tap === "block") playOne(d.soundIds[0]);
  else if (d.tap === "tile") playOne(d.soundIds[0]);
}

function commitRemove(d) {
  if (d.fromGroupKey) {
    const g = groups.value.find((x) => x.key === d.fromGroupKey);
    if (!g) return;
    if (d.fromIndex === -1) groups.value = groups.value.filter((x) => x.key !== g.key);
    else {
      g.soundIds.splice(d.fromIndex, 1);
      if (!g.soundIds.length) groups.value = groups.value.filter((x) => x.key !== g.key);
    }
  }
}

function commitPlace(d) {
  if (d.fromGroupKey && d.fromIndex === -1) {
    const g = groups.value.find((x) => x.key === d.fromGroupKey);
    if (g) {
      Object.assign(g, { x: d.x, y: d.y });
      markActiveRow(g.key);
    }
    return;
  }
  if (d.fromGroupKey) {
    const g = groups.value.find((x) => x.key === d.fromGroupKey);
    if (g) g.soundIds.splice(d.fromIndex, 1);
    if (g && !g.soundIds.length) groups.value = groups.value.filter((x) => x.key !== g.key);
  }
  const key = ++groupSeq;
  groups.value.push({ key, x: d.x, y: d.y, soundIds: [...d.soundIds] });
  markActiveRow(key);
}

function commitMerge(d) {
  const target = groups.value.find((x) => x.key === d.snap.key);
  if (!target) {
    commitPlace(d);
    return;
  }
  const size = tileW();
  // The word grows from where its first letter sits — existing blocks never
  // move. Appending leaves the row's origin untouched (the row extends
  // rightward); prepending shifts the origin left by one tile so the new
  // sound slots in just before the first letter.
  if (d.snap.side === "left") {
    target.soundIds.unshift(...d.soundIds);
    target.x -= d.soundIds.length * size;
  } else {
    target.soundIds.push(...d.soundIds);
  }

  // Take the carried tile(s) out of wherever they came from.
  if (d.fromGroupKey && d.fromIndex === -1) {
    groups.value = groups.value.filter((x) => x.key !== d.fromGroupKey);
  } else if (d.fromGroupKey) {
    const from = groups.value.find((x) => x.key === d.fromGroupKey);
    if (from) {
      from.soundIds.splice(d.fromIndex, 1);
      if (!from.soundIds.length) groups.value = groups.value.filter((x) => x.key !== from.key);
    }
  }
  markActiveRow(target.key);

  playJoined(target.key, target.soundIds);
}

/* ── Joined-sound playback, blending & celebration ──────────────────────── */
const banner = ref(""); // celebration word shown in the middle of the canvas
const confetti = ref([]); // flying paper bits: { key, x, y, tx, ty, rot, color }
let bannerTimer = 0;

// Snap/blend a row: the phonicsRules engine groups the tiles into
// pronunciation UNITS (c+h → "ch", magic-e, vowel teams, …) and those play in
// sequence — so the child hears how combined sounds form, with merged tiles
// highlighted together. Space blocks split the row into phrase segments, each
// pronounced with its own rules. Then the row is SPOKEN: each segment as its
// dictionary word, or — for nonsense builds — as its sound-formed respelling
// (x+qu is heard as "kskw"), so the child learns what their combined letters
// sound like even when they don't make a real word. Explicit blends (the
// golden speaker) speak the entire phrase. Real words are celebrated.
function playJoined(key, ids, { forceWord = false } = {}) {
  const { text, realWords } = rowSpeech(ids);
  const units = unitsForIds(ids).filter((u) => !u.silent);
  playSeq(units, {
    gap: forceWord ? 110 : 220,
    onEach: (unit) => (activePulse.value = { key, idxs: unit.tileIdxs }),
    onDone: () => {
      activePulse.value = null;
      if (!text && !forceWord) return;
      speakWord(text, `pp-${key}`);
      if (realWords > 0) {
        wordsBuilt.value += realWords;
        showBanner(text);
        burstConfetti(key, ids.length);
      }
    },
  });
}

function showBanner(word) {
  banner.value = word;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => (banner.value = ""), 2200);
}

function burstConfetti(key, n) {
  const size = tileW();
  const g = groups.value.find((x) => x.key === key);
  if (!g) return;
  const cx = g.x + (n * size) / 2;
  const cy = g.y + size / 2;
  const colors = ["#FF8FB1", "#FFB25A", "#FFE45C", "#7FE3A6", "#6FD3FF", "#C39BFF", "#FF9D7A", "#6FE3D2"];
  const bits = Array.from({ length: 26 }, (_, i) => {
    const ang = (Math.PI * 2 * i) / 26 + Math.random();
    const dist = 90 + Math.random() * 130;
    return {
      key: `${key}-${i}-${Date.now()}`,
      x: cx,
      y: cy,
      tx: Math.cos(ang) * dist,
      ty: Math.sin(ang) * dist - 40,
      rot: (Math.random() * 720 - 360).toFixed(0) + "deg",
      color: colors[i % colors.length],
      dur: 0.8 + Math.random() * 0.5,
    };
  });
  confetti.value = bits;
  setTimeout(() => (confetti.value = []), 1500);
}

function clearAll() {
  stopSeq();
  stopSpeech();
  groups.value = [];
}

/* ── Panel helpers ──────────────────────────────────────────────────────── */
// Dragging an alphabet block drops its primary single-letter sound; q drops
// "qu" (q is always taught with u).
function soundIdForLetter(letter) {
  const direct = SOUNDS.find((s) => s.letters === letter);
  return direct ? direct.id : "qu";
}

function onBlockDown(e, letter) {
  startDrag(e, { mode: "ghost", soundIds: [soundIdForLetter(letter)], letter, tap: "block" });
}
function onRowDown(e, g) {
  markActiveRow(g.key); // the spacebar targets the row the child is touching
  const tile = e.target.closest("[data-idx]");
  const idx = tile ? Number(tile.dataset.idx) : 0;
  if (g.soundIds.length === 1) {
    startDrag(e, { mode: "row", fromGroupKey: g.key, fromIndex: -1, soundIds: [...g.soundIds], tap: "tile" });
  } else {
    // Lift one tile out of the joined row — it stays available to re-snap.
    startDrag(e, { mode: "row", fromGroupKey: g.key, fromIndex: idx, soundIds: [g.soundIds[idx]], tap: "tile" });
  }
}

const blocksScroller = ref(null);
function slideBlocks(dir) {
  const el = blocksScroller.value;
  if (!el) return;
  el.scrollBy({ top: el.clientHeight * 0.7 * dir, behavior: "smooth" });
}

/* ── Spacebar & the big speaker ─────────────────────────────────────────── */
// The spacebar's ONE job is making phrases: it appends a single empty space
// block to the active row (the last row the child pressed or grew), and any
// block dropped at the row's end attaches after it — "cat[ ]sat". Speaking is
// NOT the spacebar's job (that would confuse its purpose): the golden speaker
// on each row speaks that phrase, and the big golden speaker up top speaks
// everything on the canvas.
const activeRowKey = ref(null);
const spaceAddedPulse = ref(false);
let spacePulseTimer = 0;

function markActiveRow(key) {
  activeRowKey.value = key;
}

// Append ONE space block; never stacks (a row already ending in a space is
// left alone until a block attaches to it).
function addSpace() {
  const g = groups.value.find((x) => x.key === activeRowKey.value);
  if (!g || g.soundIds[g.soundIds.length - 1] === SPACE_ID) return;
  g.soundIds.push(SPACE_ID);
  spaceAddedPulse.value = true;
  clearTimeout(spacePulseTimer);
  spacePulseTimer = setTimeout(() => (spaceAddedPulse.value = false), 600);
}

function onSpaceKey(e) {
  if (e.code !== "Space" || e.repeat) return;
  // Leave Space alone on form controls and inside the voice settings panel so
  // they keep working.
  const el = e.target;
  if (el?.closest?.("input, select, textarea, [contenteditable='true'], .pp-settings")) return;
  e.preventDefault(); // no page scroll; also stops the focused button re-firing
  addSpace();
}

// The big golden speaker: read the WHOLE canvas like a sentence — rows in
// reading order (top-to-bottom, left-to-right), phrases included.
const speakAllPulse = ref(false);
let speakAllTimer = 0;

function speakAll() {
  stopSeq();
  stopSpeech();
  const rows = [...groups.value].sort((a, b) => a.y - b.y || a.x - b.x);
  const text = rows.map((g) => rowSpeech(g.soundIds).text).filter(Boolean).join(". ");
  if (!text) return;
  speakAllPulse.value = true;
  clearTimeout(speakAllTimer);
  speakAllTimer = setTimeout(() => (speakAllPulse.value = false), 1600);
  speakWord(text, "pp-speak-all");
}

/* ── Save state ─────────────────────────────────────────────────────────── */
// The canvas survives leaving the page (navigation, reload, closing the tab):
// blocks, score, pan and the spacebar's target row are restored per child.
const saveUid = auth.user?.uid;
const saved = loadCanvas(saveUid);
if (saved) {
  groups.value = saved.groups;
  groupSeq = saved.groupSeq;
  wordsBuilt.value = saved.wordsBuilt;
  pan.value = saved.pan;
  activeRowKey.value = saved.activeRowKey;
}

function persist() {
  saveCanvas(saveUid, {
    groups: groups.value,
    wordsBuilt: wordsBuilt.value,
    pan: pan.value,
    activeRowKey: activeRowKey.value,
  });
}
watch([groups, wordsBuilt, pan, activeRowKey], persist, { deep: true });

/* ── Lifecycle ──────────────────────────────────────────────────────────── */
onMounted(() => {
  preloadClips();
  refreshSystemVoices();
  loadGeminiVoices();
  window.addEventListener("keydown", onSpaceKey);
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.onvoiceschanged = refreshSystemVoices;
  }
});
onBeforeUnmount(() => {
  persist();
  releaseListeners();
  releasePanListeners();
  window.removeEventListener("keydown", onSpaceKey);
  stopSeq();
  stopSpeech();
  clearTimeout(bannerTimer);
  clearTimeout(spacePulseTimer);
  clearTimeout(speakAllTimer);
  clearTimeout(voiceToastTimer);
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.onvoiceschanged = null;
  }
});
</script>

<template>
  <div class="pp-root" @contextmenu.prevent>
    <!-- Sky decorations -->
    <svg class="pp-sun" viewBox="0 0 100 100" aria-hidden="true">
      <g class="pp-sun-rays">
        <path
          v-for="i in 12"
          :key="i"
          d="M50 2 L54 14 L46 14 Z"
          fill="#FFD93D"
          :transform="`rotate(${(i - 1) * 30} 50 50)`"
        />
      </g>
      <circle cx="50" cy="50" r="26" fill="#FFE45C" />
      <circle cx="42" cy="46" r="3.4" fill="#7A5A00" />
      <circle cx="58" cy="46" r="3.4" fill="#7A5A00" />
      <path d="M41 56 Q50 64 59 56" stroke="#7A5A00" stroke-width="3" fill="none" stroke-linecap="round" />
    </svg>
    <svg v-for="c in 3" :key="c" class="pp-cloud" :class="`pp-cloud-${c}`" viewBox="0 0 140 60" aria-hidden="true">
      <g fill="#fff" opacity="0.85">
        <ellipse cx="45" cy="40" rx="38" ry="18" />
        <ellipse cx="80" cy="30" rx="30" ry="20" />
        <ellipse cx="105" cy="42" rx="26" ry="14" />
      </g>
    </svg>

    <!-- Floating top bar -->
    <header class="pp-topbar">
      <button class="pp-round-btn" type="button" title="Back to dashboard" @click="router.push({ name: 'dashboard' })">
        <span class="material-symbols-rounded">home</span>
      </button>
      <h1 class="pp-title">
        <svg viewBox="0 0 40 40" class="pp-title-bubble" aria-hidden="true">
          <circle cx="20" cy="20" r="17" fill="#FF8FB1" />
          <ellipse cx="14" cy="13" rx="6" ry="3.4" fill="#fff" opacity="0.6" />
          <text x="20" y="27" text-anchor="middle" font-size="18" font-weight="800" fill="#fff">a</text>
        </svg>
        Sound Splash
      </h1>
      <!-- Big golden speaker: reads EVERYTHING on the canvas, phrases included.
           Kept distinct from the spacebar — that key only makes spaces. -->
      <button
        class="pp-speak-all"
        :class="{ speaking: speakAllPulse }"
        type="button"
        title="Say everything on the canvas"
        aria-label="Say everything on the canvas"
        @click="speakAll"
      >
        <span class="material-symbols-rounded">campaign</span>
      </button>
      <div class="pp-score" title="Words built">
        <span class="material-symbols-rounded">emoji_events</span>
        {{ wordsBuilt }}
      </div>
      <button class="pp-round-btn pp-recenter" type="button" title="Find my blocks" @click="recenter">
        <span class="material-symbols-rounded">center_focus_strong</span>
      </button>
      <button
        class="pp-round-btn"
        :class="{ 'pp-cog-active': settingsOpen }"
        type="button"
        title="Word voice settings"
        aria-label="Word voice settings"
        @click="settingsOpen = !settingsOpen"
      >
        <span class="material-symbols-rounded">settings</span>
      </button>
      <button class="pp-round-btn pp-clear" type="button" title="Clear the canvas" @click="clearAll">
        <span class="material-symbols-rounded">mop</span>
      </button>
    </header>

    <!-- Word voice settings -->
    <transition name="pp-fade">
      <div v-if="settingsOpen" class="pp-settings">
        <div class="pp-settings-head">
          <span class="material-symbols-rounded">record_voice_over</span>
          <strong>Word voice</strong>
          <button class="pp-round-btn small" type="button" title="Close" @click="settingsOpen = false">
            <span class="material-symbols-rounded">close</span>
          </button>
        </div>
        <p class="pp-settings-sub">
          The voice that reads whole words aloud. Letter sounds always use the built-in recordings.
          <b>Gemini</b> = online AI voice · <b>Device</b> = installed on this device, works offline.
        </p>        <div class="pp-voice-list">
          <div class="pp-voice-group">Gemini — online AI voices</div>
          <label class="pp-voice-option" :class="{ active: wordVoicePref === 'auto' }">
            <input type="radio" name="pp-voice" value="auto" :checked="wordVoicePref === 'auto'" @change="setWordVoice('auto')" />
            <span class="pp-voice-main">
              <span class="pp-voice-name">Auto — teacher voice <small>{{ GEMINI_TEACHER_VOICE }} · matches the letter sounds</small></span>
              <span class="pp-badge gemini"><span class="material-symbols-rounded">auto_awesome</span>Gemini</span>
            </span>
          </label>
          <label
            v-for="name in extraGeminiVoices"
            :key="name"
            class="pp-voice-option gemini-voice"
            :class="{ active: wordVoicePref === geminiVoicePref(name) }"
          >
            <input
              type="radio"
              name="pp-voice"
              :value="geminiVoicePref(name)"
              :checked="wordVoicePref === geminiVoicePref(name)"
              @change="setWordVoice(geminiVoicePref(name))"
            />
            <span class="pp-voice-main">
              <span class="pp-voice-name">{{ name }}</span>
              <span class="pp-badge gemini"><span class="material-symbols-rounded">auto_awesome</span>Gemini</span>
            </span>
          </label>
          <p v-if="geminiVoicesLoading" class="pp-voices-empty pp-voices-loading">Loading Gemini voices…</p>

          <template v-if="sortedSystemVoices.length">
            <div class="pp-voice-group">On this device — work offline</div>
            <label
              v-for="v in sortedSystemVoices"
              :key="v.voiceURI"
              class="pp-voice-option"
              :class="{ active: wordVoicePref === v.voiceURI }"
            >
              <input type="radio" name="pp-voice" :value="v.voiceURI" :checked="wordVoicePref === v.voiceURI" @change="setWordVoice(v.voiceURI)" />
              <span class="pp-voice-main">
                <span class="pp-voice-name">{{ v.name }} <small>{{ v.lang }}</small></span>
                <span class="pp-badge device">Device</span>
              </span>
            </label>
          </template>
          <p v-if="!systemVoices.length" class="pp-voices-empty">No device voices found — the online teacher voice is used.</p>
          <p v-if="lastError" class="pp-voice-fallback">
            <span class="material-symbols-rounded">info</span>
            AI voice couldn't play — {{ lastError }} The device voice is used instead.
          </p>
        </div>
      </div>
    </transition>
    <!-- ── Canvas ──────────────────────────────────────────────────────── -->
    <!-- An endless sky plane: .pp-world holds the blocks at fixed "world"
         coordinates and is translated by the pan offset; empty-sky drags and
         the mouse wheel pan the plane (see onCanvasDown / onWheelPan). -->
    <main
      ref="canvasEl"
      class="pp-canvas"
      :class="{ 'drop-ready': drag && drag.moved && drag.overCanvas, panning }"
      :style="{ backgroundPosition: `${pan.x}px ${pan.y}px` }"
      @pointerdown.self="onCanvasDown"
      @wheel.prevent="onWheelPan"
    >
      <div v-if="!groups.length" class="pp-hint">
        <div class="pp-hint-bubble">
          <span class="material-symbols-rounded">swipe_up_alt</span>
          <p><b>Drag</b> letters here to build words!</p>
          <p class="pp-hint-sub">
            Snap blocks together to hear them join — press <b>SPACE</b> to add a word gap and build phrases, then tap the golden speaker to hear them read aloud. Drag the empty sky to explore!
          </p>
        </div>
      </div>

      <div class="pp-world" :style="{ transform: `translate3d(${pan.x}px, ${pan.y}px, 0)` }">
      <div
        v-for="g in groups"
        :key="g.key"
        :data-row-key="g.key"
        class="pp-row"
        :class="{
          'snap-left': drag && drag.snap && drag.snap.key === g.key && drag.snap.side === 'left',
          'snap-right': drag && drag.snap && drag.snap.key === g.key && drag.snap.side === 'right',
          'row-carried': drag && drag.moved && drag.fromGroupKey === g.key && drag.fromIndex === -1,
        }"
        :style="{ left: g.x + 'px', top: g.y + 'px' }"
        @pointerdown="onRowDown($event, g)"
      >
        <div
          v-for="(sid, i) in g.soundIds"
          :key="sid + i"
          :data-idx="i"
          class="pp-tile"
          :class="{
            'is-space': sid === SPACE_ID,
            'hidden-extracted': drag && drag.moved && drag.fromGroupKey === g.key && drag.fromIndex === i,
            speaking: activePulse && activePulse.key === g.key && activePulse.idxs.includes(i),
          }"
          :style="sid === SPACE_ID ? {} : { background: colorFor(sid).bg, '--deep': colorFor(sid).deep }"
        >
          <span v-if="sid !== SPACE_ID" class="pp-tile-text">{{ SOUND_BY_ID[sid].letters }}</span>
          <svg v-if="sid !== SPACE_ID" class="pp-face" viewBox="0 0 64 26" aria-hidden="true">
            <circle cx="18" cy="10" r="4.6" fill="var(--deep)" />
            <circle cx="46" cy="10" r="4.6" fill="var(--deep)" />
            <circle cx="19.6" cy="8.6" r="1.7" fill="#fff" />
            <circle cx="47.6" cy="8.6" r="1.7" fill="#fff" />
            <path d="M23 17 Q32 25 41 17" stroke="var(--deep)" stroke-width="3.4" fill="none" stroke-linecap="round" />
          </svg>
          <button
            v-if="sid !== SPACE_ID"
            class="pp-tile-play"
            type="button"
            :title="`Play /${SOUND_BY_ID[sid].letters}/`"
            @pointerdown.stop
            @click="playOne(sid)"
          >
            <span class="material-symbols-rounded">volume_up</span>
          </button>
        </div>
        <button
          class="pp-blend"
          type="button"
          title="Say the whole phrase"
          @pointerdown.stop
          @click="playJoined(g.key, g.soundIds, { forceWord: true })"
        >
          <span class="material-symbols-rounded">campaign</span>
        </button>
      </div>

      <!-- Confetti lives in the world layer so it bursts at its row -->
        <span
          v-for="c in confetti"
          :key="c.key"
          class="pp-confetti"
          :style="{
            left: c.x + 'px',
            top: c.y + 'px',
            '--tx': c.tx + 'px',
            '--ty': c.ty + 'px',
            '--rot': c.rot,
            background: c.color,
            animationDuration: c.dur + 's',
          }"
        />
      </div>

      <!-- Celebration banner stays centred on screen -->
      <transition name="pp-pop">
        <div v-if="banner" class="pp-banner">
          <span class="pp-banner-word">{{ banner }}</span>
          <span class="material-symbols-rounded">celebration</span>
        </div>
      </transition>

      <!-- Voice-fallback toast: explains a mid-game swap to the device voice -->
      <transition name="pp-fade">
        <div v-if="voiceToast" class="pp-voice-toast">
          <span class="material-symbols-rounded">volume_off</span>
          {{ voiceToast }}
        </div>
      </transition>

      <!-- Trash monster -->
      <div ref="trashEl" class="pp-trash" :class="{ armed: drag && drag.moved, 'over': drag && drag.moved && drag.overTrash }" title="Drop here to remove">
        <svg viewBox="0 0 80 80" aria-hidden="true">
          <path d="M40 8 C62 8 72 26 72 44 C72 62 58 72 40 72 C22 72 8 62 8 44 C8 26 18 8 40 8 Z" fill="#C39BFF" />
          <path d="M24 46 C30 38 50 38 56 46 C52 58 28 58 24 46 Z" fill="#5A2E91" />
          <path d="M27 47 Q40 54 53 47" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" />
          <circle cx="26" cy="30" r="7" fill="#fff" />
          <circle cx="54" cy="30" r="7" fill="#fff" />
          <circle cx="27" cy="31" r="3" fill="#5A2E91" />
          <circle cx="53" cy="31" r="3" fill="#5A2E91" />
        </svg>
        <span class="pp-trash-lbl">feed me!</span>
      </div>
    </main>

    <!-- ── Right vertical panel: A–Z alphabet blocks ───────────────────── -->
    <aside class="pp-panel-right">
      <div class="pp-panel-head">
        <span class="pp-panel-title">Blocks</span>
        <span class="pp-panel-spacer" />
        <button class="pp-round-btn small" type="button" title="Scroll up" @click="slideBlocks(-1)">
          <span class="material-symbols-rounded">keyboard_arrow_up</span>
        </button>
        <button class="pp-round-btn small" type="button" title="Scroll down" @click="slideBlocks(1)">
          <span class="material-symbols-rounded">keyboard_arrow_down</span>
        </button>
      </div>
      <div ref="blocksScroller" class="pp-blocks">
        <div
          v-for="b in ALPHA_BLOCKS"
          :key="b.letter"
          class="pp-block"
          :style="{ background: b.color.bg, '--deep': b.color.deep }"
          @pointerdown="onBlockDown($event, b.letter)"
        >
          <span class="pp-block-letter">{{ b.letter }}</span>
          <svg class="pp-face" viewBox="0 0 64 26" aria-hidden="true">
            <circle cx="18" cy="10" r="4.6" fill="var(--deep)" />
            <circle cx="46" cy="10" r="4.6" fill="var(--deep)" />
            <circle cx="19.6" cy="8.6" r="1.7" fill="#fff" />
            <circle cx="47.6" cy="8.6" r="1.7" fill="#fff" />
            <path d="M23 17 Q32 25 41 17" stroke="var(--deep)" stroke-width="3.4" fill="none" stroke-linecap="round" />
          </svg>
        </div>
      </div>
    </aside>

    <!-- ── Spacebar: the phrase-maker ───────────────────────────────────── -->
    <!-- Tap it (mobile) or press the physical Space key (keyboard) to append
         ONE empty space block to the row the child is building; the next
         block dropped at the row's end attaches after it. Speaking is the
         golden speakers' job, not this key's. -->
    <button
      class="pp-spacebar"
      :class="{ added: spaceAddedPulse }"
      type="button"
      title="Add a space (Space key)"
      aria-label="Add a space"
      @click="addSpace"
    >
      <svg viewBox="0 0 240 100" aria-hidden="true">
        <defs>
          <linearGradient id="pp-key-cap" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#ffffff" />
            <stop offset="0.55" stop-color="#f3e9ff" />
            <stop offset="1" stop-color="#e2cfff" />
          </linearGradient>
        </defs>
        <ellipse cx="120" cy="92" rx="106" ry="7" fill="rgba(58, 43, 82, 0.22)" />
        <rect x="20" y="38" width="200" height="48" rx="24" fill="#5a2e91" />
        <rect x="16" y="20" width="208" height="56" rx="28" fill="url(#pp-key-cap)" stroke="#c9aef2" stroke-width="2.5" />
        <rect x="28" y="27" width="184" height="17" rx="8.5" fill="#fff" opacity="0.65" />
        <path class="pp-key-spark" d="M34 12 l3.2 7 7 3.2 -7 3.2 -3.2 7 -3.2 -7 -7 -3.2 7 -3.2 Z" fill="#FFD93D" />
        <path class="pp-key-spark slow" d="M208 8 l2.4 5.2 5.2 2.4 -5.2 2.4 -2.4 5.2 -2.4 -5.2 -5.2 -2.4 5.2 -2.4 Z" fill="#FF8FB1" />
        <text x="120" y="61" text-anchor="middle" class="pp-key-label">SPACE</text>
        <path d="M97 74 q11 8 23 3" stroke="#7b3fd1" stroke-width="3" fill="none" stroke-linecap="round" opacity="0.5" />
      </svg>
    </button>

    <!-- Portrait phones: gate the game behind a rotate prompt (CSS-only — see
         the media query on .pp-rotate). Where the browser allows it, the
         button goes fullscreen and locks orientation to landscape. -->
    <div class="pp-rotate">
      <div class="pp-rotate-card">
        <svg class="pp-rotate-anim" viewBox="0 0 96 96" aria-hidden="true">
          <rect x="32" y="10" width="32" height="76" rx="9" fill="#fff" stroke="#7b3fd1" stroke-width="5" />
          <circle cx="48" cy="77" r="2.8" fill="#7b3fd1" />
        </svg>
        <h2>Turn your device sideways!</h2>
        <p>Sound Splash plays in landscape. Rotate your device to keep building words.</p>
        <button v-if="canAutoLandscape" class="pp-rotate-btn" type="button" @click="enterLandscape">
          <span class="material-symbols-rounded">fullscreen</span>
          Go fullscreen
        </button>
      </div>
    </div>

    <!-- Floating drag ghost (follows the pointer above everything) -->
    <div v-if="drag && drag.moved" class="pp-ghost" :style="{ left: drag.clientX + 'px', top: drag.clientY + 'px' }">
      <div class="pp-ghost-row">
        <div
          v-for="(sid, i) in drag.soundIds"
          :key="i"
          class="pp-tile"
          :class="{ 'is-space': sid === SPACE_ID }"
          :style="sid === SPACE_ID ? {} : { background: colorFor(sid).bg, '--deep': colorFor(sid).deep }"
        >
          <span v-if="sid !== SPACE_ID" class="pp-tile-text">{{ SOUND_BY_ID[sid].letters }}</span>
          <svg v-if="sid !== SPACE_ID" class="pp-face" viewBox="0 0 64 26" aria-hidden="true">
            <circle cx="18" cy="10" r="4.6" fill="var(--deep)" />
            <circle cx="46" cy="10" r="4.6" fill="var(--deep)" />
            <circle cx="19.6" cy="8.6" r="1.7" fill="#fff" />
            <circle cx="47.6" cy="8.6" r="1.7" fill="#fff" />
            <path d="M23 17 Q32 25 41 17" stroke="var(--deep)" stroke-width="3.4" fill="none" stroke-linecap="round" />
          </svg>
        </div>
      </div>
    </div>

    <!-- hidden probe: resolves the clamp() tile size to px -->
    <div ref="tileProbe" class="pp-tile-probe" aria-hidden="true" />
  </div>
</template>

<style scoped>
/* Full-viewport game surface — deliberately escapes the app's .app-main box */
.pp-root {
  --pp-tile: clamp(54px, 9vmin, 84px);
  --pp-panel-rw: clamp(120px, 16vw, 168px);
  --pp-ink: #3a2b52;
  position: fixed;
  inset: 0;
  z-index: 200;
  overflow: hidden;
  background: linear-gradient(180deg, #8ed6ff 0%, #b7e7ff 45%, #d9c6ff 100%);
  font-family: "Baloo 2", ui-rounded, "Segoe UI", system-ui, sans-serif;
  color: var(--pp-ink);
  user-select: none;
  -webkit-user-select: none;
  touch-action: manipulation;
}

/* ── Sky decorations ───────────────────────────────────────────────────── */
.pp-sun {
  position: absolute;
  top: -26px;
  left: -26px;
  width: clamp(110px, 16vmin, 170px);
  opacity: 0.95;
  pointer-events: none;
}
.pp-sun-rays {
  transform-origin: 50% 50%;
  animation: pp-spin 40s linear infinite;
}
@keyframes pp-spin {
  to { transform: rotate(360deg); }
}
.pp-cloud {
  position: absolute;
  width: clamp(120px, 18vw, 220px);
  pointer-events: none;
  animation: pp-drift 60s ease-in-out infinite alternate;
}
.pp-cloud-1 { top: 12%; left: 6%; }
.pp-cloud-2 { top: 30%; left: 44%; animation-delay: -18s; opacity: 0.8; }
.pp-cloud-3 { top: 8%; right: 20%; animation-delay: -36s; }
@keyframes pp-drift {
  from { transform: translateX(-3vw); }
  to { transform: translateX(3vw); }
}

/* ── Top bar ───────────────────────────────────────────────────────────── */
.pp-topbar {
  position: absolute;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.35rem 0.6rem;
  background: rgba(255, 255, 255, 0.82);
  backdrop-filter: blur(6px);
  border-radius: 999px;
  box-shadow: 0 6px 18px rgba(58, 43, 82, 0.18), inset 0 -3px 0 rgba(58, 43, 82, 0.08);
}
.pp-title {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0;
  font-size: clamp(1rem, 2.4vmin, 1.35rem);
  font-weight: 800;
  letter-spacing: 0.01em;
}
.pp-title-bubble { width: 1.5em; height: 1.5em; }
.pp-score {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.2rem 0.7rem;
  background: #fff7cf;
  border-radius: 999px;
  font-weight: 800;
  color: #a98608;
  box-shadow: inset 0 -2px 0 rgba(169, 134, 8, 0.2);
}
.pp-score .material-symbols-rounded { font-size: 1.1em; }

.pp-round-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 50%;
  background: #fff;
  color: var(--pp-ink);
  cursor: pointer;
  box-shadow: 0 4px 0 #e2d9f3, 0 8px 14px rgba(58, 43, 82, 0.15);
  transition: transform 0.12s, box-shadow 0.12s;
}
.pp-round-btn:active {
  transform: translateY(3px);
  box-shadow: 0 1px 0 #e2d9f3;
}
.pp-round-btn .material-symbols-rounded { font-size: 22px; }
.pp-round-btn.small { width: 32px; height: 32px; box-shadow: 0 3px 0 #e2d9f3; }
.pp-round-btn.small .material-symbols-rounded { font-size: 19px; }
.pp-clear:hover { background: #ffe9ec; color: #d1502a; }
.pp-cog-active { background: #f3e8ff; color: #7b3fd1; }

/* Big golden speaker — reads the whole canvas. Bigger and brighter than its
   round neighbours on purpose: it is the marquee action. */
.pp-speak-all {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border: none;
  border-radius: 50%;
  background: radial-gradient(circle at 32% 28%, #fff 0%, #ffd93d 55%, #ffb340 100%);
  color: #7a5a00;
  cursor: pointer;
  box-shadow: 0 5px 0 #c97f1e, 0 10px 18px rgba(58, 43, 82, 0.3);
  animation: pp-wob 2.6s ease-in-out infinite;
}
.pp-speak-all .material-symbols-rounded { font-size: 28px; }
.pp-speak-all:active { transform: translateY(3px); box-shadow: 0 2px 0 #c97f1e; }
.pp-speak-all.speaking {
  animation: none;
  transform: scale(1.14);
  filter: drop-shadow(0 0 12px rgba(255, 217, 61, 0.9));
}

/* ── Word voice settings panel ─────────────────────────────────────────── */
.pp-settings {
  position: absolute;
  top: 64px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 40;
  width: min(380px, 92vw);
  background: #fff;
  border-radius: 22px;
  box-shadow: 0 14px 34px rgba(58, 43, 82, 0.28), inset 0 -4px 0 #f3e8ff;
  padding: 0.7rem 0.9rem 0.5rem;
}
.pp-settings-head {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 1rem;
  color: #7b3fd1;
}
.pp-settings-head strong { flex: 1; }
.pp-settings-sub {
  margin: 0.25rem 0 0.5rem;
  font-size: 0.78rem;
  color: #6c5a8a;
  line-height: 1.35;
}
.pp-voice-list {
  max-height: min(320px, 46vh);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-bottom: 6px;
}
.pp-voice-group {
  margin: 0.4rem 0.15rem 0.1rem;
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: #9a8bb8;
}
.pp-voice-group:first-child { margin-top: 0.1rem; }
.pp-voice-option {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.45rem 0.6rem;
  border-radius: 14px;
  cursor: pointer;
  background: #faf8ff;
  border: 2px solid transparent;
  transition: background 0.12s, border-color 0.12s;
}
.pp-voice-option:hover { background: #f3e8ff; }
.pp-voice-option.active { background: #f3e8ff; border-color: #7b3fd1; }
.pp-voice-option input { accent-color: #7b3fd1; }
.pp-voice-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
}
.pp-voice-name { font-size: 0.85rem; font-weight: 700; color: #3a2b52; }
.pp-voice-name small { color: #6c5a8a; font-weight: 600; }
/* Provider badge — tells Gemini-powered AI voices apart from installed ones */
.pp-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.18rem;
  flex: none;
  padding: 0.12rem 0.5rem;
  border-radius: 999px;
  font-size: 0.62rem;
  font-weight: 800;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}
.pp-badge .material-symbols-rounded { font-size: 0.72rem; }
.pp-badge.gemini {
  color: #fff;
  background: linear-gradient(135deg, #7b3fd1 20%, #4285f4 100%);
  box-shadow: 0 2px 6px rgba(123, 63, 209, 0.35);
}
.pp-badge.device { color: #6c5a8a; background: #ece7f7; }
.pp-voices-empty { margin: 0.2rem 0.2rem 0.4rem; font-size: 0.8rem; color: #6c5a8a; }
/* Surfaces WHY a Gemini pick may silently play as the device voice (e.g. the
   daily AI-voice budget being reached) instead of leaving the child puzzled. */
.pp-voice-fallback {
  display: flex;
  align-items: flex-start;
  gap: 0.35rem;
  margin: 0.3rem 0.1rem 0.2rem;
  padding: 0.45rem 0.6rem;
  border-radius: 12px;
  background: #fff7e0;
  color: #8a6d1a;
  font-size: 0.74rem;
  line-height: 1.4;
}
.pp-voice-fallback .material-symbols-rounded { font-size: 16px; flex: none; }
.pp-fade-enter-active,
.pp-fade-leave-active { transition: opacity 0.18s ease; }
.pp-fade-enter-from,
.pp-fade-leave-to { opacity: 0; }

/* ── Canvas ────────────────────────────────────────────────────────────── */
/* The canvas is a viewport onto an endless plane. The bubble grid's
   background-position is bound to the pan offset so the plane visibly
   scrolls; blocks themselves live in the translated .pp-world layer. */
.pp-canvas {
  position: absolute;
  top: 0;
  left: 0;
  right: var(--pp-panel-rw);
  bottom: 0;
  transition: box-shadow 0.2s;
  touch-action: none;
  cursor: grab;
  background-image: radial-gradient(circle, rgba(255, 255, 255, 0.5) 1.7px, transparent 2.6px);
  background-size: 48px 48px;
}
.pp-canvas.panning { cursor: grabbing; }
.pp-canvas.drop-ready {
  box-shadow: inset 0 0 0 4px rgba(255, 255, 255, 0.55);
}
/* The endless plane: rows keep their world coordinates; this layer is
   translated by the pan offset. Transparent to hits so empty-sky pointer
   presses fall through to the canvas (and pan it). */
.pp-world {
  position: absolute;
  inset: 0;
  pointer-events: none;
  will-change: transform;
}
.pp-world .pp-row { pointer-events: auto; }
.pp-hint {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  pointer-events: none;
}
.pp-hint-bubble {
  position: relative;
  max-width: min(420px, 70%);
  padding: 1.2rem 1.6rem;
  background: rgba(255, 255, 255, 0.9);
  border: 3px dashed #ffb1cd;
  border-radius: 30px;
  text-align: center;
  animation: pp-bob 3s ease-in-out infinite;
}
.pp-hint-bubble .material-symbols-rounded { font-size: 40px; color: #d6457c; }
.pp-hint-bubble p { margin: 0.3rem 0 0; font-size: 1.05rem; }
.pp-hint-sub { font-size: 0.85rem !important; color: #6c5a8a; }
@keyframes pp-bob {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-8px); }
}

/* ── Rows & tiles ──────────────────────────────────────────────────────── */
.pp-row {
  position: absolute;
  display: flex;
  touch-action: none;
}
.pp-row.snap-left::before,
.pp-row.snap-right::after {
  content: "";
  position: absolute;
  top: 50%;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #ffe45c;
  box-shadow: 0 0 0 4px rgba(255, 228, 92, 0.5);
  transform: translateY(-50%);
  animation: pp-pulse 0.6s ease-in-out infinite alternate;
}
.pp-row.snap-left::before { left: -26px; }
.pp-row.snap-right::after { right: -26px; }
.pp-row.row-carried { opacity: 0.25; }
@keyframes pp-pulse {
  from { transform: translateY(-50%) scale(0.8); }
  to { transform: translateY(-50%) scale(1.25); }
}

.pp-tile {
  --deep: #d6457c;
  position: relative;
  width: var(--pp-tile);
  height: var(--pp-tile);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2%;
  border-radius: 24%;
  cursor: grab;
  box-shadow:
    inset 0 4px 6px rgba(255, 255, 255, 0.65),
    inset 0 -5px 0 var(--deep),
    0 6px 0 rgba(58, 43, 82, 0.25),
    0 10px 16px rgba(58, 43, 82, 0.22);
  touch-action: none;
}
.pp-tile.hidden-extracted { opacity: 0.2; }
/* The empty space block: a dashed, see-through placeholder tile */
.pp-tile.is-space {
  background: rgba(255, 255, 255, 0.38);
  border: 3px dashed rgba(123, 63, 209, 0.5);
  box-shadow:
    inset 0 4px 6px rgba(255, 255, 255, 0.5),
    inset 0 -5px 0 rgba(123, 63, 209, 0.28),
    0 6px 0 rgba(58, 43, 82, 0.15),
    0 10px 16px rgba(58, 43, 82, 0.12);
  animation: pp-pop-in 0.28s cubic-bezier(0.2, 1.6, 0.4, 1);
}
@keyframes pp-pop-in {
  from { transform: scale(0.4); }
  to { transform: scale(1); }
}
.pp-tile.speaking {
  animation: pp-speak 0.28s ease-in-out infinite alternate;
}
@keyframes pp-speak {
  from { transform: scale(1); filter: brightness(1); }
  to { transform: scale(1.1); filter: brightness(1.15); }
}
.pp-tile-text {
  font-size: calc(var(--pp-tile) * 0.42);
  font-weight: 800;
  line-height: 1;
  color: var(--deep);
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.7);
  margin-top: calc(var(--pp-tile) * -0.06);
}
.pp-face {
  width: 64%;
  height: auto;
  pointer-events: none;
}

.pp-tile-play {
  position: absolute;
  right: calc(var(--pp-tile) * -0.14);
  bottom: calc(var(--pp-tile) * -0.1);
  width: calc(var(--pp-tile) * 0.42);
  height: calc(var(--pp-tile) * 0.42);
  display: grid;
  place-items: center;
  border: none;
  border-radius: 50%;
  background: #fff;
  color: var(--deep);
  cursor: pointer;
  box-shadow: 0 3px 0 rgba(58, 43, 82, 0.25), 0 6px 10px rgba(58, 43, 82, 0.2);
}
.pp-tile-play .material-symbols-rounded { font-size: calc(var(--pp-tile) * 0.26); }
.pp-tile-play:active { transform: scale(0.92); }

.pp-blend {
  align-self: center;
  width: calc(var(--pp-tile) * 0.62);
  height: calc(var(--pp-tile) * 0.62);
  margin-left: calc(var(--pp-tile) * 0.18);
  display: grid;
  place-items: center;
  border: none;
  border-radius: 50%;
  background: radial-gradient(circle at 32% 28%, #fff 0%, #ffd93d 55%, #ffb340 100%);
  color: #7a5a00;
  cursor: pointer;
  box-shadow: 0 5px 0 #c97f1e, 0 10px 18px rgba(58, 43, 82, 0.3);
  animation: pp-wob 2.2s ease-in-out infinite;
}
.pp-blend .material-symbols-rounded { font-size: calc(var(--pp-tile) * 0.38); }
.pp-blend:active { transform: scale(0.94); }
@keyframes pp-wob {
  0%, 100% { transform: rotate(-4deg); }
  50% { transform: rotate(4deg) scale(1.04); }
}

/* ── Confetti & banner ─────────────────────────────────────────────────── */
.pp-confetti {
  position: absolute;
  width: 11px;
  height: 15px;
  border-radius: 3px;
  pointer-events: none;
  animation: pp-fly 1s ease-out forwards;
}
@keyframes pp-fly {
  to {
    transform: translate(var(--tx), var(--ty)) rotate(var(--rot));
    opacity: 0;
  }
}
.pp-banner {
  position: absolute;
  left: 50%;
  top: 34%;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.7rem 1.8rem;
  background: #fff;
  border-radius: 999px;
  box-shadow: 0 10px 30px rgba(58, 43, 82, 0.3), inset 0 -5px 0 #f3e8ff;
  font-size: clamp(1.6rem, 5vmin, 2.6rem);
  font-weight: 800;
  color: #7b3fd1;
  pointer-events: none;
}
.pp-banner .material-symbols-rounded { font-size: 1.2em; color: #ffb340; }
.pp-pop-enter-active { animation: pp-pop 0.45s cubic-bezier(0.2, 1.6, 0.4, 1); }
.pp-pop-leave-active { transition: opacity 0.3s; }
.pp-pop-leave-to { opacity: 0; }
@keyframes pp-pop {
  from { transform: translate(-50%, -50%) scale(0.3); }
  to { transform: translate(-50%, -50%) scale(1); }
}

/* ── Trash monster ─────────────────────────────────────────────────────── */
.pp-voice-toast {
  position: absolute;
  top: 66px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 30;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  max-width: min(420px, 86%);
  padding: 0.45rem 0.9rem;
  background: rgba(255, 247, 224, 0.95);
  border: 2px solid #ffd93d;
  border-radius: 999px;
  box-shadow: 0 6px 18px rgba(58, 43, 82, 0.25);
  color: #8a6d1a;
  font-size: 0.78rem;
  font-weight: 700;
  line-height: 1.3;
  pointer-events: none;
}
.pp-voice-toast .material-symbols-rounded { font-size: 18px; flex: none; }

.pp-trash {
  position: absolute;
  right: 14px;
  top: 64px;
  width: 58px;
  text-align: center;
  opacity: 0.85;
  transition: transform 0.15s;
  animation: pp-wob 3s ease-in-out infinite;
  pointer-events: none;
}
.pp-trash.armed {
  opacity: 1;
  transform: scale(1.12);
  filter: drop-shadow(0 0 10px rgba(255, 143, 177, 0.9));
}
.pp-trash.over { transform: scale(1.35) rotate(-6deg); }
.pp-trash svg { width: 100%; filter: drop-shadow(0 4px 8px rgba(58, 43, 82, 0.25)); }
.pp-trash-lbl {
  display: block;
  font-size: 0.62rem;
  font-weight: 800;
  color: #7b3fd1;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

/* ── Right vertical panel (A–Z, two columns) ───────────────────────────── */
.pp-panel-right {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: var(--pp-panel-rw);
  background: #ffe3f1;
  border-radius: 26px 0 0 26px;
  box-shadow: -6px 0 18px rgba(58, 43, 82, 0.14), inset 3px 0 0 rgba(255, 255, 255, 0.6);
  display: flex;
  flex-direction: column;
  z-index: 10;
}
.pp-panel-head {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.45rem 0.55rem 0.2rem;
}
.pp-panel-title {
  font-weight: 800;
  font-size: 0.95rem;
  color: #d6457c;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.pp-panel-spacer { flex: 1; }

.pp-blocks {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  align-items: start;
  justify-items: stretch;
  padding: 8px 8px 60px;
  /* keep scrolled-in blocks clear of the floating slide buttons */
  scroll-padding-bottom: 72px;
  scrollbar-width: none;
}
.pp-blocks::-webkit-scrollbar { display: none; }
.pp-block {
  --deep: #d6457c;
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border-radius: 26%;
  cursor: grab;
  touch-action: pan-y;
  box-shadow:
    inset 0 3px 5px rgba(255, 255, 255, 0.65),
    inset 0 -4px 0 var(--deep),
    0 5px 0 rgba(58, 43, 82, 0.22),
    0 8px 12px rgba(58, 43, 82, 0.18);
  transition: transform 0.12s;
}
.pp-block:active { transform: scale(0.95); }
.pp-block-letter {
  font-size: calc((var(--pp-panel-rw) - 26px) / 2 * 0.44);
  font-weight: 800;
  line-height: 1;
  color: var(--deep);
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.7);
}
.pp-panel-right .pp-panel-head { padding-bottom: 0.35rem; }
.pp-panel-right .pp-panel-title { font-size: 0.85rem; }
.pp-panel-right .pp-round-btn.small { width: 26px; height: 26px; box-shadow: 0 2px 0 #e2d9f3; }
.pp-panel-right .pp-round-btn.small .material-symbols-rounded { font-size: 17px; }

/* ── Spacebar: the phrase-maker ────────────────────────────────────────── */
/* A blobby 3D key at the bottom. Tap (mobile) or the physical Space key
   (keyboard) appends ONE empty space block to the row being built. */
.pp-spacebar {
  position: absolute;
  bottom: calc(10px + env(safe-area-inset-bottom, 0px));
  left: 50%;
  transform: translateX(-50%);
  z-index: 15;
  width: min(230px, 52vw);
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
  font-family: inherit;
  -webkit-tap-highlight-color: transparent;
  animation: pp-key-bob 3.2s ease-in-out infinite;
}
.pp-spacebar svg {
  display: block;
  width: 100%;
  height: auto;
  transition: transform 0.1s ease, filter 0.2s ease;
}
.pp-spacebar:active svg,
.pp-spacebar.added svg {
  transform: translateY(6px) scaleY(0.94);
}
.pp-spacebar:focus-visible svg {
  filter: drop-shadow(0 0 8px rgba(123, 63, 209, 0.7));
}
.pp-key-label {
  font-size: 26px;
  font-weight: 800;
  letter-spacing: 8px;
  fill: #7b3fd1;
  paint-order: stroke;
}
.pp-key-spark { transform-origin: center; transform-box: fill-box; animation: pp-sparkle 1.8s ease-in-out infinite; }
.pp-key-spark.slow { animation-delay: -0.9s; }
@keyframes pp-sparkle {
  0%, 100% { transform: scale(0.65); opacity: 0.55; }
  50% { transform: scale(1.15); opacity: 1; }
}
@keyframes pp-key-bob {
  0%, 100% { transform: translateX(-50%) translateY(0); }
  50% { transform: translateX(-50%) translateY(-4px); }
}
.pp-spacebar.added svg { filter: drop-shadow(0 0 14px rgba(123, 63, 209, 0.85)); }

/* ── Drag ghost ────────────────────────────────────────────────────────── */
.pp-ghost {
  position: fixed;
  z-index: 300;
  pointer-events: none;
  transform: translate(-50%, -50%);
}
.pp-ghost-row { display: flex; gap: 4px; filter: drop-shadow(0 14px 18px rgba(58, 43, 82, 0.4)); }
.pp-ghost-row .pp-tile { animation: pp-speak 0.3s ease-in-out infinite alternate; }

.pp-tile-probe {
  position: absolute;
  visibility: hidden;
  width: var(--pp-tile);
  height: var(--pp-tile);
  pointer-events: none;
}

/* ── Portrait-phone gate ────────────────────────────────────────────────── */
/* Hidden everywhere except touch phones held upright, where the game (side
   panel + big spacebar key) doesn't fit. CSS-only so it appears instantly,
   before any JS runs. */
.pp-rotate { display: none; }
@media (orientation: portrait) and (pointer: coarse) and (max-width: 926px) {
  .pp-rotate {
    position: absolute;
    inset: 0;
    z-index: 600;
    display: grid;
    place-items: center;
    padding: 1.5rem;
    background: linear-gradient(180deg, #8ed6ff 0%, #b7e7ff 45%, #d9c6ff 100%);
  }
}
.pp-rotate-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4rem;
  max-width: 340px;
  padding: 1.6rem 1.8rem;
  background: rgba(255, 255, 255, 0.92);
  border-radius: 28px;
  box-shadow: 0 14px 34px rgba(58, 43, 82, 0.28), inset 0 -5px 0 #f3e8ff;
  text-align: center;
}
.pp-rotate-anim {
  width: 84px;
  margin-bottom: 0.3rem;
  animation: pp-rotate-phone 2.2s ease-in-out infinite;
}
@keyframes pp-rotate-phone {
  0%, 15% { transform: rotate(0deg); }
  55%, 75% { transform: rotate(-90deg); }
  100% { transform: rotate(0deg); }
}
.pp-rotate-card h2 { margin: 0; font-size: 1.3rem; color: #7b3fd1; }
.pp-rotate-card p { margin: 0; font-size: 0.9rem; color: #6c5a8a; line-height: 1.4; }
.pp-rotate-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  margin-top: 0.5rem;
  border: none;
  border-radius: 999px;
  padding: 0.55rem 1.2rem;
  font-family: inherit;
  font-size: 0.95rem;
  font-weight: 800;
  color: #fff;
  background: #7b3fd1;
  cursor: pointer;
  box-shadow: 0 5px 0 #5a2e91, 0 10px 18px rgba(58, 43, 82, 0.3);
}
.pp-rotate-btn:active { transform: translateY(3px); box-shadow: 0 2px 0 #5a2e91; }
</style>
