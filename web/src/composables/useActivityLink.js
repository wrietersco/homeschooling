import { ref } from "vue";

// Shared "copy the shareable activity URL" helper for the lists that show
// activities (syllabus, planner). The link is the per-activity page
// `/activity/:id`, which any guardian in the same family can open to view —
// and edit if their permissions allow. `copiedId` drives a transient ✓ on the
// chip that was just copied.
export function useActivityLink() {
  const copiedId = ref("");

  function activityUrl(id) {
    return `${window.location.origin}/activity/${id}`;
  }

  async function copyActivityLink(id) {
    if (!id) return;
    try {
      await navigator.clipboard.writeText(activityUrl(id));
      copiedId.value = id;
      setTimeout(() => {
        if (copiedId.value === id) copiedId.value = "";
      }, 2000);
    } catch { /* clipboard blocked */ }
  }

  return { copiedId, activityUrl, copyActivityLink };
}
