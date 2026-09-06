import { useCallback, useRef, useState } from "react";
import type { RefObject } from "react";
import { TONE_COLORS } from "../../../utils/toneColors";
import { getBreakdownItems } from "../../../utils/breakdownUtils";
import type { LongDefinitionPart } from "../../../types";
import type { CompareState } from "../../../components/CompareWorkspace";
import type { VocabEntry, BreakdownItem } from "../types";
import { FONTS } from "../../../theme/fonts";
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
    measuredWidth: number; // cached pixel width of the tab pill, used for fit checks
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
    measuredWidth: number;
}

export type EipTab = EntryEipTab | CompareEipTab;

// Fixed label the Compare tab renders/measures under — it has no headword of its own.
const COMPARE_TAB_LABEL = "Compare";

interface UseEipTabsOptions {
    // Ref to the EipTabStripContainer. Its own content box — NOT the viewport — is the
    // budget a new tab must fit inside; see readStripGeometry.
    stripRef: RefObject<HTMLDivElement | null>;
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

// All five tone colors (tones 1–4 + neutral 0). Used to assign each new tab a
// random color; we try to avoid colors already in use before falling back.
const TONE_COLOR_VALUES = Object.values(TONE_COLORS);

// FALLBACKS ONLY. The fit check reads the strip's real geometry out of the DOM
// (readStripGeometry); these are used when that geometry is unreadable — today only the
// pre-tabbed-mode strip, whose padding is collapsed to 0 while the trail is hidden but
// will be 16px a side the moment a 2nd pill mounts. Keep them in sync with
// EipTabStripContainer's padding and the tab list's `gap` in EipTabStrip.
const STRIP_HORIZONTAL_PADDING = 16 * 2;
const TAB_GAP = 7;

// Sub-pixel safety margin, in px. Fractional label widths mean a projection that lands
// exactly on the budget can still paint a hairline past the container's content box and
// clip the last pill's rounded edge, so a tab must clear the budget by this much.
const FIT_EPSILON = 1;

// Measures the rendered width of a tab pill for a given label, off-DOM. Mirrors
// EipEntryTab's font/padding so the result matches what will be painted — 700 weight,
// 11px horizontal padding, the 0.01em tracking, and NO border (the pill has none; the
// 2px bottom border this used to declare was copied from the content tabs and, being
// horizontal, never affected width anyway).
//
// ⚠️ Appended to document.body, so it only sees a `:root`-level `--cjk-font` override
// (see FONTS.cjk). That is why the fit check prefers the widths of the pills actually in
// the DOM and treats this as the estimate for the not-yet-mounted candidate.
function measureTabWidth(label: string): number {
    const el = document.createElement("span");
    el.style.cssText =
        "position:absolute;left:-9999px;top:-9999px;visibility:hidden;" +
        `font-family:${FONTS.cjk};` +
        "font-size:14px;font-weight:700;line-height:1.1;letter-spacing:0.01em;" +
        "padding:6px 11px;" +
        "white-space:nowrap;display:inline-block;box-sizing:border-box;";
    el.textContent = label;
    document.body.appendChild(el);
    const w = el.getBoundingClientRect().width;
    document.body.removeChild(el);
    return w;
}

// What the trail actually has to spend, read off the live strip.
interface StripGeometry {
    // Content-box width of the row the pills lay out in — the CONTAINER, never the
    // viewport. Padding is already subtracted.
    available: number;
    // Flex gap between two adjacent pills, from computed style.
    gap: number;
    // Painted widths of the pills currently mounted, in tab order; null when the pill
    // row is not rendered yet (trail hidden at one tab) and only cached estimates exist.
    pillWidths: number[] | null;
}

// Reads the trail's budget from the DOM rather than from constants, so the gate can
// never drift out of sync with the stylesheet (it had: 14px padding vs the strip's 16px,
// a 4px gap vs the strip's 7px, and a 600-weight measurement of a 700-weight pill — each
// one an under-count, which is what let a pill hang off the edge before the gate fired).
// Returns null when nothing measurable is mounted; the caller then allows the tab rather
// than rejecting every tab forever.
function readStripGeometry(strip: HTMLElement | null): StripGeometry | null {
    if (!strip) return null;

    // Preferred path: the pill row itself. Its clientWidth IS the space pills may occupy
    // (it carries no padding of its own), and its children are the painted pills.
    const list = strip.querySelector<HTMLElement>(".eip-entry-tab-list");
    if (list && list.clientWidth > 0) {
        const gap = parseFloat(getComputedStyle(list).columnGap) || TAB_GAP;
        const pillWidths = Array.from(list.children).map(
            child => (child as HTMLElement).getBoundingClientRect().width
        );
        return { available: list.clientWidth, gap, pillWidths };
    }

    // Fallback: the strip before tabbed mode, where the pill row is not rendered.
    const style = getComputedStyle(strip);
    const measuredPadding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    // The hidden strip is explicitly padded to 0 (EipTabStrip's `sx`), so a 0 here is the
    // collapsed state, not a genuinely edge-to-edge row — charge the visible padding.
    const padding = measuredPadding > 0 ? measuredPadding : STRIP_HORIZONTAL_PADDING;
    const available = strip.clientWidth - padding;
    if (available <= 0) return null;
    return { available, gap: parseFloat(style.columnGap) || TAB_GAP, pillWidths: null };
}

// True when one more pill labelled `label` would fit ENTIRELY inside the strip. A tab
// that would be even partly clipped is rejected — the trail never shows a cut-off pill,
// because a half-pill reads as "scroll for more" on a row that does not scroll.
function fitsNewTab(strip: HTMLElement | null, tabs: EipTab[], label: string): boolean {
    const geo = readStripGeometry(strip);
    if (!geo) return true; // unmeasurable — don't gate on a number we don't have

    // Prefer painted widths, but never trust one that is SMALLER than the cached
    // estimate: a pill mounted moments ago is mid-entrance (the eipPillIn keyframe
    // animates max-width up from 0), and measuring it there would under-count the row.
    const usePainted = geo.pillWidths !== null && geo.pillWidths.length === tabs.length;
    const existingTotal = tabs.reduce(
        (sum, t, i) => sum + (usePainted ? Math.max(geo.pillWidths![i], t.measuredWidth) : t.measuredWidth),
        0
    );
    const gapsTotal = tabs.length * geo.gap; // n existing + 1 new ⇒ n gaps between them
    const projected = existingTotal + gapsTotal + measureTabWidth(label);
    return projected <= geo.available - FIT_EPSILON;
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
        selectedSenseIndex: resolveSelectedSenseIndex(entry),
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

export function useEipTabs({ stripRef, language }: UseEipTabsOptions) {
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
            if (!fitsNewTab(stripRef.current, prev, COMPARE_TAB_LABEL)) {
                setOverflowSignal(n => n + 1);
                return prev;
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
    // — CompareWorkspace's tap-to-arm/tap-to-confirm delete, or picking a new word via search);
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
        // the strip is already full. Geometry is read live each call.
        if (!fitsNewTab(stripRef.current, tabs, entryKey)) {
            setOverflowSignal(n => n + 1);
            return;
        }

        latestRequestRef.current = entryKey;
        try {
            const adapted = await lookupVocabEntry(entryKey, language);
            // Drop stale responses — a newer tap superseded this one.
            if (latestRequestRef.current !== entryKey) return;
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
        // No `token` dep: the underlying apiGet reads the header at call time, so this callback's
        // identity survives a silent refresh (CLAUDE.md ⛔ rule). A non-2xx now throws
        // and is handled by the catch below, where the old code returned early.
    }, [tabs, stripRef, language]);

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

    // Record the sense pick made by the ACTIVE entry tab's header picker. Panel-local:
    // persisting it to the vet row is the host page's job (it owns the optimistic
    // override), wired through InfoCardSection's `onPersistSense`.
    const setActiveSenseIndex = useCallback((index: number) => {
        setTabs(prev => prev.map((t, i) =>
            (i === activeIndex && t.kind === "entry") ? { ...t, selectedSenseIndex: index } : t
        ));
    }, [activeIndex]);

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
        syncEntry,
        openCompareTab,
        setCompareSlot,
        setCompareResult,
        setActive,
        setActiveSubTab,
        setActiveSenseIndex,
        closeActiveTab,
        clear,
        overflowSignal,
    };
}
