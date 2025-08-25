import { useState, useEffect, useRef } from "react";
import { useAuth } from "../AuthContext";
import {
    Container,
    Typography,
    Box,
    Card,
    CardContent,
    Button,
    CircularProgress,
    Alert,
    Divider,
    Chip,
    List,
    ListItem,
    ListItemText,
    ListItemIcon,
    Drawer,
    useMediaQuery,
    useTheme,
    Fab,
    IconButton,
    Collapse
} from "@mui/material";
import ShuffleIcon from "@mui/icons-material/Shuffle";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import HistoryIcon from "@mui/icons-material/History";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import SkipNextIcon from "@mui/icons-material/SkipNext";
import MenuIcon from "@mui/icons-material/Menu";
import RemoveIcon from "@mui/icons-material/Remove";

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

// Helper function to render tag badges
const renderTags = (entry: VocabEntry) => (
    <Box sx={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 0.5 }}>
        {entry.isCustomTag === true && (
            <Chip
                label="Custom"
                size="small"
                color="primary"
                sx={{ fontSize: '0.7rem', height: '20px' }}
            />
        )}
        {entry.hskLevelTag && (
            <Box
                sx={{
                    width: '24px',
                    height: '24px',
                    borderRadius: '50%',
                    backgroundColor: 'secondary.main',
                    color: 'secondary.contrastText',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '12px',
                    fontWeight: 'bold'
                }}
            >
                {getHskNumber(entry.hskLevelTag)}
            </Box>
        )}
    </Box>
);

// Card position definitions for the stack effect
interface CardPosition {
    scale: number;
    translateX: string;
    translateY: string;
    zIndex: number;
    opacity: number;
}

const cardPositions: Record<'previous' | 'current' | 'next', CardPosition> = {
    previous: {
        scale: 1,
        translateX: '-24px',
        translateY: '-24px',
        zIndex: 1,
        opacity: 0.7
    },
    current: {
        scale: 1,
        translateX: '0px',
        translateY: '0px',
        zIndex: 3,
        opacity: 1
    },
    next: {
        scale: 1,
        translateX: '24px',
        translateY: '24px',
        zIndex: 2,
        opacity: 0.7
    }
};

// Blank Card Component for previous/next positions
const BlankCard = ({ position, onClick }: { position: 'previous' | 'next', onClick: () => void }) => {
    const pos = cardPositions[position];

    return (
        <Card
            onClick={onClick}
            sx={{
                position: "absolute",
                width: "100%",
                height: "100%",
                borderRadius: 2,
                boxShadow: 2,
                cursor: "pointer",
                backgroundColor: 'grey.100',
                border: '2px dashed',
                borderColor: 'grey.300',
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                alignItems: "center",
                transform: `scale(${pos.scale}) translateX(${pos.translateX}) translateY(${pos.translateY})`,
                zIndex: pos.zIndex,
                opacity: pos.opacity,
                transition: 'all 0.3s ease-in-out',
                '&:hover': {
                    opacity: pos.opacity + 0.2,
                    transform: `scale(${pos.scale + 0.02}) translateX(${pos.translateX}) translateY(${pos.translateY})`,
                }
            }}
        >
            <CardContent
                sx={{
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    alignItems: "center",
                    width: "100%",
                    height: "100%",
                }}
            >
                <Typography
                    variant="h6"
                    component="h2"
                    align="center"
                    color="text.secondary"
                    sx={{ mb: 1 }}
                >
                    {position === 'previous' ? '← Previous' : 'Next →'}
                </Typography>
                <Typography
                    variant="caption"
                    color="text.secondary"
                    align="center"
                >
                    Click to navigate
                </Typography>
            </CardContent>
        </Card>
    );
};

function FlashcardsPage() {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down("md"));
    const [entries, setEntries] = useState<VocabEntry[]>([]);
    const [currentEntry, setCurrentEntry] = useState<VocabEntry | null>(null);
    const [frontContent, setFrontContent] = useState<string>("");
    const [backContent, setBackContent] = useState<string>("");
    const [isFlipped, setIsFlipped] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [errorCode, setErrorCode] = useState<string | null>(null);
    const [history, setHistory] = useState<HistoryEntry[]>([]);
    const [completedCardsCount, setCompletedCardsCount] = useState(0);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [historyIndex, setHistoryIndex] = useState(0); // 0 means current card, 1+ means older cards in history
    const [isAnimating, setIsAnimating] = useState(false);
    const [animationDirection, setAnimationDirection] = useState<'next' | 'previous' | null>(null);
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

    // Initialize front and back content when first entry is loaded
    useEffect(() => {
        if (currentEntry && frontContent === "" && backContent === "") {
            setFrontContent(currentEntry.entryKey);
            setBackContent(currentEntry.entryValue);
        }
    }, [currentEntry, frontContent, backContent]);

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
            const response = await fetch("http://localhost:3001/api/vocabEntries", {
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

        // Update the front content immediately
        setFrontContent(newEntry.entryKey);

        // If the card is flipped, flip it back
        if (isFlipped) {
            setIsFlipped(false);
        }

        // Store the new entry for reference, but don't update the back content yet
        setCurrentEntry(newEntry);

        // Add the new card to history immediately with null status (pending)
        addToHistory(newEntry, null);

        // Update the back content with a delay
        // This ensures the back content doesn't update until after any flip animation completes
        setTimeout(() => {
            setBackContent(newEntry.entryValue);
        }, 800); // Full flip animation time to ensure it updates only after the animation completes
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

        // Update the front content immediately
        setFrontContent(vocabEntry.entryKey);

        // Restore the flip state from history
        setIsFlipped(historyEntry.wasFlipped);

        // Store the entry for reference
        setCurrentEntry(vocabEntry);

        // Update the back content with a delay
        setTimeout(() => {
            setBackContent(vocabEntry.entryValue);
        }, 800);
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

            // Update the front content immediately
            setFrontContent(vocabEntry.entryKey);

            // Restore the flip state from history
            setIsFlipped(historyEntry.wasFlipped);

            // Store the entry for reference
            setCurrentEntry(vocabEntry);

            // Update the back content with a delay
            setTimeout(() => {
                setBackContent(vocabEntry.entryValue);
            }, 800);
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
        // Always mark as correct regardless of flip state
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
        // Always mark as incorrect regardless of flip state
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

        // Update the front content immediately
        setFrontContent(vocabEntry.entryKey);

        // Restore the flip state from history
        setIsFlipped(historyEntry.wasFlipped);

        // Store the entry for reference
        setCurrentEntry(vocabEntry);

        // Update the back content with a delay
        setTimeout(() => {
            setBackContent(vocabEntry.entryValue);
        }, 800);
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
                                                transform: 'translateY(-1px)',
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
                sx={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    mb: 4,
                    width: '100%',
                }}
            >
                <Box
                    sx={{
                        width: "100%",
                        maxWidth: 500,
                        height: 300,
                        mb: 4,
                        perspective: "1000px",
                        padding: 1,
                        display: "flex",
                        justifyContent: "center",
                        alignItems: "center",
                        position: "relative",
                    }}
                >
                    {/* Card Stack Container */}
                    <Box
                        sx={{
                            width: "100%",
                            height: "100%",
                            position: "relative",
                        }}
                    >
                        {/* Previous Card (behind, top-left) - only show if there's history to go back to */}
                        {history.length > 0 && historyIndex < history.length - 1 && (
                            <BlankCard
                                position="previous"
                                onClick={() => {
                                    if (!isAnimating) {
                                        handlePreviousCard();
                                    }
                                }}
                            />
                        )}

                        {/* Next Card (behind, bottom-right) */}
                        <BlankCard
                            position="next"
                            onClick={() => {
                                if (!isAnimating) {
                                    handleNextCard();
                                }
                            }}
                        />

                        {/* Current Card (front, center) - with flip functionality */}
                        <div
                            style={{
                                width: "100%",
                                height: "100%",
                                position: "absolute",
                                transition: "transform 0.8s",
                                transformStyle: "preserve-3d",
                                transform: isFlipped ? "rotateY(180deg)" : "rotateY(0deg)",
                                cursor: "pointer",
                                zIndex: cardPositions.current.zIndex,
                            }}
                            onClick={handleFlip}
                        >
                            {/* Front of current card */}
                            <Card
                                sx={{
                                    position: "absolute",
                                    width: "100%",
                                    height: "100%",
                                    backfaceVisibility: "hidden",
                                    display: "flex",
                                    flexDirection: "column",
                                    justifyContent: "center",
                                    alignItems: "center",
                                    p: 3,
                                    borderRadius: 2,
                                    boxShadow: 3,
                                }}
                            >
                                <CardContent
                                    sx={{
                                        display: "flex",
                                        flexDirection: "column",
                                        justifyContent: "center",
                                        alignItems: "center",
                                        width: "100%",
                                        height: "100%",
                                    }}
                                >
                                    <Typography
                                        variant="h4"
                                        component="h2"
                                        align="center"
                                        gutterBottom
                                        sx={{ width: '100%', textAlign: 'center' }}
                                    >
                                        {frontContent}
                                    </Typography>
                                    <Typography
                                        variant="caption"
                                        color="text.secondary"
                                        sx={{ mt: 2, width: '100%', textAlign: 'center' }}
                                    >
                                        (Click card to see the definition)
                                    </Typography>
                                </CardContent>
                            </Card>

                            {/* Back of current card */}
                            <Card
                                sx={{
                                    position: "absolute",
                                    width: "100%",
                                    height: "100%",
                                    backfaceVisibility: "hidden",
                                    transform: "rotateY(180deg)",
                                    display: "flex",
                                    flexDirection: "column",
                                    borderRadius: 2,
                                    boxShadow: 3,
                                }}
                            >
                                {currentEntry && renderTags(currentEntry)}
                                <CardContent sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', p: 2 }}>
                                    <Typography variant="h5" component="h2" gutterBottom>
                                        {currentEntry?.entryKey}
                                    </Typography>
                                    <Divider sx={{ mb: 2 }} />
                                    <Typography variant="body1" color="text.secondary" sx={{ flexGrow: 1, mb: 2 }}>
                                        {backContent}
                                    </Typography>
                                    {currentEntry?.createdAt && (
                                        <>
                                            <Divider sx={{ mt: 'auto' }} />
                                            <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                                                Added: {new Date(currentEntry.createdAt).toLocaleDateString()}
                                            </Typography>
                                        </>
                                    )}
                                </CardContent>
                            </Card>
                        </div>
                    </Box>
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
