import { fallMsFor, planCardCollapse, type CardCollapsePlan } from "./iso";

/**
 * towerResizes.ts — the library of animations that change a standing tower's height in
 * place (docs/DECK_TOWER.md § "Tower resizes"). Pure: no React, no DOM.
 *
 * Layer: page logic (feature module `src/features/deckTower`). Every action that makes a
 * tower SHORTER plays one of `TOWER_SHRINKS`, and every action that makes one TALLER plays
 * one of `TOWER_GROWS` — picked by `pickTowerShrink` / `pickTowerGrow`, the same shape as
 * the deck swaps' `DECK_TRANSITIONS` (deckTransitions.ts). Today's caller:
 *   - the focus lever (focus on shrinks to today's set, focus off grows back to the pile).
 *
 * An animation here only PLANS: given the card counts (and, for a grow, where the sky is),
 * it returns a `TowerResizePlan`. useTowerResize.ts plays the plan's clock and
 * DeckTowerPlatform.tsx draws it, switching on `kind` — so a new animation is an entry in
 * a list below, a `kind` in `TowerResizePlan`, and a branch in each of those two.
 *
 * Depended on by: useTowerResize.ts (plays a plan), DeckTowerPlatform.tsx (draws one),
 * DeckTowerPage.tsx (plans a grow's camera move).
 */

/** Cartoon gravity for a sky drop's falling tower, world units / s² (the pawn's sky fall uses 110). */
const SKY_DROP_GRAVITY = 130;
/** A sky drop's landing follow-through: the platform's sink and the smoke both finish inside it. */
export const IMPACT_MS = 760;

/** What every shrink is planned from. */
export interface TowerShrinkStart {
    /** Cards standing now. */
    fromCards: number;
    /** Cards standing at the end (fewer). */
    toCards: number;
}

/** What every grow is planned from: the counts, and the page's camera move to the landing. */
export interface TowerGrowStart {
    /** Cards standing now — the new cards land on their top. */
    fromCards: number;
    /** Cards standing at the end (more). */
    toCards: number;
    /** World units from the landing (the standing tower's top) up past the screen's top edge, once the camera has moved. */
    skyAbove: number;
    /** The camera move's length, ms (0 when it is already there). */
    cameraMs: number;
}

/** A tower dropping onto the standing one from above the screen (SKY_DROP). */
export interface TowerDrop {
    key: number;
    /** Cards already standing — the drop lands on their top. */
    baseCards: number;
    /** Cards in the dropping tower. */
    cards: number;
    /** World units the dropping tower starts above its landing. */
    lift: number;
    fallMs: number;
}

/** One planned resize. `kind` names the animation, and is what the player and the renderer switch on. */
export type TowerResizePlan =
    | { kind: "ghost-collapse"; fromCards: number; toCards: number; collapse: CardCollapsePlan }
    | { kind: "sky-drop"; fromCards: number; toCards: number; cameraMs: number; drop: Omit<TowerDrop, "key"> };

export interface TowerShrink {
    id: string;
    plan: (start: TowerShrinkStart) => TowerResizePlan;
}

export interface TowerGrow {
    id: string;
    /** Whether it needs the page's camera move to the landing first (`TowerGrowStart.cameraMs`). */
    usesCamera: boolean;
    plan: (start: TowerGrowStart) => TowerResizePlan;
}

// ── Shrinks ────────────────────────────────────────────────────────────────────

/**
 * GHOST COLLAPSE: the cards that go, picked at random, ghost out a few at a time (each
 * leaving a light wireframe that holds a beat and fades), the top card counting down, then
 * every floating run drops into the gaps under gravity (iso/cardCollapse.ts, IsoCardRuns).
 */
export const GHOST_COLLAPSE: TowerShrink = {
    id: "ghost-collapse",
    plan: ({ fromCards, toCards }) => ({
        kind: "ghost-collapse",
        fromCards,
        toCards,
        collapse: planCardCollapse(fromCards, fromCards - toCards),
    }),
};

// ── Grows ──────────────────────────────────────────────────────────────────────

/**
 * SKY DROP: the camera climbs to the standing tower's top, a tower of the new cards falls
 * in from above the screen's top edge (CSS free fall), and on landing the whole loaded
 * platform sinks under the blow while a ring of smoke puffs bursts round the join.
 */
export const SKY_DROP: TowerGrow = {
    id: "sky-drop",
    usesCamera: true,
    plan: ({ fromCards, toCards, skyAbove, cameraMs }) => {
        const lift = Math.max(0, skyAbove);
        return {
            kind: "sky-drop",
            fromCards,
            toCards,
            cameraMs: Math.max(0, cameraMs),
            drop: { baseCards: fromCards, cards: toCards - fromCards, lift, fallMs: fallMsFor(lift, SKY_DROP_GRAVITY) },
        };
    },
};

// ── Registry ───────────────────────────────────────────────────────────────────

/** Every animation a shrink may pick from. */
export const TOWER_SHRINKS: readonly TowerShrink[] = [GHOST_COLLAPSE];
/** Every animation a grow may pick from. */
export const TOWER_GROWS: readonly TowerGrow[] = [SKY_DROP];

export function pickTowerShrink(): TowerShrink {
    return TOWER_SHRINKS[Math.floor(Math.random() * TOWER_SHRINKS.length)];
}

export function pickTowerGrow(): TowerGrow {
    return TOWER_GROWS[Math.floor(Math.random() * TOWER_GROWS.length)];
}
