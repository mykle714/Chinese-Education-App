import React, { useMemo } from "react";
import { Box } from "@mui/material";
import { GameSurfaceContext } from "../../../../games/shared/gameSurface";
import { GameFrameExitContext } from "../../../../games/shared/gameFrameExit";
import type { GameStageFrameProps } from "../../../../games/types";
import type { RampHue } from "../../../../theme/colors";
import { TOWER_SLAB_WALL_PX } from "../../../../theme/towerSlab";
import { FLP_CARD_ASPECT } from "../../constants";

/** Leave's label on the play panel's top strip (docs/FLP_GAME_BREAKS.md § 2). */
const LEAVE_LABEL = "Leave";

/** `GameFrame`'s box: its margin and corner. */
export const GAME_PANEL = { margin: 14, radius: 24 } as const;

/** The card's width ÷ height, which the play panel keeps (docs/FLP_GAME_BREAKS.md § 2). */
const CARD_RATIO = FLP_CARD_ASPECT.width / FLP_CARD_ASPECT.height;

/** Height the panel can't use: `GameFrame`'s margins and the slab's wall. */
const PANEL_GUTTER_Y = 2 * GAME_PANEL.margin + TOWER_SLAB_WALL_PX;

/**
 * The play panel in a break: the largest card-shaped box inside the frame's `width` ×
 * `height` that leaves room for the slab's wall, the two centred together. Every break game
 * reserves the slab's wall, though Match Speed now draws on the ground with no slab, which
 * only leaves that gutter as slack; a bento panel would need the wall made per game.
 * `GameBreakArea` aims the grow here. It must agree with the CSS on
 * `.game-break-frame__panel-slot`, which can't call this because it lays out from container
 * units.
 */
export function breakPanelBox(width: number, height: number) {
    const panelWidth = Math.min(width - 2 * GAME_PANEL.margin, (height - PANEL_GUTTER_Y) * CARD_RATIO);
    const panelHeight = panelWidth / CARD_RATIO;
    return { left: (width - panelWidth) / 2, top: (height - panelHeight - TOWER_SLAB_WALL_PX) / 2, width: panelWidth, height: panelHeight };
}

/** `breakPanelBox`'s width as CSS, in the frame's container units. */
const PANEL_WIDTH_CSS = `min(100cqw - ${2 * GAME_PANEL.margin}px, (100cqh - ${PANEL_GUTTER_Y}px) * ${CARD_RATIO})`;

/**
 * The flp break host's chrome for a game Stage (`GameStageFrameProps`,
 * docs/FLP_GAME_BREAKS.md § 6) — deliberately almost nothing: in a break the game IS
 * its play panel (`GameFrame`), sitting on the flp's own ground where the card was.
 *
 *   - The panel keeps the flp card's aspect ratio, so the game stays card-shaped: a slot
 *     sized for it (panel + `GameFrame`'s margin) centred in the area.
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
                        // paused veil) to the area rather than the page. `cq` units in the
                        // slot below read this box.
                        sx={{
                            position: "relative",
                            flex: 1,
                            minHeight: 0,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            overflow: "hidden",
                            containerType: "size",
                        }}
                    >
                        {/* Not positioned: the overlays above must still cover the area. */}
                        <Box
                            className="game-break-frame__panel-slot"
                            sx={{
                                flexShrink: 0,
                                width: `calc(${PANEL_WIDTH_CSS} + ${2 * GAME_PANEL.margin}px)`,
                                height: `calc(${PANEL_WIDTH_CSS} / ${CARD_RATIO} + ${PANEL_GUTTER_Y}px)`,
                                display: "flex",
                                flexDirection: "column",
                            }}
                        >
                            {children}
                        </Box>
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
