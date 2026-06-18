<script setup>
import { ref, onMounted } from "vue";
import {
  listFamilies, setFamilyStatus, listFamilyMembers,
  setMemberRole, removeMember, deleteFamily,
  getLlmConfig, setLlmConfig, deleteSyllabus,
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
  image: { label: "Storybook images", desc: "Generates story illustrations.", kind: "image" },
  tts: { label: "Text-to-speech", desc: "Reads words/phrases aloud (Gemini voices).", kind: "tts" },
};
const llmDefault = ref({ model: "gemini-2.5-flash", temperature: 0.4, maxOutputTokens: 2048, thinkingBudget: 0, systemInstructions: "" });
const llmAgents = ref({});
const llmKeys = ref([]);
const llmLoading = ref(false);
const llmSaving = ref(false);
const llmSaved = ref(false);
const llmError = ref("");

function agentMeta(k) { return AGENT_META[k] || { label: k, desc: "", kind: "text" }; }

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

onMounted(() => {
  loadFamilies();
  loadLlmConfig();
});
</script>

<template>
  <section class="platform">
    <header class="head">
      <h1>Platform admin</h1>
      <nav class="tabs">
        <button :class="{ active: tab === 'families' }" @click="tab = 'families'">Families</button>
        <button :class="{ active: tab === 'llm' }" @click="tab = 'llm'">LLM config</button>
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

    <!-- ── LLM Config tab — per agent ───────────────────────────────────── -->
    <div v-if="tab === 'llm'" class="llm-wrap">
      <p v-if="llmLoading" class="muted">Loading…</p>

      <template v-else>
        <p class="llm-intro muted">
          Each agent can run its own model + settings, or inherit the global default.
          System instructions are prepended to that agent's prompt on every run.
        </p>

        <!-- Global default -->
        <div class="llm-card card">
          <h3 class="llm-h">Global default</h3>
          <p class="llm-desc muted">Used wherever an agent doesn't set its own value.</p>
          <label>Model ID
            <input v-model="llmDefault.model" type="text" placeholder="gemini-2.5-flash" />
          </label>
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

          <label>Model ID
            <input v-model="llmAgents[k].model" type="text" placeholder="gemini-2.5-flash" />
          </label>

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
            <input v-model="llmAgents[k].voiceName" type="text" placeholder="Kore" />
            <small>Gemini prebuilt voice, e.g. <code>Kore</code>, <code>Puck</code>, <code>Charon</code>.</small>
          </label>

          <label v-if="agentMeta(k).kind === 'text'">System instructions <span class="opt">(optional)</span>
            <textarea v-model="llmAgents[k].systemInstructions" rows="3" placeholder="Prepended to this agent's system prompt…"></textarea>
          </label>
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
@media (max-width: 560px) { .llm-row { grid-template-columns: 1fr; } }
label { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.875rem; color: #334155; }
input[type="text"], input[type="number"], textarea { padding: 0.5rem 0.65rem; border: 1px solid #cbd5e1; border-radius: 8px; font: inherit; }
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

.muted { color: #64748b; }
.sm-text { font-size: 0.82rem; }
.error { color: #b91c1c; font-size: 0.875rem; margin: 0; }
.ok { color: #15803d; font-size: 0.875rem; margin: 0; }
.empty { color: #94a3b8; }
</style>
