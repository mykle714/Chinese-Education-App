import { Box } from '@mui/material';
import DictionaryEntryRow from '../DictionaryEntryRow';
import type { DictionaryEntry, Language } from '../../types';
import type { SegmentGroup } from '../../hooks/useDictionarySearch';
import type { Tier2Look } from '../../timeOfDay/tier2Look';
import { DictionaryLoadMore, DictionaryResultSlab, DictionarySlabLabel } from './DictionaryResultParts';
import { groupByMatchSection, matchSectionLabel } from './dictionaryMatchSections';

/**
 * DictionarySearchResults — a dictionary search's hits, laid out the way the Dictionary
 * page draws them (docs/SHELF_REDESIGN.md § 7b): white slabs of `DictionaryEntryRow
 * variant="slab"` under lowercase group labels.
 *
 *   SEGMENT MODE (a multi-word query split by the GSA): one slab per segment's exact
 *     matches (every group after the first headed by its segment), then one "Starts with
 *     “…”" slab per segment's prefix matches.
 *   PLAIN MODE: one labelled slab per kind of match (English “long”, Pinyin “long”,
 *     English starts with …, Pinyin starts with …, Other), in the server's rank order —
 *     runs of `matchKind` (dictionaryMatchSections.ts), so the next infinite-scroll page
 *     simply extends the last section or opens the next. The tail (`DictionaryLoadMore`)
 *     fetches it.
 *
 * The SAME markup for both hosts, which is the point of the component (it was written
 * once, inline, in DictionaryPage until 2026-11-21):
 *   - the Dictionary page — swipeable glosses, tap-to-copy headwords, the page's scroller;
 *   - DictionaryWordSearch (the Compare panel, the Writing Notebook picker) — a `filter`
 *     on what may be picked, and the host sheet's own scroller for the infinite scroll.
 *
 * Loading, error, empty and no-results states are the HOST's: they differ between the two
 * (the page offers Ask AI; the mini search does not).
 *
 * LAYER: shared presentational (src/components/dictionarySearch). No data access.
 * Depended on by: features/dictionary/DictionaryPage.tsx, components/DictionaryWordSearch.tsx.
 * Docs: docs/SHELF_REDESIGN.md § 7b "Match sections"; docs/WORD_COMPARE_FEATURE.md § The search.
 */
export interface DictionarySearchResultsProps {
    entries: DictionaryEntry[];
    segmentGroups: SegmentGroup[];
    isSegmentMode: boolean;
    /** The term the results are for — names the match sections. */
    debouncedSearchTerm: string;
    hasMore: boolean;
    loadingMore: boolean;
    loadMore: () => void;
    language: Language;
    look: Tier2Look;
    onEntryClick: (entry: DictionaryEntry) => void;
    /** Which results may be shown; the others are dropped (a slab left empty is not drawn). */
    filter?: (entry: DictionaryEntry) => boolean;
    /** Class-name root for the host's styling hooks. */
    classPrefix: string;
    /** Rows: tap the headword to copy it instead of opening the row (the Dictionary page). */
    headwordTapToCopy?: boolean;
    /** Rows: long glosses swipe sideways (the Dictionary page; needs pan-x on its scroller). */
    swipeGloss?: boolean;
    /** The infinite-scroll observer's root (DictionaryLoadMore). Default: the page scroller. */
    scrollRootSelector?: string;
}

export default function DictionarySearchResults({
    entries, segmentGroups, isSegmentMode, debouncedSearchTerm, hasMore, loadingMore, loadMore,
    language, look, onEntryClick, filter, classPrefix, headwordTapToCopy = false, swipeGloss = false,
    scrollRootSelector,
}: DictionarySearchResultsProps) {
    const keep = (list: DictionaryEntry[]) => (filter ? list.filter(filter) : list);

    const renderRow = (entry: DictionaryEntry) => (
        <DictionaryEntryRow
            key={entry.id}
            entry={entry}
            onClick={onEntryClick}
            language={language}
            headwordTapToCopy={headwordTapToCopy}
            variant="slab"
            tones={look}
            swipeGloss={swipeGloss}
        />
    );

    if (isSegmentMode) {
        // Filter first, so a segment whose every hit was filtered out leaves no empty slab.
        const groups = segmentGroups.map(g => ({ segment: g.segment, exact: keep(g.exactEntries), prefix: keep(g.prefixEntries) }));
        const exactGroups = groups.filter(g => g.exact.length > 0);
        const prefixGroups = groups.filter(g => g.prefix.length > 0);
        if (exactGroups.length === 0 && prefixGroups.length === 0) return null;
        return (
            <Box className={`${classPrefix}__segment-results`}>
                {exactGroups.map((group, idx) => (
                    <Box key={`exact-${group.segment}`} className={`${classPrefix}__segment-exact-group`}>
                        {idx > 0 && (
                            <DictionarySlabLabel className={`${classPrefix}__segment-label`} look={look}>{group.segment}</DictionarySlabLabel>
                        )}
                        <DictionaryResultSlab className={`${classPrefix}__segment-exact-list`} look={look}>
                            {group.exact.map(renderRow)}
                        </DictionaryResultSlab>
                    </Box>
                ))}
                {prefixGroups.map((group) => (
                    <Box key={`prefix-${group.segment}`} className={`${classPrefix}__segment-prefix-section`}>
                        <DictionarySlabLabel className={`${classPrefix}__starts-with-label`} look={look}>
                            Starts with “{group.segment}”
                        </DictionarySlabLabel>
                        <DictionaryResultSlab className={`${classPrefix}__segment-prefix-list`} look={look}>
                            {group.prefix.map(renderRow)}
                        </DictionaryResultSlab>
                    </Box>
                ))}
            </Box>
        );
    }

    const shown = keep(entries);
    // A filter can empty every loaded page while more exist; the tail still renders so
    // scrolling keeps fetching until something pickable arrives or the results run out.
    if (shown.length === 0 && !hasMore) return null;
    return (
        <Box className={`${classPrefix}__results`}>
            {groupByMatchSection(shown).map((section, index) => (
                <Box
                    key={`${section.key}-${index}`}
                    className={`${classPrefix}__match-section ${classPrefix}__match-section--${section.key}`}
                >
                    <DictionarySlabLabel className={`${classPrefix}__match-section-label`} look={look} first={index === 0}>
                        {matchSectionLabel(section.key, debouncedSearchTerm, language)}
                    </DictionarySlabLabel>
                    <DictionaryResultSlab className={`${classPrefix}__results-list`} look={look}>
                        {section.entries.map(renderRow)}
                    </DictionaryResultSlab>
                </Box>
            ))}
            {hasMore && (
                <DictionaryLoadMore onReach={loadMore} loading={loadingMore} look={look} scrollRootSelector={scrollRootSelector} />
            )}
        </Box>
    );
}
