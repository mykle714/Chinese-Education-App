import { RefObject, useEffect } from "react";

/**
 * Adds desktop click-and-drag horizontal panning to a scrollable container. Touch/trackpad
 * input already scrolls natively (the container sets touchAction: 'pan-x'); this only wires up
 * mouse drag, which browsers don't provide for free. A capture-phase click listener swallows
 * the click that would otherwise fire on mouseup after a drag, so dragging over a card doesn't
 * also trigger its onClick.
 */
export function useDragScroll(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let isDown = false;
    let dragged = false;
    let startX = 0;
    let startScrollLeft = 0;

    const onMouseDown = (e: MouseEvent) => {
      isDown = true;
      dragged = false;
      startX = e.pageX;
      startScrollLeft = el.scrollLeft;
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!isDown) return;
      const delta = e.pageX - startX;
      if (Math.abs(delta) > 4) {
        dragged = true;
        el.style.cursor = "grabbing";
      }
      if (dragged) {
        el.scrollLeft = startScrollLeft - delta;
        e.preventDefault();
      }
    };
    const stopDrag = () => {
      isDown = false;
      el.style.cursor = "grab";
    };
    // Capture phase so this runs before the card's own onClick (registered on bubble at React's
    // root) and can swallow the click a drag would otherwise also fire on mouseup.
    const onClickCapture = (e: MouseEvent) => {
      if (dragged) {
        e.preventDefault();
        e.stopPropagation();
        dragged = false;
      }
    };

    el.style.cursor = "grab";
    el.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", stopDrag);
    el.addEventListener("click", onClickCapture, true);

    return () => {
      el.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", stopDrag);
      el.removeEventListener("click", onClickCapture, true);
    };
  }, [ref]);
}
