import React, { useState } from "react";
import HeaderAvatarButton from "../../components/HeaderAvatarButton";
import AccountSheet from "../../pages/AccountSheet";
import { SHADOW } from "../../theme/shadows";

/**
 * DeckTowerAvatar — the learner's profile picture in the Deck Tower header's far-right
 * corner (MobileTabScreen `headerTrailingActions`, right of the minute-points flame;
 * docs/DECK_TOWER.md § "Layers"). A tap raises the AccountSheet, exactly as Home's
 * header avatar does (HomePage → BankingAvatarButton), so the two never disagree about
 * where "you" lives.
 *
 * Tappable only because DeckTowerPage lifts its header above the scene's scroller
 * (`wrapHeader`); without that the scroller, which covers the header, swallows the tap.
 *
 * Skin: HeaderAvatarButton at 40px with `SHADOW.float`, larger than Home's 32px so it
 * reads against the sky and space backdrops. It keeps the --line2 outline (CLAUDE.md §
 * Buttons & cards). No banking glow: the daily banking run lives on Home only.
 *
 * Layer: page-private component (feature module `src/features/deckTower`); data comes
 * from AuthContext via HeaderAvatarButton / AccountSheet.
 *
 * Depended on by: DeckTowerPage.tsx; docs/DECK_TOWER.md.
 */

const AVATAR_SIZE_PX = 40;

const DeckTowerAvatar: React.FC = () => {
    const [accountOpen, setAccountOpen] = useState(false);
    return (
        <>
            <HeaderAvatarButton
                className="deck-tower-page__avatar-button"
                onClick={() => setAccountOpen(true)}
                sizePx={AVATAR_SIZE_PX}
                restShadow={SHADOW.float}
            />
            {/* Portaled to the frame's overlay host by SheetPanel, so where it sits in
                this tree does not affect its geometry. */}
            {accountOpen && <AccountSheet onClose={() => setAccountOpen(false)} />}
        </>
    );
};

export default DeckTowerAvatar;
