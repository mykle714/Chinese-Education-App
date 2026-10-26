import { useCallback, useEffect, useRef, useState } from "react";
import { mixHex, prefersReducedMotion } from "./iso";
import { WORLD_ORDER, type TowerWorldId } from "./towerWorlds";

/**
 * useWorldPan — the Deck Tower's camera dash from one world to the next
 * (docs/DECK_TOWER.md § "Worlds → The pan").
 *
 * Layer: page logic (feature module `src/features/deckTower`). It owns WHICH world is
 * drawn and the clock of a pan in progress; it draws nothing. DeckTowerPage reads the
 * `WorldPanView` every frame: it slides the scene by `sceneShiftX`, shows the speed
 * lines at `speed`, and paints the backdrop with `palette`.
 *
 * One pan, on one clock (ms since `go`):
 *
 *   0 ── OUT_MS (≤) ── +CRUISE_MS ──── +IN_MS
 *   scene whips off    sky shifts to     the new world's scene
 *   (ease-in), speed   the new world's   slides in (ease-out),
 *   lines stream in    colour; lines     lines die away. Its tower
 *                      at full speed     is already standing.
 *          ▲
 *          └ `world` switches here, while no scene is on screen
 *
 * A pan started by a swipe CARRIES THE SWIPE ON (`PanCarry`): the scene leaves from where
 * the finger left it, at the finger's speed, and keeps accelerating from there — so the
 * release flows into the dash instead of the scene springing back and restarting from rest.
 * The out phase is shortened to the distance left (`outPlan`).
 *
 * The camera travels TOWARD the destination, so the scene (and the speed lines) move
 * the other way: going right (core → writing) the scene leaves to the left and the new
 * one enters from the right.
 *
 * The clock is React state, ticked by rAF only while a pan runs (~0.8 s) — the same
 * per-frame pattern as useDeckSwap. Under prefers-reduced-motion `go` switches at once.
 *
 * The colours come from `paletteOf`: each world's sky at the current time of day
 * (timeOfDay.ts), so a pan blends between the two worlds as they look right now.
 */

/** A world's backdrop colours (its sky now, and the space above it). */
export interface WorldPalette {
    sky: string;
    space: string;
}

/** The scene whipping off screen from rest (shorter when a swipe carries it part-way). */
const OUT_MS = 260;
/** Empty sky racing past while it turns the new world's colour. */
const CRUISE_MS = 260;
/** The new world's scene sliding in and settling. */
const IN_MS = 300;

export interface WorldPanView {
    /** The world drawn now. Switches mid-pan, while the scene is off screen. */
    world: TowerWorldId;
    /** The scene's horizontal slide, in stage widths: 0 = in place, ±1 = just off screen. */
    sceneShiftX: number;
    /** Speed-line strength, 0 (none) → 1 (full dash). */
    speed: number;
    /** The camera's travel: +1 to the right, −1 to the left (0 at rest). */
    direction: -1 | 0 | 1;
    /** The backdrop's colours right now (blending mid-pan). */
    palette: WorldPalette;
    /** A pan is running: world taps / swipes and the plate are ignored. */
    busy: boolean;
}

/**
 * A swipe's motion at release, handed to `go` so the pan continues it. Both in stage
 * widths, signed like `sceneShiftX` (negative = leftward).
 */
export interface PanCarry {
    /** Where the drag left the scene. */
    shift: number;
    /** The scene's velocity at release, stage widths per ms. */
    velocity: number;
}

/**
 * The out phase as distance covered toward off-screen (0 → 1, in stage widths) over
 * `ms`: p(τ) = start + v0·τ + accel·τ². From rest that is the plain ease-in; with a
 * carry it starts part-way and already moving.
 */
interface OutPlan {
    ms: number;
    start: number;
    v0: number;
    accel: number;
}

/** The carried drag never counts as more than this much of the way off screen. */
const MAX_CARRIED_SHIFT = 0.8;

/**
 * Fit the out phase to a carry. The time is what an ease-in from rest would take over the
 * remaining distance, cut short if the carried speed alone covers it sooner — so `accel`
 * is never negative and the scene never slows down on its way out.
 */
function outPlan(direction: -1 | 1, carry: PanCarry | undefined): OutPlan {
    // Only motion TOWARD the exit counts; a finger flicking back the other way carries nothing.
    const start = Math.min(MAX_CARRIED_SHIFT, Math.max(0, -direction * (carry?.shift ?? 0)));
    const v0 = Math.max(0, -direction * (carry?.velocity ?? 0));
    const remaining = 1 - start;
    let ms = OUT_MS * Math.sqrt(remaining);
    if (v0 * ms > remaining) ms = remaining / v0;
    return { ms, start, v0, accel: (remaining - v0 * ms) / (ms * ms) };
}

interface PanPlan {
    from: TowerWorldId;
    to: TowerWorldId;
    direction: -1 | 1;
    startedAt: number;
    out: OutPlan;
}

const panTotalMs = (plan: PanPlan) => plan.out.ms + CRUISE_MS + IN_MS;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smoothstep = (u: number) => u * u * (3 - 2 * u);

/** The pan at `e` ms in. Pure. */
function panView(plan: PanPlan, e: number, paletteOf: (id: TowerWorldId) => WorldPalette): WorldPanView {
    const from = paletteOf(plan.from);
    const to = paletteOf(plan.to);
    const d = plan.direction;
    const { out } = plan;
    let sceneShiftX: number;
    let speed: number;
    if (e < out.ms) {
        const tau = Math.max(0, e);
        const p = Math.min(1, out.start + out.v0 * tau + out.accel * tau * tau); // gathers speed as it leaves
        sceneShiftX = -d * p;
        speed = p;
    } else if (e < out.ms + CRUISE_MS) {
        sceneShiftX = d; // parked off screen on the arriving side, waiting to come in
        speed = 1;
    } else {
        const u = clamp01((e - out.ms - CRUISE_MS) / IN_MS);
        sceneShiftX = d * (1 - u) * (1 - u); // ease-out: it brakes into place
        speed = 1 - u;
    }
    const colourT = smoothstep(clamp01((e - out.ms) / CRUISE_MS));
    return {
        world: e < out.ms ? plan.from : plan.to,
        sceneShiftX,
        speed,
        direction: d,
        palette: { sky: mixHex(from.sky, to.sky, colourT), space: mixHex(from.space, to.space, colourT) },
        busy: true,
    };
}

export function useWorldPan(paletteOf: (id: TowerWorldId) => WorldPalette): WorldPanView & { go: (to: TowerWorldId, carry?: PanCarry) => void } {
    const [world, setWorld] = useState<TowerWorldId>("core");
    const [plan, setPlan] = useState<PanPlan | null>(null);
    const [now, setNow] = useState(0);
    // The latest settled values, read by `go` without re-creating it every frame.
    const settled = useRef({ world, busy: false });
    settled.current = { world, busy: plan !== null };

    const go = useCallback((to: TowerWorldId, carry?: PanCarry) => {
        const s = settled.current;
        if (s.busy || to === s.world) return;
        if (prefersReducedMotion()) {
            setWorld(to);
            return;
        }
        const startedAt = performance.now();
        setNow(startedAt);
        const direction = WORLD_ORDER.indexOf(to) > WORLD_ORDER.indexOf(s.world) ? 1 : -1;
        setPlan({ from: s.world, to, direction, startedAt, out: outPlan(direction, carry) });
    }, []);

    // The pan's clock: one rAF loop per plan, settling on the new world at the end.
    useEffect(() => {
        if (!plan) return;
        let frame = 0;
        const tick = (t: number) => {
            if (t - plan.startedAt >= panTotalMs(plan)) {
                setWorld(plan.to);
                setPlan(null);
                return;
            }
            setNow(t);
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [plan]);

    const view: WorldPanView = plan
        ? panView(plan, now - plan.startedAt, paletteOf)
        : {
              world,
              sceneShiftX: 0,
              speed: 0,
              direction: 0,
              palette: paletteOf(world),
              busy: false,
          };
    return { ...view, go };
}
