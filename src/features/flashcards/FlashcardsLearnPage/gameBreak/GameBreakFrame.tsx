import React, { useLayoutEffect, useMemo, useRef } from "react";
import { Box } from "@mui/material";
import { GameSurfaceContext } from "../../../../games/shared/gameSurface";
import { GameFrameHostContext } from "../../../../games/shared/gameFrameExit";
import type { GameStageFrameProps } from "../../../../games/types";
import type { RampHue } from "../../../../theme/colors";
import { useGameBreakHost } from "./gameBreakHost";

/**
 * The flp break host's chrome for a game Stage (`GameStageFrameProps`,
 * docs/FLP_GAME_BREAKS.md § 6) — deliberately almost nothing: in a break the game IS the
 * screen, and the header row (Leave, the game's name, the audio chip, the flame) belongs
 * to the AREA (GameBreakChrome), which draws it from the first frame of the grow.
 *
 *   - `onExitRequest` is handed UP to that row (`GameBreakHost.registerExit`), so Leave
 *     does what the game says while the game is mounted. Held in a ref, so a Stage passing
 *     a fresh callback each render re-registers nothing.
 *   - `GameFrameHostContext` tells every `GameFrame` inside that it is hosted: the panel
 *     look goes, the content fades in, and `exitRowTrailing` portals into the row's slot.
 *   - `title` is the row's (the area reads it from the adapter's candidate); `headerRight`
 *     is a page-host concern; both are ignored here.
 *   - The game's HUE still reaches the game's own parts through
 *     `GameSurfaceContext` — provided directly, never via `GameSurfaceProvider`, whose
 *     `useThemeColor` would repaint the browser chrome (decided 2026-10-18).
 *
 * Layer: feature component (features/flashcards). Built per hue by `gameBreakFrameFor`
 * so each hue's component identity is stable — a new component per render would remount
 * the whole Stage.
 */
function makeGameBreakFrame(hue: RampHue): React.FC<GameStageFrameProps> {
    const GameBreakFrame: React.FC<GameStageFrameProps> = ({ onExitRequest, children }) => {
        const breakHost = useGameBreakHost();
        const onExitRef = useRef(onExitRequest);
        onExitRef.current = onExitRequest;
        const registerExit = breakHost?.registerExit;
        useLayoutEffect(() => {
            if (!registerExit) return;
            registerExit(() => onExitRef.current());
            return () => registerExit(null);
        }, [registerExit]);

        const trailingSlot = breakHost?.trailingSlot ?? null;
        const frameHost = useMemo(() => ({ trailingSlot }), [trailingSlot]);
        return (
            <GameSurfaceContext.Provider value={hue}>
                <GameFrameHostContext.Provider value={frameHost}>
                    <Box
                        className="game-break-frame"
                        // A flex child, not `inset: 0`, so the area's safe-bottom padding
                        // holds; `relative` anchors the Stage's in-place overlays (its
                        // end card, notices) to the screen below the status bar.
                        sx={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}
                    >
                        {children}
                    </Box>
                </GameFrameHostContext.Provider>
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
