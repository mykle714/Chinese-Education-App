/**
 * The page header's back-arrow geometry, for a surface that must draw the same arrow in the
 * same place with no `PageHeader` mounted (`GameFrame`'s exit, the flp game break:
 * docs/FLP_GAME_BREAKS.md § 6). Kept in a component-free module so PageHeader.tsx and
 * GameFrame.tsx stay Fast Refresh boundaries, and so the two arrows cannot drift apart.
 *
 * Read by: `PageHeader` (SIZE_SPEC.dense, the back icon), `AudioModeChip` (the outlined skin),
 * `GameFrame` (`GameFrameExitButton`, `GameFrameExitTitle`).
 */

/** The lateral back arrow's Material Symbols glyph and size. */
export const BACK_ARROW_ICON = "arrow_back";
export const BACK_ARROW_PX = 21;

/** The `dense` header's top and side padding, px: the size the flp study headers use. */
export const DENSE_HEADER_PAD_TOP_PX = 23;
export const DENSE_HEADER_PAD_X_PX = 22;

/** The `dense` header's title size and tracking, shared with `GameFrame`'s exit title. */
export const DENSE_HEADER_TITLE_PX = 18;
export const DENSE_HEADER_TITLE_TRACKING = "-0.018em";

/** The gap between the back arrow and the title it is grouped with, px. */
export const BACK_GROUP_GAP_PX = 9;

/** The outlined audio chip's glyph and vertical padding, px (`AudioModeChip`). */
export const OUTLINED_CHIP_ICON_PX = 15;
export const OUTLINED_CHIP_PAD_Y_PX = 4;

/**
 * The tower study header's row height. Its tallest child is the outlined audio chip (glyph +
 * padding + a 1px outline each way), which beats the flame (22.5) and the title (21.6). The
 * row centres the arrow, so a taller chip would move the header's arrow: this derivation is
 * what keeps a game break's arrow on top of it.
 */
export const TOWER_STUDY_ROW_PX = OUTLINED_CHIP_ICON_PX + 2 * OUTLINED_CHIP_PAD_Y_PX + 2;

/** The tower study header's bottom edge, below the status bar. */
export const TOWER_STUDY_HEADER_BOTTOM_PX = DENSE_HEADER_PAD_TOP_PX + TOWER_STUDY_ROW_PX;

/** The top edge of the tower study header's back arrow, below the status bar. */
export const TOWER_STUDY_BACK_ARROW_TOP_PX = DENSE_HEADER_PAD_TOP_PX + (TOWER_STUDY_ROW_PX - BACK_ARROW_PX) / 2;
