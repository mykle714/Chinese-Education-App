import React, { useState } from "react";
import BankingAvatarButton from "../../minutePoints/dailyBanking/BankingAvatarButton";
import AccountSheet from "../../pages/AccountSheet";

/**
 * DeckTowerAvatar — the learner's profile picture in the Deck Tower header's far-right
 * corner (MobileTabScreen `headerTrailingActions`, right of the minute-points flame;
 * docs/DECK_TOWER.md § "Layers"). A tap raises the AccountSheet — the app's only
 * route to Account, Settings and sign-out.
 *
 * Tappable only because DeckTowerPage lifts its header above the scene's scroller
 * (`wrapHeader`); without that the scroller, which covers the header, swallows the tap.
 *
 * Skin: HeaderAvatarButton's own — 40px on `SHADOW.float`, so it reads against the sky
 * and space backdrops, with the --line2 outline (CLAUDE.md § Buttons & cards).
 *
 * BANKING: drawn through `BankingAvatarButton`, so it is the daily banking run's ember
 * destination and wears its flame-orange glow (docs/DAILY_MINUTE_BANKING.md § 3) — td
 * mounts the `DailyBankingProvider`. The glow is appended to the `SHADOW.float` rest shadow.
 *
 * Layer: page-private component (feature module `src/features/deckTower`); data comes
 * from AuthContext via HeaderAvatarButton / AccountSheet, the run from DailyBankingContext.
 *
 * Depended on by: DeckTowerPage.tsx; docs/DECK_TOWER.md, docs/DAILY_MINUTE_BANKING.md.
 */

const DeckTowerAvatar: React.FC = () => {
    const [accountOpen, setAccountOpen] = useState(false);
    return (
        <>
            <BankingAvatarButton
                className="deck-tower-page__avatar-button"
                onClick={() => setAccountOpen(true)}
            />
            {/* Portaled to the frame's overlay host by SheetPanel, so where it sits in
                this tree does not affect its geometry. */}
            {accountOpen && <AccountSheet onClose={() => setAccountOpen(false)} />}
        </>
    );
};

export default DeckTowerAvatar;
