import HeaderAvatarButton from "../../components/HeaderAvatarButton";
import { useBankingAnchorRef, useBankingFrame } from "./DailyBankingContext";

/**
 * The td header's profile picture, wired into the daily banking run
 * (docs/DAILY_MINUTE_BANKING.md § 3): it is the embers' destination (registered as the
 * `avatar` anchor) and it wears the run's charge as a flame-orange halo, appended to
 * HeaderAvatarButton's `SHADOW.float` rest shadow.
 *
 * A separate leaf rather than the host passing `glowPx` itself, so the run's 60fps frames
 * re-render this button only — never DeckTowerAvatar (and the AccountSheet it may hold
 * open) or the page around it.
 *
 * Depended on by: src/features/deckTower/DeckTowerAvatar.tsx; docs/DAILY_MINUTE_BANKING.md.
 */
interface BankingAvatarButtonProps {
    onClick: () => void;
    className?: string;
}

function BankingAvatarButton({ onClick, className }: BankingAvatarButtonProps) {
    const frame = useBankingFrame();
    const anchorRef = useBankingAnchorRef("avatar");
    return (
        <HeaderAvatarButton
            className={className}
            onClick={onClick}
            glowPx={frame?.glowPx ?? 0}
            buttonRef={anchorRef}
        />
    );
}

export default BankingAvatarButton;
