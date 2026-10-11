import HeaderAvatarButton from "../../components/HeaderAvatarButton";
import { useBankingAnchorRef, useBankingFrame } from "./DailyBankingContext";

/**
 * The hp header's profile picture, wired into the daily banking run
 * (docs/DAILY_MINUTE_BANKING.md § 3): it is the embers' destination (registered as the
 * `avatar` anchor) and it wears the run's charge as a flame-orange halo.
 *
 * A separate leaf rather than HomePage passing `glowPx` itself, so the run's 60fps
 * frames re-render this button only — never the Home page around it.
 */
function BankingAvatarButton({ onClick }: { onClick: () => void }) {
    const frame = useBankingFrame();
    const anchorRef = useBankingAnchorRef("avatar");
    return <HeaderAvatarButton onClick={onClick} glowPx={frame?.glowPx ?? 0} buttonRef={anchorRef} />;
}

export default BankingAvatarButton;
