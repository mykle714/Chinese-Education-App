import { useSyncExternalStore } from "react";
import { useAuth } from "../AuthContext";

/**
 * "Enable testing features": the per-device master switch for every client-side
 * feature-tester surface (docs/FEATURE_TESTING.md).
 *
 * An `isFeatureTester` account (migration 178) normally looks like a learner account.
 * Tester-only controls appear only after the tester turns this switch on in Settings.
 * That lets a tester show or use the app as a learner would without losing the grant.
 *
 * The effective value is `user.isFeatureTester AND the stored switch`. Every client gate
 * that used to read `user.isFeatureTester` directly reads `useTestingFeatures()` instead.
 * The account flag is still read directly in exactly two places:
 *   - SettingsBody, which decides whether to SHOW the switch;
 *   - challengeAnytime's revoke-cleanup, which keys on the account and not the switch,
 *     so turning testing off does not discard the tester's "anytime" choice.
 *
 * ── WHY LOCALSTORAGE ────────────────────────────────────────────────────────
 * It is a per-device view preference, not account state, the same choice as
 * bankingAlwaysPlay and the Deck Tower overrides. DEFAULT OFF: an unset key, or storage
 * that is blocked or throws, reads as off. A fresh install therefore always shows the
 * learner app.
 *
 * The server does not know about this switch. Server-side tester gates (e.g. Study
 * Challenge's `?anytime=1`) still check `isFeatureTester` alone. The client stops
 * SENDING such requests while the switch is off (challengeAnytime's latch is fed from
 * this hook), so the effect is the same.
 *
 * Depended on by: every `useTestingFeatures()` caller (grep), docs/FEATURE_TESTING.md.
 */
const STORAGE_KEY = "cow.testingFeatures";

/** Same-tab subscribers; `storage` events only fire in OTHER tabs, so both are wired. */
const listeners = new Set<() => void>();

/** The raw per-device switch, ignoring the account flag. Fails closed (false). */
export function readTestingFeaturesSwitch(): boolean {
    try {
        return localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
        return false;
    }
}

/** Flip the per-device switch and re-render every subscriber in this tab. */
export function writeTestingFeaturesSwitch(on: boolean): void {
    try {
        if (on) localStorage.setItem(STORAGE_KEY, "1");
        else localStorage.removeItem(STORAGE_KEY);
    } catch {
        // Storage blocked: the switch won't persist, and testing features stay off.
    }
    listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    // Another tab flipping the switch should be picked up here as well.
    const onStorage = (e: StorageEvent) => { if (e.key === STORAGE_KEY) listener(); };
    window.addEventListener("storage", onStorage);
    return () => {
        listeners.delete(listener);
        window.removeEventListener("storage", onStorage);
    };
}

/** React binding for the raw switch (for the Settings row itself). */
export function useTestingFeaturesSwitch(): [boolean, (on: boolean) => void] {
    const on = useSyncExternalStore(subscribe, readTestingFeaturesSwitch, () => false);
    return [on, writeTestingFeaturesSwitch];
}

/**
 * Are testing features live right now? True only for an `isFeatureTester` account
 * whose device switch is on. Use this for every client-side tester gate.
 */
export function useTestingFeatures(): boolean {
    const { user } = useAuth();
    const [on] = useTestingFeaturesSwitch();
    return user?.isFeatureTester === true && on;
}
