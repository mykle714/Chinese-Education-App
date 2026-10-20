/**
 * deckTransitions.ts — the ways the Deck Tower clears one deck's tower off its platform
 * to make room for another's (docs/DECK_TOWER_TRANSITIONS.md § "Deck transitions").
 *
 * Layer: page logic (feature module `src/features/deckTower`). Pure timelines — no React,
 * no DOM. useDeckSwap.ts plays one; DeckTowerPage.tsx draws what its frames say.
 *
 * A transition is planned once per swap (it may depend on the scene, e.g. how far the
 * tower must fall) and then sampled by time. Every plan names two beats the rest of the
 * swap is hung on:
 *
 *   clearedMs  the old deck's tower and pawn are gone — the page may swap to the new
 *              deck's count (and refit its viewBox) from here on;
 *   readyMs    the stage is set for the new deck — the new pawn LANDS on this beat (its
 *              entrance is started early to match, pawnEntrances.ts → entranceStartFor)
 *              and the new tower starts growing.
 *
 * A plan may also name an optional `impactMs`: the falling tower has hit a floor below the
 * screen, and the page splatters cards up from the bottom edge (CardSplat.tsx).
 *
 * To add a transition: write a `DeckTransition`, list it in `DECK_TRANSITIONS`. If it
 * needs the scene to do something new (fade, slide sideways, …), add the field to
 * `DeckTransitionFrame` with a resting default and teach DeckTowerPage to draw it.
 */

/** What a plan may depend on, measured by the page when the swap starts. */
export interface DeckTransitionContext {
    /**
     * World units the outgoing tower must drop for its top to pass below the bottom of
     * the screen (the scroller's bottom edge, at the footer bar, with the camera's pan).
     */
    fallDistance: number;
}

/** The scene at one instant of a transition. Every field rests at its "nothing happening" value. */
export interface DeckTransitionFrame {
    /** Radians the platform has swung open on its back-left edge (IsoPlatform `hingeAngle`). */
    hingeAngle: number;
    /** World units the outgoing tower and pawn have dropped. */
    outgoingDrop: number;
}

export interface DeckTransitionPlan {
    clearedMs: number;
    readyMs: number;
    /** ms to the end of the transition (≥ readyMs: its follow-through, e.g. a door's rebound). */
    durationMs: number;
    /**
     * When set, the fallen tower hits a floor below the screen at this ms and the page
     * plays a card splat at the bottom edge. The trap door uses clearedMs: the splat comes
     * only once the last card has fallen out of sight.
     */
    impactMs?: number;
    frame: (t: number) => DeckTransitionFrame;
}

export interface DeckTransition {
    id: string;
    plan: (ctx: DeckTransitionContext) => DeckTransitionPlan;
}

const deg = (d: number) => (d * Math.PI) / 180;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

// ── Trap door ──────────────────────────────────────────────────────────────────
// The platform drops open on its back-left edge, the tower and pawn fall straight down
// off the bottom of the screen, and the door swings back up and slams shut.
//
//   0 ──DROP──▶ open ─BOUNCE─▶ (holds open while the tower falls) ─HOLD─▶ ──CLOSE──▶ shut ─REBOUND─▶
//      └ FALL_DELAY ─▶ contents fall ───────────▶ clearedMs                          readyMs

/** How far the door swings open: just short of hanging straight down. */
const TRAP_OPEN_ANGLE = deg(86);
/** The door falls open (an ease-in — gravity takes it). */
const TRAP_DROP_MS = 340;
/** It hits its stop and rebounds this far, once. */
const TRAP_BOUNCE_MS = 300;
const TRAP_BOUNCE_ANGLE = deg(10);
/** The contents start falling a beat after the door, so the gap visibly opens under them. */
const TRAP_FALL_DELAY_MS = 50;
/** Cartoon gravity for the falling tower, world units / s². */
const TRAP_GRAVITY = 140;
/**
 * The longest a fall may take. A tall tower (several hundred cards is ~200 world units)
 * would take seconds at TRAP_GRAVITY, so gravity is raised just enough to clear it in this.
 */
const TRAP_FALL_MAX_MS = 1400;
/** The empty door hangs open this long after the tower is gone, before swinging back. */
const TRAP_HOLD_MS = 220;
/** The swing back up: starts slow, ends fast — a slam rather than a soft close. */
const TRAP_CLOSE_MS = 560;
/** The slam's rebound off the frame. */
const TRAP_REBOUND_MS = 220;
const TRAP_REBOUND_ANGLE = deg(3);
/** The odds a trap-door swap ends with the tower splattering on the floor below the screen. */
const TRAP_SPLAT_CHANCE = 0.2;

export const TRAP_DOOR: DeckTransition = {
    id: "trap-door",
    plan: ({ fallDistance }) => {
        const distance = Math.max(0, fallDistance);
        const maxS = TRAP_FALL_MAX_MS / 1000;
        const g = Math.max(TRAP_GRAVITY, (2 * distance) / (maxS * maxS));
        const fallMs = Math.sqrt((2 * distance) / g) * 1000;
        const clearedMs = TRAP_FALL_DELAY_MS + fallMs;
        const openedMs = TRAP_DROP_MS + TRAP_BOUNCE_MS;
        const closeAt = Math.max(clearedMs, openedMs) + TRAP_HOLD_MS;
        const readyMs = closeAt + TRAP_CLOSE_MS;
        const durationMs = readyMs + TRAP_REBOUND_MS;
        // The splat, when rolled: as the last card drops out of sight, it lands below.
        const impactMs = Math.random() < TRAP_SPLAT_CHANCE ? clearedMs : undefined;

        const hingeAngle = (t: number): number => {
            if (t < TRAP_DROP_MS) return TRAP_OPEN_ANGLE * (t / TRAP_DROP_MS) ** 2;
            if (t < openedMs) return TRAP_OPEN_ANGLE - TRAP_BOUNCE_ANGLE * Math.sin(Math.PI * ((t - TRAP_DROP_MS) / TRAP_BOUNCE_MS));
            if (t < closeAt) return TRAP_OPEN_ANGLE;
            if (t < readyMs) return TRAP_OPEN_ANGLE * Math.cos((Math.PI / 2) * ((t - closeAt) / TRAP_CLOSE_MS));
            return TRAP_REBOUND_ANGLE * Math.sin(Math.PI * clamp01((t - readyMs) / TRAP_REBOUND_MS));
        };
        const outgoingDrop = (t: number): number => {
            const s = Math.max(0, Math.min(t, clearedMs) - TRAP_FALL_DELAY_MS) / 1000;
            return 0.5 * g * s * s;
        };
        return { clearedMs, readyMs, durationMs, impactMs, frame: (t) => ({ hingeAngle: hingeAngle(t), outgoingDrop: outgoingDrop(t) }) };
    },
};

// ── Registry ───────────────────────────────────────────────────────────────────

/** Every transition a swap may pick from. */
export const DECK_TRANSITIONS: readonly DeckTransition[] = [TRAP_DOOR];

export function pickDeckTransition(): DeckTransition {
    return DECK_TRANSITIONS[Math.floor(Math.random() * DECK_TRANSITIONS.length)];
}
