import { useEffect, type RefObject } from "react";

export interface DragScrollOptions {
  /**
   * The container is a PAGER (`scroll-snap-type: x mandatory`, one page per
   * `clientWidth`) rather than a free-running strip.
   *
   * Two things have to change for a mouse drag on such a container:
   *   1. mandatory snap fights an imperative `scrollLeft` — the browser re-snaps
   *      mid-gesture and the page never follows the cursor — so snap is switched off
   *      for the duration of the drag and restored once it has settled;
   *   2. with snap off, nothing settles the release, so the drag commits itself:
   *      past `PAGE_COMMIT_RATIO` of a page it advances, otherwise it springs back.
   */
  paged?: boolean;
}

/** Fraction of a page a paged drag must cover to turn the page instead of springing back. */
const PAGE_COMMIT_RATIO = 0.25;

/**
 * How long the post-release smooth scroll is given before mandatory snap is put back.
 * Re-arming snap while that scroll is still in flight teleports it to the target.
 */
const SNAP_RESTORE_MS = 400;

/**
 * Adds desktop click-and-drag horizontal panning to a scrollable container. Touch/trackpad
 * input already scrolls natively (the container sets touchAction: 'pan-x'); this only wires up
 * mouse drag, which browsers don't provide for free. A capture-phase click listener swallows
 * the click that would otherwise fire on mouseup after a drag, so dragging over a card doesn't
 * also trigger its onClick.
 *
 * Pass `{ paged: true }` for a scroll-snap pager (see `DragScrollOptions`).
 */
export function useDragScroll(ref: RefObject<HTMLElement | null>, options: DragScrollOptions = {}): void {
  const { paged = false } = options;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let isDown = false;
    let dragged = false;
    let startX = 0;
    let startScrollLeft = 0;
    // The container's authored snap rule, parked while a paged drag is in flight.
    let parkedSnapType = "";
    let snapRestoreTimer: ReturnType<typeof setTimeout> | undefined;

    /** Put the authored `scroll-snap-type` back once the release scroll has settled. */
    const restoreSnap = () => {
      el.style.scrollSnapType = parkedSnapType;
    };

    const onMouseDown = (e: MouseEvent) => {
      isDown = true;
      dragged = false;
      startX = e.pageX;
      startScrollLeft = el.scrollLeft;
      if (paged) {
        // A restore still pending from the previous drag would fire mid-gesture.
        if (snapRestoreTimer) clearTimeout(snapRestoreTimer);
        // Only park the real rule — a second mousedown inside the same drag must not
        // record the "none" we just wrote as if it were the authored value.
        if (el.style.scrollSnapType !== "none") parkedSnapType = el.style.scrollSnapType;
        el.style.scrollSnapType = "none";
      }
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
      const wasDragging = isDown && dragged;
      isDown = false;
      el.style.cursor = "grab";
      if (!paged) return;
      if (!wasDragging) {
        // A click that never moved: nothing to commit, just un-park the snap rule.
        restoreSnap();
        return;
      }
      const width = el.clientWidth;
      if (width > 0) {
        const lastPage = Math.max(0, Math.round(el.scrollWidth / width) - 1);
        const fromPage = Math.round(startScrollLeft / width);
        const travel = el.scrollLeft - startScrollLeft;
        // Commit on travel, not on which half the page ended in: a short deliberate
        // flick should turn the page, and a long drag that stalls should not.
        const step = Math.abs(travel) > width * PAGE_COMMIT_RATIO ? Math.sign(travel) : 0;
        const target = Math.min(lastPage, Math.max(0, fromPage + step));
        el.scrollTo({ left: target * width, behavior: "smooth" });
      }
      snapRestoreTimer = setTimeout(restoreSnap, SNAP_RESTORE_MS);
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
    // The sub-cards are anchors (RouterLink), and browsers natively drag an <a>'s URL (and any
    // text/image inside it) on mouse-drag. That native drag-and-drop hijacks the pointer — our
    // mousemove/mouseup panning never regains control (the cursor gets "stuck" dragging a link
    // to drop elsewhere). Cancel dragstart so only our pan logic runs.
    const onDragStart = (e: DragEvent) => e.preventDefault();

    el.style.cursor = "grab";
    el.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", stopDrag);
    el.addEventListener("click", onClickCapture, true);
    el.addEventListener("dragstart", onDragStart);

    return () => {
      if (snapRestoreTimer) clearTimeout(snapRestoreTimer);
      el.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", stopDrag);
      el.removeEventListener("click", onClickCapture, true);
      el.removeEventListener("dragstart", onDragStart);
    };
  }, [ref, paged]);
}
