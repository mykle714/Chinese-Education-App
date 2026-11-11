import { describe, it, expect } from "vitest";
import {
    bufferSize,
    bufferedEntryIds,
    emptyBuffer,
    fillBuffer,
    rollCategory,
    takePair,
    takePairs,
    topUpDistribution,
    topUpRequest,
    type CardBuffer,
    type Rng,
} from "../games/match-speed/cardBuffer";
import {
    BUFFER_DEPTH,
    BUFFER_TOTAL_TARGET,
    CATEGORY_WEIGHTS,
    PERSONAL_BEST_MODE,
    POOL_DISTRIBUTION,
    WIN_LEVEL,
    runResultTiers,
    runResultTitle,
} from "../games/match-speed/constants";
import type { GameCategory } from "../games/match-speed/types";
import type { VocabEntry } from "../types";

// Minimal VocabEntry factory — the buffer only reads `id` and `gameCategory`.
function entry(id: number, gameCategory?: GameCategory): VocabEntry {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { id, entryKey: `w${id}`, gameCategory, createdAt: "" } as any;
}

/** Deterministic rng returning a fixed sequence (then 0 once exhausted). */
function seqRng(values: number[]): Rng {
    let i = 0;
    return () => (i < values.length ? values[i++] : 0);
}

/** Build a buffer holding `count` pairs in each named category. */
function bufferWith(counts: Partial<Record<GameCategory, number>>): CardBuffer {
    const buffer = emptyBuffer();
    let id = 1;
    for (const [category, n] of Object.entries(counts)) {
        for (let i = 0; i < (n ?? 0); i++) {
            fillBuffer(buffer, [entry(id++, category as GameCategory)]);
        }
    }
    return buffer;
}

describe("rollCategory", () => {
    // Weights are 12/60/20/8 over a total of 100, walked in key order
    // (Unfamiliar, Target, Comfortable, Mastered) — so the cumulative bands are
    // [0,.12) [.12,.72) [.72,.92) [.92,1).
    it("maps each weight band to its category", () => {
        expect(rollCategory(seqRng([0]))).toBe("Unfamiliar");
        expect(rollCategory(seqRng([0.119]))).toBe("Unfamiliar");
        expect(rollCategory(seqRng([0.12]))).toBe("Target");
        expect(rollCategory(seqRng([0.71]))).toBe("Target");
        expect(rollCategory(seqRng([0.72]))).toBe("Comfortable");
        expect(rollCategory(seqRng([0.91]))).toBe("Comfortable");
        expect(rollCategory(seqRng([0.92]))).toBe("Mastered");
        expect(rollCategory(seqRng([0.999]))).toBe("Mastered");
    });

    it("never falls off the end at the top of the range", () => {
        // Guards the floating-point drift path at ticket === totalWeight.
        expect(rollCategory(() => 1)).toBe("Mastered");
    });

    it("converges on the declared weights over many rolls", () => {
        const counts: Record<string, number> = {};
        // Deterministic sweep across the whole [0,1) range, so no real randomness.
        const N = 10_000;
        for (let i = 0; i < N; i++) {
            const cat = rollCategory(() => i / N);
            counts[cat] = (counts[cat] ?? 0) + 1;
        }
        for (const [cat, weight] of Object.entries(CATEGORY_WEIGHTS)) {
            expect(Math.round((counts[cat] / N) * 100)).toBe(weight);
        }
    });
});

describe("takePair", () => {
    it("draws from the rolled category when it has stock", () => {
        const buffer = bufferWith({ Unfamiliar: 1, Target: 1 });
        // 0 → Unfamiliar band.
        expect(takePair(buffer, seqRng([0]))?.category).toBe("Unfamiliar");
        expect(buffer.Unfamiliar).toHaveLength(0);
        expect(buffer.Target).toHaveLength(1);
    });

    it("walks the fallback order when the rolled category is empty", () => {
        // Roll Unfamiliar (empty) → fallback order is Target first.
        const buffer = bufferWith({ Target: 1, Comfortable: 1 });
        expect(takePair(buffer, seqRng([0]))?.category).toBe("Target");
    });

    it("continues down the fallback order past several empty buckets", () => {
        // Roll Unfamiliar (empty); Target and Comfortable empty too → Mastered.
        const buffer = bufferWith({ Mastered: 1 });
        expect(takePair(buffer, seqRng([0]))?.category).toBe("Mastered");
    });

    it("returns null only when the whole buffer is empty", () => {
        expect(takePair(emptyBuffer(), seqRng([0.5]))).toBeNull();
    });

    it("does NOT re-normalize weights — the roll ignores what is in stock", () => {
        // Only Mastered has stock, but a .5 ticket still ROLLS Target; the card
        // just arrives via fallback. The distinction matters: the returned pair is
        // labeled with the bucket it actually came from, never the rolled one.
        const buffer = bufferWith({ Mastered: 1 });
        expect(takePair(buffer, seqRng([0.5]))?.category).toBe("Mastered");
    });
});

describe("takePairs", () => {
    it("short-returns rather than throwing when the buffer runs dry", () => {
        const buffer = bufferWith({ Target: 2 });
        const drawn = takePairs(buffer, 4, seqRng([0.5, 0.5, 0.5, 0.5]));
        expect(drawn).toHaveLength(2);
        expect(bufferSize(buffer)).toBe(0);
    });

    it("never hands back the same pair twice", () => {
        const buffer = bufferWith({ Unfamiliar: 2, Target: 2, Comfortable: 2, Mastered: 2 });
        const drawn = takePairs(buffer, 8, seqRng([0, 0.2, 0.5, 0.8, 0.95, 0.1, 0.3, 0.99]));
        const ids = drawn.map((p) => p.entry.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    // ---- Duplicate gate ---------------------------------------------------
    // Two cards for one entry share a pairId, so all four would match each
    // other. See docs/MATCH_SPEED_GAME.md § The duplicate gate.
    it("skips a pair whose entry the caller reports as already on the board", () => {
        const buffer = emptyBuffer();
        // Hand-file a duplicate of entry 1 past fillBuffer's own dedupe, to
        // simulate the case fillBuffer cannot see: entry 1 is on the BOARD.
        buffer.Target.push(
            { pairId: "pair-1", entry: entry(1, "Target"), category: "Target" },
            { pairId: "pair-2", entry: entry(2, "Target"), category: "Target" }
        );
        const onBoard = new Set([1]);
        const drawn = takePairs(buffer, 2, seqRng([0.5, 0.5]), (p) =>
            onBoard.has(p.entry.id)
        );
        expect(drawn.map((p) => p.entry.id)).toEqual([2]);
    });

    it("discards a blocked pair rather than re-queuing it (no infinite loop)", () => {
        const buffer = emptyBuffer();
        buffer.Target.push({ pairId: "pair-1", entry: entry(1, "Target"), category: "Target" });
        const drawn = takePairs(buffer, 3, seqRng([0.5, 0.5, 0.5]), () => true);
        expect(drawn).toHaveLength(0);
        // Consumed, not put back — so the next topUpRequest asks for a replacement.
        expect(bufferSize(buffer)).toBe(0);
    });

    it("gates duplicates WITHIN one batch, which no external set can know about yet", () => {
        const buffer = emptyBuffer();
        buffer.Target.push(
            { pairId: "pair-7", entry: entry(7, "Target"), category: "Target" },
            { pairId: "pair-7", entry: entry(7, "Target"), category: "Target" },
            { pairId: "pair-8", entry: entry(8, "Target"), category: "Target" }
        );
        const drawn = takePairs(buffer, 3, seqRng([0.5, 0.5, 0.5]));
        expect(drawn.map((p) => p.entry.id)).toEqual([7, 8]);
    });
});

describe("fillBuffer", () => {
    it("files cards by their server gameCategory stamp", () => {
        const buffer = emptyBuffer();
        fillBuffer(buffer, [entry(1, "Mastered"), entry(2, "Unfamiliar")]);
        expect(buffer.Mastered.map((p) => p.entry.id)).toEqual([1]);
        expect(buffer.Unfamiliar.map((p) => p.entry.id)).toEqual([2]);
    });

    it("files an unstamped card under Target instead of dropping it", () => {
        // A playable card must never be silently discarded — that would starve the
        // board on exactly the payloads we understand least (e.g. pre-stamp ones).
        const buffer = emptyBuffer();
        fillBuffer(buffer, [entry(1, undefined)]);
        expect(buffer.Target.map((p) => p.entry.id)).toEqual([1]);
    });

    it("drops an entry already shelved, and a repeat inside one response", () => {
        // One response can legitimately repeat a card: the server tops a short
        // bucket up from its own fallback order.
        const buffer = emptyBuffer();
        fillBuffer(buffer, [entry(1, "Target")]);
        fillBuffer(buffer, [entry(1, "Target"), entry(2, "Target"), entry(2, "Comfortable")]);
        expect(buffer.Target.map((p) => p.entry.id)).toEqual([1, 2]);
        expect(buffer.Comfortable).toHaveLength(0);
    });

    it("dedupes across buckets, not just within one", () => {
        const buffer = emptyBuffer();
        fillBuffer(buffer, [entry(5, "Mastered"), entry(5, "Unfamiliar")]);
        expect(bufferedEntryIds(buffer)).toEqual([5]);
    });

    it("derives pairId from the entry id so a pair is identifiable", () => {
        const buffer = emptyBuffer();
        fillBuffer(buffer, [entry(42, "Target")]);
        expect(buffer.Target[0].pairId).toBe("pair-42");
    });
});

describe("topUpRequest / topUpDistribution", () => {
    it("asks for exactly what each bucket is missing", () => {
        const buffer = bufferWith({ Target: BUFFER_DEPTH, Comfortable: 2 });
        const request = topUpRequest(buffer)!;
        expect(request.Target).toBe(0);
        expect(request.Comfortable).toBe(BUFFER_DEPTH - 2);
        expect(request.Unfamiliar).toBe(BUFFER_DEPTH);
    });

    it("returns null when every bucket is already full, so the caller can skip the round trip", () => {
        const full = bufferWith({
            Unfamiliar: BUFFER_DEPTH,
            Target: BUFFER_DEPTH,
            Comfortable: BUFFER_DEPTH,
            Mastered: BUFFER_DEPTH,
        });
        expect(topUpRequest(full)).toBeNull();
    });

    it("omits zero-need buckets from the query", () => {
        const buffer = bufferWith({ Target: BUFFER_DEPTH, Comfortable: BUFFER_DEPTH, Mastered: BUFFER_DEPTH });
        expect(topUpDistribution(topUpRequest(buffer)!)).toEqual({ Unfamiliar: BUFFER_DEPTH });
    });
});

describe("bufferedEntryIds", () => {
    it("reports every buffered id across all buckets (the exclude list's other half)", () => {
        const buffer = bufferWith({ Unfamiliar: 1, Target: 2 });
        expect(bufferedEntryIds(buffer).sort((a, b) => a - b)).toEqual([1, 2, 3]);
    });
});

describe("runResultTiers", () => {
    it("grades a finished run on speed and accuracy", () => {
        expect(runResultTiers(30, 30, 75_000)).toEqual({
            speed: { tier: 1, elapsedMs: 75_000 },
            accuracy: { tier: 1, correct: 30, attempts: 30 },
        });
        expect(runResultTiers(30, 40, 100_001)).toEqual({
            speed: { tier: 3, elapsedMs: 100_001 },
            accuracy: { tier: 5, correct: 30, attempts: 40 },
        });
    });

    it("always lands a finished run on a tier, however slow", () => {
        expect(runResultTiers(30, 30, 3_600_000)?.speed.tier).toBe(7);
    });

    it("gives an unfinished run no tiers", () => {
        expect(runResultTiers(12, 14, 40_000)).toBeNull();
        expect(runResultTitle(12)).toBe("Run ended");
        expect(runResultTitle(30)).toBe("Finished!");
    });
});

// ---------------------------------------------------------------------------
// The single (Study Mix) config. Review/Challenge were removed
// (docs/DEFERRED_WORK.md § 31); the keys below are what existing wins and personal
// bests were recorded under, so changing one orphans that history.
// ---------------------------------------------------------------------------

describe("Study Mix config", () => {
    it("keeps `wins` level 1 and the `mixed` personal-best key", () => {
        expect(WIN_LEVEL).toBe(1);
        expect(PERSONAL_BEST_MODE).toBe("mixed");
    });

    it("asks the pool for BUFFER_DEPTH of every bucket, BUFFER_TOTAL_TARGET in all", () => {
        expect(POOL_DISTRIBUTION).toEqual({
            Unfamiliar: BUFFER_DEPTH,
            Target: BUFFER_DEPTH,
            Comfortable: BUFFER_DEPTH,
            Mastered: BUFFER_DEPTH,
        });
        expect(Object.values(POOL_DISTRIBUTION).reduce((a, b) => a + b, 0)).toBe(BUFFER_TOTAL_TARGET);
    });
});
