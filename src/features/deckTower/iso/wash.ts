import { ISO, mixHex, type Material, type PlatformTone } from "./palette";

/**
 * wash.ts — the iso framework's AMBIENT WASH: one colour transform laid over every
 * colour a scene paints, so a whole scene can be lit for a time of day (dawn's pink,
 * sunset's orange, night's dim blue) without any object knowing about it
 * (docs/ISO_ART_FRAMEWORK.md § "Ambient wash").
 *
 * The rule (one place it is applied, so nothing is washed twice):
 *   - IsoScene takes a `wash` and hands every object the WASHED palette through
 *     `useIsoPalette()` (sceneContext.ts). An object reads its constants from that, never
 *     from `ISO` directly.
 *   - Colours a CALLER passes in (a platform tone, a floor surface, a plate's band) are
 *     the caller's to wash first (`washHex` / `washMaterial` / `washTone`). Primitives
 *     (IsoSolid, IsoShadow) paint what they are given.
 *   - A shadow takes its tone from its (already-washed) receiver, so shadows follow.
 *
 * Also the OKLCH conversions both the wash and the Deck Tower's derived skies use:
 * perceptual lightness and a hue angle, so "darker" and "toward pink" behave the same
 * on every hue (an sRGB mix of blue toward orange greys out; a hue turn does not).
 *
 * Depends on: palette.ts. Depended on by: IsoScene.tsx, sceneContext.ts, and the Deck
 * Tower's timeOfDay.ts (which builds the wash and the skies) and DeckTowerPage.tsx (which
 * lays `washColorMatrix` over the flp session).
 */

/** A colour transform laid over a scene. The identity (`NO_WASH`) leaves it as drawn. */
export type IsoWash = (hex: string) => string;

export const NO_WASH: IsoWash = (hex) => hex;

// ── OKLCH ──────────────────────────────────────────────────────────────────────────
// Björn Ottosson's Oklab, in its polar (L, C, h) form — the space src/theme/colors.ts
// specifies its tokens in. sRGB out of gamut is clipped per channel, as the tokens are.

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** Hex → [L 0–1, C ≥ 0, h 0–360]. */
export function hexToOklch(hex: string): [number, number, number] {
    const n = parseInt(hex.replace("#", ""), 16);
    const r = toLinear(((n >> 16) & 255) / 255);
    const g = toLinear(((n >> 8) & 255) / 255);
    const b = toLinear((n & 255) / 255);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    return [L, Math.hypot(A, B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360];
}

/** [L, C, h] → hex, each sRGB channel clipped to the gamut. */
export function oklchToHex(L: number, C: number, h: number): string {
    const a = C * Math.cos((h * Math.PI) / 180);
    const b = C * Math.sin((h * Math.PI) / 180);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const rgb = [
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ];
    const to = (v: number) =>
        Math.round(Math.min(1, Math.max(0, toGamma(Math.min(1, Math.max(0, v))))) * 255)
            .toString(16)
            .padStart(2, "0");
    return `#${rgb.map(to).join("")}`;
}

/** The signed shortest turn from hue `from` to hue `to`, degrees (−180, 180]. */
export function hueTurn(from: number, to: number): number {
    return ((to - from + 540) % 360) - 180;
}

// ── The wash ───────────────────────────────────────────────────────────────────────

/**
 * One light's wash: first an sRGB mix `amount` of the way toward `toward` (its colour
 * cast — this is what warms near-white card stock, which has no hue to turn), then the
 * result's OKLCH lightness scaled down by `dim` (dimming keeps the hue, so a dim gold
 * stays a darker orange instead of going olive).
 */
export interface WashLight {
    toward: string;
    amount: number;
    dim: number;
}

/** The colour transform of one light. `amount` 0 and `dim` 0 is the identity. */
export function lightWash(light: WashLight): IsoWash {
    if (light.amount <= 0 && light.dim <= 0) return NO_WASH;
    return (hex) => {
        const cast = mixHex(hex, light.toward, light.amount);
        if (light.dim <= 0) return cast;
        const [L, C, h] = hexToOklch(cast);
        return oklchToHex(L * (1 - light.dim), C, h);
    };
}

/**
 * A wash part-way between two lights: each colour washed by both, then mixed `t` of the
 * way from `a`'s result to `b`'s — exact at both ends, so a gradual change of light never
 * jumps. Results are memoised (a scene asks for the same few dozen colours every frame).
 */
export function blendWash(a: IsoWash, b: IsoWash, t: number): IsoWash {
    if (t <= 0 && a === NO_WASH) return NO_WASH;
    if (t >= 1 && b === NO_WASH) return NO_WASH;
    const cache = new Map<string, string>();
    return (hex) => {
        let out = cache.get(hex);
        if (out === undefined) {
            out = t <= 0 ? a(hex) : t >= 1 ? b(hex) : mixHex(a(hex), b(hex), t);
            cache.set(hex, out);
        }
        return out;
    };
}

export function washMaterial(m: Material, wash: IsoWash): Material {
    return { top: wash(m.top), left: wash(m.left), right: wash(m.right) };
}

export function washTone(tone: PlatformTone, wash: IsoWash): PlatformTone {
    return { material: washMaterial(tone.material, wash), rim: wash(tone.rim) };
}

/** The framework's palette (`ISO`), every colour in it washed. */
export type IsoPalette = typeof ISO;

/** `ISO` with every colour — plain or a material's three tones — washed. */
export function washPalette(wash: IsoWash): IsoPalette {
    if (wash === NO_WASH) return ISO;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(ISO)) {
        out[key] = typeof value === "string" ? wash(value) : washMaterial(value as Material, wash);
    }
    return out as IsoPalette;
}

// ── The wash on DOM content ────────────────────────────────────────────────────────

/** SVG's `saturate` matrix (Filter Effects § feColorMatrix): greys are its fixed points. */
function saturateMatrix(s: number): number[][] {
    return [
        [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s],
        [0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s],
        [0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s],
    ];
}

const hexChannels = (hex: string): number[] => {
    const n = parseInt(hex.replace("#", ""), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255);
};

/** The fit's sample colours: the sRGB cube at 0, ½ and 1 per channel (27 colours). */
const FIT_SAMPLES: number[][] = [0, 0.5, 1].flatMap((r) => [0, 0.5, 1].flatMap((g) => [0, 0.5, 1].map((b) => [r, g, b])));
const toHex = (c: number[]) => `#${c.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;

/**
 * A wash as an SVG `feColorMatrix` (`type="matrix"`, its 20 `values`), for content that is
 * not drawn by the iso kit — HTML laid over a washed scene (the Deck Tower's flp session,
 * docs/ISO_ART_FRAMEWORK.md § "Ambient wash" → "DOM content"). `null` for the identity.
 * The filter must run with `color-interpolation-filters="sRGB"` (the wash is defined on
 * sRGB hex, not linear light).
 *
 * A wash is not affine (its dim scales OKLCH lightness, keeping chroma), so the matrix is
 * an approximation, built in two parts:
 *   1. Per channel, the affine map through the wash's own black and white: EXACT on every
 *      grey and near-grey — card stock and ink, which must match the iso cards beside them.
 *   2. Before it, a `saturate(s)`, which leaves greys alone: an affine dim also drains
 *      chroma, which the wash keeps, so `s` (≥ 1) is fitted by least squares over the sRGB
 *      cube to give it back. At night this halves the error on saturated colours (tone
 *      colours, the plate's yellow) against s = 1.
 */
export function washColorMatrix(wash: IsoWash): string | null {
    if (wash === NO_WASH) return null;
    const lo = hexChannels(wash("#000000"));
    const span = hexChannels(wash("#FFFFFF")).map((hi, i) => hi - lo[i]);
    const truth = FIT_SAMPLES.map((c) => hexChannels(wash(toHex(c))));
    const apply = (m: number[][], c: number[]) =>
        m.map((row, i) => Math.min(1, Math.max(0, lo[i] + span[i] * (row[0] * c[0] + row[1] * c[1] + row[2] * c[2]))));
    const error = (s: number) => {
        const m = saturateMatrix(s);
        return FIT_SAMPLES.reduce((sum, c, k) => sum + apply(m, c).reduce((e, v, i) => e + (v - truth[k][i]) ** 2, 0), 0);
    };
    // The error is unimodal in s: a ternary search over [1, 2].
    let a = 1;
    let b = 2;
    for (let i = 0; i < 40; i++) {
        const m1 = a + (b - a) / 3;
        const m2 = b - (b - a) / 3;
        if (error(m1) < error(m2)) b = m2;
        else a = m1;
    }
    const m = saturateMatrix((a + b) / 2);
    // Each colour row: [R G B A offset] — the saturate row scaled by the channel's span,
    // no alpha term, the channel's black as the offset. Alpha passes through.
    const rows = m.map((row, i) => [...row.map((v) => v * span[i]), 0, lo[i]]);
    return [...rows.flat(), 0, 0, 0, 1, 0].map((v) => +v.toFixed(4)).join(" ");
}
