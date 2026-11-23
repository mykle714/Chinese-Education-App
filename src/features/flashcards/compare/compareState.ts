import type { DictionaryEntry, LongDefinitionPart, VocabEntry } from "../../../types";

/**
 * compareState — the Compare panel's state shape and the pure rules over it
 * (docs/WORD_COMPARE_FEATURE.md § State).
 *
 * LAYER: feature logic (src/features/flashcards/compare). Pure; no React.
 * Depended on by: CompareSheet.tsx (owner), CompareSlots.tsx, CompareShelfBody.tsx;
 * __tests__/compareState.test.ts.
 */

/** Which of the two word slots. A is the left keycap (seeded from the calling word), B the right. */
export type CompareSlot = "A" | "B";

/**
 * The two words being compared plus the result of comparing them — everything the panel
 * renders from. Lives in `CompareSheet`'s state and is discarded when the panel closes.
 */
export interface CompareState {
    slotA: VocabEntry | null;
    slotB: VocabEntry | null;
    /** The AI paragraph for the CURRENT pair; cleared whenever either slot changes. */
    comparison: string | null;
    /** Embedded-Chinese runs of `comparison`, GSA-segmented + pinyin-annotated server-side. */
    comparisonParts: LongDefinitionPart[] | null;
}

export const EMPTY_COMPARE_STATE: CompareState = {
    slotA: null,
    slotB: null,
    comparison: null,
    comparisonParts: null,
};

/**
 * Which slot the shelf's dictionary search is filling, or null when the shelf shows the
 * comparison (or, with a slot still empty, the "tap the +" hint) instead.
 *
 * Search mode is ALWAYS the learner's choice (owner's call 2026-11-21, revised the same
 * day): an empty slot does not open the search on its own — the learner taps its "+"
 * keycap. So this is just the tapped slot (`requested`); it exists as the one named rule
 * the slots and the shelf both read.
 */
export function activeSearchSlot(_state: CompareState, requested: CompareSlot | null): CompareSlot | null {
    return requested;
}

export const otherSlot = (slot: CompareSlot): CompareSlot => (slot === "A" ? "B" : "A");

export const slotEntry = (state: CompareState, slot: CompareSlot): VocabEntry | null =>
    slot === "A" ? state.slotA : state.slotB;

/** Most characters a compare slot shows: its xl cpcd is a block of up to four. */
export const COMPARE_MAX_CHARS = 4;

/**
 * Whether a search result may be picked into `slot`: up to COMPARE_MAX_CHARS characters
 * (longer words are left out rather than squeezed into a row layout mid-search), and not
 * the word already in the OTHER slot (the server refuses a word compared with itself).
 * Search rows are det records, whose headword field is `word1`.
 */
export function isPickableFor(entry: DictionaryEntry, other: VocabEntry | null): boolean {
    const word = entry.word1 ?? "";
    return [...word].length <= COMPARE_MAX_CHARS && word !== other?.entryKey;
}
