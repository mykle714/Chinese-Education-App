import { useCallback, useEffect, useRef, useState } from "react";
import { cardsShowingAt, fallMsFor, planCardCollapse, prefersReducedMotion, type CardCollapsePlan } from "./iso";
import { otherTowerMode, type TowerModeId } from "./towerModes";

/**
 * useStudyModeSwitch — plays one world's Mix / Review switch (docs/DECK_TOWER.md
 * § "Mix / Review switch").
 *
 * Layer: page logic (feature module `src/features/deckTower`). It owns which mode the
 * world's Learn Now tower is in and the clock of a switch in progress; it draws nothing.
 * DeckTowerPage runs one per world, so each world remembers its own mode across world
 * swipes for the visit (not persisted: every page open starts in Mix).
 *
 *   Mix → Review  (COLLAPSE)  the Unfamiliar + Target cards ghost out at random, then the
 *                 floating cards fall into the gaps (cardCollapse.ts). One clock, 0 →
 *                 plan.durationMs; the top card counts down as the ghosts go.
 *
 *   Review → Mix  (DROP)      0 ── cameraMs ──▶ drop mounts ── fallMs ──▶ LANDS ── IMPACT_MS ──▶ end
 *                             page scrolls       the U+T tower    platform sinks,
 *                             to the landing     falls from       smoke puffs
 *                             point              above the screen
 *
 * The knob and label (`mode`) cut over at the tap, as the floor plate does; the settled
 * tower (`towerMode`) keeps the old mode's count until the switch ends, so the page's
 * build-up never sees the count change mid-animation.
 *
 * The clock is a rAF loop that only re-renders when what it shows changes (the counted-down
 * figure, the drop phase): the motion itself is CSS (IsoCardRuns, the drop's fall, the
 * sink, IsoSmokePuff). Under prefers-reduced-motion a switch is instant.
 */

/** Cartoon gravity for the dropping tower, world units / s² (the pawn's sky fall uses 110). */
const DROP_GRAVITY = 130;
/** The landing's follow-through: the platform's sink and the smoke both finish inside it. */
export const IMPACT_MS = 760;

export interface ModeSwitchCollapse {
    key: number;
    plan: CardCollapsePlan;
    /** The top card's figure right now. */
    figure: number;
}

export interface ModeSwitchDrop {
    key: number;
    /** Cards already standing (the Review tower) — the drop lands on their top. */
    baseCards: number;
    /** Cards in the dropping tower (Unfamiliar + Target). */
    cards: number;
    /** World units the dropping tower starts above its landing. */
    lift: number;
    fallMs: number;
}

export interface ModeSwitchView {
    /** The switch's position (knob, label). Cuts over at the tap. */
    mode: TowerModeId;
    /** The mode whose count the settled tower stands at — the old one until a switch ends. */
    towerMode: TowerModeId;
    collapse: ModeSwitchCollapse | null;
    /** The dropping tower, once the camera has reached the landing (null before and after). */
    drop: ModeSwitchDrop | null;
    /** A Review → Mix switch's camera move: the page scrolls to the landing over `durationMs`. */
    camera: { key: number; durationMs: number } | null;
    /**
     * The drop has hit the tower (the impact is playing). From here the tower stands at the
     * Mix count, so the page counts it on the tower — the pawn's startle fires on impact.
     */
    dropLanded: boolean;
    busy: boolean;
    /** The learner has switched at least once (the page stops animating build-ups for count changes). */
    everSwitched: boolean;
}

export interface ModeSwitchStart {
    /** Off-cooldown cards in Mix (all four bands). */
    mixCards: number;
    /** Off-cooldown Unfamiliar + Target cards: what Review ghosts out, and Mix drops back. */
    mixOnlyCards: number;
    /** Review → Mix only: world units from the landing up to the drop's start (above the screen's top). */
    dropLift?: number;
    /** Review → Mix only: the camera move's length, ms. */
    cameraMs?: number;
}

type Plan =
    | { kind: "collapse"; key: number; startedAt: number; to: TowerModeId; plan: CardCollapsePlan }
    | { kind: "drop"; key: number; startedAt: number; to: TowerModeId; drop: ModeSwitchDrop; cameraMs: number };

/** A drop's frames (the clock only re-renders when the frame changes). */
const DROP_CAMERA = 0;
const DROP_FALLING = 1;
const DROP_LANDED = 2;

export function useStudyModeSwitch(): ModeSwitchView & { toggle: (start: ModeSwitchStart) => void } {
    const [mode, setMode] = useState<TowerModeId>("mix");
    const [towerMode, setTowerMode] = useState<TowerModeId>("mix");
    const [everSwitched, setEverSwitched] = useState(false);
    const [plan, setPlan] = useState<Plan | null>(null);
    // Collapse: the figure showing. Drop: DROP_CAMERA → DROP_FALLING (the drop is mounted) →
    // DROP_LANDED (it has hit the tower: the impact plays).
    const [frame, setFrame] = useState(0);
    const nextKey = useRef(1);
    const settled = useRef({ mode, busy: false });
    settled.current = { mode, busy: plan !== null };

    const toggle = useCallback((start: ModeSwitchStart) => {
        const s = settled.current;
        if (s.busy) return;
        const to = otherTowerMode(s.mode);
        setEverSwitched(true);
        setMode(to);
        const nothingMoves = start.mixOnlyCards <= 0 || start.mixCards <= 0;
        if (prefersReducedMotion() || nothingMoves) {
            setTowerMode(to);
            return;
        }
        const key = nextKey.current++;
        const startedAt = performance.now();
        if (to === "review") {
            const collapse = planCardCollapse(start.mixCards, start.mixOnlyCards);
            setFrame(collapse.cards);
            setPlan({ kind: "collapse", key, startedAt, to, plan: collapse });
        } else {
            const lift = Math.max(0, start.dropLift ?? 0);
            setFrame(DROP_CAMERA);
            setPlan({
                kind: "drop",
                key,
                startedAt,
                to,
                cameraMs: Math.max(0, start.cameraMs ?? 0),
                drop: {
                    key,
                    baseCards: start.mixCards - start.mixOnlyCards,
                    cards: start.mixOnlyCards,
                    lift,
                    fallMs: fallMsFor(lift, DROP_GRAVITY),
                },
            });
        }
    }, []);

    // The switch's clock: one rAF loop per plan, settling the new mode at its end.
    // A drop's landing is timed from the frame its tower MOUNTED, not from the plan's start:
    // its CSS fall starts on that paint, so this keeps DROP_LANDED (which the page's startle
    // check reads) on the same frame as the visible impact.
    useEffect(() => {
        if (!plan) return;
        let raf = 0;
        let droppedAt: number | null = null;
        const tick = (now: number) => {
            const elapsed = now - plan.startedAt;
            let next: number;
            let done: boolean;
            if (plan.kind === "collapse") {
                next = cardsShowingAt(plan.plan, elapsed);
                done = elapsed >= plan.plan.durationMs;
            } else {
                if (droppedAt === null && elapsed >= plan.cameraMs) droppedAt = now;
                const sinceDrop = droppedAt === null ? -1 : now - droppedAt;
                next = sinceDrop < 0 ? DROP_CAMERA : sinceDrop < plan.drop.fallMs ? DROP_FALLING : DROP_LANDED;
                done = sinceDrop >= plan.drop.fallMs + IMPACT_MS;
            }
            if (done) {
                setTowerMode(plan.to);
                setPlan(null);
                return;
            }
            setFrame(next); // bails out when unchanged
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [plan]);

    return {
        mode,
        towerMode,
        collapse: plan?.kind === "collapse" ? { key: plan.key, plan: plan.plan, figure: frame } : null,
        drop: plan?.kind === "drop" && frame >= DROP_FALLING ? plan.drop : null,
        dropLanded: plan?.kind === "drop" && frame === DROP_LANDED,
        camera: plan?.kind === "drop" ? { key: plan.key, durationMs: plan.cameraMs } : null,
        busy: plan !== null,
        everSwitched,
        toggle,
    };
}
