// Shared placement logic for spot pins drawn over cover-fitted artwork: tracks
// the container box and the artwork's natural size, and maps picture
// percentages to on-screen pixels through the cover transform.
import { ref, watch, onBeforeUnmount } from "vue";
import { coverMap } from "@/lib/wikido/cover";

export function useCoverPlacement(containerRef) {
  const box = ref({ w: 0, h: 0 });
  const natural = ref({ w: 1920, h: 1080 }); // 16:9 default until the image loads
  let observer = null;

  const measure = () => {
    const el = containerRef.value;
    if (el) box.value = { w: el.clientWidth, h: el.clientHeight };
  };

  // The editor's stage appears after its topic loads; observe replacements too.
  watch(containerRef, (el) => {
    observer?.disconnect();
    measure();
    if (typeof ResizeObserver !== "undefined" && el) {
      observer = new ResizeObserver(measure);
      observer.observe(el);
    }
  }, { flush: "post", immediate: true });
  onBeforeUnmount(() => observer?.disconnect());

  function onArtworkLoad(e) {
    const img = e.target;
    if (img?.naturalWidth && img?.naturalHeight) {
      natural.value = { w: img.naturalWidth, h: img.naturalHeight };
    }
    measure();
  }

  // → { left: 123, top: 456 } in CONTAINER PIXELS (numbers — callers add units)
  function pinPosition(percentX, percentY) {
    return coverMap(percentX, percentY, box.value.w, box.value.h, natural.value.w, natural.value.h);
  }

  // ready-to-bind :style variant
  function pinStyle(percentX, percentY) {
    const { left, top } = pinPosition(percentX, percentY);
    return { left: `${left}px`, top: `${top}px` };
  }

  // Inverse: a pointer position over the cover-fitted artwork → picture
  // percentages (so dragging a pin updates the stored x/y correctly).
  function picturePercent(clientX, clientY, rect) {
    const iw = natural.value.w || 1920;
    const ih = natural.value.h || 1080;
    const scale = Math.max(rect.width / iw, rect.height / ih);
    const shownW = iw * scale;
    const shownH = ih * scale;
    const offX = (rect.width - shownW) / 2;
    const offY = (rect.height - shownH) / 2;
    const x = ((clientX - rect.left - offX) / shownW) * 100;
    const y = ((clientY - rect.top - offY) / shownH) * 100;
    return {
      x: Math.round(Math.min(100, Math.max(0, x)) * 10) / 10,
      y: Math.round(Math.min(100, Math.max(0, y)) * 10) / 10,
    };
  }

  return { box, natural, onArtworkLoad, pinPosition, pinStyle, picturePercent };
}
