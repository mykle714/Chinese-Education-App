import { Box, type SxProps, type Theme } from "@mui/material";
import Icon from "./Icon";
import { COLORS } from "../theme/colors";

/**
 * RoundPlayButton — the solid-ink launch button with a white glyph: a card's one launch
 * action. A solid-ink control, so it is exempt from the app's 1px outline rule
 * (CLAUDE.md § "Buttons & cards").
 *
 * Shape + glyph (both default to the original circle + ▶):
 *   `shape="circle"` — fully round (GameCard's corner button).
 *   `shape="square"` — a rounded square, `SQUARE_RADIUS` (14px) to match the full Study
 *                      Hand's `Start` bar, so the two hands' commits share a corner.
 *   `glyph="play"`   — the ▶ triangle (`play_arrow`).
 *   `glyph="arrow"`  — a → (`arrow_forward`); the compact Study Hand uses square + arrow.
 *
 * Two sizes, one look:
 *   `card` (44px) — GameCard's corner play button (games/shared/GameCard);
 *   `hand` (52px) — the Study Hand's compact face (`study-hand__go--square`,
 *                   features/flashcards/StudyHand).
 *
 * Layer: shared presentational primitive (src/components).
 * Docs: docs/GAMES_FEATURE.md § "Games hub", docs/READING_WRITING_CENTERS.md.
 */

const SIZES = {
    card: { diameter: 44, icon: 24 },
    hand: { diameter: 52, icon: 28 },
} as const;

/** Corner radius of `shape="square"` — the same 14px as StudyHand's `Start` bar. */
const SQUARE_RADIUS = "14px";

/** Glyph key → Material Symbols name. `arrow_forward` reads optically larger than the
 *  ▶ at the same size (it spans the full width of its box), so it is drawn 2px smaller. */
const GLYPHS = {
    play: { name: "play_arrow", sizeOffset: 0 },
    arrow: { name: "arrow_forward", sizeOffset: -2 },
} as const;

export interface RoundPlayButtonProps {
    size?: keyof typeof SIZES;
    /** `circle` (default) or `square` (rounded square, `SQUARE_RADIUS`). */
    shape?: "circle" | "square";
    /** `play` (default, ▶) or `arrow` (→). */
    glyph?: keyof typeof GLYPHS;
    className?: string;
    ariaLabel?: string;
    onClick?: (e: React.MouseEvent) => void;
    disabled?: boolean;
    /** Dim the commit (an ineligible launch) without hiding it — `COLORS.greyA`. */
    greyed?: boolean;
    tabIndex?: number;
    ariaHidden?: boolean;
    sx?: SxProps<Theme>;
}

const RoundPlayButton: React.FC<RoundPlayButtonProps> = ({
    size = "card", shape = "circle", glyph = "play", className, ariaLabel, onClick, disabled, greyed = false, tabIndex, ariaHidden, sx,
}) => {
    const s = SIZES[size];
    const g = GLYPHS[glyph];
    return (
        <Box
            component="button"
            type="button"
            className={className}
            aria-label={ariaLabel}
            aria-hidden={ariaHidden}
            tabIndex={tabIndex}
            disabled={disabled}
            onClick={onClick}
            sx={[
                {
                    width: s.diameter,
                    height: s.diameter,
                    flexShrink: 0,
                    borderRadius: shape === "square" ? SQUARE_RADIUS : "50%",
                    border: "none",
                    padding: 0,
                    backgroundColor: greyed ? COLORS.greyA : COLORS.onSurface,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                },
                ...(Array.isArray(sx) ? sx : [sx]),
            ]}
        >
            <Icon name={g.name} size={s.icon + g.sizeOffset} color={COLORS.white} />
        </Box>
    );
};

export default RoundPlayButton;
