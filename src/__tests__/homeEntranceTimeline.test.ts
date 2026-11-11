/**
 * The home screen's Enter move (src/features/deckTower/home/useHomeEntrance.ts,
 * docs/HOME_SCREEN.md § "Enter"): the descent's speed profile and the shift's frames.
 */
import { describe, it, expect } from 'vitest';
import { descentTimeline, shiftFrameAt } from '../features/deckTower/home/useHomeEntrance';
import { DASH_MOTION } from '../utils/pageTransition';
import { carriedOutPlan } from '../features/deckTower/useWorldPan';

describe('descentTimeline', () => {
    it('starts at 0 and ends exactly on the distance', () => {
        for (const d of [0, 50, 400, 2500, 20000]) {
            const plan = descentTimeline(d);
            expect(plan.at(0)).toBe(0);
            expect(plan.at(plan.durationMs)).toBeCloseTo(d, 6);
            expect(plan.at(plan.durationMs + 500)).toBeCloseTo(d, 6);
        }
    });

    it('never moves backwards and has no speed jump at the seams', () => {
        const plan = descentTimeline(3000);
        const dt = 1;
        let prev = 0;
        let prevSpeed = 0;
        for (let t = dt; t <= plan.durationMs; t += dt) {
            const x = plan.at(t);
            expect(x).toBeGreaterThanOrEqual(prev - 1e-9);
            const speed = x - prev;
            // A per-ms speed change this small means the pieces meet at the same speed.
            expect(Math.abs(speed - prevSpeed)).toBeLessThan(0.05);
            prev = x;
            prevSpeed = speed;
        }
    });

    it('slows down at the end', () => {
        const plan = descentTimeline(3000);
        const mid = plan.at(plan.durationMs / 2 + 1) - plan.at(plan.durationMs / 2);
        const end = plan.at(plan.durationMs) - plan.at(plan.durationMs - 1);
        expect(end).toBeLessThan(mid / 4);
    });

    it('a very tall climb is capped near the max duration by cruising faster', () => {
        expect(descentTimeline(50000).durationMs).toBeLessThanOrEqual(2201);
    });
});

describe('shiftFrameAt', () => {
    const { outMs, cruiseMs, inMs } = DASH_MOTION;
    const end = outMs + cruiseMs + inMs;

    // The home stands ABOVE the tower: parked home = −1 (above), parked tower = +1 (below).
    it('enter: starts on the home, the tower parked below', () => {
        expect(shiftFrameAt(0, 'enter')).toEqual({ homeY: -0, towerY: 1, speed: 0, altitudeT: 0 });
    });

    it('enter: the home leaves UP, the tower lands with the streaks gone', () => {
        expect(shiftFrameAt(outMs / 2, 'enter').homeY).toBeLessThan(0);
        expect(shiftFrameAt(end, 'enter')).toEqual({ homeY: -1, towerY: 0, speed: 0, altitudeT: 1 });
    });

    it('return: the tower leaves DOWN, the home comes down from above', () => {
        expect(shiftFrameAt(0, 'return')).toEqual({ homeY: -1, towerY: 0, speed: 0, altitudeT: 0 });
        expect(shiftFrameAt(outMs / 2, 'return').towerY).toBeGreaterThan(0);
        expect(shiftFrameAt(end, 'return')).toEqual({ homeY: -0, towerY: 1, speed: 0, altitudeT: 1 });
    });

    it('has neither scene on screen through the cruise, in both directions', () => {
        for (const dir of ['enter', 'return'] as const) {
            const f = shiftFrameAt(outMs + cruiseMs / 2, dir);
            expect(f.homeY).toBe(-1);
            expect(f.towerY).toBe(1);
            expect(f.speed).toBe(1);
        }
    });

    // The pull home carries its rubber band on (docs/HOME_SCREEN.md § "Back to home").
    it('return with a carry: starts where the band left the tower, never moves back, lands the same', () => {
        const out = carriedOutPlan(0.08, 0.0006);
        expect(out.ms).toBeLessThan(outMs);
        expect(shiftFrameAt(0, 'return', out).towerY).toBeCloseTo(0.08, 9);
        let prev = 0.08;
        for (let t = 1; t <= out.ms; t += 1) {
            const y = shiftFrameAt(t, 'return', out).towerY;
            expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
            prev = y;
        }
        expect(shiftFrameAt(out.ms + cruiseMs / 2, 'return', out).towerY).toBe(1);
        expect(shiftFrameAt(out.ms + cruiseMs + inMs, 'return', out)).toEqual({ homeY: -0, towerY: 1, speed: 0, altitudeT: 1 });
    });

    it('an uncarried plan is the plain ease-in (Enter unchanged)', () => {
        expect(carriedOutPlan(0, 0).ms).toBe(outMs);
        expect(shiftFrameAt(outMs / 2, 'enter').homeY).toBeCloseTo(-0.25, 9);
        expect(shiftFrameAt(outMs / 2, 'enter').speed).toBeCloseTo(0.5, 9);
    });
});
