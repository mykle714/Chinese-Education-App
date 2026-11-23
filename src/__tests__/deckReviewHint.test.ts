import { describe, expect, it } from "vitest";
import type { VocabEntry } from "../types";
import { DECK_REVIEW_MIN_CARDS, isReviewHeavyDeck, pawnHintFor } from "../features/flashcards/FlashcardsLearnPage/hintPawn/pawnHints";
import { DECK_REVIEW_LINES, splitHintKeywords } from "../features/flashcards/FlashcardsLearnPage/hintPawn/pawnHintLines";
import { deckReviewKeyOf, initialDiveState, nextDiveState, type DiveState } from "../features/flashcards/FlashcardsLearnPage/hintPawn/useDeckReviewHint";

// docs/HINT_PAWN.md § "Deck review": once per dive, on its first card, when Comfortable +
// Mastered are strictly more than half of the world's off-cooldown Learning deck, and the
// deck holds at least DECK_REVIEW_MIN_CARDS (40) ready cards.

const HEAVY = { Unfamiliar: 10, Target: 10, Comfortable: 15, Mastered: 6 };
const LIGHT = { Unfamiliar: 20, Target: 10, Comfortable: 6, Mastered: 5 };

describe("isReviewHeavyDeck", () => {
    it("needs a strict majority of Comfortable + Mastered", () => {
        expect(isReviewHeavyDeck(HEAVY)).toBe(true);
        expect(isReviewHeavyDeck({ Unfamiliar: 10, Target: 10, Comfortable: 10, Mastered: 10 })).toBe(false);
        expect(isReviewHeavyDeck(LIGHT)).toBe(false);
    });

    it("needs at least DECK_REVIEW_MIN_CARDS ready cards", () => {
        expect(isReviewHeavyDeck({ Unfamiliar: 3, Target: 7, Comfortable: 14, Mastered: 6 })).toBe(false);
        expect(isReviewHeavyDeck({ Comfortable: DECK_REVIEW_MIN_CARDS - 1 })).toBe(false);
        expect(isReviewHeavyDeck({ Comfortable: DECK_REVIEW_MIN_CARDS })).toBe(true);
    });

    it("is never true for an empty or missing deck", () => {
        expect(isReviewHeavyDeck(undefined)).toBe(false);
        expect(isReviewHeavyDeck({})).toBe(false);
    });
});

describe("splitHintKeywords band markup", () => {
    it("pulls out [Band] runs for the bands with an ink", () => {
        expect(splitHintKeywords("Mostly [Comfortable] & [Mastered].")).toEqual([
            { text: "Mostly ", keyword: false },
            { text: "Comfortable", keyword: false, band: "Comfortable" },
            { text: " & ", keyword: false },
            { text: "Mastered", keyword: false, band: "Mastered" },
            { text: ".", keyword: false },
        ]);
    });

    it("leaves an unknown [word] as plain text, brackets and all", () => {
        expect(splitHintKeywords("A [Target] card, tap {Compare}")).toEqual([
            { text: "A [Target] card, tap ", keyword: false },
            { text: "Compare", keyword: true },
        ]);
    });

    it("the deck-review line names both bands", () => {
        for (const line of DECK_REVIEW_LINES) {
            const bands = splitHintKeywords(line).flatMap((run) => (run.band ? [run.band] : []));
            expect(bands).toEqual(["Comfortable", "Mastered"]);
        }
    });
});

describe("pawnHintFor with a deck-review key", () => {
    it("is said in every world", () => {
        const entry = { id: 7, entryKey: "我", writingSourceWords: [{ entryKey: "我们" }] } as VocabEntry;
        for (const world of ["core", "reading", "writing"] as const) {
            expect(pawnHintFor(world, entry, "1|7")).toMatchObject({ kind: "deck-review", key: "deck-review|1|7" });
        }
        // Writing has no card hint of its own (the card shows its source words itself).
        expect(pawnHintFor("writing", entry, null)).toBeNull();
    });
});

// Drives the hook's pure transition the way the hook does each render.
function dive(initialParked: boolean) {
    let state: DiveState = initialDiveState(initialParked, undefined);
    return (parked: boolean, counts: Record<string, number> | undefined, front: number | null) => {
        state = nextDiveState(state, parked, counts, front);
        return deckReviewKeyOf(state, front);
    };
}

describe("useDeckReviewHint (its transition)", () => {
    it("speaks on the dive's first card only, and again on the next dive", () => {
        const render = dive(true);
        expect(render(true, undefined, 7)).toBeNull();
        expect(render(false, HEAVY, 7)).toBe("1|7");
        expect(render(false, HEAVY, 8)).toBeNull();
        expect(render(false, HEAVY, 7)).toBe("1|7"); // undo back onto it
        expect(render(true, undefined, 8)).toBeNull();
        expect(render(false, HEAVY, 8)).toBe("2|8");
    });

    it("waits for the first card of a dive that is still loading", () => {
        const render = dive(true);
        expect(render(false, HEAVY, null)).toBeNull();
        expect(render(false, HEAVY, 3)).toBe("1|3");
    });

    it("judges the deck once, at the dive's start", () => {
        const render = dive(true);
        expect(render(false, LIGHT, 7)).toBeNull();
        expect(render(false, HEAVY, 7)).toBeNull();
    });

    it("settles: an unchanged render returns the same state", () => {
        const state = nextDiveState(initialDiveState(true, undefined), false, HEAVY, 7);
        expect(nextDiveState(state, false, HEAVY, 7)).toBe(state);
    });
});
