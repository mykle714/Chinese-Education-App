import React from "react";
import { Box } from "@mui/material";
import Icon from "../../components/Icon";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { LEADING } from "../../theme/scale";
import { HINT_BAR_UNITS } from "./constants";

interface WordSearchHintBarProps {
    /** How many charges are currently banked (0..HINT_BAR_UNITS). */
    units: number;
    /** True when a hint can actually be spent right now — enough charges banked AND
     *  at least one word still unfound AND the run is live. */
    ready: boolean;
    /** Spend a charge (reveal the next unit of the least-hinted unfound word). */
    onHint: () => void;
    /** The reveal itself — `WordSearchHintRow`. Fills the row's right-hand slot. */
    children?: React.ReactNode;
}

/**
 * `.hintbar` — the hint control, its charges, and the current reveal, on ONE row at the
 * BOTTOM of the play panel, under the grid (docs/SHELF_REDESIGN.md § 13).
 *
 * WHY THESE THREE THINGS ARE NOW ONE COMPONENT. They used to be three, in three places:
 * the button in the page header, the meter absolutely centred in the HUD, the reveal on
 * its own row under the gloss list. They are a single mechanic — you bank charges by
 * finding words, you spend one, you get letters — and splitting them across the chrome
 * meant the player had to assemble that from three unrelated-looking widgets. Reading
 * left to right the row now states it: press this, you have this many, here is what you
 * bought.
 *
 * It also gets the button out of the page header, which is where the redesign wants only
 * settings-shaped controls (docs/SHELF_REDESIGN.md § A2b). A hint is a game ACTION, so it
 * belongs to the play panel with the rest of the game.
 *
 * The charges are a row of short bars directly UNDER the button, spanning its width —
 * one bar per `HINT_BAR_UNITS` slot, filled = banked. There is no threshold line (the old
 * eight-segment meter drew one after `HINT_COST` segments, which at `HINT_COST = 1` was
 * always after the first, so it said nothing). Sitting under the button, the bars read as
 * the button's own charge gauge rather than a separate widget in the row.
 *
 * Layer: presentational. Arming and spending live in `WordSearchPage`.
 * See docs/WORD_SEARCH_GAME.md §5a.
 */
const WordSearchHintBar: React.FC<WordSearchHintBarProps> = ({ units, ready, onHint, children }) => {
    // Charges are capped at the bar's width; a full bar simply stops filling.
    const banked = Math.min(units, HINT_BAR_UNITS);
    // A banked charge is an INK bar (`#ws .hintbar .chg i{background:var(--ink)}` in v2 —
    // it was the game's own purple ink in v1, a tier v2 removed).
    const chargeInk = COLORS.onSurface;

    return (
        <Box
            className="word-search__hint-bar"
            sx={{
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                gap: "11px",
                padding: "11px 15px",
                // Divider on TOP: the row is the last thing in the play panel, under
                // the grid, so the hairline separates it from the board above.
                borderTop: `1px solid ${COLORS.rowBorder}`,
            }}
        >
            {/* `.hb` + `.chg` stacked: the button, and under it the banked charges as a
                row of bars exactly as wide as the button. The column shrink-wraps to the
                button (the bars are `flex: 1` with `minWidth: 0`, so they contribute no
                intrinsic width), which makes the charge meter read as the button's own
                fuel gauge rather than a separate widget beside it. */}
            <Box
                className="word-search__hint-control"
                sx={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "stretch",
                    gap: "4px",
                    flexShrink: 0,
                }}
            >
                {/* `.hb` — the button. Disabled state is opacity + an inert handler rather
                    than a different shape, so the control never moves as it arms. */}
                <Box
                    className={`word-search__hint-btn${ready ? " word-search__hint-btn--ready" : ""}`}
                    onClick={ready ? onHint : undefined}
                    role="button"
                    aria-label="Use a hint"
                    aria-disabled={!ready || undefined}
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
                        border: `1px solid ${COLORS.border}`,
                        backgroundColor: COLORS.white,
                        color: COLORS.onSurface,
                        opacity: ready ? 1 : 0.4,
                        cursor: ready ? "pointer" : "default",
                        transition: "opacity 150ms linear",
                    }}
                >
                    {/* Black, not gold: the arm state is already carried by the glyph's FILL
                        axis and the button's opacity, and a third channel on the same 16px
                        icon just made the button look like a warning. */}
                    <Icon name="lightbulb" size={16} color={COLORS.onSurface} fill={ready ? 1 : 0} />
                    Hint
                </Box>

                {/* `.chg` — one bar per charge slot, filled = banked, the rest empty.
                    Deliberately NOT faded with the button's disarmed opacity: the count
                    is information the player needs most exactly when they cannot hint. */}
                <Box
                    className="word-search__hint-charges"
                    aria-label={`${banked} hint${banked === 1 ? "" : "s"} banked`}
                    sx={{ display: "flex", gap: "2px" }}
                >
                    {Array.from({ length: HINT_BAR_UNITS }).map((_, i) => {
                        const filled = i < banked;
                        return (
                            <Box
                                key={i}
                                className={`word-search__hint-charge${filled ? " word-search__hint-charge--filled" : " word-search__hint-charge--used"}`}
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

            {/* `.rv` — what the charges bought. Pushed to the right edge and allowed to
                shrink, so a long mask crowds itself rather than the button. */}
            <Box
                className="word-search__hint-reveal"
                sx={{ marginLeft: "auto", minWidth: 0, display: "flex", alignItems: "center" }}
            >
                {children}
            </Box>
        </Box>
    );
};

export default WordSearchHintBar;
