import { useSyncExternalStore } from "react";
import { useAuth } from "../AuthContext";
import { HeaderIconButton } from "../components/PageHeader";
import {
    readSoftIntroOverride,
    subscribeSoftIntroOverride,
    writeSoftIntroOverride,
    type SoftIntroOverride,
} from "./softIntroStorage";

/** Tap order, and how each state reads in the header. */
const NEXT: Record<SoftIntroOverride, SoftIntroOverride> = { auto: "intro", intro: "graduated", graduated: "auto" };
const ICON: Record<SoftIntroOverride, string> = { auto: "hdr_auto", intro: "school", graduated: "workspace_premium" };
const LABEL: Record<SoftIntroOverride, string> = {
    auto: "Soft intros: showing your real state — tap to force intro (tester)",
    intro: "Soft intros: forced to intro style — tap to force graduated (tester)",
    graduated: "Soft intros: forced to graduated style — tap for your real state (tester)",
};

/**
 * FEATURE-TESTER-ONLY header toggle (users.isFeatureTester, migration 178) that cycles every soft introduction (si) on screen
 * through Auto → Intro → Graduated (docs/SOFT_INTRODUCTION.md § 5). Auto shows the
 * account's real per-device state; the other two force that style live, without touching
 * the real visit records. Persisted per device, like the banking always-play toggle.
 * Renders nothing for non-testers.
 *
 * The override is app-wide, so the toggle belongs in the header of any page that hosts
 * an si. Today that is the hp (the fdp hand's card count).
 */
function SoftIntroToggle({ className }: { className?: string }) {
    const { user } = useAuth();
    const override = useSyncExternalStore(subscribeSoftIntroOverride, readSoftIntroOverride);

    if (!user?.isFeatureTester) return null;

    return (
        <HeaderIconButton
            className={`soft-intro-toggle soft-intro-toggle--${override}${className ? ` ${className}` : ""}`}
            icon={ICON[override]}
            label={LABEL[override]}
            onClick={() => writeSoftIntroOverride(NEXT[override])}
        />
    );
}

export default SoftIntroToggle;
