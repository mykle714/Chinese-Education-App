import { Box, type SxProps, type Theme } from "@mui/material";
import Icon from "./Icon";
import { COLORS } from "../theme/colors";

/**
 * RoundPlayButton — the solid-ink circle with a white ▶: a card's one launch action.
 * A solid-ink control, so it is exempt from the app's 1px outline rule (CLAUDE.md
 * § "Buttons & cards").
 *
 * Two sizes, one look:
 *   `card` (44px) — GameCard's corner play button (games/shared/GameCard);
 *   `hand` (52px) — the Study Hand's compact face (`study-hand__go--round`,
 *                   features/flashcards/StudyHand).
 *
 * Layer: shared presentational primitive (src/components).
 * Docs: docs/GAMES_FEATURE.md § "Games hub", docs/READING_WRITING_CENTERS.md.
 */

const SIZES = {
    card: { diameter: 44, icon: 24 },
    hand: { diameter: 52, icon: 28 },
} as const;

export interface RoundPlayButtonProps {
    size?: keyof typeof SIZES;
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
    size = "card", className, ariaLabel, onClick, disabled, greyed = false, tabIndex, ariaHidden, sx,
}) => {
    const s = SIZES[size];
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
                    borderRadius: "50%",
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
            <Icon name="play_arrow" size={s.icon} color={COLORS.white} />
        </Box>
    );
};

export default RoundPlayButton;
