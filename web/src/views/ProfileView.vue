<script setup>
import { ref, watch, onMounted } from "vue";
import { useAuthStore } from "@/stores/auth";
import { useFamilyStore } from "@/stores/family";
import { useMembersStore } from "@/stores/members";
import { saveFamilyProfile } from "@/services/profiles";
import { createInvite, getPendingInvites } from "@/services/invites";

const auth = useAuthStore();
const family = useFamilyStore();
const membersStore = useMembersStore();

// ── Family profile form ──────────────────────────────────────────────────────
const familyName = ref("");
const guidingLight = ref("");
// goalIndividual and goalCombined are independent toggles; stored as
// "individual" | "combined" | "both" in Firestore for backward compat.
const goalIndividual = ref(true);
const goalCombined = ref(false);
const saving = ref(false);
const saved = ref(false);
const error = ref("");

function goalModeToFlags(mode) {
  return { individual: mode === "individual" || mode === "both", combined: mode === "combined" || mode === "both" };
}
function flagsToGoalMode() {
  if (goalIndividual.value && goalCombined.value) return "both";
  if (goalCombined.value) return "combined";
  return "individual";
}

watch(
  () => family.profile,
  (p) => {
    familyName.value = family.family?.name || p?.familyName || "";
    guidingLight.value = p?.guidingLight || "";
    const flags = goalModeToFlags(p?.goalMode || "individual");
    goalIndividual.value = flags.individual;
    goalCombined.value = flags.combined;
  },
  { immediate: true }
);

const canEdit = () => ["owner", "parent"].includes(auth.role);

async function save() {
  error.value = "";
  saved.value = false;
  if (!canEdit()) { error.value = "You have read-only access."; return; }
  saving.value = true;
  try {
    await saveFamilyProfile(
      auth.familyId,
      { familyName: familyName.value.trim(), guidingLight: guidingLight.value.trim(), goalMode: flagsToGoalMode() },
      auth.user?.uid
    );
    saved.value = true;
  } catch (e) {
    error.value = e?.message || "Could not save.";
  } finally {
    saving.value = false;
  }
}

// ── Invite management (owner only) ──────────────────────────────────────────
const inviteEmail = ref("");
const inviting = ref(false);
const inviteLink = ref("");
const inviteError = ref("");
const copied = ref(false);
const pendingInvites = ref([]);

onMounted(async () => {
  if (auth.role === "owner" && auth.familyId) await loadPendingInvites();
});

async function loadPendingInvites() {
  try {
    pendingInvites.value = await getPendingInvites(auth.familyId);
  } catch {
    // non-critical
  }
}

async function generateInvite() {
  inviting.value = true;
  inviteLink.value = "";
  inviteError.value = "";
  copied.value = false;
  try {
    const result = await createInvite(inviteEmail.value.trim());
    const token = result.data.token;
    inviteLink.value = `${window.location.origin}/invite/${token}`;
    await loadPendingInvites();
  } catch (e) {
    inviteError.value = e?.message || "Could not create invite link.";
  } finally {
    inviting.value = false;
  }
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(inviteLink.value);
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 2500);
  } catch {
    // fallback: select text
  }
}

function formatExpiry(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}
</script>

<template>
  <section class="profile">
    <h1>Family profile</h1>

    <!-- Profile form -->
    <form class="card" @submit.prevent="save">
      <label>
        Family name
        <input v-model="familyName" type="text" :disabled="!canEdit()" />
      </label>
      <label>
        Main guiding light
        <textarea v-model="guidingLight" rows="5" :disabled="!canEdit()"></textarea>
        <small>The single most important anchor for the AI curriculum.</small>
      </label>
      <fieldset class="goal-fieldset" :disabled="!canEdit()">
        <legend class="goal-legend">Goals are set</legend>
        <label class="check-label">
          <input type="checkbox" v-model="goalIndividual" />
          Individually per child
        </label>
        <label class="check-label">
          <input type="checkbox" v-model="goalCombined" />
          Combined for all children
        </label>
        <small>Select one or both — the AI curriculum will address each mode you enable.</small>
      </fieldset>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <p v-if="saved" class="ok" role="status">Saved.</p>
      <button v-if="canEdit()" class="btn primary" type="submit" :disabled="saving">
        {{ saving ? "Saving…" : "Save profile" }}
      </button>
    </form>

    <!-- Family members list -->
    <div class="card members-card">
      <h2 class="section-title">Family members</h2>
      <ul class="member-list">
        <li v-for="m in membersStore.members" :key="m.uid" class="member-row">
          <div class="member-info">
            <span class="member-name">{{ m.displayName || m.email || m.uid }}</span>
            <span class="member-email muted" v-if="m.email && m.displayName">{{ m.email }}</span>
          </div>
          <span class="role-badge" :class="m.role">{{ m.role }}</span>
        </li>
      </ul>
      <p v-if="!membersStore.members.length" class="muted empty">No members yet.</p>
    </div>

    <!-- Invite section (owner only) -->
    <div v-if="auth.role === 'owner'" class="card invite-card">
      <h2 class="section-title">Invite a parent</h2>
      <p class="muted-sm">Generate a link and share it. The recipient signs in and clicks "Accept invite". Links expire after 48 hours.</p>

      <div class="invite-form">
        <label class="inline-label">
          Email hint <span class="opt">(optional)</span>
          <input v-model="inviteEmail" type="email" placeholder="parent@example.com" />
        </label>
        <button class="btn primary" :disabled="inviting" @click="generateInvite">
          {{ inviting ? "Generating…" : "Generate invite link" }}
        </button>
      </div>

      <p v-if="inviteError" class="error" role="alert">{{ inviteError }}</p>

      <div v-if="inviteLink" class="link-box">
        <p class="link-label">Share this link:</p>
        <div class="link-row">
          <input class="link-input" readonly :value="inviteLink" @click="($event.target).select()" />
          <button class="btn copy-btn" @click="copyLink">
            {{ copied ? "Copied!" : "Copy" }}
          </button>
        </div>
        <p class="muted-sm">Expires in 48 hours &middot; works for any account</p>
      </div>

      <!-- Pending invites -->
      <div v-if="pendingInvites.length" class="pending-section">
        <h3 class="pending-title">Pending invites</h3>
        <ul class="pending-list">
          <li v-for="inv in pendingInvites" :key="inv.id" class="pending-row">
            <span class="pending-email">{{ inv.email || "No email specified" }}</span>
            <span class="muted-sm">expires {{ formatExpiry(inv.expiresAt) }}</span>
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>

<style scoped>
.profile { max-width: 580px; display: flex; flex-direction: column; gap: 1.25rem; }
h1 { margin: 0 0 0.25rem; }
.card {
  display: flex; flex-direction: column; gap: 1rem;
  background: #fff; padding: 1.25rem; border-radius: 12px; border: 1px solid #e2e8f0;
}
label { display: flex; flex-direction: column; gap: 0.35rem; font-size: 0.9rem; color: #334155; }
input, textarea, select { padding: 0.55rem 0.65rem; border: 1px solid #cbd5e1; border-radius: 8px; font: inherit; }
small { color: #94a3b8; }
.btn { padding: 0.6rem 1rem; border-radius: 8px; border: 1px solid #cbd5e1; background: #fff; cursor: pointer; font: inherit; }
.btn.primary { background: #0b1f3a; color: #fff; border-color: transparent; }
.btn:disabled { opacity: 0.6; cursor: not-allowed; }
.error { color: #b91c1c; margin: 0; font-size: 0.85rem; }
.ok { color: #15803d; margin: 0; font-size: 0.85rem; }

/* Goal mode checkboxes */
.goal-fieldset { border: 1px solid #cbd5e1; border-radius: 8px; padding: 0.6rem 0.85rem 0.75rem; display: flex; flex-direction: column; gap: 0.45rem; }
.goal-legend { font-size: 0.9rem; color: #334155; padding: 0 0.25rem; }
.check-label { display: flex; flex-direction: row; align-items: center; gap: 0.5rem; font-size: 0.9rem; color: #1e293b; cursor: pointer; }
.check-label input[type="checkbox"] { width: 1rem; height: 1rem; accent-color: #0b1f3a; cursor: pointer; }

/* Members */
.section-title { font-size: 1rem; font-weight: 600; color: #1e293b; margin: 0; }
.member-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.5rem; }
.member-row { display: flex; align-items: center; justify-content: space-between; padding: 0.5rem 0.6rem; background: #f8fafc; border-radius: 8px; }
.member-info { display: flex; flex-direction: column; gap: 0.1rem; }
.member-name { font-size: 0.9rem; font-weight: 500; color: #1e293b; }
.member-email { font-size: 0.75rem; }
.role-badge { font-size: 0.7rem; font-weight: 600; padding: 0.15rem 0.5rem; border-radius: 999px; background: #e2e8f0; color: #475569; text-transform: uppercase; }
.role-badge.owner { background: #dbeafe; color: #1e40af; }
.role-badge.parent { background: #dcfce7; color: #15803d; }
.empty { font-size: 0.875rem; }

/* Invite */
.invite-card { gap: 1.1rem; }
.muted { color: #64748b; }
.muted-sm { font-size: 0.8rem; color: #94a3b8; margin: 0; }
.opt { font-weight: 400; color: #94a3b8; }
.inline-label { font-size: 0.85rem; color: #334155; display: flex; flex-direction: column; gap: 0.3rem; }
.invite-form { display: flex; flex-direction: column; gap: 0.6rem; }
.link-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 0.9rem; display: flex; flex-direction: column; gap: 0.5rem; }
.link-label { font-size: 0.8rem; font-weight: 600; color: #475569; margin: 0; }
.link-row { display: flex; gap: 0.5rem; }
.link-input { flex: 1; font-size: 0.8rem; padding: 0.45rem 0.6rem; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; color: #334155; min-width: 0; }
.copy-btn { white-space: nowrap; font-size: 0.8rem; padding: 0.45rem 0.8rem; }
.pending-section { border-top: 1px solid #f1f5f9; padding-top: 0.75rem; }
.pending-title { font-size: 0.85rem; font-weight: 600; color: #475569; margin: 0 0 0.4rem; }
.pending-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.3rem; }
.pending-row { display: flex; align-items: center; justify-content: space-between; font-size: 0.82rem; padding: 0.3rem 0; }
.pending-email { color: #334155; }
</style>
