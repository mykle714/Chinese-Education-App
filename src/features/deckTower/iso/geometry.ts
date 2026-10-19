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

/** Screen-space projector bound to one scale + origin. */
export interface Projector {
    unit: number;
    project: (x: number, y: number, z: number) => Pt;
}

export function makeProjector(unit: number, originX = 0, originY = 0): Projector {
    return {
        unit,
        project: (x, y, z) => ({
            x: originX + (x - y) * unit,
            y: originY + ((x + y) * unit) / 2 - z * unit,
        }),
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
        bevelHalfWidth: Math.max(1, r * proj.unit * 0.9),
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
 */
export function faceTransform(proj: Projector, z: number): string {
    const o = proj.project(0, 0, z);
    const u = proj.unit;
    // Columns of the affine map: world x̂ → (u, u/2), world ŷ → (−u, u/2).
    return `matrix(${u} ${u / 2} ${-u} ${u / 2} ${o.x.toFixed(2)} ${o.y.toFixed(2)})`;
}
