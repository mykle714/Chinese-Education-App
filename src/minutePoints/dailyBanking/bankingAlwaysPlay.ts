/**
 * bankingAlwaysPlay — the feature-tester "always play" switch for the hp daily banking run
 * (docs/DAILY_MINUTE_BANKING.md § 8). While on, every landing on Home plays the run,
 * ignoring the server's once-per-day `bankingPending`.
 *
 * Stored in localStorage, not on the server: it is a per-device test convenience, and
 * nothing about it needs to follow the account. Every access is wrapped — storage can be
 * blocked or throw (private windows, cleared site data), and then the switch simply reads
 * as off. The flag is honored only for `users.isFeatureTester` accounts (migration 178) (checked by the
 * caller), so a stale key on a shared device cannot change a learner's experience.
 */
const STORAGE_KEY = "dailyBanking.alwaysPlay";

export function readBankingAlwaysPlay(): boolean {
    try {
        return localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
        return false;
    }
}

export function writeBankingAlwaysPlay(on: boolean): void {
    try {
        if (on) localStorage.setItem(STORAGE_KEY, "1");
        else localStorage.removeItem(STORAGE_KEY);
    } catch {
        // Storage unavailable — the switch just won't persist.
    }
}
