<script setup>
// Small pill showing which LLM provider/model generated an activity's content
// (e.g. "Claude Sonnet 5"). Renders nothing when no provider is recorded — older
// activities generated before this tracking existed carry no contentProvider,
// and guessing would be misleading.
import { computed } from "vue";
import { describeContentProvider } from "@/lib/modelLabels";

const props = defineProps({
  provider: { type: String, default: "" },
  model: { type: String, default: "" },
});

const info = computed(() => describeContentProvider(props.provider, props.model));
</script>

<template>
  <span v-if="info" class="provider-badge" :class="`pb-${info.providerClass}`" :title="info.title">
    {{ info.text }}
  </span>
</template>

<style scoped>
.provider-badge {
  display: inline-flex;
  align-items: center;
  font-size: 0.72rem;
  font-weight: 600;
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  white-space: nowrap;
  background: #f1f5f9;
  color: #475569;
  border: 1px solid #e2e8f0;
  /* Reset in case an ancestor heading sets these (e.g. an uppercase card title). */
  text-transform: none;
  letter-spacing: normal;
  vertical-align: middle;
  margin-left: 0.4rem;
}
.pb-gemini { background: #eff6ff; color: #1d4ed8; border-color: #bfdbfe; }
.pb-openai { background: #ecfdf5; color: #047857; border-color: #a7f3d0; }
.pb-anthropic { background: #fff7ed; color: #9a3412; border-color: #fed7aa; }
</style>
