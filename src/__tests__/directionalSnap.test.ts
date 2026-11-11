import { describe, expect, it } from "vitest";
import { directionalSnapTarget, nextSnapDirection } from "../utils/directionalSnap";

// The shared two-stop rule (src/utils/directionalSnap.ts), as the sheet uses it: the open
// height 600 → max 1000, a 400px gap. towerScroll.test.ts covers td's use of it.
const OPEN = 600;
const MAX = 1000;

describe("directionalSnapTarget", () => {
    it("share 0.25: a quarter-gap push either way commits, less springs back", () => {
        expect(directionalSnapTarget(690, OPEN, MAX, 1, 0.25)).toBe(OPEN); // grew 90 of 400
        expect(directionalSnapTarget(710, OPEN, MAX, 1, 0.25)).toBe(MAX); // grew 110
        expect(directionalSnapTarget(910, OPEN, MAX, -1, 0.25)).toBe(MAX); // shrank 90
        expect(directionalSnapTarget(890, OPEN, MAX, -1, 0.25)).toBe(OPEN); // shrank 110
    });
    it("share 0.5 is nearest-stop whichever way it moved", () => {
        for (const dir of [-1, 0, 1] as const) {
            expect(directionalSnapTarget(790, OPEN, MAX, dir, 0.5)).toBe(OPEN);
            expect(directionalSnapTarget(810, OPEN, MAX, dir, 0.5)).toBe(MAX);
        }
    });
});

describe("nextSnapDirection", () => {
    it("takes the step's sign, ignoring sub-threshold jitter", () => {
        expect(nextSnapDirection(0, 100, 110)).toBe(1);
        expect(nextSnapDirection(0, 110, 100)).toBe(-1);
        expect(nextSnapDirection(1, 100, 99)).toBe(1); // 1px back: jitter, keep heading up
    });
});
