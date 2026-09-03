import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../AuthContext";

/**
 * "Allow anytime" — the TESTER escape hatch for Study Challenge
 * (docs/STUDY_CHALLENGE.md § 2a).
 *
 * Study Challenge is a weekly feature: issue on Monday, accept by Wednesday, play
 * Friday to Monday, one challenge per friend per week. That is the product, and it
 * makes the feature almost impossible to exercise — a change to the round runner can
 * only be tested on a Friday, against a friend you have not already challenged.
 *
 * With this on, the four CALENDAR gates lift: the accept deadline, the test window,
 * the one-per-pair-per-week rule, and the six-challenge cap. Nothing else does —
 * friendship, the per-pair block, and the strictly-sequential one-attempt rounds are
 * all still enforced, because a test that skipped them would not be testing the game
 * anybody plays.
 *
 * ── WHY LOCALSTORAGE AND NOT A COLUMN ────────────────────────────────────────
 * It is a REQUEST, not a property of the account: every call carries `?anytime=1`
 * and the SERVER decides, by checking `isValidator`, whether to honour it. A stored
 * account flag would eventually be left switched on and would silently turn a real
 * week into a free-for-all; a per-device request cannot outlive the browser it was
 * set in.
 *
 * Two consequences, both deliberate and both stated in the UI:
 *   * it is PER DEVICE — turning it on does not turn it on for your opponent, so a
 *     two-account test needs it set in both browsers;
 *   * a non-validator sending the flag is ignored SILENTLY. No error and no hint: a
 *     403 here would be a probe for who holds the flag, and they get the ordinary
 *     weekly rules either way.
 *
 * Read through `challengeAnytime()` rather than touching localStorage directly —
 * every accessor here is wrapped, because a browser in private mode (or with site
 * data blocked) THROWS on access rather than returning null.
 *
 * ── THE VALIDATOR GATE (client side) ─────────────────────────────────────────
 * The server is still the authority — it honours `?anytime=1` only for an
 * `isValidator` account — but the CLIENT must not act as if the hatch were on for
 * anyone else, or a non-validator would see anytime-flavoured labels ("Round 1 of 3 ·
 * anytime") and lifted deadlines the server is quietly ignoring.
 *
 * So every accessor is additionally gated on `allowed`, a module latch fed by
 * `useChallengeAnytime()` from the auth user. It FAILS CLOSED: the latch starts false
 * and stays false until a mounted `useChallengeAnytime()` says otherwise, so a stale
 * `localStorage` value left behind by a revoked validator account is inert rather than
 * live. (The hook also clears that value on sight.)
 */

const STORAGE_KEY = "cow.challengeAnytime";

/** Notifies the hooks in this tab; `storage` events only fire in OTHER tabs. */
const listeners = new Set<(on: boolean) => void>();

/**
 * Is the CURRENT account allowed to request the hatch at all (i.e. `isValidator`)?
 *
 * A module latch rather than a parameter because the non-React accessors
 * (`anytimeParams`, `anytimeQuerySuffix`) are called from api helpers and hand-built
 * URLs that have no access to auth context. Fed by `useChallengeAnytime()`, and false
 * until something says otherwise so the untrusted default is "off".
 */
let allowed = false;

/** Sets the validator latch; see `allowed`. Exported for the hook only. */
export function setChallengeAnytimeAllowed(next: boolean): void {
    if (allowed === next) return;
    allowed = next;
    // Turning the gate off can flip the effective value, so wake the subscribers.
    listeners.forEach((listener) => listener(challengeAnytime()));
}

/**
 * Is the hatch requested on this device AND permitted for this account? False
 * whenever storage is unreadable, and false for every non-validator.
 */
export function challengeAnytime(): boolean {
    if (!allowed) return false;
    return storedChallengeAnytime();
}

/** The raw stored request, ignoring the validator gate. Internal. */
function storedChallengeAnytime(): boolean {
    try {
        return localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
        return false;
    }
}

/** Turn it on or off for this device. */
export function setChallengeAnytime(on: boolean): void {
    try {
        if (on) localStorage.setItem(STORAGE_KEY, "1");
        else localStorage.removeItem(STORAGE_KEY);
    } catch {
        // Storage blocked: the toggle simply does not stick. Nothing else in the app
        // depends on it, so failing quietly is better than an error the tester can do
        // nothing about.
    }
    listeners.forEach((listener) => listener(challengeAnytime()));
}

/**
 * `{ anytime: 1 }` when on, `{}` when off — spread into an `apiGet`/`apiPost`
 * params object.
 *
 * A params FRAGMENT rather than a boolean so every call site is one spread and
 * cannot accidentally send `anytime=0`, which the server would read as absent
 * anyway but which would litter every request in a normal session.
 */
export function anytimeParams(): { anytime?: 1 } {
    return challengeAnytime() ? { anytime: 1 } : {};
}

/** The same thing as a query-string fragment, for the hand-built game pool URLs. */
export function anytimeQuerySuffix(): string {
    return challengeAnytime() ? "&anytime=1" : "";
}

/**
 * React binding: the current EFFECTIVE value (requested ∧ validator) plus a setter,
 * re-rendering every subscriber in this tab when it changes.
 *
 * The subscription exists because the toggle and the list that reads it are
 * different components — flipping it must re-render the rows, not just the switch.
 *
 * It is also the one place the validator latch is fed, which is why every surface that
 * branches on the hatch reads it through this hook rather than through
 * `challengeAnytime()`: mounting the hook is what makes the gate current.
 */
export function useChallengeAnytime(): [boolean, (on: boolean) => void] {
    const { user } = useAuth();
    const isValidator = !!user?.isValidator;
    const [on, setOn] = useState(challengeAnytime);

    useEffect(() => {
        listeners.add(setOn);
        return () => { listeners.delete(setOn); };
    }, []);

    useEffect(() => {
        setChallengeAnytimeAllowed(isValidator);
        // A revoked (or simply different) account should not leave a live-looking
        // request behind on this device — drop it rather than keeping it latent.
        if (!isValidator && storedChallengeAnytime()) setChallengeAnytime(false);
        setOn(challengeAnytime());
    }, [isValidator]);

    return [on, useCallback((next: boolean) => setChallengeAnytime(next), [])];
}
