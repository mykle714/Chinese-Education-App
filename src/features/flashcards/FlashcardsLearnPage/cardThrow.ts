import { FLY_OUT_ROTATION, FLY_OUT_X } from "../constants";

/**
 * The "grab and throw": a card sent off by a TAP, so it has no release point to fly from.
 * It lifts (grows, rises, tilts a touch toward its exit side), then accelerates off along
 * a swiping arc, sideways with a rising-then-falling y and a growing tilt, like a hand
 * flicking it. One CARD_FLY_OUT_MS long.
 *
 * Per-segment timing: the lift eases out; the throw eases IN, which reads as acceleration.
 *
 * The one definition of the motion, read as CSS keyframes by the writing flp's card
 * (FlashCardSection → `writingThrowKeyframes`) and through the Web Animations API by a
 * tapped results card (gameBreak/BreakCardLayer).
 * Docs: docs/WRITING_PRACTICE_REWORK.md § 3, docs/FLP_GAME_BREAKS.md § 5b.
 */
export interface CardThrowStep {
    /** 0–1 through the throw. */
    offset: number;
    transform: string;
    /** Timing of the segment that STARTS here; the last step has none. */
    easing?: string;
}

const LIFT_OFFSET = 0.3;
// How much the card grows as it is "picked up", held through the throw so it reads as
// still in hand. 1.05 was too subtle to register in a ~110 ms lift.
const LIFT_SCALE = 1.1;
// How far (px) the card rises during the lift. The arc keeps climbing a little past it
// (to 60%) before falling away, so the mid-throw y is derived from this.
const LIFT_RISE_PX = 40;

export function cardThrowSteps(sign: 1 | -1): CardThrowStep[] {
    return [
        {
            offset: 0,
            transform: "translate(0px, 0px) rotate(0deg) scale(1)",
            easing: "cubic-bezier(0.2, 0.8, 0.3, 1)",
        },
        {
            offset: LIFT_OFFSET,
            transform: `translate(${sign * 14}px, ${-LIFT_RISE_PX}px) rotate(${sign * 3}deg) scale(${LIFT_SCALE})`,
            easing: "cubic-bezier(0.5, 0, 0.9, 0.5)",
        },
        {
            offset: 0.6,
            transform: `translate(${sign * FLY_OUT_X * 0.3}px, ${-(LIFT_RISE_PX + 16)}px) rotate(${sign * FLY_OUT_ROTATION * 0.45}deg) scale(${LIFT_SCALE})`,
            easing: "cubic-bezier(0.4, 0, 1, 1)",
        },
        {
            offset: 1,
            transform: `translate(${sign * FLY_OUT_X}px, 40px) rotate(${sign * FLY_OUT_ROTATION}deg) scale(${LIFT_SCALE})`,
        },
    ];
}
