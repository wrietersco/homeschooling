<script setup>
import { ref, computed, watch, onUnmounted } from "vue";
import { doc, collection, query, orderBy, limit, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthStore } from "@/stores/auth";
import { useProfilesStore } from "@/stores/profiles";
import { useSkillsStore } from "@/stores/skills";
import {
  createGlobalSkill, adoptRegistrySkill, removeFamilySkill,
  bindSkillToChild, unbindSkillFromChild, requestSkillMap,
} from "@/services/skills";

const auth = useAuthStore();
const profiles = useProfilesStore();
const skills = useSkillsStore();

// ─── Skill development map (server-side agent) ───────────────────────────────
const skillMap = ref(null);   // families/{id}/meta/skillMap — the rendered board
const mapRun = ref(null);     // latest skillmap agentRuns doc — live progress
const mapping = ref(false);
const mapError = ref("");
let stopMap = null;
let stopRun = null;

const canBuild = computed(() => ["owner", "parent"].includes(auth.role));
const mapRunning = computed(() => mapping.value || mapRun.value?.status === "running");
const mapChildren = computed(() =>
  Object.entries(skillMap.value?.children || {}).map(([id, v]) => ({ id, name: v.name || id, skills: v.skills || [] }))
);
const mapRunChildren = computed(() =>
  Object.entries(mapRun.value?.children || {}).map(([id, v]) => ({ id, ...v }))
);

const EXTENT_LABELS = { 1: "Introduced", 2: "Basic", 3: "Competent", 4: "Advanced", 5: "Mastered" };
const statusIcon = (s) => ({ pending: "⏳", running: "⟳", done: "✓", error: "✗" }[s] || "⏳");
function fmtMinutes(m) {
  m = Number(m) || 0;
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

function subscribe(familyId) {
  teardown();
  if (!familyId) return;
  stopMap = onSnapshot(doc(db, "families", familyId, "meta", "skillMap"),
    (s) => { skillMap.value = s.exists() ? s.data() : null; }, () => {});
  // Newest skillmap run (single orderBy → no composite index needed).
  stopRun = onSnapshot(
    query(collection(db, "families", familyId, "agentRuns"), orderBy("createdAt", "desc"), limit(8)),
    (snap) => {
      const r = snap.docs.map((d) => ({ id: d.id, ...d.data() })).find((d) => d.type === "skillmap");
      if (r) mapRun.value = r;
    }, () => {});
}
function teardown() {
  if (stopMap) { stopMap(); stopMap = null; }
  if (stopRun) { stopRun(); stopRun = null; }
}

async function buildMap() {
  if (!canBuild.value || mapping.value) return;
  mapping.value = true;
  mapError.value = "";
  try {
    const res = await requestSkillMap();
    if (res?.configured === false) mapError.value = res.text || "The skill-mapping agent isn't configured.";
  } catch (e) {
    mapError.value = e?.message || "Failed to build the skill map.";
  } finally {
    mapping.value = false;
  }
}

watch(() => auth.familyId, (id) => subscribe(id), { immediate: true });
onUnmounted(teardown);

const newName = ref("");
const newCategory = ref("");
const search = ref("");
const busy = ref(false);
const error = ref("");

const canEdit = () => ["owner", "parent"].includes(auth.role);

const adoptedIds = computed(() => new Set(skills.familySkills.map((s) => s.id)));

// Registry entries not yet adopted, filtered by search.
const availableRegistry = computed(() => {
  const q = search.value.trim().toLowerCase();
  return skills.registry.filter(
    (s) => !adoptedIds.value.has(s.id) && (!q || s.name.toLowerCase().includes(q))
  );
});

async function addNew() {
  error.value = "";
  if (!newName.value.trim()) { error.value = "Enter a skill name."; return; }
  busy.value = true;
  try {
    await createGlobalSkill({ name: newName.value.trim(), category: newCategory.value.trim() });
    newName.value = "";
    newCategory.value = "";
  } catch (e) {
    error.value = e?.message || "Could not add skill.";
  } finally {
    busy.value = false;
  }
}

async function adopt(s) {
  error.value = "";
  try { await adoptRegistrySkill(auth.familyId, s); }
  catch (e) { error.value = e?.message || "Could not adopt skill."; }
}
async function removeSkill(s) {
  if (!confirm(`Remove "${s.name}" from your family?`)) return;
  await removeFamilySkill(auth.familyId, s.id);
}
async function toggleChild(childId, skill) {
  if (skills.childHasSkill(childId, skill.id)) {
    await unbindSkillFromChild(auth.familyId, childId, skill.id);
  } else {
    await bindSkillToChild(auth.familyId, childId, skill);
  }
}
</script>

<template>
  <section class="skills">
    <h1>Skills</h1>
    <p class="lede">
      Choose the skills you want your children to develop. Skills you add become
      available to the whole system, but are tracked individually per child.
    </p>

    <!-- Skill development map (server-side agent) -->
    <div class="card skillmap-card">
      <div class="sm-head">
        <h2>Skill development map</h2>
        <button class="btn primary" :disabled="mapRunning || !canBuild" @click="buildMap">
          {{ mapRunning ? "Building…" : (mapChildren.length ? "Refresh skill map" : "Build skill map") }}
        </button>
      </div>
      <p class="sm-lede">
        An agent reviews your children, activities and guiding light, then maps which child
        develops which skill — through which activities, over how much time and to what extent.
        It also repairs which child each activity is for. Re-run any time your plan changes.
      </p>
      <p v-if="mapError" class="error" role="alert">{{ mapError }}</p>

      <!-- Live progress while the agent works, child by child -->
      <div v-if="mapRunning && mapRunChildren.length" class="sm-progress">
        <div class="sm-prog-head">
          Building map… {{ mapRun?.completedChildren || 0 }} / {{ mapRun?.totalChildren || mapRunChildren.length }} children
        </div>
        <div v-for="c in mapRunChildren" :key="c.id" class="sm-prog-row" :class="c.status">
          <span class="sm-prog-ico">{{ statusIcon(c.status) }}</span>
          <span class="sm-prog-name">{{ c.name }}</span>
          <span v-if="c.status === 'done'" class="sm-prog-meta">{{ c.skillCount }} skills · {{ c.activityCount }} activities</span>
          <span v-else-if="c.status === 'error'" class="sm-prog-err">{{ c.error }}</span>
          <span v-else class="sm-prog-meta">{{ c.status }}…</span>
        </div>
      </div>

      <!-- Rendered board -->
      <div v-if="mapChildren.length" class="sm-board">
        <div v-for="child in mapChildren" :key="child.id" class="sm-child">
          <h3 class="sm-child-name">{{ child.name }} <span class="muted">· {{ child.skills.length }} skill{{ child.skills.length === 1 ? "" : "s" }}</span></h3>
          <p v-if="!child.skills.length" class="muted">No skills mapped for this child.</p>
          <div v-for="s in child.skills" :key="s.skillId" class="sm-skill">
            <div class="sm-skill-head">
              <strong>{{ s.name }}</strong>
              <span v-if="s.category" class="sm-cat">{{ s.category }}</span>
              <span class="sm-ext" :class="`ext-${s.extent}`">{{ EXTENT_LABELS[s.extent] || s.extent }}</span>
              <span class="sm-time">⏱ {{ fmtMinutes(s.totalMinutes) }}</span>
            </div>
            <div class="sm-ext-bar"><div class="sm-ext-fill" :style="{ width: (s.extent * 20) + '%' }"></div></div>
            <div v-if="s.activities?.length" class="sm-acts">
              <span v-for="a in s.activities" :key="a.id" class="sm-act" :title="`${a.minutes} min`">{{ a.title }}</span>
            </div>
          </div>
        </div>
      </div>
      <p v-else-if="!mapRunning" class="muted sm-empty">
        No skill map yet — click <strong>Build skill map</strong> to generate it from your activities.
      </p>
    </div>

    <div v-if="canEdit()" class="card">
      <h2>Add a new skill</h2>
      <div class="addrow">
        <input v-model="newName" type="text" placeholder="Skill name (e.g. Arabic handwriting)" aria-label="Skill name" />
        <input v-model="newCategory" type="text" placeholder="Category (optional)" aria-label="Skill category" />
        <button class="btn primary" :disabled="busy" @click="addNew">Add</button>
      </div>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
    </div>

    <div class="card">
      <h2>Pick from the library</h2>
      <input v-model="search" type="search" class="search" placeholder="Search skills…" aria-label="Search skills" />
      <p v-if="!availableRegistry.length" class="muted">No matching skills in the library.</p>
      <ul class="chips">
        <li v-for="s in availableRegistry" :key="s.id">
          <button class="chip" :disabled="!canEdit()" @click="adopt(s)">+ {{ s.name }}</button>
        </li>
      </ul>
    </div>

    <div class="card">
      <h2>Your family's skills ({{ skills.familySkills.length }})</h2>
      <p v-if="!skills.familySkills.length" class="muted">None selected yet.</p>

      <table v-else class="matrix">
        <thead>
          <tr>
            <th>Skill</th>
            <th v-for="c in profiles.children" :key="c.id">{{ c.name }}</th>
            <th v-if="canEdit()"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in skills.familySkills" :key="s.id">
            <td>
              <strong>{{ s.name }}</strong>
              <span v-if="s.category" class="muted"> · {{ s.category }}</span>
            </td>
            <td v-for="c in profiles.children" :key="c.id" class="center">
              <input
                type="checkbox"
                :checked="skills.childHasSkill(c.id, s.id)"
                :disabled="!canEdit()"
                :aria-label="`Bind ${s.name} to ${c.name}`"
                @change="toggleChild(c.id, s)"
              />
            </td>
            <td v-if="canEdit()" class="center">
              <button class="linkish danger" @click="removeSkill(s)">Remove</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="skills.familySkills.length && !profiles.children.length" class="muted">
        Add children to bind skills to them.
      </p>
    </div>
  </section>
</template>

<style scoped>
.lede { color: #475569; }
.card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 1rem 1.25rem; margin-bottom: 1rem; }
.card h2 { font-size: 1rem; margin: 0 0 0.75rem; }
.addrow { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.addrow input { flex: 1; min-width: 160px; padding: 0.5rem 0.6rem; border: 1px solid #cbd5e1; border-radius: 8px; }
.search { width: 100%; padding: 0.5rem 0.6rem; border: 1px solid #cbd5e1; border-radius: 8px; margin-bottom: 0.75rem; }
.btn { padding: 0.5rem 1rem; border-radius: 8px; border: none; cursor: pointer; }
.btn.primary { background: #0b1f3a; color: #fff; }
.chips { list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 0.5rem; }
.chip { background: #eef2ff; border: 1px solid #c7d2fe; color: #3730a3; border-radius: 999px; padding: 0.35rem 0.75rem; cursor: pointer; }
.chip:disabled { opacity: 0.5; cursor: default; }
.matrix { width: 100%; border-collapse: collapse; }
.matrix th, .matrix td { text-align: left; padding: 0.5rem; border-bottom: 1px solid #eef2f7; }
.matrix .center { text-align: center; }
.muted { color: #64748b; }
.linkish { background: none; border: none; color: #2563eb; cursor: pointer; font: inherit; padding: 0; }
.linkish.danger { color: #b91c1c; }
.error { color: #b91c1c; }

/* ─── Skill development map ─────────────────────────────────────────────────── */
.skillmap-card { border-color: #c7d2fe; }
.sm-head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 0.5rem; }
.sm-head h2 { margin: 0; }
.sm-lede { color: #475569; font-size: 0.88rem; margin: 0 0 0.75rem; }
.btn:disabled { opacity: 0.55; cursor: not-allowed; }

.sm-progress { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 0.75rem; margin-bottom: 1rem; }
.sm-prog-head { font-size: 0.82rem; font-weight: 600; color: #334155; margin-bottom: 0.5rem; }
.sm-prog-row { display: flex; align-items: center; gap: 0.5rem; padding: 0.3rem 0.4rem; border-radius: 6px; font-size: 0.85rem; }
.sm-prog-row.running { background: #fffbeb; }
.sm-prog-row.done { background: #f0fdf4; }
.sm-prog-row.error { background: #fff1f2; }
.sm-prog-ico { width: 1.1rem; text-align: center; }
.sm-prog-name { flex: 1; font-weight: 500; color: #1e293b; }
.sm-prog-meta { font-size: 0.75rem; color: #64748b; }
.sm-prog-err { font-size: 0.75rem; color: #b91c1c; }

.sm-board { display: flex; flex-direction: column; gap: 1.25rem; }
.sm-child { border-top: 1px solid #eef2f7; padding-top: 0.85rem; }
.sm-child-name { font-size: 1rem; margin: 0 0 0.6rem; color: #0f172a; }
.sm-skill { background: #fbfcfe; border: 1px solid #eef2f7; border-radius: 10px; padding: 0.6rem 0.75rem; margin-bottom: 0.5rem; }
.sm-skill-head { display: flex; align-items: center; flex-wrap: wrap; gap: 0.5rem; }
.sm-skill-head strong { color: #1e293b; }
.sm-cat { font-size: 0.68rem; font-weight: 600; padding: 0.08rem 0.45rem; border-radius: 999px; background: #eef2ff; color: #3730a3; }
.sm-ext { font-size: 0.68rem; font-weight: 700; padding: 0.08rem 0.5rem; border-radius: 999px; background: #e2e8f0; color: #475569; }
.sm-ext.ext-1 { background: #dcfce7; color: #166534; } .sm-ext.ext-2 { background: #dbeafe; color: #1e40af; }
.sm-ext.ext-3 { background: #fef9c3; color: #854d0e; } .sm-ext.ext-4 { background: #fed7aa; color: #9a3412; }
.sm-ext.ext-5 { background: #f3e8ff; color: #6b21a8; }
.sm-time { font-size: 0.72rem; color: #64748b; margin-left: auto; }
.sm-ext-bar { height: 5px; border-radius: 999px; background: #eef2f7; overflow: hidden; margin: 0.4rem 0; }
.sm-ext-fill { height: 100%; border-radius: 999px; background: #6366f1; }
.sm-acts { display: flex; flex-wrap: wrap; gap: 0.3rem; }
.sm-act { font-size: 0.72rem; padding: 0.1rem 0.5rem; border-radius: 999px; background: #f1f5f9; color: #475569; }
.sm-empty { padding: 0.5rem 0; }
</style>
