import { describe, expect, it } from "vitest";
import { wordSearchGridParams } from "../wordSearchGrid";
import { wordSearchGridRequest } from "../../games/word-search/gridRequest";
import { personalBestMode, runResultScore, runResultTiers, runResultTitle } from "../../games/word-search/constants";
import { WORD_SEARCH_BREAK, WORD_SEARCH_BREAK_BOARD } from "../../games/flpBreak/wordSearchBreak";
import type { FlpBreakContext } from "../../games/flpBreak/types";
import type { WordSearchResponse } from "../../games/word-search/types";
import { cpcdNaturalSize } from "../../components/cpcdLayout";

describe("wordSearchGridParams", () => {
    it("sends the mode and the board's band mix", () => {
        const params = wordSearchGridParams(wordSearchGridRequest({ mode: "pinyin" }));
        expect(params).toEqual({ mode: "pinyin", Unfamiliar: 1, Target: 5, Comfortable: 2, Mastered: 1 });
    });

    it("sends the compact board and its smaller band mix", () => {
        const params = wordSearchGridParams(wordSearchGridRequest({ mode: "pinyin", board: "compact" }));
        expect(params).toEqual({ mode: "pinyin", board: "compact", Unfamiliar: 1, Target: 4, Comfortable: 1, Mastered: 1 });
    });

    it("carries an flp break's seed and flag", () => {
        const params = wordSearchGridParams(wordSearchGridRequest({
            mode: "no-pinyin",
            seedIds: [4, 9],
            flpBreak: true,
        }));
        expect(params.seedIds).toBe("4,9");
        expect(params.flpBreak).toBe(1);
    });

    it("lets a challenge round's mode replace the board's, as one key", () => {
        const params = wordSearchGridParams(wordSearchGridRequest({
            mode: "no-pinyin",
            challengeParams: "&challengeId=7&gameId=word-search&mode=pinyin",
        }));
        expect(params.mode).toBe("pinyin");
        expect(params.challengeId).toBe("7");
    });
});

describe("WORD_SEARCH_BREAK.isPlayable", () => {
    const board = (sufficient: boolean, grid: WordSearchResponse["grid"]) =>
        ({ sufficient, grid }) as WordSearchResponse;

    it("refuses a board the server could not deal", () => {
        expect(WORD_SEARCH_BREAK.isPlayable?.(board(false, null))).toBe(false);
    });

    it("accepts a dealt grid", () => {
        expect(WORD_SEARCH_BREAK.isPlayable?.(board(true, [[]]))).toBe(true);
    });
});

describe("Word Search break board", () => {
    const context = {} as FlpBreakContext;

    it("always plays the compact board (the flp runs only inside the Deck Tower)", () => {
        expect(WORD_SEARCH_BREAK_BOARD).toBe("compact");
    });

    it("needs only the compact board's words from a focused session", () => {
        expect(WORD_SEARCH_BREAK.focusMinimum?.(context)).toBe(7);
    });
});

describe("Word Search compact tiles", () => {
    // Five columns have to span the width six `sm` tiles do. A change to the `smd` tables
    // resizes the whole compact board, not just its text.
    it("makes a 70px tile with pinyin, 66px without", () => {
        expect(cpcdNaturalSize("smd", { bigPinyin: true }).height).toBe(70);
        expect(cpcdNaturalSize("smd").height).toBe(66);
    });
});

describe("Word Search board scoring", () => {
    it("asks for the same pace on a smaller board", () => {
        // Tier 2's 60s line on 9 words is ~46.7s on the 7-word compact board.
        // The panel shows the real time; only the grade uses the scaled one.
        expect(runResultTiers(true, 46_000, 7)?.speed).toEqual({ tier: 2, elapsedMs: 46_000 });
        expect(runResultTiers(true, 47_000, 7)?.speed.tier).toBe(3);
        expect(runResultTiers(true, 60_000)?.speed.tier).toBe(2);
    });

    it("keeps a compact board's personal best apart from the mode's", () => {
        expect(personalBestMode("pinyin", "standard")).toBe("pinyin");
        expect(personalBestMode("no-pinyin", "compact")).toBe("no-pinyin-compact");
    });
});

describe("Word Search break results", () => {
    it("names a finished run and its finish time", () => {
        expect(runResultTitle(true)).toBe("Finished!");
        expect(runResultTiers(true, 45_000)).toEqual({ speed: { tier: 1, elapsedMs: 45_000 } });
        expect(runResultScore(9, 9, 45_000)).toBe("All 9 found in 0:45");
    });

    it("gives a run left early no tiers and no time", () => {
        expect(runResultTitle(false)).toBe("Run ended");
        expect(runResultTiers(false, 45_000)).toBeNull();
        expect(runResultScore(4, 9, 45_000)).toBe("4 of 9 words found");
    });
});
