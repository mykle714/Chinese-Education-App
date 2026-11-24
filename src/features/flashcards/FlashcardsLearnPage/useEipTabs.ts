import { useCallback, useRef, useState } from "react";
import { TONE_COLORS } from "../../../utils/toneColors";
import { getBreakdownItems } from "../../../utils/breakdownUtils";
import type { VocabEntry, BreakdownItem } from "../types";
import { lookupVocabEntry } from "../../../api/dictionary";
import { resolveSelectedSenseIndex } from "../../../utils/definitionUtils";

// One crumb on the word trail — a looked-up dictionary entry with its own
// definition/examples/breakdown sub-tabs (rendered by InfoCardPanelBody).
//
// Every crumb is a WORD. The trail used to hold a second kind, a singleton Compare crumb
// (`CompareEipTab`, `kind: "compare"`); Compare left the eip on 2026-11-21 and is now its
// own panel (features/flashcards/compare/CompareSheet), so the `kind` discriminator went
// with it. Docs: docs/WORD_COMPARE_FEATURE.md.
export interface EipTab {
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


interface UseEipTabsOptions {
    // Language every drill-in lookup is scoped to. Optional: omitted, the server falls
    // back to the account's selectedLanguage (the flp's behavior, unchanged). acp passes
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

function buildEntryTab(entry: VocabEntry, usedColors: Set<string>): EipTab {
    return {
        id: entry.entryKey,
        entry,
        breakdownItems: getBreakdownItems(entry),
        toneColor: pickToneColor(usedColors),
        selectedSubTab: 0,
        selectedSenseIndex: resolveSelectedSenseIndex(entry),
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
    // The drill-in whose lookup is in flight (the tapped breakdown / used-in / example word),
    // null when none. Exposed as `drillPending` so a host can show its loading mark: a tap
    // otherwise does nothing visible until the lookup returns. Cleared wherever
    // `latestRequestRef` is (a pop, a new root, clear) and when the live lookup settles —
    // success or failure; a superseded lookup leaves it to the newer one.
    const [pendingKey, setPendingKey] = useState<string | null>(null);

    // Seed the trail with the card the panel was opened FROM.
    //
    // ⚠️ RE-OPENING THE PANEL ON THE SAME CARD RESUMES ITS TRAIL (2026-09-06). Closing the
    // eip no longer discards the tabs — a learner who drills 你 → 好 → 吗, closes the panel
    // to look at the card, and opens it again gets the same three pills and the same word
    // showing. So this is a no-op when the root tab is already this entry, and only a
    // DIFFERENT root starts a fresh trail (which is also what ends the old one: the flp's
    // next card, or another card's info button on acp).
    const openForRoot = useCallback((entry: VocabEntry) => {
        const root = tabs[0];
        if (root?.id === entry.entryKey) return;
        latestRequestRef.current = null;
        setPendingKey(null);
        setTabs([buildEntryTab(entry, new Set())]);
        setTrailShown(false);
    }, [tabs]);

    // Pop the stack down to `index`, making that crumb the showing word. Also cancels an
    // in-flight drill-in, so a lookup that lands after the pop cannot push onto the trail
    // the learner just walked back from.
    const popTo = useCallback((index: number) => {
        latestRequestRef.current = null;
        setPendingKey(null);
        setTabs(prev => (index >= 0 && index < prev.length - 1 ? prev.slice(0, index + 1) : prev));
    }, []);

    const openForEntryKey = useCallback(async (entryKey: string) => {
        // Already on the stack (the showing word, or one below it): pop back to it.
        const existingIdx = tabs.findIndex(t => t.id === entryKey);
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
        setPendingKey(entryKey);
        try {
            const adapted = await lookupVocabEntry(entryKey, language);
            // Drop stale responses — a newer tap superseded this one.
            if (latestRequestRef.current !== entryKey) return;
            setTabs(prev => {
                // Re-check against the stack as it is NOW (a double tap during the fetch, or
                // a lookup whose canonical entryKey differs from the tapped text): a word
                // already on the stack is popped back to, never pushed twice.
                const dupeIdx = prev.findIndex(t => t.id === adapted.entryKey);
                if (dupeIdx !== -1) return prev.slice(0, dupeIdx + 1);
                const usedColors = new Set(prev.map(t => t.toneColor));
                setTrailShown(true);
                return [...prev, buildEntryTab(adapted, usedColors)];
            });
        } catch (err) {
            console.error(`Failed to look up dictionary entry "${entryKey}":`, err);
        } finally {
            // Only the live request ends the wait; a superseded one's newer tap owns it.
            if (latestRequestRef.current === entryKey) setPendingKey(null);
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
            t.id === entry.entryKey
                ? { ...t, entry, selectedSenseIndex: resolveSelectedSenseIndex(entry) }
                : t
        ));
    }, []);

    const setActiveSubTab = useCallback((subTab: number) => {
        setTabs(prev => prev.map((t, i) => i === activeIndex ? { ...t, selectedSubTab: subTab } : t));
    }, [activeIndex]);

    // Escape (via onCloseX): pop the showing (top) crumb — back one word. Returns true when that was the
    // root, so the caller closes the eip entirely.
    const pop = useCallback((): boolean => {
        latestRequestRef.current = null;
        setPendingKey(null);
        const willBeEmpty = tabs.length <= 1;
        setTabs(prev => prev.slice(0, -1));
        return willBeEmpty;
    }, [tabs]);

    const clear = useCallback(() => {
        setTabs([]);
        setTrailShown(false);
        latestRequestRef.current = null;
        setPendingKey(null);
    }, []);

    return {
        tabs,
        activeIndex,
        activeTab: tabs[activeIndex] ?? null,
        trailShown,
        openForRoot,
        openForEntryKey,
        syncEntry,
        popTo,
        setActiveSubTab,
        pop,
        clear,
        overflowSignal,
        /** A drill-in lookup is in flight (see `pendingKey`). Read by FlashcardsLearnPage's PawnLoader. */
        drillPending: pendingKey !== null,
    };
}
