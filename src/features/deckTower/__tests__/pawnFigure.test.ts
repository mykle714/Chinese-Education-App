import { describe, expect, it } from "vitest";
import { dimetricView, makeCameraProjector, makeProjector } from "../iso";
import { pawnFigure, REST_POSE } from "../iso/pawnFigure";

// docs/ISO_ART_FRAMEWORK.md § "IsoPawn" → "View": the 3D figure is calibrated to the old
// 2D pill under the fixed view.
const UNIT = 20;

/** The numbers in an SVG path, in order. */
const pathNums = (d: string) => (d.match(/-?\d+(\.\d+)?(e-?\d+)?/g) ?? []).map(Number);

describe("pawnFigure", () => {
    it("draws the old screen-space pill and ball under the fixed view", () => {
        const proj = makeProjector(UNIT);
        const feet = proj.project(3, 4, 1);
        const fig = pawnFigure(proj, { x: 3, y: 4, z: 1 }, REST_POSE);
        // Head: centre (1.5 + 0.55·0.44) units above the feet, radius 0.44 units.
        expect(fig.head.cx).toBeCloseTo(feet.x, 6);
        expect(fig.head.cy).toBeCloseTo(feet.y - (1.5 + 0.55 * 0.44) * UNIT, 6);
        expect(fig.head.r).toBeCloseTo(0.44 * UNIT, 6);
        // Body: the hull runs up the right side, from the bottom end's centre height to the
        // top end's — a stadium 0.78 units wide and 1.5 tall standing on the feet.
        const [mx, my, lx, ly] = pathNums(fig.bodyPath);
        expect(mx).toBeCloseTo(feet.x + 0.39 * UNIT, 6);
        expect(my).toBeCloseTo(feet.y - 0.39 * UNIT, 6);
        expect(lx).toBeCloseTo(feet.x + 0.39 * UNIT, 6);
        expect(ly).toBeCloseTo(feet.y - (1.5 - 0.39) * UNIT, 6);
    });

    it("shrinks to a head over a peeking body from straight above", () => {
        const view = { ...dimetricView(UNIT, { x: 0, y: 0, z: 0 }), yaw: 0, pitch: 0, zScale: 1, perspective: 1 / 14, screen: { x: 0, y: 0 } };
        const proj = makeCameraProjector(view);
        const fig = pawnFigure(proj, { x: 3, y: 0, z: 0 }, REST_POSE);
        const feet = proj.project(3, 0, 0);
        // Seen from above, the head sits (nearly) over the feet, pushed outward by perspective.
        expect(Math.abs(fig.head.cy - feet.y)).toBeLessThan(1e-6);
        expect(fig.head.cx).toBeGreaterThan(feet.x);
    });
});
