<script setup>
import { ref, computed, onMounted, onUnmounted } from "vue";
import { collection, doc, getDocs, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  listFamilies, setFamilyStatus, listFamilyMembers,
  setMemberRole, removeMember, deleteFamily,
  getLlmConfig, setLlmConfig, deleteSyllabus,
  getQuranStatus, importQuran, getUsageDashboard, getQuotaConfig, setQuotaConfig,
  getQaidaStatus, importQaida, requestQaidaAudio, stopQaidaAudio, regenerateQaidaWord, deleteQaidaLibrary, deleteQaidaAudio,
  getModelCatalog, previewModel, testAllModels,
  getCostOverview, getFamilyCostDetail,
} from "@/services/admin";

// ── Tabs ─────────────────────────────────────────────────────────────────────
const tab = ref("families");

// ── Families ─────────────────────────────────────────────────────────────────
const families = ref([]);
const familiesLoading = ref(false);
const familiesError = ref("");
const expanded = ref({});

async function loadFamilies() {
  familiesLoading.value = true;
  familiesError.value = "";
  try {
    const res = await listFamilies();
    families.value = res.families;
  } catch (e) {
    familiesError.value = e?.message || "Could not load families.";
  } finally {
    familiesLoading.value = false;
  }
}

async function toggleStatus(fam) {
  const next = fam.status === "active" ? "disabled" : "active";
  try {
    await setFamilyStatus(fam.id, next);
    fam.status = next;
  } catch (e) {
    alert(e?.message || "Could not update status.");
  }
}

async function toggleExpand(fam) {
  if (expanded.value[fam.id]) {
    delete expanded.value[fam.id];
    return;
  }
  expanded.value[fam.id] = { loading: true, members: [], error: "" };
  try {
    const res = await listFamilyMembers(fam.id);
    expanded.value[fam.id] = { loading: false, members: res.members, error: "" };
  } catch (e) {
    expanded.value[fam.id] = { loading: false, members: [], error: e?.message || "Could not load members." };
  }
}

async function changeRole(fam, member, role) {
  try {
    await setMemberRole(fam.id, member.uid, role);
    member.role = role;
  } catch (e) {
    alert(e?.message || "Could not change role.");
  }
}

async function kickMember(fam, member) {
  if (!confirm(`Remove ${member.displayName || member.email || member.uid} from ${fam.name}?`)) return;
  try {
    await removeMember(fam.id, member.uid);
    expanded.value[fam.id].members = expanded.value[fam.id].members.filter((m) => m.uid !== member.uid);
    fam.memberCount = Math.max(0, fam.memberCount - 1);
  } catch (e) {
    alert(e?.message || "Could not remove member.");
  }
}

const nukingSyllabus = ref({});
async function nukeSyllabus(fam) {
  if (!confirm(`Delete ALL generated activities (the syllabus) for "${fam.name}"?\n\nThis also clears calendar blocks using them. This cannot be undone.`)) return;
  nukingSyllabus.value = { ...nukingSyllabus.value, [fam.id]: true };
  try {
    const r = await deleteSyllabus(undefined, fam.id);
    alert(`Deleted ${r.activitiesDeleted || 0} activities and ${r.blocksDeleted || 0} blocks.`);
  } catch (e) {
    alert(e?.message || "Could not delete the syllabus.");
  } finally {
    nukingSyllabus.value = { ...nukingSyllabus.value, [fam.id]: false };
  }
}

async function nukeFam(fam) {
  if (!confirm(`PERMANENTLY DELETE family "${fam.name}" and ALL its data?\n\nThis cannot be undone.`)) return;
  if (!confirm(`Second confirmation: delete "${fam.name}"?`)) return;
  try {
    await deleteFamily(fam.id);
    families.value = families.value.filter((f) => f.id !== fam.id);
    delete expanded.value[fam.id];
  } catch (e) {
    alert(e?.message || "Could not delete family.");
  }
}

function fmtDate(ms) {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString(undefined, { dateStyle: "medium" });
}

// ── Per-agent LLM Config ─────────────────────────────────────────────────────
// One global "default" block + an override block per agent. Each agent's
// effective settings are prefilled; saving persists them.
const AGENT_META = {
  guide: { label: "Guide", desc: "Read-only family Q&A assistant.", kind: "text" },
  curriculum: { label: "Curriculum architect", desc: "Designs the 6-month plan.", kind: "text" },
  syllabus: { label: "Syllabus builder", desc: "Generates the activity series.", kind: "text" },
  content: { label: "Activity content", desc: "Writes per-activity verses / problems / steps.", kind: "text" },
  scheduler: { label: "Planner scheduler", desc: "Auto-schedules activities onto the calendar.", kind: "text" },
  brief: { label: "Knowledge brief", desc: "Writes the pedagogical brief grounding all agents.", kind: "text" },
  image: { label: "Storybook images", desc: "Generates story illustrations.", kind: "image" },
  tts: { label: "Text-to-speech", desc: "Reads words/phrases aloud (Gemini or OpenAI voices).", kind: "tts" },
};
const llmDefault = ref({ model: "gemini-2.5-flash", temperature: 0.4, maxOutputTokens: 2048, thinkingBudget: 0, systemInstructions: "" });
const llmAgents = ref({});
const llmKeys = ref([]);
const llmLoading = ref(false);
const llmSaving = ref(false);
const llmSaved = ref(false);
const llmError = ref("");
const modelCatalog = ref({ text: [], tts: [], image: [], voices: [] });
const modelLoading = ref(false);
const previewing = ref({});
const previewResults = ref({});
const testingModels = ref(false);
const testResults = ref([]);

function agentMeta(k) { return AGENT_META[k] || { label: k, desc: "", kind: "text" }; }
function ttsProvider(k) { return llmAgents.value[k]?.provider || "gemini"; }
function catalogFor(k) {
  const list = modelCatalog.value[agentMeta(k).kind] || modelCatalog.value.text || [];
  // TTS models span two providers; only show the ones for the selected provider.
  if (agentMeta(k).kind === "tts") return list.filter((m) => (m.provider || "gemini") === ttsProvider(k));
  return list;
}
// ── Qaida per-take TTS overrides (provider-aware) ─────────────────────────────
// Each item may override provider/voice/model for one regen take. Voice + model
// lists follow the chosen provider; "" means "use the global TTS config".
function ovProviderOf(item) { return item?.ovProvider || "gemini"; }
function ovTtsModels(item) {
  return (modelCatalog.value.tts || []).filter((m) => (m.provider || "gemini") === ovProviderOf(item));
}
// Voices for a per-take override: when a model is chosen, use THAT model's voice
// set (so tts-1/-hd only offer their 9); otherwise the provider's full set.
function ovVoices(item) {
  if (item?.ovModel) {
    const m = (modelCatalog.value.tts || []).find((x) => x.id === item.ovModel);
    if (m?.voices?.length) return m.voices;
  }
  const byProvider = modelCatalog.value.voicesByProvider;
  return (byProvider && byProvider[ovProviderOf(item)]) || modelCatalog.value.voices || [];
}
// Switching the per-take provider clears voice/model so a stale cross-provider
// value is never submitted (the backend would coerce it, but this keeps the UI honest).
function onOvProviderChange(item) { item.ovVoice = ""; item.ovModel = ""; }
// Switching the per-take model may make the chosen voice unsupported — clear it.
function onOvModelChange(item) { if (item.ovVoice && !ovVoices(item).includes(item.ovVoice)) item.ovVoice = ""; }
// Voices for the LLM-config TTS agent: the selected model's set if it declares one
// (model-accurate), else the provider's full set.
function voicesFor(k) {
  const m = selectedModel(k);
  if (m?.voices?.length) return m.voices;
  const byProvider = modelCatalog.value.voicesByProvider;
  return (byProvider && byProvider[ttsProvider(k)]) || modelCatalog.value.voices || [];
}
// Switching a TTS agent's model may invalidate its voice — snap to a valid one.
function onAgentModelChange(k) {
  if (agentMeta(k).kind !== "tts") return;
  const voices = voicesFor(k);
  if (llmAgents.value[k]?.voiceName && !voices.includes(llmAgents.value[k].voiceName)) llmAgents.value[k].voiceName = voices[0];
}
// On a provider switch, snap model + voice onto valid values for the new provider
// so we never save a Gemini model/voice under OpenAI (or vice-versa).
function onTtsProviderChange(k) {
  const a = llmAgents.value[k];
  if (!a) return;
  const models = catalogFor(k);
  if (!models.some((m) => m.id === a.model)) a.model = (models.find((m) => m.recommended) || models[0])?.id || a.model;
  const voices = voicesFor(k);
  if (!voices.includes(a.voiceName)) a.voiceName = voices[0];
}
// Look up a catalog entry by capability bucket + id (null if it's a custom id).
function modelById(kind, id) {
  return (modelCatalog.value[kind] || []).find((m) => m.id === id) || null;
}
function selectedModel(k) {
  return modelById(agentMeta(k).kind, llmAgents.value[k]?.model);
}
function modelNote(k) {
  const m = selectedModel(k);
  return m ? `${m.cost} cost | ${m.speed} | ${m.quality}` : "Custom model ID — not in the curated catalog.";
}

async function loadModelCatalog() {
  modelLoading.value = true;
  try {
    const res = await getModelCatalog();
    modelCatalog.value = res.catalog || modelCatalog.value;
  } catch (e) {
    llmError.value = e?.message || "Could not load model catalog.";
  } finally {
    modelLoading.value = false;
  }
}

async function loadLlmConfig() {
  llmLoading.value = true;
  try {
    const cfg = await getLlmConfig();
    llmKeys.value = cfg.agentKeys || Object.keys(cfg.agents || {});
    llmDefault.value = { ...llmDefault.value, ...(cfg.default || {}) };
    llmAgents.value = cfg.agents || {};
  } catch (e) {
    llmError.value = e?.message || "Could not load LLM config.";
  } finally {
    llmLoading.value = false;
  }
}

async function saveLlmConfig() {
  llmSaving.value = true;
  llmSaved.value = false;
  llmError.value = "";
  try {
    await setLlmConfig({ default: llmDefault.value, agents: llmAgents.value });
    llmSaved.value = true;
    setTimeout(() => (llmSaved.value = false), 2500);
  } catch (e) {
    llmError.value = e?.message || "Could not save.";
  } finally {
    llmSaving.value = false;
  }
}

async function runPreview(k) {
  if (!llmAgents.value[k] || previewing.value[k]) return;
  previewing.value = { ...previewing.value, [k]: true };
  previewResults.value = { ...previewResults.value, [k]: null };
  try {
    const r = await previewModel({
      agentKey: k,
      provider: llmAgents.value[k].provider,
      model: llmAgents.value[k].model,
      voiceName: llmAgents.value[k].voiceName,
      sampleText: agentMeta(k).kind === "tts"
        ? "Assalamu alaikum. This is the activity voice preview."
        : "Reply with one short preview sentence.",
    });
    previewResults.value = { ...previewResults.value, [k]: r };
    if (r?.url) {
      try { new Audio(r.url).play(); } catch { /* browser may block autoplay */ }
    }
  } catch (e) {
    previewResults.value = { ...previewResults.value, [k]: { ok: false, error: e?.message || "Preview failed." } };
  } finally {
    previewing.value = { ...previewing.value, [k]: false };
  }
}

async function runTestAllModels() {
  testingModels.value = true;
  testResults.value = [];
  llmError.value = "";
  try {
    const r = await testAllModels();
    if (r?.configured === false) {
      llmError.value = "Gemini API key is not configured.";
      return;
    }
    testResults.value = r?.results || [];
  } catch (e) {
    llmError.value = e?.message || "Model health check failed.";
  } finally {
    testingModels.value = false;
  }
}

// ── Quran data ────────────────────────────────────────────────────────────────
const quran = ref({ importedSurahs: 0, totalSurahs: 114, verses: 0, configured: true, done: false });
const quranLoading = ref(false);
const quranImporting = ref(false);
const quranMsg = ref("");
const quranError = ref("");

// ── Quran corpus browser ──────────────────────────────────────────────────────
const quranBrowserOpen = ref(false);
const quranBrowserLoading = ref(false);
const quranBrowserError = ref("");
const quranSurahList = ref([]);
const quranSelectedSurahNum = ref(null);
const quranBrowserAudio = ref(null);
const quranPlayingUrl = ref("");

const quranSelectedSurah = computed(() =>
  quranSurahList.value.find((s) => s.surah === quranSelectedSurahNum.value) || null
);

async function openQuranBrowser() {
  quranBrowserOpen.value = !quranBrowserOpen.value;
  if (!quranBrowserOpen.value || quranSurahList.value.length) return;
  quranBrowserLoading.value = true;
  quranBrowserError.value = "";
  try {
    const snap = await getDocs(query(collection(db, "quran"), orderBy("surah")));
    quranSurahList.value = snap.docs.map((d) => d.data()).sort((a, b) => a.surah - b.surah);
    if (quranSurahList.value.length) quranSelectedSurahNum.value = quranSurahList.value[0].surah;
  } catch (e) {
    quranBrowserError.value = e?.message || "Could not load corpus.";
  } finally {
    quranBrowserLoading.value = false;
  }
}

function playQuranAudio(url) {
  if (!url) return;
  if (quranBrowserAudio.value) {
    quranBrowserAudio.value.pause();
    if (quranPlayingUrl.value === url) { quranPlayingUrl.value = ""; return; }
  }
  quranBrowserAudio.value = new Audio(url);
  quranBrowserAudio.value.play().catch(() => {});
  quranPlayingUrl.value = url;
  quranBrowserAudio.value.onended = () => { quranPlayingUrl.value = ""; };
}

function stopQuranBrowserAudio() {
  if (quranBrowserAudio.value) quranBrowserAudio.value.pause();
  quranPlayingUrl.value = "";
}

async function loadQuranStatus() {
  quranLoading.value = true;
  try { quran.value = await getQuranStatus(); }
  catch (e) { quranError.value = e?.message || "Could not load Quran status."; }
  finally { quranLoading.value = false; }
}

async function runQuranImport(force = false) {
  if (quranImporting.value) return;
  quranImporting.value = true;
  quranError.value = "";
  quranMsg.value = "Starting import…";
  try {
    let done = false;
    let offset = 0;
    do {
      const r = await importQuran({ force, offset, limit: 20 });
      offset = r.nextOffset || 0;
      if (r.configured === false) { quranError.value = r.text || "Public Quran source is unavailable."; break; }
      quran.value = { ...quran.value, importedSurahs: r.importedSurahs };
      quranMsg.value = force
        ? `Re-imported ${r.processedSurahs || r.importedSurahs}/114 surahs…`
        : `Imported ${r.importedSurahs}/114 surahs…`;
      done = r.done;
    } while (!done);
    if (done) { await loadQuranStatus(); quranMsg.value = `✓ Complete — ${quran.value.importedSurahs}/114 surahs, ${quran.value.verses} verses.`; }
  } catch (e) {
    quranError.value = e?.message || "Import failed.";
  } finally {
    quranImporting.value = false;
  }
}

// ── Noorani Qaida library ─────────────────────────────────────────────────────
// Superadmin imports the standard lessons (deterministic spell-out scripts),
// generates/caches their TTS audio, then audits each word and can regenerate one
// with an optional instruction. The audit list is read straight from the shared
// nooraniQaida/* collection (signed-in readable).
const qaida = ref({ importedLessons: 0, totalLessons: 0, items: 0, withAudio: 0, audioRemaining: 0, importDone: false, audioDone: false, pending: { items: 0, chars: 0 }, limits: null });
// Bulk-run plan: which provider(s)/model(s) voice the corpus, plus an optional
// test cap. mode: "gemini" | "openai" | "distribute". Sent to requestQaidaAudio.
const qaidaPlan = ref({ mode: "gemini", models: { gemini: "gemini-2.5-flash-preview-tts", openai: "gpt-4o-mini-tts" }, maxWords: null });
const qaidaLoading = ref(false);
const qaidaBusy = ref(false);
const qaidaMsg = ref("");
const qaidaError = ref("");
const qaidaLessons = ref([]);       // audit list: [{ lessonId, title, items: [...] }]
const qaidaAudio = ref(null);       // shared <audio> element for previews
const qaidaRegenFor = ref("");      // "lessonId|glyph" currently previewing
const qaidaInstruction = ref({});   // per-item optional instruction text
const qaidaPreview = ref({});       // "lessonId|glyph" → { url, instruction } awaiting save
const qaidaSaving = ref("");        // "lessonId|glyph" currently saving
const qaidaJob = ref(null);         // live platform/qaidaAudioJob progress
let qaidaJobUnsub = null;

const qaidaJobActive = computed(() => ["queued", "running"].includes(qaidaJob.value?.status));
const qaidaJobStopped = computed(() => ["error", "cancelled", "paused"].includes(qaidaJob.value?.status));

function openQaidaTab() {
  tab.value = "qaida";
  if (!qaida.value.totalLessons && !qaidaLoading.value) loadQaida();
  if (!modelCatalog.value.tts?.length && !modelLoading.value) loadModelCatalog(); // for plan model pickers
  watchQaidaJob();
}

// TTS models offered for a provider in the bulk-run plan pickers.
function ttsModelsByProvider(provider) {
  return (modelCatalog.value.tts || []).filter((m) => (m.provider || "gemini") === provider);
}

// ── Client-side cost estimate (mirrors functions/platform/qaidaCost.js) ───────
// Rough pre-run projection; the server meters real spend separately. Kept in sync
// with the backend constants/rates so the displayed number matches the run.
const QAIDA_AVG_CLIP_SECONDS = 4;
const QAIDA_AUDIO_TOKENS_PER_SEC = 25;
const QAIDA_CHAR_RATES = { "tts-1": 15.0, "tts-1-hd": 30.0 };
const QAIDA_TOKEN_RATES = {
  "gemini-2.5-flash-preview-tts": { input: 0.5, output: 10.0 },
  "gemini-2.5-pro-preview-tts": { input: 1.0, output: 20.0 },
  "gpt-4o-mini-tts": { input: 0.6, output: 12.0 },
};
function estTtsCost(items, chars, model) {
  if (!items) return 0;
  if (QAIDA_CHAR_RATES[model]) return (chars / 1e6) * QAIDA_CHAR_RATES[model];
  const r = QAIDA_TOKEN_RATES[model] || { input: 0.5, output: 10.0 };
  return ((chars / 4) * r.input + items * QAIDA_AVG_CLIP_SECONDS * QAIDA_AUDIO_TOKENS_PER_SEC * r.output) / 1e6;
}
function rpmFor(provider, model) {
  const l = qaida.value.limits?.[provider]?.[model];
  if (l) return l.rpm;
  return provider === "openai" ? 50 : 10;
}
// Per-provider { items, chars, model, usd } + total, for the selected plan, capped
// by the optional maxWords test limit.
const qaidaEstimate = computed(() => {
  const cap = qaidaPlan.value.maxWords;
  const totalItems = Math.min(qaida.value.pending?.items || 0, cap > 0 ? cap : Infinity);
  const totalChars = (qaida.value.pending?.items || 0)
    ? Math.round((qaida.value.pending.chars || 0) * (totalItems / qaida.value.pending.items))
    : 0;
  const avg = totalItems ? totalChars / totalItems : 0;
  const providers = qaidaPlan.value.mode === "distribute" ? ["openai", "gemini"] : [qaidaPlan.value.mode];
  let split;
  if (providers.length === 1) split = { [providers[0]]: totalItems };
  else {
    const w = { openai: rpmFor("openai", qaidaPlan.value.models.openai), gemini: rpmFor("gemini", qaidaPlan.value.models.gemini) };
    const tot = w.openai + w.gemini;
    const openai = tot ? Math.round(totalItems * w.openai / tot) : 0;
    split = { openai, gemini: totalItems - openai };
  }
  const rows = providers.map((p) => {
    const items = split[p] || 0;
    const chars = Math.round(items * avg);
    const model = qaidaPlan.value.models[p];
    return { provider: p, items, chars, model, usd: estTtsCost(items, chars, model) };
  });
  return { rows, totalUsd: rows.reduce((s, r) => s + r.usd, 0), items: totalItems };
});

// Subscribe to the server-side audio job so progress shows live and survives a
// page reload (the work runs on the server, not in this tab).
function watchQaidaJob() {
  if (qaidaJobUnsub) return;
  qaidaJobUnsub = onSnapshot(doc(db, "platform", "qaidaAudioJob"), (snap) => {
    const prev = qaidaJob.value?.status;
    const cur = snap.exists() ? snap.data() : null;
    qaidaJob.value = cur;
    if (cur) {
      qaida.value = { ...qaida.value, withAudio: cur.processed ?? qaida.value.withAudio, items: cur.total ?? qaida.value.items, audioRemaining: cur.remaining ?? qaida.value.audioRemaining };
    }
    // When the job settles, refresh status + the audit list (now has audioUrls).
    if (prev && ["queued", "running"].includes(prev) && cur && !["queued", "running"].includes(cur.status)) {
      loadQaida();
    }
  }, () => { /* read denied / offline — ignore */ });
}

async function loadQaida() {
  qaidaLoading.value = true;
  qaidaError.value = "";
  try {
    qaida.value = await getQaidaStatus();
    await loadQaidaLessons();
  } catch (e) {
    qaidaError.value = e?.message || "Could not load Qaida status.";
  } finally {
    qaidaLoading.value = false;
  }
}

async function loadQaidaLessons() {
  try {
    const snap = await getDocs(query(collection(db, "nooraniQaida"), orderBy("order")));
    qaidaLessons.value = snap.docs.map((d) => {
      const data = d.data();
      // ovVoice/ovModel are UI-only per-take TTS overrides ("" = use the configured
      // default); initialized here so their <select>s show the default option.
      return { lessonId: d.id, ...data, items: (data.items || []).map((it) => ({ ...it, ovVoice: "", ovModel: "" })) };
    });
  } catch {
    qaidaLessons.value = [];
  }
}

async function runQaidaImport(force = false) {
  if (qaidaBusy.value) return;
  qaidaBusy.value = true;
  qaidaError.value = "";
  qaidaMsg.value = "Importing lessons…";
  try {
    const r = await importQaida({ force });
    qaidaMsg.value = `✓ Imported ${r.imported} lesson(s) — ${r.importedLessons}/${r.totalLessons} total.`;
    await loadQaida();
  } catch (e) {
    qaidaError.value = e?.message || "Import failed.";
  } finally {
    qaidaBusy.value = false;
  }
}

// Kick off the SERVER-SIDE audio job, then just watch its progress doc. The
// scheduled worker voices the corpus in parallel batches; the first batch lands
// within ~1 minute.
async function runQaidaAudio() {
  if (qaidaBusy.value) return;
  qaidaBusy.value = true;
  qaidaError.value = "";
  qaidaMsg.value = "Audio job queued — the server is voicing the corpus in the background…";
  try {
    // Send the selected provider/model plan + optional test cap.
    const plan = {
      mode: qaidaPlan.value.mode,
      models: { ...qaidaPlan.value.models },
      ...(qaidaPlan.value.maxWords > 0 ? { maxWords: Math.floor(qaidaPlan.value.maxWords) } : {}),
    };
    await requestQaidaAudio(plan);
    watchQaidaJob();
  } catch (e) {
    qaidaError.value = e?.message || "Could not start the audio job.";
  } finally {
    qaidaBusy.value = false;
  }
}

async function stopQaidaAudioJob() {
  try { await stopQaidaAudio(); qaidaMsg.value = "Stopping… the current batch finishes, then it halts."; }
  catch (e) { qaidaError.value = e?.message || "Could not stop the job."; }
}

async function runQaidaAudioDelete() {
  if (qaidaBusy.value) return;
  if (!window.confirm("Delete ALL generated audio? Lessons and spell scripts stay; only the voiced clips are cleared so you can regenerate from scratch.")) return;
  qaidaBusy.value = true;
  qaidaError.value = "";
  qaidaMsg.value = "Clearing audio…";
  try {
    const r = await deleteQaidaAudio();
    qaidaMsg.value = `✓ Cleared audio from ${r.cleared} word(s). Click "Generate audio" to re-voice.`;
    await loadQaida();
  } catch (e) {
    qaidaError.value = e?.message || "Could not clear audio.";
  } finally {
    qaidaBusy.value = false;
  }
}

async function runQaidaDelete() {
  if (qaidaBusy.value) return;
  if (!window.confirm("Delete the ENTIRE Noorani Qaida library? Every lesson and word is removed so you can re-import from scratch. (Cached audio is reused free on the next import.)")) return;
  qaidaBusy.value = true;
  qaidaError.value = "";
  qaidaMsg.value = "Deleting…";
  try {
    const r = await deleteQaidaLibrary();
    qaidaLessons.value = [];
    qaidaMsg.value = `✓ Deleted ${r.deleted} lesson(s). Click "Import Qaida lessons" to rebuild.`;
    await loadQaida();
  } catch (e) {
    qaidaError.value = e?.message || "Delete failed.";
  } finally {
    qaidaBusy.value = false;
  }
}

function playQaida(url) {
  if (!url) return;
  if (!qaidaAudio.value) qaidaAudio.value = new Audio();
  qaidaAudio.value.src = url;
  qaidaAudio.value.play().catch(() => {});
}

// Step 1 — synthesize a PREVIEW take (not saved) and auto-play it so the
// superadmin can audition before committing it to the shared corpus.
async function regenQaida(lessonId, glyph) {
  const key = `${lessonId}|${glyph}`;
  if (qaidaRegenFor.value) return;
  qaidaRegenFor.value = key;
  qaidaError.value = "";
  try {
    const instruction = (qaidaInstruction.value[key] || "").trim();
    const item = qaidaLessons.value.find((l) => l.lessonId === lessonId)?.items?.find((i) => i.glyph === glyph);
    const opts = { provider: item?.ovProvider || "", model: item?.ovModel || "", voiceName: item?.ovVoice || "" };
    const r = await regenerateQaidaWord(lessonId, glyph, instruction, true, opts);
    if (r.audioUrl) {
      // Stash the exact instruction + overrides used, so Save reproduces this take.
      qaidaPreview.value = { ...qaidaPreview.value, [key]: { url: r.audioUrl, instruction, opts } };
      playQaida(r.audioUrl);
    }
  } catch (e) {
    qaidaError.value = e?.message || "Preview failed.";
  } finally {
    qaidaRegenFor.value = "";
  }
}

// Step 2 — commit the auditioned take onto the corpus item. The same instruction
// re-synthesizes as a free shared-cache hit; the server persists the URL.
async function saveQaida(lessonId, glyph) {
  const key = `${lessonId}|${glyph}`;
  const preview = qaidaPreview.value[key];
  if (!preview || qaidaSaving.value) return;
  qaidaSaving.value = key;
  qaidaError.value = "";
  try {
    const r = await regenerateQaidaWord(lessonId, glyph, preview.instruction, false, preview.opts || {});
    const lesson = qaidaLessons.value.find((l) => l.lessonId === lessonId);
    const item = lesson?.items?.find((i) => i.glyph === glyph);
    if (item) {
      item.audioUrl = r.audioUrl || preview.url;
      item.audioInstruction = preview.instruction || null;
      if (r.voiceName) item.audioVoice = r.voiceName;
      if (r.model) item.audioModel = r.model;
    }
    discardQaida(key);
    qaidaMsg.value = "✓ Saved the new take for this word.";
  } catch (e) {
    qaidaError.value = e?.message || "Save failed.";
  } finally {
    qaidaSaving.value = "";
  }
}

// Drop an un-saved preview (keeps the currently saved audio untouched).
function discardQaida(key) {
  const next = { ...qaidaPreview.value };
  delete next[key];
  qaidaPreview.value = next;
}

// ── Usage dashboard ─────────────────────────────────────────────────────────────
// Plain-language usage/limits/health + alerts for a non-technical superadmin.
const usage = ref(null);
const usageLoading = ref(false);
const usageError = ref("");

function openUsageTab() {
  tab.value = "usage";
  loadUsage();
}
async function loadUsage() {
  usageLoading.value = true;
  usageError.value = "";
  try { usage.value = await getUsageDashboard(); }
  catch (e) { usageError.value = e?.message || "Could not load usage."; }
  finally { usageLoading.value = false; }
}
const usageTrendMax = computed(() => Math.max(1, ...((usage.value?.trend || []).map((t) => t.requests))));
function usageModelRows() {
  const m = usage.value?.month?.byModel || {};
  return Object.entries(m)
    .map(([model, v]) => ({ model, calls: Number(v?.calls) || 0, costUsd: Number(v?.costUsd) || 0 }))
    .sort((a, b) => b.calls - a.calls);
}
function fmtDay(d) { return d ? d.slice(5) : ""; }

// ── Quota allocation ─────────────────────────────────────────────────────────
const quota = ref(null);          // last loaded { config, familyIds, names, alloc, ... }
const quotaForm = ref(null);      // editable { models:{m:rpd}, platformReservePct, familyWeights:{} }
const quotaLoading = ref(false);
const quotaSaving = ref(false);
const quotaError = ref("");
const quotaMsg = ref("");

function openQuotaTab() {
  tab.value = "quota";
  loadQuota();
}
async function loadQuota() {
  quotaLoading.value = true;
  quotaError.value = "";
  try {
    const r = await getQuotaConfig();
    quota.value = r;
    quotaForm.value = {
      models: Object.fromEntries(Object.entries(r.config.models).map(([m, v]) => [m, v.rpd])),
      platformReservePct: r.config.platformReservePct,
      familyWeights: Object.fromEntries(r.familyIds.map((id) => [id, r.config.familyWeights?.[id] ?? 1])),
    };
  } catch (e) { quotaError.value = e?.message || "Could not load quota."; }
  finally { quotaLoading.value = false; }
}
async function saveQuota() {
  if (quotaSaving.value) return;
  quotaSaving.value = true;
  quotaError.value = ""; quotaMsg.value = "";
  try {
    const models = Object.fromEntries(Object.entries(quotaForm.value.models).map(([m, rpd]) => [m, { rpd: Number(rpd) || 0 }]));
    await setQuotaConfig({ models, platformReservePct: Number(quotaForm.value.platformReservePct) || 0, familyWeights: quotaForm.value.familyWeights });
    quotaMsg.value = "✓ Saved. New budgets apply within ~5 minutes.";
    await loadQuota();
  } catch (e) { quotaError.value = e?.message || "Save failed."; }
  finally { quotaSaving.value = false; }
}

// ── Costs ──────────────────────────────────────────────────────────────────────
// Lazily loaded the first time the Costs tab is opened. The overview reads the
// platform rollups; clicking a family drills into its daily series + raw events.
const costMonth = ref("");
const costOverview = ref(null);
const costLoading = ref(false);
const costError = ref("");
const costDetail = ref(null);
const costMoreLoading = ref(false);

const trendMax = computed(() =>
  Math.max(1e-9, ...((costOverview.value?.trend || []).map((t) => t.costUsd)))
);
const dailyMax = computed(() =>
  Math.max(1e-9, ...((costDetail.value?.daily || []).map((d) => d.costUsd)))
);

function fmtUsd(n) {
  const v = Number(n) || 0;
  if (v === 0) return "$0";
  if (v < 0.01) return `$${v.toFixed(5)}`;
  return `$${v.toFixed(2)}`;
}
function fmtTs(ms) {
  return ms ? new Date(ms).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }) : "—";
}
function breakdownRows(map) {
  return Object.entries(map || {})
    .map(([key, v]) => ({ key, costUsd: Number(v?.costUsd) || 0, calls: Number(v?.calls) || 0 }))
    .sort((a, b) => b.costUsd - a.costUsd);
}

function openCostsTab() {
  tab.value = "costs";
  if (!costOverview.value && !costLoading.value) loadCostOverview();
}

async function loadCostOverview() {
  costLoading.value = true;
  costError.value = "";
  costDetail.value = null;
  try {
    const res = await getCostOverview(costMonth.value || undefined);
    costOverview.value = res;
    costMonth.value = res.month;
  } catch (e) {
    costError.value = e?.message || "Could not load costs.";
  } finally {
    costLoading.value = false;
  }
}

async function openFamilyCost(fam) {
  costDetail.value = { familyId: fam.familyId, name: fam.name, loading: true };
  try {
    const res = await getFamilyCostDetail({ familyId: fam.familyId, month: costMonth.value });
    costDetail.value = { ...res, name: fam.name };
  } catch (e) {
    costDetail.value = { familyId: fam.familyId, name: fam.name, error: e?.message || "Could not load detail." };
  }
}

async function loadMoreEvents() {
  if (!costDetail.value?.nextCursor || costMoreLoading.value) return;
  costMoreLoading.value = true;
  try {
    const res = await getFamilyCostDetail({
      familyId: costDetail.value.familyId, month: costMonth.value, beforeTs: costDetail.value.nextCursor,
    });
    costDetail.value.events = [...(costDetail.value.events || []), ...res.events];
    costDetail.value.nextCursor = res.nextCursor;
  } catch {
    /* best-effort; leave existing events in place */
  } finally {
    costMoreLoading.value = false;
  }
}

onMounted(() => {
  loadFamilies();
  loadLlmConfig();
  loadModelCatalog();
  loadQuranStatus();
});

onUnmounted(() => { if (qaidaJobUnsub) { qaidaJobUnsub(); qaidaJobUnsub = null; } });
</script>

<template>
  <section class="platform">
    <header class="head">
      <h1>Platform admin</h1>
      <nav class="tabs">
        <button :class="{ active: tab === 'families' }" @click="tab = 'families'">Families</button>
        <button :class="{ active: tab === 'usage' }" @click="openUsageTab">Usage</button>
        <button :class="{ active: tab === 'quota' }" @click="openQuotaTab">Quota</button>
        <button :class="{ active: tab === 'costs' }" @click="openCostsTab">Costs</button>
        <button :class="{ active: tab === 'llm' }" @click="tab = 'llm'">LLM config</button>
        <button :class="{ active: tab === 'quran' }" @click="tab = 'quran'">Quran</button>
        <button :class="{ active: tab === 'qaida' }" @click="openQaidaTab">Qaida</button>
      </nav>
    </header>

    <!-- ── Families tab ─────────────────────────────────────────────────── -->
    <div v-if="tab === 'families'">
      <div class="toolbar">
        <button class="btn" @click="loadFamilies" :disabled="familiesLoading">
          {{ familiesLoading ? "Loading…" : "Refresh" }}
        </button>
        <span class="count" v-if="families.length">{{ families.length }} famil{{ families.length === 1 ? 'y' : 'ies' }}</span>
      </div>

      <p v-if="familiesError" class="error">{{ familiesError }}</p>
      <p v-if="!familiesLoading && !families.length && !familiesError" class="empty">No families found.</p>

      <div v-for="fam in families" :key="fam.id" class="family-card">
        <div class="family-row">
          <div class="family-info">
            <strong class="family-name">{{ fam.name }}</strong>
            <span class="fam-meta muted">{{ fam.memberCount }} member{{ fam.memberCount === 1 ? '' : 's' }} · created {{ fmtDate(fam.createdAt) }}</span>
            <code class="fam-id">{{ fam.id }}</code>
          </div>
          <div class="family-actions">
            <span class="status-badge" :class="fam.status">{{ fam.status }}</span>
            <button class="btn sm" @click="toggleStatus(fam)">
              {{ fam.status === 'active' ? 'Disable' : 'Enable' }}
            </button>
            <button class="btn sm" @click="toggleExpand(fam)">
              {{ expanded[fam.id] ? 'Collapse' : 'Members' }}
            </button>
            <button class="btn sm danger" :disabled="nukingSyllabus[fam.id]" @click="nukeSyllabus(fam)">
              {{ nukingSyllabus[fam.id] ? '…' : 'Del syllabus' }}
            </button>
            <button class="btn sm danger" @click="nukeFam(fam)">Delete</button>
          </div>
        </div>

        <!-- Members panel -->
        <div v-if="expanded[fam.id]" class="members-panel">
          <p v-if="expanded[fam.id].loading" class="muted sm-text">Loading members…</p>
          <p v-else-if="expanded[fam.id].error" class="error sm-text">{{ expanded[fam.id].error }}</p>
          <table v-else-if="expanded[fam.id].members.length" class="members-table">
            <thead>
              <tr><th>User</th><th>Role</th><th></th></tr>
            </thead>
            <tbody>
              <tr v-for="m in expanded[fam.id].members" :key="m.uid">
                <td>
                  <span class="member-name">{{ m.displayName || m.email || m.uid }}</span>
                  <span v-if="m.email && m.displayName" class="muted sm-text"> · {{ m.email }}</span>
                </td>
                <td>
                  <select class="role-select" :value="m.role" @change="changeRole(fam, m, $event.target.value)">
                    <option value="owner">owner</option>
                    <option value="parent">parent</option>
                    <option value="viewer">viewer</option>
                  </select>
                </td>
                <td>
                  <button class="linkish danger" @click="kickMember(fam, m)">Remove</button>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-else class="muted sm-text">No members.</p>
        </div>
      </div>
    </div>

    <!-- ── Usage tab (plain-language dashboard + alerts) ──────────────────── -->
    <div v-if="tab === 'usage'" class="usage-wrap">
      <div class="toolbar">
        <h3 class="llm-h" style="margin:0">Usage &amp; health</h3>
        <button class="btn sm" :disabled="usageLoading" @click="loadUsage">{{ usageLoading ? "Refreshing…" : "Refresh" }}</button>
      </div>
      <p v-if="usageError" class="error">{{ usageError }}</p>
      <p v-if="usageLoading && !usage" class="muted">Loading…</p>

      <template v-if="usage">
        <!-- Alerts -->
        <div class="alerts">
          <div v-for="(a, i) in usage.alerts" :key="i" class="alert" :class="a.level">
            <div class="alert-icon">{{ a.icon }}</div>
            <div>
              <div class="alert-title">{{ a.title }}</div>
              <div class="alert-detail">{{ a.detail }}</div>
            </div>
          </div>
        </div>

        <!-- Today's text-to-speech vs the daily limit -->
        <div class="card usage-card">
          <div class="usage-card-h">Text-to-speech today</div>
          <div class="usage-gauge-row">
            <strong>{{ usage.today.tts.requests }}</strong>
            <span class="muted">of ~{{ usage.today.ttsLimit }} daily requests</span>
            <span v-if="usage.today.tts.quotaErrors" class="status-badge disabled">{{ usage.today.tts.quotaErrors }} blocked by limit</span>
          </div>
          <div class="usage-gauge">
            <div class="usage-gauge-fill" :class="{ over: usage.today.tts.requests >= usage.today.ttsLimit }"
                 :style="{ width: Math.min(100, 100 * usage.today.tts.requests / Math.max(1, usage.today.ttsLimit)) + '%' }"></div>
          </div>
          <small class="muted">Limit is your Google AI Studio tier cap for the TTS model. It resets daily (~midnight US Pacific).</small>
        </div>

        <!-- 14-day request trend -->
        <div class="card usage-card">
          <div class="usage-card-h">Speech requests — last 14 days</div>
          <div class="usage-bars">
            <div v-for="d in usage.trend" :key="d.date" class="usage-bar-col" :title="`${d.date}: ${d.requests} requests, ${d.errors} blocked`">
              <div class="usage-bar" :style="{ height: (44 * d.requests / usageTrendMax) + 'px' }"></div>
              <div v-if="d.errors" class="usage-bar-err" :style="{ height: (44 * d.errors / usageTrendMax) + 'px' }"></div>
              <span class="usage-bar-x">{{ fmtDay(d.date) }}</span>
            </div>
          </div>
          <small class="muted">Grey = requests, red = blocked by the limit.</small>
        </div>

        <!-- Usage by model (this month, from billing) -->
        <div class="card usage-card">
          <div class="usage-card-h">AI calls by model — {{ usage.month.period }}</div>
          <table class="usage-table" v-if="usageModelRows().length">
            <thead><tr><th>Model</th><th>Calls</th><th>Cost</th></tr></thead>
            <tbody>
              <tr v-for="r in usageModelRows()" :key="r.model">
                <td>{{ r.model }}</td><td>{{ r.calls }}</td><td>{{ fmtUsd(r.costUsd) }}</td>
              </tr>
            </tbody>
            <tfoot><tr><td>Total</td><td>{{ usage.month.calls }}</td><td>{{ fmtUsd(usage.month.costUsd) }}</td></tr></tfoot>
          </table>
          <p v-else class="muted sm-text">No metered calls yet this month.</p>
        </div>

        <!-- Recent activity log -->
        <div class="card usage-card" v-if="usage.recent && usage.recent.length">
          <div class="usage-card-h">Recent activity</div>
          <table class="usage-table">
            <thead><tr><th>When</th><th>Type</th><th>Model</th><th>Cost</th></tr></thead>
            <tbody>
              <tr v-for="(e, i) in usage.recent" :key="i">
                <td>{{ fmtTs(e.ts) }}</td><td>{{ e.kind }}{{ e.cached ? ' (cached)' : '' }}</td><td>{{ e.model }}</td><td>{{ fmtUsd(e.costUsd) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </div>

    <!-- ── Quota tab (fair TTS allocation across families) ─────────────────── -->
    <div v-if="tab === 'quota'" class="usage-wrap">
      <div class="toolbar">
        <h3 class="llm-h" style="margin:0">Daily TTS quota allocation</h3>
        <button class="btn sm" :disabled="quotaLoading" @click="loadQuota">{{ quotaLoading ? "…" : "Refresh" }}</button>
      </div>
      <p class="muted sm-text">
        Your Gemini key shares ONE daily speech pool across all families. Reserve a slice for platform jobs
        (Qaida/Quran audio), then the rest is split between families by weight. Raise the reserve when you
        need to mass-generate platform audio; lower it so families get more for their own activities.
      </p>
      <p v-if="quotaError" class="error">{{ quotaError }}</p>
      <p v-if="quotaMsg" class="ok">{{ quotaMsg }}</p>

      <template v-if="quotaForm && quota">
        <!-- Global pool -->
        <div class="card usage-card">
          <div class="usage-card-h">Daily pool (from your Gemini tier)</div>
          <div v-for="(rpd, m) in quotaForm.models" :key="m" class="quota-row">
            <code>{{ m }}</code>
            <label>RPD <input type="number" min="0" v-model.number="quotaForm.models[m]" /></label>
          </div>
          <label class="quota-reserve">Platform reserve %
            <input type="number" min="0" max="100" v-model.number="quotaForm.platformReservePct" />
            <span class="muted sm-text">held back for Qaida/Quran generation</span>
          </label>
        </div>

        <!-- Allocation table -->
        <div class="card usage-card">
          <div class="usage-card-h">Who gets what ({{ quota.today }})</div>
          <table class="usage-table">
            <thead><tr><th>Who</th><th>Weight</th><th>Daily TTS budget</th><th>Used today</th></tr></thead>
            <tbody>
              <tr>
                <td>🏛 Platform (Qaida/Quran)</td>
                <td>—</td>
                <td>{{ quota.alloc.platform[quota.primaryModel] }}</td>
                <td :class="{ over: quota.platformUsed >= quota.alloc.platform[quota.primaryModel] }">{{ quota.platformUsed }}</td>
              </tr>
              <tr v-for="id in quota.familyIds" :key="id">
                <td>{{ quota.names[id] }}</td>
                <td><input class="quota-weight" type="number" min="0" v-model.number="quotaForm.familyWeights[id]" /></td>
                <td>{{ quota.alloc.families[id][quota.primaryModel] }}</td>
                <td :class="{ over: quota.familiesUsed[id] >= quota.alloc.families[id][quota.primaryModel] }">{{ quota.familiesUsed[id] || 0 }}</td>
              </tr>
            </tbody>
          </table>
          <small class="muted">Budgets shown for <code>{{ quota.primaryModel }}</code>. Edit weights/reserve above, then Save (allocation recomputes on save).</small>
        </div>

        <div class="quran-actions">
          <button class="btn primary" :disabled="quotaSaving" @click="saveQuota">{{ quotaSaving ? "Saving…" : "Save allocation" }}</button>
        </div>
      </template>
      <p v-else-if="quotaLoading" class="muted">Loading…</p>
    </div>

    <!-- ── Costs tab ────────────────────────────────────────────────────── -->
    <div v-if="tab === 'costs'" class="costs-wrap">
      <div class="toolbar">
        <label class="month-pick">Month
          <select v-model="costMonth" @change="loadCostOverview" :disabled="costLoading">
            <option v-for="m in (costOverview?.months || [costMonth])" :key="m" :value="m">{{ m }}</option>
          </select>
        </label>
        <button class="btn sm" @click="loadCostOverview" :disabled="costLoading">
          {{ costLoading ? "Loading…" : "Refresh" }}
        </button>
      </div>

      <p v-if="costError" class="error">{{ costError }}</p>
      <p v-else-if="costLoading && !costOverview" class="muted">Loading costs…</p>

      <template v-else-if="costOverview">
        <!-- Platform summary -->
        <div class="card cost-summary">
          <div class="qstat"><strong>{{ fmtUsd(costOverview.selected.costUsd) }}</strong><span>spend · {{ costMonth }}</span></div>
          <div class="qstat"><strong>{{ costOverview.selected.calls || 0 }}</strong><span>AI calls</span></div>
          <div class="qstat"><strong>{{ costOverview.families.length }}</strong><span>families billed</span></div>
        </div>

        <!-- 6-month trend -->
        <div class="card">
          <h3 class="llm-h">6-month trend</h3>
          <div class="trend">
            <div v-for="t in costOverview.trend" :key="t.period" class="trend-col" :title="`${t.period}: ${fmtUsd(t.costUsd)} (${t.calls} calls)`">
              <div class="trend-bar-wrap">
                <div class="trend-bar" :style="{ height: (100 * t.costUsd / trendMax) + '%' }"></div>
              </div>
              <span class="trend-amt">{{ fmtUsd(t.costUsd) }}</span>
              <span class="trend-lbl">{{ t.period.slice(5) }}</span>
            </div>
          </div>
        </div>

        <!-- Per-family table -->
        <div class="card">
          <h3 class="llm-h">By family</h3>
          <p v-if="!costOverview.families.length" class="muted sm-text">No spend recorded for {{ costMonth }}.</p>
          <table v-else class="cost-table">
            <thead><tr><th>Family</th><th class="num">Spend</th><th class="num">Calls</th><th></th></tr></thead>
            <tbody>
              <tr v-for="f in costOverview.families" :key="f.familyId">
                <td>{{ f.name }} <code class="fam-id">{{ f.familyId }}</code></td>
                <td class="num">{{ fmtUsd(f.costUsd) }}</td>
                <td class="num">{{ f.calls }}</td>
                <td><button class="linkish" @click="openFamilyCost(f)">Details</button></td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Family drill-in -->
        <div v-if="costDetail" class="card cost-detail">
          <div class="detail-head">
            <h3 class="llm-h">{{ costDetail.name }} <code class="fam-id">{{ costDetail.familyId }}</code></h3>
            <button class="linkish" @click="costDetail = null">Close</button>
          </div>
          <p v-if="costDetail.loading" class="muted sm-text">Loading detail…</p>
          <p v-else-if="costDetail.error" class="error sm-text">{{ costDetail.error }}</p>
          <template v-else>
            <div class="qstat inline"><strong>{{ fmtUsd(costDetail.monthly.costUsd) }}</strong><span>{{ costDetail.month }} · {{ costDetail.monthly.calls || 0 }} calls</span></div>

            <!-- Daily series -->
            <div v-if="costDetail.daily?.length" class="trend daily">
              <div v-for="d in costDetail.daily" :key="d.period" class="trend-col" :title="`${d.period}: ${fmtUsd(d.costUsd)} (${d.calls} calls)`">
                <div class="trend-bar-wrap sm">
                  <div class="trend-bar" :style="{ height: (100 * d.costUsd / dailyMax) + '%' }"></div>
                </div>
                <span class="trend-lbl">{{ d.period.slice(8) }}</span>
              </div>
            </div>

            <!-- Breakdowns -->
            <div class="breakdowns">
              <div class="bd-col">
                <h4>By agent</h4>
                <div v-for="r in breakdownRows(costDetail.monthly.byAgent)" :key="r.key" class="bd-row">
                  <span class="bd-key">{{ r.key }}</span><span class="bd-val">{{ fmtUsd(r.costUsd) }}</span>
                </div>
              </div>
              <div class="bd-col">
                <h4>By model</h4>
                <div v-for="r in breakdownRows(costDetail.monthly.byModel)" :key="r.key" class="bd-row">
                  <span class="bd-key">{{ r.key }}</span><span class="bd-val">{{ fmtUsd(r.costUsd) }}</span>
                </div>
              </div>
              <div class="bd-col">
                <h4>By kind</h4>
                <div v-for="r in breakdownRows(costDetail.monthly.byKind)" :key="r.key" class="bd-row">
                  <span class="bd-key">{{ r.key }}</span><span class="bd-val">{{ fmtUsd(r.costUsd) }}</span>
                </div>
              </div>
            </div>

            <!-- Raw event log -->
            <h4 class="log-h">Recent calls (deep log)</h4>
            <table class="cost-table log">
              <thead><tr><th>When</th><th>Source</th><th>Model</th><th class="num">Tokens</th><th class="num">Cost</th></tr></thead>
              <tbody>
                <tr v-for="e in costDetail.events" :key="e.id">
                  <td>{{ fmtTs(e.ts) }}</td>
                  <td>{{ e.source || e.agentKey }} <span class="kind-tag" :class="e.kind">{{ e.kind }}</span><span v-if="e.cached" class="kind-tag cached">cached</span></td>
                  <td><code>{{ e.model }}</code></td>
                  <td class="num">{{ e.usage?.totalTokens || (e.usage?.inputTokens || 0) + (e.usage?.outputTokens || 0) || (e.usage?.images ? e.usage.images + ' img' : '—') }}</td>
                  <td class="num">{{ fmtUsd(e.costUsd) }}</td>
                </tr>
              </tbody>
            </table>
            <p v-if="!costDetail.events?.length" class="muted sm-text">No call events recorded.</p>
            <button v-if="costDetail.nextCursor" class="btn sm" :disabled="costMoreLoading" @click="loadMoreEvents">
              {{ costMoreLoading ? "Loading…" : "Load more" }}
            </button>
          </template>
        </div>
      </template>
    </div>

    <!-- ── LLM Config tab — per agent ───────────────────────────────────── -->
    <div v-if="tab === 'llm'" class="llm-wrap">
      <p v-if="llmLoading" class="muted">Loading…</p>

      <template v-else>
        <p class="llm-intro muted">
          Each agent can run its own model + settings, or inherit the global default.
          System instructions are prepended to that agent's prompt on every run.
        </p>
        <div class="model-tools">
          <button class="btn" :disabled="testingModels" @click="runTestAllModels">
            {{ testingModels ? "Testing..." : "Test all models" }}
          </button>
          <span v-if="modelLoading" class="muted sm-text">Loading model catalog...</span>
        </div>

        <table v-if="testResults.length" class="model-results">
          <thead><tr><th>Agent</th><th>Model</th><th>Status</th><th>Latency</th></tr></thead>
          <tbody>
            <tr v-for="r in testResults" :key="r.agentKey">
              <td>{{ r.agentKey }}</td>
              <td><code>{{ r.model }}</code></td>
              <td :class="r.ok ? 'ok' : 'error'">{{ r.ok ? (r.skipped ? "skipped" : "ok") : r.error }}</td>
              <td>{{ r.latencyMs != null ? `${r.latencyMs}ms` : "-" }}</td>
            </tr>
          </tbody>
        </table>

        <!-- Global default -->
        <div class="llm-card card">
          <h3 class="llm-h">Global default</h3>
          <p class="llm-desc muted">Used wherever an agent doesn't set its own value.</p>
          <label>Model ID
            <input v-model="llmDefault.model" type="text" placeholder="gemini-2.5-flash" />
          </label>
          <div v-if="modelById('text', llmDefault.model)" class="model-detail compact">
            <div class="md-chips">
              <span class="md-chip"><span class="md-chip-l">Cost</span>{{ modelById('text', llmDefault.model).cost }}</span>
              <span class="md-chip"><span class="md-chip-l">Speed</span>{{ modelById('text', llmDefault.model).speed }}</span>
              <span class="md-chip"><span class="md-chip-l">Price</span>{{ modelById('text', llmDefault.model).pricing }}</span>
            </div>
            <p class="md-when"><span class="md-when-l">When to use</span> {{ modelById('text', llmDefault.model).whenToUse }}</p>
          </div>
          <small v-else class="md-custom">Custom model ID — not in the curated catalog.</small>
          <div class="llm-row">
            <label>Temperature <span class="range-val">({{ llmDefault.temperature }})</span>
              <input v-model.number="llmDefault.temperature" type="range" min="0" max="2" step="0.05" />
            </label>
            <label>Max output tokens
              <input v-model.number="llmDefault.maxOutputTokens" type="number" min="256" max="65536" step="256" />
            </label>
          </div>
          <label>Thinking budget <span class="range-val">({{ llmDefault.thinkingBudget === 0 ? 'off' : llmDefault.thinkingBudget }})</span>
            <input v-model.number="llmDefault.thinkingBudget" type="range" min="0" max="24576" step="512" />
          </label>
          <label>System instructions <span class="opt">(optional)</span>
            <textarea v-model="llmDefault.systemInstructions" rows="3" placeholder="Prepended to every agent's system prompt…"></textarea>
          </label>
        </div>

        <!-- Per-agent cards -->
        <div v-for="k in llmKeys" :key="k" class="llm-card card">
          <h3 class="llm-h">{{ agentMeta(k).label }} <code class="agent-key">{{ k }}</code></h3>
          <p class="llm-desc muted">{{ agentMeta(k).desc }}</p>

          <label v-if="agentMeta(k).kind === 'tts'">Provider
            <select v-model="llmAgents[k].provider" @change="onTtsProviderChange(k)">
              <option value="gemini">Google Gemini</option>
              <option value="openai">OpenAI</option>
            </select>
            <small>OpenAI is billed per use (no free daily quota) — useful as a fallback when the Gemini TTS quota is spent. Requires the <code>OPENAI_API_KEY</code> secret.</small>
          </label>

          <label>Model ID
            <select v-if="catalogFor(k).length" v-model="llmAgents[k].model" @change="onAgentModelChange(k)">
              <option v-for="m in catalogFor(k)" :key="m.id" :value="m.id">
                {{ m.label }}{{ m.recommended ? ' ★' : '' }} — {{ m.id }}
              </option>
            </select>
            <input v-else v-model="llmAgents[k].model" type="text" placeholder="gemini-2.5-flash" />
          </label>

          <!-- Rich detail for the selected model -->
          <div v-if="selectedModel(k)" class="model-detail">
            <div class="md-head">
              <strong>{{ selectedModel(k).label }}</strong>
              <span v-if="selectedModel(k).recommended" class="md-rec">Recommended</span>
            </div>
            <div class="md-chips">
              <span class="md-chip"><span class="md-chip-l">Cost</span>{{ selectedModel(k).cost }}</span>
              <span class="md-chip"><span class="md-chip-l">Speed</span>{{ selectedModel(k).speed }}</span>
              <span v-if="selectedModel(k).pricing" class="md-chip"><span class="md-chip-l">Price</span>{{ selectedModel(k).pricing }}</span>
              <span v-if="selectedModel(k).latency" class="md-chip"><span class="md-chip-l">Latency</span>{{ selectedModel(k).latency }}</span>
            </div>
            <p class="md-quality">{{ selectedModel(k).quality }}</p>
            <p v-if="selectedModel(k).whenToUse" class="md-when">
              <span class="md-when-l">When to use</span> {{ selectedModel(k).whenToUse }}
            </p>
            <details v-if="catalogFor(k).length > 1" class="md-compare">
              <summary>Compare all {{ catalogFor(k).length }} {{ agentMeta(k).kind }} models</summary>
              <table class="md-table">
                <thead><tr><th>Model</th><th>Cost</th><th>Speed</th><th>When to use it</th></tr></thead>
                <tbody>
                  <tr v-for="m in catalogFor(k)" :key="m.id" :class="{ sel: m.id === llmAgents[k]?.model }">
                    <td>
                      <span class="md-t-name">{{ m.label }}</span>
                      <code class="md-t-id">{{ m.id }}</code>
                    </td>
                    <td>{{ m.cost }}<br><span class="md-t-sub">{{ m.pricing }}</span></td>
                    <td>{{ m.speed }}<br><span class="md-t-sub">{{ m.latency }}</span></td>
                    <td class="md-t-when">{{ m.whenToUse }}</td>
                  </tr>
                </tbody>
              </table>
            </details>
          </div>
          <small v-else class="md-custom">{{ modelNote(k) }}</small>

          <template v-if="agentMeta(k).kind === 'text'">
            <div class="llm-row">
              <label>Temperature <span class="range-val">({{ llmAgents[k].temperature }})</span>
                <input v-model.number="llmAgents[k].temperature" type="range" min="0" max="2" step="0.05" />
              </label>
              <label>Max output tokens
                <input v-model.number="llmAgents[k].maxOutputTokens" type="number" min="256" max="65536" step="256" />
              </label>
            </div>
            <label>Thinking budget <span class="range-val">({{ llmAgents[k].thinkingBudget === 0 ? 'off' : llmAgents[k].thinkingBudget }})</span>
              <input v-model.number="llmAgents[k].thinkingBudget" type="range" min="0" max="24576" step="512" />
            </label>
          </template>

          <label v-if="agentMeta(k).kind === 'tts'">Voice name
            <select v-if="voicesFor(k).length" v-model="llmAgents[k].voiceName">
              <option v-for="v in voicesFor(k)" :key="v" :value="v">{{ v }}</option>
            </select>
            <input v-else v-model="llmAgents[k].voiceName" type="text" :placeholder="ttsProvider(k) === 'openai' ? 'alloy' : 'Kore'" />
            <small v-if="ttsProvider(k) === 'openai'">OpenAI voice, e.g. <code>alloy</code>, <code>nova</code>, <code>shimmer</code>.</small>
            <small v-else>Gemini prebuilt voice, e.g. <code>Kore</code>, <code>Puck</code>, <code>Charon</code>.</small>
          </label>

          <label v-if="agentMeta(k).kind === 'text'">System instructions <span class="opt">(optional)</span>
            <textarea v-model="llmAgents[k].systemInstructions" rows="3" placeholder="Prepended to this agent's system prompt…"></textarea>
          </label>

          <div class="preview-row">
            <button class="btn sm" :disabled="previewing[k]" @click="runPreview(k)">
              {{ previewing[k] ? "Previewing..." : "Preview" }}
            </button>
            <span v-if="previewResults[k]?.ok" class="ok sm-text">
              OK {{ previewResults[k].latencyMs != null ? `(${previewResults[k].latencyMs}ms)` : "" }}
            </span>
            <span v-else-if="previewResults[k]?.error" class="error sm-text">
              {{ previewResults[k].error }}
            </span>
          </div>
          <p v-if="previewResults[k]?.output" class="preview-output">{{ previewResults[k].output }}</p>
        </div>

        <div class="llm-actions">
          <p v-if="llmError" class="error">{{ llmError }}</p>
          <p v-if="llmSaved" class="ok">Saved.</p>
          <button class="btn primary" :disabled="llmSaving" @click="saveLlmConfig">
            {{ llmSaving ? "Saving…" : "Save all agent settings" }}
          </button>
        </div>
      </template>
    </div>

    <!-- ── Quran data tab ───────────────────────────────────────────────── -->
    <div v-if="tab === 'quran'" class="card quran-panel">
      <h3 class="llm-h">Quran corpus</h3>
      <p class="llm-desc muted">
        Import the full Qur'an once from public no-key sources so activities can draw verified
        verses from any surah. Stored in the shared <code>quran/*</code> collection.
      </p>

      <p v-if="quranLoading" class="muted">Checking status…</p>
      <template v-else>
        <div class="quran-stats">
          <div class="qstat"><strong>{{ quran.importedSurahs }}</strong><span>/ {{ quran.totalSurahs }} surahs</span></div>
          <div class="qstat"><strong>{{ quran.verses }}</strong><span>verses</span></div>
          <span class="status-badge" :class="quran.done ? 'active' : 'disabled'">{{ quran.done ? 'complete' : 'incomplete' }}</span>
        </div>
        <p class="muted sm-text">Source: AlQuran.Cloud text, translation, and transliteration with public recitation audio links.</p>

        <div class="quran-progress" v-if="quran.totalSurahs">
          <div class="quran-bar" :style="{ width: (100 * quran.importedSurahs / quran.totalSurahs) + '%' }"></div>
        </div>

        <p v-if="quranMsg" class="ok">{{ quranMsg }}</p>
        <p v-if="quranError" class="error">{{ quranError }}</p>

        <div class="quran-actions">
          <button class="btn primary" :disabled="quranImporting" @click="runQuranImport(false)">
            {{ quranImporting ? "Importing…" : (quran.done ? "Re-check / resume" : "Import full Quran") }}
          </button>
          <button class="btn" :disabled="quranImporting" @click="runQuranImport(true)" title="Re-import every surah">
            Force re-import
          </button>
          <button v-if="quran.done" class="btn" @click="openQuranBrowser">
            {{ quranBrowserOpen ? "Hide browser" : "Browse corpus" }}
          </button>
        </div>
        <small class="muted">Imports run in batches and resume safely if interrupted.</small>

        <!-- ── Corpus browser ───────────────────────────────────────────── -->
        <div v-if="quranBrowserOpen" class="quran-browser">
          <p v-if="quranBrowserLoading" class="muted">Loading corpus…</p>
          <p v-if="quranBrowserError" class="error">{{ quranBrowserError }}</p>

          <template v-if="quranSurahList.length">
            <!-- Surah selector row -->
            <div class="quran-selector-row">
              <select v-model="quranSelectedSurahNum" class="quran-surah-select" @change="stopQuranBrowserAudio">
                <option v-for="s in quranSurahList" :key="s.surah" :value="s.surah">
                  {{ s.surah }}. {{ s.nameArabic }} — {{ s.nameSimple }} ({{ s.ayahCount }} verses)
                </option>
              </select>
              <button v-if="quranSelectedSurah?.chapterAudioUrl" class="btn sm"
                      :class="{ primary: quranPlayingUrl === quranSelectedSurah.chapterAudioUrl }"
                      @click="playQuranAudio(quranSelectedSurah.chapterAudioUrl)"
                      title="Play / pause full chapter recitation">
                {{ quranPlayingUrl === quranSelectedSurah.chapterAudioUrl ? "⏸ Chapter" : "▶ Chapter" }}
              </button>
            </div>

            <!-- Verse list -->
            <div v-if="quranSelectedSurah" class="quran-verse-list">
              <div v-for="v in quranSelectedSurah.verses" :key="v.ayah" class="quran-verse-row">
                <span class="quran-ayah-num">{{ v.ayah }}</span>
                <div class="quran-verse-body">
                  <div class="quran-arabic font-arabic" dir="rtl">{{ v.arabic }}</div>
                  <div class="quran-translit muted">{{ v.transliteration }}</div>
                  <div class="quran-translation">{{ v.translation }}</div>
                </div>
                <button v-if="v.audioUrl" class="btn sm quran-play-btn"
                        :class="{ primary: quranPlayingUrl === v.audioUrl }"
                        @click="playQuranAudio(v.audioUrl)"
                        title="Play / pause this ayah">
                  {{ quranPlayingUrl === v.audioUrl ? "⏸" : "▶" }}
                </button>
              </div>
            </div>
          </template>
        </div>
      </template>
    </div>

    <!-- ── Noorani Qaida tab ────────────────────────────────────────────────── -->
    <div v-if="tab === 'qaida'" class="card quran-panel">
      <h3 class="llm-h">Noorani Qaida library</h3>
      <p class="llm-desc muted">
        Import the standard Noorani Qaida lessons once. Each glyph gets a deterministic
        spell-out script (e.g. <code>قَلْب</code> → “Qaaf Zabar Qa – Laam Jazm Ll – Bay Jazm Bb – Qalb”)
        and shared TTS audio. Stored in <code>nooraniQaida/*</code> for every family.
      </p>

      <p v-if="qaidaLoading" class="muted">Checking status…</p>
      <template v-else>
        <div class="quran-stats">
          <div class="qstat"><strong>{{ qaida.importedLessons }}</strong><span>/ {{ qaida.totalLessons }} lessons</span></div>
          <div class="qstat"><strong>{{ qaida.withAudio }}</strong><span>/ {{ qaida.items }} words voiced</span></div>
          <span class="status-badge" :class="qaida.audioDone ? 'active' : 'disabled'">{{ qaida.audioDone ? 'complete' : (qaida.importDone ? 'audio pending' : 'not imported') }}</span>
        </div>

        <div class="quran-progress" v-if="qaida.items">
          <div class="quran-bar" :style="{ width: (100 * qaida.withAudio / Math.max(1, qaida.items)) + '%' }"></div>
        </div>

        <p v-if="qaidaJobActive" class="ok">
          🔊 Auto-generating audio… {{ qaidaJob.processed || 0 }}/{{ qaidaJob.total || qaida.items }} words.
          {{ qaidaJob.pacing || 'It paces itself under the free TTS limit and resumes on its own — safe to leave this page.' }}
        </p>
        <p v-if="qaidaJobActive && qaidaJob.lastError" class="muted sm-text" style="color:#b45309">⏳ {{ qaidaJob.lastError }}</p>
        <p v-else-if="qaidaJob && qaidaJob.status === 'paused'" class="sm-text" style="color:#b45309">⏸ {{ qaidaJob.error || 'Paused. Click Restart audio to resume.' }}</p>
        <p v-else-if="qaidaJob && qaidaJob.status === 'error'" class="error">Audio job stopped: {{ qaidaJob.error || 'some words failed to synthesize.' }}</p>
        <p v-if="qaidaMsg" class="ok">{{ qaidaMsg }}</p>
        <p v-if="qaidaError" class="error">{{ qaidaError }}</p>

        <!-- ── Bulk generation plan: provider/model choice + live cost estimate ── -->
        <div v-if="qaida.importDone && qaida.audioRemaining > 0 && !qaidaJobActive" class="qaida-plan">
          <h4 class="qaida-plan-h">Generation plan</h4>
          <div class="llm-row qaida-plan-row">
            <label>Provider
              <select v-model="qaidaPlan.mode">
                <option value="gemini">Gemini only</option>
                <option value="openai">OpenAI only</option>
                <option value="distribute">Distribute across both</option>
              </select>
            </label>
            <label v-if="qaidaPlan.mode !== 'openai'">Gemini model
              <select v-model="qaidaPlan.models.gemini">
                <option v-for="m in ttsModelsByProvider('gemini')" :key="m.id" :value="m.id">{{ m.label }}</option>
              </select>
            </label>
            <label v-if="qaidaPlan.mode !== 'gemini'">OpenAI model
              <select v-model="qaidaPlan.models.openai">
                <option v-for="m in ttsModelsByProvider('openai')" :key="m.id" :value="m.id">{{ m.label }}</option>
              </select>
            </label>
            <label>Test limit (words)
              <input v-model.number="qaidaPlan.maxWords" type="number" min="0" step="1" placeholder="all" class="qaida-maxwords" />
            </label>
          </div>
          <div class="qaida-est">
            <div class="qaida-est-head">
              Estimated cost for {{ qaidaEstimate.items }} word{{ qaidaEstimate.items === 1 ? '' : 's' }}:
              <strong>{{ fmtUsd(qaidaEstimate.totalUsd) }}</strong>
            </div>
            <table class="qaida-est-table">
              <tr v-for="r in qaidaEstimate.rows" :key="r.provider">
                <td class="qaida-est-prov">{{ r.provider }}</td>
                <td><code>{{ r.model }}</code></td>
                <td>{{ r.items }} words</td>
                <td class="qaida-est-usd">{{ fmtUsd(r.usd) }}</td>
              </tr>
            </table>
            <small class="muted">Rough estimate. In “distribute” mode the workload is split across providers in proportion to their request-rate limits (RPM); actual may shift toward OpenAI if Gemini's daily quota is reached. Set a test limit to voice only the first N words.</small>
          </div>
        </div>

        <div class="quran-actions">
          <button class="btn primary" :disabled="qaidaBusy" @click="runQaidaImport(false)">
            {{ qaida.importDone ? "Re-check / resume" : "Import Qaida lessons" }}
          </button>
          <button v-if="!qaidaJobActive" class="btn" :disabled="qaidaBusy || !qaida.importDone || qaida.audioRemaining === 0" @click="runQaidaAudio" :title="qaidaJobStopped ? 'Restart the audio job from where it stopped' : 'Generate missing audio on the server'">
            {{ qaida.audioRemaining === 0 && qaida.importDone ? "Audio complete" : (qaidaJobStopped ? `Restart audio (${qaida.audioRemaining} left)` : `Generate audio (${qaida.audioRemaining} left)`) }}
          </button>
          <button v-else class="btn danger" @click="stopQaidaAudioJob" title="Stop the running audio job">
            Stop audio
          </button>
          <button class="btn" :disabled="qaidaBusy || qaidaJobActive || !qaida.withAudio" @click="runQaidaAudioDelete" title="Delete all generated audio (keeps lessons + scripts)">
            Delete audio
          </button>
          <button class="btn" :disabled="qaidaBusy || qaidaJobActive" @click="runQaidaImport(true)" title="Re-import every lesson (keeps existing audio)">
            Force re-import
          </button>
          <button class="btn danger" :disabled="qaidaBusy || qaidaJobActive || !qaida.importedLessons" @click="runQaidaDelete" title="Delete the entire library to regenerate from scratch">
            Delete all
          </button>
        </div>
        <small class="muted">Audio is generated by a background worker that paces itself (~48 clips/day) to stay under the free Gemini TTS limit and auto-resumes across days — full coverage takes a few days, no restart needed. Uses your TTS provider + voice from LLM config (Gemini or OpenAI); identical scripts reuse the shared cache. Safe to close the tab.</small>

        <!-- Per-word audit -->
        <div v-for="lesson in qaidaLessons" :key="lesson.lessonId" class="qaida-lesson">
          <h4 class="qaida-lesson-h">{{ lesson.title }}</h4>
          <div class="qaida-grid">
            <div v-for="item in lesson.items" :key="item.glyph" class="qaida-item">
              <div class="qaida-glyph font-arabic">{{ item.glyph }}</div>
              <div class="qaida-script">
                <div class="qaida-translit">{{ item.translit }}</div>
                <div class="qaida-tts-text font-arabic" dir="rtl" :title="'Exact text sent to TTS'">{{ item.ttsScript || item.spellScript }}</div>
                <div v-if="item.audioInstruction" class="qaida-instr">↻ {{ item.audioInstruction }}</div>
                <div v-if="item.audioVoice" class="qaida-instr">🎙 <span v-if="item.audioProvider">{{ item.audioProvider }} · </span>{{ item.audioVoice }}<span v-if="item.audioModel"> · {{ item.audioModel }}</span></div>
              </div>
              <div class="qaida-item-actions">
                <button class="btn sm" :disabled="!item.audioUrl" @click="playQaida(item.audioUrl)" :title="item.audioUrl ? 'Play saved audio' : 'No audio yet'">▶</button>
                <input v-model="qaidaInstruction[`${lesson.lessonId}|${item.glyph}`]" class="qaida-instr-input" placeholder="instruction (optional)" />
                <!-- Per-take TTS overrides ("" = global default). Applied to this generation only. -->
                <select v-model="item.ovProvider" class="qaida-ov" title="TTS provider for this take only" @change="onOvProviderChange(item)">
                  <option value="">provider: default</option>
                  <option value="gemini">Gemini</option>
                  <option value="openai">OpenAI</option>
                </select>
                <select v-model="item.ovVoice" class="qaida-ov" title="Voice for this take only">
                  <option value="">voice: default</option>
                  <option v-for="v in ovVoices(item)" :key="v" :value="v">{{ v }}</option>
                </select>
                <select v-model="item.ovModel" class="qaida-ov" title="TTS model for this take only" @change="onOvModelChange(item)">
                  <option value="">model: default</option>
                  <option v-for="m in ovTtsModels(item)" :key="m.id" :value="m.id">{{ m.label }}</option>
                </select>
                <!-- Auditioning a fresh take: replay / save / discard before it touches the corpus. -->
                <template v-if="qaidaPreview[`${lesson.lessonId}|${item.glyph}`]">
                  <span class="qaida-preview-tag" title="This take is not saved yet">preview</span>
                  <button class="btn sm" @click="playQaida(qaidaPreview[`${lesson.lessonId}|${item.glyph}`].url)" title="Replay the preview">▶</button>
                  <button class="btn sm primary" :disabled="qaidaSaving === `${lesson.lessonId}|${item.glyph}`" @click="saveQaida(lesson.lessonId, item.glyph)">
                    {{ qaidaSaving === `${lesson.lessonId}|${item.glyph}` ? "…" : "Save" }}
                  </button>
                  <button class="btn sm" :disabled="qaidaSaving === `${lesson.lessonId}|${item.glyph}`" @click="discardQaida(`${lesson.lessonId}|${item.glyph}`)">Discard</button>
                </template>
                <button v-else class="btn sm" :disabled="qaidaRegenFor === `${lesson.lessonId}|${item.glyph}`" @click="regenQaida(lesson.lessonId, item.glyph)" title="Generate a new take to preview">
                  {{ qaidaRegenFor === `${lesson.lessonId}|${item.glyph}` ? "…" : "Regen" }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>
  </section>
</template>

<style scoped>
.platform { max-width: 780px; display: flex; flex-direction: column; gap: 1.25rem; }
.head { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.75rem; }
h1 { margin: 0; }

.tabs { display: flex; gap: 0; border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden; }
.tabs button { padding: 0.45rem 1rem; border: none; background: #fff; cursor: pointer; font: inherit; font-size: 0.875rem; color: #475569; }
.tabs button.active { background: #0b1f3a; color: #fff; }

.toolbar { display: flex; align-items: center; gap: 1rem; margin-bottom: 0.25rem; }
.count { font-size: 0.85rem; color: #64748b; }

.family-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; margin-bottom: 0.75rem; }
.family-row { display: flex; align-items: flex-start; justify-content: space-between; padding: 1rem 1.25rem; gap: 1rem; flex-wrap: wrap; }
.family-info { display: flex; flex-direction: column; gap: 0.2rem; min-width: 0; }
.family-name { font-size: 1rem; color: #1e293b; }
.fam-meta { font-size: 0.8rem; }
.fam-id { font-size: 0.72rem; color: #94a3b8; background: #f1f5f9; padding: 0.1rem 0.4rem; border-radius: 4px; }
.family-actions { display: flex; align-items: center; gap: 0.5rem; flex-shrink: 0; flex-wrap: wrap; }

.status-badge { font-size: 0.7rem; font-weight: 700; padding: 0.15rem 0.6rem; border-radius: 999px; text-transform: uppercase; }
.status-badge.active { background: #dcfce7; color: #15803d; }
.status-badge.disabled { background: #fee2e2; color: #b91c1c; }

.members-panel { border-top: 1px solid #f1f5f9; padding: 0.85rem 1.25rem; background: #f8fafc; }
.members-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
.members-table th { text-align: left; color: #64748b; font-weight: 600; padding: 0.3rem 0.5rem; }
.members-table td { padding: 0.35rem 0.5rem; border-top: 1px solid #f1f5f9; }
.member-name { font-weight: 500; color: #1e293b; }
.role-select { padding: 0.2rem 0.4rem; border: 1px solid #cbd5e1; border-radius: 6px; font: inherit; font-size: 0.8rem; }

.llm-form { display: flex; flex-direction: column; gap: 1rem; }
.card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 1.25rem; }

.llm-wrap { display: flex; flex-direction: column; gap: 1rem; }
.llm-intro { font-size: 0.85rem; margin: 0; }
.llm-card { display: flex; flex-direction: column; gap: 0.85rem; }
.llm-h { margin: 0; font-size: 1rem; color: #1e293b; display: flex; align-items: center; gap: 0.5rem; }
.agent-key { font-size: 0.72rem; color: #64748b; background: #f1f5f9; padding: 0.1rem 0.4rem; border-radius: 4px; font-weight: 400; }
.llm-desc { margin: -0.4rem 0 0; font-size: 0.82rem; }
.llm-row { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
.llm-actions { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; position: sticky; bottom: 0; background: #f8fafc; padding: 0.75rem 0; }
.model-tools, .preview-row { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
.model-results { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; font-size: 0.82rem; }
.model-results th, .model-results td { text-align: left; padding: 0.45rem 0.6rem; border-bottom: 1px solid #f1f5f9; }
.model-results th { color: #64748b; background: #f8fafc; font-weight: 600; }
.preview-output { margin: -0.35rem 0 0; font-size: 0.82rem; color: #334155; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 0.55rem 0.7rem; }

/* Rich model detail */
.model-detail { margin: -0.35rem 0 0; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 0.7rem 0.8rem; display: flex; flex-direction: column; gap: 0.5rem; }
.model-detail.compact { padding: 0.55rem 0.7rem; gap: 0.4rem; }
.md-head { display: flex; align-items: center; gap: 0.5rem; }
.md-head strong { font-size: 0.9rem; color: #1e293b; }
.md-rec { font-size: 0.62rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; color: #15803d; background: #dcfce7; padding: 0.12rem 0.45rem; border-radius: 999px; }
.md-chips { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.md-chip { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.76rem; color: #334155; background: #fff; border: 1px solid #e2e8f0; border-radius: 999px; padding: 0.18rem 0.55rem; font-variant-numeric: tabular-nums; }
.md-chip-l { font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; color: #94a3b8; }
.md-quality { margin: 0; font-size: 0.82rem; color: #475569; }
.md-when { margin: 0; font-size: 0.82rem; color: #334155; background: #eff6ff; border: 1px solid #dbeafe; border-radius: 8px; padding: 0.45rem 0.6rem; }
.md-when-l { font-weight: 700; color: #1d4ed8; margin-right: 0.35rem; }
.md-custom { color: #94a3b8; font-size: 0.8rem; }
.md-compare summary { cursor: pointer; font-size: 0.8rem; color: #2563eb; user-select: none; }
.md-compare[open] summary { margin-bottom: 0.5rem; }
.md-table { width: 100%; border-collapse: collapse; font-size: 0.78rem; }
.md-table th { text-align: left; color: #64748b; font-weight: 600; padding: 0.35rem 0.5rem; border-bottom: 1px solid #e2e8f0; }
.md-table td { padding: 0.4rem 0.5rem; border-top: 1px solid #f1f5f9; vertical-align: top; color: #334155; }
.md-table tr.sel td { background: #eff6ff; }
.md-t-name { display: block; font-weight: 600; color: #1e293b; }
.md-t-id { font-size: 0.68rem; color: #94a3b8; }
.md-t-sub { font-size: 0.7rem; color: #94a3b8; font-variant-numeric: tabular-nums; }
.md-t-when { max-width: 22rem; }

.quran-panel { display: flex; flex-direction: column; gap: 0.85rem; }
.quran-stats { display: flex; align-items: center; gap: 1.5rem; }
.qstat { display: flex; flex-direction: column; }
.qstat strong { font-size: 1.4rem; color: #0b1f3a; }
.qstat span { font-size: 0.78rem; color: #64748b; }
.quran-progress { height: 8px; background: #e2e8f0; border-radius: 999px; overflow: hidden; }
.quran-bar { height: 100%; background: #16a34a; transition: width 0.3s; }

/* Usage dashboard */
.usage-wrap { display: flex; flex-direction: column; gap: 0.85rem; }
.alerts { display: flex; flex-direction: column; gap: 0.6rem; }
.alert { display: flex; gap: 0.7rem; align-items: flex-start; padding: 0.7rem 0.9rem; border-radius: 10px; border: 1px solid #e2e8f0; background: #fff; }
.alert.ok { border-left: 4px solid #16a34a; }
.alert.warn { border-left: 4px solid #d97706; background: #fffbeb; }
.alert.danger { border-left: 4px solid #dc2626; background: #fef2f2; }
.alert-icon { font-size: 1.2rem; line-height: 1.4; }
.alert-title { font-weight: 600; color: #1e293b; }
.alert-detail { font-size: 0.85rem; color: #475569; }
.usage-card { display: flex; flex-direction: column; gap: 0.5rem; }
.usage-card-h { font-weight: 600; color: #0b1f3a; }
.usage-gauge-row { display: flex; align-items: baseline; gap: 0.5rem; }
.usage-gauge-row strong { font-size: 1.5rem; color: #0b1f3a; }
.usage-gauge { height: 10px; background: #e2e8f0; border-radius: 999px; overflow: hidden; }
.usage-gauge-fill { height: 100%; background: #16a34a; transition: width 0.3s; }
.usage-gauge-fill.over { background: #dc2626; }
.usage-bars { display: flex; align-items: flex-end; gap: 4px; height: 60px; padding-top: 6px; }
.usage-bar-col { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; position: relative; min-width: 0; }
.usage-bar { width: 70%; background: #94a3b8; border-radius: 2px 2px 0 0; min-height: 1px; }
.usage-bar-err { width: 70%; background: #dc2626; border-radius: 2px 2px 0 0; }
.usage-bar-x { font-size: 0.6rem; color: #94a3b8; margin-top: 2px; white-space: nowrap; }
.usage-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
.usage-table th, .usage-table td { text-align: left; padding: 0.35rem 0.5rem; border-bottom: 1px solid #f1f5f9; }
.usage-table th { color: #64748b; font-weight: 600; }
.usage-table tfoot td { font-weight: 600; border-top: 2px solid #e2e8f0; }
.usage-table td.over { color: #b91c1c; font-weight: 700; }
.quota-row { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 0.3rem 0; }
.quota-row code { font-size: 0.8rem; }
.quota-row input, .quota-reserve input { width: 5rem; font: inherit; padding: 0.25rem 0.4rem; border: 1px solid #cbd5e1; border-radius: 6px; }
.quota-reserve { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.5rem; font-size: 0.85rem; color: #334155; }
.quota-weight { width: 3.5rem; font: inherit; padding: 0.2rem 0.35rem; border: 1px solid #cbd5e1; border-radius: 6px; }

.qaida-lesson { margin-top: 1.1rem; }
.qaida-lesson-h { margin: 0 0 0.5rem; font-size: 0.95rem; color: #0b1f3a; }
.qaida-grid { display: grid; grid-template-columns: 1fr; gap: 0.5rem; }
.qaida-item { display: flex; align-items: center; gap: 0.75rem; padding: 0.55rem 0.7rem; border: 1px solid #e2e8f0; border-radius: 10px; background: #fff; flex-wrap: wrap; }
.qaida-glyph { font-size: 1.8rem; min-width: 2.5rem; text-align: center; color: #0b1f3a; }
.qaida-script { flex: 1; min-width: 12rem; }
.qaida-translit { font-weight: 600; color: #1e293b; }
.qaida-spell { font-size: 0.8rem; }
.qaida-tts-text { font-size: 0.82rem; color: #334155; line-height: 1.5; word-break: break-word; }
.qaida-instr { font-size: 0.72rem; color: #2563eb; }
.qaida-item-actions { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
.qaida-instr-input { font: inherit; font-size: 0.78rem; padding: 0.25rem 0.45rem; border: 1px solid #cbd5e1; border-radius: 6px; width: 11rem; }
.qaida-preview-tag { font-size: 0.68rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; color: #b45309; background: #fef3c7; border-radius: 5px; padding: 0.1rem 0.4rem; }
.qaida-ov { font: inherit; font-size: 0.74rem; padding: 0.22rem 0.3rem; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; color: #334155; max-width: 9rem; }
.btn.sm { padding: 0.25rem 0.55rem; font-size: 0.78rem; }
.quran-actions { display: flex; gap: 0.6rem; flex-wrap: wrap; }
@media (max-width: 560px) { .llm-row { grid-template-columns: 1fr; } }
label { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.875rem; color: #334155; }
input[type="text"], input[type="number"], textarea, select { padding: 0.5rem 0.65rem; border: 1px solid #cbd5e1; border-radius: 8px; font: inherit; background: #fff; }
input[type="range"] { accent-color: #0b1f3a; }
small { color: #94a3b8; font-size: 0.8rem; }
.range-val { font-weight: 400; color: #64748b; }
.opt { font-weight: 400; color: #94a3b8; }

.btn { padding: 0.5rem 1rem; border-radius: 8px; border: 1px solid #cbd5e1; background: #fff; cursor: pointer; font: inherit; font-size: 0.875rem; }
.btn.primary { background: #0b1f3a; color: #fff; border-color: transparent; }
.btn.sm { padding: 0.3rem 0.7rem; font-size: 0.8rem; }
.btn.danger { border-color: #fca5a5; color: #b91c1c; }
.btn:disabled { opacity: 0.6; cursor: not-allowed; }
.linkish { background: none; border: none; cursor: pointer; font: inherit; font-size: 0.8rem; padding: 0; color: #2563eb; }
.linkish.danger { color: #b91c1c; }

/* Costs tab */
.costs-wrap { display: flex; flex-direction: column; gap: 1rem; }
.month-pick { flex-direction: row; align-items: center; gap: 0.5rem; font-size: 0.85rem; }
.month-pick select { padding: 0.3rem 0.5rem; }
.cost-summary { display: flex; gap: 2rem; flex-wrap: wrap; }
.qstat.inline { flex-direction: row; align-items: baseline; gap: 0.5rem; }
.trend { display: flex; align-items: flex-end; gap: 0.5rem; height: 140px; }
.trend.daily { height: 90px; gap: 0.2rem; overflow-x: auto; }
.trend-col { display: flex; flex-direction: column; align-items: center; gap: 0.2rem; flex: 1; min-width: 0; }
.trend-bar-wrap { display: flex; align-items: flex-end; width: 100%; max-width: 48px; height: 100px; background: #f1f5f9; border-radius: 6px 6px 0 0; }
.trend-bar-wrap.sm { height: 60px; max-width: 22px; }
.trend-bar { width: 100%; background: #0b1f3a; border-radius: 6px 6px 0 0; min-height: 2px; transition: height 0.3s; }
.trend-amt { font-size: 0.72rem; color: #334155; font-weight: 600; }
.trend-lbl { font-size: 0.7rem; color: #94a3b8; }
.cost-table { width: 100%; border-collapse: collapse; font-size: 0.84rem; }
.cost-table th { text-align: left; color: #64748b; font-weight: 600; padding: 0.4rem 0.5rem; border-bottom: 1px solid #e2e8f0; }
.cost-table td { padding: 0.4rem 0.5rem; border-top: 1px solid #f1f5f9; }
.cost-table .num { text-align: right; font-variant-numeric: tabular-nums; }
.cost-table.log code { font-size: 0.76rem; }
.cost-detail { display: flex; flex-direction: column; gap: 0.85rem; }
.detail-head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.breakdowns { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; }
.bd-col h4 { margin: 0 0 0.4rem; font-size: 0.82rem; color: #475569; }
.bd-row { display: flex; justify-content: space-between; gap: 0.5rem; font-size: 0.8rem; padding: 0.15rem 0; border-bottom: 1px solid #f8fafc; }
.bd-key { color: #334155; }
.bd-val { font-variant-numeric: tabular-nums; color: #0b1f3a; font-weight: 600; }
.log-h { margin: 0.5rem 0 0; font-size: 0.85rem; color: #475569; }
.kind-tag { font-size: 0.65rem; font-weight: 700; padding: 0.05rem 0.35rem; border-radius: 999px; text-transform: uppercase; margin-left: 0.35rem; background: #e0e7ff; color: #3730a3; }
.kind-tag.tts { background: #dcfce7; color: #15803d; }
.qaida-plan { margin: 0.75rem 0; padding: 0.85rem 1rem; border: 1px solid #e5e7eb; border-radius: 10px; background: #fafafa; }
.qaida-plan-h { margin: 0 0 0.5rem; font-size: 0.95rem; }
.qaida-plan-row { flex-wrap: wrap; gap: 0.75rem; }
.qaida-maxwords { width: 5rem; }
.qaida-est { margin-top: 0.6rem; }
.qaida-est-head { font-size: 0.95rem; margin-bottom: 0.3rem; }
.qaida-est-table { border-collapse: collapse; font-size: 0.85rem; margin: 0.2rem 0 0.4rem; }
.qaida-est-table td { padding: 0.15rem 0.75rem 0.15rem 0; }
.qaida-est-prov { text-transform: capitalize; font-weight: 600; }
.qaida-est-usd { font-variant-numeric: tabular-nums; }
.kind-tag.image { background: #fef3c7; color: #92400e; }
.kind-tag.cached { background: #f1f5f9; color: #64748b; }
@media (max-width: 560px) { .breakdowns { grid-template-columns: 1fr; } }

.muted { color: #64748b; }
.sm-text { font-size: 0.82rem; }
.error { color: #b91c1c; font-size: 0.875rem; margin: 0; }
.ok { color: #15803d; font-size: 0.875rem; margin: 0; }
.empty { color: #94a3b8; }

/* Quran corpus browser */
.quran-browser { margin-top: 0.85rem; border-top: 1px solid #e2e8f0; padding-top: 0.85rem; display: flex; flex-direction: column; gap: 0.75rem; }
.quran-selector-row { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
.quran-surah-select { flex: 1; min-width: 14rem; }
.quran-verse-list { display: flex; flex-direction: column; gap: 0.5rem; max-height: 62vh; overflow-y: auto; padding-right: 0.25rem; }
.quran-verse-row { display: flex; align-items: flex-start; gap: 0.65rem; padding: 0.6rem 0.75rem; border: 1px solid #e2e8f0; border-radius: 10px; background: #fff; }
.quran-ayah-num { font-size: 0.72rem; font-weight: 700; color: #94a3b8; min-width: 1.6rem; padding-top: 0.35rem; flex-shrink: 0; }
.quran-verse-body { flex: 1; display: flex; flex-direction: column; gap: 0.2rem; min-width: 0; }
.quran-arabic { font-size: 1.25rem; line-height: 1.75; color: #0b1f3a; word-break: break-word; }
.quran-translit { font-size: 0.77rem; font-style: italic; }
.quran-translation { font-size: 0.82rem; color: #334155; }
.quran-play-btn { flex-shrink: 0; align-self: flex-start; margin-top: 0.2rem; min-width: 2.2rem; }
</style>
