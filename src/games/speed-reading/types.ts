import type { ExampleSentence, VocabEntry } from "../../types";

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

/**
 * How one side of the screen is currently painted. Lives here rather than on a
 * component because two of them read it: the tap zone (which paints the tint)
 * and the page (which derives it from the round).
 */
export type OptionFeedback = "none" | "correct" | "wrong";

/** One option as rendered on its half of the screen. */
export interface RoundOption {
    /**
     * The characters to draw, left to right — the headword on a word round, the
     * whole example sentence (punctuation included) on a sentence round. Exactly
     * one position differs between the two options (the one-character
     * invariant).
     */
    chars: string[];
    isCorrect: boolean;
}

/** What both round kinds carry. */
interface RoundBase {
    /** The vocab card the round was built from; the mark is written against it. */
    entry: VocabEntry;
    /** Index into `RoundOption.chars` of the character that differs. */
    swapIndex: number;
    /** The two options in DISPLAY order (already shuffled). */
    options: [RoundOption, RoundOption];
}

/** The ordinary round: two spellings of one headword. */
export interface WordRound extends RoundBase {
    kind: "word";
}

/**
 * The finale round (the last SENTENCE_ROUNDS of a run): two spellings of one
 * EXAMPLE SENTENCE, differing at one character INSIDE the target headword. The
 * prompt shows the sentence's translation and pinyin and narrates the sentence,
 * so `sentence` is carried on the round rather than re-derived from the entry —
 * an entry usually has several and the round is built from one specific pick.
 */
export interface SentenceRound extends RoundBase {
    kind: "sentence";
    sentence: ExampleSentence;
}

/** A fully-constructed round, ready to render. */
export type Round = WordRound | SentenceRound;
