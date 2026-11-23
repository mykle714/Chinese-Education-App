import type { SxProps, Theme } from "@mui/material";
import { COLORS, RAMP } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";
import { roundedEdgeFillet, roundedEdgeRimLight } from "../../theme/roundedEdge";
import { shadeHex } from "../../theme/shadeHex";
import { shadowInk } from "../../theme/shadows";

/**
 * Shared styling for the Sentence Tiles pages (docs/SENTENCE_TILES_GAME.md § "Pages").
 *
 * One hue: `moss`, a leafy green outside the v2 ramp (theme/colors.ts → COLORS.moss), worn by
 * nothing else. Tiles are drawn in the add-cards page's CARD STOCK look (acp,
 * features/discover/sortCardStock.ts): a cream face standing on a solid wall stepped down-right
 * along the iso (1, 1) vector, the hairline rounded edge on top, and — while a tile floats in
 * the rack — a near-solid cast shadow on the ground that reaches further and softens as the
 * tile is lifted. A tile set down on the board is GROUNDED: wall only, no cast shadow.
 *
 * The recipe is re-built here rather than imported because features/ are exclusive
 * (docs/FRONTEND_LAYERING.md § 1); the numbers are acp's, the wall a step thinner (3px, not
 * 4px) because a tile is half a mini card's size. Keep the two in step by hand.
 *
 * Depended on by: TileFace.tsx, DraggableRackTile.tsx, SentenceTilesBoard.tsx,
 * SentenceTilesPage.tsx, SentenceTilesGamePage.tsx.
 */

export const TILES_HUE = RAMP.moss;


/** Wall thickness, px (acp: 4 on a mini card). */
const TILE_WALL_PX = 3;
/** Cast shadow at rest (lift 0) and fully held (lift 1): y offset, blur, ink alpha. Rest = SHADOW.raised. */
const CAST_REST = { y: 3, blur: 10, alpha: 0.1 };
const CAST_HELD = { y: 10, blur: 24, alpha: 0.16 };
/** A held tile's scale — acp's HELD_CARD_SCALE. */
export const HELD_TILE_SCALE = 1.12;
export const TILE_RADIUS_PX = 7;

const WALL_STEPS = Array.from({ length: TILE_WALL_PX }, (_, i) => i + 1);

/** The wall under a face: cream faces stand on `cardWall`; tinted faces on their own colour one step darker. */
function wallFor(face: string): string {
    return face === COLORS.cardFace ? COLORS.cardWall : shadeHex(face, 0.12);
}

/**
 * A tile's whole box-shadow. `lift` null = grounded (on the board: no cast shadow);
 * 0…1 = floating over the rack, the shadow reaching further as it rises.
 */
export function tileStockShadow(face: string, lift: number | null): string {
    const wall = wallFor(face);
    const parts = [roundedEdgeRimLight(face), roundedEdgeFillet(face, wall), ...WALL_STEPS.map((k) => `${k}px ${k}px 0 ${wall}`)];
    if (lift !== null) {
        const mix = (a: number, b: number) => a + (b - a) * lift;
        const y = mix(CAST_REST.y, CAST_HELD.y).toFixed(2);
        const blur = mix(CAST_REST.blur, CAST_HELD.blur).toFixed(2);
        parts.push(`0 ${y}px ${blur}px ${shadowInk(Number(mix(CAST_REST.alpha, CAST_HELD.alpha).toFixed(3)))}`);
    }
    return parts.join(", ");
}

/** The face itself (no outline — the stock's edge is its wall, as acp's card stock). */
export function tileFaceSx(face: string = COLORS.cardFace): SxProps<Theme> {
    return { backgroundColor: face, borderRadius: `${TILE_RADIUS_PX}px` };
}

/** Space a tile needs right/below for its wall, so neighbours don't overlap it. */
export const TILE_WALL_ALLOWANCE_PX = TILE_WALL_PX;

/** A rounded pill button in the page's ink-on-pastel style. */
export function pillButtonSx(fill: string): SxProps<Theme> {
    return {
        height: 38,
        px: 2,
        borderRadius: "19px",
        border: `1px solid ${COLORS.border}`,
        backgroundColor: fill,
        color: COLORS.onSurface,
        fontFamily: FONTS.sans,
        fontSize: SIZE.body,
        fontWeight: WEIGHT.semibold,
        textTransform: "none",
        minWidth: 0,
        "&:hover": { backgroundColor: fill },
        "&.Mui-disabled": { opacity: 0.45, color: COLORS.onSurface },
    };
}

export const mutedTextSx: SxProps<Theme> = {
    fontFamily: FONTS.sans,
    fontSize: SIZE.body,
    color: COLORS.textSecondary,
    padding: "16px",
};

export const sectionLabelSx: SxProps<Theme> = {
    fontFamily: FONTS.sans,
    fontSize: SIZE.caption,
    fontWeight: WEIGHT.semibold,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: COLORS.textSecondary,
    padding: "18px 16px 6px",
};

/** "Small User" or "@small_user" — a player's display name. */
export function playerName(p: { name: string | null; username: string }): string {
    return p.name?.trim() || (p.username ? `@${p.username}` : "Your friend");
}
