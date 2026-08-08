import { describe, it, expect } from "vitest";
import {
    bufferSize,
    bufferedEntryIds,
    emptyBuffer,
    fillBuffer,
    rollCategory,
    takePair,
    takePairs,
    topUpQuery,
    topUpRequest,
    type CardBuffer,
    type Rng,
} from "../games/match-speed/cardBuffer";
import {
    BUFFER_DEPTH,
    BUFFER_TOTAL_TARGET,
    CATEGORY_WEIGHTS,
    MODE_CONFIGS,
    medalForScore,
    modeConfigFor,
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
        const drawn = takePairs(buffer, 2, seqRng([0.5, 0.5]), undefined, (p) =>
            onBoard.has(p.entry.id)
        );
        expect(drawn.map((p) => p.entry.id)).toEqual([2]);
    });

    it("discards a blocked pair rather than re-queuing it (no infinite loop)", () => {
        const buffer = emptyBuffer();
        buffer.Target.push({ pairId: "pair-1", entry: entry(1, "Target"), category: "Target" });
        const drawn = takePairs(buffer, 3, seqRng([0.5, 0.5, 0.5]), undefined, () => true);
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

describe("topUpRequest / topUpQuery", () => {
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
        expect(topUpQuery(topUpRequest(buffer)!)).toBe(`Unfamiliar=${BUFFER_DEPTH}`);
    });
});

describe("bufferedEntryIds", () => {
    it("reports every buffered id across all buckets (the exclude list's other half)", () => {
        const buffer = bufferWith({ Unfamiliar: 1, Target: 2 });
        expect(bufferedEntryIds(buffer).sort((a, b) => a - b)).toEqual([1, 2, 3]);
    });
});

describe("medalForScore", () => {
    // Thresholds are stated against the 30-second run clock (9 / 6 / 3).
    it("awards by threshold, best-first", () => {
        expect(medalForScore(30)?.medal).toBe("gold");
        expect(medalForScore(9)?.medal).toBe("gold");
        expect(medalForScore(8)?.medal).toBe("silver");
        expect(medalForScore(6)?.medal).toBe("silver");
        expect(medalForScore(5)?.medal).toBe("bronze");
        expect(medalForScore(3)?.medal).toBe("bronze");
    });

    it("has a REAL no-medal tier, unlike Word Search's always-bronze floor", () => {
        expect(medalForScore(2)).toBeNull();
        expect(medalForScore(0)).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Difficulty modes (Study Mix / Review / Challenge). Every buffer function takes the run's
// ModeConfig as a trailing argument; the cases above cover the Study Mix default, so
// these cover the RESTRICTED modes — whose whole contract is that an off-mode
// bucket is never rolled, never fallen back to, and never even shelved.
// See docs/MATCH_SPEED_GAME.md § Difficulty modes.
// ---------------------------------------------------------------------------

const MIXED = modeConfigFor("mixed");
const REVIEW = modeConfigFor("review");
const CHALLENGE = modeConfigFor("challenge");

describe("MODE_CONFIGS", () => {
    it("lists the modes in hub order: Study Mix, Review, Challenge", () => {
        expect(MODE_CONFIGS.map((cfg) => cfg.mode)).toEqual(["mixed", "review", "challenge"]);
    });

    it("restricts each mode to the /decks buckets", () => {
        expect(MIXED.categories).toEqual(["Unfamiliar", "Target", "Comfortable", "Mastered"]);
        expect(REVIEW.categories).toEqual(["Comfortable", "Mastered"]);
        expect(CHALLENGE.categories).toEqual(["Unfamiliar", "Target"]);
    });

    it("keeps Study Mix on `wins` level 1 so pre-modes win history stays attached to it", () => {
        expect(MIXED.winLevel).toBe(1);
        expect(new Set(MODE_CONFIGS.map((cfg) => cfg.winLevel)).size).toBe(MODE_CONFIGS.length);
    });

    it("splits the same total buffer depth over however many buckets a mode uses", () => {
        expect(MIXED.bufferDepth).toBe(BUFFER_DEPTH);
        expect(REVIEW.bufferDepth * REVIEW.categories.length).toBe(BUFFER_TOTAL_TARGET);
        expect(CHALLENGE.bufferDepth * CHALLENGE.categories.length).toBe(BUFFER_TOTAL_TARGET);
    });

    it("asks the pool endpoint only for its own buckets", () => {
        expect(REVIEW.poolQuery).toBe(`Comfortable=${REVIEW.bufferDepth}&Mastered=${REVIEW.bufferDepth}`);
        expect(CHALLENGE.poolQuery).toBe(`Unfamiliar=${CHALLENGE.bufferDepth}&Target=${CHALLENGE.bufferDepth}`);
    });

    it("falls back to Study Mix for a missing or unrecognized nav-state value", () => {
        expect(modeConfigFor(undefined)).toBe(MIXED);
        expect(modeConfigFor("nonsense")).toBe(MIXED);
    });
});

describe("rollCategory (restricted modes)", () => {
    it("only ever rolls in-mode buckets, across the whole [0,1) range", () => {
        for (const mode of [REVIEW, CHALLENGE]) {
            for (let i = 0; i <= 100; i++) {
                expect(mode.categories).toContain(rollCategory(() => i / 100, mode));
            }
        }
    });

    it("splits Review 70/30 across its own weight bands", () => {
        // Bands walk `categories` in order: Comfortable [0,.7), Mastered [.7,1).
        expect(rollCategory(seqRng([0.69]), REVIEW)).toBe("Comfortable");
        expect(rollCategory(seqRng([0.7]), REVIEW)).toBe("Mastered");
    });

    it("splits Challenge 20/80 across its own weight bands", () => {
        expect(rollCategory(seqRng([0.19]), CHALLENGE)).toBe("Unfamiliar");
        expect(rollCategory(seqRng([0.2]), CHALLENGE)).toBe("Target");
    });
});

describe("takePair (restricted modes)", () => {
    it("never falls back into an off-mode bucket, even when the in-mode ones are bare", () => {
        // A full Challenge-only buffer offered to a Review run: the Study Mix fallback
        // order would happily hand back Target here. Review must draw nothing instead.
        const buffer = bufferWith({ Unfamiliar: 3, Target: 3 });
        expect(takePair(buffer, seqRng([0.5]), REVIEW)).toBeNull();
        expect(bufferSize(buffer)).toBe(6);
    });

    it("walks only the mode's own fallback order", () => {
        // Rolls Comfortable (empty) → Review's order is [Comfortable, Mastered].
        const buffer = bufferWith({ Mastered: 1 });
        expect(takePair(buffer, seqRng([0]), REVIEW)?.category).toBe("Mastered");
    });
});

describe("fillBuffer (restricted modes)", () => {
    it("drops an off-mode card instead of shelving one no roll can draw", () => {
        // The server tops a short bucket up from ITS fallback order, so a Review
        // request really can come back holding an Unfamiliar card.
        const buffer = emptyBuffer();
        fillBuffer(buffer, [entry(1, "Comfortable"), entry(2, "Unfamiliar")], REVIEW);
        expect(buffer.Comfortable.map((p) => p.entry.id)).toEqual([1]);
        expect(buffer.Unfamiliar).toHaveLength(0);
    });

    it("files an unstamped card under the mode's first fallback bucket", () => {
        const buffer = emptyBuffer();
        fillBuffer(buffer, [entry(1, undefined)], REVIEW);
        expect(buffer.Comfortable.map((p) => p.entry.id)).toEqual([1]);
    });
});

describe("topUpRequest (restricted modes)", () => {
    it("requests only in-mode buckets, at the mode's own depth", () => {
        const request = topUpRequest(emptyBuffer(), REVIEW)!;
        expect(request.Comfortable).toBe(REVIEW.bufferDepth);
        expect(request.Mastered).toBe(REVIEW.bufferDepth);
        expect(request.Unfamiliar).toBeUndefined();
        expect(request.Target).toBeUndefined();
        expect(topUpQuery(request)).toBe(
            `Comfortable=${REVIEW.bufferDepth}&Mastered=${REVIEW.bufferDepth}`
        );
    });

    it("ignores off-mode stock when deciding whether a top-up is needed", () => {
        // Full on Challenge's buckets, full on its own → nothing to fetch.
        const buffer = bufferWith({
            Comfortable: REVIEW.bufferDepth,
            Mastered: REVIEW.bufferDepth,
        });
        expect(topUpRequest(buffer, REVIEW)).toBeNull();
    });
});
