import { useEffect, useMemo } from "react";
import { useTestingFeatures } from "../hooks/useTestingFeatures";
import { useThemeColor } from "../hooks/useThemeColor";
import { useDayClock } from "./useDayClock";
import { tier2LookAt, type Tier2Look } from "./tier2Look";
import { snappedPhase } from "./dayPhase";
import { claimTier2Chrome, writeTier2Chrome } from "./tier2Chrome";

/**
 * useTier2Look — a Tier 2 page's colours at the learner's time of day, and the claim that
 * lends them to CpcdPopup while the page is mounted.
 *
 * Call it ONCE per page (the page root), then pass the look down: a second call on the
 * same page would be a second claim and a second clock, harmless but wasteful.
 *
 * It also claims the browser chrome / status-bar strip for the ground (useThemeColor), as
 * the Deck Tower does for its sky, so a night page does not sit under a paper-white band.
 *
 * NO TWILIGHT (2026-11-15): only the Deck Tower shows the hour-long day ↔ night blend. A
 * Tier 2 page snaps the clock to its majority phase (dayPhase.ts → `snappedPhase`), so it
 * cuts straight from day to night at the sunrise / sunset itself — the moment the tower's
 * sky is half-way. acp does NOT go through here and keeps the blend (its ground is the
 * tower's sky, features/discover/sortTimeOfDay.ts).
 *
 * The tester time-of-day pin (useDayClock's override, `users.isFeatureTester`) applies, so
 * pinning "night" on the Deck Tower's toggle shows the Dictionary at night too.
 *
 * Layer: shared hook (`src/timeOfDay/`). Depends on: useDayClock.ts, dayPhase.ts,
 * tier2Look.ts, tier2Chrome.ts. Depended on by: features/dictionary/DictionaryPage.tsx,
 * features/lessons/LessonsPage.tsx,
 * features/reader/ReaderPage.tsx, features/reader/ReaderDocumentPage.tsx.
 * Docs: docs/SHELF_REDESIGN.md § 7b "Time of day".
 */
export function useTier2Look(): Tier2Look {
    // Tester time-of-day pin only while testing features are on (useTestingFeatures).
    const { time } = useDayClock(useTestingFeatures());
    // Snap the blend to its majority phase (no twilight here, see the header). Keyed on the
    // phase string, so the look only recomputes when day actually flips to night — not on
    // every minute's sample through the twilight window.
    const phase = snappedPhase(time);
    const look = useMemo(() => tier2LookAt({ from: phase, to: phase, t: 0 }), [phase]);

    // Claim for the page's lifetime; write on every change. Two effects so a clock tick
    // rewrites the variables without releasing and re-claiming in between.
    useEffect(() => claimTier2Chrome(), []);
    useEffect(() => writeTier2Chrome(look), [look]);
    useThemeColor(look.ground);

    return look;
}
