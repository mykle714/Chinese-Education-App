import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Box } from "@mui/material";
import { COLORS } from "../../theme/colors";
import { CARD_SURFACE_RADIUS } from "../../theme/surfaces";
import { collapseLocked, dragTarget, nextTapSelection, placementSpot, snapToGrid, tilesAt, type Tile } from "./board";
import { slotAt, trayLayout } from "./tray";
import SuperpositionTray from "./SuperpositionTray";
import TileGlyph from "./TileGlyph";
import {
    DRAG_GRIP_X_FRACTION,
    DRAG_GRIP_Y_FRACTION,
    DRAG_SLOP_PX,
    FINISHED_INK,
    GRID_UNIT_PX,
    HINT_INK,
    MINI_TILE_PX,
    PLACE_MARGIN_UNITS,
    SELECTED_INK,
    TILE_OUTLINE_PX,
    TILE_PX,
    TILE_UNITS,
    TRAY_GAP_PX,
    TRAY_PADDING_PX,
} from "./constants";

/** How faint a dragged tile hangs while a drop would send it home to the tray. */
const HOMING_TILE_OPACITY = 0.45;

interface SuperpositionBoardProps {
    tiles: Tile[];
    /** The tiles the hint button pointed at. */
    hintedTileIds: readonly number[];
    /** Input is off once the run is over. */
    locked: boolean;
    /** The word info, drawn on the grid under the tiles. */
    info: ReactNode;
    /** The grid has a size: the Stage may start the countdown. Called on every resize. */
    onMeasured: () => void;
    /** Put a tile at (x, y) on the board, taking it out of the tray if it was there. */
    onMove: (tileId: number, x: number, y: number) => void;
    /** A loose tile was dropped over the tray: send it home to its slot. */
    onReturn: (tileId: number) => void;
    /** A drag took a tile, or (null) put it down. */
    onLift: (tileId: number | null) => void;
}

/** A press in progress. All in a ref: a pointer move must not wait on a render. */
interface Press {
    pointerId: number;
    startX: number;
    startY: number;
    /** Where the press began: on the grid, or on a tray slot. */
    source: "board" | "tray";
    /** The tiles under the press, topmost first (a tray press holds at most its slot's tile). */
    hits: Tile[];
    /** Set once the press travels far enough to be a drag. */
    drag: {
        tileId: number;
        offsetX: number;
        offsetY: number;
        /** The tile's board cell when lifted: where a refused tray drop puts a locked stack back. */
        fromX: number;
        fromY: number;
        /** A locked stack, which the tray refuses. */
        locked: boolean;
    } | null;
    /** The finger is over the tray right now. */
    overTray: boolean;
}

/**
 * The play surface: the snapping grid on top and the tray (`SuperpositionTray`) under it,
 * with ONE pointer handler over both, so a drag can start on a tray slot and end on the grid
 * (or the other way) without handing the pointer between elements.
 *
 * Grid: a tap walks the pile under the finger (`nextTapSelection`), highlighting the selected
 * stroke. A drag lifts the selection if it is in that pile, else the top tile, and the tile
 * jumps to hang from the finger at its bottom-middle grip (`DRAG_GRIP_*_FRACTION`), then
 * snaps cell to cell under it. Dropping clears the selection. A locked (finished) stack is one
 * entry in the pile (`collapseLocked`): it selects, highlights and drags whole.
 *
 * Tray: a drag from a mini lifts its tile out onto the grid, leaving the slot's empty well.
 * A tap on a mini places it on the grid (`placementSpot`). A loose tile dropped anywhere over
 * the tray goes home to its own slot; while one hangs there, the tile fades and its well rings.
 * A locked stack dropped over the tray is refused and goes back where it was lifted.
 *
 * Board tiles are drawn in the root's coordinates, whose origin is the grid's top-left, so the
 * grid's (x, y) maps straight to pixels. Snapping keeps a tile inside the grid's rows, so a
 * board tile never covers the tray.
 *
 * Layer: game component, presentational over `board.ts` / `tray.ts`. The Stage owns the tiles.
 */
const SuperpositionBoard: React.FC<SuperpositionBoardProps> = ({ tiles, hintedTileIds, locked, info, onMeasured, onMove, onReturn, onLift }) => {
    const rootRef = useRef<HTMLDivElement | null>(null);
    const gridElementRef = useRef<HTMLDivElement | null>(null);
    const trayRef = useRef<HTMLDivElement | null>(null);
    const infoRef = useRef<HTMLDivElement | null>(null);
    const pressRef = useRef<Press | null>(null);
    const gridRef = useRef({ cols: 0, rows: 0, heightPx: 0 });
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [boardWidth, setBoardWidth] = useState(0);
    // The slot a drop would send the held tile home to, while the finger is over the tray.
    const [homingSlot, setHomingSlot] = useState<number | null>(null);
    // While a drag is over the tray, the dragged tile (or locked stack) hovers freely under the
    // finger in pixels instead of snapping: the grid's rows end where the tray begins, so a
    // snapped tile would stick to the grid's bottom edge. Its grid x/y stay at the last snap, so a
    // cancelled pointer leaves it there. Root coordinates of the dragged tile's top-left.
    const [trayHover, setTrayHover] = useState<{ tileId: number; x: number; y: number } | null>(null);

    // The tray's slots follow the board's width and the tile count. The grid takes the height
    // that is left (flex), so the tray's rows decide how tall the grid is.
    const layout = useMemo(
        () => trayLayout(tiles.length, boardWidth, { miniPx: MINI_TILE_PX, gapPx: TRAY_GAP_PX, paddingPx: TRAY_PADDING_PX }),
        [tiles.length, boardWidth]
    );

    useEffect(() => {
        const root = rootRef.current;
        const grid = gridElementRef.current;
        if (!root || !grid) return;
        const observer = new ResizeObserver(() => {
            setBoardWidth(root.clientWidth);
            const cols = Math.floor(grid.clientWidth / GRID_UNIT_PX);
            const rows = Math.floor(grid.clientHeight / GRID_UNIT_PX);
            gridRef.current = { cols, rows, heightPx: grid.clientHeight };
            if (cols > 0 && rows > 0) onMeasured();
        });
        observer.observe(root);
        observer.observe(grid);
        return () => observer.disconnect();
    }, [onMeasured]);

    const pointIn = (event: React.PointerEvent) => {
        const rect = rootRef.current?.getBoundingClientRect();
        return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
    };
    const isOverTray = (y: number) => y >= gridRef.current.heightPx;

    /** The tray tile under a press, if any. Slot rects are in the tray's padding box, below its hairline. */
    const trayTileAt = (event: React.PointerEvent): Tile | null => {
        const tray = trayRef.current;
        if (!tray) return null;
        const rect = tray.getBoundingClientRect();
        const slot = slotAt(layout.slots, event.clientX - rect.left - tray.clientLeft, event.clientY - rect.top - tray.clientTop);
        return tiles.find((tile) => tile.inTray && tile.slot === slot) ?? null;
    };

    const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        if (locked || pressRef.current) return;
        const { x, y } = pointIn(event);
        const fromTray = isOverTray(y);
        const trayTile = fromTray ? trayTileAt(event) : null;
        pressRef.current = {
            pointerId: event.pointerId,
            startX: x,
            startY: y,
            source: fromTray ? "tray" : "board",
            hits: fromTray
                ? (trayTile ? [trayTile] : [])
                // A locked stack is one entry, so a tap selects it whole and a drag lifts it whole.
                : collapseLocked(tilesAt(tiles, x / GRID_UNIT_PX, y / GRID_UNIT_PX, TILE_UNITS)),
            drag: null,
            overTray: fromTray,
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
    };

    const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        const press = pressRef.current;
        if (!press || press.pointerId !== event.pointerId) return;
        const { x, y } = pointIn(event);
        if (!press.drag) {
            if (Math.hypot(x - press.startX, y - press.startY) < DRAG_SLOP_PX) return;
            const tileId = dragTarget(press.hits, selectedId);
            const tile = press.hits.find((hit) => hit.id === tileId);
            if (!tile) return;
            // The tile re-centres on a fixed grip (bottom-middle) instead of keeping the
            // press point, so the finger never covers the stroke being placed.
            press.drag = {
                tileId: tile.id,
                offsetX: TILE_PX * DRAG_GRIP_X_FRACTION,
                offsetY: TILE_PX * DRAG_GRIP_Y_FRACTION,
                fromX: tile.x,
                fromY: tile.y,
                locked: tile.lock !== null,
            };
            setSelectedId(tile.id);
            onLift(tile.id);
        }
        // Over the tray, the tile hovers under the finger (trayHover) and fades, while its home
        // well rings: the drop would send it back. A locked stack hovers too but gets neither,
        // because the tray refuses it.
        press.overTray = isOverTray(y);
        const draggedTile = tiles.find((tile) => tile.id === press.drag!.tileId);
        const nextHoming = press.overTray && !press.drag.locked && draggedTile ? draggedTile.slot : null;
        if (nextHoming !== homingSlot) setHomingSlot(nextHoming);
        const { cols, rows } = gridRef.current;
        const snapped = () => onMove(
            press.drag!.tileId,
            snapToGrid(x - press.drag!.offsetX, GRID_UNIT_PX, cols, TILE_UNITS),
            snapToGrid(y - press.drag!.offsetY, GRID_UNIT_PX, rows, TILE_UNITS)
        );
        if (!press.overTray) {
            setTrayHover(null);
            snapped();
            return;
        }
        // A tile lifted from a mini leaves the tray at once, so its slot shows the empty well.
        if (draggedTile?.inTray) snapped();
        // Clamped to the board so the hovering tile is never cut off at its edges.
        const root = rootRef.current;
        const maxX = Math.max(0, (root?.clientWidth ?? 0) - TILE_PX);
        const maxY = Math.max(0, (root?.clientHeight ?? 0) - TILE_PX);
        setTrayHover({
            tileId: press.drag.tileId,
            x: Math.max(0, Math.min(maxX, x - press.drag.offsetX)),
            y: Math.max(0, Math.min(maxY, y - press.drag.offsetY)),
        });
    };

    const endPress = useCallback((released: boolean) => {
        const press = pressRef.current;
        pressRef.current = null;
        setHomingSlot(null);
        setTrayHover(null);
        if (!press) return;
        if (press.drag) {
            // Only a real release over the tray sends a tile home; a cancelled pointer leaves
            // it on the grid where it last snapped.
            if (released && press.overTray) {
                if (press.drag.locked) onMove(press.drag.tileId, press.drag.fromX, press.drag.fromY);
                else onReturn(press.drag.tileId);
            }
            setSelectedId(null);
            onLift(null);
        } else if (released && press.source === "tray") {
            // A tap on a mini places it on the grid, near the tray, clear of other tiles.
            const tile = press.hits[0];
            if (tile) {
                const { cols, rows } = gridRef.current;
                const infoRows = Math.ceil((infoRef.current?.offsetHeight ?? 0) / GRID_UNIT_PX);
                const spot = placementSpot(tiles, { cols, rows, tileUnits: TILE_UNITS, topUnits: infoRows + PLACE_MARGIN_UNITS, marginUnits: PLACE_MARGIN_UNITS });
                onMove(tile.id, spot.x, spot.y);
            }
        } else if (released) {
            setSelectedId((current) => nextTapSelection(press.hits, current));
        }
    }, [onLift, onMove, onReturn, tiles]);

    // The selection as a set of tiles: a locked stack is selected, and highlighted, whole.
    const selectedTileIds = useMemo(() => {
        const picked = tiles.find((tile) => tile.id === selectedId);
        if (!picked) return new Set<number>();
        if (!picked.lock) return new Set([picked.id]);
        return new Set(tiles.filter((tile) => tile.lock?.id === picked.lock!.id).map((tile) => tile.id));
    }, [tiles, selectedId]);

    // The tray hover as a pixel shift for every tile that moves with the drag (a locked stack
    // moves whole), measured from the dragged tile's last snapped cell.
    const hoverShift = useMemo(() => {
        if (!trayHover) return null;
        const dragged = tiles.find((tile) => tile.id === trayHover.tileId);
        if (!dragged) return null;
        const ids = dragged.lock ? new Set(tiles.filter((tile) => tile.lock?.id === dragged.lock!.id).map((tile) => tile.id)) : new Set([dragged.id]);
        return { ids, dx: trayHover.x - dragged.x * GRID_UNIT_PX, dy: trayHover.y - dragged.y * GRID_UNIT_PX };
    }, [tiles, trayHover]);

    return (
        <Box
            ref={rootRef}
            className="superposition-board"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={() => endPress(true)}
            onPointerCancel={() => endPress(false)}
            sx={{
                position: "relative",
                flex: 1,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
                touchAction: "none",
            }}
        >
            <Box
                ref={gridElementRef}
                className="superposition-board__grid"
                sx={{
                    position: "relative",
                    flex: 1,
                    minHeight: 0,
                    // The snapping grid, drawn so a tile's possible resting places can be seen.
                    // A radial gradient centres its dot in each cell, so the half-cell offset
                    // moves the dots onto the grid intersections a tile's corner snaps to.
                    backgroundImage: `radial-gradient(${COLORS.border} 1px, transparent 1px)`,
                    backgroundSize: `${GRID_UNIT_PX}px ${GRID_UNIT_PX}px`,
                    backgroundPosition: `${-GRID_UNIT_PX / 2}px ${-GRID_UNIT_PX / 2}px`,
                }}
            >
                <Box ref={infoRef} className="superposition-board__info" sx={{ position: "absolute", top: 0, left: 0, right: 0, pointerEvents: "none" }}>
                    {info}
                </Box>
            </Box>
            <SuperpositionTray trayRef={trayRef} tiles={tiles} layout={layout} hintedTileIds={hintedTileIds} homingSlot={homingSlot} />
            {tiles.map((tile) => {
                // A tray tile is drawn by the tray, as its mini.
                if (tile.inTray) return null;
                const selected = selectedTileIds.has(tile.id);
                // Finished = locked: a lock only forms on a finishing drop and never opens.
                const finished = tile.lock !== null;
                const hinted = hintedTileIds.includes(tile.id);
                const homing = homingSlot !== null && homingSlot === tile.slot;
                const shift = hoverShift?.ids.has(tile.id) ? hoverShift : null;
                return (
                    <Box
                        key={tile.id}
                        className={`superposition-board__tile${selected ? " superposition-board__tile--selected" : ""}${finished ? " superposition-board__tile--finished" : ""}${hinted ? " superposition-board__tile--hinted" : ""}${homing ? " superposition-board__tile--homing" : ""}`}
                        sx={{
                            position: "absolute",
                            left: 0,
                            top: 0,
                            width: TILE_PX,
                            height: TILE_PX,
                            boxSizing: "border-box",
                            borderRadius: `${CARD_SURFACE_RADIUS}px`,
                            transform: `translate(${tile.x * GRID_UNIT_PX + (shift?.dx ?? 0)}px, ${tile.y * GRID_UNIT_PX + (shift?.dy ?? 0)}px)`,
                            border: `${TILE_OUTLINE_PX}px solid ${finished ? FINISHED_INK : selected ? SELECTED_INK : hinted ? HINT_INK : COLORS.border}`,
                            opacity: homing ? HOMING_TILE_OPACITY : 1,
                            // The body stays transparent so a pile shows every stroke in it.
                            // The selection and the hint ride above without changing the pile's order.
                            zIndex: selected ? tiles.length + 1 : hinted ? tiles.length : tile.z,
                            pointerEvents: "none",
                        }}
                    >
                        {/* The stroke takes the same color as its outline; the selection outranks the hint. */}
                        <TileGlyph paths={tile.paths} fill={selected ? SELECTED_INK : hinted ? HINT_INK : COLORS.onSurface} />
                    </Box>
                );
            })}
        </Box>
    );
};

export default SuperpositionBoard;
