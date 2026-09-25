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
 */

/** 25 seats, five promoting, five demoting — the arena's fixed shape (§ 5). */
const SEAT_COUNT = 25;
const PROMOTE_SEATS = 5;
const RELEGATE_SEATS = 5;
/** The middle cell. See "the lit seat" above — deliberately not in either end band. */
const VIEWER_SEAT_INDEX = Math.floor(SEAT_COUNT / 2);

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
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            gap: "8px",
            margin: "24px 24px 0",
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
                        height: "60px",
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
);

export default ArenaSeatField;
