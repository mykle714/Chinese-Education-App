import { useCallback, useRef, useState } from "react";
import type { RefObject } from "react";
import { TONE_COLORS } from "../../utils/toneColors";
import { dictionaryEntryToVocabEntry } from "./dictEntryAdapter";
import { getBreakdownItems } from "../../utils/breakdownUtils";
import type { DictionaryEntry } from "../../types";
import type { VocabEntry, BreakdownItem } from "./types";

export interface EipTab {
    id: string;            // entryKey — used as React key and for dedupe
    entry: VocabEntry;
    breakdownItems: BreakdownItem[];
    toneColor: string;     // from TONE_COLORS, picked at creation
    selectedSubTab: number;
    measuredWidth: number; // cached pixel width of the tab pill, used for fit checks
}

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
        'font-family:"Noto Sans SC","Inter",sans-serif;' +
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

function buildTab(entry: VocabEntry, usedColors: Set<string>): EipTab {
    return {
        id: entry.entryKey,
        entry,
        breakdownItems: getBreakdownItems(entry),
        toneColor: pickToneColor(usedColors),
        selectedSubTab: 0,
        measuredWidth: measureTabWidth(entry.entryKey),
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
        const tab = buildTab(entry, new Set());
        setTabs([tab]);
        setActiveIndex(0);
    }, []);

    const openForEntryKey = useCallback(async (entryKey: string) => {
        // Dedupe: if a tab for this entryKey already exists, activate it.
        const existingIdx = tabs.findIndex(t => t.id === entryKey);
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
                const dupeIdx = prev.findIndex(t => t.id === adapted.entryKey);
                if (dupeIdx !== -1) {
                    setActiveIndex(dupeIdx);
                    return prev;
                }
                const usedColors = new Set(prev.map(t => t.toneColor));
                const newTab = buildTab(adapted, usedColors);
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
        setTabs(prev => prev.map((t, i) => i === activeIndex ? { ...t, selectedSubTab: subTab } : t));
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
        setActive,
        setActiveSubTab,
        closeActiveTab,
        clear,
        overflowSignal,
    };
}
