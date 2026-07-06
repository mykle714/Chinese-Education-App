// Persisted dictionary browse state — the query, pagination page, and scroll
// position are kept across a drill-in to a card-detail page and back (SPA back
// navigation remounts DictionaryPage). In-memory for the session; a full page
// reload starts fresh. Seeded into useDictionarySearch via its `initial`
// argument and restored by DictionaryPage's scroll-restore effect.
//
// Lifetime: the state survives moves *within* the Dictionary space (the list ⇄
// card-detail drill-ins) but is wiped the first time the user navigates OUT of
// that space — the back arrow to Home, a footer-tab tap, or browser back. That
// reset is driven by the route watcher in components/Layout.tsx using
// isDictionarySpacePath below, so re-entering the Dictionary later starts fresh.
export const dictionaryBrowseState = { search: "", page: 1, scrollTop: 0 };

export function resetDictionaryBrowseState(): void {
    dictionaryBrowseState.search = "";
    dictionaryBrowseState.page = 1;
    dictionaryBrowseState.scrollTop = 0;
}

// Whether a pathname is inside the Dictionary "space": the browse page plus its
// card-detail (cdp) drill-ins. Used to decide when the persisted browse state
// should be reset (kept while inside, cleared on the first exit).
export function isDictionarySpacePath(pathname: string): boolean {
    return pathname === "/dictionary" || pathname.startsWith("/dictionary/card/");
}
