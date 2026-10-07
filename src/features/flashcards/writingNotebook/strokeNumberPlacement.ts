/**
 * strokeNumberPlacement.ts — where each stroke-ORDER number sits on a writing shadow
 * (docs/WRITING_NOTEBOOK.md § "Page anatomy" → stroke numbers).
 *
 * A number must read as belonging to ITS stroke — anywhere along it, not only at its
 * start. Each stroke is represented twice: its corpus MEDIAN (centre line) in cell
 * pixels, and its own rasterised INK (`GlyphMasks.strokes`). Placement is greedy in
 * stroke order over a grid of candidate centres, under one HARD rule and a cost:
 *
 *   HARD: the number never covers any ink of its OWN stroke.
 *
 *   cost = STROKE_WEIGHT × number of OTHER strokes the label's box touches
 *        + INK_WEIGHT    × share of the label's box covered by shadow (all strokes)
 *        + LABEL_WEIGHT  × share of the label's box covered by numbers already placed
 *        + distance to the stroke's centre line (type sizes)
 *        + HEAD_WEIGHT   × distance to the stroke's start (type sizes) — a mild pull
 *                          toward the conventional spot, never a requirement
 *        + AMBIGUITY_COST when ANOTHER stroke's centre line is nearer than this one's
 *                          (the number would read as labelling that stroke)
 *        + CLARITY_WEIGHT × how nearly the most confusable other stroke matches this
 *                          one's distance: 0 when it is CLARITY_MARGIN type sizes further
 *                          away or more, rising linearly to 1 when it is as near
 *                          (a number between two strokes reads as either's)
 *
 * The search widens in steps, each taken only when the previous found nothing clear of
 * the other numbers:
 *   1. within REACH type sizes of the stroke's centre line;
 *   2. anywhere in the cell;
 *   3. (last resort, the hard rule can't be met anywhere) anywhere, own ink allowed and
 *      costed like any other stroke's.
 * Within a step a spot on shadow beats a clear spot further out only by cost — so a
 * number sits on another stroke beside its own rather than drifting away.
 *
 * TIEBREAK: every spot within TIE_COST of the cheapest counts as a tie, and the tie goes
 * to the spot nearest the stroke's START (then the cheaper). Without it, near-equal spots
 * were settled by scan order (top-left first), wherever along the stroke that landed.
 * Out-of-cell candidates are never taken.
 *
 * Ink lookups are O(1) reads of summed-area tables (`InkMask`) — one for the whole
 * glyph, one per stroke cropped to that stroke's bounding box; candidate → centre-line
 * distances are computed once per call. With no masks (no canvas — a glyph not loaded,
 * jsdom) numbers still avoid each other and stay nearest their stroke, not the ink.
 *
 * The search is pure (`placeStrokeNumbers`, `maskFromAlpha`); only `rasterizeGlyphMask`
 * touches the DOM. Used by ShadowCell.tsx. Tests: src/__tests__/strokeNumberPlacement.test.ts.
 */

/** A stroke's centre line (its corpus median) in cell pixels, from its start. */
export type StrokeLine = readonly (readonly [number, number])[];

/**
 * Summed-area table over an ink occupancy grid (1 = ink), one pixel per cell pixel,
 * covering the cell-pixel window [left, left + width) × [top, top + height).
 */
export interface InkMask {
    left: number;
    top: number;
    width: number;
    height: number;
    /** (width + 1) × (height + 1); sat[y·(width+1) + x] = ink pixels above-left of (x, y). */
    sat: Uint32Array;
}

/** The whole shadow, and each stroke's own ink (same order as the strokes). */
export interface GlyphMasks {
    union: InkMask;
    strokes: InkMask[];
}

export interface PlacementOptions {
    /** Cell side the numbers must stay inside (px). */
    size: number;
    fontPx: number;
    /** Clearance padding added on every side of a label's footprint (px). */
    pad: number;
    masks: GlyphMasks | null;
}

/** Alpha above which a rasterised pixel counts as ink (anti-aliased fringes do not). */
const INK_ALPHA = 64;
/** A fully-inked label costs as much as sitting this many type sizes off the stroke. */
const INK_WEIGHT = 40;
/** Each other stroke the label touches, however slightly. */
const STROKE_WEIGHT = 10;
/** Overlapping another number is close to forbidden. */
const LABEL_WEIGHT = 400;
/**
 * Cost of a spot whose nearest stroke is not its own — half a fully-inked label, so a
 * number will sit partly on the shadow before it sits closer to the wrong stroke.
 */
const AMBIGUITY_COST = 20;
/** Full cost of an equally-near other stroke, and the margin past which it costs nothing. */
const CLARITY_WEIGHT = 8;
const CLARITY_MARGIN = 1;
/** Mild pull toward the stroke's start, per type size. */
const HEAD_WEIGHT = 0.15;
/**
 * Spots costing within this much of the cheapest (type sizes of centre-line distance)
 * are a tie, settled toward the stroke's start (see TIEBREAK in the header).
 */
const TIE_COST = 0.25;
/** Candidate grid spacing, in type sizes. */
const GRID_STEP = 0.25;
/** How far (type sizes, centre line → label centre) a number may sit from its stroke. */
const REACH = 1.5;
/** Last-resort cost per own-stroke stroke-touch (step 3 only). */
const OWN_STROKE_WEIGHT = 2 * STROKE_WEIGHT;
/** Two centre lines this close (px) count as a tie, not as "the other one is nearer". */
const TIE_PX = 0.5;
/** Digit advance and cap height as shares of the type size (bold sans numerals). */
const DIGIT_WIDTH = 0.6;
const DIGIT_HEIGHT = 0.75;

/**
 * Build the summed-area table from RGBA pixel data (ImageData.data) of a width × height
 * image. With `crop`, the table covers only the ink's bounding box (a single stroke is a
 * small part of the cell); an inkless image gives an empty table.
 */
export function maskFromAlpha(rgba: ArrayLike<number>, width: number, height: number, crop = false): InkMask {
    const ink = (x: number, y: number) => rgba[(y * width + x) * 4 + 3] > INK_ALPHA;
    let left = 0;
    let top = 0;
    let right = width;
    let bottom = height;
    if (crop) {
        left = width; top = height; right = 0; bottom = 0;
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
            if (!ink(x, y)) continue;
            if (x < left) left = x;
            if (x + 1 > right) right = x + 1;
            if (y < top) top = y;
            if (y + 1 > bottom) bottom = y + 1;
        }
        if (right <= left) return { left: 0, top: 0, width: 0, height: 0, sat: new Uint32Array(1) };
    }
    const w = right - left;
    const h = bottom - top;
    const stride = w + 1;
    const sat = new Uint32Array(stride * (h + 1));
    for (let y = 0; y < h; y++) {
        let rowSum = 0;
        for (let x = 0; x < w; x++) {
            if (ink(left + x, top + y)) rowSum += 1;
            sat[(y + 1) * stride + x + 1] = sat[y * stride + x + 1] + rowSum;
        }
    }
    return { left, top, width: w, height: h, sat };
}

/** Ink pixels inside the cell-pixel rectangle [x0, x1) × [y0, y1), clipped to the mask. */
export function inkInRect(mask: InkMask, x0: number, y0: number, x1: number, y1: number): number {
    const cx0 = Math.max(0, Math.min(mask.width, Math.floor(x0) - mask.left));
    const cy0 = Math.max(0, Math.min(mask.height, Math.floor(y0) - mask.top));
    const cx1 = Math.max(0, Math.min(mask.width, Math.ceil(x1) - mask.left));
    const cy1 = Math.max(0, Math.min(mask.height, Math.ceil(y1) - mask.top));
    if (cx1 <= cx0 || cy1 <= cy0) return 0;
    const s = mask.width + 1;
    const { sat } = mask;
    return sat[cy1 * s + cx1] - sat[cy0 * s + cx1] - sat[cy1 * s + cx0] + sat[cy0 * s + cx0];
}

/**
 * Rasterise corpus stroke outlines into `GlyphMasks` at `size` px, through the same
 * affine map `guideToCanvas` gives the SVG (`pad + scale·x`, `pad + scale·(900 − y)`):
 * each stroke alone (cropped), then all of them together. Null where no 2D canvas or
 * Path2D exists (jsdom) — callers then skip ink avoidance.
 */
export function rasterizeGlyphMasks(strokes: readonly string[], size: number, pad: number, scale: number): GlyphMasks | null {
    const side = Math.max(1, Math.round(size));
    try {
        if (typeof document === "undefined" || typeof Path2D === "undefined") return null;
        const canvas = document.createElement("canvas");
        canvas.width = side;
        canvas.height = side;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return null;
        const paths = strokes.map((d) => new Path2D(d));
        const draw = (only: Path2D[]) => {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, side, side);
            ctx.setTransform(scale, 0, 0, -scale, pad, pad + 900 * scale);
            for (const path of only) ctx.fill(path);
            return ctx.getImageData(0, 0, side, side).data;
        };
        const perStroke = paths.map((path) => maskFromAlpha(draw([path]), side, side, true));
        return { union: maskFromAlpha(draw(paths), side, side), strokes: perStroke };
    } catch {
        return null;
    }
}

interface Box { x0: number; y0: number; x1: number; y1: number }

/** A scored candidate spot; `headDist` is its distance to the stroke's start (px). */
interface Candidate { x: number; y: number; cost: number; covered: number; headDist: number }

/**
 * The cheapest candidate, ties (within TIE_COST of it) going to the one nearest the
 * stroke's start, then the cheaper. Two passes so the result does not depend on scan order.
 */
function pickCandidate(candidates: readonly Candidate[]): Candidate | null {
    let min = Infinity;
    for (const c of candidates) if (c.cost < min) min = c.cost;
    let best: Candidate | null = null;
    for (const c of candidates) {
        if (c.cost > min + TIE_COST) continue;
        if (!best || c.headDist < best.headDist || (c.headDist === best.headDist && c.cost < best.cost)) best = c;
    }
    return best;
}

const overlapArea = (a: Box, b: Box) =>
    Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

/** Distance from (px, py) to a polyline (a single point when it has one vertex). */
export function distanceToLine(px: number, py: number, line: StrokeLine): number {
    if (line.length === 0) return Infinity;
    let best = Math.hypot(px - line[0][0], py - line[0][1]);
    for (let k = 1; k < line.length; k++) {
        const [ax, ay] = line[k - 1];
        const [bx, by] = line[k];
        const dx = bx - ax;
        const dy = by - ay;
        const len2 = dx * dx + dy * dy;
        const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
        best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
    }
    return best;
}

/**
 * Place one number per stroke (index i → label `i + 1`). Returns label centres in the
 * same order. Greedy in stroke order, so stroke 1 gets first pick of its spot.
 */
export function placeStrokeNumbers(lines: readonly StrokeLine[], opts: PlacementOptions): { x: number; y: number }[] {
    const { size, fontPx, pad, masks } = opts;

    // The candidate grid, and every candidate's distance to every stroke's centre line.
    const step = Math.max(1, GRID_STEP * fontPx);
    const xs: number[] = [];
    const ys: number[] = [];
    for (let y = step / 2; y < size; y += step) for (let x = step / 2; x < size; x += step) { xs.push(x); ys.push(y); }
    const dist = lines.map((line) => Float32Array.from(xs, (x, c) => distanceToLine(x, ys[c], line)));

    const placed: Box[] = [];
    const out: { x: number; y: number }[] = [];

    lines.forEach((line, i) => {
        // The label's footprint, clearance padding included, centred on (cx, cy).
        const halfW = (String(i + 1).length * DIGIT_WIDTH * fontPx) / 2 + pad;
        const halfH = (DIGIT_HEIGHT * fontPx) / 2 + pad;
        const area = 4 * halfW * halfH;
        const boxAt = (cx: number, cy: number): Box => ({ x0: cx - halfW, y0: cy - halfH, x1: cx + halfW, y1: cy + halfH });
        const head = line[0] ?? [size / 2, size / 2];

        /**
         * Best candidate within `reach` of the centre line. `allowOwn` false makes the
         * hard rule (no own-stroke ink) a filter; true costs own ink like heavy overlap.
         */
        const search = (reach: number, allowOwn: boolean): Candidate[] => {
            const found: Candidate[] = [];
            for (let c = 0; c < xs.length; c++) {
                const own = dist[i][c];
                if (own > reach) continue;
                const cx = xs[c];
                const cy = ys[c];
                const box = boxAt(cx, cy);
                if (box.x0 < 0 || box.y0 < 0 || box.x1 > size || box.y1 > size) continue;

                const headDist = Math.hypot(cx - head[0], cy - head[1]);
                let cost = own / fontPx + (HEAD_WEIGHT * headDist) / fontPx;
                if (masks) {
                    const ownInk = masks.strokes[i] ? inkInRect(masks.strokes[i], box.x0, box.y0, box.x1, box.y1) : 0;
                    if (ownInk > 0) {
                        if (!allowOwn) continue;
                        cost += OWN_STROKE_WEIGHT;
                    }
                    let touched = 0;
                    masks.strokes.forEach((m, j) => {
                        if (j !== i && inkInRect(m, box.x0, box.y0, box.x1, box.y1) > 0) touched += 1;
                    });
                    cost += STROKE_WEIGHT * touched;
                    cost += (INK_WEIGHT * inkInRect(masks.union, box.x0, box.y0, box.x1, box.y1)) / area;
                }
                let covered = 0;
                for (const other of placed) covered += overlapArea(box, other);
                cost += (LABEL_WEIGHT * covered) / area;
                // Clarity: the other stroke whose centre line is closest to rivalling this
                // one's. Nearer outright → AMBIGUITY_COST; nearly as near → graded cost.
                let worstGap = Infinity;
                for (let j = 0; j < lines.length; j++) if (j !== i) worstGap = Math.min(worstGap, dist[j][c] - own);
                if (worstGap < -TIE_PX) cost += AMBIGUITY_COST;
                const margin = CLARITY_MARGIN * fontPx;
                if (worstGap < margin) cost += CLARITY_WEIGHT * (1 - Math.max(0, worstGap) / margin);
                found.push({ x: cx, y: cy, cost, covered, headDist });
            }
            return found;
        };

        // Widen only while nothing found is clear of the other numbers (see the header).
        // Each step's spots join the earlier steps' pool, so the tiebreak spans them all.
        const steps: [number, boolean][] = [[REACH * fontPx, false], [Infinity, false], [Infinity, true]];
        const pool: Candidate[] = [];
        let best: Candidate | null = null;
        for (const [reach, allowOwn] of steps) {
            pool.push(...search(reach, allowOwn));
            best = pickCandidate(pool);
            if (best && best.covered === 0) break;
        }

        // Every candidate off-cell (a cell smaller than a label): clamp the head inward.
        const chosen = best ?? {
            x: Math.min(size - halfW, Math.max(halfW, head[0])),
            y: Math.min(size - halfH, Math.max(halfH, head[1])),
        };
        placed.push(boxAt(chosen.x, chosen.y));
        out.push({ x: chosen.x, y: chosen.y });
    });
    return out;
}
