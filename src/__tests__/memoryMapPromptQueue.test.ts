import { describe, expect, it } from "vitest";
import { nextPromptIndex } from "../games/memory-map/promptQueue";

/**
 * Regression cover for the stranded-cursor bug (docs/MEMORY_MAP_GAME.md § 14.8): a
 * forward-only scan returned -1 while unanswered words remained, and the prompt bar
 * rendered an empty question the run could never leave.
 */
describe("nextPromptIndex", () => {
    const all = () => true;
    const none = () => false;

    it("returns the entry at the cursor when it is available", () => {
        expect(nextPromptIndex(["a", "b", "c"], 1, all)).toBe(1);
    });

    it("skips unavailable entries going forward", () => {
        expect(nextPromptIndex(["a", "b", "c"], 0, (e) => e === "c")).toBe(2);
    });

    it("wraps to the start when nothing ahead of the cursor is available", () => {
        expect(nextPromptIndex(["a", "b", "c"], 2, (e) => e === "a")).toBe(0);
    });

    it("wraps when the cursor sits past the end of a shortened queue", () => {
        // A resumed run whose saved queue lost entries to graduation, but whose saved
        // position was restored verbatim — the exact shape that stranded the player.
        expect(nextPromptIndex(["a", "b"], 40, all)).toBe(0);
    });

    it("clamps a negative cursor rather than indexing backwards", () => {
        expect(nextPromptIndex(["a", "b"], -3, all)).toBe(0);
    });

    it("returns -1 only when nothing at all is available", () => {
        expect(nextPromptIndex(["a", "b"], 0, none)).toBe(-1);
    });

    it("returns -1 for an empty queue", () => {
        expect(nextPromptIndex([], 0, all)).toBe(-1);
    });

    it("visits every entry exactly once before giving up", () => {
        const seen: string[] = [];
        nextPromptIndex(["a", "b", "c", "d"], 2, (e) => {
            seen.push(e);
            return false;
        });
        expect(seen).toEqual(["c", "d", "a", "b"]);
    });
});
