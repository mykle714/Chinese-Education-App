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
 * A card UNDER the top one in a short coloured deck: the card colour stepped down,
 * alternating by layer index `k` so the seams between layers read.
 * ⚠️ UNUSED since 2026-11-09: acp's bins (SortBins.tsx → `SortBin`), its last caller,
 * switched their decks to cream card stock. The Deck Tower's mini sort platform
 * (IsoSortPlatform) does not use it either. Delete if nothing picks it up.
 */
export function deckUnderLayerMaterial(color: string, k: number): Material {
    return {
        top: shadeHex(color, 0.2),
        left: shadeHex(color, k % 2 ? 0.1 : 0.15),
        right: shadeHex(color, k % 2 ? 0.18 : 0.23),
    };
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

/**
 * Settled snow (IsoSnowCap and the Deck Tower's floor snow, docs/TOWER_SNOW.md): the scene's
 * washed `snow` white on top, its walls stepped down by the platform's own 0.07 / 0.15, so
 * a cap reads as a slab with thickness (the owner asked for thickness; at half steps the
 * walls vanished into the white top). ⚠️ Derived from `ISO.snow` (`COLORS.white`) by `shadeHex`, like
 * every wall tone in the framework; there is no snow token.
 */
export function snowMaterial(snow: string): Material {
    return material(snow, 0.07, 0.15);
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
    /** The sky the platform floats in — the main world's day sky (towerWorlds.ts uses each world's own). */
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

    /** Card stock: cream top (the app's card face), beige walls. */
    card: { top: COLORS.cardFace, left: COLORS.cardBeige, right: COLORS.cardWall } as Material,
    /** The seams between stacked cards on a stack's walls. */
    cardSeam: shadeHex(COLORS.cardBeige, 0.16),
    /**
     * Notebook paper (IsoPaperStack — the Writing Notebook's stack on the writing world's
     * platform): white sheets, walls shaded off white like the clouds' (the same flagged
     * `shadeHex` divergence — the framework has no darker-white tier), a seam a step
     * darker, sky-blue rules (`bluMk`, the blue ramp's mark) and a red margin line (`redMk`,
     * the red ramp's mark — the focus lever's knob red).
     */
    paper: material(COLORS.white, 0.06, 0.14),
    paperSeam: shadeHex(COLORS.white, 0.2),
    paperRule: COLORS.bluMk,
    paperMargin: COLORS.redMk,
    /**
     * The white an iso solid's rounded-edge RIM LIGHT mixes into its top (IsoSolid →
     * `roundedEdge`, theme/roundedEdge.ts). A palette entry rather than a bare
     * `COLORS.white` so the time-of-day wash dims it with everything else — an unwashed
     * white rim would glow on a night platform.
     */
    edgeLight: COLORS.white,
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

    /**
     * The rare red balloon (IsoBalloon) that sometimes drifts by in place of a cloud:
     * `redMk`, the red ramp's mark (the focus lever's knob red), its two darker tones
     * stepped down with `shadeHex` — the same flagged divergence as every other wall tone.
     * Its string is `ink`.
     */
    balloon: material(COLORS.redMk, 0.1, 0.22),

    /** Wind gusts (IsoWind): flat white strokes, softened by IsoWind's own opacity. */
    wind: COLORS.white,

    /**
     * Smoke puffs (IsoSmokePuff): white, like the clouds. Flat discs (no walls), so one
     * tone — a puff is gone in well under a second.
     */
    smoke: COLORS.white,

    /**
     * Weather (WeatherLayer.tsx, docs/DECK_TOWER.md § "Weather"): rain streaks, snowflakes,
     * the fog sheets over the platform (IsoFog) and the lightning flash are all flat white, softened by the layer's own
     * opacities (no gradients — the iso style has none). The sky's colour under weather is
     * a separate design (docs/TOWER_WEATHER_SKY.md).
     */
    rain: COLORS.white,
    snow: COLORS.white,
    fog: COLORS.white,
    lightning: COLORS.white,

    /**
     * The focus lever (IsoLever): a cream base like card stock, an ink stick like the
     * pawns' silhouettes, and a red ball — Good Job's switch-knob red, `redMk` (the red
     * ramp's mark tier).
     */
    leverBase: { top: COLORS.cardFace, left: COLORS.cardBeige, right: COLORS.cardWall } as Material,
    leverKnob: COLORS.redMk,

    /** Characters and printed text: pure ink silhouettes. */
    ink: COLORS.onSurface,
    white: COLORS.white,
    /**
     * The night vest a pawn can wear (IsoPawn `vest` — the flp's hint pawn after dark,
     * docs/HINT_PAWN.md § "Night vest"): neon hi-viz cloth and pale grey reflective
     * stripes (`grey`, the achromatic rung's light member, standing in for silver tape).
     */
    vest: COLORS.hiViz,
    vestStripe: COLORS.grey,
    /**
     * The knitting idle's yarn — the ball on the floor and the scarf on the needles
     * (PawnIdleProps → PawnKnitting, docs/HINT_PAWN.md § "Idle animations"). The red ramp's
     * mark, as the lever knob: a saturated accent that reads against both the ink body and
     * every world's platform.
     */
    yarn: COLORS.redMk,
} as const;
