import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";

/**
 * testerChipStyle.ts — the look of the Deck Tower's feature-tester chips: the framework's
 * frosted chip on a hued fill (`COLORS.frost`) with the app's outline (`COLORS.border`); a
 * selected chip is solid ink (CLAUDE.md § Buttons & cards — the solid-ink exception).
 *
 * Depended on by: TesterChipRow.tsx (the single-choice rows), LightningStrikeChips.tsx (the
 * action chips), so every tester chip on the page is the same chip; TesterSharedRow.tsx (the
 * row that holds several short groups, docs/DECK_TOWER.md § "Feature-tester rows").
 */

/** A disabled chip's opacity: still legible, clearly not tappable. */
const DISABLED_CHIP_OPACITY = 0.45;

/**
 * One tester chip's look — shared with the action-chip rows (LightningStrikeChips.tsx), so
 * every tester chip on the page is the same chip.
 */
export function testerChipSx(selected: boolean, disabled = false) {
    return {
        // 8px, not 10: two short groups have to share a ~343px row on a 375px phone
        // (TesterSharedRow.tsx; measured 2026-11-08).
        px: 1,
        py: 0.5,
        borderRadius: 999,
        fontFamily: FONTS.cjk,
        fontSize: SIZE.caption,
        fontWeight: WEIGHT.bold,
        color: selected ? COLORS.white : COLORS.onSurface,
        backgroundColor: selected ? COLORS.onSurface : COLORS.frost,
        border: selected ? `1px solid ${COLORS.onSurface}` : `1px solid ${COLORS.border}`,
        opacity: disabled ? DISABLED_CHIP_OPACITY : 1,
    } as const;
}

/** The row's layout, shared with the action-chip rows and TesterSharedRow. */
export const TESTER_ROW_SX = { display: "flex", justifyContent: "center", gap: 0.75, px: 2, pb: 1, flexWrap: "wrap" } as const;

/**
 * A chip group INSIDE a TesterSharedRow: the same chip spacing as a row, minus the row's
 * own gutter and bottom padding (the shared row supplies those once).
 */
export const TESTER_GROUP_SX = { display: "flex", justifyContent: "center", gap: 0.75, flexWrap: "wrap" } as const;
