import { describe, expect, it } from "vitest";
import { releaseVelocityOf, snapTargetOf } from "../towerScroll";

// The snap zone's rule (towerScroll.ts → snapTargetOf; docs/DECK_TOWER.md § The cards page,
// "The snap zone"): a zone from the platform line (1000) to the cards line (1800), 800px.
// Heading down commits to the cards past 1200; heading up commits to the platform above 1600.
const PLATFORM = 1000;
const CARDS = 1800;

describe("snapTargetOf", () => {
    it("heading down: springs back short of a quarter, goes on to the cards past it", () => {
        expect(snapTargetOf(1150, PLATFORM, CARDS, 1)).toBe(PLATFORM);
        expect(snapTargetOf(1250, PLATFORM, CARDS, 1)).toBe(CARDS);
    });
    it("heading up: springs back short of a quarter, goes on to the platform past it", () => {
        expect(snapTargetOf(1650, PLATFORM, CARDS, -1)).toBe(CARDS);
        expect(snapTargetOf(1550, PLATFORM, CARDS, -1)).toBe(PLATFORM);
    });
    it("the same resting point snaps by direction", () => {
        // 1300 is under halfway, but a downward scroll has committed to the cards…
        expect(snapTargetOf(1300, PLATFORM, CARDS, 1)).toBe(CARDS);
        // …and an upward one to the platform.
        expect(snapTargetOf(1300, PLATFORM, CARDS, -1)).toBe(PLATFORM);
    });
    it("no direction known: the halfway point", () => {
        expect(snapTargetOf(1390, PLATFORM, CARDS, 0)).toBe(PLATFORM);
        expect(snapTargetOf(1410, PLATFORM, CARDS, 0)).toBe(CARDS);
    });
});

// A finger's release velocity (towerScroll.ts → releaseVelocityOf): read over its last 80ms.
describe("releaseVelocityOf", () => {
    it("reads the travel over the last stretch of the drag, px/ms", () => {
        const samples = [
            { t: 0, top: 0 }, // older than the window: ignored
            { t: 920, top: 100 },
            { t: 960, top: 140 },
            { t: 1000, top: 180 },
        ];
        expect(releaseVelocityOf(samples, 1000)).toBe(1);
    });
    it("is negative heading up", () => {
        expect(releaseVelocityOf([{ t: 950, top: 500 }, { t: 1000, top: 400 }], 1000)).toBe(-2);
    });
    it("is 0 when the finger held still before lifting", () => {
        expect(releaseVelocityOf([{ t: 100, top: 0 }, { t: 200, top: 300 }], 1000)).toBe(0);
    });
    it("is 0 with fewer than two recent samples", () => {
        expect(releaseVelocityOf([], 1000)).toBe(0);
        expect(releaseVelocityOf([{ t: 990, top: 10 }], 1000)).toBe(0);
    });
});
