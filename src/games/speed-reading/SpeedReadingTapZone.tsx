import React from "react";
import { ButtonBase } from "@mui/material";
import { ZONE_TINT_CORRECT, ZONE_TINT_WRONG } from "./constants";
import type { OptionFeedback } from "./types";

interface SpeedReadingTapZoneProps {
    /** Which half this is — drives the class name. */
    side: "left" | "right";
    feedback: OptionFeedback;
    disabled: boolean;
    onPick: () => void;
}

/**
 * One half of the screen, as a tap target.
 *
 * ── The whole half is the button ────────────────────────────────────────────
 * An answer is "tap your side of the screen", not "hit the word". Under a clock
 * that difference is the whole ergonomic story: the target is half the play
 * area rather than a ~165px card, so the player can answer with a thumb from
 * wherever it already rests and never has to aim.
 *
 * These two zones are the BACKGROUND layer of the play area, stretched over the
 * full area below the header. Everything visible — the prompt and the two words
 * — floats above them in a layer the Stage marks `pointer-events: none`, so a
 * tap anywhere on a half reaches this zone no matter what is drawn on top. The
 * one exception is the prompt's speaker button, which re-enables pointer events
 * for itself; see SpeedReadingStage's content layer.
 *
 * ── The tint IS the answer feedback ─────────────────────────────────────────
 * The options used to be rounded cards that flashed green/red. With the cards
 * gone the half itself carries that signal, and with the float indicator gone it
 * is the ONLY visual cue left: only the TAPPED half tints — green if the pick
 * was right, red if it was wrong — for the feedback window. The other half is
 * never painted; see SpeedReadingStage's `feedbackFor` for why a wrong pick does
 * not light the correct side.
 *
 * As with the old buttons, the transition runs INTO feedback only. Fading back
 * to neutral would leave the previous round's colour draining out of the zone
 * while the next word is already on screen, which reads as lag.
 */
const SpeedReadingTapZone: React.FC<SpeedReadingTapZoneProps> = ({
    side,
    feedback,
    disabled,
    onPick,
}) => (
    <ButtonBase
        className={`speed-reading__zone speed-reading__zone--${side} speed-reading__zone--${feedback}`}
        disabled={disabled}
        onClick={onPick}
        // The zone paints its own full-area tint; a ripple on top of that reads
        // as a second, competing animation.
        disableRipple
        sx={{
            flex: 1,
            minWidth: 0,
            height: "100%",
            backgroundColor:
                feedback === "correct" ? ZONE_TINT_CORRECT
                : feedback === "wrong" ? ZONE_TINT_WRONG
                : "transparent",
            transition: feedback === "none"
                ? "none"
                : "background-color 140ms ease",
            // No seam down the middle (removed 2026-11-04): the halves are told
            // apart by the word centred on each.
            // Nothing here scrolls, and a drag must not become a scroll gesture.
            touchAction: "none",
        }}
    />
);

export default SpeedReadingTapZone;
