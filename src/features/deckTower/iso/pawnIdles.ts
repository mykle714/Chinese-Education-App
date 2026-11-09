/**
 * pawnIdles.ts — the IsoPawn's idle animations and its tap flinch, as pure pose curves
 * (docs/ISO_ART_FRAMEWORK.md § IsoPawn → "Idles and the flinch"; the caller that schedules
 * them is the flp hint pawn, docs/HINT_PAWN.md § "Idle animations").
 *
 * An idle is cued by the page (IsoPawn `idle`, a `PawnIdleCue`); usePawnMotion starts it
 * from a standstill and reads its pose here every frame. Two shapes:
 *   - ONE-SHOT (`sneeze`, `sing`): plays for its fixed length, then the pawn stands again.
 *   - LASTING (`doze`, `knit`): settles into a looping state and stays in it until the cue
 *     is withdrawn (or replaced), then eases back out over IDLE_EXIT_MS.
 * The back stretch is the fifth idle the hint pawn picks from, but it is NOT here: it
 * already has its own cue and mode (usePawnMotion's STRETCH), so the page sends a stretch
 * cue for it.
 *
 * The pose numbers mean what the stretch's do: `reach` draws the body up tall and thin,
 * `squash` presses it down and wide (usePawnMotion turns both into sx/sy the same way),
 * `arch` bends the spine and `lean` tilts the whole body. With `bendHeading: "facing"` both
 * bend in the plane of the pawn's facing — + toward where it faces (a nod, a droop), −
 * away from it (head tipped back) — otherwise round `bendHeadingOffset` degrees from it.
 *
 * Pure: no React, no DOM. Depended on by: iso/usePawnMotion.ts (the `idle` and `flinch`
 * modes), iso/PawnIdleProps.tsx (SNEEZE_SNAP_MS, KNIT_CLICK_MS — its marks keep time with
 * the pose), flashcards/FlashcardsLearnPage/hintPawn/useHintPawnIdles.ts (the kinds).
 */

/** The idles a page can cue. */
export type PawnIdleKind = "sneeze" | "sing" | "doze" | "knit";

/** An idle to play: a new `id` is a new idle, due from `at` (a `performance.now()` timestamp). */
export interface PawnIdleCue {
    id: string | number;
    kind: PawnIdleKind;
    at: number;
}

/** The idles that leave the pawn in a state until the cue is withdrawn. */
export const LASTING_IDLES: ReadonlySet<PawnIdleKind> = new Set<PawnIdleKind>(["doze", "knit"]);

/** One frame of an idle (or the flinch). */
export interface IdlePose {
    lean: number;
    arch: number;
    reach: number;
    squash: number;
    /** Degrees added to the pawn's facing for the bend direction (0 = straight along the facing). */
    bendHeadingOffset: number;
    /** A one-shot has finished (always false for a lasting idle). */
    done: boolean;
}

const REST: IdlePose = { lean: 0, arch: 0, reach: 0, squash: 0, bendHeadingOffset: 0, done: false };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t));
/** 0 → `to` over [a, b] with easeInOut. */
const ramp = (t: number, a: number, b: number) => easeInOut(clamp01((t - a) / (b - a)));

// ── Sneeze ───────────────────────────────────────────────────────────────────
// Two little inhales, head going back further each time ("ah… ahh…"), a quiver at the top,
// then the snap forward ("CHOO") with a squash, and a slow recovery.

const SNEEZE_INHALE1_END = 380;
const SNEEZE_PAUSE_END = 520;
const SNEEZE_INHALE2_END = 880;
/** The snap starts here — IsoPawn's sneeze puff is timed to it (PawnIdleProps). */
export const SNEEZE_SNAP_MS = 980;
const SNEEZE_SNAP_END = 1080;
export const SNEEZE_MS = 1600;
const SNEEZE_INHALE1_ARCH = -6;
const SNEEZE_INHALE2_ARCH = -11;
/** The snap forward: the spine folds this far, and the whole body tips this far with it, so
 *  the sneeze throws the pawn forward rather than only nodding (owner, 2026-11-08: more lean). */
const SNEEZE_SNAP_ARCH = 22;
const SNEEZE_SNAP_LEAN = 9;
const SNEEZE_SNAP_SQUASH = 0.13;

function sneezePose(t: number): IdlePose {
    if (t >= SNEEZE_MS) return { ...REST, done: true };
    if (t < SNEEZE_INHALE1_END) {
        const u = ramp(t, 0, SNEEZE_INHALE1_END);
        return { ...REST, arch: SNEEZE_INHALE1_ARCH * u, reach: 0.05 * u };
    }
    if (t < SNEEZE_PAUSE_END) return { ...REST, arch: SNEEZE_INHALE1_ARCH, reach: 0.05 };
    if (t < SNEEZE_INHALE2_END) {
        const u = ramp(t, SNEEZE_PAUSE_END, SNEEZE_INHALE2_END);
        return { ...REST, arch: SNEEZE_INHALE1_ARCH + (SNEEZE_INHALE2_ARCH - SNEEZE_INHALE1_ARCH) * u, reach: 0.05 + 0.05 * u };
    }
    if (t < SNEEZE_SNAP_MS) {
        // The held breath: a tiny quiver before it goes.
        const u = (t - SNEEZE_INHALE2_END) / (SNEEZE_SNAP_MS - SNEEZE_INHALE2_END);
        return { ...REST, arch: SNEEZE_INHALE2_ARCH + 0.8 * Math.sin(2 * Math.PI * 3 * u), reach: 0.1 };
    }
    if (t < SNEEZE_SNAP_END) {
        // The snap: fast, ease-out, so it reads as a jolt.
        const u = easeOut(clamp01((t - SNEEZE_SNAP_MS) / (SNEEZE_SNAP_END - SNEEZE_SNAP_MS)));
        return {
            ...REST,
            arch: SNEEZE_INHALE2_ARCH + (SNEEZE_SNAP_ARCH - SNEEZE_INHALE2_ARCH) * u,
            lean: SNEEZE_SNAP_LEAN * u,
            reach: 0.1 * (1 - u),
            squash: SNEEZE_SNAP_SQUASH * u,
        };
    }
    // Recover: straighten up, the squash springing out.
    const u = ramp(t, SNEEZE_SNAP_END, SNEEZE_MS);
    return { ...REST, arch: SNEEZE_SNAP_ARCH * (1 - u), lean: SNEEZE_SNAP_LEAN * (1 - u), squash: SNEEZE_SNAP_SQUASH * (1 - u) };
}

// ── Sing ─────────────────────────────────────────────────────────────────────
// Head tipped back, swaying side to side, breathing on the beat. The sway is the head-back
// bend swinging round: its direction swings either side of the facing (bendHeadingOffset),
// because a pose has one bend direction and a plain `lean` would need another.

export const SING_MS = 4200;
const SING_IN_MS = 350;
const SING_OUT_MS = 450;
const SING_ARCH = -8;
const SING_SWAY_DEG = 70;
const SING_SWAY_PERIOD_MS = 1400;
const SING_BEAT_PERIOD_MS = 700;

function singPose(t: number): IdlePose {
    if (t >= SING_MS) return { ...REST, done: true };
    const env = Math.min(ramp(t, 0, SING_IN_MS), 1 - ramp(t, SING_MS - SING_OUT_MS, SING_MS));
    const beat = 0.5 + 0.5 * Math.sin((2 * Math.PI * t) / SING_BEAT_PERIOD_MS);
    return {
        ...REST,
        arch: SING_ARCH * env,
        reach: (0.03 + 0.03 * beat) * env,
        bendHeadingOffset: SING_SWAY_DEG * Math.sin((2 * Math.PI * t) / SING_SWAY_PERIOD_MS),
    };
}

// ── Doze (lasting) ───────────────────────────────────────────────────────────
// The head droops forward and the body sags; then slow sleeping breaths.

const DOZE_IN_MS = 1100;
const DOZE_ARCH = 13;
const DOZE_SAG = 0.04;
const DOZE_BREATH_MS = 2800;

function dozePose(t: number): IdlePose {
    const settle = ramp(t, 0, DOZE_IN_MS);
    const breath = Math.sin((2 * Math.PI * Math.max(0, t - DOZE_IN_MS)) / DOZE_BREATH_MS);
    return { ...REST, arch: (DOZE_ARCH + 1.5 * breath) * settle, squash: (DOZE_SAG + 0.02 * breath) * settle };
}

// ── Knit (lasting) ───────────────────────────────────────────────────────────
// Looking down at the needles, the head bobbing a little with each click.

/** One needle click — IsoPawn's needles cross on this beat (PawnIdleProps). */
export const KNIT_CLICK_MS = 560;
const KNIT_IN_MS = 500;
const KNIT_ARCH = 7;

function knitPose(t: number): IdlePose {
    const settle = ramp(t, 0, KNIT_IN_MS);
    const bob = Math.abs(Math.sin((Math.PI * t) / KNIT_CLICK_MS));
    return { ...REST, arch: (KNIT_ARCH + 1.6 * bob) * settle, squash: 0.012 * bob * settle };
}

/**
 * The idle's pose `t` ms in. `endingFor` (ms since the cue was withdrawn, lasting idles
 * only) eases the pose back to rest over IDLE_EXIT_MS; past that it reports `done`.
 */
export function idlePose(kind: PawnIdleKind, t: number, endingFor: number | null = null): IdlePose {
    const pose =
        kind === "sneeze" ? sneezePose(t) : kind === "sing" ? singPose(t) : kind === "doze" ? dozePose(t) : knitPose(t);
    if (endingFor === null) return pose;
    if (endingFor >= IDLE_EXIT_MS) return { ...REST, done: true };
    const k = 1 - easeInOut(endingFor / IDLE_EXIT_MS);
    return { ...pose, lean: pose.lean * k, arch: pose.arch * k, reach: pose.reach * k, squash: pose.squash * k, done: false };
}

/** A lasting idle eases back to standing over this long once its cue is withdrawn. */
export const IDLE_EXIT_MS = 380;
/** A one-shot cue still waiting this long after its `at` (the pawn was busy) is dropped. */
export const IDLE_STALE_MS = 3000;

// ── Flinch ───────────────────────────────────────────────────────────────────
// A tap that doesn't jump (the hint pawn's "ouch"): a quick recoil — pressed down and
// tipped back, away from the viewer who poked it — springing back with one small rebound.

export const FLINCH_MS = 420;
const FLINCH_HIT_MS = 80;
const FLINCH_ARCH = -10;
const FLINCH_SQUASH = 0.14;

export function flinchPose(t: number): IdlePose {
    if (t >= FLINCH_MS) return { ...REST, done: true };
    if (t < FLINCH_HIT_MS) {
        const u = easeOut(t / FLINCH_HIT_MS);
        return { ...REST, arch: FLINCH_ARCH * u, squash: FLINCH_SQUASH * u };
    }
    // Back out, overshooting a touch into a stretch (a damped cosine), then still.
    const u = (t - FLINCH_HIT_MS) / (FLINCH_MS - FLINCH_HIT_MS);
    const spring = Math.cos(Math.PI * 1.5 * u) * (1 - u) ** 2;
    return { ...REST, arch: FLINCH_ARCH * spring, squash: FLINCH_SQUASH * spring };
}
