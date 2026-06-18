<script setup>
import { ref, nextTick, computed } from "vue";
import { collection, query, orderBy, onSnapshot, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthStore } from "@/stores/auth";
import { useCurriculumStore } from "@/stores/curriculum";
import { askCurriculum } from "@/services/curriculum";
import { deleteCurriculum } from "@/services/admin";

const auth = useAuthStore();
const curriculumStore = useCurriculumStore();

// Owners/parents (and superadmin) may delete a generated curriculum.
const canDelete = computed(() => ["owner", "parent"].includes(auth.role) || auth.isSuperAdmin);
const deletingId = ref("");
async function removeCurriculum(c) {
  if (!confirm(`Delete curriculum "${c.title || "Untitled"}" and all its subjects?\n\nThis cannot be undone.`)) return;
  deletingId.value = c.id;
  try {
    await deleteCurriculum(c.id);
    if (expanded.value === c.id) { expanded.value = null; subjects.value = []; }
  } catch (e) {
    alert(e?.message || "Could not delete the curriculum.");
  } finally {
    deletingId.value = "";
  }
}

// Chat state
const messages = ref([]);
const input = ref("");
const busy = ref(false);
const error = ref("");
const listEl = ref(null);
// Gemini-format history accumulated across turns for multi-turn context.
const geminiHistory = ref([]);
const justCreated = ref(null); // {id, title, subjectCount}

// Curriculum detail panel
const expanded = ref(null); // curriculum id currently expanded
const subjects = ref([]); // subjects for the expanded curriculum
const loadingSubjects = ref(false);

async function scrollDown() {
  await nextTick();
  if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight;
}

async function send() {
  const text = input.value.trim();
  if (!text || busy.value) return;
  error.value = "";
  messages.value.push({ role: "user", text });
  input.value = "";
  busy.value = true;
  await scrollDown();
  try {
    const res = await askCurriculum(text, geminiHistory.value);
    messages.value.push({ role: "assistant", text: res.text, configured: res.configured });
    // Accumulate history for the next turn (Gemini format).
    geminiHistory.value = [
      ...geminiHistory.value,
      { role: "user", parts: [{ text }] },
      { role: "model", parts: [{ text: res.text }] },
    ];
    if (res.curriculum) {
      justCreated.value = res.curriculum;
    }
  } catch (e) {
    error.value = e?.message || "The curriculum agent could not respond.";
  } finally {
    busy.value = false;
    await scrollDown();
  }
}

async function expandCurriculum(curriculumId) {
  if (expanded.value === curriculumId) {
    expanded.value = null;
    subjects.value = [];
    return;
  }
  expanded.value = curriculumId;
  subjects.value = [];
  loadingSubjects.value = true;
  try {
    const snap = await getDocs(
      query(
        collection(db, "families", auth.familyId, "curriculum", curriculumId, "subjects"),
        orderBy("createdAt", "asc")
      )
    );
    subjects.value = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } finally {
    loadingSubjects.value = false;
  }
}
</script>

<template>
  <section class="curriculum">
    <h1>Curriculum Builder</h1>
    <p class="lede">
      Chat with the AI curriculum architect. It will interview you about your vision,
      study your family's guiding light, and generate a personalised 6-month plan.
    </p>

    <!-- Existing curricula -->
    <div v-if="curriculumStore.curricula.length" class="plans-section">
      <h2>Your Plans</h2>
      <div
        v-for="c in curriculumStore.curricula"
        :key="c.id"
        class="plan-card"
        :class="{ active: c.status === 'active', expanded: expanded === c.id }"
      >
        <div class="plan-header" @click="expandCurriculum(c.id)" role="button" tabindex="0"
          @keydown.enter="expandCurriculum(c.id)">
          <div class="plan-meta">
            <span class="plan-title">{{ c.title || "Untitled Curriculum" }}</span>
            <span class="plan-badge" :class="c.status">{{ c.status }}</span>
            <span class="plan-subjects">{{ c.subjectCount }} subject{{ c.subjectCount !== 1 ? "s" : "" }}</span>
          </div>
          <div class="plan-head-right">
            <button
              v-if="canDelete"
              class="del-btn"
              :disabled="deletingId === c.id"
              title="Delete this curriculum"
              @click.stop="removeCurriculum(c)"
            >{{ deletingId === c.id ? "…" : "🗑 Delete" }}</button>
            <span class="chevron">{{ expanded === c.id ? "▲" : "▼" }}</span>
          </div>
        </div>

        <div v-if="expanded === c.id" class="plan-body">
          <p class="plan-objectives">{{ c.objectives }}</p>
          <p v-if="c.guidingLightSnapshot" class="guiding-light">
            <strong>Guiding light:</strong> {{ c.guidingLightSnapshot }}
          </p>
          <div v-if="loadingSubjects" class="subjects-loading">Loading subjects…</div>
          <div v-else-if="subjects.length" class="subjects-list">
            <details v-for="s in subjects" :key="s.id" class="subject">
              <summary>{{ s.name }}</summary>
              <div class="subject-body">
                <div v-if="s.macroGoals?.length" class="field">
                  <strong>Goals</strong>
                  <ul><li v-for="g in s.macroGoals" :key="g">{{ g }}</li></ul>
                </div>
                <div v-if="s.contentOutline" class="field">
                  <strong>Content outline</strong>
                  <p>{{ s.contentOutline }}</p>
                </div>
                <div v-if="s.instructionApproach" class="field">
                  <strong>Instruction approach</strong>
                  <p>{{ s.instructionApproach }}</p>
                </div>
                <div v-if="s.assessmentMethod" class="field">
                  <strong>Assessment</strong>
                  <p>{{ s.assessmentMethod }}</p>
                </div>
                <div v-if="s.gradingStandards" class="field">
                  <strong>Grading standards</strong>
                  <p>{{ s.gradingStandards }}</p>
                </div>
              </div>
            </details>
          </div>
          <p v-else class="no-subjects">No subjects yet.</p>
        </div>
      </div>
    </div>

    <!-- Just-created banner -->
    <div v-if="justCreated" class="success-banner" role="status">
      ✓ Curriculum "<strong>{{ justCreated.title }}</strong>" created with
      {{ justCreated.subjectCount }} subject{{ justCreated.subjectCount !== 1 ? "s" : "" }}!
      <button class="link-btn" @click="justCreated = null">Dismiss</button>
    </div>

    <!-- Chat -->
    <h2>Chat with the Curriculum Agent</h2>
    <div ref="listEl" class="thread" aria-live="polite">
      <p v-if="!messages.length" class="empty">
        Start by describing your educational vision or asking the agent to create a
        curriculum. E.g. "Create a 6-month plan focused on Islamic studies and mathematics."
      </p>
      <div v-for="(m, i) in messages" :key="i" class="msg" :class="m.role">
        <span class="who">{{ m.role === "user" ? "You" : "Curriculum Agent" }}</span>
        <p>{{ m.text }}</p>
      </div>
      <div v-if="busy" class="msg assistant">
        <span class="who">Curriculum Agent</span>
        <p class="dots">…</p>
      </div>
    </div>

    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <form class="composer" @submit.prevent="send">
      <input
        v-model="input"
        type="text"
        placeholder="Describe your vision or answer the agent's questions…"
        aria-label="Your message"
        :disabled="busy"
      />
      <button class="btn primary" type="submit" :disabled="busy || !input.trim()">Send</button>
    </form>
  </section>
</template>

<style scoped>
.curriculum { max-width: 780px; }
.lede { color: #475569; margin-bottom: 1.5rem; }

.plans-section { margin-bottom: 2rem; }
.plans-section h2 { font-size: 1rem; color: #334155; margin-bottom: 0.6rem; }

.plan-card {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  margin-bottom: 0.6rem;
  overflow: hidden;
}
.plan-card.active { border-color: #3b82f6; }

.plan-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  background: #f8fafc;
  cursor: pointer;
  user-select: none;
}
.plan-header:hover { background: #f1f5f9; }
.plan-meta { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
.plan-title { font-weight: 600; }
.plan-badge { font-size: 0.7rem; padding: 0.15rem 0.5rem; border-radius: 999px; background: #e2e8f0; color: #475569; }
.plan-badge.active { background: #dbeafe; color: #1d4ed8; }
.plan-subjects { font-size: 0.8rem; color: #94a3b8; }
.plan-head-right { display: flex; align-items: center; gap: 0.6rem; flex-shrink: 0; }
.del-btn { border: 1px solid #fca5a5; color: #b91c1c; background: #fff; border-radius: 6px; padding: 0.2rem 0.55rem; font-size: 0.75rem; cursor: pointer; }
.del-btn:hover { background: #fef2f2; }
.del-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.chevron { color: #94a3b8; font-size: 0.8rem; }

.plan-body { padding: 1rem; background: #fff; }
.plan-objectives { color: #334155; margin: 0 0 0.75rem; }
.guiding-light { font-size: 0.85rem; color: #64748b; font-style: italic; border-left: 3px solid #3b82f6; padding-left: 0.6rem; margin-bottom: 0.75rem; }
.subjects-loading { color: #94a3b8; }

.subjects-list { display: flex; flex-direction: column; gap: 0.5rem; }
.subject { border: 1px solid #e2e8f0; border-radius: 8px; }
.subject summary { padding: 0.5rem 0.75rem; cursor: pointer; font-weight: 600; list-style: none; }
.subject summary::before { content: "▶ "; font-size: 0.7rem; }
.subject[open] summary::before { content: "▼ "; }
.subject-body { padding: 0.5rem 0.75rem 0.75rem; display: flex; flex-direction: column; gap: 0.5rem; }
.field strong { display: block; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: #94a3b8; margin-bottom: 0.2rem; }
.field p, .field ul { margin: 0; font-size: 0.9rem; }
.field ul { padding-left: 1.2rem; }
.no-subjects { color: #94a3b8; }

.success-banner {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  background: #dcfce7;
  color: #15803d;
  padding: 0.65rem 1rem;
  border-radius: 8px;
  margin-bottom: 1.5rem;
  font-size: 0.95rem;
}
.link-btn { background: none; border: none; cursor: pointer; text-decoration: underline; color: inherit; font: inherit; }

h2 { font-size: 1rem; color: #334155; margin: 0 0 0.6rem; }
.thread {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 1rem;
  min-height: 220px;
  max-height: 50vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.empty { color: #94a3b8; }
.msg { display: flex; flex-direction: column; gap: 0.15rem; }
.msg .who { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.04em; color: #94a3b8; }
.msg p { margin: 0; padding: 0.5rem 0.75rem; border-radius: 10px; white-space: pre-wrap; }
.msg.user { align-items: flex-end; }
.msg.user p { background: #eef2ff; }
.msg.assistant p { background: #f1f5f9; }
.composer { display: flex; gap: 0.5rem; margin-top: 0.75rem; }
.composer input { flex: 1; padding: 0.6rem 0.7rem; border: 1px solid #cbd5e1; border-radius: 8px; }
.btn { padding: 0.6rem 1.1rem; border-radius: 8px; border: none; cursor: pointer; }
.btn.primary { background: #0b1f3a; color: #fff; }
.btn:disabled { opacity: 0.6; }
.error { color: #b91c1c; }
.dots { color: #94a3b8; }
</style>
