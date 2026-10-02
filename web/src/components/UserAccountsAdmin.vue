<script setup>
import { ref, computed, onMounted } from "vue";
import { listPlatformUsers, listFamilies, createPlatformUser, updatePlatformUser, setPlatformUserSuspended, setPlatformUserPassword, getPlatformPasswordResetLink, setMemberRole } from "@/services/admin";
const users = ref([]), families = ref([]), nextPage = ref(null), busy = ref(false), error = ref(""), message = ref(""), search = ref(""), editor = ref(null), resetLink = ref("");
const shown = computed(() => users.value.filter((u) => `${u.email} ${u.displayName} ${u.uid}`.toLowerCase().includes(search.value.toLowerCase())));
const familyName = (id) => families.value.find((f) => f.id === id)?.name || id || "No family";
async function load(more = false) {
  busy.value = true; error.value = "";
  try { const r = await listPlatformUsers(more ? nextPage.value : undefined); users.value = more ? [...users.value, ...r.users] : r.users; nextPage.value = r.nextPageToken; }
  catch (e) { error.value = e.message; } finally { busy.value = false; }
}
function edit(u) { editor.value = { uid: u?.uid || "", email: u?.email || "", displayName: u?.displayName || "", password: "", familyId: u?.familyId || "", familyName: "", role: u?.role || "parent", originalRole: u?.role || "parent" }; resetLink.value = ""; error.value = ""; message.value = ""; }
async function run(fn, success) {
  busy.value = true; error.value = ""; message.value = "";
  try { await fn(); message.value = success; await load(); }
  catch (e) { error.value = e.message; } finally { busy.value = false; }
}
async function save() {
  const draft = { ...editor.value };
  await run(async () => {
    if (!draft.uid) await createPlatformUser(draft);
    else { await updatePlatformUser({ uid: draft.uid, email: draft.email, displayName: draft.displayName }); if (draft.familyId && draft.role !== draft.originalRole) await setMemberRole(draft.familyId, draft.uid, draft.role); }
    editor.value = null;
  }, draft.uid ? "Account updated." : "Account created. Assign a subscription through Plans & subscriptions.");
  if (editor.value) editor.value.password = "";
}
async function suspend(u) { await run(() => setPlatformUserSuspended(u.uid, !u.disabled), u.disabled ? "Account reactivated. The user must sign in again." : "Account suspended and sessions revoked."); }
async function password() {
  const { uid, password: value } = editor.value;
  await run(() => setPlatformUserPassword(uid, value), "Password changed and sessions revoked. Share the password with the user outside this app.");
  if (editor.value) editor.value.password = "";
}
async function reset() {
  resetLink.value = "";
  await run(async () => { resetLink.value = (await getPlatformPasswordResetLink(editor.value.uid)).link; }, "Reset link created. Share it privately with the user; no email has been sent.");
}
onMounted(async () => { await load(); try { families.value = (await listFamilies()).families; } catch (e) { error.value = e.message; } });
</script>
<template>
  <section>
    <div class="toolbar"><h2>User accounts</h2><button class="btn" :disabled="busy" @click="load()">Refresh</button><button class="btn primary" :disabled="busy" @click="edit()">Add user</button></div>
    <p>Manage sign-in accounts separately from family subscriptions. Suspending an account blocks sign-in and existing sessions. Superadmin accounts are protected here.</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="message" class="success" role="status">{{ message }}</p>
    <form v-if="editor" class="card" @submit.prevent="save">
      <h3>{{ editor.uid ? 'Modify account' : 'Add account' }}</h3>
      <div class="pair"><label>Name<input v-model="editor.displayName" required maxlength="120" autocomplete="off" /></label><label>Email<input v-model="editor.email" type="email" required maxlength="254" autocomplete="off" /></label></div>
      <template v-if="!editor.uid">
        <label>Password<input v-model="editor.password" type="password" minlength="8" maxlength="128" required autocomplete="new-password" /></label>
        <div class="pair"><label>Existing family<select v-model="editor.familyId" :disabled="!!editor.familyName"><option value="">No family / create below</option><option v-for="f in families" :key="f.id" :value="f.id">{{ f.name }}</option></select></label><label>Or create family<input v-model="editor.familyName" :disabled="!!editor.familyId" maxlength="120" placeholder="Optional family name" /></label></div>
      </template>
      <p v-else class="muted">Family: {{ familyName(editor.familyId) }}</p>
      <label v-if="editor.familyId">Family role<select v-model="editor.role"><option value="owner">Owner</option><option value="parent">Parent</option><option value="viewer">Viewer</option></select></label>
      <p v-if="editor.familyName" class="muted">The new user will own this family. Its subscription starts pending.</p>
      <div class="toolbar"><button class="btn primary" :disabled="busy">{{ editor.uid ? 'Save account' : 'Create account' }}</button><button type="button" class="btn" :disabled="busy" @click="editor = null; resetLink = ''">Close</button></div>
      <fieldset v-if="editor.uid"><legend>Password controls</legend><label>Specify a new password<input v-model="editor.password" type="password" minlength="8" maxlength="128" autocomplete="new-password" /></label><div class="toolbar"><button type="button" class="btn" :disabled="busy || editor.password.length < 8" @click="password">Set password</button><button type="button" class="btn" :disabled="busy" @click="reset">Generate reset link</button></div><label v-if="resetLink">Private reset link<input :value="resetLink" readonly @focus="$event.target.select()" /></label></fieldset>
    </form>
    <label>Search loaded accounts<input v-model="search" type="search" placeholder="Name, email, or user ID" /></label>
    <div class="table-wrap"><table><thead><tr><th>User</th><th>Family / role</th><th>Status</th><th></th></tr></thead><tbody><tr v-for="u in shown" :key="u.uid"><td><strong>{{ u.displayName || u.email }}</strong><br />{{ u.email }}<br /><small>{{ u.uid }}</small></td><td>{{ familyName(u.familyId) }}<br />{{ u.platformRole || u.role || 'Unassigned' }}</td><td>{{ u.disabled ? 'Suspended' : 'Active' }}</td><td><div class="toolbar"><button class="btn" :disabled="busy || u.platformRole === 'superadmin'" @click="edit(u)">Modify</button><button class="btn" :disabled="busy || u.platformRole === 'superadmin'" @click="suspend(u)">{{ u.disabled ? 'Reactivate' : 'Suspend' }}</button></div></td></tr></tbody></table></div>
    <p v-if="!busy && !shown.length">No matching loaded accounts.</p><button v-if="nextPage" class="btn" :disabled="busy" @click="load(true)">Load more accounts</button>
  </section>
</template>
<style scoped>
.toolbar,.pair{display:flex;gap:.7rem;align-items:center;flex-wrap:wrap}.toolbar{margin:1rem 0}.toolbar h2{margin:0;flex:1}.pair>label{flex:1;min-width:200px}label{display:flex;flex-direction:column;gap:.3rem;margin:.7rem 0}input,select{padding:.6rem;border:1px solid #bbc6d4;border-radius:6px;width:100%;box-sizing:border-box}.card{border:1px solid #d8dee8;padding:1rem;border-radius:12px;background:#fff}fieldset{margin-top:1rem;border:1px solid #d8dee8;border-radius:8px}.table-wrap{overflow:auto}table{width:100%;min-width:620px;border-collapse:collapse}th,td{text-align:left;padding:.7rem;border-bottom:1px solid #e8edf4}.muted,small{color:#64748b}.error{color:#b91c1c}.success{color:#166534}
</style>
