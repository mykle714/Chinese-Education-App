import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Box } from "@mui/material";
import { COLORS, RAMP } from "../../theme/colors";
import { CARD_SURFACE_RADIUS } from "../../theme/surfaces";
import { dragTarget, nextTapSelection, snapToGrid, stackKey, tilesAt, type Tile } from "./board";
import { DRAG_SLOP_PX, GRID_UNIT_PX, TILE_OUTLINE_PX, TILE_PX, TILE_UNITS } from "./constants";

/** The hanzi-writer glyph box, Y-up (see GlyphSvg). */
const GLYPH_VIEW_BOX = "0 0 1024 1024";
const GLYPH_TRANSFORM = "translate(0,900) scale(1,-1)";

/** The selected stroke's highlight. Purple stays clear of the ink, the teal ground and the green finish. */
const SELECTED_INK = RAMP.pur.mark;
/** A finished stack's outline. */
const FINISHED_OUTLINE = RAMP.grn.mark;
/** A hinted tile's outline. Orange stays clear of the selection, the finish and the teal ground. */
const HINT_OUTLINE = RAMP.org.mark;

interface SuperpositionBoardProps {
    tiles: Tile[];
    /** Keys of the finished stacks (`stackKey`). */
    finishedStacks: ReadonlySet<string>;
    /** The tiles the hint button pointed at. */
    hintedTileIds: readonly number[];
    /** The tile held in a drag. It is not judged, so it never reads as finished. */
    liftedId: number | null;
    /** Input is off once the run is over. */
    locked: boolean;
    /** The word info, drawn on the grid under the tiles. */
    info: ReactNode;
    /** `infoRows`: the grid rows the info covers, so the deal can start tiles below it. */
    onMeasured: (cols: number, rows: number, infoRows: number) => void;
    onMove: (tileId: number, x: number, y: number) => void;
    /** A drag took a tile, or (null) put it down. */
    onLift: (tileId: number | null) => void;
}

/** A press in progress. All in a ref: a pointer move must not wait on a render. */
interface Press {
    pointerId: number;
    startX: number;
    startY: number;
    /** The tiles under the press, topmost first. */
    hits: Tile[];
    /** Set once the press travels far enough to be a drag. */
    drag: { tileId: number; offsetX: number; offsetY: number } | null;
}

/**
 * The play surface: one pointer handler over absolutely placed tiles, because a press must
 * reach every tile in a pile, not only the top element.
 *
 * A tap walks the pile under the finger (`nextTapSelection`), highlighting the selected
 * stroke. A drag lifts the selection if it is in that pile, else the top tile, and the tile
 * snaps cell to cell under the finger. Dropping clears the selection.
 *
 * Layer: game component, presentational over `board.ts`. The Stage owns the tiles.
 */
const SuperpositionBoard: React.FC<SuperpositionBoardProps> = ({ tiles, finishedStacks, hintedTileIds, liftedId, locked, info, onMeasured, onMove, onLift }) => {
    const boardRef = useRef<HTMLDivElement | null>(null);
    const infoRef = useRef<HTMLDivElement | null>(null);
    const pressRef = useRef<Press | null>(null);
    const gridRef = useRef({ cols: 0, rows: 0 });
    const [selectedId, setSelectedId] = useState<number | null>(null);

    useEffect(() => {
        const element = boardRef.current;
        if (!element) return;
        const observer = new ResizeObserver(() => {
            const cols = Math.floor(element.clientWidth / GRID_UNIT_PX);
            const rows = Math.floor(element.clientHeight / GRID_UNIT_PX);
            gridRef.current = { cols, rows };
            const infoRows = Math.ceil((infoRef.current?.offsetHeight ?? 0) / GRID_UNIT_PX);
            if (cols > 0 && rows > 0) onMeasured(cols, rows, infoRows);
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, [onMeasured]);

    const pointIn = (event: React.PointerEvent) => {
        const rect = boardRef.current?.getBoundingClientRect();
        return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
    };

    const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        if (locked || pressRef.current) return;
        const { x, y } = pointIn(event);
        pressRef.current = {
            pointerId: event.pointerId,
            startX: x,
            startY: y,
            hits: tilesAt(tiles, x / GRID_UNIT_PX, y / GRID_UNIT_PX, TILE_UNITS),
            drag: null,
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
            press.drag = {
                tileId: tile.id,
                offsetX: press.startX - tile.x * GRID_UNIT_PX,
                offsetY: press.startY - tile.y * GRID_UNIT_PX,
            };
            setSelectedId(tile.id);
            onLift(tile.id);
        }
        const { cols, rows } = gridRef.current;
        onMove(
            press.drag.tileId,
            snapToGrid(x - press.drag.offsetX, GRID_UNIT_PX, cols, TILE_UNITS),
            snapToGrid(y - press.drag.offsetY, GRID_UNIT_PX, rows, TILE_UNITS)
        );
    };

    const endPress = useCallback((tapped: boolean) => {
        const press = pressRef.current;
        pressRef.current = null;
        if (!press) return;
        if (press.drag) {
            setSelectedId(null);
            onLift(null);
        } else if (tapped) {
            setSelectedId((current) => nextTapSelection(press.hits, current));
        }
    }, [onLift]);

    const finishedTileIds = useMemo(
        () => new Set(tiles.filter((tile) => tile.id !== liftedId && finishedStacks.has(stackKey(tile))).map((tile) => tile.id)),
        [tiles, finishedStacks, liftedId]
    );

    return (
        <Box
            ref={boardRef}
            className="superposition-board"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={() => endPress(true)}
            onPointerCancel={() => endPress(false)}
            sx={{
                position: "relative",
                flex: 1,
                minHeight: 0,
                overflow: "hidden",
                touchAction: "none",
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
            {tiles.map((tile) => {
                const selected = tile.id === selectedId;
                const finished = finishedTileIds.has(tile.id);
                const hinted = hintedTileIds.includes(tile.id);
                return (
                    <Box
                        key={tile.id}
                        className={`superposition-board__tile${selected ? " superposition-board__tile--selected" : ""}${finished ? " superposition-board__tile--finished" : ""}${hinted ? " superposition-board__tile--hinted" : ""}`}
                        sx={{
                            position: "absolute",
                            left: 0,
                            top: 0,
                            width: TILE_PX,
                            height: TILE_PX,
                            boxSizing: "border-box",
                            borderRadius: `${CARD_SURFACE_RADIUS}px`,
                            transform: `translate(${tile.x * GRID_UNIT_PX}px, ${tile.y * GRID_UNIT_PX}px)`,
                            border: `${TILE_OUTLINE_PX}px solid ${finished ? FINISHED_OUTLINE : selected ? SELECTED_INK : hinted ? HINT_OUTLINE : COLORS.border}`,
                            // The body stays transparent so a pile shows every stroke in it.
                            // The selection and the hint ride above without changing the pile's order.
                            zIndex: selected ? tiles.length + 1 : hinted ? tiles.length : tile.z,
                            pointerEvents: "none",
                        }}
                    >
                        <svg className="superposition-board__stroke" viewBox={GLYPH_VIEW_BOX} width="100%" height="100%" aria-hidden>
                            <g transform={GLYPH_TRANSFORM}>
                                {tile.paths.map((path) => (
                                    <path key={path} d={path} fill={selected ? SELECTED_INK : COLORS.onSurface} />
                                ))}
                            </g>
                        </svg>
                    </Box>
                );
            })}
        </Box>
    );
};

export default SuperpositionBoard;
