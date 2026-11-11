import { createPortal } from "react-dom";
import { Box, Typography } from "@mui/material";
import { COLORS } from "../../theme/colors";
import { WEIGHT } from "../../theme/scale";
import { useScreenOverlayHost } from "../../hooks/useScreenOverlayHost";
import { COUNTDOWN_STEPS } from "./useGameCountdown";

/**
 * THE PRE-RUN COUNTDOWN — 3 · 2 · 1 over a readable board, then the run goes live.
 *
 * Every flp game break opens on it (docs/GAMES_FEATURE.md § "The countdown",
 * docs/FLP_GAME_BREAKS.md § 6), so the opening board gets a beat to be read and the run's
 * clock starts from the same state every time: nobody is billed for reading time. It used
 * to be written twice, in Match Speed and Writing Grid; this is the one copy.
 *
 * ── WHAT IT LOOKS AND SOUNDS LIKE ───────────────────────────────────────────
 *   • A dim over the WHOLE screen: portaled to the phone frame
 *     (`useScreenOverlayHost`), so Leave's row and the status band dim with the board.
 *   • One big digit per step. There is no "Go!" card: the release is the dim lifting.
 *   • A tick on each digit and a different beep on release (`playCountdownSound`),
 *     which honours the audio chip (mute → silent).
 *
 * ── WHY TWO LAYERS ──────────────────────────────────────────────────────────
 * Leave must stay usable during the count (decided 2026-10-06, re-confirmed 2026-11-10),
 * but the board must not be. One layer cannot do both once the dim sits over Leave too:
 *   • the DIM is portaled above everything and is pointer-transparent, so a tap on the
 *     dimmed Leave arrow (or the audio chip) reaches it;
 *   • the SHIELD is rendered IN PLACE, inside the game's `GameFrame`, at z 5 — under
 *     the break's header row (GameBreakChrome, z 6, a sibling of the game in the break area)
 *     and over the board — so it swallows every tap aimed at
 *     the board. It is also the dim's portal anchor.
 * Render `<GameCountdown>` as a direct child of the game's `GameFrame` for this to hold.
 *
 * Layer: game-shared UI (src/games/shared). The timing and the beeps live in
 * `useGameCountdown` (./useGameCountdown.ts); the owning Stage decides when to start it
 * and what "release" means for its clock.
 */

/**
 * Above the flp break's area (`GameBreakArea` → `GAME_BREAK_Z_INDEX`, 120) and the footer
 * (100); below the frame-hosted popups (`MinimizablePopup` 200, dialogs 1300).
 *
 * ⚠️ The provisional-cards notice is NOT frame-hosted: it is `position: fixed` inside the
 * break area's own stacking context (z 120), so this dim would paint OVER it. That is why
 * every Stage with a notice starts its countdown only once the notice is dismissed
 * (`active: … && !noticeOpen`) rather than pausing the count behind it.
 */
const COUNTDOWN_DIM_Z_INDEX = 150;
/** Under the break's header row (GameBreakChrome, z 6), over the board. */
const COUNTDOWN_SHIELD_Z_INDEX = 5;

export interface GameCountdownProps {
    /** From `useGameCountdown`; null renders nothing. */
    step: number | null;
    /**
     * Turn the digit with a sideways stage (Speed Reading, `useSidewaysStage`): the dim is
     * portaled out of the rotated stage, so it is upright unless told otherwise. Degrees.
     */
    rotateDeg?: number;
    /** BEM prefix for the game's own class names (`match-speed` → `match-speed__countdown`). */
    classPrefix: string;
}

/** The countdown's two layers (see the file header). Mount inside the game's `GameFrame`. */
export const GameCountdown: React.FC<GameCountdownProps> = ({ step, rotateDeg = 0, classPrefix }) => {
    const { anchorRef, host } = useScreenOverlayHost<HTMLDivElement>(step !== null);
    if (step === null) return null;
    return (
        <>
            <Box
                ref={anchorRef}
                className={`game-countdown__shield ${classPrefix}__countdown-shield`}
                sx={{ position: "absolute", inset: 0, zIndex: COUNTDOWN_SHIELD_Z_INDEX, touchAction: "none" }}
            />
            {host &&
                createPortal(
                    <Box
                        className={`game-countdown ${classPrefix}__countdown`}
                        sx={{
                            position: "absolute",
                            inset: 0,
                            zIndex: COUNTDOWN_DIM_Z_INDEX,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            backgroundColor: COLORS.scrim,
                            pointerEvents: "none",
                        }}
                    >
                        <Box className="game-countdown__turn" sx={{ transform: rotateDeg ? `rotate(${rotateDeg}deg)` : undefined }}>
                            <Typography
                                className={`game-countdown__step ${classPrefix}__countdown-step`}
                                // Keyed by step so the pop replays on each digit, not only on mount.
                                key={step}
                                sx={{
                                    fontSize: "72px",
                                    fontWeight: WEIGHT.bold,
                                    color: COLORS.white,
                                    textShadow: "0 2px 12px rgba(0,0,0,0.4)",
                                    animation: "game-countdown-pop 400ms ease-out",
                                    "@keyframes game-countdown-pop": {
                                        from: { opacity: 0, transform: "scale(0.5)" },
                                        to: { opacity: 1, transform: "scale(1)" },
                                    },
                                }}
                            >
                                {COUNTDOWN_STEPS[step]}
                            </Typography>
                        </Box>
                    </Box>,
                    host
                )}
        </>
    );
};
