<script setup>
// Superadmin quota grants for one family: extra allowance on top of its plan,
// per day and per package, or unlimited. The plan and its price are untouched.
import { ref, computed, onMounted } from "vue";
import { getFamilyGrants, setFamilyGrants } from "@/services/admin";
import { learningAllowances } from "@/lib/packageCopy";

const props = defineProps({ familyId: { type: String, required: true } });
const emit = defineEmits(["saved"]);

const KINDS = {
  tts: { title: "Read-aloud (TTS)", unit: "recordings", featured: true, chips: [20, 50, 100, 500] },
  liveMinutes: { title: "Live companion (Explore voice)", unit: "minutes", featured: true, chips: [15, 30, 60, 240] },
  activities: { title: "Prepared activities", unit: "activities", chips: [10, 50, 100] },
  text: { title: "Preparation requests", unit: "requests", chips: [50, 200, 500] },
  image: { title: "Illustrations", unit: "images", chips: [20, 50, 200] },
};
const SCOPES = ["daily", "package"];

const data = ref(null), form = ref({}), note = ref(""), busy = ref(false), error = ref(""), message = ref("");
const featured = computed(() => Object.keys(KINDS).filter((k) => KINDS[k].featured));
const others = computed(() => Object.keys(KINDS).filter((k) => !KINDS[k].featured));
const packageLabel = computed(() => { const d = data.value?.plan.durationDays; return d === 1 ? "Per package (1 day)" : `Per package (${d} days)`; });

function toForm(grants = {}) {
  return Object.fromEntries(Object.keys(KINDS).map((k) => [k, Object.fromEntries(SCOPES.map((s) => {
    const v = grants[k]?.[s];
    return [s, v === "unlimited" ? { mode: "unlimited", amount: 0 } : v ? { mode: "extra", amount: v } : { mode: "none", amount: 0 }];
  }))]));
}
function toGrants() {
  const out = {};
  for (const [k, scopes] of Object.entries(form.value)) for (const s of SCOPES) {
    const g = scopes[s];
    const v = g.mode === "unlimited" ? "unlimited" : g.mode === "extra" && g.amount > 0 ? Math.floor(g.amount) : null;
    if (v != null) (out[k] ||= {})[s] = v;
  }
  return out;
}
const dirty = computed(() => data.value && (JSON.stringify(toGrants()) !== JSON.stringify(data.value.grants) || note.value !== data.value.note));
const anyGrant = computed(() => Object.keys(toGrants()).length > 0);

const planLimit = (k, s) => s === "daily" ? data.value.plan.daily[k] : data.value.plan.limits[k];
const used = (k, s) => s === "daily" ? data.value.used.today[k] || 0 : data.value.used.package[k] || 0;
function effective(k, s) {
  const g = form.value[k][s];
  if (g.mode === "unlimited") return "Unlimited";
  return (planLimit(k, s) + (g.mode === "extra" ? Math.max(0, Math.floor(g.amount || 0)) : 0)).toLocaleString();
}
function setMode(k, s, mode) { const g = form.value[k][s]; g.mode = mode; if (mode === "extra" && !g.amount) g.amount = KINDS[k].chips[0]; }
function addChip(k, s, n) { const g = form.value[k][s]; if (g.mode !== "extra") { g.mode = "extra"; g.amount = 0; } g.amount = (Number(g.amount) || 0) + n; }
function describe(grants) {
  const parts = [];
  for (const [k, g] of Object.entries(grants || {})) for (const s of SCOPES) if (g[s] != null) parts.push(`${KINDS[k]?.title || k}: ${g[s] === "unlimited" ? "unlimited" : `+${g[s]}`} ${s === "daily" ? "per day" : "per package"}`);
  return parts.length ? parts.join(" · ") : "All grants removed";
}

async function load() {
  busy.value = true; error.value = "";
  try { const r = await getFamilyGrants(props.familyId); data.value = r; form.value = toForm(r.grants); note.value = r.note; }
  catch (e) { error.value = e.message; } finally { busy.value = false; }
}
async function save(clear = false) {
  if (clear && !confirm("Remove every grant for this family? They go back to their plan's limits.")) return;
  busy.value = true; error.value = ""; message.value = "";
  try {
    if (clear) form.value = toForm({});
    const r = await setFamilyGrants(props.familyId, toGrants(), note.value);
    message.value = clear ? "All grants removed — plan limits apply again." : "Grants saved. They apply immediately.";
    await load(); emit("saved", Object.keys(r.grants).length);
  } catch (e) { error.value = e.message; } finally { busy.value = false; }
}
onMounted(load);
</script>

<template>
  <section class="grants" aria-label="Quota grants">
    <p v-if="!data && busy" class="muted">Loading grants…</p>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <template v-if="data">
      <header class="grants-head">
        <div>
          <h3>Quota grants</h3>
          <p class="muted">On <strong>{{ data.plan.name }}</strong> ({{ data.subscription.effectiveStatus }}). A grant adds to the plan's limits for this family only — the plan and its price stay the same. Grants last until you change them, including across renewals.</p>
        </div>
      </header>

      <div v-for="group in [{ kinds: featured, title: 'Speech & live voice' }, { kinds: others, title: 'Other allowances' }]" :key="group.title" class="group">
        <h4>{{ group.title }}</h4>
        <article v-for="k in group.kinds" :key="k" class="kind" :class="{ featured: KINDS[k].featured }">
          <div class="kind-title"><strong>{{ KINDS[k].title }}</strong><small>{{ learningAllowances[k]?.description }}</small></div>
          <div class="scopes">
            <div v-for="s in SCOPES" :key="s" class="scope">
              <div class="scope-label">{{ s === 'daily' ? 'Per day' : packageLabel }}</div>
              <div class="facts"><span>Plan <b>{{ planLimit(k, s).toLocaleString() }}</b></span><span>Used {{ s === 'daily' ? 'today' : 'this package' }} <b>{{ used(k, s).toLocaleString() }}</b></span></div>
              <div class="seg" role="radiogroup" :aria-label="`${KINDS[k].title} ${s} grant`">
                <button v-for="m in [['none', 'No grant'], ['extra', 'Add extra'], ['unlimited', 'Unlimited']]" :key="m[0]" type="button" role="radio" :aria-checked="form[k][s].mode === m[0]" :class="{ on: form[k][s].mode === m[0] }" @click="setMode(k, s, m[0])">{{ m[1] }}</button>
              </div>
              <div v-if="form[k][s].mode !== 'unlimited'" class="amount">
                <label v-if="form[k][s].mode === 'extra'">+ <input v-model.number="form[k][s].amount" type="number" min="1" step="1" :aria-label="`Extra ${KINDS[k].unit} ${s}`" /> {{ KINDS[k].unit }}</label>
                <span class="chips"><button v-for="n in KINDS[k].chips" :key="n" type="button" class="chip" @click="addChip(k, s, n)">+{{ n }}</button></span>
              </div>
              <div class="result" :class="{ boosted: form[k][s].mode !== 'none' }">New limit: <b>{{ effective(k, s) }}</b> {{ form[k][s].mode === 'unlimited' ? '' : KINDS[k].unit }}{{ s === 'daily' ? ' / day' : ' / package' }}</div>
            </div>
          </div>
        </article>
      </div>

      <p class="muted small">Read-aloud recordings also share the speech provider's daily capacity (see the Quota tab); a grant can't exceed what the provider allows. Live voice grants also raise the daily Explore session safety limit.</p>
      <label class="note">Reason (optional, kept in history)<input v-model="note" maxlength="500" placeholder="e.g. Extra Qur'an recitation practice this month" /></label>
      <p v-if="message" role="status" class="success">{{ message }}</p>
      <div class="actions">
        <button class="btn primary" :disabled="busy || !dirty" @click="save()">{{ busy ? 'Saving…' : 'Save grants' }}</button>
        <button class="btn" :disabled="busy || !dirty" @click="form = toForm(data.grants); note = data.note">Undo changes</button>
        <button class="btn danger-outline" :disabled="busy || !Object.keys(data.grants).length" @click="save(true)">Remove all grants</button>
      </div>

      <details v-if="data.history.length" class="history"><summary>Grant history ({{ data.history.length }})</summary>
        <ul><li v-for="(h, i) in data.history" :key="i"><time>{{ new Date(h.at).toLocaleString() }}</time> · {{ h.byEmail || 'superadmin' }}<br />{{ describe(h.grants) }}<em v-if="h.note"> — “{{ h.note }}”</em></li></ul>
      </details>
    </template>
  </section>
</template>

<style scoped>
.grants { display:flex; flex-direction:column; gap:14px; }
.grants-head h3 { margin:0 0 4px; font-size:14px; color:#2d3650; }
.muted { color:#64748b; font-size:12px; margin:0; } .small { font-size:11px; }
.error { color:#b91c1c; font-size:12px; } .success { color:#166534; font-size:12px; margin:0; }
.group h4 { margin:6px 0 8px; font-size:10px; text-transform:uppercase; letter-spacing:1px; color:#a0a7b6; }
.kind { background:#fff; border:1px solid #e7e9f0; border-radius:10px; padding:14px; margin-bottom:10px; }
.kind.featured { border-color:#d9d0f3; box-shadow:0 1px 0 #eeeafb; }
.kind-title { display:flex; flex-direction:column; gap:3px; margin-bottom:10px; } .kind-title strong { font-size:13px; color:#2d3650; } .kind-title small { color:#929aae; font-size:11px; }
.scopes { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
.scope { border:1px solid #f0f1f6; border-radius:8px; padding:10px; display:flex; flex-direction:column; gap:8px; background:#fbfbfd; }
.scope-label { font-size:11px; font-weight:650; color:#5b6380; }
.facts { display:flex; gap:14px; font-size:11px; color:#7b8499; } .facts b { color:#2d3650; }
.seg { display:inline-flex; border:1px solid #d9dcea; border-radius:8px; overflow:hidden; align-self:flex-start; }
.seg button { border:0; background:#fff; padding:6px 10px; font:inherit; font-size:11px; cursor:pointer; color:#5b6380; } .seg button + button { border-left:1px solid #d9dcea; }
.seg button.on { background:#8877bc; color:#fff; }
.amount { display:flex; flex-wrap:wrap; gap:8px; align-items:center; font-size:12px; }
.amount label { display:flex; align-items:center; gap:5px; } .amount input { width:80px; padding:5px 7px; border:1px solid #bbc6d4; border-radius:6px; font:inherit; }
.chips { display:flex; gap:5px; flex-wrap:wrap; } .chip { border:1px dashed #c9bfe8; background:#f6f3fb; color:#6d5ca8; border-radius:999px; padding:3px 9px; font:inherit; font-size:11px; cursor:pointer; }
.result { font-size:12px; color:#7b8499; } .result.boosted { color:#3e9775; } .result b { font-size:13px; }
.note { display:flex; flex-direction:column; gap:4px; font-size:12px; color:#5b6380; } .note input { padding:7px 9px; border:1px solid #bbc6d4; border-radius:6px; font:inherit; }
.actions { display:flex; gap:10px; flex-wrap:wrap; }
.btn.danger-outline { color:#bd6666; border-color:#ecc9c9; }
.history summary { cursor:pointer; color:#807294; font-size:12px; } .history ul { margin:8px 0 0; padding-left:18px; font-size:11px; color:#5b6380; display:flex; flex-direction:column; gap:6px; } .history time { color:#929aae; }
@media (max-width:700px) { .scopes { grid-template-columns:1fr; } }
</style>
