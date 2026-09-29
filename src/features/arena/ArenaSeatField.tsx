import { Box } from "@mui/material";
import { COLORS, RAMP } from "../../theme/colors";

/**
 * `.seats .fgrid` — the 25 seats of the arena you are about to join
 * (`Arena Flow - Shelf System.html` artboards A5, A6, A7, A8).
 *
 * A 5x5 grid standing in for the board that does not exist yet. Between opting in and
 * Tuesday 04:00 there is an intention and no opponents, so there is nothing to rank —
 * but "you have joined" is a thin thing to show on an otherwise empty page, and the two
 * facts a newcomer actually needs are how big the field is and what happens at its ends.
 * The grid says both without a word: twenty-five cells, five green at the top, five red
 * at the bottom.
 *
 * ── IT IS A DIAGRAM, NOT DATA ────────────────────────────────────────────────────────
 * No cell corresponds to a person. Nothing here is fetched, and it must never be wired
 * to real members: a pre-formation arena HAS no members (§ 5.3 — membership is frozen at
 * formation, which has not happened), so any "real" version of this would be a fiction
 * with a data source, which is worse than a diagram that is obviously a diagram.
 *
 * The green and red cells reuse the board's own zone fills rather than new colours, so a
 * learner meets promotion-green and demotion-red here first and recognises them on the
 * live board on Tuesday.
 *
 * ── THE LIT SEAT IS THE ONE PIECE OF STATE ───────────────────────────────────────────
 * In the `waiting` state one cell is gold — "one of these is yours". It sits in the
 * middle band deliberately: the learner has no rank yet and will not until the week
 * runs, so lighting a cell in the promotion or demotion band would promise an outcome.
 * The middle is the honest answer, and it is the same `RAMP.gld` the page's join action
 * wears, so the gold reads as "you" across both.
 *
 * Laid out in normal flow with a margin, NOT with the artboard's absolute
 * `top/bottom` offsets — those position it against a fixed 874px phone, and this page
 * scrolls on real devices of varying height.
 *
 * ── IT SHRINKS SO THE ACTION BELOW IT STAYS ON SCREEN ───────────────────────────────
 * The component is TWO boxes: an outer flex item that takes whatever height the page
 * column has spare, and the grid inside it, sized from that height. The outer box is a
 * CSS size container (`containerType: "size"`), which does two things at once:
 *   1. its content stops contributing to its own height, so it can be squeezed to the gap
 *      between the countdown and the Join button / entered card instead of forcing the
 *      column taller than the screen; and
 *   2. the grid can read that gap as `100cqh` and size its cells from it.
 * Cells are 60px tall at full size and shrink down to MIN_CELL_HEIGHT. Width shrinks by
 * the SAME number of pixels as height, so a cell keeps its full-size shape (roughly square
 * on a phone) instead of flattening into a strip — and at full size the width is exactly
 * the old `1fr`, so a tall screen looks unchanged. Only below the floor does the page
 * scroll, which is still better than clipping the action (see ArenaPage → `seatless`).
 *
 * ⚠️ The outer box must stay a flex item of a column whose height is definite (ArenaPage's
 * `arena-page__column`). Outside one it has no height to share, and collapses to its floor.
 */

/** 25 seats, five promoting, five demoting — the arena's fixed shape (§ 5). */
const SEAT_COUNT = 25;
const PROMOTE_SEATS = 5;
const RELEGATE_SEATS = 5;
/** The middle cell. See "the lit seat" above — deliberately not in either end band. */
const VIEWER_SEAT_INDEX = Math.floor(SEAT_COUNT / 2);

/** The grid is 5×5 — five rows and five columns, four gaps each way. */
const GRID_SIDE = 5;
const GAP_PX = 8;
/** Full-size cell height, reached whenever the screen has room for it. */
const CELL_HEIGHT_PX = 60;
/** Smallest a cell may shrink to before the page scrolls instead. */
const MIN_CELL_HEIGHT_PX = 28;
/** Space above the grid (below the countdown) and on either side of it. */
const MARGIN_TOP_PX = 24;
const MARGIN_SIDE_PX = 24;
const GAPS_PX = (GRID_SIDE - 1) * GAP_PX;
/** The outer box's floor: the grid at its minimum cell size, plus its top margin. */
const MIN_FIELD_HEIGHT_PX = MARGIN_TOP_PX + GRID_SIDE * MIN_CELL_HEIGHT_PX + GAPS_PX;

/**
 * Cell height: the container's height (`100cqh`) less the margin and gaps, split five
 * ways, clamped between the floor and the full-size height.
 */
const CELL_HEIGHT = `clamp(${MIN_CELL_HEIGHT_PX}px, calc((100cqh - ${MARGIN_TOP_PX + GAPS_PX}px) / ${GRID_SIDE}), ${CELL_HEIGHT_PX}px)`;
/**
 * Cell width: the full-width `1fr` column, less however many pixels the height gave up.
 * Linear on purpose — CSS `calc` cannot divide a length by a length, so a true
 * proportional scale is not expressible, and an equal-pixel shrink keeps the cell's shape
 * close enough to be indistinguishable at the sizes this reaches.
 */
const CELL_WIDTH = `calc((100cqw - ${2 * MARGIN_SIDE_PX + GAPS_PX}px) / ${GRID_SIDE} - (${CELL_HEIGHT_PX}px - var(--arena-seat-h)))`;

export interface ArenaSeatFieldProps {
    /**
     * Light one cell gold, for the `waiting` state. False in `out`, where the learner
     * has no seat and the grid is purely "this is what you would be joining".
     */
    showViewerSeat?: boolean;
    className?: string;
}

const ArenaSeatField: React.FC<ArenaSeatFieldProps> = ({ showViewerSeat = false, className }) => (
    <Box
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
        <Box
            className="arena-seat-field__grid"
            sx={{
                "--arena-seat-h": CELL_HEIGHT,
                display: "grid",
                gridTemplateColumns: `repeat(${GRID_SIDE}, ${CELL_WIDTH})`,
                gridTemplateRows: `repeat(${GRID_SIDE}, var(--arena-seat-h))`,
                justifyContent: "center",
                gap: `${GAP_PX}px`,
                margin: `${MARGIN_TOP_PX}px ${MARGIN_SIDE_PX}px 0`,
            }}
            // A decorative diagram: announced once, with its cells hidden from the tree so a
            // screen reader is not read twenty-five empty boxes.
            role="img"
            aria-label={
                showViewerSeat
                    ? "An arena of 25 seats: the top five promote, the bottom five drop, and one seat is yours."
                    : "An arena of 25 seats: the top five promote and the bottom five drop."
            }
        >
            {Array.from({ length: SEAT_COUNT }, (_, i) => {
                const isPromote = i < PROMOTE_SEATS;
                const isRelegate = i >= SEAT_COUNT - RELEGATE_SEATS;
                const isViewer = showViewerSeat && i === VIEWER_SEAT_INDEX;
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
                            // Only the empty middle cells are outlined. A filled cell needs no
                            // border to separate from the paper, and drawing one anyway would
                            // put a hairline around the zone bands that the board itself does
                            // not have.
                            border: fill === COLORS.white ? `1px solid ${COLORS.rowBorder}` : "1px solid transparent",
                        }}
                    />
                );
            })}
        </Box>
    </Box>
);

export default ArenaSeatField;
