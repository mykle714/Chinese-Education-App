import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "./iso";

/**
 * useBuildProgress.ts — a tower's build-up: the fraction of its deck standing on the
 * platform, 0 → 1, over time (docs/DECK_TOWER.md § "Build-up").
 *
 * Layer: page logic (feature module `src/features/deckTower`). DeckTowerPage runs one per
 * world (towerWorlds.ts); IsoCardStack draws the result
 * as its `progress`.
 */

/**
 * How fast the tower builds up, in cards per second. A CONSTANT cruising pace: the
 * build-up takes as long as the deck needs, rather than squeezing every deck into one
 * fixed duration — which made a big deck shoot up visibly faster than a small one.
 * Raised from 30 on 2026-10-17.
 */
const BUILD_CARDS_PER_SECOND = 40;

/**
 * The last this-many cards DECELERATE to a stop instead of arriving at full speed. The
 * whole deck decelerates when it is smaller than this. Raised from 40 on 2026-10-18 so
 * the slowdown reads as a deliberate braking rather than a brief stutter at the top.
 */
const BUILD_DECEL_CARDS = 60;

/**
 * The power of the settle phase's ease-out, 1 − (1 − u)^p. A higher power brakes
 * harder early and then crawls longer over the last few cards — the "lingering" feel.
 * Raised from 2 (quadratic) to 3 (cubic) on 2026-10-18.
 */
const BUILD_DECEL_POWER = 3;

/**
 * The build-up's timeline: cards on the tower `elapsedS` seconds in, for a deck of
 * `count`. Pure, so the hook below only has to drive the clock.
 *
 *   CRUISE  the first (count − K) cards at a steady BUILD_CARDS_PER_SECOND;
 *   SETTLE  the last K = min(count, BUILD_DECEL_CARDS) on a power-p ease-out
 *           (p = BUILD_DECEL_POWER).
 *
 * The settle phase is timed to START at the cruising speed: an ease-out
 * 1 − (1 − u)^p covering K cards in T seconds leaves at pK/T cards/s, so T = pK / speed.
 * The speed is therefore continuous where the phases meet — no lurch as the brakes come
 * on — and falls smoothly to zero on the last card. (For K = 60, p = 3 the settle takes
 * 4.5 s.)
 */
function buildTimeline(count: number): { durationS: number; cardsAt: (elapsedS: number) => number } {
    const v = BUILD_CARDS_PER_SECOND;
    const p = BUILD_DECEL_POWER;
    const settleCards = Math.min(count, BUILD_DECEL_CARDS);
    const cruiseCards = count - settleCards;
    const cruiseS = cruiseCards / v;
    const settleS = (p * settleCards) / v;
    return {
        durationS: cruiseS + settleS,
        cardsAt: (t) => {
            if (t <= cruiseS) return v * t;
            const u = Math.min(1, (t - cruiseS) / settleS);
            return cruiseCards + settleCards * (1 - (1 - u) ** p);
        },
    };
}

/**
 * Animates the build-up 0 → 1 (the fraction of the deck on the tower) along
 * `buildTimeline` once `ready` turns true. Snaps straight to 1 under
 * prefers-reduced-motion. Falling back to not-ready resets it to 0, so the next deck's
 * tower (useDeckSwap's empty-platform beat) grows from nothing rather than flashing in
 * at full height for a frame.
 *
 * `animate` false snaps to 1 instead of growing: the reading / writing worlds' towers are
 * already standing when the learner arrives (docs/DECK_TOWER.md § "Worlds"), and only a
 * deck swap there grows a tower. It is read when a build STARTS (`ready` turning true or
 * the count changing), not watched — so a swap ending mid-growth (its `busy` dropping)
 * does not cut the growth short.
 */
export function useBuildProgress(ready: boolean, count: number, animate = true): number {
    const [progress, setProgress] = useState(0);
    const animateRef = useRef(animate);
    animateRef.current = animate;
    useEffect(() => {
        if (!ready) {
            setProgress(0);
            return;
        }
        if (!animateRef.current || prefersReducedMotion() || count <= 0) {
            setProgress(1);
            return;
        }
        const { durationS, cardsAt } = buildTimeline(count);
        let frame = 0;
        const start = performance.now();
        const tick = (now: number) => {
            const elapsedS = (now - start) / 1000;
            setProgress(Math.min(1, cardsAt(elapsedS) / count));
            if (elapsedS < durationS) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [ready, count]);
    return progress;
}
