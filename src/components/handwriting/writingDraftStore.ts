/**
 * Preserved-draft store for the writing-practice popup.
 *
 * Lifecycle (docs/HANDWRITING_RECOGNITION.md "Canvas / state lifecycle"):
 *  - Closing the popup (✕ or backdrop) PRESERVES the active tab + canvas ink here,
 *    so an accidental click-off can be resumed by reopening.
 *  - Switching tabs clears the canvas (handled in the popup, not here).
 *  - Hard-clear triggers — leaving the flp, marking a card, leaving the cdp —
 *    call `clearWritingDraft()` to discard the draft.
 *
 * A single-entry module singleton: only one word is practiced at a time, and the
 * draft is keyed by the target word so a stale draft for a different word is
 * ignored rather than restored.
 *
 * `inks` is one Ink per character of the target word (length === [...word].length):
 * single-character words have a one-element array; multi-character words (the 2×2
 * grid) hold each character's strokes separately. `focusedIndex` is which grid
 * slot was enlarged when the popup closed (null = the grid itself / single char),
 * so reopening returns to the same view.
 *
 * Referenced by: PracticeWritingPopup.tsx (read/write), and the hard-clear call
 * sites in the flp and cdp.
 */
import type { Ink } from "./types";

export interface WritingDraft {
  character: string;
  activeTabIndex: number;
  /** One stroke set per character of the target word. */
  inks: Ink[];
  /** Enlarged grid slot at close time (null = grid view / single character). */
  focusedIndex: number | null;
}

let draft: WritingDraft | null = null;

/** Returns the preserved draft iff it belongs to `character`, else null. */
export function getWritingDraft(character: string): WritingDraft | null {
  return draft && draft.character === character ? draft : null;
}

export function setWritingDraft(next: WritingDraft): void {
  draft = next;
}

/** Hard-clear: discard any preserved draft. */
export function clearWritingDraft(): void {
  draft = null;
}
