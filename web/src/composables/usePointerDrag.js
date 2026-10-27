// Drag-and-drop that works the same with a mouse and a finger. HTML5 drag events
// never fire on phones, so the planner drives drags from pointer events:
//   - mouse/pen: the drag starts once the pointer moves a few pixels;
//   - touch: press and hold (~¼ s) to pick a card up, so a normal swipe still
//     scrolls the page. Once picked up, page scrolling is blocked until release.
// Drop targets are any element with `data-drop` (+ data-date / data-hour), found
// by hit-testing under the finger, so targets need no listeners of their own.
import { reactive, onUnmounted } from "vue";

const HOLD_MS = 280;
const SLOP_PX = 8;
const EDGE_PX = 70;

export function usePointerDrag({ onDrop, onHover, scrollEl } = {}) {
  const drag = reactive({ active: false, payload: null, x: 0, y: 0, overKey: "" });
  let pending = null; // { id, type, x0, y0, timer }
  let target = null;
  let raf = 0;
  let pointer = { x: 0, y: 0 };

  function hitTest(x, y) {
    const el = document.elementFromPoint(x, y)?.closest("[data-drop]");
    if (!el) return null;
    return {
      el,
      key: el.dataset.drop,
      date: el.dataset.date || "",
      hour: el.dataset.hour != null && el.dataset.hour !== "" ? Number(el.dataset.hour) : null,
    };
  }

  function activate() {
    if (!pending) return;
    clearTimeout(pending.timer);
    drag.active = true;
    drag.x = pointer.x;
    drag.y = pointer.y;
    document.body.classList.add("pointer-dragging");
    if (pending.type === "touch") navigator.vibrate?.(12);
    raf = requestAnimationFrame(autoScroll);
    track(pointer.x, pointer.y);
  }

  function track(x, y) {
    drag.x = x;
    drag.y = y;
    target = hitTest(x, y);
    const key = target?.key || "";
    if (key !== drag.overKey) {
      drag.overKey = key;
      onHover?.(target, drag.payload);
    }
  }

  // Nudge the grid while the card is held near its edge, so far hours/days are reachable.
  function autoScroll() {
    if (!drag.active) return;
    const el = scrollEl?.value;
    if (el) {
      const r = el.getBoundingClientRect();
      const dy = pointer.y < r.top + EDGE_PX ? -1 : pointer.y > r.bottom - EDGE_PX ? 1 : 0;
      const dx = pointer.x < r.left + EDGE_PX ? -1 : pointer.x > r.right - EDGE_PX ? 1 : 0;
      if (dx || dy) {
        el.scrollBy(dx * 12, dy * 12);
        track(pointer.x, pointer.y);
      }
    }
    raf = requestAnimationFrame(autoScroll);
  }

  function onMove(e) {
    if (!pending || e.pointerId !== pending.id) return;
    pointer = { x: e.clientX, y: e.clientY };
    if (drag.active) return track(e.clientX, e.clientY);
    const moved = Math.hypot(e.clientX - pending.x0, e.clientY - pending.y0) > SLOP_PX;
    if (!moved) return;
    if (pending.type === "touch") cleanup(); // finger moved before the hold: it's a scroll
    else activate();
  }

  function onUp(e) {
    if (!pending || e.pointerId !== pending.id) return;
    const wasActive = drag.active;
    const payload = drag.payload;
    const dropTarget = wasActive ? hitTest(e.clientX, e.clientY) : null;
    cleanup();
    if (wasActive) {
      // Swallow the click the browser fires after a drag ends on a card/button.
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
      if (dropTarget) onDrop?.(payload, dropTarget);
    }
  }

  function swallow(e) { e.stopPropagation(); e.preventDefault(); }
  function noSelect(e) { e.preventDefault(); }
  function blockScroll(e) { if (drag.active) e.preventDefault(); }
  function onCancel() { cleanup(); }

  function cleanup() {
    if (pending) clearTimeout(pending.timer);
    pending = null;
    target = null;
    cancelAnimationFrame(raf);
    drag.active = false;
    drag.payload = null;
    drag.overKey = "";
    document.body.classList.remove("pointer-dragging");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    window.removeEventListener("touchmove", blockScroll);
    document.removeEventListener("selectstart", noSelect);
    onHover?.(null, null);
  }

  // Call from a card's @pointerdown. Presses on buttons/links inside the card
  // (the eye, Start) stay plain clicks.
  function start(e, payload) {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if (e.target.closest?.("button, a, input, select, textarea")) return;
    cleanup();
    pointer = { x: e.clientX, y: e.clientY };
    pending = { id: e.pointerId, type: e.pointerType, x0: e.clientX, y0: e.clientY, timer: 0 };
    drag.payload = payload;
    if (e.pointerType === "touch") pending.timer = setTimeout(activate, HOLD_MS);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("touchmove", blockScroll, { passive: false });
    document.addEventListener("selectstart", noSelect);
  }

  onUnmounted(cleanup);
  return { drag, start, cancel: cleanup };
}
