import type { WeatherNow } from './wire.js';

/**
 * weatherCodes.ts — how an Open-Meteo WMO weather code folds into what the Deck Tower
 * draws (docs/DECK_TOWER.md § "Weather").
 *
 * ── Why this lives in `server/contracts/` ─────────────────────────────────────
 * Both halves need the SAME fold:
 *   - the server turns every real observation into a `WeatherNow`
 *     (server/services/WeatherService.ts → `fetchCell`);
 *   - the client's feature-tester pins (src/features/deckTower/towerWeather.ts →
 *     `pinnedWeather`) are a WMO code too, and must draw exactly what that code draws
 *     when it arrives for real. Folding through this one function is what guarantees a
 *     pin is a faithful preview rather than a hand-tuned approximation.
 * It sits outside `wire.ts` because it is logic, not a wire type (same split as
 * featureFlags.ts).
 *
 * Depends on: server/contracts/wire.ts (`WeatherNow`, `WeatherKind`).
 * Depended on by: server/services/WeatherService.ts, src/features/deckTower/towerWeather.ts.
 * Documented in: docs/DECK_TOWER.md § "Weather", docs/TOWER_WEATHER_SKY.md § 2.
 */

/**
 * Fold an Open-Meteo WMO weather code (and the cloud-cover percentage, used for the
 * partly-cloudy band) into what the tower draws. Unknown codes read as clear — a
 * missing effect is harmless, a wrong one is not.
 *
 * WMO table: https://open-meteo.com/en/docs → "WMO Weather interpretation codes".
 */
export function weatherFromWmoCode(code: number, cloudCoverPct: number | null): WeatherNow {
  const cloudCover = cloudCoverPct === null ? null : Math.min(1, Math.max(0, cloudCoverPct / 100));
  return { ...foldWmoCode(code, cloudCover ?? 0), wmoCode: code, cloudCover };
}

/** The kind + intensity half of `weatherFromWmoCode`. */
function foldWmoCode(code: number, cloud: number): Pick<WeatherNow, 'kind' | 'intensity'> {
  switch (code) {
    case 0:
    case 1: return { kind: 'clear', intensity: 0 };              // clear / mainly clear
    case 2: return { kind: 'cloudy', intensity: Math.max(0.35, cloud * 0.7) }; // partly cloudy
    case 3: return { kind: 'cloudy', intensity: 1 };             // overcast
    case 45:
    case 48: return { kind: 'fog', intensity: 1 };               // fog / rime fog
    case 51: case 56: return { kind: 'drizzle', intensity: 0.3 };
    case 53: return { kind: 'drizzle', intensity: 0.55 };
    case 55: case 57: return { kind: 'drizzle', intensity: 0.8 };
    case 61: case 80: return { kind: 'rain', intensity: 0.35 };  // slight rain / showers
    case 63: case 66: case 81: return { kind: 'rain', intensity: 0.65 };
    case 65: case 67: case 82: return { kind: 'rain', intensity: 1 };
    case 77: return { kind: 'snow', intensity: 0.3 };            // snow grains
    case 71: case 85: return { kind: 'snow', intensity: 0.35 };
    case 73: return { kind: 'snow', intensity: 0.65 };
    case 75: case 86: return { kind: 'snow', intensity: 1 };
    case 95: return { kind: 'storm', intensity: 0.8 };
    case 96:
    case 99: return { kind: 'storm', intensity: 1 };             // thunderstorm with hail
    default: return { kind: 'clear', intensity: 0 };
  }
}
