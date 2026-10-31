import { createContext, useContext, useMemo } from "react";
import { useAuth } from "../AuthContext";
import { useDayClock } from "./useDayClock";
import { NO_WASH, phaseWash, type IsoWash } from "./wash";

/**
 * The tower's light for HTML drawn as a tower object (docs/TOWER_STYLE_SHIFT.md § "The play
 * slab"). A surface runs its colours through the wash; there is no filter over the DOM, so a
 * repaint costs nothing extra.
 *
 * One clock for a whole surface: its owner calls `useDayWash` and provides the result, and
 * every part reads `useTowerWash`. Ten Match Speed cards must not run ten clocks. With no
 * provider, `useTowerWash` is `NO_WASH`, which is what every bento game gets.
 *
 * The tester time-of-day pin applies (useDayClock's override), as on the tower.
 *
 * Layer: shared hook (`src/timeOfDay/`). Depends on: useDayClock.ts, wash.ts, AuthContext.
 * Depended on by: games/match-speed/*, games/shared/GameFrame.tsx,
 * features/flashcards/FlashcardsLearnPage/gameBreak/GameBreakArea.tsx.
 */
export function useDayWash(): IsoWash {
    const { user } = useAuth();
    const { time } = useDayClock(user?.isFeatureTester === true);
    // `time` keeps its identity while the look is unchanged (useDayClock).
    return useMemo(() => phaseWash(time), [time]);
}

export const TowerWashContext = createContext<IsoWash>(NO_WASH);

/** The enclosing surface's wash: identity-stable, so a memoized card only redraws when the light changes. */
export const useTowerWash = (): IsoWash => useContext(TowerWashContext);
