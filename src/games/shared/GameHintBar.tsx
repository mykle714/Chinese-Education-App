import React from "react";
import { Box } from "@mui/material";
import Icon from "../../components/Icon";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { LEADING } from "../../theme/scale";

interface GameHintBarProps {
    /**
     * BEM block the row's class names hang off (`${classPrefix}__hint-bar`, `__hint-btn`,
     * `__hint-charges`, …), so each game keeps its own selectors: "word-search",
     * "writing-grid".
     */
    classPrefix: string;
    /** How many charges are currently banked (clamped to 0..maxUnits for drawing). */
    units: number;
    /** Width of the charge meter: one bar per unit the game can bank. */
    maxUnits: number;
    /** True when pressing the button does something right now (the game decides). */
    ready: boolean;
    /** The press. Word Search spends a charge; Writing Grid toggles its offering menu. */
    onHint: () => void;
    /**
     * The button controls a menu that is currently OPEN (Writing Grid's offerings). Drawn
     * as the app's selected state — an ink ring — and announced via `aria-expanded`.
     * Omit for a button that acts on its own (Word Search).
     */
    expanded?: boolean;
    /** The row's left-hand slot: what the hint bought (Word Search) or the offerings (Writing Grid). */
    children?: React.ReactNode;
}

/**
 * `.hintbar` — a game's hint control, its charges, and a left-hand slot, on ONE row at
 * the BOTTOM of the play panel (docs/SHELF_REDESIGN.md § 13).
 *
 * Shared by Word Search (docs/WORD_SEARCH_GAME.md § 5a — the slot holds the reveal) and
 * Writing Grid (docs/WRITING_PRACTICE_REWORK.md § 2 "Hints" — the slot holds the offering
 * menu, `WritingGridHintMenu`). Moved here from `word-search/WordSearchHintBar.tsx` on
 * 2026-11-17 so the two games' hint buttons are one control, in one place.
 *
 * WHY THESE THINGS ARE ONE ROW. You bank charges by playing, you spend them, you get
 * help — a single mechanic. The row states it in one place: what you bought (or can
 * buy) on the left, and on the right the button with its charges under it (the button
 * sits on the right, in right-thumb reach — swapped 2026-11-10).
 *
 * The charges are a row of short bars directly UNDER the button, spanning its width —
 * one bar per `maxUnits` slot, filled = banked — so they read as the button's own fuel
 * gauge rather than a separate widget in the row.
 *
 * Layer: presentational. Banking and spending live in each game's Stage / hook.
 */
const GameHintBar: React.FC<GameHintBarProps> = ({ classPrefix, units, maxUnits, ready, onHint, expanded, children }) => {
    // Charges are capped at the bar's width; a full bar simply stops filling.
    const banked = Math.max(0, Math.min(units, maxUnits));
    // A banked charge is an INK bar (`#ws .hintbar .chg i{background:var(--ink)}` in v2).
    const chargeInk = COLORS.onSurface;

    return (
        <Box
            className={`${classPrefix}__hint-bar`}
            sx={{
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                gap: "11px",
                padding: "11px 15px",
                // Divider on TOP: the row is the last thing in the play panel, under the
                // board, so the hairline separates it from the board above.
                borderTop: `1px solid ${COLORS.rowBorder}`,
            }}
        >
            {/* `.rv` — the left-hand slot. It takes the row's spare width and is allowed to
                shrink, so long content crowds itself rather than the button. */}
            <Box
                className={`${classPrefix}__hint-reveal`}
                sx={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center" }}
            >
                {children}
            </Box>

            {/* `.hb` + `.chg` stacked: the button, and under it the banked charges as a row
                of bars exactly as wide as the button (the bars are `flex: 1` with
                `minWidth: 0`, so they contribute no intrinsic width). */}
            <Box
                className={`${classPrefix}__hint-control`}
                sx={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: "4px", flexShrink: 0 }}
            >
                {/* `.hb` — the button. Disabled state is opacity + an inert handler rather
                    than a different shape, so the control never moves as it arms. */}
                <Box
                    className={`${classPrefix}__hint-btn${ready ? ` ${classPrefix}__hint-btn--ready` : ""}${expanded ? ` ${classPrefix}__hint-btn--expanded` : ""}`}
                    onClick={ready ? onHint : undefined}
                    role="button"
                    aria-label="Use a hint"
                    aria-disabled={!ready || undefined}
                    aria-expanded={expanded}
                    sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: "5px",
                        fontFamily: FONTS.sans,
                        fontSize: 12.5,
                        fontWeight: 600,
                        lineHeight: LEADING.none,
                        padding: "7px 11px 7px 9px",
                        borderRadius: "11px",
                        // Open menu = the selected state: the outline turns ink and an inset
                        // ring thickens it (CLAUDE.md "Buttons & cards" — selected tiles
                        // show a stronger ink ring instead of the --line2 hairline).
                        border: `1px solid ${expanded ? COLORS.onSurface : COLORS.border}`,
                        boxShadow: expanded ? `inset 0 0 0 1px ${COLORS.onSurface}` : "none",
                        backgroundColor: COLORS.white,
                        color: COLORS.onSurface,
                        opacity: ready ? 1 : 0.4,
                        cursor: ready ? "pointer" : "default",
                        transition: "opacity 150ms linear",
                    }}
                >
                    {/* Black, not gold: the arm state is already carried by the glyph's FILL
                        axis and the button's opacity. */}
                    <Icon name="lightbulb" size={16} color={COLORS.onSurface} fill={ready ? 1 : 0} />
                    Hint
                </Box>

                {/* `.chg` — one bar per charge slot, filled = banked, the rest empty.
                    Deliberately NOT faded with the button's disarmed opacity: the count is
                    information the player needs most exactly when they cannot hint. */}
                <Box
                    className={`${classPrefix}__hint-charges`}
                    aria-label={`${banked} hint${banked === 1 ? "" : "s"} banked`}
                    sx={{ display: "flex", gap: "2px" }}
                >
                    {Array.from({ length: maxUnits }).map((_, i) => {
                        const filled = i < banked;
                        return (
                            <Box
                                key={i}
                                className={`${classPrefix}__hint-charge ${classPrefix}__hint-charge--${filled ? "filled" : "used"}`}
                                sx={{
                                    flex: 1,
                                    minWidth: 0,
                                    height: "3px",
                                    borderRadius: "1.5px",
                                    backgroundColor: filled ? chargeInk : COLORS.border,
                                    transition: "background-color 150ms linear",
                                }}
                            />
                        );
                    })}
                </Box>
            </Box>
        </Box>
    );
};

export default GameHintBar;
