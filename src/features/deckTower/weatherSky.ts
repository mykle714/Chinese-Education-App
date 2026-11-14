import type { WeatherNow } from "../../api/weather";
import { COLORS } from "../../theme/colors";
import { hexToOklch, oklchToHex } from "./iso";
import { TOWER_WORLDS, type TowerWorld, type TowerWorldId } from "./towerWorlds";

/**
 * weatherSky.ts — the main world's DAY sky under the learner's weather
 * (docs/TOWER_WEATHER_SKY.md § 2). Weather sets the HUE; every kind sits at the
 * original `bluMk` lightness (oklch L 0.77) at the most chroma sRGB holds there, so clear
 * weather (and no weather at all) is the original electric blue, the ramp's `bluMk`
 * (`#59BFFF`), and worse weather turns it step by step toward violet. The one exception is
 * OVERCAST, which keeps the cloudy hue but drains its CHROMA and lifts its lightness to a
 * pale blue-grey (`OVERCAST_SKY`).
 *
 * Night still comes from `phaseSky` (timeOfDay.ts), which turns whatever day sky it is
 * given, so night is tinted by the weather too (damped by night's 35% turn), and an
 * overcast day's grey becomes a darker night grey (phaseSky scales night's chroma by the day's).
 * Reading and writing keep their fixed skies (their weather is a later design). The Sort
 * Cards page follows the same hue for its ground (sortTimeOfDay.ts) without the particles.
 *
 * Layer: page logic (feature module `src/features/deckTower`). Pure.
 *
 * Colours: clear is `COLORS.bluMk`; the other hexes are NOT in COLORS
 * (src/theme/colors.ts). They are computed per hue (gamut-max chroma at L 0.77) and live
 * here because nothing else uses them.
 *
 * Depends on: src/api/weather.ts (types), towerWorlds.ts.
 * Depended on by: DeckTowerPage.tsx, discover/AddCardsPage.tsx (hue only, no particles). Docs: docs/TOWER_WEATHER_SKY.md, docs/DECK_TOWER.md § "Weather".
 */

/** The sky kinds, in hue order (overcast last: it is the one grey). Finer than `WeatherKind`:
 *  partly cloudy vs overcast and freezing precipitation are told apart by WMO code. */
type SkyKind = "clear" | "snow" | "partlyCloudy" | "rain" | "sleet" | "storm" | "fog" | "overcast";

/** Partly cloudy's sky (254°) — the sky "cloudy" (then = overcast) had until 2026-11-13. */
const PARTLY_CLOUDY_SKY = "#7DB8FF";

/**
 * OVERCAST's chroma: a fraction of what the gamut holds, so the sky reads as a grey sheet
 * rather than a blue. Every other weather sky sits at gamut-max chroma (~0.12 at L 0.77).
 * Owner, 2026-11-13: "slightly bluer and lighter, like the sky when it's overcast" —
 * raised from 0.03.
 */
const OVERCAST_CHROMA = 0.04;
/**
 * OVERCAST's lightness: above every other weather sky's L 0.77, because a real overcast
 * sky is a bright, pale sheet, not a dim one (owner, 2026-11-13 — raised from 0.77).
 */
const OVERCAST_LIGHTNESS = 0.82;

/**
 * Overcast's sky (2026-11-13): DERIVED from the weather system rather than picked — the
 * cloudy family's own hue (PARTLY_CLOUDY_SKY's 254°), lifted to OVERCAST_LIGHTNESS with its
 * chroma drained to OVERCAST_CHROMA. ≈ #B3C6DE, a pale blue-grey. Night turns it into a
 * darker grey of its own, ≈ #2F3847 (timeOfDay.ts → `phaseSky` keeps a desaturated day
 * desaturated; night's lightness is its own, so OVERCAST_LIGHTNESS does not reach it).
 * ⚠️ Outside the colour framework, like the other sky hexes here.
 */
const OVERCAST_SKY = (() => {
    const [, , h] = hexToOklch(PARTLY_CLOUDY_SKY);
    return oklchToHex(OVERCAST_LIGHTNESS, OVERCAST_CHROMA, h);
})();

/** oklch(77% Cmax h) per kind — the hue in the comment (overcast: L 0.82, chroma 0.04, not Cmax). */
const SKY_BY_KIND: Record<SkyKind, string> = {
    clear: COLORS.bluMk,     // 239° — #59BFFF, the ramp's blue mark (computed: #58BFFF)
    snow: "#79B9FF",         // 252°
    partlyCloudy: PARTLY_CLOUDY_SKY, // 254°
    overcast: OVERCAST_SKY,  // 254°, L 0.82, chroma 0.04 — the pale grey
    rain: "#88B5FF",         // 260° — drizzle and rain
    sleet: "#8DB4FF",        // 263° — freezing drizzle / freezing rain
    storm: "#93B2FF",        // 267°
    fog: "#9DAEFF",          // 274°
};

/** WMO weather code → sky kind. Unknown codes fall back to the observation's `kind`. */
function skyKindOf(weather: WeatherNow): SkyKind {
    const c = weather.wmoCode;
    if (c === 0 || c === 1) return "clear";
    if (c === 2) return "partlyCloudy";
    if (c === 3) return "overcast";
    if (c === 45 || c === 48) return "fog";
    if (c === 56 || c === 57 || c === 66 || c === 67) return "sleet";
    if ((c >= 51 && c <= 55) || (c >= 61 && c <= 65) || (c >= 80 && c <= 82)) return "rain";
    if ((c >= 71 && c <= 77) || c === 85 || c === 86) return "snow";
    if (c >= 95 && c <= 99) return "storm";
    switch (weather.kind) {
        case "drizzle":
        case "rain":
            return "rain";
        case "cloudy":
            return "partlyCloudy";
        default:
            return weather.kind;
    }
}

/** The main world's day sky for this observation; null (loading, off, no location) = clear. */
export function weatherDaySky(weather: WeatherNow | null): string {
    return weather ? SKY_BY_KIND[skyKindOf(weather)] : SKY_BY_KIND.clear;
}

/**
 * TOWER_WORLDS with main's day sky set by the weather. Memoise on `weatherDaySky(...)`:
 * `towerLight().skyOf` caches per world OBJECT, so a new object per render would defeat it.
 */
export function worldsUnderWeather(daySky: string): Record<TowerWorldId, TowerWorld> {
    return { ...TOWER_WORLDS, core: { ...TOWER_WORLDS.core, sky: daySky } };
}
