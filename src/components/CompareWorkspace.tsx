import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Box, IconButton, Typography, CircularProgress, useTheme } from "@mui/material";
import { Add, Close } from "@mui/icons-material";
import SearchField from "./SearchField";
import ForeignText from "./ForeignText";
import PinyinKeypad from "./PinyinKeypad";
import DictionaryEntryRow from "./DictionaryEntryRow";
import LongDefinitionDisplay from "./LongDefinitionDisplay";
import { useDictionarySearch } from "../hooks/useDictionarySearch";
import { useWordComparison } from "../hooks/useWordComparison";
import { dictionaryEntryToVocabEntry } from "../utils/dictEntryAdapter";
import type { VocabEntry, DictionaryEntry, Language, LongDefinitionPart } from "../types";
import { SIZE, WEIGHT, TRACKING } from "../theme/scale";
import { FONTS } from "../theme/fonts";

// Latin UI text (labels, hint copy) — matches the eip's FC_FONT so the workspace
// looks identical whether it renders inside the eip or on the standalone page.
const UI_FONT = FONTS.sans;

/**
 * The two words being compared plus the result of comparing them. This is the ENTIRE state the
 * workspace renders from; the owning surface decides where it lives:
 *  - eip: inside the Compare tab object (`CompareEipTab extends CompareState`, useEipTabs), so it
 *    survives switching to a word tab and back.
 *  - standalone /compare page: a plain `useState` in ComparePage.
 */
export interface CompareState {
    slotA: VocabEntry | null;
    slotB: VocabEntry | null;
    comparison: string | null;
    // Embedded-Chinese runs of `comparison`, GSA-segmented + pinyin-annotated server-side (same
    // treatment as longDefinition) — rendered via the shared LongDefinitionDisplay component.
    comparisonParts: LongDefinitionPart[] | null;
}

// {root, scroll} — structurally the same handle InfoCardPanelBody exposes, so SheetPanel can bind
// its drag-to-resize/scroll coupling to whichever body InfoCardSection renders. The standalone
// page ignores the ref.
export interface CompareWorkspaceHandle {
    root: HTMLDivElement | null;
    scroll: HTMLDivElement | null;
}

export interface CompareWorkspaceProps {
    state: CompareState;
    onSetSlot: (slot: "A" | "B", entry: VocabEntry | null) => void;
    onResult: (comparison: string | null, comparisonParts: LongDefinitionPart[] | null) => void;
    showPinyin: boolean;
    showPinyinColor?: boolean;
    // When provided, tapping an embedded-Chinese word inside the comparison paragraph opens the
    // eip for that word (same gesture as the Definition tab's longDefinition — see
    // LongDefinitionDisplay's onSegmentOpen). Omit to keep it a passive tooltip.
    onSegmentOpen?: (segment: string) => void;
    // Who owns scrolling.
    //  • "sheet" (default, the eip): the workspace fills the sheet body and scrolls ITSELF
    //    (flex:1 + overflow:auto), with touchAction "none" because SheetPanel drives
    //    scrolling/resizing from its own gesture handlers and native panning would fight them.
    //  • "page" (ComparePage): the workspace is a natural-height block and the HOST scroll area
    //    scrolls (MobileTabScreen's ScrollArea). It must NOT scroll itself there — a nested
    //    scroller ends at its own box, so content would stop ABOVE the floating footer pill
    //    instead of running behind it, and the ScrollArea's own FOOTER_CLEARANCE
    //    bottom padding (which is what lets the last line clear the pill) would be bypassed.
    layout?: "sheet" | "page";
}

/**
 * The word-comparison surface (docs/WORD_COMPARE_FEATURE.md): two xl-cpcd slots (each fillable /
 * clearable via an in-place dictionary search), and the below-slots area that shows the search UI,
 * a loading/error state, or the AI comparison paragraph.
 *
 * Shared by BOTH compare surfaces — it is presentational + request-driving only, and owns no slot
 * state of its own:
 *  - the eip Compare tab (flp), where the state lives in the tab object (useEipTabs) and slot A is
 *    pre-filled with the word the user came from;
 *  - the standalone `/compare` node page (Home hub → Compare), where both slots start empty.
 *
 * Deleting a slot is a tap-to-arm / tap-to-confirm gesture: tapping a filled slot outlines it red
 * (armed); tapping that SAME slot again clears it back to the "+" placeholder. Tapping elsewhere
 * (the other slot, the background) disarms without deleting. An empty slot's "+" opens the mini
 * search targeting that slot.
 *
 * `state.comparison` (owned by the caller) is the source of truth for what's displayed — this
 * component's own `useWordComparison` hook only owns the in-flight request; a successful result is
 * written back via `onResult` so the owner can persist it (in the eip that means switching to
 * another entry tab and back shows the paragraph without re-fetching).
 *
 * The forwarded ref matches InfoCardPanelBodyHandle's {root, scroll} contract — SheetPanel wires
 * its drag-to-resize/scroll coupling to whichever body InfoCardSection renders, and this replaces
 * InfoCardPanelBody entirely while the Compare tab is active (see InfoCardSection).
 *
 * Layout note: unlike InfoCardPanelBody (header + separate scroll body), this component has ONE
 * scroll region — the outer Box — and everything inside it stacks at natural height. Nested
 * `flex:1, minHeight:0` sections were tried here originally and collapsed the results list to 0px
 * height once the keypad + search bar ate the sheet's default (40%-of-screen) height, since a flex
 * child with minHeight:0 shrinks instead of overflowing. Content that can grow long (the result
 * list, the comparison paragraph) must stay un-flexed so it can push the outer Box's scrollHeight
 * past its clientHeight and actually become reachable by scrolling/resizing the sheet. For the
 * same reason every direct child carries `flexShrink: 0` — the default `flex-shrink: 1` let the
 * result box be squeezed (a 681px paragraph compressed into a 414px box, overflowing and clipping
 * its own tail) instead of extending the scroll range.
 */
const CompareWorkspace = forwardRef<CompareWorkspaceHandle, CompareWorkspaceProps>(function CompareWorkspace({
    state, onSetSlot, onResult, showPinyin, showPinyinColor = true, onSegmentOpen,
    layout = "sheet",
}, ref) {
    const theme = useTheme();
    const fc = theme.palette.flashcard;
    const [searchOpen, setSearchOpen] = useState(false);
    // Which slot the mini search fills on selection.
    const [searchTarget, setSearchTarget] = useState<"A" | "B">("B");
    // Which filled slot is armed for deletion (first tap) — a second tap on the SAME slot confirms.
    const [armedSlot, setArmedSlot] = useState<"A" | "B" | null>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    useImperativeHandle(ref, () => ({
        get root() { return rootRef.current; },
        get scroll() { return scrollRef.current; },
    }), []);
    const search = useDictionarySearch(20);
    const wordComparison = useWordComparison();

    const language = (state.slotA?.language ?? state.slotB?.language ?? 'zh') as Language;

    // A fresh Compare-tab invocation (openCompareTab refills slot A) shouldn't carry over an armed
    // delete from a previous pair.
    useEffect(() => {
        setArmedSlot(null);
    }, [state.slotA?.entryKey]);

    // Fire the compare request whenever both slots are filled and there's no cached paragraph for
    // this pair yet (a cached `state.comparison` — e.g. re-opening this tab after switching to a
    // word tab and back — skips the fetch entirely).
    useEffect(() => {
        if (state.slotA && state.slotB && !state.comparison) {
            wordComparison.compare(state.slotA.entryKey, state.slotB.entryKey, language);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state.slotA?.entryKey, state.slotB?.entryKey]);

    // Persist a successful result (+ its GSA-segmented parts) into the eip tab so it survives
    // switching away and back.
    useEffect(() => {
        if (wordComparison.comparison) onResult(wordComparison.comparison, wordComparison.comparisonParts);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [wordComparison.comparison]);

    const handleOpenSearchFor = (slot: "A" | "B") => {
        setArmedSlot(null);
        setSearchTarget(slot);
        setSearchOpen(true);
        search.clearSearch();
    };

    const handleCloseSearch = () => {
        setSearchOpen(false);
        search.clearSearch();
    };

    // Tapping a slot: empty ⇒ open search targeting it. Filled ⇒ arm on first tap, confirm-delete
    // on a second tap of the SAME slot. Tapping the other slot re-arms that one instead.
    const handleSlotClick = (slot: "A" | "B") => {
        const entry = slot === "A" ? state.slotA : state.slotB;
        if (!entry) {
            handleOpenSearchFor(slot);
            return;
        }
        if (armedSlot === slot) {
            onSetSlot(slot, null);
            setArmedSlot(null);
        } else {
            setArmedSlot(slot);
        }
    };

    const handleSelect = (entry: DictionaryEntry) => {
        const adapted = dictionaryEntryToVocabEntry(entry);
        setSearchOpen(false);
        search.clearSearch();
        onSetSlot(searchTarget, adapted);
    };

    const handleRetry = () => {
        if (!state.slotA || !state.slotB) return;
        wordComparison.compare(state.slotA.entryKey, state.slotB.entryKey, language);
    };

    // Compare slots render as a CPCDBlock (up to 4 chars); longer words aren't
    // selectable here rather than silently falling back to a row layout mid-search.
    // Note the search results are det records (DictionaryEntry), whose headword
    // field is `word1` — `entryKey` only exists after dictionaryEntryToVocabEntry.
    const resultEntries: DictionaryEntry[] = (
        search.isSegmentMode
            ? search.segmentGroups.flatMap(g => [...g.exactEntries, ...g.prefixEntries])
            : search.entries
    ).filter(entry => [...(entry.word1 ?? "")].length <= 4);

    const bothFilled = !!state.slotA && !!state.slotB;

    const renderSlot = (slot: "A" | "B", entry: VocabEntry | null) => (
        <Box
            className={`compare-workspace__slot compare-workspace__slot--${slot.toLowerCase()}`}
            onClick={(e) => { e.stopPropagation(); handleSlotClick(slot); }}
            sx={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '96px',
                borderRadius: '12px',
                border: armedSlot === slot ? `2px solid ${theme.palette.error.main}` : `1px solid ${fc.border}`,
                padding: '8px',
                cursor: 'pointer',
                transition: 'border-color 0.15s ease',
            }}
        >
            {entry ? (
                <ForeignText
                    size="xl"
                    layout="block"
                    justifyContent="center"
                    language={entry.language}
                    text={entry.entryKey}
                    pronunciation={entry.pronunciation}
                    showPinyin={showPinyin}
                    useToneColor={showPinyinColor}
                />
            ) : (
                <Add sx={{ fontSize: 32, color: fc.textSecondary }} />
            )}
        </Box>
    );

    return (
        <Box
            className="compare-workspace"
            // Root and scroll both point at this element (it's the only scrollable region in this
            // body, unlike InfoCardPanelBody's separate header/scroll split) — SheetPanel just needs
            // a touch/scroll target and a scrollTop to read, and one element serves both.
            ref={(node: HTMLDivElement | null) => { rootRef.current = node; scrollRef.current = node; }}
            onClick={() => setArmedSlot(null)}
            sx={{
                display: 'flex',
                flexDirection: 'column',
                padding: '16px 18px 8px',
                gap: '16px',
                // See the `layout` prop: the sheet scrolls itself, the page defers to its host.
                ...(layout === "sheet"
                    ? { flex: 1, minHeight: 0, overflow: 'auto', touchAction: 'none' }
                    : { flex: '0 0 auto' }),
            }}
        >
            {/* Two xl-cpcd slots */}
            <Box className="compare-workspace__slots" sx={{ display: 'flex', gap: '12px', flexShrink: 0 }}>
                {renderSlot("A", state.slotA)}
                {renderSlot("B", state.slotB)}
            </Box>

            {/* Below-slots area: search mode (keypad + bar + result cards) or the comparison display.
                No flex:1/minHeight:0 here — see the layout note above the component. */}
            {searchOpen ? (
                <Box className="compare-workspace__search" onClick={(e) => e.stopPropagation()} sx={{ display: 'flex', flexDirection: 'column', gap: '10px', flexShrink: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Typography sx={{ fontSize: SIZE.caption, fontWeight: WEIGHT.bold, color: fc.textSecondary, letterSpacing: TRACKING.caps, textTransform: 'uppercase', fontFamily: UI_FONT }}>
                            Pick a word
                        </Typography>
                        <IconButton className="compare-workspace__search-close" size="small" aria-label="Cancel search" onClick={handleCloseSearch}>
                            <Close fontSize="small" />
                        </IconButton>
                    </Box>
                    <PinyinKeypad
                        language={language}
                        inputRef={searchInputRef}
                        value={search.searchInput}
                        onChange={search.setSearchInput}
                    />
                    <SearchField
                        className="compare-workspace__search-input"
                        placeholder="Search dictionary..."
                        value={search.searchInput}
                        onChange={search.setSearchInput}
                        onClear={() => search.clearSearch()}
                        inputRef={searchInputRef}
                    />
                    {/* No gap between rows: `.dr` separates with its own bottom hairline
                        (docs/SHELF_REDESIGN.md § entry 7), and a gap would leave the
                        hairlines floating between detached rows. */}
                    <Box className="compare-workspace__results" sx={{ display: 'flex', flexDirection: 'column' }}>
                        {search.loading && (
                            <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                                <CircularProgress size={22} />
                            </Box>
                        )}
                        {!search.loading && resultEntries.map((entry) => (
                            <DictionaryEntryRow key={entry.id} entry={entry} onClick={handleSelect} inset={4} />
                        ))}
                        {!search.loading && search.debouncedSearchTerm && resultEntries.length === 0 && (
                            <Typography sx={{ fontSize: SIZE.body, color: fc.textSecondary, textAlign: 'center', py: 2, fontFamily: UI_FONT }}>
                                No results for "{search.debouncedSearchTerm}"
                            </Typography>
                        )}
                    </Box>
                </Box>
            ) : (
                <Box
                    className="compare-workspace__result"
                    onClick={(e) => e.stopPropagation()}
                    sx={{ minHeight: '80px', flexShrink: 0, display: 'flex', alignItems: bothFilled ? 'flex-start' : 'center', justifyContent: 'center' }}
                >
                    {!bothFilled && (
                        <Typography sx={{ fontSize: SIZE.body, color: fc.textSecondary, textAlign: 'center', fontFamily: UI_FONT }}>
                            Tap the + to pick a word to compare.
                        </Typography>
                    )}
                    {bothFilled && wordComparison.loading && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <CircularProgress size={18} />
                            <Typography sx={{ fontSize: SIZE.body, color: fc.textSecondary, fontFamily: UI_FONT }}>Comparing…</Typography>
                        </Box>
                    )}
                    {bothFilled && !wordComparison.loading && wordComparison.limitReached && (
                        <Typography sx={{ fontSize: SIZE.body, color: fc.textSecondary, textAlign: 'center', fontFamily: UI_FONT }}>
                            {wordComparison.limitMessage || "You've reached your daily limit of AI lookups. Try again tomorrow."}
                        </Typography>
                    )}
                    {bothFilled && !wordComparison.loading && !wordComparison.limitReached && wordComparison.error && !state.comparison && (
                        <Typography
                            className="compare-workspace__retry"
                            onClick={handleRetry}
                            sx={{ fontSize: SIZE.body, color: 'error.main', textAlign: 'center', fontFamily: UI_FONT, cursor: 'pointer', textDecoration: 'underline' }}
                        >
                            The comparison request didn't go through. Tap to retry.
                        </Typography>
                    )}
                    {state.comparison && (
                        // The comparison paragraph is generated live by AI (word_comparison_cache,
                        // docs/WORD_COMPARE_FEATURE.md) with no validation field, so it always
                        // carries the AI-generated treatment. Embedded Chinese (comparisonParts,
                        // GSA-segmented + pinyin-annotated server-side — see
                        // DictionaryService.withComparisonParts) renders as inline cpcd via the
                        // same shared component the Definition tab's longDefinition uses.
                        <LongDefinitionDisplay
                            className="compare-workspace__result-text"
                            longDefinition={state.comparison}
                            longDefinitionParts={state.comparisonParts}
                            showPinyin={showPinyin}
                            showPinyinColor={showPinyinColor}
                            onSegmentOpen={onSegmentOpen}
                            aiGenerated
                            sx={{ fontSize: SIZE.body, color: fc.onSurface, lineHeight: 1.6, fontFamily: UI_FONT, width: "100%" }}
                        />
                    )}
                </Box>
            )}
        </Box>
    );
});

export default CompareWorkspace;
