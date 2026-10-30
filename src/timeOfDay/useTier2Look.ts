import { useEffect, useMemo } from "react";
import { useAuth } from "../AuthContext";
import { useThemeColor } from "../hooks/useThemeColor";
import { useDayClock } from "./useDayClock";
import { tier2LookAt, type Tier2Look } from "./tier2Look";
import { claimTier2Chrome, writeTier2Chrome } from "./tier2Chrome";

/**
 * useTier2Look — a Tier 2 page's colours at the learner's time of day, and the claim that
 * lends them to the footer and keyboard while the page is mounted.
 *
 * Call it ONCE per page (the page root), then pass the look down: a second call on the
 * same page would be a second claim and a second clock, harmless but wasteful.
 *
 * It also claims the browser chrome / status-bar strip for the ground (useThemeColor), as
 * the Deck Tower does for its sky, so a night page does not sit under a paper-white band.
 *
 * The tester time-of-day pin (useDayClock's override, `users.isFeatureTester`) applies, so
 * pinning "night" on the Deck Tower's toggle shows the Dictionary at night too.
 *
 * Layer: shared hook (`src/timeOfDay/`). Depends on: useDayClock.ts, tier2Look.ts,
 * tier2Chrome.ts. Depended on by: features/dictionary/DictionaryPage.tsx,
 * features/dictionary/DictionaryCardDetailPage.tsx.
 * Docs: docs/SHELF_REDESIGN.md § 7b "Time of day".
 */
export function useTier2Look(): Tier2Look {
    const { user } = useAuth();
    const { time } = useDayClock(user?.isFeatureTester === true);
    // `time` keeps its identity while the look is unchanged (useDayClock), so this only
    // recomputes on a real change.
    const look = useMemo(() => tier2LookAt(time), [time]);

    // Claim for the page's lifetime; write on every change. Two effects so a clock tick
    // rewrites the variables without releasing and re-claiming in between.
    useEffect(() => claimTier2Chrome(), []);
    useEffect(() => writeTier2Chrome(look), [look]);
    useThemeColor(look.ground);

    return look;
}
