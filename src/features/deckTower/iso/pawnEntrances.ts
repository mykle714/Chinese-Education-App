/**
 * pawnEntrances.ts — the ways a pawn can ARRIVE in a scene
 * (docs/DECK_TOWER_TRANSITIONS.md § "Pawn entrances").
 *
 * An entrance is a pure timeline of the pawn's pose, played by usePawnMotion before it
 * hands the pawn over to its idle wander. Every entrance is timed by its LANDING — the
 * moment the pawn's feet first rest on the floor (`landMs` after it starts) — not by its
 * start. A caller that wants the pawn to land on a beat (the Deck Tower's trap door
 * slamming shut) starts it `landMs` before that beat; see `entranceStartFor`.
 *
 * To add one: write a `PawnEntrance` builder and list it in `PAWN_ENTRANCES`. `pickPawnEntrance`
 * draws one at random.
 *
 * Depended on by: usePawnMotion.ts (plays the frames), IsoPawn.tsx (`entrance` prop),
 * src/features/deckTower/useDeckSwap.ts (picks one and schedules it), and the Deck Tower's
 * floor fixture (the focus lever), which borrows the incoming pawn's entrance with a later
 * start to land just after it (DeckTowerPage → `leverArgs`,
 * usePopUpMotion.ts `skyEntrance`, IsoLever.tsx `air`; docs/FOCUS_MODE.md § 5).
 */

import { fallDistanceAt, fallMs, fallParams } from "../../../theme/gravity";

/** The pawn's pose at one instant of an entrance. Lengths in world units. */
export interface PawnEntranceFrame {
    /** Height of the feet above the floor. */
    hop: number;
    /** Body scale about the feet (squash / stretch). */
    sx: number;
    sy: number;
    /** The floor shadow's scale (1 = full) and opacity. */
    shadowScale: number;
    shadowOpacity: number;
}

export interface PawnEntrance {
    id: string;
    /** ms from the entrance's start to the feet touching the floor. */
    landMs: number;
    /** ms from start to the end of the entrance (≥ landMs: the landing's follow-through). */
    durationMs: number;
    /** The pose `t` ms after the start, for 0 ≤ t ≤ durationMs. */
    frame: (t: number) => PawnEntranceFrame;
}

const easeOutSq = (u: number) => (1 - u) * (1 - u);

// ── Fall from the sky ──────────────────────────────────────────────────────────

/**
 * Where the fall starts, world units over the floor: just off the top of a phone screen over
 * the platform. Lowered from 55 to 45 on 2026-11-20 (owner) so the pawn spawns closer to the
 * screen edge. Measured across popular phones in td's layout, the tightest case — a Pixel 9,
 * the pawn landing at the platform's front corner — had 12.4 units (~215 px) of margin at 55,
 * so 45 leaves ~2.4 units (~40 px); an iPhone 14/15/16 landing at the floor's centre keeps
 * ~11 units. A taller-aspect screen than those would show the spawn (docs/GRAVITY_LAB.md § 6).
 */
export const SKY_FALL_HEIGHT = 45;
/*
 * Physics: the `skyFall` fall type (src/theme/gravity.ts → `fallParams("skyFall")`: its own
 * gravity, start speed and jerk, tunable on /gravity-lab). Its gravity is also the pawn's own
 * (`pawnGravity`, usePawnMotion). History: its own 60 u/s² until 2026-11-20, then the shared
 * 110 (a 55-unit drop landed in ~1000 ms rather than ~1354 ms — accepted by the owner). From
 * today's 45 units, at 110 / 0 / 0, it lands in ~905 ms.
 *
 * Ceiling: landMs must stay under the shortest trap-door `readyMs` (deckTransitions.ts →
 * TRAP_DOOR: drop + bounce + hold + close = 1420 ms), or the incoming pawn's entrance
 * would be scheduled to start before its swap does and it would pop in mid-fall. From
 * SKY_FALL_HEIGHT (45) that holds for any skyFall gravity above ~45 u/s² with no start speed or jerk;
 * /gravity-lab flags one below it.
 */
/** The landing squash, then back to its normal shape. Harder than a startle's landing: it fell a long way. */
const SKY_FALL_SQUASH_MS = 260;
const SKY_FALL_SQUASH = 0.3;
/**
 * The shadow is a faint dot while the pawn is high, and grows to full size and tone over
 * the last this-many units of the fall — the "something is coming down here" cue.
 */
const SKY_FALL_SHADOW_REACH = 12;

/**
 * A fall from `height` world units over the floor, under the `skyFall` physics: stretched
 * along the fall, the shadow growing in over the last SKY_FALL_SHADOW_REACH units, a hard
 * squash on landing. `fallFromSky` is this from SKY_FALL_HEIGHT; the flp's hint pawn
 * drops from the top of the screen onto its platform, the height measured per arrival (HintPawn.tsx → hintPawnDrop).
 */
export function fallFromHeight(height: number, id = "fall-from-height"): PawnEntrance {
    // Read once per entrance, so one fall is self-consistent even if the lab moves a slider mid-fall.
    // The pawn sky fall's own gravity, start speed and jerk (src/theme/gravity.ts → `fallParams("skyFall")`).
    const fall = fallParams("skyFall");
    const landMs = fallMs(Math.max(0, height), fall);
    return {
        id,
        landMs,
        durationMs: landMs + SKY_FALL_SQUASH_MS,
        frame: (t) => {
            if (t < landMs) {
                const s = t / 1000;
                const hop = Math.max(0, height - fallDistanceAt(s, fall));
                const air = Math.min(1, hop / SKY_FALL_SHADOW_REACH);
                // Stretched along the fall.
                return { hop, sx: 0.92, sy: 1.1, shadowScale: 1 - 0.8 * air, shadowOpacity: 1 - air };
            }
            const u = Math.min(1, (t - landMs) / SKY_FALL_SQUASH_MS);
            const d = SKY_FALL_SQUASH * easeOutSq(u);
            return { hop: 0, sx: 1 + 0.75 * d, sy: 1 - d, shadowScale: 1, shadowOpacity: 1 };
        },
    };
}

/**
 * The Deck Tower's sky fall. A function, not a constant: an entrance captures the gravity
 * when it is BUILT, so it is built per pick (a module constant would freeze the gravity in
 * force at import and ignore /gravity-lab).
 */
export function fallFromSky(): PawnEntrance {
    return fallFromHeight(SKY_FALL_HEIGHT, "fall-from-sky");
}

// ── Registry ───────────────────────────────────────────────────────────────────

/** Every entrance a scene may pick from, as builders (see `fallFromSky` for why not values). */
export const PAWN_ENTRANCES: readonly (() => PawnEntrance)[] = [fallFromSky];

export function pickPawnEntrance(): PawnEntrance {
    return PAWN_ENTRANCES[Math.floor(Math.random() * PAWN_ENTRANCES.length)]();
}

/** When to start `entrance` (same clock as `landAt`) so the pawn lands at `landAt`. */
export function entranceStartFor(entrance: PawnEntrance, landAt: number): number {
    return landAt - entrance.landMs;
}
