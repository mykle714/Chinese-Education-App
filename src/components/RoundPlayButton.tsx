import { Box, type SxProps, type Theme } from "@mui/material";
import Icon from "./Icon";
import { COLORS } from "../theme/colors";

/**
 * RoundPlayButton — the solid-ink launch button with a white ▶: a card's one launch
 * action. A solid-ink control, so it is exempt from the app's 1px outline rule
 * (CLAUDE.md § "Buttons & cards").
 *
 * One look: a 44px circle — GameCard's corner play button (games/shared/GameCard). A
 * rounded-square / → variant and a 52px `hand` size served the old Home page's Study
 * Hand until it was deleted on 2026-11-04; `size` keeps its one key so a second size
 * can return without touching callers.
 *
 * Layer: shared presentational primitive (src/components).
 * Docs: docs/GAMES_FEATURE.md § "Games hub".
 */

const SIZES = {
    card: { diameter: 44, icon: 24 },
} as const;

export interface RoundPlayButtonProps {
    size?: keyof typeof SIZES;
    className?: string;
    ariaLabel?: string;
    onClick?: (e: React.MouseEvent) => void;
    disabled?: boolean;
    tabIndex?: number;
    ariaHidden?: boolean;
    sx?: SxProps<Theme>;
}

const RoundPlayButton: React.FC<RoundPlayButtonProps> = ({
    size = "card", className, ariaLabel, onClick, disabled, tabIndex, ariaHidden, sx,
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
                    backgroundColor: COLORS.onSurface,
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
