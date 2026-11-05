/**
 * sortTimeOfDay.ts — the Add New Cards page's colours at the learner's time of day
 * (docs/SORT_CARDS_REQUIREMENTS.md § 4.9 "Tier-2 ground").
 *
 * Layer: page logic (feature module `src/features/discover`). Pure; no React.
 *
 * ancp is a "tier 2" page under the Deck Tower: it follows the same clock
 * (`src/timeOfDay/useDayClock`, docs/DECK_TOWER.md § "Time of day"). The ground IS the main
 * world's sky (its weather sky by day, that sky turned to night), derived from the tower's
 * own recipe so the two cannot drift. Only the ground, the shadows cast on it, and the ink drawn straight on it
 * change between phases. Night adds the tower's stars and shooting stars on it (`stars`, `shootingStars`). The ink goes light and the page's keycaps (level pill,
 * undo, skip) go slate. The cards themselves never change — they are the same cream stock
 * in every phase.
 *
 * Weather: ancp honours the weather's HUE but draws none of its effects (no rain, snow,
 * fog or lightning). The caller passes main's weather day sky (`weatherDaySky`,
 * deckTower/weatherSky.ts); the day ground IS that sky and the night ground is that sky
 * turned to night — the same colours the tower shows. (Dawn's and sunset's fixed pale
 * tints were cut 2026-11-04 with those phases, docs/TOWER_WEATHER_SKY.md § 1.)
 *
 * Source: Claude Design project "Tower Tier 2 - Time of Day", the "Sort ·" artboards
 * (`GR` and the `.t2n .sx-sort` overrides).
 *
 * ⚠️ Outside the colour framework (like the tower's derived skies): night's platform and
 * night's slate keycap tones are design-picked hexes with no `COLORS` / `RAMP` token. They
 * live only here.
 *
 * Depends on: src/timeOfDay/dayPhase.ts (`DayPhase`, `TimeOfDay`), deckTower/iso (`mixHex`,
 * `shadowTone`), deckTower/weatherSky.ts (the caller's day sky), deckTower/timeOfDay.ts (`phaseSky`, `towerLight`), deckTower/towerWorlds.ts
 * (`TOWER_WORLDS`). Depended on by: AddNewCardsPage.tsx, SortBins.tsx.
 */
import { mixHex, shadowTone } from "../deckTower/iso";
import { phaseSky, towerLight } from "../deckTower/timeOfDay";
import { TOWER_WORLDS } from "../deckTower/towerWorlds";
import type { DayPhase, TimeOfDay } from "../../timeOfDay/dayPhase";
import { COLORS } from "../../theme/colors";

/** Everything ancp paints with for one time of day. */
export interface SortLook {
    /** The page ground (the frame's surface colour, and the iso scene's shadow receiver). */
    ground: string;
    /** A shadow cast on the ground (cards, keycaps, the slab footer) — the iso shadow rule. */
    groundShadow: string;
    /** The bins' floating platforms. */
    platform: string;
    /** Ink drawn straight on the ground: the header title and back arrow. */
    ink: string;
    /** Softer ink on the ground: each card's tier label, frequency dots and action icons. */
    inkSoft: string;
    /** A bin's "0" printed on its empty platform. */
    countEmpty: string;
    /** Keycap face (level pill, undo, skip). */
    keyFace: string;
    /** Keycap lip (the solid `0 3px 0` under its face). */
    keyWall: string;
    /** Keycap glyphs. */
    keyInk: string;
    /**
     * How far an empty bin's dashed footprint is darkened from its deck colour (a
     * `shadeHex` amount). Deeper at night: the night platform is grey, and the pale
     * yellow footprint that reads on a white day platform all but vanishes on it.
     */
    footprintShade: number;
    /** The star field's opacity: the tower's own from-the-ground value at this hour. */
    stars: number;
    /** Whether meteors fly: the tower's own rule, so both skies turn them on together. */
    shootingStars: boolean;
}

/** The day keycaps: card stock, the same cream as the slab footer and the cards. */
const DAY_KEYS = { keyFace: COLORS.cardFace, keyWall: COLORS.cardWall, keyInk: COLORS.onSurface } as const;

/**
 * Ink on the day ground, which IS the tower's sky: white, like the tower's own sky ink
 * (DeckTowerPage `skyInk` — the day wash is unlit, so it is plain white). `countEmpty` is
 * printed on the white platforms, so it keeps the dark day tone.
 */
const SKY_INK = { ink: COLORS.white, inkSoft: COLORS.white, countEmpty: COLORS.textSecondary } as const;

type PhaseLook = Omit<SortLook, "groundShadow" | "footprintShade" | "stars" | "shootingStars">;

/** `SortLook.footprintShade` per phase — a number, so blended apart from the hexes. */
const FOOTPRINT_SHADE: Record<DayPhase, number> = { day: 0.18, night: 0.45 };

/** The fixed phase looks; `day.ground` and `night.ground` are replaced per weather in `lookFor`. */
const PHASE_LOOK: Record<DayPhase, PhaseLook> = {
    // The main world's day sky itself (was the pale tint #E4F2FC until 2026-11-04) —
    // replaced by the weather's day sky in `lookFor`.
    day: { ground: TOWER_WORLDS.core.sky, platform: COLORS.white, ...SKY_INK, ...DAY_KEYS },
    // The tower's main-world night sky, so the page reads as the same sky; light ink, slate
    // keycaps. ancp has no world of its own, so reading/writing's night skies do not apply.
    night: {
        ground: phaseSky(TOWER_WORLDS.core, "night"), // overridden by the weather's night sky
        platform: "#E4E5E9",
        ink: "#EEF0F6",
        inkSoft: "#C3C8D6",
        countEmpty: "#8F97AA",
        keyFace: "#2A3446",
        keyWall: "#121822",
        keyInk: "#EEF0F6",
    },
};

const LOOK_KEYS = Object.keys(PHASE_LOOK.day) as (keyof PhaseLook)[];

/** A phase's look under main's weather day sky: the day and night grounds are the tower's skies. */
function lookFor(phase: DayPhase, mainDaySky: string): PhaseLook {
    return { ...PHASE_LOOK[phase], ground: phaseSky({ sky: mainDaySky }, phase) };
}

/**
 * ancp's look at `time` — the two bracketing phases blended by `t`, like the tower's sky
 * (`towerLight` → `skyOf`). A blend into night therefore fades every colour, ink
 * included, rather than flipping at a threshold. `mainDaySky` is main's weather day sky
 * (`weatherDaySky`); it defaults to the static `TOWER_WORLDS.core.sky` (bluMk, clear).
 */
export function sortLookAt(time: TimeOfDay, mainDaySky: string = TOWER_WORLDS.core.sky): SortLook {
    const from = lookFor(time.from, mainDaySky);
    const to = lookFor(time.to, mainDaySky);
    const mixed = {} as PhaseLook;
    for (const key of LOOK_KEYS) mixed[key] = time.t <= 0 ? from[key] : mixHex(from[key], to[key], time.t);
    const t = Math.max(0, time.t);
    const footprintShade = FOOTPRINT_SHADE[time.from] + (FOOTPRINT_SHADE[time.to] - FOOTPRINT_SHADE[time.from]) * t;
    const { groundStars, shootingStars } = towerLight(time);
    return { ...mixed, groundShadow: shadowTone(mixed.ground), footprintShade, stars: groundStars, shootingStars };
}
