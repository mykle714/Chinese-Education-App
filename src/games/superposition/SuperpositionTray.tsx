import type { RefObject } from "react";
import { Box } from "@mui/material";
import { COLORS } from "../../theme/colors";
import { SHADOW } from "../../theme/shadows";
import type { Tile } from "./board";
import type { TrayLayout } from "./tray";
import TileGlyph from "./TileGlyph";
import { HINT_INK, SELECTED_INK } from "./constants";

/** A slot's corner radius (px): the board tile's 15px corner scaled toward the mini's size. */
const SLOT_RADIUS_PX = 6;

interface SuperpositionTrayProps {
    /** The tray's element, for the board's hit-testing of `layout`'s slots. */
    trayRef: RefObject<HTMLDivElement | null>;
    tiles: readonly Tile[];
    /** The slot rects (`tray.ts` → `trayLayout`), measured by the board that hit-tests them. */
    layout: TrayLayout;
    hintedTileIds: readonly number[];
    /** The slot a loose drag would return to if dropped now (the finger is over the tray). */
    homingSlot: number | null;
}

/**
 * The tray: the band under the grid that every tile is dealt into, as a mini copy of itself
 * in its own slot. A slot whose tile is out on the board shows as an empty WELL — a socket
 * pressed into the band (`SHADOW.recessed` over the `COLORS.card` empty-cell fill) — so the
 * tile's way home stays visible.
 *
 * Presentational only: the board's single pointer handler does the hit-testing over the same
 * `layout` (a press must be able to start here and end on the grid, and back), so nothing in
 * here takes input.
 *
 * Layer: game component, presentational over `board.ts` / `tray.ts`. The Stage owns the tiles.
 * Doc: docs/SUPERPOSITION_GAME.md § Tray.
 */
const SuperpositionTray: React.FC<SuperpositionTrayProps> = ({ trayRef, tiles, layout, hintedTileIds, homingSlot }) => {
    const bySlot = new Map(tiles.map((tile) => [tile.slot, tile]));
    return (
        <Box
            ref={trayRef}
            className="superposition-tray"
            sx={{
                position: "relative",
                flexShrink: 0,
                height: layout.height,
                // A hairline parts the tray from the grid; the band keeps the board's own ground.
                borderTop: `1px solid ${COLORS.rowBorder}`,
                pointerEvents: "none",
            }}
        >
            {layout.slots.map((rect, slot) => {
                const tile = bySlot.get(slot);
                const resting = tile?.inTray === true;
                const hinted = resting && hintedTileIds.includes(tile.id);
                const homing = slot === homingSlot;
                return (
                    <Box
                        key={slot}
                        className={`superposition-tray__slot${resting ? " superposition-tray__slot--filled" : " superposition-tray__slot--empty"}${homing ? " superposition-tray__slot--homing" : ""}`}
                        sx={{
                            position: "absolute",
                            left: rect.left,
                            top: rect.top,
                            width: rect.size,
                            height: rect.size,
                            boxSizing: "border-box",
                            borderRadius: `${SLOT_RADIUS_PX}px`,
                            backgroundColor: COLORS.card,
                            // The homing ring is an extra OUTER ring, so the well never shifts.
                            boxShadow: homing ? `${SHADOW.recessed}, 0 0 0 2px ${SELECTED_INK}` : SHADOW.recessed,
                        }}
                    >
                        {resting && (
                            // The mini sits flush in its well, covering it: an outlined white tile
                            // (the app's tappable-entity outline, CLAUDE.md "Buttons & cards").
                            <Box
                                className={`superposition-tray__mini${hinted ? " superposition-tray__mini--hinted" : ""}`}
                                sx={{
                                    width: "100%",
                                    height: "100%",
                                    boxSizing: "border-box",
                                    borderRadius: `${SLOT_RADIUS_PX}px`,
                                    backgroundColor: COLORS.white,
                                    border: `1px solid ${hinted ? HINT_INK : COLORS.border}`,
                                    boxShadow: hinted ? `0 0 0 1px ${HINT_INK}` : "none",
                                }}
                            >
                                <TileGlyph paths={tile.paths} fill={hinted ? HINT_INK : COLORS.onSurface} />
                            </Box>
                        )}
                    </Box>
                );
            })}
        </Box>
    );
};

export default SuperpositionTray;

