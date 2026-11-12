import { useEffect } from 'react';
import { useAuth } from '../AuthContext';
import { fetchWeatherShared } from '../api/weather';
import { useWeatherEffectsEnabled } from './useWeatherEffectsSetting';

/**
 * useWeatherPrefetch — starts GET /api/weather as soon as the signed-in user is known, before
 * td (the Deck Tower, `/`) has mounted (docs/LAUNCH_SCREEN.md § "Weather prefetch").
 *
 * Every route is code-split, so on a cold start td's chunk is still downloading when auth
 * resolves. Starting the weather request here overlaps the two, and td's launch screen, which
 * waits for the weather to settle, opens sooner. useTowerWeather reads the same in-flight
 * request (`fetchWeatherShared`), so this never doubles the call.
 *
 * Only when the per-device "Weather effects" setting is on (otherwise td asks for no weather).
 * Keyed on `user?.id`, never on `token` (CLAUDE.md § "Never reload/reset a page on a silent
 * token refresh"; here it would only re-prefetch, but the rule holds).
 *
 * Layer: shared hook (`src/hooks/`), mounted app-wide by App.tsx (`AppPrefetch`).
 * Depends on: src/api/weather.ts, useWeatherEffectsSetting.ts.
 */
export function useWeatherPrefetch(): void {
    const { user } = useAuth();
    const userId = user?.id;
    const enabled = useWeatherEffectsEnabled();
    useEffect(() => {
        if (!enabled || userId === undefined) return;
        // Fire and forget: the answer is picked up from the share by useTowerWeather; a failure
        // is dropped from the share there and retried by td's own read.
        fetchWeatherShared(userId).catch(() => {});
    }, [enabled, userId]);
}
