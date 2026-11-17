import { Box, keyframes } from "@mui/material";
import { WRITING_LEVELS } from "../../../server/contracts/writingLevels";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { LEADING, SIZE, WEIGHT } from "../../theme/scale";
import { WRITING_GRID_HINTS } from "./constants";

interface WritingGridHintMenuProps {
    /** The menu is open (the Hint button was pressed). Closed = the slot is empty. */
    open: boolean;
    /** Points banked — an offering the learner cannot afford is drawn disarmed. */
    units: number;
    /** The offering chosen and waiting for a cell, by level; null = still choosing. */
    pickingLevel: number | null;
    /**
     * Some cell would be made easier by this offering's level. An offering with no such
     * cell (e.g. Memorize once every unfinished cell is already at Memorize or easier) is
     * disarmed like an unaffordable one, so points are never spent on a hint that does nothing.
     */
    hasTarget: (level: number) => boolean;
    /** An affordable offering was tapped: the Stage enters pick mode for it. */
    onChoose: (level: number) => void;
    /** The chosen offering was tapped again: back to choosing. */
    onUnchoose: () => void;
}

/** Each tile slides in from the Hint button, so the menu reads as opening leftward out of it. */
const slideFromButton = keyframes`
    from { opacity: 0; transform: translateX(14px); }
    to   { opacity: 1; transform: translateX(0); }
`;

/** Under-name cost bars: the same 3px charge-bar mark as the meter under the Hint button. */
const COST_BAR_WIDTH = 7;

/**
 * WritingGridHintMenu — the Writing Grid's hint offerings, in the left-hand slot of the
 * shared hint row (`GameHintBar`), right-aligned so the menu grows LEFTWARD out of the
 * Hint button (docs/WRITING_PRACTICE_REWORK.md § 2 "Hints").
 *
 *   choosing — one outlined tile per `WRITING_GRID_HINTS` offering: the level's name, and
 *              under it its cost as charge bars plus the number. The bars are the same
 *              mark as the meter under the Hint button, so "this costs 4 of those" reads
 *              without a legend. An unaffordable tile is disarmed (opacity), not hidden,
 *              so the menu never changes shape as points bank.
 *   picking  — the chosen tile alone, in the selected state (ink ring), with the
 *              instruction beside it. Tapping it again goes back to choosing; the Hint
 *              button closes everything (the Stage).
 *
 * Layer: presentational. Points, the open state and pick mode live in WritingGridStage.
 */
export default function WritingGridHintMenu({ open, units, pickingLevel, hasTarget, onChoose, onUnchoose }: WritingGridHintMenuProps) {
    if (!open) return null;
    const shown = pickingLevel === null ? WRITING_GRID_HINTS : WRITING_GRID_HINTS.filter((h) => h.level === pickingLevel);

    return (
        <Box
            className="writing-grid__hint-menu"
            role="menu"
            sx={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "8px" }}
        >
            {pickingLevel !== null && (
                <Box
                    component="span"
                    className="writing-grid__hint-menu-instruction"
                    sx={{
                        minWidth: 0,
                        fontSize: SIZE.body,
                        fontWeight: WEIGHT.semibold,
                        color: COLORS.textSecondary,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        animation: `${slideFromButton} 160ms ease-out both`,
                    }}
                >
                    Tap a square
                </Box>
            )}
            {shown.map((offer, i) => {
                const selected = pickingLevel === offer.level;
                // "affordable" = can be chosen now: enough points AND a cell to put it on.
                const affordable = units >= offer.cost && hasTarget(offer.level);
                const armed = selected || affordable;
                const name = WRITING_LEVELS[offer.level - 1]?.name ?? `Level ${offer.level}`;
                return (
                    <Box
                        key={offer.level}
                        role="menuitem"
                        className={`writing-grid__hint-offer${selected ? " writing-grid__hint-offer--selected" : ""}${armed ? "" : " writing-grid__hint-offer--unaffordable"}`}
                        aria-disabled={!armed || undefined}
                        aria-label={`${name} — ${offer.cost} hint points`}
                        onClick={selected ? onUnchoose : affordable ? () => onChoose(offer.level) : undefined}
                        sx={{
                            flexShrink: 0,
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            gap: "4px",
                            padding: "6px 10px 6px",
                            borderRadius: "11px",
                            // Outlined like every tappable tile; the selected one swaps the
                            // hairline for the stronger ink ring (CLAUDE.md "Buttons & cards").
                            border: `1px solid ${selected ? COLORS.onSurface : COLORS.border}`,
                            boxShadow: selected ? `inset 0 0 0 1px ${COLORS.onSurface}` : "none",
                            backgroundColor: COLORS.white,
                            color: COLORS.onSurface,
                            opacity: armed ? 1 : 0.4,
                            cursor: armed ? "pointer" : "default",
                            // Nearest the button first: the right-most tile arrives first.
                            animation: `${slideFromButton} 160ms ease-out ${(shown.length - 1 - i) * 40}ms both`,
                        }}
                    >
                        <Box
                            component="span"
                            className="writing-grid__hint-offer-name"
                            sx={{ fontFamily: FONTS.sans, fontSize: 12.5, fontWeight: 600, lineHeight: LEADING.none, whiteSpace: "nowrap" }}
                        >
                            {name}
                        </Box>
                        {/* The cost, BELOW the name: one charge bar per point, then the number. */}
                        <Box className="writing-grid__hint-offer-cost" sx={{ display: "flex", alignItems: "center", gap: "4px" }}>
                            <Box sx={{ display: "flex", gap: "2px" }}>
                                {Array.from({ length: offer.cost }).map((_, b) => (
                                    <Box
                                        key={b}
                                        className="writing-grid__hint-offer-cost-bar"
                                        sx={{ width: COST_BAR_WIDTH, height: "3px", borderRadius: "1.5px", backgroundColor: COLORS.onSurface }}
                                    />
                                ))}
                            </Box>
                            <Box
                                component="span"
                                className="writing-grid__hint-offer-cost-number"
                                sx={{ fontSize: 11, fontWeight: WEIGHT.semibold, lineHeight: LEADING.none, color: COLORS.textSecondary }}
                            >
                                {offer.cost}
                            </Box>
                        </Box>
                    </Box>
                );
            })}
        </Box>
    );
}
