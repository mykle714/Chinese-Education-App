import type React from "react";
import { BURN_MARK_RADIUS, insetRect, insideRoundedRect, openFloorSpot, type Pt, type WorldRect } from "./iso";
import { TOWER_LAYOUT } from "./towerPlatforms";

/**
 * towerLightning.ts — lightning STRIKES on the Deck Tower's platform (docs/DECK_TOWER.md
 * § "Weather" → "Lightning strikes").
 *
 * Layer: page logic (feature module `src/features/deckTower`). Pure: the odds, the hit rule,
 * choosing a strike point, and the per-world record DeckTowerPage keeps. The page owns the
 * state; DeckTowerPlatform draws it (bolt, burn marks) and IsoPawn plays the shock.
 *
 * - Each storm flash (useLightningFlashes) strikes the platform with `STRIKE_CHANCE`.
 *   Feature testers can force one (LightningStrikeChips), aimed at a random spot or at the
 *   pawn.
 * - A strike lands only where its WHOLE scorch (`BURN_MARK_RADIUS`) fits on WALKABLE,
 *   VISIBLE floor, so a mark never runs under an object on the ground: inside the pawn's
 *   roam area (`TOWER_LAYOUT.roam.area`, the floor inside the rim), clear of every roam
 *   obstacle (the tower's footprint, the lever's hatch) and of the floor plate (walkable, but
 *   a raised object), and not on floor the tower hides (iso/openFloor.ts).
 * - It leaves a burn mark there. If a pawn on the floor is within `STRIKE_HIT_RADIUS` of
 *   it, that pawn is shocked and is CRISPY from then on.
 * - Everything lasts until the learner leaves the page: the record is page state, per world
 *   (a world's platform remounts on every pan). Crispy is per pawn INSTANCE (owner's choice
 *   2026-11-04): it is keyed by the pawn's swap key, so a deck swap's new pawn arrives clean.
 *   Pawn keys restart at 0 in every world, which is one reason the record is per world.
 *
 * Depends on: iso/openFloor.ts, towerPlatforms.ts. Depended on by: DeckTowerPage.tsx,
 * DeckTowerPlatform.tsx (`PlatformLightning`).
 */

/** The chance that a storm's flash strikes the platform. */
export const STRIKE_CHANCE = 0.01;
/** A floor pawn this close (world units, to its ground point) to a strike is hit. */
export const STRIKE_HIT_RADIUS = 0.8;
/** Burn marks kept per world; the oldest goes past this (a safety cap — a long session). */
export const MAX_BURNS = 40;

/** One strike: where it hit, and its id (React key and shape seed). */
export interface TowerStrike {
    id: number;
    at: Pt;
}

/** What one world remembers until the learner leaves the page. */
export interface WorldLightning {
    burns: TowerStrike[];
    /** Swap keys of this world's pawns that have been struck. */
    crispyPawns: number[];
    /** Per pawn key, the id of the last strike that hit it (IsoPawn `shockId`). */
    shockIds: Record<number, number>;
}

export const NO_LIGHTNING: WorldLightning = { burns: [], crispyPawns: [], shockIds: {} };

/** What DeckTowerPlatform needs to draw one world's lightning. */
export interface PlatformLightning extends WorldLightning {
    /** The bolt coming down right now (unmounted via `onBoltDone`), or null. */
    bolt: TowerStrike | null;
    onBoltDone: () => void;
    /** The ref a pawn keeps its floor position in (IsoPawn `floorSpot`), by swap key. */
    pawnSpot: (pawnKey: number) => React.MutableRefObject<Pt | null>;
}

/** The tower hides the floor behind it: no strike there (the bolt would cross its face). */
const STRIKE_SOLIDS = [{ rect: TOWER_LAYOUT.card, zTop: 1 }];
/**
 * What a scorch must stay clear of, each grown by the mark's radius: a point outside a
 * rounded rect grown by R (radius r + R) is exactly a centre whose R-circle misses the rect.
 * The roam obstacles (tower, lever hatch) plus the plate, which the pawn walks over but which
 * stands proud of the floor.
 */
const STRIKE_KEEP_CLEAR: readonly WorldRect[] = [...TOWER_LAYOUT.roam.obstacles, TOWER_LAYOUT.labelPlate].map((r) =>
    insetRect(r, -BURN_MARK_RADIUS),
);

/** Whether a scorch centred at `at` fits wholly on walkable floor (see the header). */
export function scorchFits(at: Pt): boolean {
    return insideRoundedRect(at, insetRect(TOWER_LAYOUT.roam.area, BURN_MARK_RADIUS)) && !STRIKE_KEEP_CLEAR.some((r) => insideRoundedRect(at, r));
}

/** A random spot to strike (see the header), or null if none was found. */
export function pickStrikePoint(random: () => number = Math.random): Pt | null {
    for (let i = 0; i < 16; i++) {
        // Sampled over the walkable area already shrunk by the mark's radius, so only the
        // obstacles can reject it.
        const spot = openFloorSpot(TOWER_LAYOUT.roam.area, STRIKE_SOLIDS, { inset: BURN_MARK_RADIUS, onSolids: false, random });
        if (spot && scorchFits(spot.at)) return spot.at;
    }
    return null;
}

/** The pawn (swap key) a strike at `at` hits, among pawns standing on the floor, or null. */
export function struckPawn(at: Pt, pawns: readonly { key: number; spot: Pt | null }[]): number | null {
    let best: number | null = null;
    let bestD = STRIKE_HIT_RADIUS;
    for (const p of pawns) {
        if (!p.spot) continue;
        const d = Math.hypot(p.spot.x - at.x, p.spot.y - at.y);
        if (d <= bestD) {
            best = p.key;
            bestD = d;
        }
    }
    return best;
}

/**
 * `world` after a strike at `strike.at` that hit `pawnKey` (or nobody). It leaves a burn only
 * where the whole scorch fits (`scorchFits`): a random strike always does, but a tester's
 * "⚡ Pawn" aims at wherever the pawn stands, which may be nearer an object than a scorch
 * allows — it still shocks him, and leaves no mark.
 */
export function withStrike(world: WorldLightning, strike: TowerStrike, pawnKey: number | null): WorldLightning {
    const burns = scorchFits(strike.at) ? [...world.burns, strike].slice(-MAX_BURNS) : world.burns;
    if (pawnKey === null) return { ...world, burns };
    return {
        burns,
        crispyPawns: world.crispyPawns.includes(pawnKey) ? world.crispyPawns : [...world.crispyPawns, pawnKey],
        shockIds: { ...world.shockIds, [pawnKey]: strike.id },
    };
}
