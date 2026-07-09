import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Box, TextField, InputAdornment, IconButton, Typography, CircularProgress, useTheme } from "@mui/material";
import { Search, Clear, Add, Close } from "@mui/icons-material";
import ForeignText from "../../../components/ForeignText";
import PinyinKeypad from "../../../components/PinyinKeypad";
import DictionaryEntryRow from "../../../components/DictionaryEntryRow";
import LongDefinitionDisplay from "../../../components/LongDefinitionDisplay";
import { useDictionarySearch } from "../../../hooks/useDictionarySearch";
import { useWordComparison } from "../../../hooks/useWordComparison";
import { dictionaryEntryToVocabEntry } from "./dictEntryAdapter";
import type { CompareEipTab } from "./useEipTabs";
import type { InfoCardPanelBodyHandle } from "./InfoCardPanelBody";
import type { VocabEntry, DictionaryEntry, Language, LongDefinitionPart } from "../../../types";
import { SIZE, WEIGHT, TRACKING } from "../../../theme/scale";
import { FC_FONT } from "./constants";

export interface CompareTabBodyProps {
    tab: CompareEipTab;
    onSetSlot: (slot: "A" | "B", entry: VocabEntry | null) => void;
    onResult: (comparison: string | null, comparisonParts: LongDefinitionPart[] | null) => void;
    showPinyin: boolean;
    showPinyinColor?: boolean;
    // When provided, tapping an embedded-Chinese word inside the comparison paragraph opens the
    // eip for that word (same gesture as the Definition tab's longDefinition — see
    // LongDefinitionDisplay's onSegmentOpen). Omit to keep it a passive tooltip.
    onSegmentOpen?: (segment: string) => void;
}

/**
 * The eip Compare tab body (docs/WORD_COMPARE_FEATURE.md): two xl-cpcd slots (slot A starts
 * auto-filled from the source word, either slot can be filled/cleared via an in-tab dictionary
 * search), and the below-slots area that shows the search UI, a loading/error state, or the AI
 * comparison paragraph.
 *
 * Deleting a slot is a tap-to-arm / tap-to-confirm gesture: tapping a filled slot outlines it red
 * (armed); tapping that SAME slot again clears it back to the "+" placeholder. Tapping elsewhere
 * (the other slot, the background) disarms without deleting. An empty slot's "+" opens the mini
 * search targeting that slot.
 *
 * `tab.comparison` (persisted in useEipTabs' tab state) is the source of truth for what's
 * displayed — this component's own `useWordComparison` hook only owns the in-flight request; a
 * successful result is written back via `onResult` so switching to another entry tab and back
 * shows the cached paragraph without re-fetching.
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
 * past its clientHeight and actually become reachable by scrolling/resizing the sheet.
 */
const CompareTabBody = forwardRef<InfoCardPanelBodyHandle, CompareTabBodyProps>(function CompareTabBody({
    tab, onSetSlot, onResult, showPinyin, showPinyinColor = true, onSegmentOpen,
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

    const language = (tab.slotA?.language ?? tab.slotB?.language ?? 'zh') as Language;

    // A fresh Compare-tab invocation (openCompareTab refills slot A) shouldn't carry over an armed
    // delete from a previous pair.
    useEffect(() => {
        setArmedSlot(null);
    }, [tab.slotA?.entryKey]);

    // Fire the compare request whenever both slots are filled and there's no cached paragraph for
    // this pair yet (a cached `tab.comparison` — e.g. re-opening this tab after switching to a
    // word tab and back — skips the fetch entirely).
    useEffect(() => {
        if (tab.slotA && tab.slotB && !tab.comparison) {
            wordComparison.compare(tab.slotA.entryKey, tab.slotB.entryKey, language);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab.slotA?.entryKey, tab.slotB?.entryKey]);

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
        const entry = slot === "A" ? tab.slotA : tab.slotB;
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
        if (!tab.slotA || !tab.slotB) return;
        wordComparison.compare(tab.slotA.entryKey, tab.slotB.entryKey, language);
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

    const bothFilled = !!tab.slotA && !!tab.slotB;

    const renderSlot = (slot: "A" | "B", entry: VocabEntry | null) => (
        <Box
            className={`compare-tab-body__slot compare-tab-body__slot--${slot.toLowerCase()}`}
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
            className="compare-tab-body"
            // Root and scroll both point at this element (it's the only scrollable region in this
            // body, unlike InfoCardPanelBody's separate header/scroll split) — SheetPanel just needs
            // a touch/scroll target and a scrollTop to read, and one element serves both.
            ref={(node: HTMLDivElement | null) => { rootRef.current = node; scrollRef.current = node; }}
            onClick={() => setArmedSlot(null)}
            sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, padding: '16px 18px 8px', gap: '16px', overflow: 'auto', touchAction: 'none' }}
        >
            {/* Two xl-cpcd slots */}
            <Box className="compare-tab-body__slots" sx={{ display: 'flex', gap: '12px' }}>
                {renderSlot("A", tab.slotA)}
                {renderSlot("B", tab.slotB)}
            </Box>

            {/* Below-slots area: search mode (keypad + bar + result cards) or the comparison display.
                No flex:1/minHeight:0 here — see the layout note above the component. */}
            {searchOpen ? (
                <Box className="compare-tab-body__search" onClick={(e) => e.stopPropagation()} sx={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Typography sx={{ fontSize: SIZE.caption, fontWeight: WEIGHT.bold, color: fc.textSecondary, letterSpacing: TRACKING.caps, textTransform: 'uppercase', fontFamily: FC_FONT }}>
                            Pick a word
                        </Typography>
                        <IconButton className="compare-tab-body__search-close" size="small" aria-label="Cancel search" onClick={handleCloseSearch}>
                            <Close fontSize="small" />
                        </IconButton>
                    </Box>
                    <PinyinKeypad
                        language={language}
                        inputRef={searchInputRef}
                        value={search.searchInput}
                        onChange={search.setSearchInput}
                    />
                    <TextField
                        className="compare-tab-body__search-input"
                        fullWidth
                        size="small"
                        placeholder="Search dictionary..."
                        value={search.searchInput}
                        onChange={(e) => search.setSearchInput(e.target.value)}
                        inputRef={searchInputRef}
                        InputProps={{
                            startAdornment: (
                                <InputAdornment position="start">
                                    <Search fontSize="small" />
                                </InputAdornment>
                            ),
                            endAdornment: search.searchInput ? (
                                <InputAdornment position="end">
                                    <IconButton size="small" aria-label="clear search" onClick={() => search.clearSearch()}>
                                        <Clear fontSize="small" />
                                    </IconButton>
                                </InputAdornment>
                            ) : undefined,
                        }}
                    />
                    <Box className="compare-tab-body__results" sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {search.loading && (
                            <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                                <CircularProgress size={22} />
                            </Box>
                        )}
                        {!search.loading && resultEntries.map((entry) => (
                            <DictionaryEntryRow key={entry.id} entry={entry} onClick={handleSelect} />
                        ))}
                        {!search.loading && search.debouncedSearchTerm && resultEntries.length === 0 && (
                            <Typography sx={{ fontSize: SIZE.body, color: fc.textSecondary, textAlign: 'center', py: 2, fontFamily: FC_FONT }}>
                                No results for "{search.debouncedSearchTerm}"
                            </Typography>
                        )}
                    </Box>
                </Box>
            ) : (
                <Box
                    className="compare-tab-body__result"
                    onClick={(e) => e.stopPropagation()}
                    sx={{ minHeight: '80px', display: 'flex', alignItems: bothFilled ? 'flex-start' : 'center', justifyContent: 'center' }}
                >
                    {!bothFilled && (
                        <Typography sx={{ fontSize: SIZE.body, color: fc.textSecondary, textAlign: 'center', fontFamily: FC_FONT }}>
                            Tap the + to pick a word to compare.
                        </Typography>
                    )}
                    {bothFilled && wordComparison.loading && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <CircularProgress size={18} />
                            <Typography sx={{ fontSize: SIZE.body, color: fc.textSecondary, fontFamily: FC_FONT }}>Comparing…</Typography>
                        </Box>
                    )}
                    {bothFilled && !wordComparison.loading && wordComparison.limitReached && (
                        <Typography sx={{ fontSize: SIZE.body, color: fc.textSecondary, textAlign: 'center', fontFamily: FC_FONT }}>
                            {wordComparison.limitMessage || "You've reached your daily limit of AI lookups. Try again tomorrow."}
                        </Typography>
                    )}
                    {bothFilled && !wordComparison.loading && !wordComparison.limitReached && wordComparison.error && !tab.comparison && (
                        <Typography
                            className="compare-tab-body__retry"
                            onClick={handleRetry}
                            sx={{ fontSize: SIZE.body, color: 'error.main', textAlign: 'center', fontFamily: FC_FONT, cursor: 'pointer', textDecoration: 'underline' }}
                        >
                            The comparison request didn't go through. Tap to retry.
                        </Typography>
                    )}
                    {tab.comparison && (
                        // The comparison paragraph is generated live by AI (word_comparison_cache,
                        // docs/WORD_COMPARE_FEATURE.md) with no validation field, so it always
                        // carries the AI-generated treatment. Embedded Chinese (comparisonParts,
                        // GSA-segmented + pinyin-annotated server-side — see
                        // DictionaryService.withComparisonParts) renders as inline cpcd via the
                        // same shared component the Definition tab's longDefinition uses.
                        <LongDefinitionDisplay
                            className="compare-tab-body__result-text"
                            longDefinition={tab.comparison}
                            longDefinitionParts={tab.comparisonParts}
                            showPinyin={showPinyin}
                            showPinyinColor={showPinyinColor}
                            onSegmentOpen={onSegmentOpen}
                            aiGenerated
                            sx={{ fontSize: SIZE.body, color: fc.onSurface, lineHeight: 1.6, fontFamily: FC_FONT, width: "100%" }}
                        />
                    )}
                </Box>
            )}
        </Box>
    );
});

export default CompareTabBody;
