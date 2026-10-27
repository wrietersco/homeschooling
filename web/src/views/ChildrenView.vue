<script setup>
import { ref } from "vue";
import { useAuthStore } from "@/stores/auth";
import { useProfilesStore } from "@/stores/profiles";
import { newChild, addChild, updateChild, deleteChild } from "@/services/profiles";
import { photoToDataUrl } from "@/lib/imageResize";
import ChildAvatar from "@/components/ChildAvatar.vue";

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
// Profile photo: shrunk to a small square on this device, saved with the child.
const photoInput = ref(null);
const photoBusy = ref(false);
async function onPhotoPicked(e) {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  photoBusy.value = true;
  error.value = "";
  try {
    form.value.photo = await photoToDataUrl(file);
  } catch (err) {
    error.value = err?.message || "Could not use that picture.";
  } finally {
    photoBusy.value = false;
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
      <div class="photo-row">
        <button type="button" class="photo-pick" :disabled="photoBusy" aria-label="Choose a photo" @click="photoInput?.click()">
          <img v-if="form.photo" :src="form.photo" alt="" />
          <svg v-else viewBox="0 0 64 64" aria-hidden="true">
            <circle cx="32" cy="32" r="31" fill="#FFE3EC" />
            <circle cx="32" cy="26" r="11" fill="#FF8FB1" />
            <path d="M12 54 Q32 30 52 54 Z" fill="#FF8FB1" />
          </svg>
          <span class="photo-cam">
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="7" width="18" height="13" rx="3" fill="#7B3FD1" /><path d="M8 7 L9.5 4 H14.5 L16 7 Z" fill="#7B3FD1" /><circle cx="12" cy="13.5" r="3.6" fill="#fff" /></svg>
          </span>
        </button>
        <div class="photo-text">
          <strong>{{ photoBusy ? "Getting the photo ready…" : form.photo ? "Looking good!" : "Add a photo" }}</strong>
          <span class="muted">Tap the circle to choose a picture.</span>
          <button v-if="form.photo" type="button" class="linkish danger" @click="form.photo = ''">Remove photo</button>
        </div>
        <input ref="photoInput" class="photo-input" type="file" accept="image/*" aria-label="Child photo" @change="onPhotoPicked" />
      </div>
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
          <span class="who"><ChildAvatar :child="c" :size="48" /><strong>{{ c.name }}</strong></span>
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
.who { display: flex; align-items: center; gap: 0.75rem; }
.photo-row { display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem; }
.photo-pick {
  position: relative; width: 96px; height: 96px; flex-shrink: 0; padding: 0; border: 4px solid #fff;
  border-radius: 50%; background: #fff; cursor: pointer; box-shadow: 0 4px 0 rgba(58, 43, 82, 0.18), 0 0 0 2px #f3e8ff;
}
.photo-pick img, .photo-pick > svg { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; display: block; }
.photo-cam {
  position: absolute; right: -4px; bottom: -4px; width: 36px; height: 36px; border-radius: 50%;
  background: #fff; display: grid; place-items: center; box-shadow: 0 2px 0 rgba(58, 43, 82, 0.2);
}
.photo-cam svg { width: 22px; height: 22px; }
.photo-text { display: flex; flex-direction: column; gap: 0.15rem; align-items: flex-start; }
.photo-text .muted { margin: 0; font-size: 0.85rem; }
.photo-input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
</style>
