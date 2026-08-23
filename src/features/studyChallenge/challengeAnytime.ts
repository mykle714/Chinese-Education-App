import { useCallback, useEffect, useState } from "react";

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
 */

const STORAGE_KEY = "cow.challengeAnytime";

/** Notifies the hooks in this tab; `storage` events only fire in OTHER tabs. */
const listeners = new Set<(on: boolean) => void>();

/** Is the hatch requested on this device? False whenever storage is unreadable. */
export function challengeAnytime(): boolean {
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
    listeners.forEach((listener) => listener(on));
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
 * React binding: the current value plus a setter, re-rendering every subscriber in
 * this tab when it changes.
 *
 * The subscription exists because the toggle and the list that reads it are
 * different components — flipping it must re-render the rows, not just the switch.
 */
export function useChallengeAnytime(): [boolean, (on: boolean) => void] {
    const [on, setOn] = useState(challengeAnytime);

    useEffect(() => {
        listeners.add(setOn);
        return () => { listeners.delete(setOn); };
    }, []);

    return [on, useCallback((next: boolean) => setChallengeAnytime(next), [])];
}
