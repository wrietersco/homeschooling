<script setup>
import { ref, computed, onMounted } from "vue";
import { getMySubscription, requestPlanChange } from "@/services/admin";
const data = ref(null), error = ref(""), loading = ref(false), submitting = ref(false), message = ref("");
const labels = { text: "AI text calls", image: "New images", tts: "New speech clips", liveMinutes: "Live voice minutes" };
const plan = computed(() => data.value?.plans[data.value.subscription.planId]);
async function load() { loading.value = true; error.value = ""; try { data.value = await getMySubscription(); } catch (e) { error.value = e.message; } finally { loading.value = false; } }
onMounted(load);
async function choose(planId) {
  submitting.value = true; error.value = ""; message.value = "";
  try { const r = await requestPlanChange(planId); data.value.planRequest = r.request; message.value = "Request submitted. Arrange payment with the administrator; your package changes after approval."; }
  catch (e) { error.value = e.message; } finally { submitting.value = false; }
}
</script>
<template>
  <section><div class="head"><h1>Subscription</h1><button class="btn" :disabled="loading" @click="load">Refresh</button></div><p v-if="error" role="alert" class="error">{{ error }}</p>
    <template v-if="data">
      <p v-if="message" role="status">{{ message }}</p>
      <article v-if="data.planRequest" class="card"><h2>Package request · {{ data.planRequest.status }}</h2><p>{{ data.planRequest.planName }} — {{ data.planRequest.currency }} {{ data.planRequest.price.toLocaleString() }}</p><p v-if="data.planRequest.status === 'pending'">Awaiting superadmin review. Your current package stays unchanged until approval.</p><p v-if="data.planRequest.rejectionReason">{{ data.planRequest.rejectionReason }}</p></article>
      <article class="card"><h2>{{ plan?.name }} · {{ data.subscription.effectiveStatus }}</h2><p v-if="data.subscription.effectiveStatus !== 'active'">Contact the administrator to arrange payment and activate or renew your subscription. There is no free tier.</p><p v-else>Your family subscription is active until {{ new Date(data.subscription.endsAt).toLocaleString() }}.</p><p v-if="data.subscription.agreedPrice">Agreed price: {{ data.subscription.currency }} {{ data.subscription.agreedPrice.toLocaleString() }} · payment {{ data.subscription.paymentStatus }}</p>
        <table><thead><tr><th>Allowance</th><th>Used / period limit</th><th>Daily limit</th></tr></thead><tbody><tr v-for="(label, kind) in labels" :key="kind"><td>{{ label }}</td><td>{{ data.usage[kind] || 0 }} / {{ plan?.limits[kind] }}</td><td>{{ plan?.daily[kind] }}</td></tr></tbody></table>
      </article>
      <div class="plans"><article v-for="(p, id) in data.plans" :key="id" class="card"><h2>{{ p.name }}</h2><strong>{{ p.currency }} {{ p.price.toLocaleString() }}</strong><p>{{ p.durationDays }} day{{ p.durationDays === 1 ? '' : 's' }}</p><ul><li v-for="(label, kind) in labels" :key="kind">{{ p.limits[kind] }} {{ label.toLowerCase() }} per period</li><li>Up to {{ p.sessionMinutes }} minutes per live session</li></ul><button class="btn primary" :disabled="submitting || loading || data.planRequest?.status === 'pending' || (data.subscription.effectiveStatus === 'active' && data.subscription.planId === id)" @click="choose(id)">{{ data.subscription.effectiveStatus === 'active' && data.subscription.planId === id ? 'Current package' : 'Request this package' }}</button></article></div>
      <p>Payments and plan changes are handled directly by the administrator. Allowances are shared across your family. Text calls include agent steps and retries. Cached speech does not consume new speech allowance. Live sessions reserve their full allowed duration, even if you finish early. Daily limits reset at midnight UTC; renewals start a new period allowance.</p>
    </template>
  </section>
</template>
<style scoped>
.head{display:flex;align-items:center;justify-content:space-between}.plans{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem;margin:1.5rem 0}.card{padding:1.25rem;border:1px solid #d8dee8;border-radius:12px;background:#fff}.card h2{margin-top:0}table{width:100%;border-collapse:collapse}td,th{padding:.6rem;text-align:left;border-bottom:1px solid #e8edf4}.error{color:#b91c1c}li{margin:.5rem 0}@media(max-width:750px){.plans{grid-template-columns:1fr}}
</style>
