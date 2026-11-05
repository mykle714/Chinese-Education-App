import type { WeatherKind, WeatherNow } from "../../api/weather";

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
 * Depends on: src/api/weather.ts (types).
 * Depended on by: DeckTowerPage.tsx, WeatherLayer.tsx, DeckTowerPlatform.tsx (via the page), useTowerWeather.ts, WeatherToggle.tsx.
 */

/**
 * How a rain streak is drawn — shared by BOTH rain layers (the sky's WeatherLayer behind the
 * scene, and PlatformRain in front of the tower, splashing on the platform), so a drop reads
 * the same wherever it falls.
 *   - `RAIN_LEAN`: px of sideways travel per px of fall (a light wind from the left).
 *   - `RAIN_ALPHA`: present, but well under the tower's own whites.
 *   - `RAIN_STROKE_PX`: the streak's width in CSS px.
 */
export const RAIN_LEAN = 0.18;
export const RAIN_ALPHA = 0.42;
export const RAIN_STROKE_PX = 1.2;

/** The feature-tester pin (WeatherToggle): `auto` follows the real weather. */
export type WeatherOverride = "auto" | WeatherKind;

/**
 * A representative WMO code per kind, so a tester pin reads like a real observation
 * (the heaviest version of the kind, so the effect is clearly visible).
 */
const PIN_CODE: Record<WeatherKind, number> = {
    clear: 0,
    cloudy: 3,
    fog: 45,
    drizzle: 55,
    rain: 65,
    snow: 75,
    storm: 95,
};

/** A pinned kind's look, for the tester toggle. */
export function pinnedWeather(kind: WeatherKind): WeatherNow {
    return {
        kind,
        intensity: kind === "clear" ? 0 : kind === "drizzle" ? 0.6 : 1,
        wmoCode: PIN_CODE[kind],
        cloudCover: null,
    };
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
 * none. ONLY the `cloudy` kind has clouds: rain, snow, storm and fog are cloudy in life, but
 * the tower deliberately draws their clouds as nothing (a design choice, 2026-11-04 — those
 * kinds already fill the sky with their own particles). The count follows intensity:
 * partly cloudy (WMO 2, intensity 0.35–0.7) → 2–3, overcast (WMO 3, intensity 1) → 4.
 *
 * Referenced by: docs/DECK_TOWER.md § "Weather" and the `CLOUD_BAND_CARDS` row.
 */
export const CLOUDS_MIN = 2;
export const CLOUDS_MAX = 4;
export function weatherCloudCount(weather: WeatherNow | null): number {
    if (!weather || weather.kind !== "cloudy") return 0;
    const i = Math.min(1, Math.max(0, weather.intensity));
    return Math.min(CLOUDS_MAX, Math.max(CLOUDS_MIN, 1 + Math.round(3 * i)));
}
