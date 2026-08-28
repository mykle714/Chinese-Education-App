// Exclusive ownership of "the selected segment", app-wide.
//
// Every example sentence renders its own SegmentedSentenceDisplay, and each one
// owns its selection state independently. Without a shared owner, tapping a word
// in sentence B leaves sentence A's word selected: A's outside-tap dismiss rule
// only fires for taps outside A's own row, and it cannot tell its own characters
// from a sibling display's. The result is two popups open at once.
//
// The invariant this enforces: **at most one segment selection exists in the app
// at any time.** A display claims ownership the moment it selects a segment, and
// every other registered display clears itself synchronously.
//
// A module-level registry rather than context on purpose: the displays are
// siblings under call sites that have no shared selection state to lift into
// (est renders a list; long-definition and compare render standalone), and the
// claim must land synchronously inside a touch handler.
//
// Referenced by:
//   - src/components/SegmentedSentenceDisplay.tsx (registers on mount, claims on select)
//   - docs/EXAMPLE_SENTENCES.md § "One selection at a time (cross-sentence deselect)"

/** Identity token for a registered display, plus how to clear its selection. */
type SelectionOwner = {
  token: object;
  clear: () => void;
};

const owners = new Set<SelectionOwner>();

/**
 * Register a display as a possible selection owner. `clear` must drop that
 * display's selection (state AND its mirroring ref). Returns the unregister
 * function — call it exactly once, as the cleanup of the effect that registered.
 */
export function registerSegmentSelectionOwner(token: object, clear: () => void): () => void {
  const owner: SelectionOwner = { token, clear };
  owners.add(owner);
  return () => {
    owners.delete(owner);
  };
}

/**
 * Claim the app-wide segment selection for `token`, clearing every other
 * registered display. Safe to call repeatedly for the same token (a display
 * re-selecting within itself clears nobody).
 */
export function claimSegmentSelection(token: object): void {
  owners.forEach((owner) => {
    if (owner.token !== token) owner.clear();
  });
}
