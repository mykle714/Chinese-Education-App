import type { WeatherNow } from "../../api/weather";
import { COLORS } from "../../theme/colors";
import { TOWER_WORLDS, type TowerWorld, type TowerWorldId } from "./towerWorlds";

/**
 * weatherSky.ts — the main world's DAY sky under the learner's weather
 * (docs/TOWER_WEATHER_SKY.md § 2). Weather sets only the HUE; every kind sits at the
 * original `bluMk` lightness (oklch L 0.77) at the most chroma sRGB holds there, so clear
 * weather (and no weather at all) is the original electric blue, the ramp's `bluMk`
 * (`#59BFFF`), and worse weather turns it step by step toward violet.
 *
 * Night still comes from `phaseSky` (timeOfDay.ts), which turns whatever day sky it is
 * given, so night is tinted by the weather too (damped by night's 35% turn).
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
 * Depended on by: DeckTowerPage.tsx, discover/AddNewCardsPage.tsx (hue only, no particles). Docs: docs/TOWER_WEATHER_SKY.md, docs/DECK_TOWER.md § "Weather".
 */

/** The sky kinds, in hue order. Finer than `WeatherKind`: partly cloudy and freezing
 *  precipitation are told apart by WMO code. */
type SkyKind = "clear" | "partlyCloudy" | "snow" | "cloudy" | "rain" | "sleet" | "storm" | "fog";

/** oklch(77% Cmax h) per kind — the hue in the comment. */
const SKY_BY_KIND: Record<SkyKind, string> = {
    clear: COLORS.bluMk,     // 239° — #59BFFF, the ramp's blue mark (computed: #58BFFF)
    partlyCloudy: "#6CBBFF", // 246°
    snow: "#79B9FF",         // 252°
    cloudy: "#7DB8FF",       // 254°
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
    if (c === 3) return "cloudy";
    if (c === 45 || c === 48) return "fog";
    if (c === 56 || c === 57 || c === 66 || c === 67) return "sleet";
    if ((c >= 51 && c <= 55) || (c >= 61 && c <= 65) || (c >= 80 && c <= 82)) return "rain";
    if ((c >= 71 && c <= 77) || c === 85 || c === 86) return "snow";
    if (c >= 95 && c <= 99) return "storm";
    switch (weather.kind) {
        case "drizzle":
        case "rain":
            return "rain";
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
