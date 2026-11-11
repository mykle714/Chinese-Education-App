/**
 * Canvas text measurement — for SVG text that has to be laid out by hand (wrapped,
 * centred, set on a CSS-equivalent baseline) because SVG has no line layout of its own.
 *
 * One shared 2D context. Where canvas is unavailable (jsdom tests, SSR) every measure
 * falls back to an average-glyph estimate, so callers never branch.
 *
 * Users: MiniCardSvg (the SVG mini card face, via miniCardSvgLayout.ts), SortBins (the
 * speech bubble's wrap), memory-map glyphShapes (`resolveFontFamily`).
 */

/** A font as the measurer needs it. `family` may be a `var(--x, fallback)` token (FONTS.cjk). */
export interface FontSpec {
    family: string;
    sizePx: number;
    weight: number;
    italic?: boolean;
    /** CSS font-stretch keyword (cpcd pinyin is `condensed`). Ignored where canvas lacks it. */
    stretch?: CanvasFontStretch;
}

/** The font's ascent/descent in px — the box CSS centres in a line box (its "content area"). */
export interface LineMetrics {
    ascent: number;
    descent: number;
}

let context: CanvasRenderingContext2D | null | undefined;
function measureContext(): CanvasRenderingContext2D | null {
    if (context === undefined) {
        try {
            context = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
        } catch {
            context = null; // jsdom without the canvas package throws "not implemented"
        }
    }
    return context;
}

/**
 * Resolve a `var(--name, fallback)` family token to a concrete stack: canvas cannot read
 * CSS custom properties. Reads the live value on `:root` (where useChineseFont writes
 * `--cjk-font`), else the var()'s own fallback. A plain stack comes back unchanged.
 * ⚠️ Sees only a `:root`-level override — a `--cjk-font` set on a container (the font
 * lab's specimen columns) is not visible here.
 */
export function resolveFontFamily(family: string): string {
    const m = /^var\((--[\w-]+)\s*,\s*(.*)\)$/.exec(family.trim());
    if (!m) return family;
    const live = typeof document !== "undefined"
        ? getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim()
        : "";
    return live || m[2];
}

/**
 * Point the context at `font`. Measured at the real size (not scaled from 100px) so any
 * size-dependent hinting matches what the page renders.
 */
function applyFont(ctx: CanvasRenderingContext2D, font: FontSpec): void {
    ctx.font = `${font.italic ? "italic " : ""}${font.weight} ${font.sizePx}px ${resolveFontFamily(font.family)}`;
    // `fontStretch` is a newer context property (Chrome 99, Safari 17); skipped where absent.
    if ("fontStretch" in ctx) ctx.fontStretch = font.stretch ?? "normal";
}

/** The advance width of `text` in px. */
export function measureAdvance(text: string, font: FontSpec): number {
    if (!text) return 0;
    const ctx = measureContext();
    if (!ctx) return [...text].length * font.sizePx * 0.55;
    applyFont(ctx, font);
    return ctx.measureText(text).width;
}

/**
 * The font's ascent and descent in px (`fontBoundingBox*`, the same metrics CSS builds a
 * line's content area from). Falls back to a 0.88 / 0.12 em split where unsupported.
 */
export function fontLineMetrics(font: FontSpec): LineMetrics {
    const ctx = measureContext();
    if (ctx) {
        applyFont(ctx, font);
        const m = ctx.measureText("中Hg");
        if (m.fontBoundingBoxAscent != null && (m.fontBoundingBoxAscent > 0 || m.fontBoundingBoxDescent > 0)) {
            return { ascent: m.fontBoundingBoxAscent, descent: m.fontBoundingBoxDescent };
        }
    }
    return { ascent: font.sizePx * 0.88, descent: font.sizePx * 0.12 };
}

/**
 * Where the alphabetic baseline sits below the TOP of a CSS line box `lineHeightPx` tall:
 * CSS centres the content area (ascent + descent) in the line box, splitting the leftover
 * — possibly negative, for a tall CJK em box at line-height ~1.2 — evenly above and below.
 * (memory-map glyphShapes does the same sum for a 1em box.)
 */
export function baselineInLineBox(lineHeightPx: number, metrics: LineMetrics): number {
    return (lineHeightPx - (metrics.ascent + metrics.descent)) / 2 + metrics.ascent;
}
