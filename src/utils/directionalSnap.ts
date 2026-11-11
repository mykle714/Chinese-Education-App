/**
 * directionalSnap — the one "which of two stops does a release go to" rule shared by
 * td's tower ↔ cards snap zone and the SheetPanel's {open height, max} stops (the eip's
 * maximize / shrink).
 *
 * The rule depends on the LAST DIRECTION the position was moving, not just where it sits:
 * moving towards the HIGH stop, it commits to it once `commitShare` of the gap past the
 * LOW stop; moving towards the LOW stop, it commits once `commitShare` of the gap short of
 * the HIGH stop. Short of that it springs back to the stop it left. With no direction known
 * it falls back to the halfway point. So a small `commitShare` (0.25) makes both trips
 * easy — a quarter-gap push either way takes — while a release that turns back on itself
 * returns home. At `commitShare = 0.5` the rule is plain nearest-stop in either direction.
 *
 * "Low" and "high" are just the two ends of a number line: td passes scrollTops (platform
 * line < cards line), SheetPanel passes heights (open height < max).
 *
 * Layer: shared pure utility. No DOM, no React — unit-testable.
 * Read by: src/features/deckTower/towerScroll.ts → snapTargetOf,
 *          src/components/sheet/SheetPanel.tsx → computeSnapTarget.
 * Docs: docs/DECK_TOWER.md § "The snap zone", docs/EIP_SHEET_GESTURES.md § "Height model".
 */

/** +1 = moving towards the high stop, −1 = towards the low stop, 0 = unknown. */
export type SnapDirection = -1 | 0 | 1;

/**
 * A step smaller than this does not change the remembered direction, px — so the last
 * jitter of a finger lifting (or a decelerating fling's sub-pixel frames) cannot flip a
 * deliberate gesture's direction.
 */
export const DIRECTION_MIN_STEP_PX = 2;

/**
 * The next remembered direction after a step from `prev` to `next`: the step's sign, or
 * the current direction unchanged when the step is under `DIRECTION_MIN_STEP_PX`.
 */
export const nextSnapDirection = (current: SnapDirection, prev: number, next: number): SnapDirection =>
    Math.abs(next - prev) >= DIRECTION_MIN_STEP_PX ? (next > prev ? 1 : -1) : current;

/** Which stop (`low` or `high`) a release at `pos`, last moving `direction`, goes to. */
export const directionalSnapTarget = (
    pos: number,
    low: number,
    high: number,
    direction: SnapDirection,
    commitShare: number,
): number => {
    const gap = high - low;
    const breakpoint =
        direction > 0
            ? low + gap * commitShare // heading for high: commit early, measured from low
            : direction < 0
              ? high - gap * commitShare // heading for low: commit early, measured from high
              : low + gap / 2;
    return pos < breakpoint ? low : high;
};
