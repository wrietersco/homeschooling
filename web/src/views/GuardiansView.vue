<script setup>
import { ref } from "vue";
import { useAuthStore } from "@/stores/auth";
import { useProfilesStore } from "@/stores/profiles";
import { useMembersStore } from "@/stores/members";
import { newGuardian, addGuardian, updateGuardian, deleteGuardian } from "@/services/profiles";

const auth = useAuthStore();
const profiles = useProfilesStore();
const membersStore = useMembersStore();

const editing = ref(null); // null | 'new' | guardianId
const form = ref(newGuardian());
const busy = ref(false);
const error = ref("");

const canEdit = () => ["owner", "parent"].includes(auth.role);

const FIELDS = [
  { key: "name", label: "Name", type: "text" },
  { key: "dob", label: "Date of birth", type: "date" },
  { key: "occupation", label: "Occupation", type: "text" },
  { key: "motherTongue", label: "Mother tongue", type: "text" },
  { key: "location", label: "Location / city", type: "text" },
  { key: "monthlyEducationBudget", label: "Monthly education budget", type: "text" },
  { key: "totalIncome", label: "Total monthly income", type: "text" },
  { key: "cityFacilities", label: "Facilities in your city", type: "textarea" },
  { key: "likes", label: "Likes", type: "textarea" },
  { key: "dislikes", label: "Dislikes", type: "textarea" },
  { key: "goals", label: "Goals for the children", type: "textarea" },
];

function startNew() {
  form.value = newGuardian();
  editing.value = "new";
  error.value = "";
}
function startEdit(g) {
  form.value = { ...newGuardian(), ...g };
  editing.value = g.id;
  error.value = "";
}
function cancel() {
  editing.value = null;
}

async function save() {
  error.value = "";
  if (!form.value.name.trim()) { error.value = "Name is required."; return; }
  busy.value = true;
  try {
    const data = { ...form.value };
    delete data.id;
    // Normalise: store null rather than "" for memberUid so Firestore is clean.
    if (!data.memberUid) data.memberUid = null;
    if (editing.value === "new") await addGuardian(auth.familyId, data);
    else await updateGuardian(auth.familyId, editing.value, data);
    editing.value = null;
  } catch (e) {
    error.value = e?.message || "Could not save.";
  } finally {
    busy.value = false;
  }
}

async function remove(g) {
  if (!confirm(`Remove ${g.name}?`)) return;
  await deleteGuardian(auth.familyId, g.id);
}

function memberName(uid) {
  if (!uid) return null;
  const m = membersStore.members.find((m) => m.uid === uid);
  return m ? (m.displayName || m.email || uid) : uid;
}
</script>

<template>
  <section class="guardians">
    <header class="head">
      <h1>Parents &amp; guardians</h1>
      <button v-if="canEdit() && !editing" class="btn primary" @click="startNew">Add guardian</button>
    </header>

    <form v-if="editing" class="card form" @submit.prevent="save">
      <h2>{{ editing === "new" ? "New guardian" : "Edit guardian" }}</h2>
      <div class="grid">
        <label v-for="f in FIELDS" :key="f.key" :class="{ wide: f.type === 'textarea' }">
          {{ f.label }}
          <textarea v-if="f.type === 'textarea'" v-model="form[f.key]" rows="2"></textarea>
          <input v-else v-model="form[f.key]" :type="f.type" />
        </label>

        <!-- Member account binding -->
        <label class="wide member-link-label">
          Linked family member account
          <select v-model="form.memberUid">
            <option :value="null">— not linked —</option>
            <option v-for="m in membersStore.members" :key="m.uid" :value="m.uid">
              {{ m.displayName || m.email || m.uid }} ({{ m.role }})
            </option>
          </select>
          <small>Link this guardian profile to an account so activity scores and observations are attributed correctly.</small>
        </label>
      </div>

      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div class="actions">
        <button class="btn primary" type="submit" :disabled="busy">{{ busy ? "Saving…" : "Save" }}</button>
        <button class="btn" type="button" @click="cancel">Cancel</button>
      </div>
    </form>

    <p v-if="!profiles.guardians.length && !editing" class="empty">No guardians yet.</p>

    <ul class="list">
      <li v-for="g in profiles.guardians" :key="g.id" class="card">
        <div class="row">
          <div>
            <strong>{{ g.name }}</strong>
            <span v-if="g.occupation" class="muted"> · {{ g.occupation }}</span>
            <span v-if="g.memberUid" class="linked-badge">
              linked: {{ memberName(g.memberUid) }}
            </span>
          </div>
          <div v-if="canEdit()" class="rowbtns">
            <button class="linkish" @click="startEdit(g)">Edit</button>
            <button class="linkish danger" @click="remove(g)">Delete</button>
          </div>
        </div>
        <p v-if="g.goals" class="muted goals">Goals: {{ g.goals }}</p>
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
input, textarea, select { padding: 0.5rem 0.6rem; border: 1px solid #cbd5e1; border-radius: 8px; font: inherit; }
.member-link-label small { color: #94a3b8; }
.actions { display: flex; gap: 0.5rem; margin-top: 0.75rem; }
.btn { padding: 0.5rem 1rem; border-radius: 8px; border: 1px solid #cbd5e1; background: #fff; cursor: pointer; }
.btn.primary { background: #0b1f3a; color: #fff; border-color: transparent; }
.list { list-style: none; padding: 0; margin: 0; }
.row { display: flex; justify-content: space-between; align-items: flex-start; }
.rowbtns { display: flex; gap: 0.75rem; }
.linkish { background: none; border: none; color: #2563eb; cursor: pointer; font: inherit; padding: 0; }
.linkish.danger { color: #b91c1c; }
.muted { color: #64748b; }
.goals { margin: 0.4rem 0 0; }
.empty { color: #94a3b8; }
.error { color: #b91c1c; }
.linked-badge {
  display: inline-block; margin-left: 0.5rem;
  font-size: 0.7rem; font-weight: 600; padding: 0.1rem 0.5rem;
  border-radius: 999px; background: #dcfce7; color: #15803d;
}
</style>
