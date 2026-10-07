import { keyframes } from "@mui/material/styles";
import { CheckCircle, Cancel } from "@mui/icons-material";
import { COLORS } from "../../theme";

/**
 * The ✓ / ✗ verdict stamped into a graded writing cell's top-right corner — the ONLY
 * verdict cue on the cell (the cell's ground stays white, so the learner's ink reads
 * against it unchanged).
 *
 * It animates on MOUNT: the icon drops in oversized and slightly turned, slams down past
 * its rest size, and settles — a rubber stamp hitting paper. Because the animation is
 * mount-driven, a caller just renders it when the verdict arrives; nothing to trigger.
 *
 * Shared by both writing surfaces so their verdicts look and move identically:
 *   - `src/games/writing-grid/WritingGridBoard.tsx` (Writing Grid board)
 *   - `src/features/flashcards/FlashcardsLearnPage/WritingCardFace.tsx` (writing flp, back face)
 * Docs: docs/WRITING_PRACTICE_REWORK.md (writing flp back face), docs/GAMES_FEATURE.md (Writing Grid).
 */

/** Stamp: big + transparent + tilted → slams to 88 % → rebounds to 106 % → rests. */
const stampIn = keyframes`
    0%   { opacity: 0; transform: scale(2.4) rotate(-14deg); }
    45%  { opacity: 1; transform: scale(0.88) rotate(2deg); }
    70%  { transform: scale(1.06) rotate(0deg); }
    100% { opacity: 1; transform: scale(1) rotate(0deg); }
`;

/** Length of the stamp motion (ms). */
export const RESULT_STAMP_MS = 420;

interface ResultStampProps {
    result: "correct" | "wrong";
    /** Rest size of the icon (px). */
    size: number;
    /** Distance from the cell's top and right edges (px). */
    inset: number;
    /**
     * Wait before stamping (ms) — e.g. the writing flp passes CARD_FLIP_MS so the stamp
     * lands once the back face has turned toward the learner, not mid-flip. The icon is
     * hidden during the wait (`animation-fill-mode: both` holds the 0 % frame).
     */
    delayMs?: number;
    className?: string;
}

export default function ResultStamp({ result, size, inset, delayMs = 0, className }: ResultStampProps) {
    const Icon = result === "correct" ? CheckCircle : Cancel;
    return (
        <Icon
            className={className}
            sx={{
                position: "absolute",
                top: inset,
                right: inset,
                fontSize: size,
                // Deliberately the ramp's MARK tier, not successInk / dangerInk: the v2 semantic
                // inks are all charcoal (colors.ts, "Semantic roles"), and this verdict must read
                // green / red at a glance. grnMk / redMk are the palette's deepest green and red —
                // the same tier the Writing Grid's "Easiest" / "Hardest" labels use as text.
                color: result === "correct" ? COLORS.grnMk : COLORS.redMk,
                // A white disc behind the glyph's transparent ✓ / ✗ cut-out, so the mark
                // stays legible where it overlaps the learner's ink.
                bgcolor: COLORS.white,
                borderRadius: "50%",
                pointerEvents: "none",
                animation: `${stampIn} ${RESULT_STAMP_MS}ms cubic-bezier(0.3, 0.7, 0.4, 1) ${delayMs}ms both`,
                "@media (prefers-reduced-motion: reduce)": { animation: "none" },
            }}
        />
    );
}
