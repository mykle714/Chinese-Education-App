import { HIGHLIGHT_PX } from "./constants";
import { MAP_FONT_WEIGHT, bowedChars, type MeasuredWord } from "./glyphShapes";

/**
 * The highlight an armed or marked word wears: its ring PLUS every pocket of water that
 * ring closes off, as ONE mask (docs/MEMORY_MAP_GAME.md § 2.3, "The highlight is one
 * canvas mask").
 *
 * ── WHY THE RING IS DRAWN HERE, NOT BY CSS ───────────────────────────────────
 * The ring used to be `-webkit-text-stroke` on the DOM spans, with only the pocket fill
 * coming from a canvas. That had two faults, both from the DOM and the canvas drawing
 * DIFFERENT rings:
 *   • Spikes. Chromium strokes HTML text with MITRE joins and ignores `stroke-linejoin`,
 *     so at 8px every sharp glyph corner shot a long point out of the outline.
 *   • Leftover specks. The canvas (round joins) judged which pockets were closed; where
 *     the DOM's spikes sealed a pocket the canvas thought open, it went unfilled.
 * Now the canvas draws the ring itself, with round joins, and the SAME bitmap decides
 * the pockets, so what is checked is exactly what is shown.
 *
 * ── WHAT A "POCKET" IS ───────────────────────────────────────────────────────
 * Water that cannot be reached from OUTSIDE the word without crossing ring or ink: the
 * counter of a large bold 口 / 日 / 回, a gap two characters' rings seal (owner,
 * 2026-11-04). Openings of about `CLOSE_GAP_PX` or less count as closed (owner: "small
 * tolerance"): where two rings only just touch, anti-aliasing leaves a line of
 * half-transparent pixels the eye reads as shut but a 50%-alpha threshold reads as open.
 *
 * ── HOW ──────────────────────────────────────────────────────────────────────
 *   1. Draw each character's stroke (2 × `HIGHLIGHT_PX`, round joins) and fill onto an
 *      offscreen canvas in the word node's OWN local frame (the same advance `x`,
 *      baseline and bow transform MemoryMapWord applies to its ink spans).
 *   2. `enclosedWater`: close the painted pixels by the tolerance, flood the water in
 *      from the border, and take every unpainted pixel it did not reach as pocket.
 *   3. Mask alpha = the stroke's own anti-aliased alpha (a smooth outer edge), and solid
 *      over the pockets plus 1 canvas px around them, so no translucent seam shows where
 *      a pocket meets the ring.
 * The ink copy is drawn on top in the DOM, so the mask covering the glyphs is harmless.
 *
 * The result is state-independent (the shape, not the colour), so it is computed once
 * per (measurement, size, bow, face) and cached; MemoryMapWord recolours it per state.
 *
 * Referenced by: src/games/memory-map/MemoryMapWord.tsx (ring layer);
 * src/__tests__/memoryMapHighlightMask.test.ts; docs/MEMORY_MAP_GAME.md § 2.3.
 */

/** Openings this wide or narrower (CSS px, world layer) are treated as closed. */
const CLOSE_GAP_PX = 2;

/**
 * Canvas pixels per world-layer CSS px. 3 = `MAX_ZOOM`, so even fully zoomed in each
 * canvas pixel is no larger than a screen pixel and the ring's edge stays crisp. (It was
 * 2 while the mask only filled pockets, whose edge hid under a CSS ring.)
 */
const RESOLUTION = 3;

/** Alpha above which a canvas pixel counts as painted (ring or ink). */
const PAINTED_ALPHA = 128;

export interface HighlightMask {
    /** A PNG whose alpha is the highlight (ring + pockets); used as a CSS `mask-image`. */
    dataUrl: string;
    /** Placement in the word node's local frame, CSS px (negative = outside the line box). */
    left: number;
    top: number;
    width: number;
    height: number;
}

/**
 * Per measurement (a font change re-measures, which drops the old entry via the WeakMap),
 * then per size/bow/face. `null` means the canvas failed; the caller falls back to a CSS
 * stroke so the word's state is still shown.
 */
const cache = new WeakMap<MeasuredWord, Map<string, HighlightMask | null>>();

export function highlightMaskFor(
    measured: MeasuredWord,
    fontPx: number,
    bow: number,
    family: string
): HighlightMask | null {
    let byKey = cache.get(measured);
    if (!byKey) {
        byKey = new Map();
        cache.set(measured, byKey);
    }
    const key = `${fontPx}|${bow}|${family}`;
    if (byKey.has(key)) return byKey.get(key) ?? null;
    let mask: HighlightMask | null = null;
    try {
        mask = computeHighlightMask(measured, fontPx, bow, family);
    } catch {
        // A canvas failure (no 2d context, tainted canvas): the caller falls back.
        mask = null;
    }
    byKey.set(key, mask);
    return mask;
}

function computeHighlightMask(
    measured: MeasuredWord,
    fontPx: number,
    bow: number,
    family: string
): HighlightMask | null {
    // Room around the 1em line box for the ring plus the bow's vertical travel.
    const pad = Math.ceil(HIGHLIGHT_PX + fontPx * 0.25 + 2);
    const cssW = measured.width * fontPx + pad * 2;
    const cssH = fontPx + pad * 2;
    const w = Math.ceil(cssW * RESOLUTION);
    const h = Math.ceil(cssH * RESOLUTION);
    if (w <= 0 || h <= 0) return null;

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;

    // ── 1. Paint ring + ink exactly where MemoryMapWord's spans sit ──────────
    const arc = bowedChars(measured, bow);
    ctx.font = `${MAP_FONT_WEIGHT} ${fontPx}px ${family}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.lineWidth = HIGHLIGHT_PX * 2;
    // Round joins AND caps: the reason this ring is drawn here at all (no spikes).
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.fillStyle = "#000";
    ctx.strokeStyle = "#000";
    const baselineY = measured.baseline * fontPx;
    measured.chars.forEach((c, i) => {
        // The span's CSS: left = c.x·fontPx, top = 0, transform-origin (ox, 50%),
        // transform translateY(dy) rotate(r). As a matrix about the origin:
        // T(left+ox, oy) · T(0, dy) · R(r) · T(−ox, −oy).
        const ox = arc[i].pivotOffsetEm * fontPx;
        const oy = fontPx / 2;
        ctx.setTransform(RESOLUTION, 0, 0, RESOLUTION, pad * RESOLUTION, pad * RESOLUTION);
        ctx.translate(c.x * fontPx + ox, oy + arc[i].dy * fontPx);
        ctx.rotate((arc[i].rotate * Math.PI) / 180);
        ctx.translate(-ox, -oy);
        ctx.strokeText(c.char, 0, baselineY);
        ctx.fillText(c.char, 0, baselineY);
    });

    const pixels = ctx.getImageData(0, 0, w, h).data;
    const painted = new Uint8Array(w * h);
    for (let p = 0; p < w * h; p++) painted[p] = pixels[p * 4 + 3] >= PAINTED_ALPHA ? 1 : 0;

    // ── 2. The pockets ───────────────────────────────────────────────────────
    const closeRadius = Math.max(1, Math.round((CLOSE_GAP_PX / 2) * RESOLUTION));
    const pockets = enclosedWater(painted, w, h, closeRadius);
    // Solid over each pocket and 1 canvas px into the ring around it, never outward.
    const solid = pockets ? dilate(pockets.grown, w, h, 1) : null;

    // ── 3. Mask = the ring's own alpha, solid over the pockets ───────────────
    const out = ctx.createImageData(w, h);
    for (let p = 0; p < w * h; p++) {
        const alpha = solid && solid[p] && !pockets!.reached[p] ? 255 : pixels[p * 4 + 3];
        out.data[p * 4] = 255;
        out.data[p * 4 + 1] = 255;
        out.data[p * 4 + 2] = 255;
        out.data[p * 4 + 3] = alpha;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.putImageData(out, 0, 0);

    return {
        dataUrl: canvas.toDataURL("image/png"),
        left: -pad,
        top: -pad,
        width: w / RESOLUTION,
        height: h / RESOLUTION,
    };
}

/**
 * The fill region for a painted (ring + ink) bitmap: every unpainted pixel that the
 * outside water cannot reach once openings of `2·closeRadius` px or less are sealed.
 *
 * Uses a morphological CLOSING (dilate, then erode by the same radius), not a bare
 * dilation. A bare dilation seals the openings but also swallows any pocket narrower
 * than the dilation, leaving it with no "hole" pixels at all, so the very smallest
 * pockets went unfilled. Closing seals the same openings, then gives the walls back
 * their real thickness; the flood runs over the closed walls, and everything it does
 * not reach and that is not paint (tiny pockets, sealed slivers) is fill.
 *
 * Returns null when nothing is enclosed. `reached` is the outside water, so the caller
 * can grow the fill without ever spilling outward.
 */
export function enclosedWater(
    painted: Uint8Array,
    w: number,
    h: number,
    closeRadius: number
): { grown: Uint8Array; reached: Uint8Array } | null {
    const closed = erode(dilate(painted, w, h, closeRadius), w, h, closeRadius);
    const reached = floodFromBorder(closed, w, h);
    const grown = new Uint8Array(w * h);
    let any = false;
    for (let p = 0; p < w * h; p++) {
        if (!reached[p] && !painted[p]) {
            grown[p] = 1;
            any = true;
        }
    }
    return any ? { grown, reached } : null;
}

/** Square erosion by `r`: the complement of dilating the complement. */
export function erode(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
    const inverse = new Uint8Array(w * h);
    for (let p = 0; p < w * h; p++) inverse[p] = src[p] ? 0 : 1;
    const grown = dilate(inverse, w, h, r);
    for (let p = 0; p < w * h; p++) grown[p] = grown[p] ? 0 : 1;
    return grown;
}

/**
 * Square (Chebyshev) dilation by `r`, separable into a horizontal then vertical pass,
 * each a sliding-window count so the cost is O(w·h) regardless of `r`.
 */
export function dilate(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
    const horizontal = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
        const row = y * w;
        let count = 0;
        // Prime the window [−r, r] around x = 0.
        for (let x = 0; x <= Math.min(r, w - 1); x++) count += src[row + x];
        for (let x = 0; x < w; x++) {
            horizontal[row + x] = count > 0 ? 1 : 0;
            const enter = x + r + 1;
            const leave = x - r;
            if (enter < w) count += src[row + enter];
            if (leave >= 0) count -= src[row + leave];
        }
    }
    const out = new Uint8Array(w * h);
    for (let x = 0; x < w; x++) {
        let count = 0;
        for (let y = 0; y <= Math.min(r, h - 1); y++) count += horizontal[y * w + x];
        for (let y = 0; y < h; y++) {
            out[y * w + x] = count > 0 ? 1 : 0;
            const enter = y + r + 1;
            const leave = y - r;
            if (enter < h) count += horizontal[enter * w + x];
            if (leave >= 0) count -= horizontal[leave * w + x];
        }
    }
    return out;
}

/** 4-connected flood over non-barrier pixels, seeded from every border pixel. */
export function floodFromBorder(barrier: Uint8Array, w: number, h: number): Uint8Array {
    const reached = new Uint8Array(w * h);
    const stack = new Int32Array(w * h);
    let top = 0;
    const seed = (p: number) => {
        if (!barrier[p] && !reached[p]) {
            reached[p] = 1;
            stack[top++] = p;
        }
    };
    for (let x = 0; x < w; x++) {
        seed(x);
        seed((h - 1) * w + x);
    }
    for (let y = 0; y < h; y++) {
        seed(y * w);
        seed(y * w + w - 1);
    }
    while (top > 0) {
        const p = stack[--top];
        const x = p % w;
        if (x > 0) seed(p - 1);
        if (x < w - 1) seed(p + 1);
        if (p >= w) seed(p - w);
        if (p < w * (h - 1)) seed(p + w);
    }
    return reached;
}
