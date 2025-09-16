import { useState, useEffect, memo } from "react";
import { useAuth } from "../AuthContext";
import { FLASHCARD_CONTENT_UPDATE_DELAY } from "../constants";
import {
    Container,
    Typography,
    Box,
    Card,
    CardContent,
    Button,
    CircularProgress,
    Alert,
    Chip,
    List,
    ListItem,
    Drawer,
    useMediaQuery,
    useTheme,
    Fab,
} from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import HistoryIcon from "@mui/icons-material/History";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import SkipNextIcon from "@mui/icons-material/SkipNext";
import MenuIcon from "@mui/icons-material/Menu";
import RemoveIcon from "@mui/icons-material/Remove";
import FlashCard from "../components/FlashCard";

// HSK Level type
type HskLevel = 'HSK1' | 'HSK2' | 'HSK3' | 'HSK4' | 'HSK5' | 'HSK6';

interface VocabEntry {
    id: number;
    entryKey: string;
    entryValue: string;
    isCustomTag?: boolean | null;
    hskLevelTag?: HskLevel | null;
    createdAt: string;
}

interface HistoryEntry {
    id: number;
    entryKey: string;
    entryValue: string;
    isCorrect: boolean | null; // null for skipped cards
    timestamp: Date;
    isCustomTag?: boolean | null;
    hskLevelTag?: HskLevel | null;
    wasFlipped: boolean; // Track whether the card was flipped when last seen
}

// Helper function to get HSK level number
const getHskNumber = (hskLevel: HskLevel) => {
    switch (hskLevel) {
        case 'HSK1': return '1';
        case 'HSK2': return '2';
        case 'HSK3': return '3';
        case 'HSK4': return '4';
        case 'HSK5': return '5';
        case 'HSK6': return '6';
        default: return '1'; // Default fallback
    }
};

// Main content component - moved outside to prevent re-creation on every render
interface MainContentProps {
    currentEntry: VocabEntry | null;
    displayEntry: VocabEntry | null;
    isFlipped: boolean;
    handleFlip: () => void;
    entryKey: string;
    entryValue: string;
    handlePreviousCard: () => void;
    handleIncorrect: () => void;
    handleCorrect: () => void;
    handleNextCard: () => void;
    history: HistoryEntry[];
    historyIndex: number;
}

const MainContent = memo<MainContentProps>(({
    currentEntry,
    displayEntry,
    isFlipped,
    handleFlip,
    entryKey,
    entryValue,
    handlePreviousCard,
    handleIncorrect,
    handleCorrect,
    handleNextCard,
    history,
    historyIndex
}) => (
    <Box
        className="flashcards-main-content"
        sx={{
            flexGrow: 1,
            p: { xs: 2, sm: 3 },
            pt: { xs: 1, sm: 2 },
            display: 'flex',
            flexDirection: 'column',
            minHeight: '100vh'
        }}
    >
        {/* Title */}
        <Typography
            variant="h3"
            component="h1"
            align="center"
            gutterBottom
            sx={{ mb: 4 }}
        >
            Flashcards
        </Typography>

        {/* Flashcard */}
        <Box
            className="flashcard-section"
            sx={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                mb: 4,
                width: '100%',
            }}
        >
            {currentEntry && (
                <Box
                    className="flashcard-outer-wrapper"
                    sx={{
                        width: "100%",
                        maxWidth: 500,
                        height: 300,
                        display: "flex",
                        justifyContent: "center",
                        alignItems: "center",
                    }}
                >
                    <FlashCard
                        entry={currentEntry}
                        displayEntry={displayEntry || currentEntry}
                        isFlipped={isFlipped}
                        onFlip={handleFlip}
                        entryKey={entryKey}
                        entryValue={entryValue}
                    />
                </Box>
            )}
        </Box>

        {/* Navigation Buttons */}
        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, width: '100%' }}>
            {/* Previous Card Button */}
            <Button
                variant="outlined"
                startIcon={<ArrowBackIcon />}
                onClick={handlePreviousCard}
                disabled={history.length === 0 || historyIndex >= history.length - 1}
                size="medium"
            >
                Previous Card
            </Button>

            {/* Correct/Incorrect Buttons */}
            <Box sx={{ display: "flex", gap: 2, justifyContent: "center", alignItems: "center" }}>
                <Button
                    variant="contained"
                    color="error"
                    startIcon={<CloseIcon />}
                    onClick={handleIncorrect}
                    size="large"
                >
                    Incorrect
                </Button>
                <Button
                    variant="contained"
                    color="success"
                    startIcon={<CheckIcon />}
                    onClick={handleCorrect}
                    size="large"
                >
                    Correct
                </Button>
            </Box>

            {/* Next Card / Skip Card Button */}
            <Button
                variant="outlined"
                startIcon={historyIndex === 0 ? <SkipNextIcon /> : <ArrowForwardIcon />}
                onClick={handleNextCard}
                size="medium"
            >
                {historyIndex === 0 ? "Skip Card" : "Next Card"}
            </Button>
        </Box>
    </Box>
));

MainContent.displayName = 'MainContent';

function FlashcardsPage() {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down("md"));
    const [entries, setEntries] = useState<VocabEntry[]>([]);
    const [currentEntry, setCurrentEntry] = useState<VocabEntry | null>(null);
    const [displayEntry, setDisplayEntry] = useState<VocabEntry | null>(null);
    const [entryKey, setentryKey] = useState<string>("");
    const [entryValue, setentryValue] = useState<string>("");
    const [isFlipped, setIsFlipped] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [errorCode, setErrorCode] = useState<string | null>(null);
    const [history, setHistory] = useState<HistoryEntry[]>([]);
    const [completedCardsCount, setCompletedCardsCount] = useState(0);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [historyIndex, setHistoryIndex] = useState(0); // 0 means current card, 1+ means older cards in history
    const { token } = useAuth();

    // Drawer width consistent with main navigation
    const drawerWidth = 250;

    useEffect(() => {
        fetchEntries();
    }, [token]);

    useEffect(() => {
        if (entries.length > 0 && !currentEntry) {
            getRandomEntry();
        }
    }, [entries]);

    // Centralized delayed update function
    const updateCardContent = (entry: VocabEntry, immediate = false) => {
        // Update front content immediately
        setentryKey(entry.entryKey);
        setCurrentEntry(entry);

        if (immediate) {
            // For initial load, update everything immediately
            setDisplayEntry(entry);
            setentryValue(entry.entryValue);
        } else {
            // For transitions, delay the back face content update
            setTimeout(() => {
                setDisplayEntry(entry);
                setentryValue(entry.entryValue);
            }, FLASHCARD_CONTENT_UPDATE_DELAY);
        }
    };

    // Initialize front and back content when first entry is loaded
    useEffect(() => {
        if (currentEntry && entryKey === "" && entryValue === "") {
            updateCardContent(currentEntry, true); // Immediate update for initial load
        }
    }, [currentEntry, entryKey, entryValue]);

    // Keyboard navigation
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            // Prevent default behavior for arrow keys to avoid page scrolling
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
                event.preventDefault();
            }

            // Check for right control key using location property
            if (event.key === 'Control' && event.location === KeyboardEvent.DOM_KEY_LOCATION_RIGHT) {
                event.preventDefault();
                handleFlip();
                return;
            }

            switch (event.key) {
                case 'ArrowUp':
                    // Up arrow triggers Previous Card button
                    if (history.length > 0 && historyIndex < history.length - 1) {
                        handlePreviousCard();
                    }
                    break;
                case 'ArrowDown':
                    // Down arrow triggers Next Card / Skip Card button
                    handleNextCard();
                    break;
                case 'ArrowLeft':
                    // Left arrow triggers left button (Incorrect)
                    handleIncorrect();
                    break;
                case 'ArrowRight':
                    // Right arrow triggers right button (Correct)
                    handleCorrect();
                    break;
            }
        };

        // Add event listener
        window.addEventListener('keydown', handleKeyDown);

        // Cleanup event listener on component unmount
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [history.length, historyIndex, isFlipped, currentEntry]); // Dependencies for the handlers

    const fetchEntries = async () => {
        try {
            setLoading(true);
            const response = await fetch("http://localhost:5000/api/vocabEntries", {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw {
                    message: errorData.error || "Failed to fetch vocabulary entries",
                    code: errorData.code || "ERR_FETCH_FAILED",
                };
            }

            const result = await response.json();
            setEntries(Array.isArray(result) ? result : [result]);
            setLoading(false);
        } catch (err: any) {
            const errorMessage = err.message || "Failed to fetch vocabulary entries";
            const errorCode = err.code || "ERR_UNKNOWN";
            setError(errorMessage);
            setErrorCode(errorCode);
            setLoading(false);
            console.error(err);
        }
    };

    const getRandomEntry = () => {
        if (entries.length === 0) return;

        // Reset history index when getting a new random card (current card is always index 0)
        setHistoryIndex(0);

        // Get a random entry that's different from the current one if possible
        let randomIndex;
        if (entries.length === 1) {
            randomIndex = 0;
        } else {
            let newIndex;
            do {
                newIndex = Math.floor(Math.random() * entries.length);
            } while (
                currentEntry &&
                entries[newIndex].id === currentEntry.id &&
                entries.length > 1
            );
            randomIndex = newIndex;
        }

        const newEntry = entries[randomIndex];

        // If the card is flipped, flip it back
        if (isFlipped) {
            setIsFlipped(false);
        }

        // Use centralized update function with delay for transitions
        updateCardContent(newEntry, false);

        // Add the new card to history immediately with null status (pending)
        addToHistory(newEntry, null);
    };

    const handlePreviousCard = () => {
        if (history.length === 0) return;

        const newIndex = historyIndex + 1;
        if (newIndex >= history.length) return; // Can't go further back

        setHistoryIndex(newIndex);
        const historyEntry = history[newIndex];

        // Convert history entry back to vocab entry format
        const vocabEntry: VocabEntry = {
            id: historyEntry.id,
            entryKey: historyEntry.entryKey,
            entryValue: historyEntry.entryValue,
            isCustomTag: historyEntry.isCustomTag,
            hskLevelTag: historyEntry.hskLevelTag,
            createdAt: '' // Not needed for display
        };

        // Restore the flip state from history
        setIsFlipped(historyEntry.wasFlipped);

        // Use centralized update function with delay for transitions
        updateCardContent(vocabEntry, false);
    };

    const handleNextCard = () => {
        if (historyIndex === 0) {
            // We're at the current card, so this becomes "Skip Card"
            if (currentEntry) {
                // Update the current entry in history with null status (skipped)
                addToHistory(currentEntry, null);
                console.log('Card skipped and updated in history');
            }
            getRandomEntry(); // Get a new random card
        } else {
            // We're in history, step forward (toward more recent)
            const newIndex = historyIndex - 1;
            if (newIndex < 0) return; // Can't go further forward

            setHistoryIndex(newIndex);
            const historyEntry = history[newIndex];

            // Convert history entry back to vocab entry format
            const vocabEntry: VocabEntry = {
                id: historyEntry.id,
                entryKey: historyEntry.entryKey,
                entryValue: historyEntry.entryValue,
                isCustomTag: historyEntry.isCustomTag,
                hskLevelTag: historyEntry.hskLevelTag,
                createdAt: '' // Not needed for display
            };

            // Restore the flip state from history
            setIsFlipped(historyEntry.wasFlipped);

            // Use centralized update function with delay for transitions
            updateCardContent(vocabEntry, false);
        }
    };

    const addToHistory = (entry: VocabEntry, isCorrect: boolean | null) => {
        const historyEntry: HistoryEntry = {
            id: entry.id,
            entryKey: entry.entryKey,
            entryValue: entry.entryValue,
            isCorrect,
            timestamp: new Date(),
            isCustomTag: entry.isCustomTag,
            hskLevelTag: entry.hskLevelTag,
            wasFlipped: isFlipped // Track the current flip state
        };

        // Calculate if we should increment counter BEFORE state updates
        let shouldIncrementCounter = false;

        if (historyIndex === 0) {
            // We're at the current card (index 0)
            if (history.length > 0 && history[0].id === entry.id) {
                // Update the existing entry at index 0
                const oldEntry = history[0];

                // Check if this is a transition from unmarked (null) to marked (true/false)
                if (oldEntry.isCorrect === null && isCorrect !== null) {
                    shouldIncrementCounter = true;
                    console.log('Counter increment: null -> marked for existing entry');
                }
            }
            // Don't increment for new entries
        } else {
            // We're viewing an older card, update the specific entry
            const oldEntry = history[historyIndex];

            // Check if this is a transition from unmarked (null) to marked (true/false)
            if (oldEntry.isCorrect === null && isCorrect !== null) {
                shouldIncrementCounter = true;
                console.log('Counter increment: null -> marked for historical entry');
            }
        }

        // Update history
        setHistory(prev => {
            const newHistory = [...prev];

            if (historyIndex === 0) {
                // We're at the current card (index 0)
                if (newHistory.length > 0 && newHistory[0].id === entry.id) {
                    // Update the existing entry at index 0
                    newHistory[0] = historyEntry;
                } else {
                    // Add new entry to the front and shift others back
                    newHistory.unshift(historyEntry);
                    console.log('New entry added, no counter increment');

                    // Maintain max size of 6
                    if (newHistory.length > 6) {
                        newHistory.pop();
                    }
                }
            } else {
                // We're viewing an older card, update the specific entry
                newHistory[historyIndex] = historyEntry;
            }

            return newHistory;
        });

        // Update counter separately to avoid race conditions
        if (shouldIncrementCounter) {
            setCompletedCardsCount(prev => {
                console.log('Incrementing counter from', prev, 'to', prev + 1);
                return prev + 1;
            });
        }
    };

    const handleFlip = () => {
        setIsFlipped(!isFlipped);
    };

    const handleCorrect = () => {
        // If card is showing front (not flipped), flip it first
        if (!isFlipped) {
            setIsFlipped(true);
            return;
        }

        // Card is showing back, now mark as correct
        if (currentEntry) {
            // Add the current entry to history with correct status
            addToHistory(currentEntry, true);
            console.log('Flashcard marked as CORRECT');
        }

        // Only get a new random card if we're at the current card (index 0)
        if (historyIndex === 0) {
            getRandomEntry(); // Automatically show next card
        }
        // If we're viewing a historical card, just stay there after updating
    };

    const handleIncorrect = () => {
        // If card is showing front (not flipped), flip it first
        if (!isFlipped) {
            setIsFlipped(true);
            return;
        }

        // Card is showing back, now mark as incorrect
        if (currentEntry) {
            // Add the current entry to history with incorrect status
            addToHistory(currentEntry, false);
            console.log('Flashcard marked as INCORRECT');
        }

        // Only get a new random card if we're at the current card (index 0)
        if (historyIndex === 0) {
            getRandomEntry(); // Automatically show next card
        }
        // If we're viewing a historical card, just stay there after updating
    };

    const handleHistoryCardClick = (displayIndex: number) => {
        // Calculate the actual index in the history array (since display is reversed)
        const actualIndex = history.length - 1 - displayIndex;

        if (actualIndex === historyIndex) {
            // Already viewing this card, no need to navigate
            return;
        }

        setHistoryIndex(actualIndex);
        const historyEntry = history[actualIndex];

        // Convert history entry back to vocab entry format
        const vocabEntry: VocabEntry = {
            id: historyEntry.id,
            entryKey: historyEntry.entryKey,
            entryValue: historyEntry.entryValue,
            isCustomTag: historyEntry.isCustomTag,
            hskLevelTag: historyEntry.hskLevelTag,
            createdAt: '' // Not needed for display
        };

        // Restore the flip state from history
        setIsFlipped(historyEntry.wasFlipped);

        // Use centralized update function with delay for transitions
        updateCardContent(vocabEntry, false);
    };

    if (loading) {
        return (
            <Container
                maxWidth="lg"
                sx={{
                    py: 4,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: 'calc(100vh - 100px)', // Adjust for any headers/footers
                }}
            >
                <Typography variant="h3" component="h1" align="center" gutterBottom sx={{ mb: 4 }}>
                    Flashcards
                </Typography>
                <Box display="flex" justifyContent="center" alignItems="center" minHeight="300px">
                    <CircularProgress />
                </Box>
            </Container>
        );
    }

    if (error) {
        return (
            <Container maxWidth="lg" sx={{ py: 4 }}>
                <Typography variant="h3" component="h1" align="center" gutterBottom sx={{ mb: 4 }}>
                    Flashcards
                </Typography>
                <Alert severity="error">
                    Error: {error} {errorCode && <span>[Error Code: {errorCode}]</span>}
                </Alert>
            </Container>
        );
    }

    if (entries.length === 0) {
        return (
            <Container maxWidth="lg" sx={{ py: 4 }}>
                <Typography variant="h3" component="h1" align="center" gutterBottom sx={{ mb: 4 }}>
                    Flashcards
                </Typography>
                <Alert severity="info">No vocabulary entries available</Alert>
            </Container>
        );
    }

    // Sidebar content component
    const SidebarContent = () => (
        <Box sx={{ width: drawerWidth, height: '100%', display: 'flex', flexDirection: 'column' }}>
            {/* Header */}
            <Box sx={{ p: 2, borderBottom: '1px solid rgba(0, 0, 0, 0.08)' }}>
                <Typography variant="h6" sx={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1 }}>
                    <HistoryIcon />
                    Study History
                </Typography>
                <Typography variant="body2" color="text.secondary">
                    {completedCardsCount} cards completed
                </Typography>
            </Box>

            {/* History list */}
            <Box sx={{ flexGrow: 1, overflow: 'auto', p: 1 }}>
                {history.length === 0 ? (
                    <Box sx={{ p: 2 }}>
                        <Alert severity="info">
                            No cards completed yet. Start practicing to see your history!
                        </Alert>
                    </Box>
                ) : (
                    <List sx={{ width: '100%' }}>
                        {history.slice().reverse().map((entry, index) => {
                            // Calculate the actual index in the original history array
                            const actualIndex = history.length - 1 - index;
                            const isCurrentCard = historyIndex === actualIndex;

                            return (
                                <ListItem key={`${entry.id}-${entry.timestamp.getTime()}`} sx={{ mb: 1, p: 0 }}>
                                    <Card
                                        onClick={() => handleHistoryCardClick(index)}
                                        sx={{
                                            width: '100%',
                                            border: isCurrentCard ? '2px solid' : '1px solid transparent',
                                            borderColor: isCurrentCard ? 'primary.main' : 'transparent',
                                            cursor: 'pointer',
                                            transition: 'all 0.2s ease-in-out',
                                            '&:hover': {
                                                backgroundColor: 'action.hover',
                                                // transform: 'translateY(-1px)',
                                                boxShadow: 2,
                                            }
                                        }}
                                    >
                                        <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                                                {entry.isCorrect === true ? (
                                                    <CheckIcon color="success" fontSize="small" />
                                                ) : entry.isCorrect === false ? (
                                                    <CloseIcon color="error" fontSize="small" />
                                                ) : (
                                                    // Skipped card - dash icon
                                                    <RemoveIcon color="disabled" fontSize="small" />
                                                )}
                                                <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                                                    {entry.entryKey}
                                                </Typography>
                                            </Box>
                                            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                                                {entry.entryValue}
                                            </Typography>
                                            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                                                {entry.isCustomTag === true && (
                                                    <Chip
                                                        label="Custom"
                                                        size="small"
                                                        color="primary"
                                                        sx={{ fontSize: '0.6rem', height: '18px' }}
                                                    />
                                                )}
                                                {entry.hskLevelTag && (
                                                    <Box
                                                        sx={{
                                                            width: '18px',
                                                            height: '18px',
                                                            borderRadius: '50%',
                                                            backgroundColor: 'secondary.main',
                                                            color: 'secondary.contrastText',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                            fontSize: '10px',
                                                            fontWeight: 'bold'
                                                        }}
                                                    >
                                                        {getHskNumber(entry.hskLevelTag)}
                                                    </Box>
                                                )}
                                            </Box>
                                        </CardContent>
                                    </Card>
                                </ListItem>
                            );
                        })}
                    </List>
                )}
            </Box>
        </Box>
    );


    return (
        <Box
            className="flashcards-page-container"
            sx={{ display: 'flex', width: '100%', minHeight: 'calc(100vh - 200px)', mt: -2 }}
        >
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
                <MainContent
                    currentEntry={currentEntry}
                    displayEntry={displayEntry}
                    isFlipped={isFlipped}
                    handleFlip={handleFlip}
                    entryKey={entryKey}
                    entryValue={entryValue}
                    handlePreviousCard={handlePreviousCard}
                    handleIncorrect={handleIncorrect}
                    handleCorrect={handleCorrect}
                    handleNextCard={handleNextCard}
                    history={history}
                    historyIndex={historyIndex}
                />
            </Box>

            {/* Mobile FAB */}
            {isMobile && (
                <Fab
                    color="primary"
                    aria-label="open history"
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

export default FlashcardsPage;
