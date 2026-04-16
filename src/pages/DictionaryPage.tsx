import { useState, useEffect, useRef } from 'react';
import {
    Container,
    Typography,
    Box,
    TextField,
    InputAdornment,
    IconButton,
    Button,
    CircularProgress,
    Alert,
    Pagination,
    useMediaQuery,
    useTheme,
    Chip,
    Divider,
} from '@mui/material';
import { Search, Clear } from '@mui/icons-material';
import { useAuth } from '../AuthContext';
import { API_BASE_URL } from '../constants';
import type { DictionaryEntry, Language } from '../types';
import DictionaryEntryRow from '../components/DictionaryEntryRow';
import DictionaryEntryDetailModal from '../components/DictionaryEntryDetailModal';
import { usePageTitle } from '../hooks/usePageTitle';

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
    ja: ['あ', 'か', 'さ'],
    ko: ['ㄱ', 'ㄴ', 'ㄷ'],
    vi: ['à', 'á', 'ả'],
};

function DictionaryPage() {
    usePageTitle("Dictionary");
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));
    const { token, user } = useAuth();

    const [searchInput, setSearchInput] = useState('');
    const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
    // Regular search results (paginated)
    const [entries, setEntries] = useState<DictionaryEntry[]>([]);
    // Segment search results (grouped by segment, ordered by length)
    const [segmentGroups, setSegmentGroups] = useState<SegmentGroup[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedEntry, setSelectedEntry] = useState<DictionaryEntry | null>(null);
    const [modalOpen, setModalOpen] = useState(false);

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

    const handleEntryClick = (entry: DictionaryEntry) => {
        setSelectedEntry(entry);
        setModalOpen(true);
    };

    const handleModalClose = () => {
        setModalOpen(false);
        setSelectedEntry(null);
    };

    const handlePageChange = (_event: React.ChangeEvent<unknown>, value: number) => {
        setPage(value);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    return (
        <Container
            className="dictionary-page"
            maxWidth="lg"
            sx={{
                py: 4,
                display: 'flex',
                flexDirection: 'column',
                minHeight: 'calc(100vh - 200px)',
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
                        {specialChars.slice(0, 8).map((char) => (
                            <Button
                                key={char}
                                className="dictionary-page__special-char-btn"
                                variant="contained"
                                size="small"
                                onClick={() => handleSpecialCharClick(char)}
                                sx={{
                                    minWidth: '40px',
                                    fontFamily: 'inherit',
                                    textTransform: 'lowercase',
                                    backgroundColor: getVowelColor(char),
                                    color: '#000000',
                                    '&:hover': {
                                        backgroundColor: getVowelColor(char),
                                        filter: 'brightness(0.9)',
                                    },
                                }}
                            >
                                {char}
                            </Button>
                        ))}
                    </Box>
                    {/* Row 2: i, o (8 chars) */}
                    <Box className="dictionary-page__special-chars-row" sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 0.5, justifyContent: 'center' }}>
                        {specialChars.slice(8, 16).map((char) => (
                            <Button
                                key={char}
                                className="dictionary-page__special-char-btn"
                                variant="contained"
                                size="small"
                                onClick={() => handleSpecialCharClick(char)}
                                sx={{
                                    minWidth: '40px',
                                    fontFamily: 'inherit',
                                    textTransform: 'lowercase',
                                    backgroundColor: getVowelColor(char),
                                    color: '#000000',
                                    '&:hover': {
                                        backgroundColor: getVowelColor(char),
                                        filter: 'brightness(0.9)',
                                    },
                                }}
                            >
                                {char}
                            </Button>
                        ))}
                    </Box>
                    {/* Row 3: u, ü (8 chars) */}
                    <Box className="dictionary-page__special-chars-row" sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1, justifyContent: 'center' }}>
                        {specialChars.slice(16).map((char) => (
                            <Button
                                key={char}
                                className="dictionary-page__special-char-btn"
                                variant="contained"
                                size="small"
                                onClick={() => handleSpecialCharClick(char)}
                                sx={{
                                    minWidth: '40px',
                                    fontFamily: 'inherit',
                                    textTransform: 'lowercase',
                                    backgroundColor: getVowelColor(char),
                                    color: '#000000',
                                    '&:hover': {
                                        backgroundColor: getVowelColor(char),
                                        filter: 'brightness(0.9)',
                                    },
                                }}
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
                                    sx={{
                                        minWidth: '40px',
                                        fontFamily: 'inherit',
                                        textTransform: 'lowercase',
                                        backgroundColor: getVowelColor(char),
                                        color: '#000000',
                                        '&:hover': {
                                            backgroundColor: getVowelColor(char),
                                            filter: 'brightness(0.9)',
                                        },
                                    }}
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
                                    sx={{
                                        minWidth: '40px',
                                        fontFamily: 'inherit',
                                        textTransform: 'lowercase',
                                        backgroundColor: getVowelColor(char),
                                        color: '#000000',
                                        '&:hover': {
                                            backgroundColor: getVowelColor(char),
                                            filter: 'brightness(0.9)',
                                        },
                                    }}
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
                    <CircularProgress />
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

            {/* Detail Modal */}
            <DictionaryEntryDetailModal
                entry={selectedEntry}
                open={modalOpen}
                onClose={handleModalClose}
            />
        </Container>
    );
}

export default DictionaryPage;
