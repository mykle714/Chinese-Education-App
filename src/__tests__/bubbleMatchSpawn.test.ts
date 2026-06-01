import { describe, it, expect } from "vitest";
import {
    chooseKind,
    chooseWantWithMatch,
    selectNextBubble,
    type Rng,
} from "../games/bubble-match/spawnSelection";
import type { BubbleBody, BubbleKind } from "../games/bubble-match/types";

// Minimal BubbleBody factory — selection only reads id, pairId, kind.
let seq = 0;
function body(pairId: string, kind: BubbleKind): BubbleBody {
    return {
        id: `b${seq++}`,
        pairId,
        kind,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        entry: { id: Number(pairId), entryKey: pairId, createdAt: "" } as any,
        x: 0, y: 0, vx: 0, vy: 0, radius: 40, mass: 1, scale: 1, targetScale: 1,
        targetX: null, targetY: null,
        status: "idle",
    };
}

// Deterministic rng returning a fixed sequence (then 0 once exhausted).
function seqRng(values: number[]): Rng {
    let i = 0;
    return () => (i < values.length ? values[i++] : 0);
}

describe("chooseKind", () => {
    it("flips a fair coin on an empty screen", () => {
        expect(chooseKind([], seqRng([0.49]))).toBe("word");
        expect(chooseKind([], seqRng([0.5]))).toBe("definition");
    });

    it("uses the inverted ratio: 3 English + 1 Chinese → 75% Chinese", () => {
        // english/total = 3/4 = 0.75 → rng < 0.75 picks "word" (Chinese).
        const screen = [
            body("1", "definition"),
            body("2", "definition"),
            body("3", "definition"),
            body("4", "word"),
        ];
        expect(chooseKind(screen, seqRng([0.74]))).toBe("word");
        expect(chooseKind(screen, seqRng([0.76]))).toBe("definition");
    });
});

describe("chooseWantWithMatch", () => {
    it("flips a fair coin on an empty screen", () => {
        expect(chooseWantWithMatch([], seqRng([0.4]))).toBe(true);
        expect(chooseWantWithMatch([], seqRng([0.6]))).toBe(false);
    });

    it("inverts the match ratio: 80% matched on screen → 80% spawn unmatched", () => {
        // 4 pairs fully present (8 bubbles, all "with match") + 2 lone bubbles
        // (without match) = 10 total; withMatch=8, withoutMatch=2.
        // P(want WITH match) = withoutMatch/total = 2/10 = 0.2.
        const screen = [
            body("1", "word"), body("1", "definition"),
            body("2", "word"), body("2", "definition"),
            body("3", "word"), body("3", "definition"),
            body("4", "word"), body("4", "definition"),
            body("5", "word"),   // lone
            body("6", "definition"), // lone
        ];
        expect(chooseWantWithMatch(screen, seqRng([0.19]))).toBe(true);  // < 0.2 → want with match
        expect(chooseWantWithMatch(screen, seqRng([0.21]))).toBe(false); // ≥ 0.2 → want without
    });
});

describe("selectNextBubble", () => {
    it("returns null on an empty queue", () => {
        expect(selectNextBubble([], [])).toBeNull();
    });

    it("honors both filters when a candidate exists", () => {
        // Screen: four lone "word" bubbles (above the near-empty threshold, so
        // the match constraint is OFF and a WITH-match spawn is allowed). So:
        //   chooseKind: english=0,total=4 → P(word)=0 → any rng picks "definition".
        //   chooseWantWithMatch: withMatch=0,total=4 → P(withMatch)=withoutMatch/total=1 → always want WITH match.
        // We want a "definition" whose partner (pairId) is on screen → pair 1's definition.
        const screen = [
            body("1", "word"), body("2", "word"),
            body("3", "word"), body("4", "word"),
        ];
        const queue = [
            body("1", "definition"), // definition + partner on screen ✓
            body("5", "definition"), // definition but no partner on screen ✗
            body("5", "word"),
        ];
        // rng calls: [chooseKind, chooseWantWithMatch, candidate index].
        const chosen = selectNextBubble(queue, screen, seqRng([0.9, 0.0, 0.0]));
        expect(chosen?.pairId).toBe("1");
        expect(chosen?.kind).toBe("definition");
    });

    it("never spawns a matching bubble when ≤3 bubbles are on screen", () => {
        // 3 lone bubbles on screen (at the threshold). Queue contains partners
        // for two of them (would match) plus one unrelated bubble. The matching
        // partners must be excluded, leaving only the unrelated bubble.
        const screen = [body("1", "word"), body("2", "word"), body("3", "word")];
        const queue = [
            body("1", "definition"), // matches pair 1 on screen ✗
            body("2", "definition"), // matches pair 2 on screen ✗
            body("9", "definition"), // no partner on screen ✓
        ];
        // Run many random draws; none may return a pairId already on screen.
        for (let i = 0; i < 50; i++) {
            const chosen = selectNextBubble(queue, screen, Math.random);
            expect(chosen?.pairId).toBe("9");
        }
    });

    it("ignores the near-empty constraint above the threshold (4+ on screen)", () => {
        // 4 bubbles on screen → constraint off; a matching spawn is allowed.
        const screen = [
            body("1", "word"), body("2", "word"),
            body("3", "word"), body("4", "word"),
        ];
        const queue = [body("1", "definition")]; // matches pair 1
        const chosen = selectNextBubble(queue, screen, seqRng([0.9, 0.0, 0.0]));
        expect(chosen?.pairId).toBe("1");
    });

    it("relaxes the near-empty constraint when every queued bubble would match", () => {
        // ≤3 on screen but the only queued bubble matches → must still spawn it.
        const screen = [body("1", "word")];
        const queue = [body("1", "definition")];
        const chosen = selectNextBubble(queue, screen, Math.random);
        expect(chosen?.pairId).toBe("1");
    });

    it("falls back to a uniform pick when no candidate matches the filters", () => {
        // Screen forces want = definition WITH partner on screen, but the queue
        // has no definition whose partner is present → fall back to whole queue.
        const screen = [body("9", "word")]; // pair 9 partner not in queue
        const queue = [body("1", "word"), body("2", "word")];
        // After filters yield nothing, candidates = full queue; index = rng*2.
        const chosen = selectNextBubble(queue, screen, seqRng([0.9, 0.0, 0.5]));
        expect(["1", "2"]).toContain(chosen?.pairId);
    });
});
