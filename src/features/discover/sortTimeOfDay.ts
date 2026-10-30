/**
 * sortTimeOfDay.ts — the Sort Cards page's colours at the learner's time of day
 * (docs/SORT_CARDS_REQUIREMENTS.md § 4.9 "Tier-2 ground").
 *
 * Layer: page logic (feature module `src/features/discover`). Pure; no React.
 *
 * scp is a "tier 2" page under the Deck Tower: it follows the same clock
 * (`src/timeOfDay/useDayClock`, docs/DECK_TOWER.md § "Time of day") but has no sky. Its ground is a
 * pale tint of the tower's sky at that hour; only the ground, the shadows cast on it,
 * and the ink drawn straight on it change between dawn, day and sunset. Night is the
 * exception: the ground goes deep slate, the ink on it goes light, and the page's
 * keycaps (level pill, undo, skip) go slate with it. The cards themselves never change —
 * they are the same cream stock in every phase.
 *
 * Source: Claude Design project "Tower Tier 2 - Time of Day", the three "Sort ·" artboards
 * per phase (`GR` and the `.t2n .sx-sort` overrides).
 *
 * ⚠️ Outside the colour framework (like the tower's derived skies): the four grounds,
 * night's platform and night's slate keycap tones are design-picked hexes with no
 * `COLORS` / `RAMP` token. They live only here.
 *
 * Depends on: src/timeOfDay/dayPhase.ts (`DayPhase`, `TimeOfDay`), deckTower/iso (`mixHex`,
 * `shadowTone`). Depended on by: SortCardsPage.tsx, SortBins.tsx.
 */
import { mixHex, shadowTone } from "../deckTower/iso";
import type { DayPhase, TimeOfDay } from "../../timeOfDay/dayPhase";
import { COLORS } from "../../theme/colors";

/** Everything scp paints with for one time of day. */
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
}

/** The day keycaps: card stock, the same cream as the slab footer and the cards. */
const DAY_KEYS = { keyFace: COLORS.cardFace, keyWall: COLORS.cardWall, keyInk: COLORS.onSurface } as const;

/** Ink on a pale ground. */
const DAY_INK = { ink: COLORS.onSurface, inkSoft: COLORS.iconColor, countEmpty: COLORS.textSecondary } as const;

type PhaseLook = Omit<SortLook, "groundShadow" | "footprintShade">;

/** `SortLook.footprintShade` per phase — a number, so blended apart from the hexes. */
const FOOTPRINT_SHADE: Record<DayPhase, number> = { dawn: 0.18, day: 0.18, sunset: 0.18, night: 0.45 };

const PHASE_LOOK: Record<DayPhase, PhaseLook> = {
    // Pale tint of the tower's dawn sky (hue ≈ 351, rose).
    dawn: { ground: "#FAE9EE", platform: COLORS.white, ...DAY_INK, ...DAY_KEYS },
    // Pale tint of the main world's day sky (bluMk).
    day: { ground: "#E4F2FC", platform: COLORS.white, ...DAY_INK, ...DAY_KEYS },
    // Pale tint of the sunset sky (hue ≈ 37, coral).
    sunset: { ground: "#FBEADB", platform: COLORS.white, ...DAY_INK, ...DAY_KEYS },
    // Deep slate below the tower's night sky (hue ≈ 249); light ink, slate keycaps.
    night: {
        ground: "#1E2735",
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

/**
 * scp's look at `time` — the two bracketing phases blended by `t`, like the tower's sky
 * (`towerLight` → `skyOf`). A blend into night therefore fades every colour, ink
 * included, rather than flipping at a threshold.
 */
export function sortLookAt(time: TimeOfDay): SortLook {
    const from = PHASE_LOOK[time.from];
    const to = PHASE_LOOK[time.to];
    const mixed = {} as PhaseLook;
    for (const key of LOOK_KEYS) mixed[key] = time.t <= 0 ? from[key] : mixHex(from[key], to[key], time.t);
    const t = Math.max(0, time.t);
    const footprintShade = FOOTPRINT_SHADE[time.from] + (FOOTPRINT_SHADE[time.to] - FOOTPRINT_SHADE[time.from]) * t;
    return { ...mixed, groundShadow: shadowTone(mixed.ground), footprintShade };
}
