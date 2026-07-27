// Shared claim on HORIZONTAL gestures, held by an example-sentence segment
// selection.
//
// While a segment is selected, a horizontal drag anywhere on screen is the
// drag-scrub gesture (SegmentedSentenceDisplay: it walks the selection word by
// word and narrates each one). Any other surface that also reads horizontal
// drags — today the eip's swipe-to-change-tab (InfoCardPanelBody) — must stand
// down for the duration, or one drag would both scrub words AND slide the panel.
// The user deselects (tap anywhere off a word) to hand horizontal gestures back.
//
// A plain module-level flag rather than context/state on purpose: the consumers
// are raw, non-React `addEventListener` handlers that need a synchronous answer
// mid-gesture, and no re-render should be triggered by claiming or releasing.
//
// Referenced by:
//   - src/components/SegmentedSentenceDisplay.tsx (claims while a scrub-enabled
//     selection exists)
//   - src/features/flashcards/FlashcardsLearnPage/InfoCardPanelBody.tsx (tab
//     swipe defers to the claim)
//   - docs/EXAMPLE_SENTENCES.md § "Drag-scrub"

// Reference count, not a boolean: several displays can be mounted at once and a
// selection can move between them, so releases must not clobber a live claim.
let claimCount = 0;

/**
 * Claim horizontal gestures for the drag-scrub. Returns the release function —
 * call it exactly once (it is the cleanup of the effect that claimed).
 */
export function claimHorizontalGesture(): () => void {
  claimCount += 1;
  let released = false;
  return () => {
    if (released) return; // idempotent: a double-release must not undercount
    released = true;
    claimCount = Math.max(0, claimCount - 1);
  };
}

/** True while a selected example-sentence segment owns horizontal gestures. */
export function isHorizontalGestureClaimed(): boolean {
  return claimCount > 0;
}
