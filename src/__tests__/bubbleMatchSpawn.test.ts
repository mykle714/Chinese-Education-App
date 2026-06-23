import { describe, it, expect } from "vitest";
import {
    chooseKind,
    chooseWantWithMatch,
    selectNextBubble,
    type Rng,
} from "../games/bubble-match/spawnSelection";
import { planSpawn } from "../games/bubble-match/physics";
import { SPAWN_OVERLAP_FRACTION } from "../games/bubble-match/constants";
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
        x: 0, y: 0, radius: 40, targetRadius: 40, mass: 1600, scale: 1, targetScale: 1,
        status: "idle",
    };
}

// Deterministic rng returning a fixed sequence (then 0 once exhausted).
function seqRng(values: number[]): Rng {
    let i = 0;
    return () => (i < values.length ? values[i++] : 0);
}

// Helper: place a bubble at (x, y) with a given radius for planSpawn tests.
function at(x: number, y: number, radius: number): BubbleBody {
    const b = body("0", "word");
    b.x = x;
    b.y = y;
    b.radius = radius;
    b.targetRadius = radius;
    return b;
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

    it("always spawns a matching bubble when ≥7 bubbles are on screen", () => {
        // 7 lone bubbles on screen (at the near-full threshold). The queue holds
        // one partner for an on-screen bubble plus several with no partner present.
        // The near-full constraint must restrict the pool to the matchable one.
        const screen = [
            body("1", "word"), body("2", "word"), body("3", "word"),
            body("4", "word"), body("5", "word"), body("6", "word"),
            body("7", "word"),
        ];
        const queue = [
            body("1", "definition"), // matches pair 1 on screen ✓ (the relief valve)
            body("8", "definition"), // no partner on screen ✗
            body("9", "definition"), // no partner on screen ✗
        ];
        for (let i = 0; i < 50; i++) {
            const chosen = selectNextBubble(queue, screen, Math.random);
            expect(chosen?.pairId).toBe("1");
        }
    });

    it("ignores the near-full constraint below the threshold (6 on screen)", () => {
        // 6 lone bubbles → near-full constraint off; an unmatchable spawn is allowed.
        const screen = [
            body("1", "word"), body("2", "word"), body("3", "word"),
            body("4", "word"), body("5", "word"), body("6", "word"),
        ];
        // Force want = definition WITHOUT partner on screen (chooseWantWithMatch
        // returns false here since withMatch=0 → P(want with)=0), so the unmatched
        // pair-9 definition is eligible — it would be forbidden once at 7.
        const queue = [body("9", "definition")];
        const chosen = selectNextBubble(queue, screen, seqRng([0.9, 0.9, 0.0]));
        expect(chosen?.pairId).toBe("9");
    });

    it("relaxes the near-full constraint when no queued bubble would match", () => {
        // ≥7 on screen but nothing in the queue matches → must still spawn something.
        const screen = [
            body("1", "word"), body("2", "word"), body("3", "word"),
            body("4", "word"), body("5", "word"), body("6", "word"),
            body("7", "word"),
        ];
        const queue = [body("8", "word"), body("9", "definition")];
        const chosen = selectNextBubble(queue, screen, Math.random);
        expect(["8", "9"]).toContain(chosen?.pairId);
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

describe("planSpawn", () => {
    const bounds = { width: 1000, top: 0, height: 1000 };

    it("places anywhere on an empty board", () => {
        // rng picks center (0.5, 0.5) of the inset rect.
        const { x, y } = planSpawn(40, bounds, [], seqRng([0.5, 0.5]));
        expect(x).toBeGreaterThanOrEqual(40);
        expect(x).toBeLessThanOrEqual(bounds.width - 40);
        expect(y).toBeGreaterThanOrEqual(40);
        expect(y).toBeLessThanOrEqual(bounds.height - 40);
    });

    it("rejects a spot that breaks the 20% rule, accepting the next clear one", () => {
        // One existing bubble of radius 50 dead center (500, 500). The first
        // candidate lands right on top of it (breaks the rule); the second lands
        // far away (clears it).
        const existing = at(500, 500, 50);
        const targetR = 40;
        // rng sequence: candidate 1 = (500,500) on top → rejected; candidate 2 =
        // (100,100) far away → accepted.
        const rng = seqRng([0.46, 0.46, 0.06, 0.06]);
        const spot = planSpawn(targetR, bounds, [existing], rng);
        // The accepted spot must satisfy the rule against the existing bubble.
        const dist = Math.hypot(spot.x - existing.x, spot.y - existing.y);
        const penetration = targetR + existing.radius - dist;
        const ratio = penetration <= 0 ? 0 : penetration / (2 * existing.radius);
        expect(ratio).toBeLessThanOrEqual(SPAWN_OVERLAP_FRACTION);
    });

    it("falls back to the least-bad spot when the board is too full to clear the rule", () => {
        // A wall of overlapping bubbles fills the whole inset rect, so no candidate
        // can ever clear the 20% rule. planSpawn must still return a spot (so the
        // board can over-pack and trip the overfill loss) rather than nothing.
        const wall: BubbleBody[] = [];
        for (let gx = 0; gx <= 1000; gx += 40) {
            for (let gy = 0; gy <= 1000; gy += 40) wall.push(at(gx, gy, 60));
        }
        const spot = planSpawn(40, bounds, wall, Math.random);
        expect(spot).toBeDefined();
        expect(Number.isFinite(spot.x)).toBe(true);
        expect(Number.isFinite(spot.y)).toBe(true);
    });
});
