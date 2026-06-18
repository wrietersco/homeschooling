<script setup>
import { ref, watch, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { getInvite, acceptInvite } from "@/services/invites";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const rawToken = route.params.token || "";
const dotIdx = rawToken.indexOf(".");
const tokenValid = dotIdx > 0;
const familyId = tokenValid ? rawToken.slice(0, dotIdx) : null;
const inviteId = tokenValid ? rawToken.slice(dotIdx + 1) : null;

const invite = ref(null);
const loading = ref(true);
const error = ref("");
const accepting = ref(false);
const accepted = ref(false);

const loginUrl = `/login?redirect=${encodeURIComponent(route.fullPath)}`;

async function loadInvite() {
  if (!tokenValid) { error.value = "Invalid invite link."; loading.value = false; return; }
  if (!auth.user) { loading.value = false; return; }
  loading.value = true;
  error.value = "";
  try {
    const data = await getInvite(familyId, inviteId);
    if (!data) {
      error.value = "Invite not found or has already been used.";
    } else if (data.status !== "pending") {
      error.value = "This invite has already been used.";
    } else if (data.expiresAt?.toDate() < new Date()) {
      error.value = "This invite link has expired (valid for 48 hours).";
    } else {
      invite.value = data;
    }
  } catch {
    error.value = "Could not load invite. Make sure you are signed in.";
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await auth.ready();
  await loadInvite();
});

// If user signs in while on this page (redirected back), reload the invite.
watch(() => auth.user, (user) => {
  if (user && !invite.value && !accepted.value) loadInvite();
});

async function accept() {
  accepting.value = true;
  error.value = "";
  try {
    await acceptInvite(familyId, inviteId);
    accepted.value = true;
    // The auth store live-subscribes to users/{uid}. When acceptInvite writes
    // that doc, hasFamily becomes true automatically. Watch and redirect then.
    const stop = watch(
      () => auth.hasFamily,
      (has) => { if (has) { stop(); router.push("/dashboard"); } },
      { immediate: true }
    );
  } catch (e) {
    error.value = e?.message || "Could not accept the invite. Please try again.";
    accepting.value = false;
  }
}
</script>

<template>
  <div class="invite-page">
    <div class="card">
      <div class="brand">Dar-al-Hikmah OS</div>

      <!-- Invalid token -->
      <template v-if="!tokenValid">
        <h1 class="title">Invalid invite</h1>
        <p class="sub">This link doesn't look right. Ask the family owner to share the link again.</p>
      </template>

      <!-- Loading -->
      <template v-else-if="loading">
        <h1 class="title">Loading…</h1>
        <p class="sub">Please wait.</p>
      </template>

      <!-- Not signed in -->
      <template v-else-if="!auth.user">
        <h1 class="title">You've been invited</h1>
        <p class="sub">Sign in or create an account to accept this family invite.</p>
        <a :href="loginUrl" class="btn primary block">Sign in to accept</a>
      </template>

      <!-- Accepted — waiting for redirect -->
      <template v-else-if="accepted">
        <h1 class="title">Welcome to the family!</h1>
        <p class="sub">
          You've joined <strong>{{ invite?.familyName }}</strong>.
          Taking you to the dashboard…
        </p>
      </template>

      <!-- Error (not found / expired / used) -->
      <template v-else-if="error && !invite">
        <h1 class="title">Invite unavailable</h1>
        <p class="sub error-text">{{ error }}</p>
        <router-link to="/dashboard" class="btn block">Go to dashboard</router-link>
      </template>

      <!-- Ready to accept -->
      <template v-else-if="invite">
        <h1 class="title">You're invited</h1>
        <p class="sub">
          <strong>{{ invite.invitedByName }}</strong> has invited you to join
          <strong>{{ invite.familyName }}</strong> as a <strong>parent</strong>.
        </p>

        <div v-if="auth.hasFamily" class="info-box">
          You already belong to a family and cannot accept another invite.
        </div>
        <template v-else>
          <p v-if="error" class="error-text small">{{ error }}</p>
          <button class="btn primary block" :disabled="accepting" @click="accept">
            {{ accepting ? "Joining…" : "Accept invite" }}
          </button>
          <p class="hint">You will be added as a parent of this family.</p>
        </template>
      </template>
    </div>
  </div>
</template>

<style scoped>
.invite-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f8fafc;
  padding: 1rem;
}
.card {
  width: 100%;
  max-width: 440px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 16px;
  padding: 2rem;
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.06);
}
.brand {
  font-weight: 700;
  font-size: 0.78rem;
  color: #94a3b8;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.title { font-size: 1.5rem; font-weight: 700; color: #0f172a; margin: 0; }
.sub { color: #475569; margin: 0; line-height: 1.6; }
.hint { font-size: 0.8rem; color: #94a3b8; margin: 0; text-align: center; }
.small { font-size: 0.85rem; }
.btn {
  padding: 0.72rem 1.2rem;
  border-radius: 10px;
  border: 1px solid #cbd5e1;
  background: #fff;
  cursor: pointer;
  font: inherit;
  font-size: 0.95rem;
  text-decoration: none;
  color: #1e293b;
  text-align: center;
  transition: opacity 0.15s;
}
.btn.primary { background: #0b1f3a; color: #fff; border-color: transparent; }
.btn.block { display: block; }
.btn:disabled { opacity: 0.55; cursor: not-allowed; }
.error-text { color: #b91c1c; margin: 0; }
.info-box {
  background: #fef9c3;
  border: 1px solid #fde047;
  border-radius: 8px;
  padding: 0.75rem 1rem;
  font-size: 0.875rem;
  color: #713f12;
}
</style>
