import { useCallback, useEffect, useRef, useState } from "react";
import { cardsShowingAt, prefersReducedMotion, type CardCollapsePlan } from "./iso";
import { IMPACT_MS, type TowerDrop, type TowerResizePlan } from "./towerResizes";

/**
 * useTowerResize — plays one world's tower resizes: the shrinks and grows of
 * towerResizes.ts (docs/DECK_TOWER.md § "Tower resizes").
 *
 * Layer: page logic (feature module `src/features/deckTower`). DeckTowerPage runs one per
 * world and plans each resize there (it owns the counts and the camera); this hook owns the
 * clock of the one in progress and draws nothing. Caller: the focus lever.
 *
 *   ghost-collapse  one clock, 0 → collapse.durationMs; the top card counts down as the
 *                   ghosts go.
 *   sky-drop        0 ── cameraMs ──▶ drop mounts ── fallMs ──▶ LANDS ── IMPACT_MS ──▶ end
 *                   page scrolls       the new cards     platform sinks,
 *                   to the landing     fall from above   smoke puffs
 *
 * While a resize plays, the settled tower keeps standing at `fromCards` (`heldCards`), so the
 * page's build-up never sees the count change mid-animation; the new count takes over at
 * the end.
 *
 * HOLD. The focus lever's new count arrives from the server some time after the tap, so
 * it first `hold`s the tower at the height it stands at — tagged with the counts' fetch
 * `version` it is waiting to see change — and the page `play`s (or `release`s) once the
 * re-read lands. Holding counts as busy. A hold taken with `quietShrink` is one whose
 * shrink is the learner's own progress (marks, in a session or a game), not an action to
 * show: the page `release`s it instead of playing the collapse.
 *
 * The clock is a rAF loop that only re-renders when what it shows changes (the counted-down
 * figure, the drop phase): the motion itself is CSS (IsoCardRuns, the drop's fall, the
 * sink, IsoSmokePuff). Under prefers-reduced-motion nothing plays: the count just changes.
 */

export interface TowerCollapse {
    key: number;
    plan: CardCollapsePlan;
    /** The top card's figure right now. */
    figure: number;
}

export interface TowerResizeView {
    /** A ghost collapse in progress (drawn in place of the tower). */
    collapse: TowerCollapse | null;
    /** A sky drop's falling tower, once the camera has reached the landing (null before and after). */
    drop: TowerDrop | null;
    /** A sky drop's camera move: the page scrolls to the landing over `durationMs`. */
    camera: { key: number; durationMs: number } | null;
    /**
     * The drop has hit the tower (the impact is playing). From here the tower stands at the
     * new count, so the page counts it on the tower — the pawn's startle fires on impact.
     */
    dropLanded: boolean;
    /** The count the settled tower stands at while a resize plays or is held; null when idle. */
    heldCards: number | null;
    /** The count a playing resize ends at (null when idle or only held). */
    toCards: number | null;
    /** A hold waiting for the counts' fetch `version` to move past this. */
    holdVersion: number | null;
    /** The hold's shrink, if it turns out to be one, just shows (see HOLD above). */
    holdQuietShrink: boolean;
    busy: boolean;
    /** A resize has been asked for at least once (the page stops animating build-ups for count changes). */
    everResized: boolean;
}

export interface TowerResizeControls {
    /** Freeze the tower at `cards` until the counts' fetch `version` changes (then `play` or `release`). */
    hold: (cards: number, version: number, opts?: { quietShrink?: boolean }) => void;
    /** Drop a hold without animating: the new count just shows. */
    release: () => void;
    /** Play a planned resize (a no-op under reduced motion, or when the counts do not change). */
    play: (plan: TowerResizePlan) => void;
}

type Playing = { key: number; startedAt: number; plan: TowerResizePlan };

/** A sky drop's frames (the clock only re-renders when the frame changes). */
const DROP_CAMERA = 0;
const DROP_FALLING = 1;
const DROP_LANDED = 2;

export function useTowerResize(): TowerResizeView & TowerResizeControls {
    const [playing, setPlaying] = useState<Playing | null>(null);
    const [held, setHeld] = useState<{ cards: number; version: number; quietShrink: boolean } | null>(null);
    const [everResized, setEverResized] = useState(false);
    // Collapse: the figure showing. Drop: DROP_CAMERA → DROP_FALLING (the drop is mounted) →
    // DROP_LANDED (it has hit the tower: the impact plays).
    const [frame, setFrame] = useState(0);
    const nextKey = useRef(1);
    // Read by the callbacks, so they stay stable and still see the latest state.
    const busyRef = useRef(false);
    busyRef.current = playing !== null;

    const hold = useCallback((cards: number, version: number, opts?: { quietShrink?: boolean }) => {
        if (busyRef.current) return;
        setEverResized(true);
        setHeld({ cards, version, quietShrink: opts?.quietShrink ?? false });
    }, []);

    const release = useCallback(() => setHeld(null), []);

    const play = useCallback((plan: TowerResizePlan) => {
        setHeld(null);
        if (busyRef.current) return;
        setEverResized(true);
        if (prefersReducedMotion() || plan.toCards === plan.fromCards || plan.fromCards < 0 || plan.toCards < 0) return;
        setFrame(plan.kind === "ghost-collapse" ? plan.collapse.cards : DROP_CAMERA);
        setPlaying({ key: nextKey.current++, startedAt: performance.now(), plan });
    }, []);

    // The resize's clock: one rAF loop per plan, ending it (the new count takes over) at its end.
    // A drop's landing is timed from the frame its tower MOUNTED, not from the plan's start:
    // its CSS fall starts on that paint, so this keeps DROP_LANDED (which the page's startle
    // check reads) on the same frame as the visible impact.
    useEffect(() => {
        if (!playing) return;
        const { plan } = playing;
        let raf = 0;
        let droppedAt: number | null = null;
        const tick = (now: number) => {
            const elapsed = now - playing.startedAt;
            let next: number;
            let done: boolean;
            if (plan.kind === "ghost-collapse") {
                next = cardsShowingAt(plan.collapse, elapsed);
                done = elapsed >= plan.collapse.durationMs;
            } else {
                if (droppedAt === null && elapsed >= plan.cameraMs) droppedAt = now;
                const sinceDrop = droppedAt === null ? -1 : now - droppedAt;
                next = sinceDrop < 0 ? DROP_CAMERA : sinceDrop < plan.drop.fallMs ? DROP_FALLING : DROP_LANDED;
                done = sinceDrop >= plan.drop.fallMs + IMPACT_MS;
            }
            if (done) {
                setPlaying(null);
                return;
            }
            setFrame(next); // bails out when unchanged
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [playing]);

    const plan = playing?.plan;
    const key = playing?.key ?? 0;
    return {
        collapse: plan?.kind === "ghost-collapse" ? { key, plan: plan.collapse, figure: frame } : null,
        drop: plan?.kind === "sky-drop" && frame >= DROP_FALLING ? { key, ...plan.drop } : null,
        camera: plan?.kind === "sky-drop" ? { key, durationMs: plan.cameraMs } : null,
        dropLanded: plan?.kind === "sky-drop" && frame === DROP_LANDED,
        heldCards: plan ? plan.fromCards : held ? held.cards : null,
        toCards: plan ? plan.toCards : null,
        holdVersion: held && !plan ? held.version : null,
        holdQuietShrink: held?.quietShrink ?? false,
        busy: playing !== null || held !== null,
        everResized,
        hold,
        release,
        play,
    };
}
