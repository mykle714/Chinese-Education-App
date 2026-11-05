import { COLORS } from "../../theme/colors";
import { ISO, platformTone, spaceOver, type IsoSurface, type PlatformTone } from "./iso";
import { FLOOR_Z, GROUND_Z } from "./towerPlatforms";
import type { MasteryWorldId } from "../../../server/contracts/wire";

/**
 * towerWorlds.ts — the Deck Tower's worlds: one per mastery BAR, each the same platform
 * (towerPlatforms.ts) in its own colours (docs/DECK_TOWER.md § "Worlds").
 *
 * Layer: page constants (feature module `src/features/deckTower`). The learner swipes
 * between them (useWorldPan.ts); each world's tower reads its decks through its own bar.
 *
 *   reading ←  core  → writing        (WORLD_ORDER, left to right)
 *
 * The main (core) world is always there; reading / writing only while the account has
 * that goal on (`users.readingGoal` / `writingGoal`).
 *
 * Colours (the DAY look — timeOfDay.ts turns each sky and lights the rest for night, docs/DECK_TOWER.md § "Time of day"): main is the ramp's blue mark (bluMk, its clear-weather sky; weatherSky.ts turns it by the weather) on a gold platform, reading a green sky (grnSky) on
 * a pink platform (pnk), writing a cherry-blossom pink sky (pnkSky) on a cornflower platform (bluCorn). Each platform sits clear of its
 * sky and of the yellow LEARNING plate (yelM); writing's cornflower platform is well darker
 * than the MASTERED plate (bluM, every world: 82% vs 88% L), so the plate still reads on it.
 * (Writing's sky is no longer its bar's purple — a world's colours are its own, not
 * MASTERY_BAR_HUES.)
 *
 * The focus lever's ball is the same red (`ISO.leverKnob`, redMk) in every world, so the
 * lever reads as one control wherever it stands. `world()` still takes a per-world
 * `leverKnob` should a future sky clash with the red.
 */

export type TowerWorldId = MasteryWorldId;

export interface TowerWorld {
    id: TowerWorldId;
    /** The world's name on the neighbouring worlds' swipe indicators. */
    name: string;
    /** The page title while this world is on screen (the deck shown is on the plate and top card). */
    title: string;
    /**
     * The sky the platform floats in — its DAY sky. Night's is derived from it
     * (timeOfDay.ts `phaseSky`); the page draws `litWorld(world, light)`, whose `sky`,
     * `ground`, `platform`, `floor` and `leverKnob` are the world at the current hour.
     */
    sky: string;
    /** The night the sky darkens into on a tall tower (SpaceBackdrop) — one for every world (`SPACE`). */
    space: string;
    platform: PlatformTone;
    /** The platform's top — the stacks and pawns stand on it, and their shadows fall on it. */
    floor: IsoSurface;
    /** The sky's plane below the platform, which receives its shadow. */
    ground: IsoSurface;
    /** The focus lever's ball (IsoLever `knob`) — chosen to stand off this world's sky. */
    leverKnob: string;
}

/**
 * Space is the same night above every world: the ramp's blue mark (bluMk, main's sky
 * until 2026-11-04) taken down to night. Each world's own sky fades into it, so a tall
 * tower ends in one shared starfield.
 */
const SPACE = spaceOver(COLORS.bluMk);

function world(
    id: TowerWorldId,
    name: string,
    title: string,
    sky: string,
    platformBase: string,
    leverKnob: string = ISO.leverKnob,
): TowerWorld {
    const platform = platformTone(platformBase);
    return {
        id,
        name,
        title,
        sky,
        space: SPACE,
        platform,
        floor: { z: FLOOR_Z, color: platform.material.top },
        ground: { z: GROUND_Z, color: sky },
        leverKnob,
    };
}

export const TOWER_WORLDS: Record<TowerWorldId, TowerWorld> = {
    core: world("core", "Main", "Flashcards", COLORS.bluMk, COLORS.gld),
    reading: world("reading", "Reading", "Reading Flashcards", COLORS.grnSky, COLORS.pnk),
    // Night (#4A2851, plum) comes from the shared night recipe, like every world's.
    writing: world("writing", "Writing", "Writing Flashcards", COLORS.pnkSky, COLORS.bluCorn),
};

/** Left to right. A swipe LEFT moves the camera right (core → writing); a swipe RIGHT, left. */
export const WORLD_ORDER: readonly TowerWorldId[] = ["reading", "core", "writing"];
