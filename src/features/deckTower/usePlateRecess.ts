import { useEffect, useState } from "react";
import { prefersReducedMotion, RAISED_HEIGHT } from "./iso";
import { easeIn, easeOut, easeOutBack, useTween } from "./usePopUpMotion";

/**
 * usePlateRecess — the floor plate stowing itself for a study dive: it recedes into the
 * platform, leaving a plate-shaped hole, and a section of floor rises to fill the hole
 * flush; the climb back out plays it in reverse (docs/DECK_TOWER.md § "Studying the tower"
 * → "The floor fixtures").
 *
 * Layer: page logic (feature module `src/features/deckTower`). It draws nothing:
 * DeckTowerPlatform hands `plug` and `top` to IsoFloorRecess, and `top` to the pawns as the
 * plate's step height, so a pawn standing on the plate rides it down into the hole and back
 * up with the floor.
 *
 *   stowed false → true : the PLATE sinks from its raised rest to RECESS_DEPTH below the
 *                         floor (RECEDE_MS, ease-in), the empty hole holds HOLE_HOLD_MS,
 *                         then the plug is swapped for FLOOR — at the same depth, so nothing
 *                         jumps — which rises flush (REFILL_MS, ease-out, no overshoot).
 *   stowed true → false : the floor plug sinks, the hole holds, the plate rises back to rest
 *                         with the push button's small spring.
 *
 * A reversal mid-sequence retargets whatever is moving: a plug on its way down comes back up
 * if it is again the one wanted. Under prefers-reduced-motion the moves jump and the hold is
 * skipped — and so does a change made while `instant` is set: the wanted plug is simply put
 * in at rest (the platform is faded out, so there is nothing to watch — DeckTowerPage
 * `snapFixtures`, docs/DECK_TOWER.md § "Studying the tower" → "Hiding the platform").
 */

/** World units below the floor the plug's top goes before the swap: a visible hole, deeper than the plate is tall. */
export const RECESS_DEPTH = 0.6;
const RECEDE_MS = 380;
const HOLE_HOLD_MS = 120;
const REFILL_MS = 460;

export type PlatePlug = "plate" | "floor";

export interface PlateRecess {
    /** What fills the plate's opening right now. */
    plug: PlatePlug;
    /** The plug's top, in world units above the floor (the plate rests at RAISED_HEIGHT, floor at 0). */
    top: number;
    /** Settled: the plate standing at rest (a pressable button again) or the floor flush. */
    atRest: boolean;
}

const restTop = (plug: PlatePlug) => (plug === "plate" ? RAISED_HEIGHT : 0);

export function usePlateRecess(stowed: boolean, instant = false): PlateRecess {
    const wanted: PlatePlug = stowed ? "floor" : "plate";
    const [plug, setPlug] = useState<PlatePlug>(wanted);
    const [target, setTarget] = useState(restTop(wanted));

    // A change of `stowed`: the plug in the hole goes down unless it is already the wanted one
    // (a reversal), which comes back up instead. Made `instant`: the wanted plug at rest, now.
    useEffect(() => {
        if (instant) {
            setPlug(wanted);
            setTarget(restTop(wanted));
            return;
        }
        setTarget(plug === wanted ? restTop(plug) : -RECESS_DEPTH);
        // Only a change of `stowed` restarts the sequence; `plug` and `instant` are read as
        // they stand then.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [stowed]);

    const sinking = target < 0;
    const top = useTween(target, instant ? 0 : sinking ? RECEDE_MS : REFILL_MS, sinking ? easeIn : plug === "plate" ? easeOutBack : easeOut);

    // Bottomed out with the wrong plug: hold the empty hole a beat, then swap the plugs at
    // the bottom and bring the wanted one up.
    useEffect(() => {
        if (plug === wanted || target !== -RECESS_DEPTH || top !== -RECESS_DEPTH) return;
        const timer = window.setTimeout(
            () => {
                setPlug(wanted);
                setTarget(restTop(wanted));
            },
            prefersReducedMotion() ? 0 : HOLE_HOLD_MS
        );
        return () => window.clearTimeout(timer);
    }, [plug, wanted, target, top]);

    const rest = restTop(plug);
    return { plug, top, atRest: plug === wanted && target === rest && top === rest };
}
