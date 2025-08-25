import { useState, useEffect } from "react";
import {
    Box,
    Typography,
    List,
    ListItem,
    ListItemButton,
    ListItemText,
    Drawer,
    useMediaQuery,
    useTheme,
    Fab,
    CircularProgress,
    Alert,
    Chip,
    Divider,
    TextField,
    Paper,
    FormControlLabel,
    Checkbox,
    IconButton,
    Collapse
} from "@mui/material";
import {
    Article as ArticleIcon,
    Menu as MenuIcon,
    Settings as SettingsIcon,
    ChevronLeft as ChevronLeftIcon,
    ChevronRight as ChevronRightIcon
} from "@mui/icons-material";
import { useAuth } from "../AuthContext";
import { useTheme as useCustomTheme } from "../contexts/ThemeContext";
import { API_BASE_URL } from "../constants";

// Text interface for TypeScript
interface Text {
    id: string;
    title: string;
    description: string;
    content: string;
    createdAt: string;
    characterCount: number;
}

function ReaderPage() {
    const theme = useTheme();
    const customTheme = useCustomTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down("md"));
    const { token } = useAuth();

    // State management
    const [texts, setTexts] = useState<Text[]>([]);
    const [selectedText, setSelectedText] = useState<Text | null>(null);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Reader settings state
    const [autoSelectEnabled, setAutoSelectEnabled] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(true);

    // Handle text change - prevent modifications while maintaining cursor functionality
    const handleTextChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        // Prevent any changes to the text content
        event.preventDefault();
        return false;
    };

    // Handle text selection changes for auto word selection using native browser APIs
    const handleAutoWordSelect = (event: React.SyntheticEvent<HTMLDivElement>) => {
        if (!autoSelectEnabled) return;

        // Find the textarea element within the TextField
        const textarea = event.currentTarget.querySelector('textarea') as HTMLTextAreaElement;
        if (!textarea) return;

        // Get current selection positions
        const cursorStart = textarea.selectionStart;
        const cursorEnd = textarea.selectionEnd;

        // Only auto-select if no text is currently selected (just cursor placement)
        if (cursorStart !== cursorEnd) return;

        const cursorPosition = cursorStart;

        try {
            // Focus the textarea to ensure selection works properly
            textarea.focus();

            // Set cursor position first
            textarea.setSelectionRange(cursorPosition, cursorPosition);

            // Use native browser Selection API for word detection
            const selection = window.getSelection();
            if (!selection) return;

            // Clear any existing selections
            selection.removeAllRanges();

            // Create a range at the cursor position
            const range = document.createRange();

            // For textarea, we need to work with the text content
            // Create a temporary text node to work with Selection API
            const textContent = textarea.value;
            if (!textContent || cursorPosition >= textContent.length) return;

            // Alternative approach: Use the Selection.modify() method
            // This mimics exactly what Ctrl+Right/Ctrl+Shift+Left does

            // First, we need to create a selection at the cursor position
            // Since textarea doesn't work directly with Selection API,
            // we'll use a different approach with textarea's built-in methods

            // Simulate word boundary detection by using the browser's native behavior
            // We'll use the fact that double-clicking selects a word
            const originalStart = textarea.selectionStart;
            const originalEnd = textarea.selectionEnd;

            // Try to find word boundaries by testing character by character
            // But use a smarter approach that leverages browser behavior

            // Move cursor to find word start
            let wordStart = cursorPosition;
            let wordEnd = cursorPosition;

            // Use a more sophisticated approach: simulate Ctrl+Left and Ctrl+Right
            // by checking if we're at word boundaries

            // Find word start by moving left until we hit a word boundary
            for (let i = cursorPosition - 1; i >= 0; i--) {
                textarea.setSelectionRange(i, i);
                // Simulate Ctrl+Right to see if we jump to our original position
                // This is a simplified approach - we'll use character classification
                const char = textContent[i];
                const nextChar = textContent[i + 1];

                // Check if this is a word boundary using Unicode-aware logic
                if (isWordBoundary(char, nextChar)) {
                    wordStart = i + 1;
                    break;
                }
                if (i === 0) {
                    wordStart = 0;
                }
            }

            // Find word end by moving right until we hit a word boundary
            for (let i = cursorPosition; i < textContent.length; i++) {
                const char = textContent[i];
                const nextChar = textContent[i + 1];

                if (isWordBoundary(char, nextChar) || i === textContent.length - 1) {
                    wordEnd = i + 1;
                    break;
                }
            }

            // Select the word if we found valid boundaries
            if (wordStart < wordEnd && wordStart !== wordEnd) {
                textarea.setSelectionRange(wordStart, wordEnd);
            } else {
                // Restore original cursor position if no word found
                textarea.setSelectionRange(originalStart, originalEnd);
            }

        } catch (error) {
            console.error('Native word selection failed:', error);
            // Restore original cursor position on error
            textarea.setSelectionRange(cursorPosition, cursorPosition);
        }
    };

    // Helper function to determine word boundaries using native browser logic
    const isWordBoundary = (char: string, nextChar: string): boolean => {
        if (!char || !nextChar) return true;

        // Use Intl.Segmenter if available (modern browsers)
        if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
            try {
                const segmenter = new (Intl as any).Segmenter('en', { granularity: 'word' });
                const segments = Array.from(segmenter.segment(char + nextChar));
                return segments.length > 1;
            } catch (e) {
                // Fall back to simpler logic
            }
        }

        // Fallback: Use basic character classification
        const isWordChar = (c: string) => /\p{L}|\p{N}/u.test(c);
        const isWhitespace = (c: string) => /\s/u.test(c);
        const isPunctuation = (c: string) => /\p{P}/u.test(c);

        // Boundary conditions
        if (isWhitespace(char) || isWhitespace(nextChar)) return true;
        if (isPunctuation(char) || isPunctuation(nextChar)) return true;
        if (isWordChar(char) !== isWordChar(nextChar)) return true;

        return false;
    };

    // Find previous word: mirror the selectNextWord logic but in reverse direction
    const selectPreviousWord = (textarea: HTMLTextAreaElement) => {
        const text = textarea.value;
        const cursorPos = textarea.selectionStart;

        // Start from cursor position and move backwards
        let pos = cursorPos - 1; // Start one position back from cursor

        // Skip whitespace/punctuation to find the previous word (moving backwards)
        while (pos >= 0) {
            const char = text[pos];
            const nextChar = text[pos + 1];
            if (!isWordBoundary(char, nextChar)) {
                break; // Found a word character
            }
            pos--;
        }

        if (pos < 0) return; // No previous word found

        // Now we're at the end of the previous word, find its start
        let wordStart = pos;
        let wordEnd = pos + 1; // End is one position after the last character

        // Find word start by moving backwards from current position
        for (let i = pos; i >= 0; i--) {
            const char = text[i];
            const prevChar = text[i - 1];
            if (i === 0 || isWordBoundary(prevChar, char)) {
                wordStart = i;
                break;
            }
        }

        // Select the previous word
        textarea.setSelectionRange(wordStart, wordEnd);
    };

    // Reuse existing word boundary logic to find next word
    const selectNextWord = (textarea: HTMLTextAreaElement) => {
        const text = textarea.value;
        const cursorPos = textarea.selectionStart;

        // Cursor default position for a selected text is the end of the selected text
        let pos = cursorPos;

        // Skip whitespace/punctuation to find the next word
        while (pos < text.length) {
            const char = text[pos];
            const nextChar = text[pos + 1];
            if (!isWordBoundary(char, nextChar)) {
                break; // Found a word character
            }
            pos++;
        }

        if (pos >= text.length) return; // No next word found

        // Now find the full word boundaries using existing logic
        let wordStart = pos;
        let wordEnd = pos;

        // Find word end (reusing existing boundary logic)
        for (let i = pos; i < text.length; i++) {
            const char = text[i];
            const nextChar = text[i + 1];
            if (isWordBoundary(char, nextChar) || i === text.length - 1) {
                wordEnd = i + 1;
                break;
            }
        }

        textarea.setSelectionRange(wordStart, wordEnd);
    };

    // Get theme-based selection colors
    const getSelectionColors = () => {
        switch (customTheme.themeMode) {
            case 'dark':
                return {
                    backgroundColor: theme.palette.primary.main + '40', // 25% opacity
                };
            case 'blue':
                return {
                    backgroundColor: theme.palette.primary.main + '30', // ~19% opacity
                };
            case 'green':
                return {
                    backgroundColor: theme.palette.primary.main + '30', // ~19% opacity
                };
            case 'light':
            default:
                return {
                    backgroundColor: theme.palette.primary.main + '30', // ~19% opacity
                };
        }
    };

    const selectionColors = getSelectionColors();

    // Drawer width consistent with main navigation
    const drawerWidth = 250;
    const settingsWidth = 200;

    // Fetch texts from API (with fallback sample data for testing)
    useEffect(() => {
        const fetchTexts = async () => {
            try {
                setLoading(true);
                const response = await fetch(`${API_BASE_URL}/api/texts`, {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                    },
                });

                if (!response.ok) {
                    throw new Error('Failed to fetch texts');
                }

                const textsData = await response.json();
                setTexts(textsData);
            } catch (err) {
                console.error('Error fetching texts:', err);
                // Use sample data for testing when API is not available
                const sampleTexts: Text[] = [
                    {
                        id: '1',
                        title: 'Sample Chinese Text',
                        description: 'A sample text for testing auto word selection',
                        content: '这是一个测试文本。我们可以点击任何地方来选择单词。This is a test text. We can click anywhere to select words. 中文和英文都应该工作正常。',
                        createdAt: new Date().toISOString(),
                        characterCount: 85
                    },
                    {
                        id: '2',
                        title: 'English Sample Text',
                        description: 'English text for testing word boundaries',
                        content: 'Hello world! This is an English text sample. Click anywhere in this text to test the auto word selection feature. It should work with punctuation, numbers like 123, and various word types.',
                        createdAt: new Date().toISOString(),
                        characterCount: 180
                    }
                ];
                setTexts(sampleTexts);
                setError(null);
            } finally {
                setLoading(false);
            }
        };

        if (token) {
            fetchTexts();
        }
    }, [token]);

    // Handle text selection
    const handleTextSelect = (text: Text) => {
        setSelectedText(text);
        if (isMobile) {
            setDrawerOpen(false);
        }
    };

    // Format date for display
    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    };

    // Sidebar content component
    const SidebarContent = () => (
        <Box sx={{ width: drawerWidth, height: '100%', display: 'flex', flexDirection: 'column' }}>
            {/* Header */}
            <Box sx={{ p: 2, borderBottom: '1px solid rgba(0, 0, 0, 0.08)' }}>
                <Typography variant="h6" sx={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1 }}>
                    <ArticleIcon />
                    Reading Materials
                </Typography>
                <Typography variant="body2" color="text.secondary">
                    Select a text to begin reading
                </Typography>
            </Box>

            {/* Loading state */}
            {loading && (
                <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
                    <CircularProgress size={24} />
                </Box>
            )}

            {/* Error state */}
            {error && (
                <Box sx={{ p: 2 }}>
                    <Alert severity="error">
                        {error}
                    </Alert>
                </Box>
            )}

            {/* Texts list */}
            {!loading && !error && (
                <List sx={{ flexGrow: 1, overflow: 'auto', p: 1 }}>
                    {texts.map((text) => (
                        <ListItem key={text.id} disablePadding sx={{ mb: 1 }}>
                            <ListItemButton
                                onClick={() => handleTextSelect(text)}
                                selected={selectedText?.id === text.id}
                                sx={{
                                    borderRadius: 2,
                                    flexDirection: 'column',
                                    alignItems: 'flex-start',
                                    p: 2,
                                    '&.Mui-selected': {
                                        backgroundColor: 'primary.main',
                                        color: 'white',
                                        '&:hover': {
                                            backgroundColor: 'primary.dark',
                                        },
                                    },
                                    '&:hover': {
                                        backgroundColor: 'action.hover',
                                    },
                                }}
                            >
                                <Typography
                                    variant="subtitle2"
                                    sx={{
                                        fontWeight: 'bold',
                                        mb: 0.5,
                                        color: selectedText?.id === text.id ? 'white' : 'text.primary'
                                    }}
                                >
                                    {text.title}
                                </Typography>
                                <Typography
                                    variant="body2"
                                    sx={{
                                        mb: 1,
                                        color: selectedText?.id === text.id ? 'rgba(255,255,255,0.8)' : 'text.secondary',
                                        fontSize: '0.875rem'
                                    }}
                                >
                                    {text.description}
                                </Typography>
                                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                                    <Chip
                                        label={`${text.characterCount} chars`}
                                        size="small"
                                        variant={selectedText?.id === text.id ? "filled" : "outlined"}
                                        sx={{
                                            fontSize: '0.75rem',
                                            height: 20,
                                            color: selectedText?.id === text.id ? 'white' : 'text.secondary',
                                            borderColor: selectedText?.id === text.id ? 'rgba(255,255,255,0.5)' : undefined,
                                            backgroundColor: selectedText?.id === text.id ? 'rgba(255,255,255,0.2)' : undefined
                                        }}
                                    />
                                    <Typography
                                        variant="caption"
                                        sx={{
                                            color: selectedText?.id === text.id ? 'rgba(255,255,255,0.7)' : 'text.secondary'
                                        }}
                                    >
                                        {formatDate(text.createdAt)}
                                    </Typography>
                                </Box>
                            </ListItemButton>
                        </ListItem>
                    ))}
                </List>
            )}
        </Box>
    );

    // Main content component
    const MainContent = () => (
        <Box sx={{
            flexGrow: 1,
            p: { xs: 2, sm: 3 },
            pt: { xs: 1, sm: 2 },
            display: 'flex',
            flexDirection: 'column',
            minHeight: '100vh'
        }}>
            {selectedText ? (
                <>
                    {/* Text header */}
                    <Box sx={{ mb: 3, pb: 2, borderBottom: '1px solid rgba(0, 0, 0, 0.08)' }}>
                        <Typography variant="h4" component="h1" sx={{ mb: 1, fontWeight: 'bold' }}>
                            {selectedText.title}
                        </Typography>
                        <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
                            {selectedText.description}
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                            <Chip
                                label={`${selectedText.characterCount} chars`}
                                size="small"
                                color="primary"
                                variant="outlined"
                            />
                            <Typography variant="body2" color="text.secondary">
                                {formatDate(selectedText.createdAt)}
                            </Typography>
                        </Box>
                    </Box>

                    {/* Text content area with settings sidebar */}
                    <Box sx={{ flexGrow: 1, display: 'flex', gap: 3 }}>
                        {/* Text content - Editable text field with cursor functionality */}
                        <Box sx={{ flexGrow: 1 }}>
                            <TextField
                                multiline
                                fullWidth
                                value={selectedText.content}
                                onChange={handleTextChange}
                                onSelect={handleAutoWordSelect}
                                onKeyDown={(e) => {
                                    // Handle directional word selection when auto-select is enabled
                                    if (autoSelectEnabled && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
                                        // Use e.target directly as it should be the textarea element
                                        const textarea = e.target as HTMLTextAreaElement;
                                        if (!textarea || textarea.tagName !== 'TEXTAREA') {
                                            return;
                                        }

                                        // Only handle if no text is currently selected
                                        if (textarea.selectionStart === textarea.selectionEnd) {
                                            e.preventDefault(); // Prevent default arrow behavior

                                            if (e.key === 'ArrowLeft') {
                                                selectPreviousWord(textarea);
                                            } else if (e.key === 'ArrowRight') {
                                                selectNextWord(textarea);
                                            }
                                            return;
                                        }
                                    }

                                    // Allow navigation keys but prevent text modification
                                    const allowedKeys = [
                                        'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
                                        'Home', 'End', 'PageUp', 'PageDown',
                                        'Tab', 'Escape'
                                    ];

                                    // Allow Ctrl+A (select all), Ctrl+C (copy)
                                    if (e.ctrlKey && (e.key === 'a' || e.key === 'c' || e.key === 'A' || e.key === 'C')) {
                                        return;
                                    }

                                    // Prevent all other key inputs except navigation
                                    if (!allowedKeys.includes(e.key)) {
                                        e.preventDefault();
                                    }
                                }}
                                variant="outlined"
                                InputProps={{
                                    sx: {
                                        lineHeight: 2,
                                        fontSize: '1.1rem',
                                        fontFamily: '"Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
                                        letterSpacing: '0.02em',
                                        padding: 2,
                                        cursor: 'text',
                                        '& .MuiInputBase-input': {
                                            lineHeight: 2,
                                            fontSize: '1.1rem',
                                            fontFamily: '"Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
                                            letterSpacing: '0.02em',
                                            cursor: 'text',
                                            userSelect: 'text',
                                            // Custom text selection styling based on theme
                                            '&::selection': {
                                                backgroundColor: selectionColors.backgroundColor,
                                            },
                                            '&::-moz-selection': {
                                                backgroundColor: selectionColors.backgroundColor,
                                            }
                                        }
                                    }
                                }}
                                sx={{
                                    '& .MuiOutlinedInput-root': {
                                        '& fieldset': {
                                            borderColor: 'rgba(0, 0, 0, 0.12)',
                                        },
                                        '&:hover fieldset': {
                                            borderColor: 'rgba(0, 0, 0, 0.23)',
                                        },
                                        '&.Mui-focused fieldset': {
                                            borderColor: 'primary.main',
                                        },
                                    },
                                    minHeight: '400px'
                                }}
                                rows={20}
                                placeholder="Select a text to begin reading..."
                            />
                        </Box>

                        {/* Inline settings sidebar (desktop only) */}
                        {!isMobile && settingsOpen && (
                            <Box sx={{
                                width: settingsWidth,
                                flexShrink: 0,
                                pt: 1
                            }}>
                                {/* Header */}
                                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
                                    <Box>
                                        <Typography variant="h6" sx={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary' }}>
                                            <SettingsIcon fontSize="small" />
                                            Settings
                                        </Typography>
                                    </Box>
                                    <IconButton
                                        onClick={() => setSettingsOpen(false)}
                                        size="small"
                                        sx={{ color: 'text.secondary' }}
                                    >
                                        <ChevronRightIcon />
                                    </IconButton>
                                </Box>

                                {/* Settings content */}
                                <Box>
                                    <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 'medium', color: 'text.primary' }}>
                                        Text Selection
                                    </Typography>

                                    <FormControlLabel
                                        control={
                                            <Checkbox
                                                checked={autoSelectEnabled}
                                                onChange={(e) => setAutoSelectEnabled(e.target.checked)}
                                                size="small"
                                                color="primary"
                                            />
                                        }
                                        label={
                                            <Box>
                                                <Typography variant="body2" sx={{ fontWeight: 'medium' }}>
                                                    Auto-select words
                                                </Typography>
                                                <Typography variant="caption" color="text.secondary">
                                                    Automatically select words when clicking in text
                                                </Typography>
                                            </Box>
                                        }
                                        sx={{
                                            alignItems: 'flex-start',
                                            mb: 3,
                                            ml: 0,
                                            '& .MuiFormControlLabel-label': {
                                                ml: 1
                                            }
                                        }}
                                    />

                                    <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic', opacity: 0.7 }}>
                                        More settings will be added here in future updates.
                                    </Typography>
                                </Box>
                            </Box>
                        )}
                    </Box>
                </>
            ) : (
                // Default state when no text is selected
                <Box sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '60vh',
                    textAlign: 'center'
                }}>
                    <ArticleIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
                    <Typography variant="h5" color="text.secondary" sx={{ mb: 1 }}>
                        Select a text to begin reading
                    </Typography>
                    <Typography variant="body1" color="text.secondary">
                        Choose an article from the sidebar to start reading
                    </Typography>
                    {isMobile && (
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                            Tap the button in the bottom right to view the text list
                        </Typography>
                    )}
                </Box>
            )}
        </Box>
    );

    return (
        <Box sx={{ display: 'flex', width: '100%', minHeight: 'calc(100vh - 200px)', mt: -2 }}>
            {/* Desktop sidebar */}
            {!isMobile && (
                <Box sx={{
                    width: drawerWidth,
                    flexShrink: 0,
                    borderRight: '1px solid rgba(0, 0, 0, 0.08)',
                    height: 'fit-content',
                    minHeight: 'calc(100vh - 200px)'
                }}>
                    <SidebarContent />
                </Box>
            )}

            {/* Mobile drawer */}
            {isMobile && (
                <Drawer
                    variant="temporary"
                    open={drawerOpen}
                    onClose={() => setDrawerOpen(false)}
                    ModalProps={{
                        keepMounted: true,
                    }}
                    sx={{
                        [`& .MuiDrawer-paper`]: {
                            width: drawerWidth,
                            boxSizing: 'border-box',
                        },
                    }}
                >
                    <SidebarContent />
                </Drawer>
            )}

            {/* Main content */}
            <Box sx={{
                flexGrow: 1,
                minWidth: 0,
                width: isMobile ? '100%' : `calc(100% - ${drawerWidth}px)`
            }}>
                <MainContent />
            </Box>

            {/* Settings toggle button (when sidebar is closed) */}
            {!isMobile && !settingsOpen && (
                <Box sx={{
                    position: 'fixed',
                    right: 16,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    zIndex: 1000
                }}>
                    <IconButton
                        onClick={() => setSettingsOpen(true)}
                        sx={{
                            backgroundColor: 'primary.main',
                            color: 'white',
                            boxShadow: 3,
                            '&:hover': {
                                backgroundColor: 'primary.dark',
                            }
                        }}
                    >
                        <SettingsIcon />
                    </IconButton>
                </Box>
            )}

            {/* Mobile FAB */}
            {isMobile && (
                <Fab
                    color="primary"
                    aria-label="open text selection"
                    onClick={() => setDrawerOpen(true)}
                    sx={{
                        position: 'fixed',
                        bottom: 80,
                        right: 16,
                        zIndex: 1000
                    }}
                >
                    <MenuIcon />
                </Fab>
            )}
        </Box>
    );
}

export default ReaderPage;
