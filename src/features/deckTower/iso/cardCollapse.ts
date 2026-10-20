import { CARD_THICKNESS } from "./cardStackMetrics";

/**
 * cardCollapse.ts — the plan for a card stack that loses some of its cards and settles
 * (docs/ISO_ART_FRAMEWORK.md § "IsoCardRuns"). Pure: no React, no DOM.
 *
 * The stack's cards are numbered 0 (on the floor) … N − 1 (the top card, which carries the
 * deck's print). `ghostCount` of them, picked at random, are GHOSTS: they fade out where
 * they stand, a chunk at a time in random order, each in two stages: its solid fades and
 * leaves a light wireframe of its cards, which holds a beat and then fades too — so the
 * wireframes go in the same order the chunks were picked. What is left is a column of solid RUNS
 * (consecutive kept cards) hanging over the gaps; once the last ghost has gone they all
 * (and its wireframe) drop at once under one gravity, each by the cards that vanished beneath it. A run with
 * more gaps under it falls further and lands later, so the landings ripple UP the tower,
 * and each run gives a small hop as it lands.
 *
 * The top card is never a ghost while any card is kept — it is the deck's lid, and rides
 * down on the topmost run. Only when every card goes does it fade too.
 *
 * Depended on by: IsoCardRuns.tsx (draws a plan), src/features/deckTower/useStudyModeSwitch.ts
 * (makes one and times the switch by it).
 */

/** Ghosts start fading at random over this many ms… */
const GHOST_SPREAD_MS = 900;
/** …each taking this long to fade out. */
export const GHOST_FADE_MS = 420;
/** A ghost's wireframe holds this long after its solid has gone… */
const GHOST_WIRE_HOLD_MS = 260;
/** …then fades over this. */
export const GHOST_WIRE_FADE_MS = 220;
/** A held beat with the gaps open before everything drops. */
const GHOST_HOLD_MS = 160;
/** A ghost chunk is at most this many consecutive cards, so a long gap still empties piece by piece. */
const GHOST_CHUNK_MAX = 3;
/** Cartoon gravity for the settling runs, in world units / s² (the pawn's sky fall uses 110). */
export const COLLAPSE_GRAVITY = 140;
/** The landing hop: its height in world units and its length in ms. */
export const LAND_HOP = 0.08;
export const LAND_HOP_MS = 160;

/** A run of kept cards. */
export interface CollapseRun {
    /** Its lowest card's index. */
    from: number;
    count: number;
    /** How many cards vanished under it: it falls that many card thicknesses. */
    dropCards: number;
    /** Ms its fall takes (0 for a run that does not move). */
    fallMs: number;
    /** It holds the top card (the lid). */
    hasLid: boolean;
}

/** A chunk of ghost cards, fading together. */
export interface GhostChunk {
    from: number;
    count: number;
    /** Ms after the plan's start that it starts to fade. */
    fadeDelayMs: number;
    /** Ms after the plan's start that its wireframe (left behind by the solid) starts to fade. */
    wireFadeDelayMs: number;
    hasLid: boolean;
}

export interface CardCollapsePlan {
    cards: number;
    /** Cards kept. */
    remaining: number;
    runs: CollapseRun[];
    ghosts: GhostChunk[];
    /** Ms after the start at which every run starts to fall. */
    fallStartMs: number;
    /** Ms after the start at which the last run has landed and hopped: the stack is settled. */
    durationMs: number;
}

/**
 * A stack's floor shadow coming back as its bottom card lands on the floor: it fades in
 * over SHADOW_LAND_MS starting ON the impact, never before. A shadow at floor height lies
 * almost entirely under the stack (only its contact sliver shows), so while the stack is
 * still in the air it would just be a dark card-sized patch over the floor's "0 cards"
 * imprint. Shared by IsoCardRuns (a collapse whose bottom card ghosted) and the Deck
 * Tower's Review → Mix drop onto an empty floor.
 */
export const SHADOW_LAND_MS = 120;
export function shadowLandTiming(landAtMs: number): { delayMs: number; durationMs: number } {
    return { delayMs: Math.max(0, landAtMs), durationMs: SHADOW_LAND_MS };
}

/** Ms to fall `cards` card thicknesses from rest under COLLAPSE_GRAVITY. */
export function fallMsFor(distance: number, gravity = COLLAPSE_GRAVITY): number {
    return distance <= 0 ? 0 : Math.sqrt((2 * distance) / gravity) * 1000;
}

export function planCardCollapse(cards: number, ghostCount: number, random: () => number = Math.random): CardCollapsePlan {
    const n = Math.max(0, Math.floor(cards));
    const k = Math.min(n, Math.max(0, Math.floor(ghostCount)));
    // The pool ghosts are drawn from: every card but the lid, unless all of them go.
    const pool = Array.from({ length: k >= n ? n : n - 1 }, (_, i) => i);
    // Partial Fisher–Yates: the first k of the shuffled pool are the ghosts.
    for (let i = 0; i < k; i++) {
        const j = i + Math.floor(random() * (pool.length - i));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const ghost = new Array<boolean>(n).fill(false);
    for (let i = 0; i < k; i++) ghost[pool[i]] = true;

    const runs: CollapseRun[] = [];
    const ghosts: GhostChunk[] = [];
    let gone = 0;
    for (let i = 0; i < n; ) {
        let j = i;
        if (ghost[i]) {
            while (j < n && ghost[j] && j - i < GHOST_CHUNK_MAX) j++;
            const fadeDelayMs = random() * GHOST_SPREAD_MS;
            ghosts.push({
                from: i,
                count: j - i,
                fadeDelayMs,
                wireFadeDelayMs: fadeDelayMs + GHOST_FADE_MS + GHOST_WIRE_HOLD_MS,
                hasLid: j === n,
            });
            gone += j - i;
        } else {
            while (j < n && !ghost[j]) j++;
            runs.push({ from: i, count: j - i, dropCards: gone, fallMs: fallMsFor(gone * CARD_THICKNESS), hasLid: j === n });
        }
        i = j;
    }

    // The last wireframe gone (each outlasts its own solid).
    const lastFade = ghosts.reduce((m, g) => Math.max(m, g.wireFadeDelayMs + GHOST_WIRE_FADE_MS), 0);
    const fallStartMs = k > 0 ? lastFade + GHOST_HOLD_MS : 0;
    const longestFall = runs.reduce((m, r) => Math.max(m, r.fallMs), 0);
    return {
        cards: n,
        remaining: n - k,
        runs,
        ghosts,
        fallStartMs,
        durationMs: fallStartMs + (longestFall > 0 ? longestFall + LAND_HOP_MS : 0),
    };
}

/**
 * Cards still showing `elapsedMs` into the plan: a ghost chunk stops counting halfway
 * through its fade. Drives the top card's figure counting down as the ghosts go.
 */
export function cardsShowingAt(plan: CardCollapsePlan, elapsedMs: number): number {
    let showing = plan.cards;
    for (const g of plan.ghosts) if (elapsedMs >= g.fadeDelayMs + GHOST_FADE_MS / 2) showing -= g.count;
    return showing;
}
