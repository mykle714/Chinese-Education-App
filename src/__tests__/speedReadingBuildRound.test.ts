import { describe, it, expect } from "vitest";
import {
    buildRound,
    buildSentenceRound,
    hasSentenceRound,
    usableSentences,
    wordCharacters,
} from "../games/speed-reading/buildRound";
import type { DistractorChar, VocabEntry } from "../types";

/**
 * Round construction for Speed Reading (docs/SPEED_READING_GAME.md).
 *
 * The invariant under test is the ONE-CHARACTER INVARIANT: the two options must
 * differ in exactly one position and be the same length, because word length
 * would otherwise leak the answer before the player reads anything.
 *
 * `rng` is injected everywhere so a round is reproducible — the fallback ladder
 * is otherwise untestable.
 */

/** Minimal vocab entry; only `id`, `entryKey` and `pronunciation` are read. */
function entry(entryKey: string, id = 1): VocabEntry {
    return { id, entryKey, pronunciation: "ni3 hao3" } as unknown as VocabEntry;
}

function distractor(
    char: string,
    difficultyBand: number | null = 1,
    readingMastered = false
): DistractorChar {
    return { char, difficultyBand, readingMastered };
}

/** RNG that walks a fixed script, so every branch is reachable from a test. */
function scriptedRng(values: number[]): () => number {
    let i = 0;
    return () => values[Math.min(i++, values.length - 1)];
}

describe("wordCharacters", () => {
    it("splits a headword into CJK characters", () => {
        expect(wordCharacters("你好")).toEqual(["你", "好"]);
    });

    it("drops non-CJK characters", () => {
        expect(wordCharacters("A你,好!")).toEqual(["你", "好"]);
    });

    it("returns an empty array for a headword with no CJK at all", () => {
        expect(wordCharacters("hola")).toEqual([]);
        expect(wordCharacters("")).toEqual([]);
    });
});

describe("buildRound", () => {
    it("returns null when the headword has no CJK characters", () => {
        expect(buildRound(entry("hola"), [distractor("我")])).toBeNull();
    });

    it("returns null when the distractor pool is empty", () => {
        expect(buildRound(entry("你好"), [])).toBeNull();
    });

    it("returns null when every distractor already appears in the word", () => {
        // Both candidates are in 你好, so substituting either could produce a
        // real rearrangement of the same characters.
        const round = buildRound(entry("你好"), [distractor("你"), distractor("好")]);
        expect(round).toBeNull();
    });

    it("produces two same-length options differing in exactly one position", () => {
        const round = buildRound(entry("你好"), [distractor("妤")], scriptedRng([0, 0, 0.9]));
        expect(round).not.toBeNull();
        const [a, b] = round!.options;
        expect(a.chars).toHaveLength(b.chars.length);
        const diffs = a.chars.filter((ch, i) => ch !== b.chars[i]);
        expect(diffs).toHaveLength(1);
    });

    it("marks exactly one option correct, and it is the true headword", () => {
        const round = buildRound(entry("你好"), [distractor("妤")], scriptedRng([0, 0, 0.9]));
        const correct = round!.options.filter((o) => o.isCorrect);
        expect(correct).toHaveLength(1);
        expect(correct[0].chars.join("")).toBe("你好");
    });

    it("puts the correct option first or second depending on the rng draw", () => {
        const first = buildRound(entry("你好"), [distractor("妤")], scriptedRng([0, 0, 0.1]));
        const second = buildRound(entry("你好"), [distractor("妤")], scriptedRng([0, 0, 0.9]));
        expect(first!.options[0].isCorrect).toBe(true);
        expect(second!.options[1].isCorrect).toBe(true);
    });

    it("handles a single-character word by replacing the whole option", () => {
        const round = buildRound(entry("我"), [distractor("找")], scriptedRng([0, 0, 0.9]));
        expect(new Set(round!.options.map((o) => o.chars.join("")))).toEqual(new Set(["我", "找"]));
    });

    it("never uses a character already in the word as the distractor", () => {
        // 好 is in the word and must be filtered out, leaving only 妤.
        const round = buildRound(
            entry("你好"),
            [distractor("好"), distractor("妤")],
            scriptedRng([0, 0, 0.9])
        );
        const wrong = round!.options.find((o) => !o.isCorrect)!;
        // swapIndex is 0 under this rng script, so 你 is the position replaced.
        expect(wrong.chars.join("")).toBe("妤好");
    });

    describe("the fallback ladder", () => {
        it("rung 1: prefers an unmastered distractor in the target's own band", () => {
            const round = buildRound(
                entry("你好"),
                [
                    distractor("你", 3), // establishes the target's band (swapIndex 0)
                    distractor("妤", 5), // wrong band
                    distractor("拟", 3), // same band, unmastered → the pick
                    distractor("尔", 3, true), // same band but reading-mastered
                ],
                scriptedRng([0, 0, 0.9])
            );
            const wrong = round!.options.find((o) => !o.isCorrect)!;
            expect(wrong.chars[0]).toBe("拟");
        });

        it("rung 2: drops the band preference when no same-band candidate exists", () => {
            const round = buildRound(
                entry("你好"),
                [distractor("你", 3), distractor("妤", 5)],
                scriptedRng([0, 0, 0.9])
            );
            const wrong = round!.options.find((o) => !o.isCorrect)!;
            expect(wrong.chars[0]).toBe("妤");
        });

        it("rung 2: skips rung 1 entirely when the target's band is unknown", () => {
            // 你 has no standalone det row, so targetBand is null and rung 1 is
            // empty by construction.
            const round = buildRound(
                entry("你好"),
                [distractor("妤", 5)],
                scriptedRng([0, 0, 0.9])
            );
            expect(round!.options.find((o) => !o.isCorrect)!.chars[0]).toBe("妤");
        });

        it("rung 3: falls back to a reading-mastered character rather than no round", () => {
            const round = buildRound(
                entry("你好"),
                [distractor("你", 3), distractor("拟", 3, true)],
                scriptedRng([0, 0, 0.9])
            );
            expect(round).not.toBeNull();
            expect(round!.options.find((o) => !o.isCorrect)!.chars[0]).toBe("拟");
        });
    });

    it("can swap any position of a multi-character word", () => {
        // First rng draw picks swapIndex; 0.6 * 2 = 1 → the second character.
        const round = buildRound(entry("你好"), [distractor("妤")], scriptedRng([0.6, 0, 0.9]));
        expect(round!.swapIndex).toBe(1);
        expect(round!.options.find((o) => !o.isCorrect)!.chars.join("")).toBe("你妤");
    });
});

/**
 * The FINALE rounds (docs/SPEED_READING_GAME.md § The last two rounds are
 * sentences). Same invariant as a word round — two options differing in exactly
 * one position — but the sequence is a whole sentence and the differing position
 * must land INSIDE the target headword, so the round still tests the card's word.
 */
function sentenceEntry(
    entryKey: string,
    sentences: Array<{ foreignText: string; english: string }>,
    id = 1
): VocabEntry {
    return { id, entryKey, pronunciation: "mai3", exampleSentences: sentences } as unknown as VocabEntry;
}

const BUY = { foreignText: "我今天去买书。", english: "I am going to buy books today." };

describe("usableSentences / hasSentenceRound", () => {
    it("keeps only sentences that literally contain the headword", () => {
        const e = sentenceEntry("买书", [BUY, { foreignText: "他很高。", english: "He is tall." }]);
        expect(usableSentences(e).map((s) => s.foreignText)).toEqual([BUY.foreignText]);
        expect(hasSentenceRound(e)).toBe(true);
    });

    it("rejects an entry with no example sentences at all", () => {
        expect(hasSentenceRound(sentenceEntry("买书", []))).toBe(false);
        expect(hasSentenceRound(entry("买书"))).toBe(false);
    });

    it("rejects an entry whose sentences never contain the headword", () => {
        const e = sentenceEntry("买书", [{ foreignText: "他很高。", english: "He is tall." }]);
        expect(hasSentenceRound(e)).toBe(false);
    });
});

describe("buildSentenceRound", () => {
    it("returns null when no sentence contains the headword", () => {
        const e = sentenceEntry("买书", [{ foreignText: "他很高。", english: "He is tall." }]);
        expect(buildSentenceRound(e, [distractor("卖")])).toBeNull();
    });

    it("returns null when the distractor pool is empty", () => {
        expect(buildSentenceRound(sentenceEntry("买书", [BUY]), [])).toBeNull();
    });

    it("produces two same-length sentences differing in exactly one position", () => {
        const round = buildSentenceRound(
            sentenceEntry("买书", [BUY]),
            [distractor("卖")],
            scriptedRng([0, 0, 0, 0.9])
        );
        expect(round).not.toBeNull();
        const [a, b] = round!.options;
        expect(a.chars).toHaveLength(b.chars.length);
        expect(a.chars.filter((ch, i) => ch !== b.chars[i])).toHaveLength(1);
    });

    it("keeps the whole correct sentence as the correct option, punctuation included", () => {
        const round = buildSentenceRound(
            sentenceEntry("买书", [BUY]),
            [distractor("卖")],
            scriptedRng([0, 0, 0, 0.9])
        );
        const correct = round!.options.filter((o) => o.isCorrect);
        expect(correct).toHaveLength(1);
        expect(correct[0].chars.join("")).toBe(BUY.foreignText);
    });

    it("swaps a character INSIDE the headword, not elsewhere in the sentence", () => {
        // 买书 starts at index 4 of 我今天去买书。 — the two eligible positions are
        // 4 (买) and 5 (书), and nothing else.
        for (const offsetDraw of [0, 0.9]) {
            const round = buildSentenceRound(
                sentenceEntry("买书", [BUY]),
                [distractor("卖")],
                scriptedRng([0, offsetDraw, 0, 0.9])
            );
            expect([4, 5]).toContain(round!.swapIndex);
        }
    });

    it("carries the sentence it was built from, for the prompt and narration", () => {
        const round = buildSentenceRound(
            sentenceEntry("买书", [BUY]),
            [distractor("卖")],
            scriptedRng([0, 0, 0, 0.9])
        );
        expect(round!.kind).toBe("sentence");
        expect(round!.sentence.english).toBe(BUY.english);
    });

    it("never uses a character of the headword as the distractor", () => {
        // Both 买 and 书 are in the word, so only 卖 survives the exclusion.
        const round = buildSentenceRound(
            sentenceEntry("买书", [BUY]),
            [distractor("买"), distractor("书"), distractor("卖")],
            scriptedRng([0, 0, 0, 0.9])
        );
        const wrong = round!.options.find((o) => !o.isCorrect)!;
        expect(wrong.chars[round!.swapIndex]).toBe("卖");
    });
});
