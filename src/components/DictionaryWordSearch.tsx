import { useMemo, useRef } from "react";
import { Box, IconButton, Typography, CircularProgress, useTheme } from "@mui/material";
import { Close } from "@mui/icons-material";
import SearchField from "./SearchField";
import PinyinKeypad from "./PinyinKeypad";
import DictionaryEntryRow from "./DictionaryEntryRow";
import { useDictionarySearch } from "../hooks/useDictionarySearch";
import type { DictionaryEntry, Language } from "../types";
import { SIZE, WEIGHT, TRACKING } from "../theme/scale";
import { FONTS } from "../theme/fonts";

const UI_FONT = FONTS.sans;

/**
 * DictionaryWordSearch — the "Pick a word" mini dictionary search: a caps heading with a
 * cancel ✕, the pinyin keypad, a search field and the result rows. Tapping a row hands
 * its det record back through `onSelect`; the host decides what picking means.
 *
 * Extracted from CompareWorkspace (its slot-B search) so the Writing Notebook's word
 * picker is the same selector rather than a second copy (docs/WRITING_NOTEBOOK.md
 * § "Word picker", docs/WORD_COMPARE_FEATURE.md).
 *
 * Owns the search state (`useDictionarySearch`), so every mount starts empty — hosts
 * mount it only while picking.
 *
 * Inside a SheetPanel, focusing the search field maximizes the sheet (the field's wrapper
 * carries `data-sheet-maximize-on-focus`; SheetPanel listens for it) — the keyboard that
 * focus raises would otherwise leave a part-height sheet showing only the field.
 *
 * Used by: CompareWorkspace, features/writingNotebook/NotebookWordPickerSheet.
 * LAYER: shared presentational + request hook.
 */
export interface DictionaryWordSearchProps {
    language: Language;
    onSelect: (entry: DictionaryEntry) => void;
    /** Cancel ✕ beside the heading. Absent → no ✕ (the host has its own close). */
    onCancel?: () => void;
    /** Which results may be picked; others are left out of the list. Default: all. */
    filter?: (entry: DictionaryEntry) => boolean;
    /** Class-name root for the host's styling hooks (default `dictionary-word-search`). */
    classPrefix?: string;
    /**
     * Heading text (default "Pick a word"). `null` drops the heading — and, with no
     * `onCancel` either, the whole heading row (the notebook picker: its sheet's own
     * title already says what the search is for).
     */
    heading?: string | null;
}

export default function DictionaryWordSearch({
    language, onSelect, onCancel, filter, classPrefix = "dictionary-word-search", heading = "Pick a word",
}: DictionaryWordSearchProps) {
    const theme = useTheme();
    const fc = theme.palette.flashcard;
    const searchInputRef = useRef<HTMLInputElement>(null);
    const search = useDictionarySearch(20);

    // Search results are det records (DictionaryEntry), whose headword field is `word1`.
    const resultEntries: DictionaryEntry[] = useMemo(() => {
        const all = search.isSegmentMode
            ? search.segmentGroups.flatMap(g => [...g.exactEntries, ...g.prefixEntries])
            : search.entries;
        return filter ? all.filter(filter) : all;
    }, [search.isSegmentMode, search.segmentGroups, search.entries, filter]);

    return (
        <Box className={`${classPrefix}`} onClick={(e) => e.stopPropagation()} sx={{ display: 'flex', flexDirection: 'column', gap: '10px', flexShrink: 0 }}>
            {(heading !== null || onCancel) && (
            <Box className={`${classPrefix}__heading`} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 30 }}>
                {heading !== null && (
                <Typography sx={{ fontSize: SIZE.caption, fontWeight: WEIGHT.bold, color: fc.textSecondary, letterSpacing: TRACKING.caps, textTransform: 'uppercase', fontFamily: UI_FONT }}>
                    {heading}
                </Typography>
                )}
                {onCancel && (
                    <IconButton className={`${classPrefix}__search-close`} size="small" aria-label="Cancel search" onClick={onCancel} sx={{ marginLeft: "auto" }}>
                        <Close fontSize="small" />
                    </IconButton>
                )}
            </Box>
            )}
            <PinyinKeypad
                language={language}
                inputRef={searchInputRef}
                value={search.searchInput}
                onChange={search.setSearchInput}
            />
            {/* `data-sheet-maximize-on-focus`: inside a SheetPanel, focusing the field (which
                raises a keyboard) grows the sheet to full height — SheetPanel's focusin
                listener. Harmless outside a sheet. */}
            <Box className={`${classPrefix}__search-field-wrap`} data-sheet-maximize-on-focus>
            <SearchField
                className={`${classPrefix}__search-input`}
                placeholder="Search dictionary..."
                value={search.searchInput}
                onChange={search.setSearchInput}
                onClear={() => search.clearSearch()}
                inputRef={searchInputRef}
            />
            </Box>
            {/* No gap between rows: `.dr` separates with its own bottom hairline
                (docs/SHELF_REDESIGN.md § entry 7), and a gap would leave the
                hairlines floating between detached rows. */}
            <Box className={`${classPrefix}__results`} sx={{ display: 'flex', flexDirection: 'column' }}>
                {search.loading && (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                        <CircularProgress size={22} />
                    </Box>
                )}
                {!search.loading && resultEntries.map((entry) => (
                    <DictionaryEntryRow key={entry.id} entry={entry} onClick={onSelect} inset={4} />
                ))}
                {!search.loading && search.debouncedSearchTerm && resultEntries.length === 0 && (
                    <Typography sx={{ fontSize: SIZE.body, color: fc.textSecondary, textAlign: 'center', py: 2, fontFamily: UI_FONT }}>
                        No results for "{search.debouncedSearchTerm}"
                    </Typography>
                )}
            </Box>
        </Box>
    );
}
