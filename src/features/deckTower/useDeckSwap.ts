import { useCallback, useEffect, useRef, useState } from "react";
import { entranceStartFor, pickPawnEntrance, PLATE_LAUNCH_APEX_MS, prefersReducedMotion, type PawnEntrance, type PawnEntranceCue } from "./iso";
import { pickDeckTransition, type DeckTransitionContext, type DeckTransitionPlan } from "./deckTransitions";
import { otherTowerDeck, type TowerDeckId } from "./towerDecks";

/**
 * useDeckSwap — plays the Deck Tower's deck switch (docs/DECK_TOWER_TRANSITIONS.md
 * § "The swap timeline").
 *
 * Layer: page logic (feature module `src/features/deckTower`). It owns WHICH deck is up
 * and the clock of a swap in progress; it draws nothing. DeckTowerPage reads the
 * `DeckSwapView` it returns every frame and lays the scene out from it.
 *
 * Each platform on the page (towerPlatforms.ts) runs its OWN instance: its plate, deck
 * and swap are independent of the others'. One swap, on one clock (ms since the tap):
 *
 *   0 ── PLATE_SETTLE_MS ──▶ t = 0 ──────── clearedMs ──── readyMs ──── durationMs
 *   plate + title       door drops, old     old tower      new pawn LANDS,  rebound
 *   switch to the new   tower + pawn fall;  gone: scene    new tower starts ends:
 *   deck at once; the   old pawn pops "!";  refits to the  growing          settled
 *   plate pops back up  new pawn mounted,   new deck
 *                                           hidden until its
 *                                           entrance starts
 *                                    (optional impactMs — the trap door's is clearedMs: the tower
 *                                     hits a floor below the screen and cards splatter up)
 *
 * The transition (deckTransitions.ts) and the new pawn's entrance (iso/pawnEntrances.ts)
 * are each picked at random from their registries per swap. The entrance is scheduled
 * BACKWARDS from `readyMs`, so whichever pair is drawn, the pawn lands on the beat.
 *
 * The clock is React state, ticked by rAF only while a swap runs (~2–3 s), the same
 * per-frame-render pattern as the tower's build-up. Under prefers-reduced-motion a tap
 * switches the deck instantly: no transition, no new pawn.
 */

/**
 * A beat between the tap and the door dropping: the plate has already snapped to the new
 * deck's face (a hard cut, no animation) and pops back up (usePlatePress) in this beat.
 * Never shorter than a pawn standing on the plate takes to reach the top of the launch
 * that pop gives it (usePawnMotion → PLATE_LAUNCH_APEX_MS, ~209 ms), so the floor drops
 * out from under the pawn only once it has peaked, and it falls from the air
 * (docs/DECK_TOWER_TRANSITIONS.md § "Pawns during a swap"). At today's pawn gravity the
 * plate's own 300 ms settle is the longer of the two.
 */
const PLATE_POP_SETTLE_MS = 300;
export const PLATE_SETTLE_MS = Math.max(PLATE_POP_SETTLE_MS, PLATE_LAUNCH_APEX_MS);
/** Ms from the tap to transition t = 0. */
const TRANSITION_START_MS = PLATE_SETTLE_MS;

export interface SwapPawn {
    /** React key; a new pawn per swap, so its entrance plays on mount. */
    key: number;
    /**
     * It belongs to the outgoing deck and falls with the old tower. It falls ON ITS OWN
     * (IsoPawn `floorDrop`), not in the tower's fall wrapper: a pawn the plate just launched
     * finishes its flight before dropping.
     */
    outgoing: boolean;
    entrance?: PawnEntranceCue;
}

export interface DeckSwapView {
    /** The deck whose tower is on (or falling off) the platform. The scene is fitted to it. */
    towerDeck: TowerDeckId;
    /**
     * The deck the plate and the page title name. It switches to the new deck the instant
     * a swap starts — a hard cut — while `towerDeck` waits for the old tower to clear.
     */
    titleDeck: TowerDeckId;
    /** IsoPlatform `hingeAngle`. */
    hingeAngle: number;
    /** The old tower is still on screen (possibly falling): draw it with `frozenProgress`, dropped by `drop`. */
    outgoing: { drop: number; frozenProgress: number } | null;
    /** False while the platform is empty (between clearedMs and readyMs): no tower, nothing building. */
    towerOnStage: boolean;
    /** Every pawn to draw: the current one, or mid-swap the outgoing and the incoming. */
    pawns: SwapPawn[];
    /**
     * The fallen tower has hit the floor below the screen (only when the transition
     * rolled a splat): `id` is per swap (a React key), `elapsedMs` is time since impact.
     * It carries the fallen tower's card count and deck, because by the trap door's impact
     * (clearedMs) the page has already moved on to the new deck.
     */
    splat: { id: number; elapsedMs: number; cards: number; deck: TowerDeckId } | null;
    /** A swap is running; taps are ignored. */
    busy: boolean;
}

/** What the page hands over at the tap. */
export interface DeckSwapStart extends DeckTransitionContext {
    /** The build-up's progress at the tap: the old tower falls as it stands. */
    progress: number;
    /** Cards standing on the tower at the tap (what a splat scatters). */
    cards: number;
}

interface SwapPlan {
    from: TowerDeckId;
    to: TowerDeckId;
    startedAt: number;
    transition: DeckTransitionPlan;
    entrance: PawnEntrance;
    frozenProgress: number;
    frozenCards: number;
    outgoingPawnKey: number;
    incomingPawnKey: number;
}

/** The scene at `now` during `plan`. Pure. */
function swapView(plan: SwapPlan, now: number): DeckSwapView {
    const e = now - plan.startedAt;
    const t = e - TRANSITION_START_MS;
    const { clearedMs, readyMs, impactMs } = plan.transition;
    const frame = t >= 0 ? plan.transition.frame(t) : { hingeAngle: 0, outgoingDrop: 0 };
    const cleared = t >= clearedMs;

    const pawns: SwapPawn[] = [];
    if (!cleared) pawns.push({ key: plan.outgoingPawnKey, outgoing: true });
    // The incoming pawn mounts when the transition starts and stays hidden until its
    // entrance's own start — mounting it at the start rather than on its cue keeps the
    // mount (and its first paint) away from the landing beat.
    if (t >= 0) {
        pawns.push({
            key: plan.incomingPawnKey,
            outgoing: false,
            entrance: {
                animation: plan.entrance,
                startAt: entranceStartFor(plan.entrance, plan.startedAt + TRANSITION_START_MS + readyMs),
            },
        });
    }

    return {
        towerDeck: cleared ? plan.to : plan.from,
        titleDeck: plan.to,
        hingeAngle: frame.hingeAngle,
        outgoing: cleared ? null : { drop: frame.outgoingDrop, frozenProgress: plan.frozenProgress },
        towerOnStage: !cleared || t >= readyMs,
        pawns,
        splat: impactMs !== undefined && t >= impactMs ? { id: plan.startedAt, elapsedMs: t - impactMs, cards: plan.frozenCards, deck: plan.from } : null,
        busy: true,
    };
}

export function useDeckSwap(initial: TowerDeckId = "learn-now"): DeckSwapView & { toggle: (start: DeckSwapStart) => void } {
    const [deck, setDeck] = useState<TowerDeckId>(initial);
    const [pawnKey, setPawnKey] = useState(0);
    const [plan, setPlan] = useState<SwapPlan | null>(null);
    const [now, setNow] = useState(0);
    // The latest settled values, read by `toggle` without re-creating it every frame.
    const settled = useRef({ deck, pawnKey, busy: false });
    settled.current = { deck, pawnKey, busy: plan !== null };

    const toggle = useCallback((start: DeckSwapStart) => {
        const s = settled.current;
        if (s.busy) return;
        const to = otherTowerDeck(s.deck);
        if (prefersReducedMotion()) {
            setDeck(to);
            return;
        }
        const startedAt = performance.now();
        setNow(startedAt);
        setPlan({
            from: s.deck,
            to,
            startedAt,
            transition: pickDeckTransition().plan(start),
            entrance: pickPawnEntrance(),
            frozenProgress: start.progress,
            frozenCards: start.cards,
            outgoingPawnKey: s.pawnKey,
            incomingPawnKey: s.pawnKey + 1,
        });
    }, []);

    // The swap's clock: one rAF loop per plan, ending (and settling the new deck) at the
    // transition's end.
    useEffect(() => {
        if (!plan) return;
        const endAt = plan.startedAt + TRANSITION_START_MS + plan.transition.durationMs;
        let frame = 0;
        const tick = (t: number) => {
            if (t >= endAt) {
                setDeck(plan.to);
                setPawnKey(plan.incomingPawnKey);
                setPlan(null);
                return;
            }
            setNow(t);
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [plan]);

    const view: DeckSwapView = plan
        ? swapView(plan, now)
        : {
              towerDeck: deck,
              titleDeck: deck,
              hingeAngle: 0,
              outgoing: null,
              towerOnStage: true,
              pawns: [{ key: pawnKey, outgoing: false }],
              splat: null,
              busy: false,
          };
    return { ...view, toggle };
}
