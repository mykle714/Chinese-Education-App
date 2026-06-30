import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import LeafPage from '../components/LeafPage';
import {
    Container,
    Typography,
    Box,
    TextField,
    InputAdornment,
    IconButton,
    Button,
    Alert,
    Pagination,
    Chip,
    Divider,
    Snackbar,
} from '@mui/material';
import { Search, Clear } from '@mui/icons-material';
import DelayedCircularProgress from '../components/DelayedCircularProgress';
import { useAuth } from '../AuthContext';
import { API_BASE_URL } from '../constants';
import type { DictionaryEntry, Language, VocabEntry } from '../types';
import DictionaryEntryRow from '../components/DictionaryEntryRow';
import InfoCardPopup from '../features/flashcards/FlashcardsLearnPage/InfoCardPopup';
import { dictionaryEntryToVocabEntry } from '../features/flashcards/FlashcardsLearnPage/dictEntryAdapter';
import { useEipTabs } from '../features/flashcards/FlashcardsLearnPage/useEipTabs';
import EipTabStrip from '../features/flashcards/FlashcardsLearnPage/EipTabStrip';
import TooManyTabsSnackbar from '../features/flashcards/FlashcardsLearnPage/TooManyTabsSnackbar';
import { usePageTitle } from '../hooks/usePageTitle';
import { useTTS } from '../hooks/useTTS';

// Matches any CJK Unified Ideograph (common + extension A/B blocks)
const hasChinese = (text: string) => /[\u4e00-\u9fff\u3400-\u4dbf]/.test(text);

interface SegmentGroup {
    segment: string;
    exactEntries: DictionaryEntry[];
    prefixEntries: DictionaryEntry[];
}

// Special characters for each language
const SPECIAL_CHARACTERS: Record<Language, string[]> = {
    zh: [
        'ā', 'á', 'ǎ', 'à',
        'ē', 'é', 'ě', 'è',
        'ī', 'í', 'ǐ', 'ì',
        'ō', 'ó', 'ǒ', 'ò',
        'ū', 'ú', 'ǔ', 'ù',
        'ǖ', 'ǘ', 'ǚ', 'ǜ'
    ],
    es: ['á', 'é', 'í', 'ó', 'ú', 'ñ', 'ü', '¿', '¡'],
};

function DictionaryPage() {
    usePageTitle("Dictionary");
    const navigate = useNavigate();
    // Dictionary is always rendered in its mobile layout regardless of viewport
    // width — the desktop two-column layout has been retired.
    const isMobile = true;
    const { token, user } = useAuth();
    const tts = useTTS();

    const [searchInput, setSearchInput] = useState('');
    const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
    // Regular search results (paginated)
    const [entries, setEntries] = useState<DictionaryEntry[]>([]);
    // Segment search results (grouped by segment, ordered by length)
    const [segmentGroups, setSegmentGroups] = useState<SegmentGroup[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // Entry-tab system: tapping a result-card opens the EIP popup; tapping a
    // breakdown/used-in row inside it adds a tab instead of stacking another
    // popup. Scrim tap closes the popup and clears every tab.
    const [isEipOpen, setIsEipOpen] = useState(false);
    const eipStripRef = useRef<HTMLDivElement | null>(null);
    const eip = useEipTabs({ apiBaseUrl: API_BASE_URL, token, stripRef: eipStripRef });

    // Pagination state (only used in regular search mode)
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [total, setTotal] = useState(0);
    const limit = 50;

    // Whether the current search term triggers GSA segment mode
    const isSegmentMode = hasChinese(debouncedSearchTerm);

    const userLanguage = (user?.selectedLanguage || 'zh') as Language;
    const specialChars = SPECIAL_CHARACTERS[userLanguage] || [];

    // Ref for search input to maintain focus
    const searchInputRef = useRef<HTMLInputElement>(null);

    // Helper function to get background color for each vowel group
    const getVowelColor = (char: string): string => {
        const vowelColors: Record<string, string> = {
            'ā': '#ffebee', 'á': '#ffebee', 'ǎ': '#ffebee', 'à': '#ffebee',  // a - light red
            'ē': '#fff3e0', 'é': '#fff3e0', 'ě': '#fff3e0', 'è': '#fff3e0',  // e - light orange
            'ī': '#fffde7', 'í': '#fffde7', 'ǐ': '#fffde7', 'ì': '#fffde7',  // i - light yellow
            'ō': '#e8f5e9', 'ó': '#e8f5e9', 'ǒ': '#e8f5e9', 'ò': '#e8f5e9',  // o - light green
            'ū': '#e3f2fd', 'ú': '#e3f2fd', 'ǔ': '#e3f2fd', 'ù': '#e3f2fd',  // u - light blue
            'ǖ': '#f3e5f5', 'ǘ': '#f3e5f5', 'ǚ': '#f3e5f5', 'ǜ': '#f3e5f5',  // ü - light purple
        };
        return vowelColors[char] || 'transparent';
    };

    // Shared style for the tone-marked pinyin vowel buttons. Square footprint:
    // the height matches a MUI small contained button (~30px); width is locked to
    // the same value and the default horizontal padding is removed so the single
    // glyph stays centered.
    const specialCharButtonSx = (char: string) => ({
        width: '30px',
        minWidth: '30px',
        height: '30px',
        p: 0,
        fontFamily: 'inherit',
        textTransform: 'lowercase' as const,
        backgroundColor: getVowelColor(char),
        color: '#000000',
        '&:hover': {
            backgroundColor: getVowelColor(char),
            filter: 'brightness(0.9)',
        },
    });

    // Debounce search input
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearchTerm(searchInput);
            setPage(1); // Reset to first page on new search
        }, 400);

        return () => clearTimeout(timer);
    }, [searchInput]);

    // Fetch search results — switches between segment mode (CJK input) and regular paginated search
    useEffect(() => {
        const fetchResults = async () => {
            if (!debouncedSearchTerm.trim()) {
                setEntries([]);
                setSegmentGroups([]);
                setTotal(0);
                setTotalPages(1);
                return;
            }

            setLoading(true);
            setError(null);

            try {
                if (hasChinese(debouncedSearchTerm)) {
                    // GSA segment mode: look up all segments of the input
                    const response = await fetch(
                        `${API_BASE_URL}/api/dictionary/segment?text=${encodeURIComponent(debouncedSearchTerm)}`,
                        { headers: { 'Authorization': `Bearer ${token}` }, credentials: 'include' }
                    );
                    if (response.ok) {
                        const data = await response.json();
                        setSegmentGroups(data.segments || []);
                        setEntries([]);
                    } else {
                        const errorData = await response.json();
                        setError(errorData.error || 'Failed to segment search');
                    }
                } else {
                    // Regular paginated search
                    const response = await fetch(
                        `${API_BASE_URL}/api/dictionary/search?term=${encodeURIComponent(debouncedSearchTerm)}&page=${page}&limit=${limit}`,
                        { headers: { 'Authorization': `Bearer ${token}` }, credentials: 'include' }
                    );
                    if (response.ok) {
                        const data = await response.json();
                        setEntries(data.entries || []);
                        setSegmentGroups([]);
                        setTotal(data.pagination?.total || 0);
                        setTotalPages(data.pagination?.totalPages || 1);
                    } else {
                        const errorData = await response.json();
                        setError(errorData.error || 'Failed to search dictionary');
                    }
                }
            } catch (err) {
                console.error('Error searching dictionary:', err);
                setError('An error occurred while searching');
            } finally {
                setLoading(false);
            }
        };

        fetchResults();
    }, [debouncedSearchTerm, page, token]);

    const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setSearchInput(event.target.value);
    };

    const handleClearSearch = () => {
        setSearchInput('');
        setDebouncedSearchTerm('');
        setEntries([]);
        setSegmentGroups([]);
    };

    const handleSpecialCharClick = (char: string) => {
        const input = searchInputRef.current;
        if (!input) {
            setSearchInput(prev => prev + char);
            return;
        }

        const start = input.selectionStart ?? searchInput.length;
        const end = input.selectionEnd ?? searchInput.length;

        // Insert character at cursor position
        const newValue = searchInput.substring(0, start) + char + searchInput.substring(end);
        setSearchInput(newValue);

        // Restore cursor position after the inserted character
        setTimeout(() => {
            const newPosition = start + char.length;
            input.setSelectionRange(newPosition, newPosition);
            input.focus();
        }, 0);
    };

    // Open the EIP for a result-card click. Fetches the full dictionary entry
    // (includes breakdown, exampleSentences, usedIn, expansion — fields the
    // search endpoint may not return) and seeds it as the root entry-tab.
    const handleEntryClick = useCallback(async (entry: DictionaryEntry) => {
        try {
            const res = await fetch(
                `${API_BASE_URL}/api/dictionary/lookup/${encodeURIComponent(entry.word1)}`,
                { headers: { 'Authorization': `Bearer ${token}` }, credentials: 'include' }
            );
            if (!res.ok) return;
            const dictData: DictionaryEntry = await res.json();
            const adapted = dictionaryEntryToVocabEntry(dictData);
            setIsEipOpen(true);
            eip.openForRoot(adapted);
        } catch (err) {
            console.error(`Failed to look up dictionary entry "${entry.word1}":`, err);
        }
    }, [token, eip]);

    const closeEip = useCallback(() => {
        setIsEipOpen(false);
        eip.clear();
    }, [eip]);

    // Snackbar shown after the "+ to library" button in the EIP header is tapped.
    // Message reflects whether the word was newly added or was already in the library.
    const [addToLibSnack, setAddToLibSnack] = useState<string | null>(null);

    const handleAddToLibrary = useCallback(async (entry: VocabEntry) => {
        try {
            const res = await fetch(`${API_BASE_URL}/api/vocabEntries/add-to-library`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                credentials: 'include',
                body: JSON.stringify({ entryKey: entry.entryKey, language: userLanguage }),
            });
            if (!res.ok) {
                setAddToLibSnack('Failed to add to Learn Now');
                return;
            }
            const data: { status: 'added' | 'already-in-library' } = await res.json();
            if (data.status === 'already-in-library') {
                setAddToLibSnack('Already in Learn Now');
            } else {
                setAddToLibSnack('Added to Learn Now');
            }
        } catch (err) {
            console.error('Failed to add to library:', err);
            setAddToLibSnack('Failed to add to Learn Now');
        }
    }, [token]);

    const handlePageChange = (_event: React.ChangeEvent<unknown>, value: number) => {
        setPage(value);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    return (
        // Dictionary is a LEAF PAGE (see docs/LEAF_NODE_PAGES.md): no footer, DOWN
        // back arrow (returns to the Home menu), slides up on enter / down on exit.
        <LeafPage title="Dictionary" onBack={() => navigate("/")}>
            <Box className="dictionary-page__scroll" sx={{ flex: 1, overflowY: 'auto' }}>
        <Container
            className="dictionary-page"
            maxWidth="lg"
            sx={{
                py: 4,
                display: 'flex',
                flexDirection: 'column',
                minHeight: 'calc(100% - 8px)',
            }}
        >
            {/* Header */}
            <Typography
                className="dictionary-page__title"
                variant="h3"
                component="h1"
                gutterBottom
                sx={{
                    mb: 3,
                    fontSize: {
                        xs: 'clamp(2rem, 8vw, 3.5rem)',
                        sm: 'clamp(1.5rem, 5vw, 3rem)',
                    },
                }}
            >
                Dictionary
            </Typography>

            {/* Search Bar and Special Characters - Mobile (below title, in normal flow) */}
            {isMobile && (
                <Box
                    className="dictionary-page__search-bar--mobile"
                    sx={{ mb: 2 }}
                >
                    {/* Row 1: a, e (8 chars) */}
                    <Box className="dictionary-page__special-chars-row" sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 0.5, justifyContent: 'center' }}>
                        {specialChars.slice(0, 8).map((char, idx) => (
                            <Button
                                key={char}
                                className="dictionary-page__special-char-btn"
                                variant="contained"
                                size="small"
                                onClick={() => handleSpecialCharClick(char)}
                                // Extra left margin on the 5th button splits the row's
                                // two vowel groups (4 + 4) with a gap down the middle.
                                sx={{ ...specialCharButtonSx(char), ...(idx === 4 ? { ml: 2 } : {}) }}
                            >
                                {char}
                            </Button>
                        ))}
                    </Box>
                    {/* Row 2: i, o (8 chars) */}
                    <Box className="dictionary-page__special-chars-row" sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 0.5, justifyContent: 'center' }}>
                        {specialChars.slice(8, 16).map((char, idx) => (
                            <Button
                                key={char}
                                className="dictionary-page__special-char-btn"
                                variant="contained"
                                size="small"
                                onClick={() => handleSpecialCharClick(char)}
                                // Extra left margin on the 5th button splits the row's
                                // two vowel groups (4 + 4) with a gap down the middle.
                                sx={{ ...specialCharButtonSx(char), ...(idx === 4 ? { ml: 2 } : {}) }}
                            >
                                {char}
                            </Button>
                        ))}
                    </Box>
                    {/* Row 3: u, ü (8 chars) */}
                    <Box className="dictionary-page__special-chars-row" sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1, justifyContent: 'center' }}>
                        {specialChars.slice(16).map((char, idx) => (
                            <Button
                                key={char}
                                className="dictionary-page__special-char-btn"
                                variant="contained"
                                size="small"
                                onClick={() => handleSpecialCharClick(char)}
                                // Extra left margin on the 5th button splits the row's
                                // two vowel groups (4 + 4) with a gap down the middle.
                                sx={{ ...specialCharButtonSx(char), ...(idx === 4 ? { ml: 2 } : {}) }}
                            >
                                {char}
                            </Button>
                        ))}
                    </Box>
                    <TextField
                        className="dictionary-page__search-input"
                        fullWidth
                        placeholder={`Search ${userLanguage.toUpperCase()} dictionary...`}
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
                    />
                </Box>
            )}

            {/* Search Bar and Special Characters - Desktop */}
            {!isMobile && (
                <Box className="dictionary-page__search-bar--desktop" sx={{ mb: 3, display: 'flex', gap: 2, alignItems: 'flex-start' }}>
                    <TextField
                        className="dictionary-page__search-input"
                        fullWidth
                        placeholder={`Search ${userLanguage.toUpperCase()} dictionary...`}
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
                        sx={{ flex: 1 }}
                    />
                    <Box className="dictionary-page__special-chars--desktop" sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                        {/* Row 1: a, e, i */}
                        <Box className="dictionary-page__special-chars-row" sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                            {specialChars.slice(0, 12).map((char) => (
                                <Button
                                    key={char}
                                    className="dictionary-page__special-char-btn"
                                    variant="contained"
                                    size="small"
                                    onClick={() => handleSpecialCharClick(char)}
                                    sx={specialCharButtonSx(char)}
                                >
                                    {char}
                                </Button>
                            ))}
                        </Box>
                        {/* Row 2: o, u, ü */}
                        <Box className="dictionary-page__special-chars-row" sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                            {specialChars.slice(12).map((char) => (
                                <Button
                                    key={char}
                                    className="dictionary-page__special-char-btn"
                                    variant="contained"
                                    size="small"
                                    onClick={() => handleSpecialCharClick(char)}
                                    sx={specialCharButtonSx(char)}
                                >
                                    {char}
                                </Button>
                            ))}
                        </Box>
                    </Box>
                </Box>
            )}

            {/* Results Info */}
            {debouncedSearchTerm && !loading && (
                <Box className="dictionary-page__results-info" sx={{ mb: 2 }}>
                    {isSegmentMode
                        ? <Chip
                            className="dictionary-page__results-chip--segment"
                            label={`${segmentGroups.length} segment${segmentGroups.length !== 1 ? 's' : ''} · ${segmentGroups.reduce((n, g) => n + g.exactEntries.length + g.prefixEntries.length, 0)} results for "${debouncedSearchTerm}"`}
                            color="secondary"
                            variant="outlined"
                          />
                        : <Chip
                            className="dictionary-page__results-chip--regular"
                            label={`${total} results for "${debouncedSearchTerm}"`}
                            color="primary"
                            variant="outlined"
                          />
                    }
                </Box>
            )}

            {/* Error Message */}
            {error && (
                <Alert className="dictionary-page__error-alert" severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
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
                                    <Divider className="dictionary-page__segment-divider" sx={{ my: 2 }} />
                                )}
                                <Box
                                    className="dictionary-page__segment-exact-grid"
                                    sx={{
                                        display: 'grid',
                                        gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' },
                                        gap: 2,
                                    }}
                                >
                                    {group.exactEntries.map((entry) => (
                                        <DictionaryEntryRow key={entry.id} entry={entry} onClick={handleEntryClick} />
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
                                <Divider className="dictionary-page__starts-with-divider" sx={{ my: 1.5 }}>
                                    <Typography variant="caption" color="text.secondary">
                                        Starts with "{group.segment}"
                                    </Typography>
                                </Divider>
                                <Box
                                    className="dictionary-page__segment-prefix-grid"
                                    sx={{
                                        display: 'grid',
                                        gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' },
                                        gap: 2,
                                    }}
                                >
                                    {group.prefixEntries.map((entry) => (
                                        <DictionaryEntryRow key={entry.id} entry={entry} onClick={handleEntryClick} />
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
                    className="dictionary-page__results-grid"
                    sx={{
                        display: 'grid',
                        gridTemplateColumns: {
                            xs: '1fr',
                            md: 'repeat(auto-fit, minmax(20rem, 1fr))',
                        },
                        gap: 2,
                        mb: 3,
                    }}
                >
                    {entries.map((entry) => (
                        <DictionaryEntryRow
                            key={entry.id}
                            entry={entry}
                            onClick={handleEntryClick}
                        />
                    ))}
                </Box>
            )}

            {/* No Results */}
            {!loading && debouncedSearchTerm && entries.length === 0 && segmentGroups.length === 0 && (
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

            {/* Extra Info popup — opened on result-card tap. Tapping a breakdown
                or used-in row inside the popup adds an entry tab above the
                panel chrome instead of stacking another popup. Scrim tap or
                drag-dismiss closes the popup and clears every tab. */}
            {isEipOpen && eip.activeTab && (
                <Box
                    className="dictionary-page__eip-overlay"
                    sx={{ position: 'fixed', inset: 0, zIndex: 1300 }}
                >
                    <InfoCardPopup
                        currentEntry={eip.activeTab.entry}
                        selectedTab={eip.activeTab.selectedSubTab}
                        onTabChange={eip.setActiveSubTab}
                        breakdownItems={eip.activeTab.breakdownItems}
                        showPinyin={true}
                        isFlipped={true}
                        onClose={closeEip}
                        onBreakdownItemClick={(item) => eip.openForEntryKey(item.character)}
                        onUsedInItemClick={(item) => eip.openForEntryKey(item.entryKey)}
                        onSpeak={tts.enabled ? tts.speak : undefined}
                        onAddToLibrary={handleAddToLibrary}
                        onSpeakSentence={tts.enabled ? tts.speakSentence : undefined}
                        speakingKey={tts.speakingKey}
                        tabStrip={
                            <EipTabStrip
                                tabs={eip.tabs}
                                activeIndex={eip.activeIndex}
                                onSelect={eip.setActive}
                                onCloseActiveTab={() => {
                                    if (eip.closeActiveTab()) closeEip();
                                }}
                                isTabbedMode={eip.isTabbedMode}
                                stripRef={eipStripRef}
                            />
                        }
                    />
                </Box>
            )}
            <TooManyTabsSnackbar signal={eip.overflowSignal} />
            <Snackbar
                className="dictionary-page__add-to-library-snackbar"
                open={addToLibSnack !== null}
                autoHideDuration={2500}
                onClose={() => setAddToLibSnack(null)}
                anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
            >
                <Alert
                    severity={addToLibSnack === 'Failed to add to Learn Now' ? 'error' : 'success'}
                    variant="filled"
                    onClose={() => setAddToLibSnack(null)}
                >
                    {addToLibSnack}
                </Alert>
            </Snackbar>
        </Container>
            </Box>
        </LeafPage>
    );
}

export default DictionaryPage;
