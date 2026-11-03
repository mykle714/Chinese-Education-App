import { Box } from "@mui/material";
import Icon from "../../components/Icon";
import { COLORS } from "../../theme/colors";
import { TEXT } from "../../theme/typography";

/**
 * SuperpositionExitButton — inspection's exit: a solid-ink "Exit →" pill pinned to the
 * board's bottom-right corner once the board is won (`SuperpositionStage` phase
 * `"inspecting"`). Solid ink, so it is exempt from the app's 1px outline rule
 * (CLAUDE.md § "Buttons & cards"); same ink + white glyph as `RoundPlayButton`, which it
 * replaced here because that primitive is icon-only.
 *
 * Entrance: it inflates like a bubble — scale 0 → overshoot → settle, anchored on its own
 * bottom-right corner so it grows out of the corner it lives in. Skipped under
 * `prefers-reduced-motion`.
 *
 * Layer: game presentational component (src/games/superposition).
 * Docs: docs/SUPERPOSITION_GAME.md § "Inspect on win".
 */

/** Pill height — the 44px tap target `RoundPlayButton`'s `card` size uses. */
const HEIGHT_PX = 44;
/** Entrance length; the overshoot lands at ~60%. */
const GROW_MS = 420;
/** Short pause so the win (last stack locking) reads before the exit appears. */
const GROW_DELAY_MS = 250;

interface SuperpositionExitButtonProps {
    onClick: () => void;
}

const SuperpositionExitButton: React.FC<SuperpositionExitButtonProps> = ({ onClick }) => (
    <Box
        component="button"
        type="button"
        className="superposition__inspect-done"
        aria-label="Exit"
        onClick={onClick}
        sx={{
            position: "absolute",
            right: 16,
            bottom: 16,
            zIndex: 6,
            height: HEIGHT_PX,
            padding: "0 14px 0 20px",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            border: "none",
            borderRadius: `${HEIGHT_PX / 2}px`, // string: a bare number is scaled by theme.shape
            backgroundColor: COLORS.onSurface,
            color: COLORS.white,
            ...TEXT.bodyEmph,
            lineHeight: 1,
            cursor: "pointer",
            transformOrigin: "100% 100%",
            // `both` holds scale(0) through the delay so it never flashes in at full size.
            animation: `superposition-exit-grow ${GROW_MS}ms ease-out ${GROW_DELAY_MS}ms both`,
            "@keyframes superposition-exit-grow": {
                "0%": { transform: "scale(0)", opacity: 0 },
                "60%": { transform: "scale(1.08)", opacity: 1 },
                "100%": { transform: "scale(1)", opacity: 1 },
            },
            "@media (prefers-reduced-motion: reduce)": { animation: "none" },
        }}
    >
        <span className="superposition__inspect-done-label">Exit</span>
        <Icon name="arrow_forward" size={20} color={COLORS.white} />
    </Box>
);

export default SuperpositionExitButton;
