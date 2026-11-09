import { Box, useMediaQuery } from "@mui/material";
import { keyframes } from "@mui/material/styles";
import { COLORS, SHADOW } from "../../../../theme";
import { SIZE, WEIGHT } from "../../../../theme/scale";
import { OUCH_EXIT_MS } from "./usePawnOuch";

/**
 * PawnOuchBubble — the hint pawn's reply to a tap it doesn't jump at: a short "ouch" line
 * in a small speech bubble up and to the right of its head, OVER the flashcard
 * (docs/HINT_PAWN.md § "Tap reactions"). A different kind of dialogue from the hint bubble:
 * it says nothing about the card, never touches the hint bubble, and is gone after a couple
 * of seconds (usePawnOuch → OUCH_TTL_MS).
 *
 * ── Motion ───────────────────────────────────────────────────────────────────
 * IN: it grows out of the pawn (the tail tip, at the head) and INFLATES like a balloon, then
 * settles at full size with one light wobble — a squash-and-stretch whose swings shrink to
 * rest with no ringing (`ouchInflate`). OUT: it fades away while dropping (`ouchLeave`).
 * Reduced motion: plain fades.
 *
 * Its wrapper (HintPawn) is placed at the TAIL TIP; the body sits up and to the right of it.
 * Inert (`pointer-events: none`): it covers the card, and a tap there must still reach the
 * card. Same surface as the hint bubble (white, the app outline, `SHADOW.chip`) so the two
 * read as the same pawn talking.
 *
 * Layer: flp page presentation (client). Depended on by: hintPawn/HintPawn.tsx.
 */

/** The tail: a small turned square under the body's bottom-left, its tip at the wrapper's origin. */
const TAIL_SIZE = 7;
/** The tail's centre, px in from the body's left edge. */
const TAIL_INSET = 12;
const INFLATE_MS = 560;

// The balloon: from a speck at the tail tip, a quick inflate to full size (ease-out per
// segment), then the wobble — wider-and-shorter, then a smaller taller-and-thinner, then rest.
// Each swing is smaller than the last and the final segment eases into scale 1 without
// passing it, which is the "perfectly damped" read the owner asked for (2026-11-08).
const ouchInflate = keyframes({
    "0%": { transform: "scale(0.12)", opacity: 0 },
    "10%": { opacity: 1 },
    "52%": { transform: "scale(1, 1)" },
    "70%": { transform: "scale(1.045, 0.96)" },
    "86%": { transform: "scale(0.985, 1.015)" },
    "100%": { transform: "scale(1, 1)", opacity: 1 },
});
// Gone: a fade while dropping down, as if let go.
const ouchLeave = keyframes({
    "0%": { transform: "translateY(0)", opacity: 1 },
    "100%": { transform: "translateY(16px)", opacity: 0 },
});
const fadeIn = keyframes({ from: { opacity: 0 }, to: { opacity: 1 } });
const fadeOut = keyframes({ from: { opacity: 1 }, to: { opacity: 0 } });

interface PawnOuchBubbleProps {
    line: string;
    phase: "in" | "out";
}

export default function PawnOuchBubble({ line, phase }: PawnOuchBubbleProps) {
    const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
    const animation =
        phase === "out"
            ? `${reduceMotion ? fadeOut : ouchLeave} ${OUCH_EXIT_MS}ms ease-in forwards`
            : `${reduceMotion ? fadeIn : ouchInflate} ${INFLATE_MS}ms ease-out both`;
    return (
        <Box
            className={phase === "out" ? "pawn-ouch-bubble pawn-ouch-bubble--leaving" : "pawn-ouch-bubble"}
            role="status"
            sx={{
                position: "absolute",
                left: -TAIL_INSET,
                bottom: TAIL_SIZE,
                // Grow out of the tail's tip, i.e. out of the pawn.
                transformOrigin: `${TAIL_INSET}px calc(100% + ${TAIL_SIZE}px)`,
                animation,
                pointerEvents: "none",
                whiteSpace: "nowrap",
                px: 1,
                py: 0.5,
                backgroundColor: COLORS.white,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 2,
                boxShadow: SHADOW.chip,
                fontSize: SIZE.caption,
                fontWeight: WEIGHT.semibold,
                lineHeight: 1.3,
                color: COLORS.onSurface,
                // The tail: the hint bubble's turned square, showing only its two outward
                // borders so it reads as one outline with the body.
                "&::after": {
                    content: '""',
                    position: "absolute",
                    left: TAIL_INSET - TAIL_SIZE / 2,
                    bottom: -TAIL_SIZE / 2 - 1,
                    width: TAIL_SIZE,
                    height: TAIL_SIZE,
                    backgroundColor: "inherit",
                    transform: "rotate(45deg)",
                    borderRight: `1px solid ${COLORS.border}`,
                    borderBottom: `1px solid ${COLORS.border}`,
                },
            }}
        >
            {line}
        </Box>
    );
}
