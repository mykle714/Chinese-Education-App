import { Box, Button, Typography } from "@mui/material";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";

/**
 * The tap-to-resume affordance shown after backgrounding paused a round
 * (docs/GAMES_FEATURE.md § "Backgrounding pauses the clock"; the requirement is
 * docs/STUDY_CHALLENGE.md § 5.8).
 *
 * Paired with `useBackgroundPause`, which latches the pause so the clock does NOT
 * restart when the player merely returns to the tab. The player restarts it here, on
 * purpose — being dropped back into a live timer you have not looked at yet is the same
 * as not having been paused for that first second.
 *
 * ⚠️ IT COVERS THE BOARD, and that is the point. The scrim is opaque enough to hide the
 * playfield, so the pause cannot be used as a free look at the board: a player who
 * backgrounds the app mid-round to study the arrangement sees nothing until they accept
 * the clock starting again. Pausing therefore never helps you, which is what lets the
 * rule stay absolute with no per-mode exceptions (and, in live mode, is why an
 * unpausable AFK timer is the right counterweight rather than forbidding the pause).
 *
 * Rendered as a SIBLING of the board, like `GameEndPopup`, not as a wrapper — a game's
 * layout must not change shape depending on whether it is paused.
 */
function GamePausedOverlay({
    open,
    onResume,
    classPrefix,
}: {
    open: boolean;
    onResume: () => void;
    /** The game's BEM prefix, so each game's overlay classes stay distinct. */
    classPrefix: string;
}) {
    if (!open) return null;

    return (
        <Box
            className={`${classPrefix}__paused-overlay game-paused-overlay`}
            sx={{
                // `absolute` + `inset: 0` pins this to the nearest positioned ancestor —
                // the game's stage — which is the same choice MinimizablePopup documents
                // as "what a game stage wants". It must NOT be `fixed`: inside the
                // desktop phone frame that would cover the whole browser window.
                position: "absolute",
                inset: 0,
                // BELOW MinimizablePopup's default 200, deliberately. Any popup — the
                // provisional-cards notice, the end-of-run card — stacks ABOVE this
                // scrim. Those popups pause the clock themselves, so the layering matches
                // the semantics: whichever pause the player needs to act on is the one on
                // top, and a Resume button never hides behind a notice or vice versa.
                zIndex: 150,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 2,
                // Near-opaque rather than a light scrim: this has to HIDE the board, not
                // dim it. See the note above.
                backgroundColor: COLORS.background,
                // The overlay swallows every touch, so no stray tap reaches a game that
                // believes it is frozen.
                touchAction: "none",
            }}
        >
            <Typography
                className={`${classPrefix}__paused-title`}
                sx={{
                    fontFamily: FONTS.sans,
                    fontSize: SIZE.subtitle,
                    fontWeight: WEIGHT.bold,
                    color: COLORS.onSurface,
                }}
            >
                Paused
            </Typography>
            <Typography
                className={`${classPrefix}__paused-note`}
                sx={{
                    fontFamily: FONTS.sans,
                    fontSize: SIZE.caption,
                    color: COLORS.textSecondary,
                    textAlign: "center",
                    px: 4,
                }}
            >
                The clock stopped while you were away.
            </Typography>
            <Button
                className={`${classPrefix}__paused-resume`}
                onClick={onResume}
                startIcon={<PlayArrowIcon />}
                sx={{
                    textTransform: "none",
                    fontFamily: FONTS.sans,
                    fontSize: SIZE.body,
                    fontWeight: WEIGHT.semibold,
                    color: COLORS.onSurface,
                    backgroundColor: COLORS.greenAccent,
                    borderRadius: 3,
                    px: 3,
                    py: 1,
                }}
            >
                Resume
            </Button>
        </Box>
    );
}

export default GamePausedOverlay;
