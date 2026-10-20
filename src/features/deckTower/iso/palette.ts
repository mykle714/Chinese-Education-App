/**
 * palette.ts — the iso art framework's colours (docs/ISO_ART_FRAMEWORK.md § "Palette").
 *
 * The "Good Job!" look is a strict three-family palette — a saturated warm yellow
 * environment, a mid cerulean ground, and cream "stuff" — each drawn in exactly three
 * flat tones: TOP (lightest, it faces the upper-left light), LEFT wall (mid) and RIGHT
 * wall (darkest). No gradients, no outlines.
 *
 * Every BASE colour below is a `COLORS` token. ⚠️ The wall tones are NOT: the framework
 * has no darker tier for `gld` / `bluMk` / `cardBeige` (v2 retired the ink tier), so the
 * walls are derived here with `shadeHex` — a divergence from the colour framework,
 * flagged in docs/ISO_ART_FRAMEWORK.md. If this style spreads past this page, the shades should
 * become real tokens in src/theme/colors.ts.
 *
 * Shadow colours are NOT in this table: a shadow takes its tone from the surface it
 * falls on (light.ts → `shadowTone`), so there is one rule rather than one entry per
 * receiver.
 *
 * Depended on by: every object component in this folder, light.ts, DeckTowerPage.tsx,
 * SpaceBackdrop.tsx (`space`, `star`, `mixHex`).
 */
import { COLORS } from "../../../theme/colors";

/** Hex → [h 0–360, s 0–1, l 0–1]. */
function hexToHsl(hex: string): [number, number, number] {
    const n = parseInt(hex.replace("#", ""), 16);
    const r = ((n >> 16) & 255) / 255;
    const g = ((n >> 8) & 255) / 255;
    const b = (n & 255) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const dlt = max - min;
    const s = l > 0.5 ? dlt / (2 - max - min) : dlt / (max + min);
    let h: number;
    if (max === r) h = (g - b) / dlt + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / dlt + 2;
    else h = (r - g) / dlt + 4;
    return [h * 60, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    const [r, g, b] =
        h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] :
        h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
    return `#${to(r)}${to(g)}${to(b)}`;
}

/**
 * Darkens (amount > 0) or lightens (amount < 0) a hex by moving its HSL lightness,
 * nudging saturation UP as it darkens. Plain mixing toward ink would grey the walls
 * out; the style's walls stay saturated (a darker ORANGE, not a muddier yellow).
 */
export function shadeHex(hex: string, amount: number): string {
    const [h, s, l] = hexToHsl(hex);
    const nl = Math.min(1, Math.max(0, l - amount));
    const ns = Math.min(1, s + Math.max(0, amount) * 0.35);
    return hslToHex(h, ns, nl);
}

/**
 * Blends hex `a` toward hex `b` by `t` (0 = a, 1 = b), channel by channel in sRGB. Used
 * for colours that change continuously (the Deck Tower's sky → space backdrop); the two
 * ends share a hue there, so plain RGB mixing does not grey out in the middle.
 */
export function mixHex(a: string, b: string, t: number): string {
    const na = parseInt(a.replace("#", ""), 16);
    const nb = parseInt(b.replace("#", ""), 16);
    const u = Math.min(1, Math.max(0, t));
    const ch = (shift: number) => {
        const ca = (na >> shift) & 255;
        const cb = (nb >> shift) & 255;
        return Math.round(ca + (cb - ca) * u).toString(16).padStart(2, "0");
    };
    return `#${ch(16)}${ch(8)}${ch(0)}`;
}

/** Three tones of one material. */
export interface Material {
    top: string;
    left: string;
    right: string;
}

const material = (base: string, left: number, right: number): Material => ({
    top: base,
    left: shadeHex(base, left),
    right: shadeHex(base, right),
});

/** A floating platform's colours: its three-tone slab and the light bevel round its top edge. */
export interface PlatformTone {
    material: Material;
    rim: string;
}

/**
 * The platform tones for one base colour — the shading the default (gold) platform has
 * always used, so a platform of any hue reads as the same material. The Deck Tower paints
 * each world's platform with it (src/features/deckTower/towerWorlds.ts).
 */
export function platformTone(base: string): PlatformTone {
    return { material: material(base, 0.07, 0.15), rim: shadeHex(base, -0.08) };
}

/**
 * Outer space over a sky: the sky's own hue taken down to a deep night tone, so a
 * sky → space blend keeps its hue the whole way. ⚠️ Derived, not a token: the framework
 * has no dark tier.
 */
export function spaceOver(sky: string): string {
    return shadeHex(sky, 0.55);
}

const GOLD_PLATFORM = platformTone(COLORS.gld);

export const ISO = {
    /** The sky the platform floats in. Good Job's own background cerulean ≈ `bluMk`. */
    sky: COLORS.bluMk,
    /**
     * Outer space, above the sky — the sky's own blue taken down to a deep navy (same
     * hue, so the sky → space blend stays blue all the way). ⚠️ Derived, not a token:
     * the framework has no dark blue.
     */
    space: spaceOver(COLORS.bluMk),
    /** The stars scattered over `space`. */
    star: COLORS.white,

    /** The floating platform — `gld` is the palette's one saturated warm yellow. */
    platform: GOLD_PLATFORM.material,
    /** The light bevel line around the platform's top edge. */
    platformRim: GOLD_PLATFORM.rim,

    /** A carpet zone — one solid fill a step darker than the floor it lies on. */
    carpet: material(shadeHex(COLORS.gld, 0.05), 0.06, 0.12),

    /** Card stock: cream top (the app's card face), beige walls. */
    card: { top: COLORS.cardFace, left: COLORS.cardBeige, right: shadeHex(COLORS.cardBeige, 0.07) } as Material,
    /** The seams between stacked cards on a stack's walls. */
    cardSeam: shadeHex(COLORS.cardBeige, 0.16),
    /** The light wireframe a ghosted card leaves where it stood (IsoCardRuns), softened by its own opacity. */
    ghostWire: COLORS.white,
    /** The inset panel printed on a card's face. */
    cardPanel: COLORS.cardBeige,
    /**
     * The coloured band across the card's head — Good Job's prop blue. A DEFAULT: an
     * object that prints a band takes a `bandColor` prop, so a page can paint it in its
     * deck's collection colour (the Deck Tower uses Learn Now's yellow).
     */
    cardBand: COLORS.bluMk,

    /**
     * Clouds (IsoCloud): a white top, walls shaded off white with `shadeHex` — the same
     * flagged divergence as the other wall tones (no darker-white tier in the framework).
     */
    cloud: material(COLORS.white, 0.06, 0.14),

    /** Wind gusts (IsoWind): flat white strokes, softened by IsoWind's own opacity. */
    wind: COLORS.white,

    /**
     * Smoke puffs (IsoSmokePuff): white, like the clouds. Flat discs (no walls), so one
     * tone — a puff is gone in well under a second.
     */
    smoke: COLORS.white,

    /**
     * A control that is NOT IN USE (IsoWallSlider `dimmed`): `RAMP.grey`'s inert surface
     * for its plate and its mark grey for the print.
     */
    inertPlate: COLORS.grey,
    inertInk: COLORS.greyA,

    /**
     * The focus lever (IsoLever): a cream base like card stock, an ink stick like the
     * pawns' silhouettes, and a red ball — Good Job's switch-knob red, `redMk` (the red
     * ramp's mark tier).
     */
    leverBase: { top: COLORS.cardFace, left: COLORS.cardBeige, right: shadeHex(COLORS.cardBeige, 0.07) } as Material,
    leverKnob: COLORS.redMk,

    /** Characters and printed text: pure ink silhouettes. */
    ink: COLORS.onSurface,
    white: COLORS.white,
} as const;
