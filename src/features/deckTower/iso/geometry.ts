/**
 * geometry.ts — the projection + shape math of the iso art framework
 * (docs/ISO_ART_FRAMEWORK.md § "Geometry").
 *
 * ── The projection ────────────────────────────────────────────────────────────
 * 2:1 dimetric, the same flavour the Night Market grid uses (docs/NIGHT_MARKET_FEATURE.md
 * § Coordinate System): world +x runs down-RIGHT on screen, world +y runs down-LEFT, and
 * +z is straight UP. One world unit is `unit` screen px along each axis:
 *
 *     sx = (x − y) · unit
 *     sy = (x + y) · unit / 2 − z · unit
 *
 * ── Why everything is an EXTRUDED ROUNDED RECT ────────────────────────────────
 * The art style is built from chunky, softly bevelled boxes with no outlines — edges are
 * told apart purely by the value change between the top and the two visible sides. Every
 * object in the framework (platform, carpet, card, and every shadow) is a rounded
 * rectangle in the world XY plane pushed up along z, so one primitive covers all of it.
 *
 * For a CONVEX shape extruded straight up, the screen silhouette of the solid is simply
 * the convex hull of its top outline and its bottom outline (both project to the same
 * shape, offset vertically). So a solid is drawn as two paths:
 *   1. the HULL, filled with the side shading (see IsoSolid.tsx), then
 *   2. the TOP outline on top of it.
 * The two sides are separated by a hard-ish colour step at the screen x of the shape's
 * FRONT corner (world xMax, yMax) — that is where the left-facing and right-facing walls
 * meet. Blending the step across the corner's arc width reads as the rounded bevel.
 *
 * Depended on by: every file in this folder, and DeckTowerPage.tsx (viewBox fitting).
 * Referenced by docs/ISO_ART_FRAMEWORK.md.
 */

export interface Pt {
    x: number;
    y: number;
}

/** A rounded rectangle lying in the world XY plane. */
export interface WorldRect {
    /** World x of the back-left edge. */
    x: number;
    /** World y of the back-right edge. */
    y: number;
    /** Extent along world x. */
    w: number;
    /** Extent along world y. */
    d: number;
    /** Corner radius in world units (clamped to half the shorter side). */
    r: number;
}

/**
 * World → screen. Two kinds exist: the fixed 2:1 dimetric one below (`makeProjector`, the
 * framework's default view) and the moving camera of camera.ts (`makeCameraProjector`,
 * the Deck Tower's dive onto its top card — docs/DECK_TOWER.md § "Studying the tower").
 * Every object draws through `project`, so it works under either; anything that sizes
 * itself in screen px should prefer `scaleAt` over `unit`, which is exact only for the
 * fixed view.
 */
export interface Projector {
    /** Screen px per world unit at the view's centre (the fixed view: everywhere). */
    unit: number;
    project: (x: number, y: number, z: number) => Pt;
    /**
     * Screen px per world unit AT a point: the square root of the floor plane's area scale
     * there. Equals `unit` everywhere under the fixed view; under a perspective camera it
     * shrinks with distance, so a pawn far below the camera draws small.
     */
    scaleAt: (x: number, y: number, z: number) => number;
    /**
     * Screen px per world unit of a length FACING the camera at a point — the projected
     * radius of a unit sphere there. Larger than `scaleAt` under the tilted views (the
     * fixed view: unit·√2, because the floor is foreshortened but a sphere is not). For
     * round things drawn in true 3D, e.g. IsoPawn's capsule body and ball head
     * (iso/pawnFigure.ts).
     */
    facingScaleAt: (x: number, y: number, z: number) => number;
    /**
     * Whether the camera sees the vertical world plane `axis = at` from its HIGH side (the
     * side where that coordinate is greater). Depth sorting reads it: something past a
     * box's high-x (or high-y) face is in front of the box exactly when that face is seen.
     * The fixed view looks in from +x/+y, so always true there; a camera that tips over to
     * look straight down (iso/camera.ts) stops seeing a face once it is over the face's
     * plane, which is when the tower starts hiding what stands in front of it
     * (usePawnMotion.ts → `depthRankAmong`, `backToFront`).
     */
    seesHighSide: (axis: "x" | "y", at: number) => boolean;
}

export function makeProjector(unit: number, originX = 0, originY = 0): Projector {
    return {
        unit,
        project: (x, y, z) => ({
            x: originX + (x - y) * unit,
            y: originY + ((x + y) * unit) / 2 - z * unit,
        }),
        scaleAt: () => unit,
        // The fixed view is camera.ts's `dimetricView`, whose `scale` is unit·√2.
        facingScaleAt: () => unit * Math.SQRT2,
        seesHighSide: () => true,
    };
}

/** A rect shrunk by `by` on every side (grown when negative), radius shrunk with it. */
export function insetRect(rect: WorldRect, by: number): WorldRect {
    return { x: rect.x + by, y: rect.y + by, w: rect.w - 2 * by, d: rect.d - 2 * by, r: Math.max(0, rect.r - by) };
}

/**
 * Whether the world point lies inside the rounded rect (its corner arcs included).
 * With `insetRect(rect, R)` it answers "does a circle of radius R centred here fit inside
 * `rect`?" — the inset keeps radius max(0, r − R), which is exactly that circle-fit region.
 */
export function insideRoundedRect(p: { x: number; y: number }, rect: WorldRect): boolean {
    if (p.x < rect.x || p.x > rect.x + rect.w || p.y < rect.y || p.y > rect.y + rect.d) return false;
    // Nearest point of the rect's core (the rect shrunk by its radius); inside when within r of it.
    const r = Math.min(rect.r, rect.w / 2, rect.d / 2);
    const cx = Math.min(rect.x + rect.w - r, Math.max(rect.x + r, p.x));
    const cy = Math.min(rect.y + rect.d - r, Math.max(rect.y + r, p.y));
    return Math.hypot(p.x - cx, p.y - cy) <= r;
}

/** A rect slid by (dx, dy) in the world plane — same size and radius. */
export function translateRect(rect: WorldRect, dx: number, dy: number): WorldRect {
    return { ...rect, x: rect.x + dx, y: rect.y + dy };
}

/** Segments per quarter-circle corner. 6 is visually round at the sizes this page draws. */
const CORNER_SEGMENTS = 6;

/**
 * The rounded rect's outline as WORLD points, walked clockwise starting at the
 * back corner. Kept in world space so callers can project it at any height.
 */
export function roundedRectWorld(rect: WorldRect): Pt[] {
    const { x, y, w, d } = rect;
    const r = Math.max(0, Math.min(rect.r, w / 2, d / 2));
    // Corner centres + the angle each quarter arc starts at (world-plane angles).
    const corners: [number, number, number][] = [
        [x + r, y + r, Math.PI],              // back   (xMin, yMin)
        [x + w - r, y + r, 1.5 * Math.PI],    // right  (xMax, yMin)
        [x + w - r, y + d - r, 0],            // front  (xMax, yMax)
        [x + r, y + d - r, 0.5 * Math.PI],    // left   (xMin, yMax)
    ];
    const pts: Pt[] = [];
    for (const [cx, cy, start] of corners) {
        for (let i = 0; i <= CORNER_SEGMENTS; i++) {
            const a = start + (i / CORNER_SEGMENTS) * (Math.PI / 2);
            pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
        }
    }
    return pts;
}

/** Projects a world outline at height z. */
export function projectOutline(proj: Projector, world: Pt[], z: number): Pt[] {
    return world.map((p) => proj.project(p.x, p.y, z));
}

/** A rounded rect lying flat at height z, as a closed SVG path (decals, floors, shadows). */
export function flatPath(proj: Projector, rect: WorldRect, z: number): string {
    return toPath(projectOutline(proj, roundedRectWorld(rect), z));
}

/** Closed SVG path through screen points. */
export function toPath(pts: Pt[]): string {
    if (pts.length === 0) return "";
    return `M${pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join("L")}Z`;
}

/** Open SVG polyline path (no Z) — used for the card-edge stripes. */
export function toOpenPath(pts: Pt[]): string {
    if (pts.length === 0) return "";
    return `M${pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join("L")}`;
}

/** Andrew's monotone-chain convex hull. */
export function convexHull(points: Pt[]): Pt[] {
    const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
    if (pts.length < 3) return pts;
    const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower: Pt[] = [];
    for (const p of pts) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
        lower.push(p);
    }
    const upper: Pt[] = [];
    for (let i = pts.length - 1; i >= 0; i--) {
        const p = pts[i];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
        upper.push(p);
    }
    upper.pop();
    lower.pop();
    return lower.concat(upper);
}

/** Screen geometry of one extruded rounded rect. */
export interface PrismGeometry {
    /** Path of the top face. */
    top: string;
    /** Path of the whole silhouette (sides + top) — fill with the side gradient. */
    hull: string;
    /** Screen x of the front corner, where the two visible walls meet. */
    frontX: number;
    /** Half the screen width of the front corner's arc — the bevel blend width. */
    bevelHalfWidth: number;
    /** Screen-space bounding box of the silhouette. */
    bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

export function prism(proj: Projector, rect: WorldRect, zBottom: number, zTop: number): PrismGeometry {
    const world = roundedRectWorld(rect);
    const topPts = projectOutline(proj, world, zTop);
    const hullPts = convexHull(topPts.concat(projectOutline(proj, world, zBottom)));
    const r = Math.max(0, Math.min(rect.r, rect.w / 2, rect.d / 2));
    const front = proj.project(rect.x + rect.w, rect.y + rect.d, zTop);
    return {
        top: toPath(topPts),
        hull: toPath(hullPts),
        frontX: front.x,
        bevelHalfWidth: Math.max(1, r * proj.scaleAt(rect.x + rect.w, rect.y + rect.d, zTop) * 0.9),
        bounds: boundsOf(hullPts),
    };
}

/**
 * The FRONT half of a rounded rect's outline at height z — the part of the edge a
 * viewer sees, running from the leftmost screen point through the front corner to the
 * rightmost. Stroked at successive heights it draws the thin seams between stacked
 * cards on the tower's walls.
 */
export function frontContour(proj: Projector, rect: WorldRect, z: number): Pt[] {
    const pts = projectOutline(proj, roundedRectWorld(rect), z);
    let iMin = 0;
    let iMax = 0;
    pts.forEach((p, i) => {
        if (p.x < pts[iMin].x) iMin = i;
        if (p.x > pts[iMax].x) iMax = i;
    });
    // Two chains join the extremes; the front one is the lower one on screen.
    const walk = (from: number, to: number) => {
        const chain: Pt[] = [];
        for (let i = from; ; i = (i + 1) % pts.length) {
            chain.push(pts[i]);
            if (i === to) break;
        }
        return chain;
    };
    const a = walk(iMax, iMin);
    const b = walk(iMin, iMax);
    const avgY = (c: Pt[]) => c.reduce((s, p) => s + p.y, 0) / c.length;
    return avgY(a) > avgY(b) ? a : b;
}

export function boundsOf(pts: Pt[]) {
    return pts.reduce(
        (b, p) => ({
            minX: Math.min(b.minX, p.x),
            minY: Math.min(b.minY, p.y),
            maxX: Math.max(b.maxX, p.x),
            maxY: Math.max(b.maxY, p.y),
        }),
        { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
    );
}

/**
 * SVG `transform` that maps a FLAT drawing (world units, x right / y down) onto the
 * top face of a solid at height z — so text and decals on a card lie flat on it like a
 * print, instead of floating upright. Draw content in world coordinates (the same ones
 * passed to `roundedRectWorld`) inside a `<g transform={…}>`.
 *
 * `at` is the world point the map is measured around — pass the print's centre. Under
 * the fixed view the plane map is affine and `at` changes nothing; under a perspective
 * camera (camera.ts) it is only LOCALLY affine, so it is exact at `at` and drifts
 * slightly away from it — a print a few units across stays true to a fraction of a px.
 */
export function faceTransform(proj: Projector, z: number, at: Pt = { x: 0, y: 0 }): string {
    return affineToSvg(faceAffine(proj, z, at));
}

/** `faceTransform` as an `Affine`, for composing with other plane maps (e.g. a hinge). */
export function faceAffine(proj: Projector, z: number, at: Pt = { x: 0, y: 0 }): Affine {
    // The images of `at` and its two unit neighbours fix the map: world x̂ → (a, b),
    // world ŷ → (c, d), translated so `at` lands where it projects. (Under the fixed
    // view that is (u, u/2), (−u, u/2) — the matrix this used to hard-code.)
    const o = proj.project(at.x, at.y, z);
    const px = proj.project(at.x + 1, at.y, z);
    const py = proj.project(at.x, at.y + 1, z);
    const a = px.x - o.x;
    const b = px.y - o.y;
    const c = py.x - o.x;
    const d = py.y - o.y;
    return { a, b, c, d, e: o.x - a * at.x - c * at.y, f: o.y - b * at.x - d * at.y };
}

// ── Affine maps ─────────────────────────────────────────────────────────────────
// A FLAT thing (a decal, a whole floor) that tilts out of the XY plane is still flat, and
// the projection is affine — so where it lands on screen is an affine image of where it
// was drawn. That lets a tilting plane be redrawn with one SVG `matrix(…)` instead of
// re-projecting every path in it. Used by the hinged platform (its floor and decals
// swing with the door).

/** A 2-D affine map in SVG matrix order: (x, y) → (a·x + c·y + e, b·x + d·y + f). */
export interface Affine {
    a: number;
    b: number;
    c: number;
    d: number;
    e: number;
    f: number;
}

/** The affine map sending (0,0) → p00, (1,0) → p10 and (0,1) → p01. */
export function affineFrom3(p00: Pt, p10: Pt, p01: Pt): Affine {
    return { a: p10.x - p00.x, b: p10.y - p00.y, c: p01.x - p00.x, d: p01.y - p00.y, e: p00.x, f: p00.y };
}

export function invertAffine(m: Affine): Affine {
    const det = m.a * m.d - m.b * m.c;
    // A degenerate map (a plane seen exactly edge-on) has no inverse; callers only invert
    // the untilted floor map, which never is.
    if (Math.abs(det) < 1e-9) return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    const a = m.d / det;
    const b = -m.b / det;
    const c = -m.c / det;
    const d = m.a / det;
    return { a, b, c, d, e: -(a * m.e + c * m.f), f: -(b * m.e + d * m.f) };
}

/** `outer ∘ inner`: apply `inner` first. */
export function composeAffine(outer: Affine, inner: Affine): Affine {
    return {
        a: outer.a * inner.a + outer.c * inner.b,
        b: outer.b * inner.a + outer.d * inner.b,
        c: outer.a * inner.c + outer.c * inner.d,
        d: outer.b * inner.c + outer.d * inner.d,
        e: outer.a * inner.e + outer.c * inner.f + outer.e,
        f: outer.b * inner.e + outer.d * inner.f + outer.f,
    };
}

export function affineToSvg(m: Affine): string {
    return `matrix(${[m.a, m.b, m.c, m.d, m.e, m.f].map((v) => v.toFixed(4)).join(" ")})`;
}

// ── Hinges (trap doors) ─────────────────────────────────────────────────────────

/** A point in world space. */
export interface Pt3 {
    x: number;
    y: number;
    z: number;
}

/**
 * A hinge running along world y through (x, ·, z) — a rect's BACK-LEFT edge (its xMin
 * edge: the upper-left edge on screen) when `x = rect.x`. `angle` is in radians: 0 is
 * shut, and a positive angle swings the +x side DOWN, like a trap door dropping open.
 * At π/2 the door hangs straight down, its top face turned toward the viewer.
 *
 * Depended on by: IsoPlatform (`hinge`), docs/DECK_TOWER_TRANSITIONS.md § "Trap door".
 */
export interface Hinge {
    x: number;
    z: number;
    angle: number;
}

/** Where a world point ends up when the door it belongs to swings on `hinge`. */
export function hingePoint(hinge: Hinge, p: Pt3): Pt3 {
    const c = Math.cos(hinge.angle);
    const s = Math.sin(hinge.angle);
    const dx = p.x - hinge.x;
    const dz = p.z - hinge.z;
    // A rotation in the XZ plane: (dx, dz) → (dx·c + dz·s, −dx·s + dz·c), so a point in
    // front of the hinge (dx > 0) on its plane (dz = 0) goes DOWN as the angle grows.
    return { x: hinge.x + dx * c + dz * s, y: p.y, z: hinge.z - dx * s + dz * c };
}

/** A rounded rect's outline at height z, swung on `hinge`, as world points. */
export function hingedOutline(rect: WorldRect, z: number, hinge: Hinge): Pt3[] {
    return roundedRectWorld(rect).map((p) => hingePoint(hinge, { x: p.x, y: p.y, z }));
}

/**
 * `prism` for an extruded rounded rect swung on a hinge. A rotated convex solid is still
 * convex, so its silhouette is still the hull of its two outlines. Its top face stays
 * toward the viewer up to 3π/4 (its normal (sin θ, 0, cos θ) against the view direction
 * (1, 1, 1)), and its underside never shows, so the IsoSolid recipe — walls, then the top
 * over them — still holds for every angle a door swings through.
 */
export function hingedPrism(proj: Projector, rect: WorldRect, zBottom: number, zTop: number, hinge: Hinge): PrismGeometry {
    return posedPrism(proj, rect, zBottom, zTop, (p) => hingePoint(hinge, p));
}

/**
 * `prism` for an extruded rounded rect carried rigidly through space by `place` (a world
 * point of the unposed solid → where it is now): `hingedPrism` is the hinge's swing. A rigid
 * motion keeps the solid convex, so its silhouette is still the hull of its two outlines,
 * and the top is painted over the walls (IsoSolid) — right while the top faces the camera,
 * which is all its caller needs.
 */
export function posedPrism(proj: Projector, rect: WorldRect, zBottom: number, zTop: number, place: (p: Pt3) => Pt3): PrismGeometry {
    const toScreen = (pts: Pt3[]) => pts.map((p) => proj.project(p.x, p.y, p.z));
    const outlineAt = (z: number) => roundedRectWorld(rect).map((p) => place({ x: p.x, y: p.y, z }));
    const topPts = toScreen(outlineAt(zTop));
    const hullPts = convexHull(topPts.concat(toScreen(outlineAt(zBottom))));
    const r = Math.max(0, Math.min(rect.r, rect.w / 2, rect.d / 2));
    const f = place({ x: rect.x + rect.w, y: rect.y + rect.d, z: zTop });
    return {
        top: toPath(topPts),
        hull: toPath(hullPts),
        frontX: proj.project(f.x, f.y, f.z).x,
        bevelHalfWidth: Math.max(1, r * proj.unit * 0.9),
        bounds: boundsOf(hullPts),
    };
}

/** The map from world (x, y) on a flat plane to screen, given where three of its points land. */
function planeMap(proj: Projector, place: (x: number, y: number) => Pt3): Affine {
    const at = (x: number, y: number) => {
        const p = place(x, y);
        return proj.project(p.x, p.y, p.z);
    };
    return affineFrom3(at(0, 0), at(1, 0), at(0, 1));
}

/**
 * SVG `transform` that carries anything already DRAWN flat at height z (in screen
 * coordinates, e.g. a `flatPath` or a `faceTransform` print) onto the same plane swung on
 * `hinge`. Exact for flat things only — a solid standing on the plane would need its own
 * re-projection.
 */
export function hingedPlaneTransform(proj: Projector, z: number, hinge: Hinge): string {
    return affineToSvg(hingedPlaneAffine(proj, z, hinge));
}

/** `hingedPlaneTransform` as an `Affine` (to compose, or to invert — see IsoFloorLabel's raised plate on a swung door). */
export function hingedPlaneAffine(proj: Projector, z: number, hinge: Hinge): Affine {
    const shut = planeMap(proj, (x, y) => ({ x, y, z }));
    const swung = planeMap(proj, (x, y) => hingePoint(hinge, { x, y, z }));
    return composeAffine(swung, invertAffine(shut));
}
