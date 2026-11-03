import React, { useMemo } from "react";
import { Box } from "@mui/material";
import { GameSurfaceContext } from "../../../../games/shared/gameSurface";
import { GameFrameExitContext } from "../../../../games/shared/gameFrameExit";
import type { GameStageFrameProps } from "../../../../games/types";
import type { RampHue } from "../../../../theme/colors";
import { SAFE_TOP } from "../../../../theme/safeArea";

/** The Leave arrow's screen-reader name, top-left of the game (docs/FLP_GAME_BREAKS.md § 2). */
const LEAVE_LABEL = "Leave";

/**
 * The flp break host's chrome for a game Stage (`GameStageFrameProps`,
 * docs/FLP_GAME_BREAKS.md § 6) — deliberately almost nothing: in a break the game IS the
 * screen. The `GameFrame` inside drops its panel look (it reads the Leave context).
 *
 *   - NO header bar: the flp header is covered, and the game's clock sits straight on the
 *     ground, with no band or line of its own (GameTimer). `headerRight` is a page-host
 *     concern and is ignored here; `title` shows beside Leave, as a header's would.
 *   - A status-bar spacer above the `GameFrame`, not padding inside it, so everything
 *     pinned to the frame's corners (Leave, the end popup's puck) clears the status bar.
 *   - Leave is a back arrow, top-left, with the game's name beside it: provided to every `GameFrame` inside through
 *     `GameFrameExitContext` (games/shared/gameFrameExit.ts).
 *   - The game's HUE still reaches the game's own parts through
 *     `GameSurfaceContext` — provided directly, never via `GameSurfaceProvider`, whose
 *     `useThemeColor` would repaint the browser chrome (decided 2026-10-18).
 *
 * Layer: feature component (features/flashcards). Built per hue by `gameBreakFrameFor`
 * so each hue's component identity is stable — a new component per render would remount
 * the whole Stage.
 */
function makeGameBreakFrame(hue: RampHue): React.FC<GameStageFrameProps> {
    const GameBreakFrame: React.FC<GameStageFrameProps> = ({ title, onExitRequest, children }) => {
        const exit = useMemo(() => ({ label: LEAVE_LABEL, title, onExit: onExitRequest }), [title, onExitRequest]);
        return (
            <GameSurfaceContext.Provider value={hue}>
                <GameFrameExitContext.Provider value={exit}>
                    <Box
                        className="game-break-frame"
                        // A flex child, not `inset: 0`, so the area's safe-bottom padding
                        // holds; `relative` anchors the Stage's in-place overlays (its
                        // end card, notices) to the screen.
                        sx={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}
                    >
                        <Box className="game-break-frame__status-spacer" sx={{ flexShrink: 0, height: SAFE_TOP }} />
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
