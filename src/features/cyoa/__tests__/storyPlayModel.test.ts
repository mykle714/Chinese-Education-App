import { describe, expect, it } from "vitest";
import type { StoryPlayResponse, StoryPlayStep } from "../../../../server/contracts/stories";
import { endingsFoundBeforeFor, planChooseFailure, planPick, shouldReplayQueued } from "../storyPlayModel";

/** Tests for the play page's PREFETCH decisions (src/features/cyoa/storyPlayModel.ts). */

const step = (passageId: string, extra: Partial<StoryPlayStep> = {}): StoryPlayStep => ({
    story: { id: "s1", title: "Forest", iconId: null, language: "zh", isOwn: false },
    passage: { id: passageId, content: passageId, choices: [] },
    ending: null,
    toBeContinued: false,
    endingsFound: 1,
    endingsTotal: 3,
    passagesSeen: 2,
    passagesTotal: 5,
    ...extra,
});

const forestEnding = step("forest", { ending: { title: "Lost", isNew: true }, endingsFound: 2 });
const river = step("river");
const current: StoryPlayResponse = { ...step("start"), next: { c1: forestEnding, c2: river } };

describe("planPick", () => {
    it("shows the prediction at once, without a next of its own", () => {
        const plan = planPick(current, "c2", false);
        expect(plan).toEqual({ kind: "predict", shown: { ...river, next: {} }, endingsFoundBefore: null });
    });

    it("remembers the count before an ending so the end screen can tick from it", () => {
        const plan = planPick(current, "c1", false);
        expect(plan.kind).toBe("predict");
        if (plan.kind === "predict") {
            expect(plan.shown.ending?.isNew).toBe(true);
            expect(plan.endingsFoundBefore).toBe(1);
        }
    });

    it("queues a pick made while the passage on screen is still being confirmed", () => {
        expect(planPick(current, "c1", true)).toEqual({ kind: "queue" });
    });

    it("waits when the choice has no prediction (unavailable, or an edit raced the read)", () => {
        expect(planPick(current, "gone", false)).toEqual({ kind: "wait" });
        expect(planPick({ ...current, next: {} }, "c1", false)).toEqual({ kind: "wait" });
    });
});

describe("planChooseFailure", () => {
    it("404 → unavailable, 400 → re-read", () => {
        expect(planChooseFailure(404, current, true)).toEqual({ kind: "unavailable" });
        expect(planChooseFailure(400, current, true)).toEqual({ kind: "reread" });
    });

    it("anything else puts back the passage the pick was made on — only if it moved", () => {
        expect(planChooseFailure(null, current, true)).toEqual({ kind: "revert", restore: current });
        expect(planChooseFailure(500, current, false)).toEqual({ kind: "revert", restore: null });
    });
});

describe("shouldReplayQueued / endingsFoundBeforeFor", () => {
    it("replays a queued pick only when nothing newer superseded it", () => {
        expect(shouldReplayQueued("c1", 4, 4)).toBe(true);
        expect(shouldReplayQueued("c1", 4, 5)).toBe(false);
        expect(shouldReplayQueued(null, 4, 4)).toBe(false);
    });

    it("counts before only on an ending", () => {
        expect(endingsFoundBeforeFor(forestEnding, 1)).toBe(1);
        expect(endingsFoundBeforeFor(river, 1)).toBeNull();
    });
});
