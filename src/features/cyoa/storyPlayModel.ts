import type { StoryPlayResponse, StoryPlayStep } from "../../../server/contracts/stories";

/**
 * storyPlayModel — the pure decisions behind a pick on the play page (docs/CYOA_FEATURE.md
 * § 3.3 "A pick never waits", § 7.1). No React, no network: useStoryPlay performs what these
 * functions decide, so the PREFETCH rules are unit-tested here
 * (src/features/cyoa/__tests__/storyPlayModel.test.ts) — the repo has no React testing library.
 *
 * LAYER: feature model (src/features/cyoa). Depended on by: useStoryPlay.ts.
 */

/** What to do with a pick, given the passage on screen. */
export type PickPlan =
    /** A /choose is still confirming the passage on screen: hold this pick and replay it. */
    | { kind: "queue" }
    /** Show the server's prediction at once; /choose confirms it in the background. */
    | { kind: "predict"; shown: StoryPlayResponse; endingsFoundBefore: number | null }
    /** No prediction (an author edit raced the read, or a stale choice): dim and wait. */
    | { kind: "wait" };

/**
 * The count the end screen ticks FROM (1/7 → 2/7, § 3.6) — only when the step is an
 * ending; null otherwise.
 */
export function endingsFoundBeforeFor(step: StoryPlayStep, foundBefore: number): number | null {
    return step.ending ? foundBefore : null;
}

export function planPick(current: StoryPlayResponse, choiceId: string, confirming: boolean): PickPlan {
    if (confirming) return { kind: "queue" };
    const predicted = current.next[choiceId];
    if (!predicted) return { kind: "wait" };
    // A prediction carries no `next` of its own (the server prefetches one level); the
    // confirmed response brings it.
    return {
        kind: "predict",
        shown: { ...predicted, next: {} },
        endingsFoundBefore: endingsFoundBeforeFor(predicted, current.endingsFound),
    };
}

/** What to do when POST /choose fails. */
export type ChooseFailurePlan =
    /** The story is gone or unpublished (404). */
    | { kind: "unavailable" }
    /** A stale or target-less choice (400): re-read /play and show the server's message. */
    | { kind: "reread" }
    /**
     * Anything else (network, 5xx): nothing was saved. `restore` is the passage the pick
     * was made on when the prediction already replaced it, or null when nothing moved.
     */
    | { kind: "revert"; restore: StoryPlayResponse | null };

export function planChooseFailure(status: number | null, before: StoryPlayResponse, predicted: boolean): ChooseFailurePlan {
    if (status === 404) return { kind: "unavailable" };
    if (status === 400) return { kind: "reread" };
    return { kind: "revert", restore: predicted ? before : null };
}

/**
 * Whether a queued pick should be replayed once the confirmation settles: only when no
 * newer request (a reload, a story change) has superseded it.
 */
export function shouldReplayQueued(queued: string | null, seq: number, latestSeq: number): queued is string {
    return queued !== null && seq === latestSeq;
}
