import { FONTS } from "../theme/fonts";
import { WEIGHT } from "../theme/scale";

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
export const BACK_ARROW_PX = 24;

/** The `dense` header's top and side padding, px: the size the flp study headers use. */
export const DENSE_HEADER_PAD_TOP_PX = 23;
export const DENSE_HEADER_PAD_X_PX = 22;

/** The `dense` header's title size and tracking, shared with `GameFrame`'s exit title. */
export const DENSE_HEADER_TITLE_PX = 21;
export const DENSE_HEADER_TITLE_TRACKING = "-0.018em";

/**
 * The `hub` header's geometry (top padding, side padding, title size and tracking), for a
 * surface that must draw a header-shaped row with no `PageHeader` mounted: td's cards page
 * title row (`TowerCardsPage`), which takes over as the page header once it scrolls up to
 * the top (docs/DECK_TOWER.md § "The cards page"). A second `PageHeader` is not an option
 * there — each one runs its own minute-points tick.
 * Read by: `PageHeader` (SIZE_SPEC.hub), `TowerCardsPage`.
 */
export const HUB_HEADER_PAD_TOP_PX = 23;
export const HUB_HEADER_PAD_X_PX = 22;
export const HUB_HEADER_TITLE_PX = 28;
export const HUB_HEADER_TITLE_TRACKING = "-0.025em";

/** The gap between the back arrow and the title it is grouped with, px. */
export const BACK_GROUP_GAP_PX = 9;

/** The outlined audio chip's glyph and vertical padding, px (`AudioModeChip`). */
export const OUTLINED_CHIP_ICON_PX = 17;
export const OUTLINED_CHIP_PAD_Y_PX = 5;

/**
 * The outlined chip's label type, px — a step up from the filled header chip's 11.5 px now
 * that there is no fill to carry it.
 */
export const OUTLINED_CHIP_TEXT_PX = 14;

/**
 * The outlined chip's pill: a 1px outline in the chip's own `ink` (not `COLORS.border` —
 * the --line2 hairline is built for paper and goes muddy on a scene ground), pill ends like
 * the tower's plates. Shared by AudioModeChip's `outlined` skin and HeaderActionChip, so a
 * labelled action and the audio chip read as one family.
 */
export const outlinedChipSx = (ink: string) =>
    ({
        // 975 Maru SC — the app's Chinese face (`FONTS.cjk` → `--cjk-font`, set by
        // useChineseFont; its slices cover Latin), the same lettering as the Deck Tower's
        // study buttons (towerPlate.ts → TOWER_STUDY_FONT). Pinned at 400, the face's ONLY
        // cut, so nothing renders browser-synthesised bold: the acp's header layer sets
        // bold on everything under it (TOWER_TYPE_SX via `wrapHeader`).
        fontFamily: FONTS.cjk,
        fontWeight: WEIGHT.regular,
        border: `1px solid ${ink}`,
        borderRadius: "999px",
        padding: `${OUTLINED_CHIP_PAD_Y_PX}px 10px`,
        fontSize: OUTLINED_CHIP_TEXT_PX,
    }) as const;

/**
 * The tower study header's row height. Its tallest child is the outlined audio chip (glyph +
 * padding + a 1px outline each way), which beats the flame (26) and the title (25.2). The
 * row centres the arrow, so a taller chip would move the header's arrow: this derivation is
 * what keeps a game break's arrow on top of it.
 */
export const TOWER_STUDY_ROW_PX = OUTLINED_CHIP_ICON_PX + 2 * OUTLINED_CHIP_PAD_Y_PX + 2;

/** The tower study header's bottom edge, below the status bar. */
export const TOWER_STUDY_HEADER_BOTTOM_PX = DENSE_HEADER_PAD_TOP_PX + TOWER_STUDY_ROW_PX;

/** The top edge of the tower study header's back arrow, below the status bar. */
export const TOWER_STUDY_BACK_ARROW_TOP_PX = DENSE_HEADER_PAD_TOP_PX + (TOWER_STUDY_ROW_PX - BACK_ARROW_PX) / 2;
