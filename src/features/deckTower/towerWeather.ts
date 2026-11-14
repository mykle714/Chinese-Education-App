import type { WeatherKind, WeatherNow } from "../../api/weather";
import { WEATHER_KINDS } from "../../../server/contracts/wire";
import { weatherFromWmoCode } from "../../../server/contracts/weatherCodes";

/**
 * towerWeather.ts — the particles the learner's real weather draws over the Deck Tower
 * (docs/DECK_TOWER.md § "Weather"). Purely aesthetic; nothing reads it but the sky
 * (WeatherLayer) and, for fog, the platform (DeckTowerPlatform → IsoFog).
 *
 * Layer: page logic (feature module `src/features/deckTower`). Pure — useTowerWeather
 * supplies the observation; WeatherLayer draws `weatherEffect`'s particles, IsoFog its fog.
 *
 * The SKY COLOUR under weather is not decided here: weatherSky.ts sets the main world's
 * day sky per WMO code (docs/TOWER_WEATHER_SKY.md). This file only says which particles fall.
 *
 * Clouds (iso/IsoCloud, useCloudDrifts) are weather too, but not particles: `weatherCloudCount`
 * says how many may drift past the tower, and the page hands that to SkyTraffic.
 *
 * Depends on: src/api/weather.ts (types), server/contracts/weatherCodes.ts (`weatherFromWmoCode`, for the tester pins).
 * Depended on by: DeckTowerPage.tsx, WeatherLayer.tsx, DeckTowerPlatform.tsx (via the page), useTowerWeather.ts, WeatherToggle.tsx.
 */

/**
 * How a rain streak is drawn — shared by BOTH rain layers (the sky's WeatherLayer behind the
 * scene, and iso/IsoRain in front of the tower, splashing on the platform), so a drop reads
 * the same wherever it falls.
 *   - `RAIN_LEAN`: px of sideways travel per px of fall (a light wind from the left).
 *   - `RAIN_ALPHA`: present, but well under the tower's own whites.
 *   - `RAIN_STROKE_PX`: the streak's width in CSS px.
 */
export const RAIN_LEAN = 0.18;
export const RAIN_ALPHA = 0.42;
export const RAIN_STROKE_PX = 1.2;

/**
 * How a snowflake is drawn — shared by BOTH snow layers (the sky's WeatherLayer behind the
 * scene, and iso/IsoSnow falling in front of the platform and settling on it), so a flake
 * reads the same wherever it falls (docs/TOWER_SNOW.md § "Falling snow").
 *   - `SNOW_ALPHA`: flake opacity.
 *   - `SNOW_R`: flake radius range, CSS px.
 *   - `SNOW_SPEED`: fall speed range, CSS px/s.
 *   - `SNOW_SWAY`: sideways sway amplitude, CSS px; `SNOW_SWAY_RATE`: its phase speed, rad/s.
 */
export const SNOW_ALPHA = 0.85;
export const SNOW_R = [1.1, 2.6] as const;
export const SNOW_SPEED = [28, 64] as const;
export const SNOW_SWAY = 14;
export const SNOW_SWAY_RATE = 0.9;

/**
 * The feature-tester pins (WeatherToggle) — one per DISTINCT look the app can draw.
 *
 * Every pin is a real WMO code, folded through the same `weatherFromWmoCode` the server
 * uses, so a pin draws exactly what that observation would: the particle kind and
 * intensity (towerWeather.ts) AND the sky hue (weatherSky.ts → `skyKindOf`, which reads
 * `wmoCode` and tells apart partly cloudy vs overcast and sleet vs rain).
 *
 * Codes that draw identically share one pin, listed in `alsoCodes` (e.g. rain showers 80
 * fold exactly like slight rain 61). Keep this table in step with the fold in
 * server/contracts/weatherCodes.ts and the sky table in weatherSky.ts: a new code there
 * that draws differently needs a pin here.
 *
 * `defaultPin` per family is what tapping the family chip selects: the heaviest
 * non-freezing look, so the effect is clearly visible (the old one-chip-per-kind pins).
 */
export const WEATHER_PINS = [
    { id: "clear", family: "clear", label: "Clear", wmoCode: 0, alsoCodes: [1] },
    { id: "partly-cloudy", family: "cloudy", label: "Partly", wmoCode: 2, alsoCodes: [] },
    { id: "overcast", family: "cloudy", label: "Overcast", wmoCode: 3, alsoCodes: [] },
    { id: "fog", family: "fog", label: "Fog", wmoCode: 45, alsoCodes: [48] },
    { id: "drizzle-light", family: "drizzle", label: "Light", wmoCode: 51, alsoCodes: [] },
    { id: "drizzle-moderate", family: "drizzle", label: "Moderate", wmoCode: 53, alsoCodes: [] },
    { id: "drizzle-dense", family: "drizzle", label: "Dense", wmoCode: 55, alsoCodes: [] },
    { id: "drizzle-freezing-light", family: "drizzle", label: "Freezing light", wmoCode: 56, alsoCodes: [] },
    { id: "drizzle-freezing-dense", family: "drizzle", label: "Freezing dense", wmoCode: 57, alsoCodes: [] },
    { id: "rain-slight", family: "rain", label: "Slight", wmoCode: 61, alsoCodes: [80] },
    { id: "rain-moderate", family: "rain", label: "Moderate", wmoCode: 63, alsoCodes: [81] },
    { id: "rain-heavy", family: "rain", label: "Heavy", wmoCode: 65, alsoCodes: [82] },
    { id: "rain-freezing-light", family: "rain", label: "Freezing light", wmoCode: 66, alsoCodes: [] },
    { id: "rain-freezing-heavy", family: "rain", label: "Freezing heavy", wmoCode: 67, alsoCodes: [] },
    { id: "snow-grains", family: "snow", label: "Grains", wmoCode: 77, alsoCodes: [] },
    { id: "snow-slight", family: "snow", label: "Slight", wmoCode: 71, alsoCodes: [85] },
    { id: "snow-moderate", family: "snow", label: "Moderate", wmoCode: 73, alsoCodes: [] },
    { id: "snow-heavy", family: "snow", label: "Heavy", wmoCode: 75, alsoCodes: [86] },
    { id: "storm", family: "storm", label: "Thunder", wmoCode: 95, alsoCodes: [] },
    { id: "storm-hail", family: "storm", label: "Hail", wmoCode: 96, alsoCodes: [99] },
] as const satisfies readonly { id: string; family: WeatherKind; label: string; wmoCode: number; alsoCodes: readonly number[] }[];

export type WeatherPin = typeof WEATHER_PINS[number];
export type WeatherPinId = WeatherPin["id"];

/** What tapping a family chip pins (see `WEATHER_PINS`). */
export const WEATHER_FAMILY_DEFAULT_PIN: Record<WeatherKind, WeatherPinId> = {
    clear: "clear",
    cloudy: "overcast",
    fog: "fog",
    drizzle: "drizzle-dense",
    rain: "rain-heavy",
    snow: "snow-heavy",
    storm: "storm-hail",
};

/** The feature-tester pin (WeatherToggle): `auto` follows the real weather. */
export type WeatherOverride = "auto" | WeatherPinId;

const PIN_BY_ID = new Map<string, WeatherPin>(WEATHER_PINS.map((p) => [p.id, p]));

/** The pin with this id, or undefined. */
export function weatherPin(id: WeatherPinId): WeatherPin {
    // The id type guarantees membership; the fallback only guards a hand-edited table.
    return PIN_BY_ID.get(id) ?? WEATHER_PINS[0];
}

/** The pins in one family, in table order (light → heavy, freezing last). */
export function weatherPinsOf(family: WeatherKind): WeatherPin[] {
    return WEATHER_PINS.filter((p) => p.family === family);
}

/**
 * Read a stored override back. Accepts a pin id, or a bare `WeatherKind` stored before the
 * pins went per-code (2026-11-13: "cloudy", "rain", …), which maps to that family's
 * default pin. Anything else reads as Auto.
 */
export function parseWeatherOverride(raw: string | null): WeatherOverride {
    if (!raw) return "auto";
    if (PIN_BY_ID.has(raw)) return raw as WeatherPinId;
    if ((WEATHER_KINDS as readonly string[]).includes(raw)) return WEATHER_FAMILY_DEFAULT_PIN[raw as WeatherKind];
    return "auto";
}

/** A pin's look: exactly what its WMO code draws when it arrives for real (no cloud-cover reading). */
export function pinnedWeather(id: WeatherPinId): WeatherNow {
    return weatherFromWmoCode(weatherPin(id).wmoCode, null);
}

/** What WeatherLayer draws. Counts are per 100,000 px² of sky, so a big screen isn't sparse. */
export interface WeatherEffect {
    /** Rain streaks per 100k px², their fall speed (px/s) and length (px). */
    rainDensity: number;
    rainSpeed: number;
    rainLength: number;
    /** Snowflakes per 100k px². */
    snowDensity: number;
    /**
     * The fog's opacity over the scene, per height level (iso/IsoFog.tsx — fog clouds of
     * skinny staggered pills rolling across the screen at three heights; where levels overlap the
     * fog reads thicker), 0 = none. Drawn by DeckTowerPlatform, NOT WeatherLayer.
     */
    fog: number;
    /** Fire an occasional lightning flash. */
    lightning: boolean;
}

const NONE: WeatherEffect = { rainDensity: 0, rainSpeed: 0, rainLength: 0, snowDensity: 0, fog: 0, lightning: false };

/** True when this observation draws nothing (clear and cloudy have no particles). */
export function isEffectless(effect: WeatherEffect): boolean {
    return effect.rainDensity <= 0 && effect.snowDensity <= 0 && effect.fog <= 0 && !effect.lightning;
}

/** The particles for one observation. */
export function weatherEffect(weather: WeatherNow | null): WeatherEffect {
    if (!weather) return NONE;
    const i = Math.min(1, Math.max(0, weather.intensity));
    switch (weather.kind) {
        case "drizzle":
            // Very light (2–5 per 100k px²): a few streaks, not a shower.
            return { ...NONE, rainDensity: 2 + 3 * i, rainSpeed: 520, rainLength: 9 };
        case "rain":
            // Just above drizzle (5–8), picking up where drizzle's range ends; its longer,
            // faster streaks carry most of the difference. Storm stays the heavy one.
            return { ...NONE, rainDensity: 5 + 3 * i, rainSpeed: 820, rainLength: 16 };
        case "storm":
            return { ...NONE, rainDensity: 22 + 8 * i, rainSpeed: 1050, rainLength: 22, lightning: true };
        case "snow":
            return { ...NONE, snowDensity: 5 + 10 * i };
        case "fog":
            return { ...NONE, fog: 0.2 + 0.12 * i };
        default:
            return NONE;
    }
}

/**
 * How many clouds may drift past the tower at once (SkyTraffic → useCloudDrifts slots), 0 =
 * none. ONLY partly cloudy has clouds:
 *   - rain, snow, storm and fog are cloudy in life, but the tower deliberately draws their
 *     clouds as nothing (a design choice, 2026-11-04 — those kinds already fill the sky with
 *     their own particles);
 *   - OVERCAST (WMO 3) draws none either (2026-11-13): an overcast sky is one unbroken grey
 *     sheet, which the grey sky itself carries (weatherSky.ts → `OVERCAST_SKY`) — separate
 *     drifting clouds would read as broken cloud, i.e. partly cloudy.
 * Partly cloudy (WMO 2, or a `cloudy` observation with an unknown code) always flies
 * `PARTLY_CLOUDY_CLOUDS` — the look overcast had before 2026-11-13. Its `intensity` (cloud
 * cover) no longer changes the count.
 *
 * Referenced by: docs/DECK_TOWER.md § "Weather" and the `CLOUD_BAND_CARDS` row.
 */
export const PARTLY_CLOUDY_CLOUDS = 4;
/** WMO "overcast" — the one cloudy code that flies no clouds. */
const WMO_OVERCAST = 3;
export function weatherCloudCount(weather: WeatherNow | null): number {
    if (!weather || weather.kind !== "cloudy") return 0;
    return weather.wmoCode === WMO_OVERCAST ? 0 : PARTLY_CLOUDY_CLOUDS;
}
