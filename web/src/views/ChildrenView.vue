<script setup>
import { ref } from "vue";
import { useAuthStore } from "@/stores/auth";
import { useProfilesStore } from "@/stores/profiles";
import { newChild, addChild, updateChild, deleteChild } from "@/services/profiles";

const auth = useAuthStore();
const profiles = useProfilesStore();

const editing = ref(null);
const form = ref(newChild());
const busy = ref(false);
const error = ref("");

const canEdit = () => ["owner", "parent"].includes(auth.role);

function startNew() { form.value = newChild(); editing.value = "new"; error.value = ""; }
function startEdit(c) { form.value = { ...newChild(), ...c }; editing.value = c.id; error.value = ""; }
function cancel() { editing.value = null; }

async function save() {
  error.value = "";
  if (!form.value.name.trim()) { error.value = "Name is required."; return; }
  busy.value = true;
  try {
    const data = { ...form.value };
    delete data.id;
    if (editing.value === "new") await addChild(auth.familyId, data);
    else await updateChild(auth.familyId, editing.value, data);
    editing.value = null;
  } catch (e) {
    error.value = e?.message || "Could not save.";
  } finally {
    busy.value = false;
  }
}
async function remove(c) {
  if (!confirm(`Remove ${c.name}?`)) return;
  await deleteChild(auth.familyId, c.id);
}
</script>

<template>
  <section class="children">
    <header class="head">
      <h1>Children</h1>
      <button v-if="canEdit() && !editing" class="btn primary" @click="startNew">Add child</button>
    </header>

    <form v-if="editing" class="card form" @submit.prevent="save">
      <h2>{{ editing === "new" ? "New child" : "Edit child" }}</h2>
      <div class="grid">
        <label>Name<input v-model="form.name" type="text" /></label>
        <label>Date of birth<input v-model="form.dob" type="date" /></label>
        <label class="wide">Strengths<textarea v-model="form.strengths" rows="2"></textarea></label>
        <label class="wide">Weaknesses<textarea v-model="form.weaknesses" rows="2"></textarea></label>
        <label class="wide">Goals<textarea v-model="form.goals" rows="3" placeholder="What do you want this child to achieve? The AI curriculum will use this."></textarea></label>
        <label class="wide">Comments<textarea v-model="form.comments" rows="2"></textarea></label>
      </div>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div class="actions">
        <button class="btn primary" type="submit" :disabled="busy">{{ busy ? "Saving…" : "Save" }}</button>
        <button class="btn" type="button" @click="cancel">Cancel</button>
      </div>
    </form>

    <p v-if="!profiles.children.length && !editing" class="empty">No children yet.</p>

    <ul class="list">
      <li v-for="c in profiles.children" :key="c.id" class="card">
        <div class="row">
          <strong>{{ c.name }}</strong>
          <div v-if="canEdit()" class="rowbtns">
            <button class="linkish" @click="startEdit(c)">Edit</button>
            <button class="linkish danger" @click="remove(c)">Delete</button>
          </div>
        </div>
        <p v-if="c.goals" class="muted goals">Goals: {{ c.goals }}</p>
        <p v-if="c.strengths" class="muted">Strengths: {{ c.strengths }}</p>
        <p v-if="c.weaknesses" class="muted">Weaknesses: {{ c.weaknesses }}</p>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.head { display: flex; justify-content: space-between; align-items: center; }
.card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 1rem 1.25rem; margin-bottom: 0.75rem; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
.grid .wide { grid-column: 1 / -1; }
label { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.85rem; color: #334155; }
input, textarea { padding: 0.5rem 0.6rem; border: 1px solid #cbd5e1; border-radius: 8px; font: inherit; }
.actions { display: flex; gap: 0.5rem; margin-top: 0.75rem; }
.btn { padding: 0.5rem 1rem; border-radius: 8px; border: 1px solid #cbd5e1; background: #fff; cursor: pointer; }
.btn.primary { background: #0b1f3a; color: #fff; border-color: transparent; }
.list { list-style: none; padding: 0; margin: 0; }
.row { display: flex; justify-content: space-between; align-items: center; }
.rowbtns { display: flex; gap: 0.75rem; }
.linkish { background: none; border: none; color: #2563eb; cursor: pointer; font: inherit; padding: 0; }
.linkish.danger { color: #b91c1c; }
.muted { color: #64748b; margin: 0.3rem 0 0; }
.goals { color: #1e293b; font-style: italic; }
.empty { color: #94a3b8; }
.error { color: #b91c1c; }
</style>
