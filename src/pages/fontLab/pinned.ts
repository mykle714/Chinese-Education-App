// The font lab's PINNED SHORTLIST — the candidates you are still considering.
//
// Pure bookkeeping: it marks candidates as still in the running and restores them as
// compare columns on reload. It affects nothing outside /font-lab.
//
// There used to be a second, confusingly adjacent concept the two shared the word "pin"
// for — "Use app-wide", which set `--cjk-font` on :root and re-faced the whole app. It
// was removed on 2026-09-05 because it silently outranked the account's own typeface
// preference; see src/hooks/useChineseFont.ts. Pinning is now the lab's only persisted
// state, so the two can no longer be confused for each other.
//
// Stored as candidate ids (not family names) so a renamed or re-sourced face in
// candidates.ts invalidates cleanly rather than pinning a family that no longer loads.

const STORAGE_KEY = "fontLabPinned";

/** Pinned candidate ids, or [] when nothing is pinned or the value is unreadable. */
export function readPinned(): string[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        // Guard the shape: this is user-writable storage that survives code changes.
        return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
    } catch {
        return [];
    }
}

/** Replace the pinned set. Writing an empty array clears the key entirely. */
export function writePinned(ids: string[]): void {
    if (ids.length === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
}
