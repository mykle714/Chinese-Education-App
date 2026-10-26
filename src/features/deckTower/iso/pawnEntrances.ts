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
 * To add one: write a `PawnEntrance` and list it in `PAWN_ENTRANCES`. `pickPawnEntrance`
 * draws one at random.
 *
 * Depended on by: usePawnMotion.ts (plays the frames), IsoPawn.tsx (`entrance` prop),
 * src/features/deckTower/useDeckSwap.ts (picks one and schedules it), and the Deck Tower's
 * floor fixture (the focus lever), which borrows the incoming pawn's entrance with a later
 * start to land just after it (DeckTowerPage → `leverArgs`,
 * usePopUpMotion.ts `skyEntrance`, IsoLever.tsx `air`; docs/FOCUS_MODE.md § 5).
 */

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

/** Where the fall starts: high enough to be off the top of a phone screen over the platform. */
const SKY_FALL_HEIGHT = 55;
/**
 * The pawn's cartoon gravity, world units / s². (A pawn is ~2 units tall, so real gravity
 * would crawl.) Shared: the pawn's feet physics in usePawnMotion (the plate's press, launch
 * and bounces, and its fall through the trap door) use the same pull.
 */
export const PAWN_GRAVITY = 110;
const SKY_FALL_GRAVITY = PAWN_GRAVITY;
/** The landing squash, then back to its normal shape. Harder than a startle's landing: it fell a long way. */
const SKY_FALL_SQUASH_MS = 260;
const SKY_FALL_SQUASH = 0.3;
/**
 * The shadow is a faint dot while the pawn is high, and grows to full size and tone over
 * the last this-many units of the fall — the "something is coming down here" cue.
 */
const SKY_FALL_SHADOW_REACH = 12;

/**
 * A fall from `height` world units over the floor, under the pawn's own gravity: stretched
 * along the fall, the shadow growing in over the last SKY_FALL_SHADOW_REACH units, a hard
 * squash on landing. FALL_FROM_SKY is this from SKY_FALL_HEIGHT.
 */
function fallFromHeight(height: number, id = "fall-from-height"): PawnEntrance {
    const landMs = Math.sqrt((2 * Math.max(0, height)) / SKY_FALL_GRAVITY) * 1000;
    return {
        id,
        landMs,
        durationMs: landMs + SKY_FALL_SQUASH_MS,
        frame: (t) => {
            if (t < landMs) {
                const s = t / 1000;
                const hop = Math.max(0, height - 0.5 * SKY_FALL_GRAVITY * s * s);
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

export const FALL_FROM_SKY: PawnEntrance = fallFromHeight(SKY_FALL_HEIGHT, "fall-from-sky");

// ── Registry ───────────────────────────────────────────────────────────────────

/** Every entrance a scene may pick from. */
export const PAWN_ENTRANCES: readonly PawnEntrance[] = [FALL_FROM_SKY];

export function pickPawnEntrance(): PawnEntrance {
    return PAWN_ENTRANCES[Math.floor(Math.random() * PAWN_ENTRANCES.length)];
}

/** When to start `entrance` (same clock as `landAt`) so the pawn lands at `landAt`. */
export function entranceStartFor(entrance: PawnEntrance, landAt: number): number {
    return landAt - entrance.landMs;
}
