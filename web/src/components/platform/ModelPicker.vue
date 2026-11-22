<script setup>
// Searchable model dropdown with the decision-making chips (cost tier, speed,
// price, quality, badges, "when to use") on every row. Used for the global default
// and every agent on the AI configuration page. Pure presentation: the parent
// owns the value and any side effects (provider switch, voice snap).
import { computed, ref, watch, onBeforeUnmount } from "vue";
import {
  SORTS, PROVIDER_NAMES, arrangeModels, cheapestIds, disabledReason, priceChip, isRetired, isShuttingDown,
} from "../../lib/modelPicker.js";

const props = defineProps({
  modelValue: { type: String, default: "" },
  models: { type: Array, default: () => [] },
  // { gemini, openai, anthropic } booleans from the server; missing = unknown.
  keys: { type: Object, default: null },
  // Providers this agent may run on; null = any.
  allowed: { type: Array, default: null },
  allowCustom: { type: Boolean, default: true },
  placeholder: { type: String, default: "gemini-2.5-flash" },
  label: { type: String, default: "Model" },
});
const emit = defineEmits(["update:modelValue", "select"]);

const open = ref(false);
const query = ref("");
const sort = ref("default");
const showRetired = ref(false);
const custom = ref(false);
const customText = ref("");
const root = ref(null);

const selected = computed(() => props.models.find((m) => m.id === props.modelValue) || null);
const cheapest = computed(() => cheapestIds(props.models));
const groups = computed(() => arrangeModels(props.models, { query: query.value, sort: sort.value, showRetired: showRetired.value, keepId: props.modelValue }));
const count = computed(() => groups.value.reduce((n, g) => n + g.models.length, 0));
const hiddenRetired = computed(() => props.models.filter(isRetired).length);
const isCustomValue = computed(() => !!props.modelValue && !selected.value);

const reason = (m) => disabledReason(m, { keys: props.keys || undefined, allowed: props.allowed || undefined });

function pick(m) {
  if (reason(m)) return;
  emit("update:modelValue", m.id);
  emit("select", m);
  open.value = false;
  custom.value = false;
}
function applyCustom() {
  const id = customText.value.trim();
  if (!id) return;
  emit("update:modelValue", id);
  emit("select", null);
  open.value = false;
}
function toggle() {
  open.value = !open.value;
  if (open.value) { query.value = ""; custom.value = false; customText.value = isCustomValue.value ? props.modelValue : ""; }
}
function onDocClick(e) { if (root.value && !root.value.contains(e.target)) open.value = false; }
watch(open, (v) => {
  if (v) document.addEventListener("mousedown", onDocClick);
  else document.removeEventListener("mousedown", onDocClick);
});
onBeforeUnmount(() => document.removeEventListener("mousedown", onDocClick));
const availNote = (m) => (isRetired(m) ? "Retired — calls fail" : isShuttingDown(m) ? `Shuts down ${m.availability.date}` : "");
</script>

<template>
  <div ref="root" class="mp" @keydown.esc="open = false">
    <span class="mp-label">{{ label }}</span>
    <button type="button" class="mp-trigger" :aria-expanded="open" aria-haspopup="listbox" @click="toggle">
      <span v-if="selected" class="mp-sel">
        <strong>{{ selected.label }}</strong>
        <code class="mp-id">{{ selected.id }}</code>
        <span v-if="selected.recommended" class="mp-badge mp-rec">Recommended</span>
        <span v-if="cheapest.has(selected.id)" class="mp-badge mp-cheap">Cheapest</span>
        <span v-if="availNote(selected)" class="mp-badge mp-warn">{{ availNote(selected) }}</span>
      </span>
      <span v-else-if="isCustomValue" class="mp-sel"><strong>Custom model ID</strong> <code class="mp-id">{{ modelValue }}</code></span>
      <span v-else class="mp-sel mp-muted">Choose a model…</span>
      <span class="mp-caret" aria-hidden="true">▾</span>
    </button>

    <div v-if="open" class="mp-panel" role="listbox">
      <div class="mp-tools">
        <input v-model="query" type="search" class="mp-search" placeholder="Search models, providers, or what you need…" aria-label="Search models" autofocus />
        <select v-model="sort" class="mp-sort" aria-label="Sort models">
          <option v-for="s in SORTS" :key="s.value" :value="s.value">{{ s.label }}</option>
        </select>
      </div>
      <label v-if="hiddenRetired" class="mp-check"><input v-model="showRetired" type="checkbox" /> Show {{ hiddenRetired }} retired model{{ hiddenRetired === 1 ? "" : "s" }}</label>

      <div class="mp-list">
        <p v-if="!count" class="mp-empty">No models match “{{ query }}”.</p>
        <section v-for="g in groups" :key="g.prov" class="mp-group">
          <h4 class="mp-gh">{{ g.label }} <span class="mp-gc">{{ g.models.length }}</span></h4>
          <button
            v-for="m in g.models" :key="m.id" type="button" role="option"
            class="mp-opt" :class="{ on: m.id === modelValue, off: !!reason(m), dead: isRetired(m) }"
            :aria-selected="m.id === modelValue" :aria-disabled="!!reason(m)" :title="reason(m)"
            @click="pick(m)"
          >
            <span class="mp-row1">
              <strong>{{ m.label }}</strong>
              <code class="mp-id">{{ m.id }}</code>
              <span v-if="m.recommended" class="mp-badge mp-rec">Recommended</span>
              <span v-if="cheapest.has(m.id)" class="mp-badge mp-cheap">Cheapest</span>
              <span v-if="m.newest" class="mp-badge mp-new">New</span>
              <span v-if="availNote(m)" class="mp-badge mp-warn">{{ availNote(m) }}</span>
            </span>
            <span class="mp-chips">
              <span v-if="m.cost" class="mp-chip"><span class="mp-cl">Cost</span>{{ m.cost }}</span>
              <span v-if="m.speed" class="mp-chip"><span class="mp-cl">Speed</span>{{ m.speed }}</span>
              <span v-if="priceChip(m)" class="mp-chip"><span class="mp-cl">Price</span>{{ priceChip(m) }}</span>
              <span v-if="m.latency" class="mp-chip"><span class="mp-cl">Latency</span>{{ m.latency }}</span>
            </span>
            <span v-if="m.quality" class="mp-q">{{ m.quality }}</span>
            <span v-if="m.whenToUse" class="mp-when"><span class="mp-wl">When to use</span> {{ m.whenToUse }}</span>
            <span v-if="reason(m)" class="mp-why">{{ reason(m) }}</span>
          </button>
        </section>

        <div v-if="allowCustom" class="mp-custom">
          <button v-if="!custom" type="button" class="mp-opt mp-opt-custom" @click="custom = true; customText = isCustomValue ? modelValue : ''">Custom model ID…</button>
          <div v-else class="mp-custom-row">
            <input v-model="customText" type="text" :placeholder="placeholder" aria-label="Custom model ID" @keydown.enter.prevent="applyCustom" />
            <button type="button" class="mp-use" @click="applyCustom">Use this ID</button>
          </div>
          <small class="mp-note">A custom ID isn't in the catalog, so it has no price chips and is billed at the fallback rate.</small>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mp { position: relative; display: flex; flex-direction: column; gap: 0.3rem; }
.mp-label { font-size: 0.85rem; font-weight: 600; }
.mp-trigger { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; width: 100%; text-align: left; padding: 0.5rem 0.65rem; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; font: inherit; cursor: pointer; min-height: 44px; }
.mp-trigger:focus-visible { outline: 2px solid #2563eb; outline-offset: 1px; }
.mp-sel { display: flex; flex-wrap: wrap; align-items: center; gap: 0.35rem; min-width: 0; }
.mp-muted { color: #64748b; }
.mp-caret { color: #64748b; flex: none; }
.mp-id { font-size: 0.72rem; color: #475569; background: #f1f5f9; padding: 0.05rem 0.35rem; border-radius: 4px; word-break: break-all; }
.mp-panel { position: absolute; z-index: 30; top: 100%; left: 0; right: 0; margin-top: 4px; background: #fff; border: 1px solid #cbd5e1; border-radius: 10px; box-shadow: 0 12px 32px rgba(15, 23, 42, 0.18); padding: 0.6rem; display: flex; flex-direction: column; gap: 0.5rem; min-width: min(100%, 22rem); }
.mp-tools { display: flex; gap: 0.4rem; flex-wrap: wrap; }
.mp-search { flex: 1 1 12rem; min-width: 0; padding: 0.45rem 0.6rem; border: 1px solid #cbd5e1; border-radius: 8px; font: inherit; }
.mp-sort { padding: 0.45rem 0.5rem; border: 1px solid #cbd5e1; border-radius: 8px; font: inherit; background: #fff; }
.mp-check { font-size: 0.8rem; color: #475569; display: flex; align-items: center; gap: 0.4rem; }
.mp-list { max-height: min(60vh, 28rem); overflow-y: auto; display: flex; flex-direction: column; gap: 0.4rem; }
.mp-gh { margin: 0.3rem 0 0.1rem; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; position: sticky; top: 0; background: #fff; padding: 0.15rem 0; }
.mp-gc { font-weight: 500; color: #94a3b8; }
.mp-opt { display: flex; flex-direction: column; gap: 0.3rem; width: 100%; text-align: left; padding: 0.55rem 0.65rem; margin-bottom: 0.3rem; border: 1px solid #e2e8f0; border-radius: 8px; background: #fff; font: inherit; cursor: pointer; }
.mp-opt:hover:not(.off), .mp-opt:focus-visible { border-color: #2563eb; background: #f8fafc; outline: none; }
.mp-opt.on { border-color: #2563eb; background: #eff6ff; }
.mp-opt.off { opacity: 0.55; cursor: not-allowed; }
.mp-opt.dead { background: #fef2f2; }
.mp-row1 { display: flex; flex-wrap: wrap; align-items: center; gap: 0.35rem; }
.mp-chips { display: flex; flex-wrap: wrap; gap: 0.3rem; }
.mp-chip { display: inline-flex; gap: 0.3rem; align-items: center; font-size: 0.74rem; color: #334155; background: #fff; border: 1px solid #e2e8f0; border-radius: 999px; padding: 0.12rem 0.5rem; font-variant-numeric: tabular-nums; }
.mp-cl { font-size: 0.58rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; color: #94a3b8; }
.mp-q { font-size: 0.8rem; color: #475569; }
.mp-when { font-size: 0.8rem; color: #334155; background: #eff6ff; border: 1px solid #dbeafe; border-radius: 6px; padding: 0.3rem 0.45rem; }
.mp-wl { font-weight: 700; color: #1d4ed8; margin-right: 0.3rem; }
.mp-why { font-size: 0.78rem; font-weight: 600; color: #b45309; }
.mp-badge { font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; padding: 0.1rem 0.4rem; border-radius: 999px; }
.mp-rec { color: #15803d; background: #dcfce7; }
.mp-cheap { color: #1d4ed8; background: #dbeafe; }
.mp-new { color: #7c3aed; background: #ede9fe; }
.mp-warn { color: #b45309; background: #fef3c7; }
.mp-empty { margin: 0.5rem 0; color: #64748b; font-size: 0.85rem; }
.mp-custom { display: flex; flex-direction: column; gap: 0.3rem; border-top: 1px solid #e2e8f0; padding-top: 0.5rem; }
.mp-opt-custom { font-weight: 600; color: #1d4ed8; margin-bottom: 0; }
.mp-custom-row { display: flex; gap: 0.4rem; flex-wrap: wrap; }
.mp-custom-row input { flex: 1 1 12rem; min-width: 0; padding: 0.45rem 0.6rem; border: 1px solid #cbd5e1; border-radius: 8px; font: inherit; }
.mp-use { padding: 0.45rem 0.8rem; border: 0; border-radius: 8px; background: #2563eb; color: #fff; font: inherit; cursor: pointer; }
.mp-note { color: #64748b; font-size: 0.74rem; }
@media (max-width: 480px) { .mp-panel { position: fixed; inset: auto 8px 8px 8px; top: 8vh; margin: 0; } .mp-list { max-height: none; flex: 1; } }
</style>
