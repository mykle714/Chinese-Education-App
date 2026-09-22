import { Box } from "@mui/material";
import Icon from "../../components/Icon";
import { Board } from "../../components/leaderboard/Board";
import { COLORS } from "../../theme/colors";

/**
 * `.bd.locked` — the frozen board (`Arena Flow - Shelf System.html` A9, A10, A11).
 *
 * The same `Board` the live week uses, wearing a heavy gold frame with a padlock
 * medallion straddling its top edge. Drawn only in the `results` state, where the week
 * has closed at Sunday 16:00 and the scores can no longer move.
 *
 * ── WHY THE BOARD IS STILL SHOWN AT ALL ─────────────────────────────────────────────
 * The outcome card above it states what happened in one sentence. The board underneath
 * is the EXPLANATION, and the design deliberately leaves it readable through the whole
 * break rather than collapsing it: a learner who dropped a rung wants to see by how much,
 * and a page that only says "you were demoted" and hides the evidence reads as a verdict.
 *
 * ── THE FRAME IS WHY THIS IS A WRAPPER AND NOT A `Board` PROP ───────────────────────
 * `Board` sets `overflow: hidden` so its rows' tints clip to its radius. A 7px border on
 * that same element would sit INSIDE the clip and eat the first and last row's corners,
 * and the medallion — which must straddle the top edge — would be clipped away entirely.
 * So the frame is a box AROUND the board, and the medallion is a sibling of it rather
 * than a child. Nothing about locking belongs in the shared primitive: /arena is the only
 * board in the app that ever freezes.
 *
 * ── THE GOLD IS THE FRAME'S, NOT THE ACTION'S ───────────────────────────────────────
 * `COLORS.gldFrame`, a step duller than `RAMP.gld.fill`. They are deliberately different:
 * the join button directly above this is the page's one thing to tap, and ringing a
 * finished, inert table in that exact colour would invite a tap on it. Antique gold reads
 * as metal; the button's gold reads as go.
 */
export interface LockedBoardProps {
    /** `BoardRow`s and `BoardZone`s, exactly as a live board takes them. */
    children: React.ReactNode;
    className?: string;
}

/** Half the medallion's size, so it straddles the frame's top edge evenly. */
const MEDALLION = 34;

const LockedBoard: React.FC<LockedBoardProps> = ({ children, className }) => (
    <Box
        className={className ? `locked-board ${className}` : "locked-board"}
        sx={{
            position: "relative",
            // The frame's own margin replaces the Board's, which is zeroed below —
            // otherwise the board would inset a second time inside its own frame.
            margin: "9px 18px 0",
            border: `7px solid ${COLORS.gldFrame}`,
            // 16 + the 7px frame lands on the Board's own 18px outer radius.
            borderRadius: "23px",
            // Room for the medallion to hang above the frame without being clipped.
            overflow: "visible",
        }}
    >
        <Board sx={{ margin: 0, border: "none", borderRadius: "16px" }}>{children}</Board>
        <Box
            className="locked-board__lock"
            aria-hidden
            sx={{
                position: "absolute",
                top: 0,
                left: "50%",
                transform: "translate(-50%, -50%)",
                zIndex: 2,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: `${MEDALLION}px`,
                height: `${MEDALLION}px`,
                borderRadius: "50%",
                backgroundColor: COLORS.gldFrame,
            }}
        >
            <Icon name="lock" size={21} color={COLORS.white} fill={1} />
        </Box>
    </Box>
);

export default LockedBoard;
