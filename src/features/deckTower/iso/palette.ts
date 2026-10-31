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
import { mixHex, shadeHex } from "../../../theme/shadeHex";
import { slabRim } from "../../../theme/towerSlab";

export { mixHex, shadeHex };

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

/**
 * A solid painted in one band colour (a floor label plate): the band
 * on top, its walls stepped down like the platform's (the flagged `shadeHex` divergence).
 * Docs: docs/ISO_ART_FRAMEWORK.md § "IsoFloorLabel".
 */
export function bandMaterial(band: string): Material {
    return material(band, 0.07, 0.15);
}

/**
 * The material of the body under a floor — what a hole in it is lined with (IsoHatch
 * `inside`). A scene passes the slab's own material (the Deck Tower: its
 * world's `platform.material`), so the inside of a hole is the platform's own wall tones.
 * Without one, the floor's colour stepped down like a slab's walls.
 */
export function insideMaterial(floor: string, inside?: Material): Material {
    return inside ?? material(floor, 0.1, 0.18);
}

/**
 * A slab cut from the floor itself (IsoHatch's lift): the
 * floor's own colour on top, so flush it melts into the floor with no seam, and the walls
 * of the body it was cut from (`insideMaterial`).
 */
export function floorSlabMaterial(floor: string, inside?: Material): Material {
    const m = insideMaterial(floor, inside);
    return { top: floor, left: m.left, right: m.right };
}

/**
 * The inside of an open floor hole (IsoHatch): its far walls, which face
 * the viewer the way the slab's own outer walls do — so the slab's darker (right) wall
 * tone, the same hue as the platform rather than a shade derived off the floor.
 */
export function holeTone(floor: string, inside?: Material): string {
    return insideMaterial(floor, inside).right;
}

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
    return { material: material(base, 0.07, 0.15), rim: slabRim(base) };
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
    card: { top: COLORS.cardFace, left: COLORS.cardBeige, right: COLORS.cardWall } as Material,
    /** The seams between stacked cards on a stack's walls. */
    cardSeam: shadeHex(COLORS.cardBeige, 0.16),
    /** The light wireframe a ghosted card leaves where it stood (IsoCardRuns), softened by its own opacity. */
    ghostWire: COLORS.white,
    /** The inset panel printed on a card's face. */
    cardPanel: COLORS.cardBeige,
    /**
     * The coloured band across the card's head — Good Job's prop blue. A DEFAULT: an
     * object that prints a band takes a `bandColor` prop, so a page can paint it in its
     * deck's collection colour (the Deck Tower uses Learning's yellow).
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
     * The focus lever (IsoLever): a cream base like card stock, an ink stick like the
     * pawns' silhouettes, and a red ball — Good Job's switch-knob red, `redMk` (the red
     * ramp's mark tier).
     */
    leverBase: { top: COLORS.cardFace, left: COLORS.cardBeige, right: COLORS.cardWall } as Material,
    leverKnob: COLORS.redMk,

    /**
     * The mode switch's body (IsoModeSwitch — currently unused): the framework's mid grey (`greyA`, the
     * grey rung's mark) so both band paddles — Mix's light yellow especially — stand off it,
     * with walls shaded off it like the clouds' (the same flagged `shadeHex` divergence).
     */
    switchBase: material(COLORS.greyA, 0.08, 0.16),

    /** Characters and printed text: pure ink silhouettes. */
    ink: COLORS.onSurface,
    white: COLORS.white,
} as const;
