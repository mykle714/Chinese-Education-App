import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";

/**
 * The look of ONE cell on the card-operations rail (`.crail > div` in
 * `shelf-system.css`; artboard 21) — a glyph over a mono micro-caps label.
 *
 * Its own module rather than a constant inside `CardOpsRail` because a second component
 * once rendered one of the rail's cells (`AddToDeckMenu`, deleted with Decks on
 * 2026-11-04) and the two would otherwise have imported each other in a cycle.
 * `CardOpsRail` is now its only importer; folding it back in is safe.
 */
export const CARD_OPS_CELL_SX = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "3px",
    padding: "6px 9px 5px",
    borderRadius: "999px",
    border: "none",
    background: "none",
    cursor: "pointer",
    minWidth: 0,
    // The rail sits on the card, which is the flip/drag target — a cell must never
    // grow its own hit area beyond its box or a mistimed tap swipes the card.
    lineHeight: 1,
} as const;

/** The label under a cell's glyph. */
export const CARD_OPS_CELL_LABEL_SX = {
    fontStyle: "normal",
    fontFamily: FONTS.label,
    fontSize: 8,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    color: COLORS.iconColor,
    whiteSpace: "nowrap",
} as const;
