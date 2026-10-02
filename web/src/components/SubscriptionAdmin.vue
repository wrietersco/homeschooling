<script setup>
import { ref, onMounted } from "vue";
import { getSubscriptionAdmin, setPricingPlans, setFamilySubscription, reviewPlanRequest } from "@/services/admin";
import { learningAllowances, packageDescriptions } from "@/lib/packageCopy";
const plans = ref({}), families = ref([]), busy = ref(false), error = ref(""), message = ref(""), selected = ref(null);
const requests = ref([]), reviewing = ref(null), paymentConfirmed = ref(false), paymentReference = ref(""), rejectionReason = ref("");
const labels = Object.fromEntries(Object.entries(learningAllowances).map(([id, value]) => [id, value.label]));
const localDate = (ms) => { const d = new Date(ms); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
async function load() {
  busy.value = true; error.value = "";
  try { const r = await getSubscriptionAdmin(); plans.value = structuredClone(r.plans); families.value = r.families; requests.value = r.requests || []; }
  catch (e) { error.value = e.message; } finally { busy.value = false; }
}
async function savePlans() {
  busy.value = true; error.value = ""; message.value = "";
  try { await setPricingPlans(plans.value); message.value = "Prices and quotas saved. New prices apply to future assignments; existing agreed prices stay unchanged."; }
  catch (e) { error.value = e.message; } finally { busy.value = false; }
}
function edit(row) {
  const s = row.subscription, p = plans.value[s.planId] || plans.value.trial;
  const starts = s.startsAt || Date.now(), ends = s.endsAt || starts + p.durationDays * 86400000;
  selected.value = { familyId: row.familyId, name: row.name, planId: s.planId || "trial", status: s.status || "pending", startsAt: localDate(starts), endsAt: localDate(ends), originalStartsAt: starts, originalStartsInput: localDate(starts), originalEndsAt: ends, originalEndsInput: localDate(ends), agreedPrice: s.agreedPrice ?? p.price, currency: s.currency || p.currency, paymentStatus: s.paymentStatus || "unpaid", paymentReference: s.paymentReference || "", notes: s.notes || "" };
  message.value = ""; error.value = "";
}
function planChanged() {
  const p = plans.value[selected.value.planId];
  selected.value.agreedPrice = p.price;
  selected.value.currency = p.currency;
  const starts = selected.value.startsAt === selected.value.originalStartsInput ? selected.value.originalStartsAt : new Date(selected.value.startsAt).getTime();
  const ends = starts + p.durationDays * 86400000;
  selected.value.endsAt = localDate(ends); selected.value.originalEndsAt = ends; selected.value.originalEndsInput = localDate(ends);
}
function renew() {
  const starts = Date.now();
  selected.value.startsAt = localDate(starts); selected.value.originalStartsAt = starts; selected.value.originalStartsInput = localDate(starts);
  selected.value.status = "active"; selected.value.paymentStatus = "unpaid";
  selected.value.paymentReference = ""; planChanged();
}
async function saveSubscription() {
  busy.value = true; error.value = "";
  try {
    const s = selected.value;
    await setFamilySubscription({ ...s, startsAt: s.startsAt === s.originalStartsInput ? s.originalStartsAt : new Date(s.startsAt).getTime(), endsAt: s.endsAt === s.originalEndsInput ? s.originalEndsAt : new Date(s.endsAt).getTime() });
    selected.value = null; await load(); message.value = "Subscription saved. Payments are handled outside this app.";
  } catch (e) { error.value = e.message; } finally { busy.value = false; }
}
onMounted(load);
function openReview(r) { reviewing.value = r; paymentConfirmed.value = false; paymentReference.value = ""; rejectionReason.value = ""; error.value = ""; }
async function review(decision) {
  busy.value = true; error.value = "";
  try { await reviewPlanRequest({ requestId: reviewing.value.id, decision, paymentConfirmed: paymentConfirmed.value, paymentReference: paymentReference.value, reason: rejectionReason.value }); reviewing.value = null; await load(); message.value = decision === "approve" ? "Request approved. The family's new paid package is active." : "Request rejected. The existing subscription is unchanged."; }
  catch (e) { error.value = e.message; } finally { busy.value = false; }
}
</script>

<template>
  <section class="subscriptions">
    <div class="toolbar"><h2>Plans &amp; subscriptions</h2><button class="btn" :disabled="busy" @click="load">Refresh</button></div>
    <p>Manage family learning packages: curriculum planning, activity preparation, read-aloud support, and Explore conversations. Confirm payment outside the app before activating a paid trial or longer package.</p>
    <details class="allowance-help"><summary>How learning allowances are measured</summary><p class="muted">Every package includes access to the same learning tools; duration and allowances differ. Allowances are shared across the family. Preparation credits are not guaranteed counts of courses, lessons, or activities.</p><p v-for="(value, id) in learningAllowances" :key="id" class="muted"><strong>{{ value.label }}:</strong> {{ value.description }}</p><p class="muted">For administration: each text-model call, agent step, and retry uses a preparation credit. Illustration and recording attempts count before generation; saved audio playback is excluded. Explore reserves the full allowed session duration, even when ended early. Daily caps reset at midnight UTC; renewal starts a new package allowance. Speech also depends on shared provider capacity.</p></details>
    <p v-if="error" role="alert" class="error">{{ error }}</p><p v-if="message" role="status" class="success">{{ message }}</p>
    <article class="card"><h3>Package requests ({{ requests.length }})</h3><p class="muted">Email notifications are queued for visitwritersco@gmail.com through Firebase Trigger Email. A queued email is not confirmation of delivery; the extension requires sender setup.</p><p v-if="!requests.length">No requests awaiting review.</p><div v-for="r in requests" :key="r.id" class="toolbar"><div><strong>{{ r.familyName }} → {{ r.planName }}</strong><p>{{ r.requesterName }} · {{ r.requesterEmail }}<br />{{ r.currency }} {{ r.price.toLocaleString() }} · {{ r.durationDays }} days · Email: {{ r.emailStatus }}</p></div><button class="btn" :disabled="busy" @click="openReview(r)">Review request</button></div></article>
    <article v-if="reviewing" class="card request-review"><h3>Review {{ reviewing.familyName }} — {{ reviewing.planName }}</h3><p>{{ reviewing.currency }} {{ reviewing.price.toLocaleString() }} for {{ reviewing.durationDays }} days. Approval starts a new paid period now, replacing the current package and resetting its allowances. The price quoted when requested is preserved.</p><label><input v-model="paymentConfirmed" type="checkbox" /> I confirm the offline payment has been received.</label><label>Payment reference<input v-model="paymentReference" maxlength="200" /></label><label>Reason if rejecting<textarea v-model="rejectionReason" maxlength="500" /></label><div class="toolbar"><button class="btn primary" :disabled="busy || !paymentConfirmed" @click="review('approve')">Approve and activate</button><button class="btn" :disabled="busy" @click="review('reject')">Reject request</button><button class="btn" :disabled="busy" @click="reviewing = null">Close review</button></div></article>
    <form @submit.prevent="savePlans">
      <div class="plan-grid">
        <article v-for="(p, id) in plans" :key="id" class="card">
          <h3>{{ p.name }}</h3>
          <p class="muted">{{ packageDescriptions[id]?.description }}</p>
          <p class="plan-price"><strong>{{ p.currency }} {{ Number(p.price).toLocaleString() }}</strong><span>/ {{ p.durationDays }} {{ p.durationDays === 1 ? 'day' : 'days' }}</span></p>
          <div class="pair"><label>Price<input v-model.number="p.price" type="number" min="1" step="0.01" required /></label><label>Currency<input v-model="p.currency" required minlength="3" maxlength="3" /></label></div>
          <label>Duration in days<input v-model.number="p.durationDays" type="number" min="1" max="366" required /></label>
          <table><thead><tr><th>Learning support</th><th>Per package</th><th>Per day</th></tr></thead><tbody>
            <tr v-for="(label, kind) in labels" :key="kind"><th>{{ label }}</th><td><input v-model.number="p.limits[kind]" :aria-label="`${p.name} ${label} period limit`" type="number" min="0" max="1000000" required /></td><td><input v-model.number="p.daily[kind]" :aria-label="`${p.name} ${label} daily limit`" type="number" min="0" max="1000000" required /></td></tr>
          </tbody></table>
          <label>Minutes per Explore conversation<input v-model.number="p.sessionMinutes" type="number" min="1" max="30" required /></label>
          <details class="advanced-plan"><summary>Advanced plan settings</summary><label>Plan name<input v-model="p.name" required maxlength="60" /></label><label>Output tokens per text call<input v-model.number="p.maxOutputTokens" type="number" min="256" max="65536" required /></label><label>Thinking token budget<input v-model.number="p.thinkingBudget" type="number" min="0" max="24576" required /></label></details>
        </article>
      </div>
      <button class="btn primary" :disabled="busy || !Object.keys(plans).length">{{ busy ? 'Working…' : 'Save plan prices and quotas' }}</button>
    </form>
    <form v-if="selected" class="card editor" @submit.prevent="saveSubscription">
      <h3>Subscription — {{ selected.name }}</h3>
      <div class="pair"><label>Plan<select v-model="selected.planId" @change="planChanged"><option v-for="(p, id) in plans" :key="id" :value="id">{{ p.name }}</option></select></label><label>Status<select v-model="selected.status"><option value="pending">Pending</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="cancelled">Cancelled</option></select></label></div>
      <div class="pair"><label>Starts at (local time)<input v-model="selected.startsAt" type="datetime-local" required /></label><label>Ends at (local time)<input v-model="selected.endsAt" type="datetime-local" required /></label></div>
      <div class="pair"><label>Agreed price ({{ selected.currency }})<input v-model.number="selected.agreedPrice" type="number" min="1" step="0.01" required /></label><label>External payment<select v-model="selected.paymentStatus"><option value="unpaid">Not recorded as paid</option><option value="paid">Payment received</option></select></label></div>
      <label>External payment reference<input v-model="selected.paymentReference" maxlength="200" /></label><label>Admin notes<textarea v-model="selected.notes" maxlength="2000" /></label>
      <p class="muted">Editing the end date or status keeps existing learning usage. “Start renewal now” starts a new package allowance. Marking payment received does not activate the family's learning access unless status is Active.</p>
      <div class="toolbar"><button type="button" class="btn" :disabled="busy" @click="renew">Start renewal now</button><button class="btn primary" :disabled="busy">Save subscription</button><button type="button" class="btn" :disabled="busy" @click="selected = null">Cancel edit</button></div>
    </form>
    <div class="table-wrap"><table class="families"><thead><tr><th>Family</th><th>Learning package / access</th><th>Expires</th><th>Payment</th><th>Learning support used</th><th></th></tr></thead><tbody>
      <tr v-for="row in families" :key="row.familyId"><td>{{ row.name }}</td><td>{{ plans[row.subscription.planId]?.name }}<br />{{ row.subscription.effectiveStatus }}</td><td>{{ row.subscription.endsAt ? new Date(row.subscription.endsAt).toLocaleString() : 'Unassigned' }}</td><td>{{ row.subscription.agreedPrice == null ? '—' : `${row.subscription.currency} ${row.subscription.agreedPrice}` }}<br />{{ row.subscription.paymentStatus || 'unpaid' }}</td><td><div v-for="(label, kind) in labels" :key="kind">{{ label }}: {{ row.usage[kind] || 0 }} / {{ plans[row.subscription.planId]?.limits[kind] ?? 0 }}</div></td><td><button class="btn" :disabled="busy" @click="edit(row)">Manage</button></td></tr>
    </tbody></table></div>
  </section>
</template>

<style scoped>
.toolbar,.pair{display:flex;gap:1rem;align-items:center;flex-wrap:wrap}.toolbar{margin:1rem 0}.toolbar h2{margin:0;flex:1}.pair>label{flex:1;min-width:140px}.plan-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem;margin:1rem 0}.card{border:1px solid #d8dee8;border-radius:12px;padding:1rem;background:#fff}label{display:flex;flex-direction:column;gap:.3rem;margin:.6rem 0;font-size:.85rem}input,select,textarea{box-sizing:border-box;max-width:100%;width:100%;padding:.55rem;border:1px solid #bbc6d4;border-radius:6px;background:white}table{width:100%;border-collapse:collapse;font-size:.82rem}th,td{padding:.4rem;text-align:left;border-bottom:1px solid #e8edf4}th{font-weight:500}td input{min-width:55px}.families{min-width:760px}.table-wrap{overflow:auto;margin-top:1.5rem}.editor{margin-top:1.5rem}.muted{color:#64748b;font-size:.85rem}.error{color:#b91c1c}.success{color:#166534}@media(max-width:850px){.plan-grid{grid-template-columns:1fr}}
</style>
<style scoped>
.plan-price { display:flex; align-items:baseline; gap:8px; margin:0 0 24px; }.plan-price strong { font-size:26px; font-weight:650; letter-spacing:-.8px; color:#2d3650; }.plan-price span { color:#929aae; font-size:11px; }.allowance-help { margin:18px 0; }.allowance-help summary,.advanced-plan summary { cursor:pointer; color:#807294; font-size:12px; }.advanced-plan { border-top:1px solid #eef0f5; margin-top:18px; padding-top:15px; }.request-review input[type="checkbox"] { width:16px; height:16px; }.request-review label:has(input[type="checkbox"]) { flex-direction:row; align-items:center; gap:10px; }.plan-grid .card { padding:24px; }.plan-grid h3 { color:#5b6380; font-size:13px; font-weight:600; margin-bottom:12px; }
</style>
