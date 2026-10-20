import React, { useMemo } from "react";
import { Box } from "@mui/material";
import { GameSurfaceContext } from "../../../../games/shared/gameSurface";
import { GameFrameExitContext } from "../../../../games/shared/gameFrameExit";
import type { GameStageFrameProps } from "../../../../games/types";
import type { RampHue } from "../../../../theme/colors";

/** Leave's label on the play panel's top strip (docs/FLP_GAME_BREAKS.md § 2). */
const LEAVE_LABEL = "Leave";

/**
 * The flp break host's chrome for a game Stage (`GameStageFrameProps`,
 * docs/FLP_GAME_BREAKS.md § 6) — deliberately almost nothing: in a break the game IS
 * its play panel (`GameFrame`), sitting on the flp's own ground where the card was.
 *
 *   - NO header bar and no ground paint. The flp header above stays the only header
 *     (its Back leaves the session); `title` / `headerRight` are page-host concerns and
 *     are ignored here.
 *   - Leave rides on the panel's top strip, top-right: provided to every `GameFrame`
 *     inside through `GameFrameExitContext` (games/shared/gameFrameExit.ts).
 *   - The game's HUE still reaches the panel's own parts (border, HUD / timer tint)
 *     through `GameSurfaceContext` — provided directly, never via `GameSurfaceProvider`,
 *     whose `useThemeColor` would repaint the browser chrome (decided 2026-10-18).
 *
 * Layer: feature component (features/flashcards). Built per hue by `gameBreakFrameFor`
 * so each hue's component identity is stable — a new component per render would remount
 * the whole Stage.
 */
function makeGameBreakFrame(hue: RampHue): React.FC<GameStageFrameProps> {
    const GameBreakFrame: React.FC<GameStageFrameProps> = ({ onExitRequest, children }) => {
        const exit = useMemo(() => ({ label: LEAVE_LABEL, onExit: onExitRequest }), [onExitRequest]);
        return (
            <GameSurfaceContext.Provider value={hue}>
                <GameFrameExitContext.Provider value={exit}>
                    <Box
                        className="game-break-frame"
                        // A flex child, not `inset: 0`, so the area's safe-bottom padding
                        // holds; `relative` anchors the Stage's own overlays (end popup,
                        // paused veil) to the area rather than the page.
                        sx={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}
                    >
                        {children}
                    </Box>
                </GameFrameExitContext.Provider>
            </GameSurfaceContext.Provider>
        );
    };
    return GameBreakFrame;
}

const FRAMES = new Map<RampHue, React.FC<GameStageFrameProps>>();

/** The (memoized, identity-stable) break frame for a game's hue. */
export function gameBreakFrameFor(hue: RampHue): React.FC<GameStageFrameProps> {
    let frame = FRAMES.get(hue);
    if (!frame) {
        frame = makeGameBreakFrame(hue);
        FRAMES.set(hue, frame);
    }
    return frame;
}
