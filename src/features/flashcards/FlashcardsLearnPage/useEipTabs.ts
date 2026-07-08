import { useCallback, useRef, useState } from "react";
import type { RefObject } from "react";
import { TONE_COLORS } from "../../../utils/toneColors";
import { dictionaryEntryToVocabEntry } from "./dictEntryAdapter";
import { getBreakdownItems } from "../../../utils/breakdownUtils";
import type { DictionaryEntry, LongDefinitionPart } from "../../../types";
import type { VocabEntry, BreakdownItem } from "./types";
import { FONTS } from "../../../theme/fonts";

// A normal word tab — one looked-up dictionary entry with its own definition/examples/breakdown
// sub-tabs (rendered by InfoCardPanelBody).
export interface EntryEipTab {
    kind: "entry";
    id: string;            // entryKey — used as React key and for dedupe
    entry: VocabEntry;
    breakdownItems: BreakdownItem[];
    toneColor: string;     // from TONE_COLORS, picked at creation
    selectedSubTab: number;
    measuredWidth: number; // cached pixel width of the tab pill, used for fit checks
}

// The Compare tab (docs/WORD_COMPARE_FEATURE.md) — a SINGLETON, not attached to any card. Slot A
// starts filled with the word the user navigated from; slot B is picked via an in-tab dictionary
// search. Both slots are independently clearable (tap-to-arm, tap-again-to-confirm — see
// CompareTabBody) and re-fillable via the same search, so either can end up empty. `comparison`
// caches the last-fetched AI paragraph for the CURRENT (slotA, slotB) pair so switching to another
// entry tab and back doesn't lose it; it's cleared whenever either slot changes (a new pair).
export interface CompareEipTab {
    kind: "compare";
    id: "compare";
    toneColor: string;
    measuredWidth: number;
    slotA: VocabEntry | null;
    slotB: VocabEntry | null;
    comparison: string | null;
    // Embedded-Chinese runs of `comparison`, GSA-segmented + pinyin-annotated server-side (same
    // treatment as longDefinition) — rendered via the shared LongDefinitionDisplay component.
    comparisonParts: LongDefinitionPart[] | null;
}

export type EipTab = EntryEipTab | CompareEipTab;

// Fixed label the Compare tab renders/measures under — it has no headword of its own.
const COMPARE_TAB_LABEL = "Compare";

interface UseEipTabsOptions {
    apiBaseUrl: string;
    token?: string | null;
    // Ref to the EipTabStripContainer. Its clientWidth is the budget for fitting tabs.
    stripRef: RefObject<HTMLDivElement | null>;
}

// All five tone colors (tones 1–4 + neutral 0). Used to assign each new tab a
// random color; we try to avoid colors already in use before falling back.
const TONE_COLOR_VALUES = Object.values(TONE_COLORS);

// Strip horizontal padding + gap between tabs, mirroring EipTabStripContainer / EipEntryTab.
const STRIP_HORIZONTAL_PADDING = 14 * 2;
const TAB_GAP = 4;

// Measures the rendered width of a tab pill for a given label, off-DOM. Mirrors
// EipEntryTab's font/padding/border so the result matches what will be painted.
function measureTabWidth(label: string): number {
    const el = document.createElement("span");
    el.style.cssText =
        "position:absolute;left:-9999px;top:-9999px;visibility:hidden;" +
        `font-family:${FONTS.cjk};` +
        "font-size:14px;font-weight:600;line-height:1.1;" +
        "padding:6px 12px;border-bottom:2px solid transparent;" +
        "white-space:nowrap;display:inline-block;box-sizing:border-box;";
    el.textContent = label;
    document.body.appendChild(el);
    const w = el.getBoundingClientRect().width;
    document.body.removeChild(el);
    return w;
}

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
        measuredWidth: measureTabWidth(entry.entryKey),
    };
}

function buildCompareTab(slotA: VocabEntry, usedColors: Set<string>): CompareEipTab {
    return {
        kind: "compare",
        id: "compare",
        toneColor: pickToneColor(usedColors),
        measuredWidth: measureTabWidth(COMPARE_TAB_LABEL),
        slotA,
        slotB: null,
        comparison: null,
        comparisonParts: null,
    };
}

export function useEipTabs({ apiBaseUrl, token, stripRef }: UseEipTabsOptions) {
    const [tabs, setTabs] = useState<EipTab[]>([]);
    const [activeIndex, setActiveIndex] = useState(0);
    // Latches to true the moment a 2nd tab is first added and stays true for
    // the lifetime of the panel — closing back down to 1 tab does not hide the
    // strip. Reset only by clear() when the panel closes.
    const [isTabbedMode, setIsTabbedMode] = useState(false);
    // Bumped each time a new-tab push is rejected for not fitting. Consumers
    // watch this to fire a toast — we use a counter (not a boolean) so back-to-back
    // overflows still trigger the toast each time.
    const [overflowSignal, setOverflowSignal] = useState(0);

    // Tracks the most-recently-requested entryKey so a slower in-flight fetch
    // can't overwrite the user's later tap (race-free push).
    const latestRequestRef = useRef<string | null>(null);

    const openForRoot = useCallback((entry: VocabEntry) => {
        const tab = buildEntryTab(entry, new Set());
        setTabs([tab]);
        setActiveIndex(0);
    }, []);

    // Compare tab (docs/WORD_COMPARE_FEATURE.md) — a SINGLETON pushed from the header's Compare
    // button, not attached to any card. Re-tapping Compare from a different word's tab focuses the
    // existing Compare tab, refills slot A with the new source word, and CLEARS slot B (decided —
    // the old pair is no longer what the user asked about).
    const openCompareTab = useCallback((entry: VocabEntry) => {
        setTabs(prev => {
            const existingIdx = prev.findIndex(t => t.kind === "compare");
            if (existingIdx !== -1) {
                const next = prev.map((t, i) =>
                    i === existingIdx ? { ...(t as CompareEipTab), slotA: entry, slotB: null, comparison: null, comparisonParts: null } : t
                );
                setActiveIndex(existingIdx);
                return next;
            }

            // Fit-check before pushing, same budget math as openForEntryKey.
            const stripWidth = stripRef.current?.clientWidth ?? 0;
            if (stripWidth > 0) {
                const candidateWidth = measureTabWidth(COMPARE_TAB_LABEL);
                const existingTotal = prev.reduce((sum, t) => sum + t.measuredWidth, 0);
                const gapsTotal = prev.length * TAB_GAP;
                const projected = existingTotal + candidateWidth + gapsTotal + STRIP_HORIZONTAL_PADDING;
                if (projected > stripWidth) {
                    setOverflowSignal(n => n + 1);
                    return prev;
                }
            }

            const usedColors = new Set(prev.map(t => t.toneColor));
            const newTab = buildCompareTab(entry, usedColors);
            const next = [...prev, newTab];
            setActiveIndex(next.length - 1);
            setIsTabbedMode(true);
            return next;
        });
    }, [stripRef]);

    // Compare tab is a singleton (kind: "compare"), so a slot / the fetched result are updated in
    // place by kind rather than by index. Either slot can be set/cleared (docs/WORD_COMPARE_FEATURE.md
    // — CompareTabBody's tap-to-arm/tap-to-confirm delete, or picking a new word via search);
    // changing either slot invalidates the cached comparison for the old pair.
    const setCompareSlot = useCallback((slot: "A" | "B", entry: VocabEntry | null) => {
        const key = slot === "A" ? "slotA" : "slotB";
        setTabs(prev => prev.map(t => t.kind === "compare" ? { ...t, [key]: entry, comparison: null, comparisonParts: null } : t));
    }, []);

    const setCompareResult = useCallback((comparison: string | null, comparisonParts: LongDefinitionPart[] | null = null) => {
        setTabs(prev => prev.map(t => t.kind === "compare" ? { ...t, comparison, comparisonParts } : t));
    }, []);

    const openForEntryKey = useCallback(async (entryKey: string) => {
        // Dedupe: if a tab for this entryKey already exists, activate it.
        const existingIdx = tabs.findIndex(t => t.kind === "entry" && t.id === entryKey);
        if (existingIdx !== -1) {
            setActiveIndex(existingIdx);
            return;
        }

        // Fit-check before fetching — cheap and avoids a wasted network call if
        // the strip is already full. clientWidth is read live each call.
        const stripWidth = stripRef.current?.clientWidth ?? 0;
        if (stripWidth > 0) {
            const candidateWidth = measureTabWidth(entryKey);
            const existingTotal = tabs.reduce((sum, t) => sum + t.measuredWidth, 0);
            const gapsTotal = tabs.length * TAB_GAP; // n existing + 1 new ⇒ n gaps between them
            const projected = existingTotal + candidateWidth + gapsTotal + STRIP_HORIZONTAL_PADDING;
            if (projected > stripWidth) {
                setOverflowSignal(n => n + 1);
                return;
            }
        }

        latestRequestRef.current = entryKey;
        try {
            const headers: HeadersInit = {};
            if (token) headers.Authorization = `Bearer ${token}`;
            const res = await fetch(
                `${apiBaseUrl}/api/dictionary/lookup/${encodeURIComponent(entryKey)}`,
                { headers, credentials: "include" }
            );
            if (!res.ok) return;
            // Drop stale responses — a newer tap superseded this one.
            if (latestRequestRef.current !== entryKey) return;
            const dictData: DictionaryEntry = await res.json();
            const adapted = dictionaryEntryToVocabEntry(dictData);
            setTabs(prev => {
                // Re-check dedupe in case the user double-tapped during fetch.
                const dupeIdx = prev.findIndex(t => t.kind === "entry" && t.id === adapted.entryKey);
                if (dupeIdx !== -1) {
                    setActiveIndex(dupeIdx);
                    return prev;
                }
                const usedColors = new Set(prev.map(t => t.toneColor));
                const newTab = buildEntryTab(adapted, usedColors);
                const next = [...prev, newTab];
                setActiveIndex(next.length - 1);
                // Latch tabbed mode on — never reverting for this panel's life.
                setIsTabbedMode(true);
                return next;
            });
        } catch (err) {
            console.error(`Failed to look up dictionary entry "${entryKey}":`, err);
        }
    }, [apiBaseUrl, token, tabs, stripRef]);

    const setActive = useCallback((index: number) => {
        setActiveIndex(index);
    }, []);

    const setActiveSubTab = useCallback((subTab: number) => {
        setTabs(prev => prev.map((t, i) => (i === activeIndex && t.kind === "entry") ? { ...t, selectedSubTab: subTab } : t));
    }, [activeIndex]);

    // Removes the currently active tab. Returns true when the last tab is closed
    // so the caller can close the EIP entirely. The active index shifts left when
    // the removed tab was at or beyond the end of the remaining list.
    const closeActiveTab = useCallback((): boolean => {
        const willBeEmpty = tabs.length <= 1;
        if (willBeEmpty) {
            setTabs([]);
            setActiveIndex(0);
            latestRequestRef.current = null;
        } else {
            const removedIdx = activeIndex;
            setTabs(prev => prev.filter((_, i) => i !== removedIdx));
            setActiveIndex(prev => Math.max(0, prev >= tabs.length - 1 ? tabs.length - 2 : prev));
        }
        return willBeEmpty;
    }, [tabs, activeIndex]);

    const clear = useCallback(() => {
        setTabs([]);
        setActiveIndex(0);
        setIsTabbedMode(false);
        latestRequestRef.current = null;
    }, []);

    return {
        tabs,
        activeIndex,
        activeTab: tabs[activeIndex] ?? null,
        isTabbedMode,
        openForRoot,
        openForEntryKey,
        openCompareTab,
        setCompareSlot,
        setCompareResult,
        setActive,
        setActiveSubTab,
        closeActiveTab,
        clear,
        overflowSignal,
    };
}
