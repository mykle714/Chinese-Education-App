import { useState } from "react";
import { useAuth } from "../../AuthContext";
import { HeaderIconButton } from "../../components/PageHeader";
import { readBankingAlwaysPlay, writeBankingAlwaysPlay } from "./bankingAlwaysPlay";

/**
 * FEATURE-TESTER-ONLY test toggle (users.isFeatureTester, migration 178) in the hp header (docs/DAILY_MINUTE_BANKING.md § 8). While
 * ON, the daily banking run plays on EVERY landing on Home instead of once per streak
 * day — so its look can be checked exactly as a learner meets it, on page entry. The
 * toggle itself never plays anything; leave Home and come back to see the run.
 *
 * `repeat` when off, `repeat_on` (the boxed glyph) when on. Persisted per device in
 * localStorage (`bankingAlwaysPlay.ts`). Renders nothing for non-testers. Sits in the
 * header's `extraActions` (left of the flame), off the embers' flight path.
 *
 * A run still needs yesterday's minutes > 0 for the selected language; with an empty
 * yesterday there is nothing to drain, so nothing plays even with the toggle on.
 */
function BankingAlwaysPlayToggle() {
    const { user } = useAuth();
    const [on, setOn] = useState(readBankingAlwaysPlay);

    if (!user?.isFeatureTester) return null;

    const handleToggle = () => {
        const next = !on;
        writeBankingAlwaysPlay(next);
        setOn(next);
    };

    return (
        <HeaderIconButton
            className={`home-page__banking-always-play-toggle${on ? " home-page__banking-always-play-toggle--on" : ""}`}
            icon={on ? "repeat_on" : "repeat"}
            label={on
                ? "Banking animation plays on every visit — tap to turn off (tester)"
                : "Play banking animation on every visit (tester)"}
            onClick={handleToggle}
        />
    );
}

export default BankingAlwaysPlayToggle;
