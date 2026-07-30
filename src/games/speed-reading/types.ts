import type { VocabEntry } from "../../types";

/**
 * Round lifecycle. The clock runs across ALL of these — feedback time is part of
 * the minute, which is what makes FEEDBACK_MS a real cost rather than free
 * reading time.
 */
export type Phase =
    | "loading"   // initial card batch + distractor fetch
    | "blocked"   // not signed in, too few cards, or nothing playable
    | "ready"     // options live
    | "feedback"  // answer revealed, options frozen
    | "ended";    // clock expired

/** One word option as rendered on a button. */
export interface RoundOption {
    /**
     * The characters to draw, left to right. Exactly one position differs
     * between the two options (the one-character invariant).
     */
    chars: string[];
    isCorrect: boolean;
}

/** A fully-constructed round, ready to render. */
export interface Round {
    entry: VocabEntry;
    /** Index into the word of the character that differs between the options. */
    swapIndex: number;
    /** The two options in DISPLAY order (already shuffled). */
    options: [RoundOption, RoundOption];
}
