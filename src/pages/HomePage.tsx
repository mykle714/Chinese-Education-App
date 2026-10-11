import { useState } from "react";
import FlashcardsDecksPage from "../features/flashcards/FlashcardsDecksPage";
import { DailyBankingProvider } from "../minutePoints/dailyBanking/DailyBankingContext";
import BankingAvatarButton from "../minutePoints/dailyBanking/BankingAvatarButton";
import BankingEmbers from "../minutePoints/dailyBanking/BankingEmbers";
import BankingAlwaysPlayToggle from "../minutePoints/dailyBanking/BankingAlwaysPlayToggle";
import { HeaderIconButton } from "../components/PageHeader";
import AccountSheet from "./AccountSheet";
import { useSlideNavigate } from "../hooks/useSlideNavigate";

// Home (`/`) — the footer's first tab. Since 2026-10-10 its CONTENT is the decks page
// (the fdp: the study hand, the Reading/Writing Center rail and the Cards/Decks
// sheets — `FlashcardsDecksPage`), while the hub bento that used to fill it moved to
// the second tab as Menu (`/menu`, MenuPage). See docs/UX_AND_NAVIGATION.md.
//
// What stayed with the TAB rather than moving with the bento is the account header:
//   • the validator "always play" toggle (renders null for everyone else),
//   • the Settings gear,
//   • the profile picture, which raises AccountSheet,
//   • and the daily banking run across the header flame, the avatar and the embers.
// This file owns exactly that chrome and hands the controls to the decks page as
// header props — the decks page cannot build them itself, because `features/` must
// not import `pages/` (AccountSheet) — docs/FRONTEND_LAYERING.md.
//
// DAILY BANKING (docs/DAILY_MINUTE_BANKING.md): `DailyBankingProvider` wraps the whole
// page so the header flame (inside the decks page's MobileTabScreen), the avatar and
// `BankingEmbers` all read the one run. Home is the only page that mounts the provider.
function HomePage() {
    // Settings is a leaf page: slideNavigate plays the slide-up enter transition.
    const slideNavigate = useSlideNavigate();
    // The account surface is a sheet over Home, not a route (AccountSheet). Mounted only
    // while open so each open starts fresh (counts + velocity re-fetch).
    const [accountOpen, setAccountOpen] = useState(false);

    return (
        <DailyBankingProvider>
            <FlashcardsDecksPage
                // Validator-only test toggle: while on, the banking run plays on every
                // Home landing. Left of the flame.
                headerExtraActions={<BankingAlwaysPlayToggle />}
                // Right of the flame: the Settings gear, then the profile picture in the
                // far-right corner. Outlined variant to match the avatar's ring.
                headerTrailingActions={
                    <>
                        <HeaderIconButton
                            className="home-page__settings-button"
                            icon="settings"
                            label="Open settings"
                            variant="outlined"
                            onClick={() => slideNavigate("/settings")}
                        />
                        <BankingAvatarButton onClick={() => setAccountOpen(true)} />
                    </>
                }
            />
            <BankingEmbers />
            {/* Portaled to the frame's overlay host by SheetPanel, so where it sits in
                this tree does not affect its geometry. */}
            {accountOpen && <AccountSheet onClose={() => setAccountOpen(false)} />}
        </DailyBankingProvider>
    );
}

export default HomePage;
