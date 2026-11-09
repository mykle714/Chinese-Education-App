import React, { useState } from "react";
import TesterChipRow from "./TesterChipRow";
import { readBankingAlwaysPlay, writeBankingAlwaysPlay } from "../../minutePoints/dailyBanking/bankingAlwaysPlay";

/**
 * BankingAlwaysPlayToggle — the FEATURE-TESTER row of chips under the Deck Tower's header
 * that picks how often the daily banking run plays (docs/DAILY_MINUTE_BANKING.md § 8):
 * "Bank: daily" (the learner's once-per-streak-day rule) · "Every visit" (plays on
 * every landing on td, ignoring the server's `bankingPending`). The first chip carries the
 * group's name, like AuroraToggle's "Aurora: Auto", because it shares a TesterSharedRow
 * with LightningStrikeChips.
 *
 * The chip never plays anything itself — leave td and come back to see the run as a
 * learner meets it, on page entry. A run still needs yesterday's minutes > 0.
 *
 * Layer: page-private component (feature module `src/features/deckTower`). It owns the
 * chip's state; the per-device flag lives in `bankingAlwaysPlay.ts` and is read by
 * DailyBankingContext → `useDailyBankingRun`. The page mounts it only for
 * `users.isFeatureTester` accounts (the provider re-checks that gate too).
 *
 * Depends on: TesterChipRow.tsx, src/minutePoints/dailyBanking/bankingAlwaysPlay.ts.
 * Depended on by: DeckTowerPage.tsx.
 */

type BankingCadence = "daily" | "every-visit";

const OPTIONS: readonly { value: BankingCadence; label: string }[] = [
    { value: "daily", label: "Bank: daily" },
    { value: "every-visit", label: "Every visit" },
];

const BankingAlwaysPlayToggle: React.FC = () => {
    const [cadence, setCadence] = useState<BankingCadence>(() => (readBankingAlwaysPlay() ? "every-visit" : "daily"));
    const handleChange = (next: BankingCadence) => {
        writeBankingAlwaysPlay(next === "every-visit");
        setCadence(next);
    };
    return (
        <TesterChipRow
            classBase="deck-tower-page__banking"
            ariaLabel="Daily banking run cadence (feature testing)"
            options={OPTIONS}
            value={cadence}
            onChange={handleChange}
        />
    );
};

export default BankingAlwaysPlayToggle;
