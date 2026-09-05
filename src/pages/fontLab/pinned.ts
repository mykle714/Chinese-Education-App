// The font lab's PINNED SHORTLIST — the candidates you are still considering.
//
// Deliberately distinct from the app-wide override in src/theme/cjkFontOverride.ts,
// which the two used to share the word "pin" for. They are different in kind:
//
//   • Pinned (HERE, many)  — bookkeeping. Marks candidates as still in the running and
//                            restores them as compare columns on reload. Affects nothing
//                            outside /font-lab.
//   • Use app-wide (there, ONE) — actually sets `--cjk-font` on :root, re-facing every
//                            Chinese glyph in the app. Single by necessity: the app has
//                            one CJK face.
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
