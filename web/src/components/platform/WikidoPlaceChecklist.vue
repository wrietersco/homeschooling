<script setup>
// The at-a-glance status of one globe place: what is done, what is left.
// Pure display — the numbers come from placeChecklist() in lib/wikido/placeWizard.
defineProps({
  check: { type: Object, required: true },
});
</script>

<template>
  <ul class="place-check" aria-label="Place progress">
    <li class="ok"><span aria-hidden="true">✓</span> Pinned</li>
    <li :class="check.scene ? 'ok' : 'todo'"><span aria-hidden="true">{{ check.scene ? "✓" : "✗" }}</span> Scene</li>
    <li :class="check.artwork ? 'ok' : 'todo'"><span aria-hidden="true">{{ check.artwork ? "✓" : "✗" }}</span> Artwork</li>
    <li :class="check.voice ? 'ok' : 'todo'"><span aria-hidden="true">{{ check.voice ? "✓" : "✗" }}</span> Voice</li>
    <li class="state" :class="check.on ? 'on' : 'off'">{{ check.on ? "On" : "Off" }}</li>
  </ul>
</template>

<style scoped>
.place-check { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 0.3rem; font-size: 0.74rem; font-weight: 700; }
.place-check li { padding: 0.12rem 0.5rem; border-radius: 999px; border: 1.5px solid var(--border); background: #fff; color: var(--muted); }
.place-check li.ok { background: #DCFCE7; border-color: #BBF7D0; color: #14532D; }
.place-check li.todo { background: #FEF9C3; border-color: #FDE68A; color: #713F12; }
.place-check li.state.on { background: #14532D; border-color: #14532D; color: #fff; }
.place-check li.state.off { background: #F3F4F6; border-color: #D1D5DB; color: #374151; }
</style>
