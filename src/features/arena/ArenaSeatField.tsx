import { useLayoutEffect, useRef, useState } from "react";
import { Box } from "@mui/material";
import { COLORS, RAMP } from "../../theme/colors";

/**
 * `.seats .fgrid` — the seats of the arena you are about to join
 * (`Arena Flow - Shelf System.html` artboards A5, A6, A7, A8).
 *
 * A grid of seats standing in for the board that does not exist yet. Between opting in
 * and Tuesday 04:00 there is an intention and no opponents, so there is nothing to rank —
 * but "you have joined" is a thin thing to show on an otherwise empty page, and the fact a
 * newcomer actually needs is what happens at the field's ends. The grid says it without a
 * word: the top row is green, the bottom row is red.
 *
 * ── IT IS A DIAGRAM, NOT DATA ────────────────────────────────────────────────────────
 * No cell corresponds to a person. Nothing here is fetched, and it must never be wired
 * to real members: a pre-formation arena HAS no members (§ 5.3 — membership is frozen at
 * formation, which has not happened), so any "real" version of this would be a fiction
 * with a data source, which is worse than a diagram that is obviously a diagram.
 * That is also why the column count is free to vary with the screen (below): the cell
 * count is not a claim about the arena's size (25, § 5).
 *
 * The green and red cells reuse the board's own zone fills rather than new colours, so a
 * learner meets promotion-green and demotion-red here first and recognises them on the
 * live board on Tuesday.
 *
 * ── THE LIT SEAT IS THE ONE PIECE OF STATE ───────────────────────────────────────────
 * In the `waiting` state one cell is gold — "one of these is yours". It sits in the
 * middle row deliberately: the learner has no rank yet and will not until the week
 * runs, so lighting a cell in the promotion or demotion band would promise an outcome.
 * The middle is the honest answer, and it is the same `RAMP.gld` the page's join action
 * wears, so the gold reads as "you" across both.
 *
 * ── FIVE ROWS, AS MANY COLUMNS AS FIT ───────────────────────────────────────────────
 * The component is TWO boxes: an outer flex item that takes whatever height the page
 * column has spare, and the grid inside it. The outer box is a CSS size container
 * (`containerType: "size"`), so its content does not contribute to its own height — it
 * can be squeezed to the gap between the countdown and the Join button / entered card
 * instead of forcing the column taller than the screen.
 *
 * `useSeatFieldGeometry` measures that box and derives the layout in JS:
 *   - the ROW count is fixed at five (promote / three middle / relegate);
 *   - the square cell size comes from the HEIGHT — the gap less both margins and the row
 *     gaps, split five ways, clamped to [MIN_CELL_PX, MAX_CELL_PX];
 *   - the COLUMN count is however many cells of that size fit the width.
 * So a short screen gets smaller cells and more columns rather than squashed cells, and a
 * tall phone (cells at 60px) gets the original five columns. The bottom margin keeps the
 * last row off the action below it — the grid used to fill the box exactly, so on a short
 * screen the red row sat flush against Join. Only below the cell floor does the page
 * scroll (see ArenaPage → `seatless`).
 *
 * ⚠️ The outer box must stay a flex item of a column whose height is definite (ArenaPage's
 * `arena-page__column`). Outside one it has no height to share, and collapses to its floor.
 */

/** Fixed: one promotion row, three middle rows, one relegation row. */
const ROWS = 5;
/** The middle row, where the viewer's seat is lit. See "the lit seat" above. */
const VIEWER_ROW = Math.floor(ROWS / 2);

const GAP_PX = 8;
/** Full-size (square) cell, reached whenever the screen has room for it. */
const MAX_CELL_PX = 60;
/** Smallest a cell may shrink to before the page scrolls instead. */
const MIN_CELL_PX = 28;
/** Space above the grid (below the countdown), below it (above the action) and beside it. */
const MARGIN_TOP_PX = 24;
const MARGIN_BOTTOM_PX = 20;
const MARGIN_SIDE_PX = 24;
const ROW_GAPS_PX = (ROWS - 1) * GAP_PX;
/** The outer box's floor: the grid at its minimum cell size, plus both margins. */
const MIN_FIELD_HEIGHT_PX = MARGIN_TOP_PX + MARGIN_BOTTOM_PX + ROWS * MIN_CELL_PX + ROW_GAPS_PX;

interface SeatFieldGeometry {
    cellPx: number;
    columns: number;
}

/**
 * Measures the outer (size-contained) box and returns the cell size + column count.
 * `null` until the first measurement, so the grid never paints at a guessed size.
 */
function useSeatFieldGeometry() {
    const fieldRef = useRef<HTMLDivElement | null>(null);
    const [geometry, setGeometry] = useState<SeatFieldGeometry | null>(null);

    useLayoutEffect(() => {
        const el = fieldRef.current;
        if (!el) return;
        const measure = () => {
            const { clientWidth: width, clientHeight: height } = el;
            const fitByHeight = Math.floor((height - MARGIN_TOP_PX - MARGIN_BOTTOM_PX - ROW_GAPS_PX) / ROWS);
            const cellPx = Math.min(MAX_CELL_PX, Math.max(MIN_CELL_PX, fitByHeight));
            // n cells + (n-1) gaps <= usable width  ⇔  n <= (usable + gap) / (cell + gap)
            const usableWidth = width - 2 * MARGIN_SIDE_PX;
            const columns = Math.max(1, Math.floor((usableWidth + GAP_PX) / (cellPx + GAP_PX)));
            // Skip no-op updates so a ResizeObserver tick does not re-render for nothing.
            setGeometry((prev) =>
                prev && prev.cellPx === cellPx && prev.columns === columns ? prev : { cellPx, columns },
            );
        };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    return { fieldRef, geometry };
}

export interface ArenaSeatFieldProps {
    /**
     * Light one cell gold, for the `waiting` state. False in `out`, where the learner
     * has no seat and the grid is purely "this is what you would be joining".
     */
    showViewerSeat?: boolean;
    className?: string;
}

const ArenaSeatField: React.FC<ArenaSeatFieldProps> = ({ showViewerSeat = false, className }) => {
    const { fieldRef, geometry } = useSeatFieldGeometry();
    const columns = geometry?.columns ?? 0;
    // Centre column (left-of-centre when the count is even).
    const viewerSeatIndex = VIEWER_ROW * columns + Math.floor((columns - 1) / 2);

    return (
        <Box
            ref={fieldRef}
            className={className ? `arena-seat-field ${className}` : "arena-seat-field"}
            sx={{
                // Grow into spare height, never shrink below the floor. The size containment
                // is what lets it be SMALLER than the grid's full size — see the note above.
                flex: "1 0 auto",
                minHeight: `${MIN_FIELD_HEIGHT_PX}px`,
                containerType: "size",
                // Centres the grid vertically in whatever height it was given.
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
            }}
        >
            {geometry && (
                <Box
                    className="arena-seat-field__grid"
                    sx={{
                        display: "grid",
                        gridTemplateColumns: `repeat(${columns}, ${geometry.cellPx}px)`,
                        gridTemplateRows: `repeat(${ROWS}, ${geometry.cellPx}px)`,
                        justifyContent: "center",
                        gap: `${GAP_PX}px`,
                        margin: `${MARGIN_TOP_PX}px ${MARGIN_SIDE_PX}px ${MARGIN_BOTTOM_PX}px`,
                    }}
                    // A decorative diagram: announced once, with its cells hidden from the tree
                    // so a screen reader is not read every empty box.
                    role="img"
                    aria-label={
                        showViewerSeat
                            ? "An arena of seats: the top row promotes, the bottom row drops, and one seat is yours."
                            : "An arena of seats: the top row promotes and the bottom row drops."
                    }
                >
                    {Array.from({ length: ROWS * columns }, (_, i) => {
                        const row = Math.floor(i / columns);
                        const isPromote = row === 0;
                        const isRelegate = row === ROWS - 1;
                        const isViewer = showViewerSeat && i === viewerSeatIndex;
                        const fill = isViewer
                            ? RAMP.gld.surface
                            : isPromote
                              ? RAMP.grn.mid
                              : isRelegate
                                ? RAMP.red.mid
                                : COLORS.white;
                        return (
                            <Box
                                key={i}
                                aria-hidden
                                className={[
                                    "arena-seat-field__seat",
                                    isPromote ? "arena-seat-field__seat--promote" : "",
                                    isRelegate ? "arena-seat-field__seat--relegate" : "",
                                    isViewer ? "arena-seat-field__seat--viewer" : "",
                                ]
                                    .filter(Boolean)
                                    .join(" ")}
                                sx={{
                                    borderRadius: "9px",
                                    backgroundColor: fill,
                                    // Only the empty middle cells are outlined. A filled cell needs
                                    // no border to separate from the paper, and drawing one anyway
                                    // would put a hairline around the zone bands that the board
                                    // itself does not have.
                                    border:
                                        fill === COLORS.white
                                            ? `1px solid ${COLORS.rowBorder}`
                                            : "1px solid transparent",
                                }}
                            />
                        );
                    })}
                </Box>
            )}
        </Box>
    );
};

export default ArenaSeatField;
