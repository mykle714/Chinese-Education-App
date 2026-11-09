import { describe, expect, it } from "vitest";
import { dimetricView, makeCameraProjector, makeProjector } from "../iso";
import { pawnFigure, pawnVest, REST_POSE } from "../iso/pawnFigure";

// docs/ISO_ART_FRAMEWORK.md § "IsoPawn" → "View": the 3D figure is calibrated to the old
// 2D pill, whose widths the fixed view keeps and whose heights it shortens.
const UNIT = 20;

/** The numbers in an SVG path, in order. */
const pathNums = (d: string) => (d.match(/-?\d+(\.\d+)?(e-?\d+)?/g) ?? []).map(Number);

describe("pawnFigure", () => {
    it("draws the screen-space pill and ball under the fixed view", () => {
        const proj = makeProjector(UNIT);
        const feet = proj.project(3, 4, 1);
        const up = proj.heightUnit;
        const fig = pawnFigure(proj, { x: 3, y: 4, z: 1 }, REST_POSE);
        // Head: centre (1.5 + 0.55·0.44) units above the feet, radius 0.44 units.
        expect(fig.head.cx).toBeCloseTo(feet.x, 6);
        expect(fig.head.cy).toBeCloseTo(feet.y - (1.5 + 0.55 * 0.44) * up, 6);
        expect(fig.head.r).toBeCloseTo(0.44 * UNIT, 6);
        // Body: the hull runs up the right side, from the bottom end's centre height to the
        // top end's — a stadium 0.78 units wide and 1.5 tall standing on the feet.
        const [mx, my, lx, ly] = pathNums(fig.bodyPath);
        expect(mx).toBeCloseTo(feet.x + 0.39 * UNIT, 6);
        expect(my).toBeCloseTo(feet.y - 0.39 * up, 6);
        expect(lx).toBeCloseTo(feet.x + 0.39 * UNIT, 6);
        expect(ly).toBeCloseTo(feet.y - (1.5 - 0.39) * up, 6);
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

    // § IsoPawn → "Back stretch": a non-zero `arch` bends the spine.
    it("an arch too small to see draws the straight figure's head", () => {
        const proj = makeProjector(UNIT);
        const pose = { lean: -5, sx: 1.05, sy: 0.95 };
        const straight = pawnFigure(proj, { x: 3, y: 4, z: 1 }, pose);
        const arched = pawnFigure(proj, { x: 3, y: 4, z: 1 }, { ...pose, arch: 1e-6 });
        expect(arched.head.cx).toBeCloseTo(straight.head.cx, 4);
        expect(arched.head.cy).toBeCloseTo(straight.head.cy, 4);
        expect(arched.head.r).toBeCloseTo(straight.head.r, 6);
    });

    it("an arch curls the head back, short of where a rigid lean of the same angle puts it", () => {
        const proj = makeProjector(UNIT);
        const feet = proj.project(3, 4, 1);
        // − curls toward screen-left; with no lean the hips stay upright, so the head
        // moves left, but by less than a rigid lean of the full angle would carry it.
        const arched = pawnFigure(proj, { x: 3, y: 4, z: 1 }, { lean: 0, sx: 1, sy: 1, arch: -30 });
        const leaned = pawnFigure(proj, { x: 3, y: 4, z: 1 }, { lean: -30, sx: 1, sy: 1 });
        expect(arched.head.cx).toBeLessThan(feet.x - 1);
        expect(arched.head.cx).toBeGreaterThan(leaned.head.cx);
        // The body is a chain of capsules in one path (ARCH_SEGMENTS of them).
        expect(arched.bodyPath.match(/M/g)?.length).toBe(10);
    });

    // `bendHeading`: the direction lean and arch tip toward (the back stretch sets it to the pawn's facing).
    it("bendHeading 90 is the default picture-plane bend", () => {
        const proj = makeProjector(UNIT);
        const pose = { lean: -3, sx: 0.92, sy: 1.16, arch: -30 };
        const byDefault = pawnFigure(proj, { x: 3, y: 4, z: 1 }, pose);
        const explicit = pawnFigure(proj, { x: 3, y: 4, z: 1 }, { ...pose, bendHeading: 90 });
        expect(explicit.head.cx).toBeCloseTo(byDefault.head.cx, 6);
        expect(explicit.head.cy).toBeCloseTo(byDefault.head.cy, 6);
        expect(explicit.bodyPath).toBe(byDefault.bodyPath);
    });

    it("a bend with heading 0 (facing the camera) curls the back away: the head rises, not sideways", () => {
        const proj = makeProjector(UNIT);
        const pose = { lean: 0, sx: 1, sy: 1, arch: -30 };
        const upright = pawnFigure(proj, { x: 3, y: 4, z: 1 }, REST_POSE);
        const away = pawnFigure(proj, { x: 3, y: 4, z: 1 }, { ...pose, bendHeading: 0 });
        // Away from the camera is screen-up in this view: the head stays centred and climbs.
        expect(away.head.cx).toBeCloseTo(upright.head.cx, 6);
        expect(away.head.cy).toBeLessThan(upright.head.cy - 1);
        // Turned 15° toward screen-right, the back curls away and a little to screen-left.
        const turned = pawnFigure(proj, { x: 3, y: 4, z: 1 }, { ...pose, bendHeading: 15 });
        const sideways = pawnFigure(proj, { x: 3, y: 4, z: 1 }, pose);
        expect(turned.head.cx).toBeLessThan(upright.head.cx);
        expect(turned.head.cx).toBeGreaterThan(sideways.head.cx);
    });
});

// docs/HINT_PAWN.md § "Night vest" — the hint pawn's hi-viz vest, painted round the capsule.
describe("pawnVest", () => {
    /** A path's points as [x, y] pairs (every path here is M/L polylines). */
    const pathPts = (d: string) => {
        const n = pathNums(d);
        const pts: [number, number][] = [];
        for (let i = 0; i + 1 < n.length; i += 2) pts.push([n[i], n[i + 1]]);
        return pts;
    };
    const ys = (d: string) => pathPts(d).map(([, y]) => y);

    it("spans the body's width and sits between hip and chest at rest", () => {
        const proj = makeProjector(UNIT);
        const feet = proj.project(3, 4, 1);
        const up = proj.heightUnit;
        const { vestPath } = pawnVest(proj, { x: 3, y: 4, z: 1 }, REST_POSE);
        const pts = pathPts(vestPath);
        // Wider than the body (0.39 units each side) — the clip trims it to the outline.
        expect(Math.min(...pts.map(([x]) => x))).toBeLessThan(feet.x - 0.39 * UNIT);
        expect(Math.max(...pts.map(([x]) => x))).toBeGreaterThan(feet.x + 0.39 * UNIT);
        // Its top edge is no higher than the body's top (1.5 units); its hem is off the ground.
        expect(Math.min(...ys(vestPath))).toBeGreaterThanOrEqual(feet.y - 1.5 * up);
        expect(Math.max(...ys(vestPath))).toBeLessThan(feet.y);
    });

    it("bows its edges toward the camera (front arcs lower in the middle than at the sides)", () => {
        const proj = makeProjector(UNIT);
        const pts = pathPts(pawnVest(proj, { x: 0, y: 0, z: 0 }, REST_POSE).vestPath);
        // The first half of the points is the top edge's front arc, left → right.
        const top = pts.slice(0, pts.length / 2);
        const mid = top[Math.floor(top.length / 2)];
        expect(mid[1]).toBeGreaterThan(top[0][1]);
        expect(mid[1]).toBeGreaterThan(top[top.length - 1][1]);
    });

    it("keeps both stripes inside the vest", () => {
        const proj = makeProjector(UNIT);
        const { vestPath, stripesPath } = pawnVest(proj, { x: 0, y: 0, z: 0 }, REST_POSE);
        expect(stripesPath.match(/M/g)).toHaveLength(2);
        expect(Math.min(...ys(stripesPath))).toBeGreaterThan(Math.min(...ys(vestPath)));
        expect(Math.max(...ys(stripesPath))).toBeLessThan(Math.max(...ys(vestPath)));
    });

    /** The openings' three subpaths: the front gap, then the arm holes a quarter turn left and right of the facing. */
    const openings = (facingDeg: number) =>
        pawnVest(makeProjector(UNIT), { x: 0, y: 0, z: 0 }, REST_POSE, facingDeg)
            .openingsPath.split("M")
            .filter(Boolean)
            .map((d) => pathPts(`M${d}`).map(([x]) => x));
    const span = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const outline = 0.39 * UNIT;

    it("facing the viewer: a narrow front gap on the centre line, the arm holes at the two sides", () => {
        const [front, leftHole, rightHole] = openings(0);
        expect(Math.min(...front)).toBeLessThan(0);
        expect(Math.max(...front)).toBeGreaterThan(0);
        expect(span(front)).toBeLessThan(outline);
        // Each hole reaches the outline on its own side.
        expect(Math.min(...leftHole)).toBeLessThanOrEqual(-outline);
        expect(Math.max(...rightHole)).toBeGreaterThanOrEqual(outline);
    });

    it("turned toward screen-right: the gap moves right, the left arm hole comes onto the face, the right one goes round the back", () => {
        const [front0, left0, right0] = openings(0);
        const [front, leftHole, rightHole] = openings(45);
        expect(mean(front)).toBeGreaterThan(mean(front0) + 0.2 * outline);
        // The left hole now shows as an oval on the body's face, clear of the outline...
        expect(span(leftHole)).toBeGreaterThan(span(left0));
        expect(Math.max(...leftHole)).toBeGreaterThan(-outline / 2);
        // ...and the right one is (all but) gone: every point pinned at or past the right outline.
        expect(Math.min(...rightHole)).toBeGreaterThanOrEqual(outline - 1e-6);
        expect(span(rightHole)).toBeLessThan(span(right0));
    });

    it("follows the body through a lean and an arch (finite, and moved off the rest pose)", () => {
        const proj = makeProjector(UNIT);
        const rest = pawnVest(proj, { x: 0, y: 0, z: 0 }, REST_POSE);
        const bent = pawnVest(proj, { x: 0, y: 0, z: 0 }, { lean: 10, sx: 0.9, sy: 1.1, arch: -25 });
        expect(pathNums(bent.vestPath).every(Number.isFinite)).toBe(true);
        expect(pathNums(bent.openingsPath).every(Number.isFinite)).toBe(true);
        expect(bent.vestPath).not.toEqual(rest.vestPath);
    });
});
