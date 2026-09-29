import { describe, it, expect } from "vitest";
import { stepPhysics, type Bounds } from "../games/bubbles/physics";
import { ThrowTracker } from "../games/bubbles/throwTracker";
import { DRIFT_MAX_SPEED, THROW_MAX_SPEED, THROW_STALE_MS } from "../games/bubbles/constants";
import type { BubbleBody } from "../games/bubbles/types";

/**
 * The air-hockey throw (src/games/bubbles/physics.ts → stepPhysics,
 * src/games/bubbles/throwTracker.ts). Docs: docs/GAMES_FEATURE.md.
 */

let seq = 0;
function puck(x: number, y: number, vx: number, vy: number, radius = 50): BubbleBody {
    return {
        id: `t${seq++}`,
        pairId: `p${seq}`,
        kind: "word",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        entry: { id: seq, entryKey: "x", createdAt: "" } as any,
        x, y, vx, vy, radius, targetRadius: radius, mass: radius * radius,
        scale: 1, targetScale: 1, status: "idle",
    };
}

const BOUNDS: Bounds = { width: 400, top: 0, height: 800 };
const FRAME = 1 / 30;

describe("stepPhysics — throw glide", () => {
    it("a fast puck cannot tunnel through a neighbor (substepping)", () => {
        // 1800 px/s covers 60 px per 30 fps frame — more than the target's radius.
        const thrown = puck(60, 400, THROW_MAX_SPEED, 0);
        const target = puck(200, 400, 0, 0);
        for (let i = 0; i < 6; i++) stepPhysics([thrown, target], FRAME, BOUNDS);
        // The thrown puck never ends up past the one it hit, and it handed it momentum.
        expect(thrown.x).toBeLessThan(target.x);
        // Speed, not sign: within 6 frames the struck puck can reach the wall and bounce.
        expect(Math.hypot(target.vx, target.vy)).toBeGreaterThan(DRIFT_MAX_SPEED);
    });

    it("mirrors off a wall instead of sinking into it", () => {
        const b = puck(360, 400, 1500, 0, 40); // 0 px from the right wall edge
        stepPhysics([b], FRAME, BOUNDS);
        expect(b.x + b.radius).toBeLessThanOrEqual(BOUNDS.width);
        expect(b.vx).toBeLessThan(0);
    });

    it("friction brings a throw back into the drift regime", () => {
        const b = puck(200, 400, 1500, 0);
        for (let i = 0; i < 30 * 4; i++) stepPhysics([b], FRAME, BOUNDS); // 4 s
        expect(Math.hypot(b.vx, b.vy)).toBeLessThanOrEqual(DRIFT_MAX_SPEED + 1);
    });
});

describe("ThrowTracker", () => {
    it("measures velocity over the trailing window and caps it", () => {
        const t = new ThrowTracker();
        t.reset(0, 0, 1000);
        t.record(10, 0, 1010);
        t.record(20, 0, 1020);
        expect(t.velocity(1020).vx).toBeCloseTo(1000);
        t.record(500, 0, 1030); // absurd jump → capped
        expect(Math.hypot(t.velocity(1030).vx, t.velocity(1030).vy)).toBeCloseTo(THROW_MAX_SPEED);
    });

    it("a pause before release throws nothing", () => {
        const t = new ThrowTracker();
        t.reset(0, 0, 1000);
        t.record(50, 0, 1020);
        expect(t.velocity(1020 + THROW_STALE_MS + 1)).toEqual({ vx: 0, vy: 0 });
    });

    it("sparse moves still produce a velocity (anchor outside the window)", () => {
        const t = new ThrowTracker();
        t.reset(0, 0, 1000);
        t.record(100, 0, 1100); // one move, 100 ms later — outside the 80 ms window
        expect(t.velocity(1100).vx).toBeCloseTo(1000);
    });
});
