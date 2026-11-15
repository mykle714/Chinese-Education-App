// Tests for acp's deck-fill notice math (src/features/discover/deckFillNotices.ts,
// docs/SORT_CARDS_REQUIREMENTS.md § 5.4).
import { describe, it, expect } from "vitest";
import {
    DECK_FILL_TARGET,
    DECK_FILL_WARN_AT,
    countedSessionSorts,
    deckFillGoalCopy,
    deckFillWarningCopy,
    deckFillState,
    deckSizeToday,
    nextStudyDayStart,
} from "../features/discover/deckFillNotices";

/** Local wall-clock time → epoch ms (the module works in the runner's local zone). */
const at = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

describe("nextStudyDayStart", () => {
    it("is today's 04:00 before 04:00", () => {
        expect(nextStudyDayStart(at(2026, 11, 14, 2, 30))).toBe(at(2026, 11, 14, 4));
    });
    it("is tomorrow's 04:00 after 04:00", () => {
        expect(nextStudyDayStart(at(2026, 11, 14, 21))).toBe(at(2026, 11, 15, 4));
    });
    it("rolls to the next day at exactly 04:00", () => {
        expect(nextStudyDayStart(at(2026, 11, 14, 4))).toBe(at(2026, 11, 15, 4));
    });
});

describe("deckSizeToday", () => {
    const now = at(2026, 11, 14, 20);
    it("adds every band's ready count to the releases before the next 04:00", () => {
        const counts = { Unfamiliar: 3, Target: 4, Comfortable: 2, Mastered: 1 };
        const upcoming = [
            { readyAt: at(2026, 11, 14, 22), band: "Target" },
            { readyAt: at(2026, 11, 15, 3, 59), band: "Unfamiliar" },
            { readyAt: at(2026, 11, 15, 4), band: "Target" },   // the boundary itself: tomorrow's
            { readyAt: at(2026, 11, 15, 11), band: "Target" },  // inside 24 h, after 04:00
        ];
        expect(deckSizeToday(counts, upcoming, now)).toBe(10 + 2);
    });
    it("reads an empty response as an empty deck", () => {
        expect(deckSizeToday({}, [], now)).toBe(0);
    });
});

describe("countedSessionSorts", () => {
    it("counts Unfamiliar, Target and Comfortable sorts but not Mastered", () => {
        expect(countedSessionSorts({ library: [1, 2], target: [3], comfortable: [4], "already-learned": [5, 6, 7] })).toBe(4);
    });
});

describe("deckFillState", () => {
    it("names the cards still to sort toward the target", () => {
        expect(deckFillState(10, 3)).toEqual({ total: 13, toGo: DECK_FILL_TARGET - 13, full: false });
    });
    it("floors toGo at 0 and flags a full deck at the warning line", () => {
        expect(deckFillState(DECK_FILL_WARN_AT - 1, 1)).toEqual({ total: DECK_FILL_WARN_AT, toGo: 0, full: true });
    });
});

describe("deckFillGoalCopy", () => {
    it("names the minimum on arrival and counts down after", () => {
        expect(deckFillGoalCopy(12, 0)).toMatch(/at least 12 new cards/);
        expect(deckFillGoalCopy(1, 5)).toMatch(/^1 more card /);
    });
});

describe("deckFillWarningCopy", () => {
    it("tells an arriving learner they need not add, and a sorting one to slow down", () => {
        expect(deckFillWarningCopy(47, 0)).toMatch(/already has 47 cards.*don't need to add/);
        expect(deckFillWarningCopy(41, 3)).toMatch(/has 41 cards.*hard to keep up/);
    });
});
