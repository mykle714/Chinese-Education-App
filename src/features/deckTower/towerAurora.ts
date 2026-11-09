import { useEffect, useMemo, useState } from "react";
import { COLORS } from "../../theme/colors";
import { mixHex } from "./iso";
import type { IsoWash } from "./iso";
import type { WeatherNow } from "../../api/weather";
import type { TowerWorldId } from "./towerWorlds";

/**
 * towerAurora.ts — the reading world's rare aurora (docs/DECK_TOWER.md § "Time of day" →
 * "Aurora").
 *
 * Layer: page logic (feature module `src/features/deckTower`). `useTowerAurora` decides
 * whether this page visit has one; the page turns that into a per-world STRENGTH (carried
 * through the world pan's palette, so it fades with a swipe like the sky does) and a
 * glow on the scene's wash. AuroraLayer.tsx draws it inside SpaceBackdrop.
 *
 * The rules (decided 2026-11-08):
 *   - READING ONLY (`AURORA_WORLD`). Main and writing never get one.
 *   - A 1% roll (`AURORA_CHANCE`), ONCE PER PAGE VISIT: made the first time during this
 *     mount of DeckTowerPage that the look is mostly night (`light.shootingStars`) AND the
 *     sky is clear (`auroraCanRoll`). A visit that never gets there never rolls.
 *   - CLEAR means no known non-clear weather: a `clear` reading, OR no reading at all
 *     (weather effects off — the default — or the fetch failed), so learners without
 *     weather still get the roll. With weather on, the roll waits for the first answer
 *     (useTowerWeather `settled`) so it can't fire on "not loaded yet". A tester's weather
 *     pin counts like a real reading. Swiping between worlds keeps the result; it
 *     ends only when the learner leaves the page (DeckTowerPage unmounts — the flp runs in
 *     place, so a study session does not end it).
 *   - It shows only at night: its strength is night's share of the blend, so it fades in
 *     and out across the twilight like the stars.
 *   - While it shows, it is the sky's only event: the weather's effects (rain, snow,
 *     lightning, fog, clouds) and the shooting stars are suppressed in that world
 *     (DeckTowerPage → `auroraUp`). The weather still reads (main's day sky follows it).
 *   - Feature testers can force it On / Off (AuroraToggle). The override is page state,
 *     NOT per-device storage: like the aurora itself, it lasts until the page is left.
 *
 * Depended on by: DeckTowerPage.tsx, AuroraLayer.tsx, AuroraToggle.tsx.
 */

/** The only world that can have an aurora. */
export const AURORA_WORLD: TowerWorldId = "reading";

/** Chance that a page visit's first night has an aurora. */
export const AURORA_CHANCE = 0.01;

/**
 * The aurora's colours: the bright lower edge is the reading world's own DAY sky
 * (grnSky), so the day sky returns as the night's light; its high tips fade into the
 * reading platform's orchid (pnk). Both are COLORS tokens.
 */
export const AURORA_COLORS = { base: COLORS.grnSky, fringe: COLORS.pnk } as const;

/**
 * How far the aurora's light tints everything drawn on the sky (platform, cards, pawns,
 * title) at full strength: an sRGB mix this far toward `AURORA_COLORS.base`, laid over
 * night's wash. The explorer's "platform glow 35% × intensity 75%" setting.
 */
export const AURORA_GLOW = 0.058;

/**
 * The band of the screen the aurora fills: its top and bottom edges as fractions of the
 * backdrop's height (the full screen) from the top. Tune here.
 */
export const AURORA_BAND = { top: 0.05, bottom: 0.6 } as const;

export type AuroraOverride = "auto" | "on" | "off";

/**
 * Whether the roll may be made now: mostly night, the weather has answered, and it is
 * not known to be anything but clear (see the header's CLEAR rule).
 */
export function auroraCanRoll(mostlyNight: boolean, weather: WeatherNow | null, weatherSettled: boolean): boolean {
    return mostlyNight && weatherSettled && (weather === null || weather.kind === "clear");
}

/**
 * Whether this page visit has an aurora, plus the tester override.
 * `canRoll` = `auroraCanRoll(…)`; `allowOverride` = `useTestingFeatures()`.
 */
export function useTowerAurora(
    canRoll: boolean,
    allowOverride: boolean,
): { active: boolean; override: AuroraOverride; setOverride: (v: AuroraOverride) => void } {
    // null = not rolled yet (no clear night seen this visit).
    const [rolled, setRolled] = useState<boolean | null>(null);
    useEffect(() => {
        if (rolled === null && canRoll) setRolled(Math.random() < AURORA_CHANCE);
    }, [canRoll, rolled]);
    const [override, setOverride] = useState<AuroraOverride>("auto");
    // Turning testing features off mid-visit drops back to the real roll.
    const effective: AuroraOverride = allowOverride ? override : "auto";
    const active = effective === "on" ? true : effective === "off" ? false : rolled === true;
    return { active, override: effective, setOverride };
}

/** True while an aurora is showing in `world` — the page then suppresses the weather's effects and the shooting stars there. */
export function auroraShowing(world: TowerWorldId, active: boolean, nightShare: number): boolean {
    return auroraStrength(world, active, nightShare) > 0;
}

/** A world's aurora strength right now, 0 → 1: night's share in the aurora world, else 0. */
export function auroraStrength(world: TowerWorldId, active: boolean, nightShare: number): number {
    return active && world === AURORA_WORLD ? nightShare : 0;
}

/**
 * `wash` with the aurora's light laid over it at `strength` (0 = `wash` itself, same
 * identity, so an aurora-less scene keeps every memo keyed on the wash). Memoised per
 * colour: IsoScene asks for the same few dozen colours every frame.
 */
export function useAuroraGlowWash(wash: IsoWash, strength: number): IsoWash {
    // Stepped so a twilight (strength drifting minute by minute) doesn't re-wash the scene's
    // palette on every sample.
    const step = Math.round(strength * 20) / 20;
    return useMemo(() => {
        if (step <= 0) return wash;
        const amount = AURORA_GLOW * step;
        const cache = new Map<string, string>();
        return (hex: string) => {
            let out = cache.get(hex);
            if (out === undefined) {
                out = mixHex(wash(hex), AURORA_COLORS.base, amount);
                cache.set(hex, out);
            }
            return out;
        };
    }, [wash, step]);
}
