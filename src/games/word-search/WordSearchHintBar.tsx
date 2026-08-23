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
 * top of the play panel (docs/SHELF_REDESIGN.md § 13).
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
 * The charges are dots rather than the old eight-segment meter with a threshold line.
 * With `HINT_COST` at 1 the threshold was always after the first segment, so the meter was
 * already just "how many hints you have" drawn as a gauge — dots say that directly, and
 * the count is small enough to read at a glance without counting.
 *
 * Layer: presentational. Arming and spending live in `WordSearchPage`.
 * See docs/WORD_SEARCH_GAME.md §5a.
 */
const WordSearchHintBar: React.FC<WordSearchHintBarProps> = ({ units, ready, onHint, children }) => {
    // Charges are capped at the bar's width; a full bar simply stops filling.
    const banked = Math.min(units, HINT_BAR_UNITS);

    return (
        <Box
            className="word-search__hint-bar"
            sx={{
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                gap: "11px",
                padding: "11px 15px",
                borderBottom: `1px solid ${COLORS.rowBorder}`,
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
                    flexShrink: 0,
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
                <Icon name="lightbulb" size={16} color={COLORS.warnInk} fill={ready ? 1 : 0} />
                Hint
            </Box>

            {/* `.chg` — one dot per banked charge, the rest spent/empty. */}
            <Box
                className="word-search__hint-charges"
                aria-label={`${banked} hint${banked === 1 ? "" : "s"} banked`}
                sx={{ display: "flex", gap: "4px", flexShrink: 0 }}
            >
                {Array.from({ length: HINT_BAR_UNITS }).map((_, i) => {
                    const filled = i < banked;
                    return (
                        <Box
                            key={i}
                            className={`word-search__hint-charge${filled ? " word-search__hint-charge--filled" : " word-search__hint-charge--used"}`}
                            sx={{
                                width: "7px",
                                height: "7px",
                                borderRadius: "50%",
                                backgroundColor: filled ? COLORS.warnInk : COLORS.border,
                                transition: "background-color 150ms linear",
                            }}
                        />
                    );
                })}
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
