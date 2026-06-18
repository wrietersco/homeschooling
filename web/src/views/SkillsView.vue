<script setup>
import { ref, computed } from "vue";
import { useAuthStore } from "@/stores/auth";
import { useProfilesStore } from "@/stores/profiles";
import { useSkillsStore } from "@/stores/skills";
import {
  createGlobalSkill, adoptRegistrySkill, removeFamilySkill,
  bindSkillToChild, unbindSkillFromChild,
} from "@/services/skills";

const auth = useAuthStore();
const profiles = useProfilesStore();
const skills = useSkillsStore();

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
</style>
