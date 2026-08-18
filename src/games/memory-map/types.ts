/**
 * Memory Map run types (docs/MEMORY_MAP_GAME.md § 3).
 *
 * These describe a RUN, which is client state. The MAP itself is server state and its
 * types come from the wire contract (`MemoryMapWord`) — the split is the feature's
 * central design line (§ 1): nothing about a run reaches the server except its reading
 * marks, and nothing about the map is changed by a run except a fade-off deletion.
 */

/**
 * How well the player knew a word, and therefore what colour it wears.
 *
 * Ordered by outcome, not alphabetically:
 *   green  — correct on the first try
 *   orange — correct on the second or third try
 *   red    — three misses; the word glows, and turns solid once tapped
 *
 * A word with NO outcome is uncoloured and is still a valid answer surface. That is the
 * entire tap rule (§ 3.4): coloured = reference, uncoloured = answer.
 */
export type WordOutcome = "green" | "orange" | "red";

/**
 * The lifecycle of a single prompt.
 *
 * `hunting` covers both the confident first try and the desperate third; `failed` is
 * the distinct state after the third miss, where the target pulses and the English
 * prompt turns red — the player has stopped being tested and started being shown.
 */
export type PromptPhase = "hunting" | "failed";

/** One entry in the run's shuffled prompt queue. */
export interface QueuedPrompt {
    vocabEntryId: number;
}

/** The tallies the completion popup reports (§ 5). */
export interface RunTally {
    green: number;
    orange: number;
    red: number;
}

/** Where the camera is looking, in world units + zoom. Saved so a resume is seamless. */
export interface Camera {
    /** World coordinate at the centre of the viewport. */
    x: number;
    y: number;
    zoom: number;
}
