import { useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import NodePage from '../../components/NodePage';
import {
    Container,
    Typography,
    Box,
    TextField,
    InputAdornment,
    IconButton,
    Alert,
    Pagination,
    Chip,
    CircularProgress,
} from '@mui/material';
import { Search, Clear, AutoAwesome } from '@mui/icons-material';
import DelayedCircularProgress from '../../components/DelayedCircularProgress';
import AiDictionaryEntryCard from '../../components/AiDictionaryEntryCard';
import { SIZE } from '../../theme/scale';
import { COLORS } from '../../theme/colors';
import { useAuth } from '../../AuthContext';
import type { DictionaryEntry, Language } from '../../types';
import DictionaryEntryRow from '../../components/DictionaryEntryRow';
import PinyinKeypad from '../../components/PinyinKeypad';
import { SectionRule } from '../../components/primitives/Label';
import { FooterSpacer } from '../../components/MobileFooter';
import { usePageTitle } from '../../hooks/usePageTitle';
import { useDictionarySearch } from '../../hooks/useDictionarySearch';
import { useSlideNavigate } from '../../hooks/useSlideNavigate';
import { dictionaryBrowseState } from './dictionaryBrowseState';

// `.dr` rows carry their own 22px side padding (the artboard's, matching every other
// full-bleed list in the shelf system), so a list of them has to escape the Container's
// gutter — otherwise the hairline between rows stops short of both edges and the rows
// read as a card with no border. The negative margin cancels MUI's Container padding
// at each breakpoint; the rows put the space back.
const FULL_BLEED_LIST_SX_ARRAY = [{ mx: { xs: -2, sm: -3 } }] as const;
const FULL_BLEED_LIST_SX = FULL_BLEED_LIST_SX_ARRAY[0];

// dictionaryBrowseState (the persisted query/page/scroll singleton) now lives in
// ./dictionaryBrowseState so the Layout route watcher can reset it on exit from
// the Dictionary space. It is still seeded into useDictionarySearch below and
// kept in sync by the effects further down.

// The dictionary search accepts several shapes of query (see DictionaryDAL ->
// searchByWord1): the headword itself, pinyin — tone-marked, plain, or numbered, spaced or
// spaceless (zh only) — and English definition text. Nothing else on the page says so, so the
// empty-state placeholder spells the formats out with one word written each accepted way; the
// numbered form in particular is otherwise undiscoverable.
const SEARCH_PLACEHOLDERS: Partial<Record<Language, string>> = {
    zh: '你好, nǐ hǎo, ni3 hao3',
    es: 'hola, hello',
};
const searchPlaceholderFor = (language: Language): string =>
    SEARCH_PLACEHOLDERS[language] ?? `Search ${language.toUpperCase()} dictionary...`;

function DictionaryPage() {
    usePageTitle("Dictionary");
    const navigate = useNavigate();
    const slideNavigate = useSlideNavigate();
    // Dictionary is always rendered in its mobile layout regardless of viewport
    // width — the desktop two-column layout has been retired.
    const isMobile = true;
    const { user } = useAuth();

    const {
        searchInput, setSearchInput, debouncedSearchTerm, entries, segmentGroups,
        isSegmentMode, loading, error, page, setPage, total, totalPages, clearSearch,
        aiEntry, canAskAi, askingAi, aiNoMatch, aiError, aiLimitReached, aiLimitMessage, askAi,
    } = useDictionarySearch(50, { search: dictionaryBrowseState.search, page: dictionaryBrowseState.page });

    const userLanguage = (user?.selectedLanguage || 'zh') as Language;

    // Ref for search input to maintain focus
    const searchInputRef = useRef<HTMLInputElement>(null);
    // Ref on the page Container, used to reach the MobileTabScreen scroll container
    // (.mobile-tab-screen__scroll) that NodePage owns, for scroll save/restore.
    const containerRef = useRef<HTMLDivElement | null>(null);

    // Keep the persisted query + page in sync so a drill-in → back restores them.
    useEffect(() => { dictionaryBrowseState.search = searchInput; }, [searchInput]);
    useEffect(() => { dictionaryBrowseState.page = page; }, [page]);

    // Save scroll position continuously (so it's current whenever the user drills in)
    // and restore it once results have rendered (which give the page its height).
    const didRestoreScroll = useRef(false);
    useEffect(() => {
        const scroller = containerRef.current?.closest('.mobile-tab-screen__scroll') as HTMLElement | null;
        if (!scroller) return;
        const onScroll = () => { dictionaryBrowseState.scrollTop = scroller.scrollTop; };
        scroller.addEventListener('scroll', onScroll, { passive: true });
        return () => scroller.removeEventListener('scroll', onScroll);
    }, []);
    useEffect(() => {
        if (didRestoreScroll.current) return;
        const target = dictionaryBrowseState.scrollTop;
        if (!target) { didRestoreScroll.current = true; return; }
        // Only restore after the fetch settles AND results exist — otherwise the page
        // is still empty/short and scrollTop would clamp back to 0.
        if (loading) return;
        if (entries.length === 0 && segmentGroups.length === 0) return;
        const scroller = containerRef.current?.closest('.mobile-tab-screen__scroll') as HTMLElement | null;
        if (!scroller) return;
        didRestoreScroll.current = true;
        // The result rows keep growing in height for a few frames after mount (cpcd /
        // pinyin layout settling), which would clamp an early scrollTop set. Retry
        // each frame until the target sticks, or the content simply isn't that tall.
        let tries = 0;
        const attempt = () => {
            scroller.scrollTop = target;
            if (Math.abs(scroller.scrollTop - target) > 1 && ++tries < 20) {
                requestAnimationFrame(attempt);
            }
        };
        requestAnimationFrame(attempt);
    }, [loading, entries.length, segmentGroups.length]);

    const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setSearchInput(event.target.value);
    };

    const handleClearSearch = () => {
        clearSearch();
    };

    // Tapping a result-card opens the read-only dictionary card-detail page (cdp)
    // for that word — a NODE-page slide (in from the right), replacing the old EIP
    // popup. The cdp fetches the full det row itself (breakdown, examples, usedIn,
    // etc.). See docs/LEAF_NODE_PAGES.md + DictionaryCardDetailPage.
    const handleEntryClick = useCallback((entry: DictionaryEntry) => {
        slideNavigate(`/dictionary/card/${encodeURIComponent(entry.word1)}`);
    }, [slideNavigate]);

    const handlePageChange = (_event: React.ChangeEvent<unknown>, value: number) => {
        setPage(value);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    return (
        // Dictionary is a NODE PAGE (see docs/LEAF_NODE_PAGES.md): keeps the footer,
        // LEFT back arrow (returns to the Home menu), slides in from the right. The
        // NodePage/MobileTabScreen scroll area owns scrolling + floating-footer
        // clearance, so the page no longer wraps its content in its own scroll box.
        // Opened from the Home menu, so the Home tab stays active.
        <NodePage title="Dictionary" onBack={() => navigate("/")}>
        <Container
            className="dictionary-page"
            ref={containerRef}
            maxWidth="lg"
            sx={{
                py: 4,
                display: 'flex',
                flexDirection: 'column',
                minHeight: 'calc(100% - 8px)',
            }}
        >
            {/* No page title here on purpose: NodePage's back-arrow header already
                says "Dictionary", and the artboard has only that one. The h1 that
                used to sit here printed the name a second time a few millimetres
                below it (docs/SHELF_REDESIGN.md § entry 7, "Watch out"). */}

            {/* Search Bar and Special Characters - Mobile (below title, in normal flow) */}
            {isMobile && (
                <Box
                    className="dictionary-page__search-bar--mobile"
                    sx={{ mb: 2 }}
                >
                    <PinyinKeypad
                        className="dictionary-page__special-chars"
                        language={userLanguage}
                        inputRef={searchInputRef}
                        value={searchInput}
                        onChange={setSearchInput}
                    />
                    <TextField
                        className="dictionary-page__search-input"
                        fullWidth
                        placeholder={searchPlaceholderFor(userLanguage)}
                        value={searchInput}
                        onChange={handleSearchChange}
                        inputRef={searchInputRef}
                        InputProps={{
                            startAdornment: (
                                <InputAdornment position="start">
                                    <Search />
                                </InputAdornment>
                            ),
                            endAdornment: searchInput && (
                                <InputAdornment position="end">
                                    <IconButton
                                        aria-label="clear search"
                                        onClick={handleClearSearch}
                                        edge="end"
                                        size="small"
                                    >
                                        <Clear />
                                    </IconButton>
                                </InputAdornment>
                            ),
                        }}
                        sx={{ mt: 2 }}
                    />
                </Box>
            )}

            {/* Results Info — a blue results-count pill, optionally followed by the orange "AI" pill
                that generates a synthetic entry for an unmatched pinyin query (canAskAi). */}
            {debouncedSearchTerm && !loading && (
                <Box className="dictionary-page__results-info" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                    {isSegmentMode
                        ? <Chip
                            className="dictionary-page__results-chip--segment"
                            label={`${segmentGroups.reduce((n, g) => n + g.exactEntries.length + g.prefixEntries.length, 0)} results for "${debouncedSearchTerm}"`}
                            color="primary"
                            variant="outlined"
                          />
                        : <Chip
                            className="dictionary-page__results-chip--regular"
                            label={`${total} results for "${debouncedSearchTerm}"`}
                            color="primary"
                            variant="outlined"
                          />
                    }
                    {(canAskAi || askingAi) && (
                        <Chip
                            className="dictionary-page__results-chip--ai"
                            label="AI"
                            icon={<AutoAwesome sx={{ fontSize: SIZE.body }} />}
                            variant="outlined"
                            clickable={!askingAi}
                            disabled={askingAi}
                            onClick={askingAi ? undefined : askAi}
                            sx={{
                                color: COLORS.aiGenerated,
                                borderColor: COLORS.aiGenerated,
                                '& .MuiChip-icon': { color: COLORS.aiGenerated },
                            }}
                          />
                    )}
                </Box>
            )}

            {/* AI synthetic entry — rendered at the TOP of the results (above breakdown / regular
                results) so a just-generated answer is immediately visible. A cached answer shows
                without a tap; an "Ask AI" tap shows the spinner, then the card or a no-match note.
                See docs/DICTIONARY_AI_FALLBACK_SEARCH.md. */}
            {!loading && aiEntry && (
                <Box className="dictionary-page__ai-result" sx={{ mb: 3 }}>
                    <AiDictionaryEntryCard entry={aiEntry} />
                </Box>
            )}
            {askingAi && (
                <Box className="dictionary-page__ai-loading" sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3, color: COLORS.aiGenerated }}>
                    <CircularProgress size={20} sx={{ color: COLORS.aiGenerated }} />
                    <Typography variant="body2" sx={{ color: COLORS.aiGenerated }}>Asking AI…</Typography>
                </Box>
            )}
            {!askingAi && aiNoMatch && (
                <Box className="dictionary-page__ai-no-match" sx={{ mb: 3 }}>
                    <Typography variant="body2" color="text.secondary">
                        AI couldn't find a likely match for "{debouncedSearchTerm}".
                    </Typography>
                </Box>
            )}
            {!askingAi && aiError && (
                <Box className="dictionary-page__ai-error" sx={{ mb: 3 }}>
                    <Typography variant="body2" color="error">
                        The AI request didn't go through. Tap AI to try again.
                    </Typography>
                </Box>
            )}
            {!askingAi && aiLimitReached && (
                <Box className="dictionary-page__ai-limit" sx={{ mb: 3 }}>
                    <Typography variant="body2" color="text.secondary">
                        {aiLimitMessage || "You've reached your daily limit of AI lookups. Try again tomorrow."}
                    </Typography>
                </Box>
            )}

            {/* Error Message */}
            {error && (
                <Alert className="dictionary-page__error-alert" severity="error" sx={{ mb: 3 }}>
                    {error}
                </Alert>
            )}

            {/* Loading State */}
            {loading && (
                <Box className="dictionary-page__loading-spinner" sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                    <DelayedCircularProgress />
                </Box>
            )}

            {/* Segment Mode Results:
                  1. All exact matches across all segments (in segment order), with dividers between segments.
                  2. All "starts with" groups (in segment order), each with a labeled divider. */}
            {!loading && isSegmentMode && segmentGroups.length > 0 && (
                <Box sx={{ mb: 3 }}>
                    {/* — Exact matches — */}
                    {segmentGroups
                        .filter(g => g.exactEntries.length > 0)
                        .map((group, idx) => (
                            <Box key={`exact-${group.segment}`} className="dictionary-page__segment-exact-group">
                                {idx > 0 && (
                                    <SectionRule
                                        className="dictionary-page__segment-rule"
                                        label={group.segment}
                                        sx={{ padding: '19px 0 0' }}
                                    />
                                )}
                                <Box className="dictionary-page__segment-exact-list" sx={FULL_BLEED_LIST_SX}>
                                    {group.exactEntries.map((entry) => (
                                        <DictionaryEntryRow key={entry.id} entry={entry} onClick={handleEntryClick} language={userLanguage} />
                                    ))}
                                </Box>
                            </Box>
                        ))
                    }

                    {/* — Starts with — */}
                    {segmentGroups
                        .filter(g => g.prefixEntries.length > 0)
                        .map((group) => (
                            <Box key={`prefix-${group.segment}`} className="dictionary-page__segment-prefix-section">
                                <SectionRule
                                    className="dictionary-page__starts-with-rule"
                                    label={`Starts with “${group.segment}”`}
                                    sx={{ padding: '19px 0 6px' }}
                                />
                                <Box className="dictionary-page__segment-prefix-list" sx={FULL_BLEED_LIST_SX}>
                                    {group.prefixEntries.map((entry) => (
                                        <DictionaryEntryRow key={entry.id} entry={entry} onClick={handleEntryClick} language={userLanguage} />
                                    ))}
                                </Box>
                            </Box>
                        ))
                    }
                </Box>
            )}

            {/* Regular Search Results Grid */}
            {!loading && !isSegmentMode && entries.length > 0 && (
                <Box
                    className="dictionary-page__results-list"
                    sx={[...FULL_BLEED_LIST_SX_ARRAY, { mb: 3 }]}
                >
                    {entries.map((entry) => (
                        <DictionaryEntryRow
                            key={entry.id}
                            entry={entry}
                            onClick={handleEntryClick}
                            language={userLanguage}
                        />
                    ))}
                </Box>
            )}

            {/* No Results — suppressed while an AI card / no-match / error note stands in for it. */}
            {!loading && debouncedSearchTerm && entries.length === 0 && segmentGroups.length === 0
                && !aiEntry && !askingAi && !aiNoMatch && !aiError && !aiLimitReached && (
                <Box className="dictionary-page__no-results" sx={{ textAlign: 'center', py: 4 }}>
                    <Typography variant="body1" color="text.secondary">
                        No results found for "{debouncedSearchTerm}"
                    </Typography>
                </Box>
            )}

            {/* Empty State */}
            {!loading && !debouncedSearchTerm && (
                <Box className="dictionary-page__empty-state" sx={{ textAlign: 'center', py: 8 }}>
                    <Typography variant="h6" color="text.secondary" gutterBottom>
                        Search the {userLanguage.toUpperCase()} Dictionary
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        Enter a word or phrase to begin searching
                    </Typography>
                </Box>
            )}

            {/* Pagination — only shown in regular search mode */}
            {!loading && !isSegmentMode && entries.length > 0 && totalPages > 1 && (
                <Box className="dictionary-page__pagination" sx={{ display: 'flex', justifyContent: 'center', mt: 4, mb: 0 }}>
                    <Pagination
                        count={totalPages}
                        page={page}
                        onChange={handlePageChange}
                        color="primary"
                        showFirstButton
                        showLastButton
                    />
                </Box>
            )}

            <FooterSpacer />
        </Container>
        </NodePage>
    );
}

export default DictionaryPage;
