import { useRef, useEffect, useCallback, useState } from 'react';
import MobileTabScreen from '../../components/MobileTabScreen';
import SearchField from '../../components/SearchField';
import {
    Container,
    Typography,
    Box,
    Alert,
    IconButton,
    keyframes,
} from '@mui/material';
import Icon from '../../components/Icon';
import DelayedCircularProgress from '../../components/DelayedCircularProgress';
import AiDictionaryEntryCard from '../../components/AiDictionaryEntryCard';
import { useAuth } from '../../AuthContext';
import type { DictionaryEntry, Language } from '../../types';
import PinyinKeypad from '../../components/PinyinKeypad';
import { FooterSpacer } from '../../components/MobileFooter';
import { usePageTitle } from '../../hooks/usePageTitle';
import { useDictionarySearch } from '../../hooks/useDictionarySearch';
import { useTTS } from '../../hooks/useTTS';
import { lookupVocabEntry } from '../../api/dictionary';
import EipSheet from '../flashcards/FlashcardsLearnPage/EipSheet';
import { useEipTabs } from '../flashcards/FlashcardsLearnPage/useEipTabs';
import { registerDictionarySearchFocus } from './dictionarySearchFocus';
import { DEFAULT_SOURCE_ATTRIBUTE } from '../beginnerKeyboard';
import { useTier2Look } from '../../timeOfDay/useTier2Look';
import { DictionaryAskAiRow, DictionaryNoResults } from './DictionaryPageParts';
import DictionarySearchResults from '../../components/dictionarySearch/DictionarySearchResults';
import {
    dictionarySearchFieldSx,
    dictionarySearchPlaceholderFor,
    showsInlineKeypad,
} from '../../components/dictionarySearch/dictionarySearchField';
import DictionarySearchHistoryPanel from './DictionarySearchHistoryPanel';
import { useDictionarySearchHistory } from './useDictionarySearchHistory';

// ── The history panel's slide (docs/SHELF_REDESIGN.md § 7c "Search history") ──────────
// The same duration and easing as the Friends view swap (FriendsBody → VIEW_SLIDE_MS), so
// the app has one "slide across" motion. It travels a full viewport width, not its own
// width: the panel sits inside the Container's padding, and starting at 100vw makes it
// enter from the SCREEN edge rather than appear out of a line 16px inside it.
const HISTORY_SLIDE_MS = 280;
// The slide-in decelerates (the Friends page's view-slide curve). The slide-out runs the
// SAME curve time-reversed — cubic-bezier(x1,y1,x2,y2) mirrors to (1−x2, 1−y2, 1−x1, 1−y1) —
// so it eases away and accelerates off-screen. Reusing the ease-out curve for the exit made it
// cover ~80% of the distance in its first ~80 ms, so every close looked faster than the open.
const HISTORY_SLIDE_IN_EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const HISTORY_SLIDE_OUT_EASING = 'cubic-bezier(0.8, 0.2, 0.8, 0.8)';
const historySlideIn = keyframes`from { transform: translateX(100vw); } to { transform: translateX(0); }`;
const historySlideOut = keyframes`from { transform: translateX(0); } to { transform: translateX(100vw); }`;
/**
 * closed → opening → open → closing → closed. `opening`/`closing` are the slides; in
 * `open` the results layer underneath collapses so the page is only as tall as the list.
 */
type HistoryPhase = 'closed' | 'opening' | 'open' | 'closing';

const prefersReducedMotion = () =>
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// The search field's look, its placeholder and the es-only keypad rule are shared with the
// mini dictionary search (DictionaryWordSearch): src/components/dictionarySearch/dictionarySearchField.ts.

// The empty state's welcome, before anything is typed (owner's copy, 2026-10-29). It lists
// every query shape the search accepts as "example — what it is", the same examples the
// placeholder demonstrates. es has no owner copy yet; its list mirrors what the es search
// accepts (headword or English).
interface WelcomeCopy {
    title: string;
    /** A line under the title — only the fallback (no example list) has one now. */
    intro?: string;
    examples: { query: string; kind: string }[];
}
const WELCOME_COPY: Partial<Record<Language, WelcomeCopy>> = {
    zh: {
        title: 'Welcome to the Mandarin Dictionary!',
        examples: [
            { query: 'hello', kind: 'English' },
            { query: '你好', kind: 'Chinese characters' },
            { query: 'nǐ hǎo', kind: 'Pinyin with tone marks' },
            { query: 'ni3 hao3', kind: 'Pinyin with tone numbers' },
        ],
    },
    es: {
        title: 'Welcome to the Spanish Dictionary!',
        examples: [
            { query: 'hola', kind: 'Spanish' },
            { query: 'hello', kind: 'English' },
        ],
    },
};
const welcomeCopyFor = (language: Language): WelcomeCopy =>
    WELCOME_COPY[language] ?? {
        title: `Welcome to the ${language.toUpperCase()} Dictionary!`,
        intro: 'Enter a word or phrase to begin searching.',
        examples: [],
    };

function DictionaryPage() {
    usePageTitle("Dictionary");
    // Dictionary is always rendered in its mobile layout regardless of viewport
    // width — the desktop two-column layout has been retired.
    const isMobile = true;
    const { user } = useAuth();

    const {
        searchInput, setSearchInput, debouncedSearchTerm, entries, segmentGroups,
        isSegmentMode, loading, error, hasMore, loadingMore, loadMore, clearSearch,
        aiEntry, canAskAi, askingAi, aiNoMatch, aiError, aiLimitReached, aiLimitMessage, askAi,
    } = useDictionarySearch(50);

    const userLanguage = (user?.selectedLanguage || 'zh') as Language;
    const welcome = welcomeCopyFor(userLanguage);

    // Tier 2 time-of-day theming (docs/SHELF_REDESIGN.md § 7b "Time of day"): the ground
    // tints with the tower's hour and the page goes slate at night. The hook also lends
    // the look to the slab footer and the beginner keyboard while this page is up.
    const look = useTier2Look();

    // Ref for the search input — the es PinyinKeypad inserts accents at its caret.
    const searchInputRef = useRef<HTMLInputElement>(null);
    // The page's content root — scopes the history's scroll trigger (useDictionarySearchHistory).
    const pageRootRef = useRef<HTMLDivElement>(null);

    // ── Search history (docs/SHELF_REDESIGN.md § 7c "Search history") ────────────────
    const [historyPhase, setHistoryPhase] = useState<HistoryPhase>('closed');
    const historyVisible = historyPhase !== 'closed';
    const {
        entries: historyEntries,
        commit: commitHistory,
        remove: removeHistoryEntry,
        clearAll: clearAllHistory,
    } = useDictionarySearchHistory({
        userId: user?.id,
        language: userLanguage,
        activeTerm: debouncedSearchTerm,
        hasResults: !loading && (entries.length > 0 || segmentGroups.length > 0 || !!aiEntry),
        // Nothing auto-saves while the list covers the results — the learner isn't looking at them.
        autoCommitEnabled: !historyVisible,
        rootRef: pageRootRef,
    });

    // Reduced motion skips the slides (their animationend would never fire to advance the phase).
    const openHistory = useCallback(() => setHistoryPhase(prefersReducedMotion() ? 'open' : 'opening'), []);
    const closeHistory = useCallback(() => setHistoryPhase((p) =>
        p === 'closed' ? p : prefersReducedMotion() ? 'closed' : 'closing'), []);
    const handleHistorySlideEnd = useCallback((event: React.AnimationEvent) => {
        // animationend bubbles: the rows' touch ripples end too. Only the layer's own slide counts.
        if (event.target !== event.currentTarget) return;
        setHistoryPhase((p) => (p === 'opening' ? 'open' : p === 'closing' ? 'closed' : p));
    }, []);

    // A history row re-runs its query: fill the field (the debounce then searches it),
    // move it back to the top of the list, and slide the list away.
    const handleHistorySelect = useCallback((query: string) => {
        setSearchInput(query);
        commitHistory(query);
        closeHistory();
    }, [setSearchInput, commitHistory, closeHistory]);

    // Focusing the field or typing means the learner is writing a NEW query — the list gets
    // out of the way. (Tapping the history icon blurs the field first, so it never fights this.)
    const handleSearchInputChange = useCallback((next: string) => {
        setSearchInput(next);
        closeHistory();
    }, [setSearchInput, closeHistory]);

    // No auto-focus on visit (removed 2026-10-12): the learner taps the search box
    // to raise a keyboard. The 2026-10-10 auto-focus effect was deferred one frame to
    // dodge BeginnerKeyboardProvider's close-on-pathname-change — see
    // docs/BEGINNER_KEYBOARD.md § 6z-3a if it is ever reinstated.
    //
    // The one exception is a DOUBLE TAP on the footer's Dictionary tab, which asks for
    // focus (dictionarySearchFocus.ts). While mounted, the page focuses synchronously
    // inside that tap's gesture; a request made before mount is applied one frame late.
    useEffect(() => {
        const focusSearch = () => searchInputRef.current?.focus();
        const { unregister, hadPending } = registerDictionarySearchFocus(focusSearch);
        const frame = hadPending ? requestAnimationFrame(focusSearch) : 0;
        return () => {
            if (frame) cancelAnimationFrame(frame);
            unregister();
        };
    }, []);

    // ── Result tap → the eip, as a bottom sheet over the results (2026-10-10) ──────────
    // A result used to NAVIGATE to the read-only dictionary cdp (`/dictionary/card/:word`).
    // It now raises the eip itself (EipSheet), so every link inside it — breakdown and
    // used-in rows, example-sentence segments, Chinese embedded in the long definition,
    // the Compare tool — opens as a TAB in the eip's word trail instead of a new page,
    // and closing the sheet drops the reader straight back on their results. Only this
    // host turns on the dictionary extras: Synonyms + Related and the `Write it` ·
    // `Compare` rail at the bottom of the definition tab, and the Learning toggle
    // (glowing "+" ⇄ "Added!") stacked under the header's speaker.
    //
    // The cdp route itself was deleted 2026-11-10: the eip is now the only view of a
    // dictionary word (the saved-card cdp drills in through the same word trail). Its
    // deletion also retired the query/scroll persistence (`dictionaryBrowseState`) that
    // existed only to survive the list → cdp → back round trip.
    const eip = useEipTabs({ language: userLanguage });
    const [eipOpen, setEipOpen] = useState(false);
    const tts = useTTS();
    // The word whose lookup is in flight. A search row carries only the search
    // projection (no breakdown / examples / usedIn), so the tap fetches the full det row
    // first; a later tap supersedes an earlier one still loading.
    const pendingLookupRef = useRef<string | null>(null);

    const handleEntryClick = useCallback(async (entry: DictionaryEntry) => {
        const word = entry.word1;
        // Opening a result is the strongest sign the query was meant — save it.
        commitHistory(debouncedSearchTerm);
        pendingLookupRef.current = word;
        try {
            const full = await lookupVocabEntry(word, userLanguage);
            if (pendingLookupRef.current !== word) return;
            // A hit found through a non-default sense (`matchedSense`, see
            // resolveSearchRowView) opens the panel ON that sense: it outranks the
            // learner's saved pick, because they just chose it by tapping that row.
            // openForRoot derives the tab's sense index from `selectedSense`.
            eip.openForRoot(entry.matchedSense ? { ...full, selectedSense: entry.matchedSense } : full);
            setEipOpen(true);
        } catch (err) {
            console.error(`Failed to look up dictionary entry "${word}":`, err);
        } finally {
            if (pendingLookupRef.current === word) pendingLookupRef.current = null;
        }
    }, [eip, userLanguage, commitHistory, debouncedSearchTerm]);

    // Zero hits and no AI card / note standing in for them → the recessed empty well.
    const showNoResults = !loading && !!debouncedSearchTerm && entries.length === 0 && segmentGroups.length === 0
        && !aiEntry && !askingAi && !aiNoMatch && !aiError && !aiLimitReached;
    // The accent keypad above the field is Spanish-only (dictionarySearchField.ts → showsInlineKeypad).
    const showInlineKeypad = showsInlineKeypad(userLanguage);

    return (
        // Dictionary is a FOOTER TAB (it took Account's slot on 2026-10-09; it used to be
        // a node page drilled into from the old Home hub). Like Deck/Menu/Arena it
        // renders a bare MobileTabScreen: no back arrow, no slide — the footer switches
        // instead. MobileTabScreen's scroll area owns scrolling, so the page does not
        // wrap its content in its own scroll box.
        <MobileTabScreen
            title="Dictionary"
            contentClassName="dictionary-page__content"
            surfaceColor={look.ground}
            headerTitleColor={look.ink}
            // Result glosses swipe sideways (DictionaryEntryRow `swipeGloss`); a touch pan
            // on them is dead unless the page's scroll area allows pan-x too.
            horizontalPan
        >
        <Container
            ref={pageRootRef}
            className="dictionary-page"
            maxWidth="lg"
            sx={{
                py: 4,
                display: 'flex',
                flexDirection: 'column',
                minHeight: 'calc(100% - 8px)',
                // The history panel slides in from 100vw; clip it at the screen edge so the
                // slide never widens the page into a horizontal scroll. `clip`, not `hidden`:
                // it makes no scroll container, so nothing inside changes behaviour.
                overflowX: 'clip',
            }}
        >
            {/* No page title here on purpose: the MobileTabScreen header already
                says "Dictionary", and the artboard has only that one. The h1 that
                used to sit here printed the name a second time a few millimetres
                below it (docs/SHELF_REDESIGN.md § entry 7, "Watch out"). */}

            {/* Search field (+ the es accent keypad above it). */}
            {isMobile && (
                <Box className="dictionary-page__search-bar--mobile" sx={{ mb: 2 }}>
                    {showInlineKeypad && (
                        <PinyinKeypad
                            className="dictionary-page__special-chars"
                            size="large"
                            language={userLanguage}
                            inputRef={searchInputRef}
                            value={searchInput}
                            onChange={setSearchInput}
                        />
                    )}
                    <SearchField
                        className="dictionary-page__search-input"
                        size="medium"
                        placeholder={dictionarySearchPlaceholderFor(userLanguage)}
                        value={searchInput}
                        onChange={handleSearchInputChange}
                        onClear={clearSearch}
                        onSubmit={commitHistory}
                        onFocus={closeHistory}
                        inputRef={searchInputRef}
                        endAction={
                            <IconButton
                                className="dictionary-page__history-toggle"
                                aria-label={historyVisible ? 'Hide recent searches' : 'Show recent searches'}
                                aria-pressed={historyVisible}
                                size="small"
                                edge="end"
                                onClick={historyVisible ? closeHistory : openHistory}
                            >
                                {/* Ink while the list is out, the field's muted glyph colour otherwise. */}
                                <Icon name="history" size={22} color={historyVisible ? look.ink : look.muted} />
                            </IconButton>
                        }
                        inputAttributes={{
                            // Open on the learner's own (OS) keyboard rather than a beginner
                            // keyboard; the switch bar still offers 写 and ā. Per-field only —
                            // flipping it here leaves the session choice alone.
                            [DEFAULT_SOURCE_ATTRIBUTE]: 'os',
                            // Labels the return key "Search" — on the OS keyboard and on the
                            // ā pad's action key alike (PinyinToneKeyboard → actionFor).
                            enterKeyHint: 'search',
                        }}
                        sx={[dictionarySearchFieldSx(look), showInlineKeypad && { mt: 2 }]}
                    />
                </Box>
            )}

            {/* Results ⇄ history stack. Both layers share ONE grid cell, so the history panel
                slides in over the results without either being taken out of flow; once fully
                open, the results layer collapses so the page is only as tall as the list. */}
            <Box className="dictionary-page__body" sx={{ display: 'grid', flex: 1, alignContent: 'start' }}>
            <Box
                className="dictionary-page__results-layer"
                aria-hidden={historyPhase === 'open' || undefined}
                sx={[
                    { gridArea: '1 / 1', minWidth: 0 },
                    historyPhase === 'open' && { visibility: 'hidden', height: 0, overflow: 'hidden' },
                ]}
            >
                    {/* The AI keycap (canAskAi), right-aligned under the field. No result count since
                        2026-10-29 (owner's call) — the section labels say what was found. Left out when
                        the empty well below already offers the wide Ask AI button. */}
                    {debouncedSearchTerm && !loading && (canAskAi || askingAi) && !showNoResults && (
                        <DictionaryAskAiRow askingAi={askingAi} onAskAi={askAi} look={look} />
                    )}

                    {/* AI synthetic entry — rendered at the TOP of the results (above breakdown / regular
                        results) so a just-generated answer is immediately visible. A cached answer shows
                        without a tap. An "Ask AI" tap mounts the card in its compact loading phase
                        ("Asking AI…"); the SAME instance then grows into the answer, so the white card
                        never blinks out between the two (AiDictionaryEntryCard → useAnimatedHeight). On
                        a no-match / error the card unmounts and the note below takes its place.
                        See docs/DICTIONARY_AI_FALLBACK_SEARCH.md. */}
                    {((!loading && aiEntry) || askingAi) && (
                        <Box className="dictionary-page__ai-result" sx={{ mb: 3 }}>
                            <AiDictionaryEntryCard entry={aiEntry} look={look} />
                        </Box>
                    )}
                    {!askingAi && aiNoMatch && (
                        <Box className="dictionary-page__ai-no-match" sx={{ mb: 3 }}>
                            <Typography variant="body2" sx={{ color: look.muted }}>
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
                            <Typography variant="body2" sx={{ color: look.muted }}>
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

                    {/* Loading State (first page only — later pages load under the results) */}
                    {loading && (
                        <Box className="dictionary-page__loading-spinner" sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                            <DelayedCircularProgress />
                        </Box>
                    )}

                    {/* The hits — segment slabs, or one labelled slab per kind of match with the
                        infinite-scroll tail (DictionarySearchResults, shared with the mini search). */}
                    {!loading && (
                        <Box className="dictionary-page__results-block" sx={{ mb: 3, '&:empty': { display: 'none' } }}>
                            <DictionarySearchResults
                                classPrefix="dictionary-page"
                                entries={entries}
                                segmentGroups={segmentGroups}
                                isSegmentMode={isSegmentMode}
                                debouncedSearchTerm={debouncedSearchTerm}
                                hasMore={hasMore}
                                loadingMore={loadingMore}
                                loadMore={loadMore}
                                language={userLanguage}
                                look={look}
                                onEntryClick={handleEntryClick}
                                headwordTapToCopy
                                swipeGloss
                            />
                        </Box>
                    )}

                    {/* No Results — suppressed while an AI card / no-match / error note stands in for it. */}
                    {showNoResults && (
                        <DictionaryNoResults term={debouncedSearchTerm} showAskAi={canAskAi} onAskAi={askAi} look={look} />
                    )}

                    {/* Empty State */}
                    {!loading && !debouncedSearchTerm && (
                        // Everything centred on one axis: the title, then the examples as a
                        // centred text-only block of three columns (example – name), each column
                        // flush left so the examples and dashes line up.
                        <Box className="dictionary-page__empty-state" sx={{ textAlign: 'center', py: 8 }}>
                            <Typography className="dictionary-page__welcome-title" variant="h6" sx={{ color: look.ink, mb: 0.5 }}>
                                {welcome.title}
                            </Typography>
                            {welcome.intro && (
                                <Typography className="dictionary-page__welcome-intro" variant="body2" sx={{ color: look.muted, textWrap: 'pretty' }}>
                                    {welcome.intro}
                                </Typography>
                            )}
                            {welcome.examples.length > 0 && (
                                <Box
                                    className="dictionary-page__welcome-examples"
                                    sx={{ display: 'grid', gridTemplateColumns: 'auto auto auto', justifyContent: 'center', columnGap: 1, rowGap: 0.75, mt: 2, textAlign: 'left' }}
                                >
                                    {welcome.examples.map(({ query, kind }) => (
                                        <Box key={query} className="dictionary-page__welcome-example" sx={{ display: 'contents' }}>
                                            <Typography className="dictionary-page__welcome-example-query" variant="body2" sx={{ color: look.ink2 }}>
                                                {query}
                                            </Typography>
                                            <Typography className="dictionary-page__welcome-example-dash" variant="body2" sx={{ color: look.muted }}>
                                                –
                                            </Typography>
                                            <Typography className="dictionary-page__welcome-example-kind" variant="body2" sx={{ color: look.muted }}>
                                                {kind}
                                            </Typography>
                                        </Box>
                                    ))}
                                </Box>
                            )}
                        </Box>
                    )}
            </Box>
            {historyVisible && (
                <Box
                    className="dictionary-page__history-layer"
                    onAnimationEnd={handleHistorySlideEnd}
                    sx={{
                        gridArea: '1 / 1',
                        minWidth: 0,
                        zIndex: 1,
                        // Opaque ground so the results don't show through mid-slide.
                        backgroundColor: look.ground,
                        animation: historyPhase === 'opening'
                            ? `${historySlideIn} ${HISTORY_SLIDE_MS}ms ${HISTORY_SLIDE_IN_EASING} both`
                            : historyPhase === 'closing'
                                ? `${historySlideOut} ${HISTORY_SLIDE_MS}ms ${HISTORY_SLIDE_OUT_EASING} both`
                                : 'none',
                    }}
                >
                    <DictionarySearchHistoryPanel
                        entries={historyEntries}
                        look={look}
                        onSelect={handleHistorySelect}
                        onRemove={removeHistoryEntry}
                        onClearAll={clearAllHistory}
                    />
                </Box>
            )}
            </Box>

            <FooterSpacer />
        </Container>

        {/* The result's eip — portals its own scrim + sheet (SheetPanel), so where it sits
            here does not affect where it paints. See handleEntryClick above. */}
        <EipSheet
            eip={eip}
            open={eipOpen}
            onClose={() => setEipOpen(false)}
            onSpeak={tts.speak}
            onSpeakSentence={tts.speakSentence}
            speakingKey={tts.speakingKey}
            showSynonymsRelated
            showWordTools
            showLearning
            // A lookup is the whole point of this page, so the result opens tall — and a
            // downward drag/fling clips back to this 80% rather than to the usual 60%.
            defaultHeightRatio={0.8}
        />
        </MobileTabScreen>
    );
}

export default DictionaryPage;
