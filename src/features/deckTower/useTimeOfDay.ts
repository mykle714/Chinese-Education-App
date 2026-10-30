import { useMemo } from "react";
import { useDayClock, type TimeOfDayOverride } from "../../timeOfDay/useDayClock";
import { towerLight, type TowerLight } from "./timeOfDay";

/**
 * useTimeOfDay — the Deck Tower's light for the learner's time of day
 * (docs/DECK_TOWER.md § "Time of day").
 *
 * Layer: page logic (feature module `src/features/deckTower`).
 *
 * The CLOCK (sampling, the device location, the feature-tester override and its per-device
 * storage) is the shared `useDayClock` (src/timeOfDay/), which the eip's tint also reads —
 * so the tower and an eip open over it always agree on the hour. This hook only turns the
 * blend into the tower's light. The light is keyed on the clock's `time` object, which
 * useDayClock keeps by identity across unchanged samples, so IsoScene's washed palette is
 * not rebuilt every minute.
 *
 * Depends on: src/timeOfDay/useDayClock.ts, timeOfDay.ts. Depended on by: DeckTowerPage.tsx.
 */

export type { TimeOfDayOverride };

export function useTimeOfDay(allowOverride: boolean): {
    light: TowerLight;
    override: TimeOfDayOverride;
    setOverride: (v: TimeOfDayOverride) => void;
} {
    const { time, override, setOverride } = useDayClock(allowOverride);
    const light = useMemo(() => towerLight(time), [time]);
    return { light, override, setOverride };
}
