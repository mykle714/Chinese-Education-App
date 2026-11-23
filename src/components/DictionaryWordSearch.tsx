import { useRef } from "react";
import { Box, Typography } from "@mui/material";
import SearchField from "./SearchField";
import PinyinKeypad from "./PinyinKeypad";
import DelayedCircularProgress from "./DelayedCircularProgress";
import DictionarySearchResults from "./dictionarySearch/DictionarySearchResults";
import { DictionaryNoResultsWell } from "./dictionarySearch/DictionaryResultParts";
import {
    dictionarySearchFieldSx,
    dictionarySearchPlaceholderFor,
    showsInlineKeypad,
} from "./dictionarySearch/dictionarySearchField";
import { useDictionarySearch } from "../hooks/useDictionarySearch";
import type { DictionaryEntry, Language } from "../types";
import type { Tier2Look } from "../timeOfDay/tier2Look";
import { DEFAULT_SOURCE_ATTRIBUTE } from "../features/beginnerKeyboard";
import { SIZE } from "../theme/scale";
import { FONTS } from "../theme/fonts";

/**
 * DictionaryWordSearch — the "pick a word" mini dictionary search: a search field and its
 * results. Tapping a row hands its det record back through `onSelect`; the host decides
 * what picking means.
 *
 * It is the Dictionary page's search, minus what only a lookup page needs (2026-11-21,
 * docs/WORD_COMPARE_FEATURE.md § The search): the same 50px ink-ringed field and format
 * placeholder (dictionarySearchField.ts), the same Spanish-only accent keypad, the same
 * labelled result slabs with infinite scroll (DictionarySearchResults) and the same
 * recessed no-results well. Left out on purpose (owner's call): Ask AI — an AI answer is
 * not a det row, so it cannot be picked or grounded — and the search history.
 *
 * Owns the search state (`useDictionarySearch`), so every mount starts empty — hosts
 * mount it only while picking (the Compare panel keys it on the slot being filled).
 *
 * Inside a SheetPanel, focusing the search field maximizes the sheet (the field's wrapper
 * carries `data-sheet-maximize-on-focus`; SheetPanel listens for it) — the keyboard that
 * focus raises would otherwise leave a part-height sheet showing only the field.
 *
 * Used by: features/flashcards/compare/CompareShelfBody (the Compare panel),
 * features/flashcards/writingNotebook/NotebookWordPickerSheet.
 * LAYER: shared presentational + request hook.
 */
export interface DictionaryWordSearchProps {
    language: Language;
    onSelect: (entry: DictionaryEntry) => void;
    /** Which results may be picked; others are left out of the list. Default: all. */
    filter?: (entry: DictionaryEntry) => boolean;
    /** Class-name root for the host's styling hooks (default `dictionary-word-search`). */
    classPrefix?: string;
    /** Surface colours for the field, slabs and well (a Tier2Look — see eipPalette → eipShelfLook). */
    look: Tier2Look;
    /**
     * Selector for the element that scrolls the results (`closest` from the list) — the
     * infinite-scroll observer's root. The host's own scroll box.
     */
    scrollRootSelector: string;
    /** A muted line under the field while nothing is typed. */
    emptyHint?: React.ReactNode;
}

// Rows per page — the Dictionary page's size, so both paginate alike.
const PAGE_SIZE = 50;

export default function DictionaryWordSearch({
    language, onSelect, filter, classPrefix = "dictionary-word-search", look, scrollRootSelector, emptyHint,
}: DictionaryWordSearchProps) {
    const searchInputRef = useRef<HTMLInputElement>(null);
    const search = useDictionarySearch(PAGE_SIZE);
    const showKeypad = showsInlineKeypad(language);

    // Zero hits for a settled term. Counted AFTER the filter, so a query whose only hits
    // cannot be picked (a 5-character word in Compare) reads as "nothing", not a blank.
    const visible = (list: DictionaryEntry[]) => (filter ? list.filter(filter) : list);
    const visibleCount = search.isSegmentMode
        ? search.segmentGroups.reduce((n, g) => n + visible(g.exactEntries).length + visible(g.prefixEntries).length, 0)
        : visible(search.entries).length;
    const showNoResults = !search.loading && !!search.debouncedSearchTerm && visibleCount === 0 && !search.hasMore;

    return (
        <Box className={classPrefix} onClick={(e) => e.stopPropagation()} sx={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
            {showKeypad && (
                <PinyinKeypad
                    className={`${classPrefix}__special-chars`}
                    language={language}
                    inputRef={searchInputRef}
                    value={search.searchInput}
                    onChange={search.setSearchInput}
                />
            )}
            {/* `data-sheet-maximize-on-focus`: inside a SheetPanel, focusing the field (which
                raises a keyboard) grows the sheet to full height — SheetPanel's focusin
                listener. Harmless outside a sheet. */}
            <Box className={`${classPrefix}__search-field-wrap`} data-sheet-maximize-on-focus sx={{ mt: showKeypad ? "10px" : 0, mb: "16px" }}>
                <SearchField
                    className={`${classPrefix}__search-input`}
                    size="medium"
                    placeholder={dictionarySearchPlaceholderFor(language)}
                    value={search.searchInput}
                    onChange={search.setSearchInput}
                    onClear={() => search.clearSearch()}
                    inputRef={searchInputRef}
                    inputAttributes={{
                        // The Dictionary page's field rules: open on the learner's own (OS)
                        // keyboard (the switch bar still offers 写 and ā), and label the
                        // return key "Search".
                        [DEFAULT_SOURCE_ATTRIBUTE]: "os",
                        enterKeyHint: "search",
                    }}
                    sx={dictionarySearchFieldSx(look)}
                />
            </Box>

            {!search.debouncedSearchTerm && emptyHint && (
                <Typography
                    className={`${classPrefix}__empty-hint`}
                    sx={{ fontSize: SIZE.body, color: look.muted, textAlign: "center", py: 1, fontFamily: FONTS.sans, textWrap: "pretty" }}
                >
                    {emptyHint}
                </Typography>
            )}

            {search.loading && (
                <Box className={`${classPrefix}__loading`} sx={{ display: "flex", justifyContent: "center", py: 3 }}>
                    <DelayedCircularProgress />
                </Box>
            )}

            {!search.loading && search.error && (
                <Typography className={`${classPrefix}__error`} sx={{ fontSize: SIZE.body, color: "error.main", textAlign: "center", py: 2, fontFamily: FONTS.sans }}>
                    {search.error}
                </Typography>
            )}

            {!search.loading && (
                <DictionarySearchResults
                    classPrefix={classPrefix}
                    entries={search.entries}
                    segmentGroups={search.segmentGroups}
                    isSegmentMode={search.isSegmentMode}
                    debouncedSearchTerm={search.debouncedSearchTerm}
                    hasMore={search.hasMore}
                    loadingMore={search.loadingMore}
                    loadMore={search.loadMore}
                    language={language}
                    look={look}
                    onEntryClick={onSelect}
                    filter={filter}
                    scrollRootSelector={scrollRootSelector}
                />
            )}

            {showNoResults && (
                <DictionaryNoResultsWell className={`${classPrefix}__no-results`} term={search.debouncedSearchTerm} look={look} />
            )}
        </Box>
    );
}
