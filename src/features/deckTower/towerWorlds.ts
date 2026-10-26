import { COLORS } from "../../theme/colors";
import { ISO, platformTone, spaceOver, type IsoSurface, type PlatformTone } from "./iso";
import { FLOOR_Z, GROUND_Z } from "./towerPlatforms";
import type { MasteryWorldId } from "../../../server/contracts/wire";
import type { DayPhase, SkyRecipe } from "./timeOfDay";

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
 * Colours (the DAY look — timeOfDay.ts turns each sky and lights the rest for dawn, sunset
 * and night, docs/DECK_TOWER.md § "Time of day"): main is a blue sky (bluMk) on a gold platform, reading a green sky (grnSky) on
 * a pink platform (pnk), writing a powder-pink sky (pnkSky) on a blue platform (bluMk). Each platform sits clear of its
 * sky and of the yellow LEARNING plate (yelM); writing's blue platform is the same hue as
 * the MASTERED plate (bluM, every world) but a tier deeper, so the plate still reads on it.
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
     * The sky the platform floats in — its DAY sky. Dawn, sunset and night are derived from
     * it (timeOfDay.ts `phaseSky`); the page draws `litWorld(world, light)`, whose `sky`,
     * `ground`, `platform`, `floor` and `leverKnob` are the world at the current hour.
     */
    sky: string;
    /**
     * Per-phase overrides of timeOfDay.ts `PHASE_SKY`, for a world whose sky would
     * otherwise land too close to another world's (or wrong for its own). Reading's sunset
     * is a deeper vermilion, so it doesn't match writing's orange; writing's dawn is lilac.
     */
    skyRecipes?: Partial<Record<Exclude<DayPhase, "day">, SkyRecipe>>;
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
 * Space is the same night above every world: main's blue sky taken down to night. Each
 * world's own sky fades into it, so a tall tower ends in one shared starfield.
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
    reading: {
        ...world("reading", "Reading", "Reading Flashcards", COLORS.grnSky, COLORS.pnk),
        // Sunset: hue 35 at 95% and a little darker → vermilion #EC6D3B (shared recipe: #EC8900, ≈ writing's #F5802A).
        skyRecipes: { sunset: { hue: 35, hueBy: 0.95, L: 0.68, C: 0.17 } },
    },
    writing: {
        ...world("writing", "Writing", "Writing Flashcards", COLORS.pnkSky, COLORS.bluMk),
        // Dawn: the shared recipe turns powder pink DARKER and hotter (#FF9DA2) than its own
        // day sky; instead it turns cool toward lilac at about day's lightness → #EAC2EA,
        // clear of main's pink dawn and reading's peach. Sunset (#F67F2F) and night
        // (#4F274A, plum) keep the shared recipe.
        skyRecipes: { dawn: { hue: 300, hueBy: 0.6, L: 0.86, C: 0.07 } },
    },
};

/** Left to right. A swipe LEFT moves the camera right (core → writing); a swipe RIGHT, left. */
export const WORLD_ORDER: readonly TowerWorldId[] = ["reading", "core", "writing"];
