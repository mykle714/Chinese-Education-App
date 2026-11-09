import { describe, expect, it } from "vitest";
import {
    FLINCH_MS,
    flinchPose,
    IDLE_EXIT_MS,
    idlePose,
    LASTING_IDLES,
    SING_MS,
    SNEEZE_MS,
    SNEEZE_SNAP_MS,
} from "../features/deckTower/iso/pawnIdles";
import { HINT_PAWN_IDLES, pickHintPawnIdle } from "../features/flashcards/FlashcardsLearnPage/hintPawn/useHintPawnIdles";
import { OUCH_LINES } from "../features/flashcards/FlashcardsLearnPage/hintPawn/pawnHintLines";

// docs/HINT_PAWN.md § "Idle animations" / § "Tap reactions"; docs/ISO_ART_FRAMEWORK.md
// § IsoPawn → "Idles and the flinch".
describe("pawn idle poses", () => {
    it("start and finish at rest", () => {
        for (const kind of ["sneeze", "sing", "doze", "knit"] as const) {
            const p = idlePose(kind, 0);
            expect(Math.abs(p.arch) + Math.abs(p.reach) + Math.abs(p.squash)).toBeLessThan(1e-9);
        }
        expect(idlePose("sneeze", SNEEZE_MS).done).toBe(true);
        expect(idlePose("sing", SING_MS).done).toBe(true);
    });

    it("sneeze winds up backward, then snaps forward", () => {
        expect(idlePose("sneeze", SNEEZE_SNAP_MS - 1).arch).toBeLessThan(0);
        expect(idlePose("sneeze", SNEEZE_SNAP_MS + 100).arch).toBeGreaterThan(0);
    });

    it("lasting idles hold until withdrawn, then ease out", () => {
        for (const kind of LASTING_IDLES) {
            expect(idlePose(kind, 10 * 60_000).done).toBe(false);
            const holding = idlePose(kind, 5000);
            const halfOut = idlePose(kind, 5000, IDLE_EXIT_MS / 2);
            expect(Math.abs(halfOut.arch)).toBeLessThan(Math.abs(holding.arch));
            expect(idlePose(kind, 5000, IDLE_EXIT_MS).done).toBe(true);
        }
    });

    it("the flinch recoils and settles", () => {
        expect(flinchPose(60).squash).toBeGreaterThan(0);
        expect(flinchPose(FLINCH_MS).done).toBe(true);
    });
});

describe("hint pawn idle pick", () => {
    it("draws from the five idles, stretch included", () => {
        expect([...HINT_PAWN_IDLES].sort()).toEqual(["doze", "knit", "sing", "sneeze", "stretch"]);
    });

    it("never repeats the last idle", () => {
        for (const last of HINT_PAWN_IDLES) {
            for (const r of [0, 0.3, 0.6, 0.999]) expect(pickHintPawnIdle(last, () => r)).not.toBe(last);
        }
    });
});

describe("ouch lines", () => {
    it("are short enough to sit on one line", () => {
        expect(OUCH_LINES.length).toBeGreaterThan(1);
        for (const line of OUCH_LINES) expect(line.length).toBeLessThanOrEqual(20);
    });
});
