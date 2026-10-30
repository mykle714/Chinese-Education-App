import { useCallback, useRef, useState } from "react";
import { TONE_COLORS } from "../../../utils/toneColors";
import { getBreakdownItems } from "../../../utils/breakdownUtils";
import type { LongDefinitionPart } from "../../../types";
import type { CompareState } from "../../../components/CompareWorkspace";
import type { VocabEntry, BreakdownItem } from "../types";
import { lookupVocabEntry } from "../../../api/dictionary";
import { resolveSelectedSenseIndex } from "../../../utils/definitionUtils";

// A normal word tab — one looked-up dictionary entry with its own definition/examples/breakdown
// sub-tabs (rendered by InfoCardPanelBody).
export interface EntryEipTab {
    kind: "entry";
    id: string;            // entryKey — used as React key and for dedupe
    entry: VocabEntry;
    breakdownItems: BreakdownItem[];
    toneColor: string;     // from TONE_COLORS, picked at creation
    selectedSubTab: number;
    // Which definitionClusters sense the panel is showing — an index into
    // sortedSenseClusters(entry), driven by the eip header's SensePicker. Seeded from the
    // entry's PERSISTED `selectedSense` (migration 99) and re-seeded whenever a fresher
    // copy of the entry arrives (syncEntry), so a pick made on the flashcard and a pick
    // made in the panel converge on the same sense. See docs/DEFINITION_CLUSTERS.md.
    selectedSenseIndex: number;
}

// The Compare tab (docs/WORD_COMPARE_FEATURE.md) — a SINGLETON, not attached to any card. Slot A
// starts filled with the word the user navigated from; slot B is picked via an in-tab dictionary
// search. Both slots are independently clearable (tap-to-arm, tap-again-to-confirm — see
// CompareWorkspace) and re-fillable via the same search, so either can end up empty. `comparison`
// caches the last-fetched AI paragraph for the CURRENT (slotA, slotB) pair so switching to another
// entry tab and back doesn't lose it; it's cleared whenever either slot changes (a new pair).
//
// The slot/comparison half of this tab IS `CompareState` — the exact shape the shared
// CompareWorkspace renders from — so the eip tab and the compare sheet (CompareSheet) drive one
// component from one contract instead of two parallel shapes.
export interface CompareEipTab extends CompareState {
    kind: "compare";
    id: "compare";
    toneColor: string;
}

export type EipTab = EntryEipTab | CompareEipTab;

interface UseEipTabsOptions {
    // Language every drill-in lookup is scoped to. Optional: omitted, the server falls
    // back to the account's selectedLanguage (the flp's behavior, unchanged). scp passes
    // its route language explicitly because the page can show a language the account is
    // not currently set to — see DictionaryController.lookupTerm.
    language?: string;
    // NOTE: no `apiBaseUrl` / `token`. Both were dropped when the dictionary lookup
    // moved onto src/api/http.ts, which owns the base URL and reads the Authorization
    // header at call time. Passing the token in is what pulled it into the callback's
    // dependency array — see CLAUDE.md "Never reload on token refresh".
}

// All five tone colors (tones 1-4 + neutral 0). Used to assign each new tab a
// random color; we try to avoid colors already in use before falling back.
const TONE_COLOR_VALUES = Object.values(TONE_COLORS);

/**
 * How many words the trail may hold at once.
 *
 * This used to be a WIDTH gate: the strip did not scroll, so a tab was refused the
 * moment one more pill would not fit the row entirely (a half-pill reads as "scroll for
 * more" on a row that does not scroll). The strip scrolls now — drag it sideways, see
 * EipTabStrip — so the row's width has stopped being a budget and the only reason left to
 * cap the trail is that an unbounded one is a memory leak and an unusable scroll. 50 is
 * that cap: far past any real drill-in chain (the deepest observed is single digits), and
 * small enough that the strip stays a strip.
 *
 * With the gate gone, so did `measureTabWidth`/`readStripGeometry`/`fitsNewTab`, the
 * per-tab `measuredWidth` cache they fed on, and the `stripRef` this hook took purely to
 * read that geometry — EipTabStrip now owns its own refs.
 */
export const MAX_EIP_TABS = 50;

// Picks a tone color not already used by any current tab. Falls back to any
// tone color if all five are taken.
function pickToneColor(used: Set<string>): string {
    const available = TONE_COLOR_VALUES.filter(c => !used.has(c));
    const pool = available.length > 0 ? available : TONE_COLOR_VALUES;
    return pool[Math.floor(Math.random() * pool.length)];
}

function buildEntryTab(entry: VocabEntry, usedColors: Set<string>): EntryEipTab {
    return {
        kind: "entry",
        id: entry.entryKey,
        entry,
        breakdownItems: getBreakdownItems(entry),
        toneColor: pickToneColor(usedColors),
        selectedSubTab: 0,
        selectedSenseIndex: resolveSelectedSenseIndex(entry),
    };
}

function buildCompareTab(slotA: VocabEntry, usedColors: Set<string>): CompareEipTab {
    return {
        kind: "compare",
        id: "compare",
        toneColor: pickToneColor(usedColors),
        slotA,
        slotB: null,
        comparison: null,
        comparisonParts: null,
    };
}

/**
 * The eip's word trail as a BREADCRUMB STACK (2026-10-29; was a set of tabs any of which
 * could be the showing one). The showing word is ALWAYS the top of the stack:
 *  - drilling into a NEW word pushes it;
 *  - navigating to a word ALREADY on the stack — tapping its crumb, or drilling into it
 *    again from a breakdown/example — pops everything above it, so it is the top again;
 *  - Escape (desktop) pops the top (back one word); popping the root closes the panel.
 * So the trail always reads as the path from the root to what is showing, never as a set
 * of side-by-side tabs. Docs: docs/EIP_SHEET_GESTURES.md (word trail).
 */
export function useEipTabs({ language }: UseEipTabsOptions = {}) {
    const [tabs, setTabs] = useState<EipTab[]>([]);
    // Derived, not state: the showing crumb is always the top of the stack.
    const activeIndex = Math.max(0, tabs.length - 1);
    // Whether the trail's crumbs are drawn. A panel opened on a word shows NO trail — a lone
    // crumb repeating the headword is noise — until the learner first navigates to another
    // word. From then it is LATCHED on for this trail's life (popping back to the root still
    // shows the root crumb, so the way forward is not hidden mid-walk); it resets only when a
    // new root starts a new trail (openForRoot / clear). EipTabStrip reads it as `showCrumbs`.
    const [trailShown, setTrailShown] = useState(false);
    // Bumped each time a new-tab push is rejected for hitting MAX_EIP_TABS. Consumers
    // watch this to fire a toast — we use a counter (not a boolean) so back-to-back
    // overflows still trigger the toast each time.
    const [overflowSignal, setOverflowSignal] = useState(0);

    // Tracks the most-recently-requested entryKey so a slower in-flight fetch
    // can't overwrite the user's later tap (race-free push).
    const latestRequestRef = useRef<string | null>(null);

    // Seed the trail with the card the panel was opened FROM.
    //
    // ⚠️ RE-OPENING THE PANEL ON THE SAME CARD RESUMES ITS TRAIL (2026-09-06). Closing the
    // eip no longer discards the tabs — a learner who drills 你 → 好 → 吗, closes the panel
    // to look at the card, and opens it again gets the same three pills and the same word
    // showing. So this is a no-op when the root tab is already this entry, and only a
    // DIFFERENT root starts a fresh trail (which is also what ends the old one: the flp's
    // next card, or another card's info button on scp).
    const openForRoot = useCallback((entry: VocabEntry) => {
        const root = tabs[0];
        if (root?.kind === "entry" && root.id === entry.entryKey) return;
        latestRequestRef.current = null;
        setTabs([buildEntryTab(entry, new Set())]);
        setTrailShown(false);
    }, [tabs]);

    // Compare crumb (docs/WORD_COMPARE_FEATURE.md) — a SINGLETON pushed from the word-tools
    // Compare button, not attached to any card. Opening Compare while a Compare crumb is already
    // on the stack follows the trail's pop rule: everything above it is popped, slot A is refilled
    // with the new source word, and slot B is CLEARED (decided — the old pair is no longer what
    // the user asked about).
    const openCompareTab = useCallback((entry: VocabEntry) => {
        latestRequestRef.current = null;
        setTabs(prev => {
            const existingIdx = prev.findIndex(t => t.kind === "compare");
            if (existingIdx !== -1) {
                return prev.slice(0, existingIdx + 1).map((t, i) =>
                    i === existingIdx ? { ...(t as CompareEipTab), slotA: entry, slotB: null, comparison: null, comparisonParts: null } : t
                );
            }

            // Cap check before pushing, same rule as openForEntryKey.
            if (prev.length >= MAX_EIP_TABS) {
                setOverflowSignal(n => n + 1);
                return prev;
            }

            const usedColors = new Set(prev.map(t => t.toneColor));
            setTrailShown(true);
            return [...prev, buildCompareTab(entry, usedColors)];
        });
    }, []);

    // Compare tab is a singleton (kind: "compare"), so a slot / the fetched result are updated in
    // place by kind rather than by index. Either slot can be set/cleared (docs/WORD_COMPARE_FEATURE.md
    // — CompareWorkspace's tap-to-arm/tap-to-confirm delete, or picking a new word via search);
    // changing either slot invalidates the cached comparison for the old pair.
    const setCompareSlot = useCallback((slot: "A" | "B", entry: VocabEntry | null) => {
        const key = slot === "A" ? "slotA" : "slotB";
        setTabs(prev => prev.map(t => t.kind === "compare" ? { ...t, [key]: entry, comparison: null, comparisonParts: null } : t));
    }, []);

    const setCompareResult = useCallback((comparison: string | null, comparisonParts: LongDefinitionPart[] | null = null) => {
        setTabs(prev => prev.map(t => t.kind === "compare" ? { ...t, comparison, comparisonParts } : t));
    }, []);

    // Pop the stack down to `index`, making that crumb the showing word. Also cancels an
    // in-flight drill-in, so a lookup that lands after the pop cannot push onto the trail
    // the learner just walked back from.
    const popTo = useCallback((index: number) => {
        latestRequestRef.current = null;
        setTabs(prev => (index >= 0 && index < prev.length - 1 ? prev.slice(0, index + 1) : prev));
    }, []);

    const openForEntryKey = useCallback(async (entryKey: string) => {
        // Already on the stack (the showing word, or one below it): pop back to it.
        const existingIdx = tabs.findIndex(t => t.kind === "entry" && t.id === entryKey);
        if (existingIdx !== -1) {
            popTo(existingIdx);
            return;
        }

        // Cap check before fetching — cheap, and avoids a wasted network call when the
        // trail is already at MAX_EIP_TABS.
        if (tabs.length >= MAX_EIP_TABS) {
            setOverflowSignal(n => n + 1);
            return;
        }

        latestRequestRef.current = entryKey;
        try {
            const adapted = await lookupVocabEntry(entryKey, language);
            // Drop stale responses — a newer tap superseded this one.
            if (latestRequestRef.current !== entryKey) return;
            setTabs(prev => {
                // Re-check against the stack as it is NOW (a double tap during the fetch, or
                // a lookup whose canonical entryKey differs from the tapped text): a word
                // already on the stack is popped back to, never pushed twice.
                const dupeIdx = prev.findIndex(t => t.kind === "entry" && t.id === adapted.entryKey);
                if (dupeIdx !== -1) return prev.slice(0, dupeIdx + 1);
                const usedColors = new Set(prev.map(t => t.toneColor));
                setTrailShown(true);
                return [...prev, buildEntryTab(adapted, usedColors)];
            });
        } catch (err) {
            console.error(`Failed to look up dictionary entry "${entryKey}":`, err);
        }
        // No `token` dep: the underlying apiGet reads the header at call time, so this callback's
        // identity survives a silent refresh (CLAUDE.md ⛔ rule). A non-2xx now throws
        // and is handled by the catch below, where the old code returned early.
    }, [tabs, language, popTo]);

    // Re-seed an already-open entry tab from a fresher copy of the same word. Tabs hold a
    // SNAPSHOT of the entry, so a change made outside the panel while it is open (today:
    // the flashcard's sense picker writing `selectedSense`) would otherwise leave the eip
    // header showing the previous sense's dd. Matched by entryKey; the tab's own UI state
    // (color, measured width, selected sub-tab, breakdown rows) is preserved. No-op when
    // no tab holds that word.
    //
    // `selectedSenseIndex` is deliberately RE-DERIVED from the incoming entry rather than
    // preserved: the panel's own index is an override, and a fresher entry means the
    // card's persisted `selectedSense` is the newer truth. (A pick made IN the panel
    // round-trips back through here as the same index, so this is a no-op for it.)
    const syncEntry = useCallback((entry: VocabEntry) => {
        setTabs(prev => prev.map(t =>
            t.kind === "entry" && t.id === entry.entryKey
                ? { ...t, entry, selectedSenseIndex: resolveSelectedSenseIndex(entry) }
                : t
        ));
    }, []);

    const setActiveSubTab = useCallback((subTab: number) => {
        setTabs(prev => prev.map((t, i) => (i === activeIndex && t.kind === "entry") ? { ...t, selectedSubTab: subTab } : t));
    }, [activeIndex]);

    // Escape (via onCloseX): pop the showing (top) crumb — back one word. Returns true when that was the
    // root, so the caller closes the eip entirely.
    const pop = useCallback((): boolean => {
        latestRequestRef.current = null;
        const willBeEmpty = tabs.length <= 1;
        setTabs(prev => prev.slice(0, -1));
        return willBeEmpty;
    }, [tabs]);

    const clear = useCallback(() => {
        setTabs([]);
        setTrailShown(false);
        latestRequestRef.current = null;
    }, []);

    return {
        tabs,
        activeIndex,
        activeTab: tabs[activeIndex] ?? null,
        trailShown,
        openForRoot,
        openForEntryKey,
        syncEntry,
        openCompareTab,
        setCompareSlot,
        setCompareResult,
        popTo,
        setActiveSubTab,
        pop,
        clear,
        overflowSignal,
    };
}
