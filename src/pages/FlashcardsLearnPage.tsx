import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../AuthContext";
import { useWorkPoints } from "../hooks/useWorkPoints";
import {
    Box,
    Card,
    CardContent,
    Typography,
    IconButton,
    CircularProgress,
    Badge,
    useMediaQuery,
    useTheme,
} from "@mui/material";
import { styled, alpha } from "@mui/material/styles";
import { useDrag } from "@use-gesture/react";
import UndoIcon from "@mui/icons-material/Undo";
import SettingsIcon from "@mui/icons-material/Settings";
import LocalFireDepartmentIcon from "@mui/icons-material/LocalFireDepartment";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import { API_BASE_URL } from "../constants";
import CharacterPinyinColorDisplay from "../components/CharacterPinyinColorDisplay";
import CPCDRow from "../components/CPCDRow";
import SegmentedSentenceDisplay from "../components/SegmentedSentenceDisplay";

// Types
type HskLevel = "HSK1" | "HSK2" | "HSK3" | "HSK4" | "HSK5" | "HSK6";

interface VocabEntry {
    id: number;
    entryKey: string;
    entryValue: string;
    pronunciation?: string | null;
    hskLevelTag?: HskLevel | null;
    breakdown?: Record<string, { definition: string }> | null;
    synonyms?: string[];
    synonymsMetadata?: Record<string, { definition: string; pronunciation: string }> | null;
    expansion?: string | null;
    expansionMetadata?: Record<string, { pronunciation?: string; definition?: string }> | null;
    expansionLiteralTranslation?: string | null;
    exampleSentences?: Array<{
      chinese: string;
      english: string;
      _segments?: string[];
      segmentMetadata?: Record<string, { pronunciation?: string; definition?: string }>;
    }>;
    relatedWords?: Array<{ id: number; entryKey: string; pronunciation: string | null; definition: string | null }>;
    createdAt: string;
}

interface BreakdownItem {
    character: string;
    pinyin: string;
    definition: string;
}

interface ReviewMark {
    timestamp: string;
    isCorrect: boolean;
}

interface MarkCardResult {
    newCard: VocabEntry | null;
    markTimestamp: string;
    displacedMark: ReviewMark | null;
}

interface LastMarkUndoSnapshot {
    cardId: number;
    markTimestamp: string;
    displacedMark: ReviewMark | null;
    workingLoop: VocabEntry[];
    currentIndex: number;
    isFlipped: boolean;
    selectedTab: number;
}

// Design tokens from Figma
const COLORS = {
    background: "#F9F7F2",
    header: "#D7D7D4",
    infoCard: "#F5EBE0",
    flashCard: "#D6CCC2",
    border: "#625F63",
    onSurface: "#1D1B20",
    green: "#05C793",
    orange: "#FF8E47",
    pink: "#EF476F",
    blue: "#779BE7",
    gray: "#625F63",
    textSecondary: "#625F63",
    correct: "#05C793",
    incorrect: "#EF476F",
    fireActive: "#E65100",
};


// Controls vertical alignment of content within both card faces (front + back)
const CARD_FACE_JUSTIFY = 'flex-start';

// Styled Components
const IPhoneFrame = styled(Box)(() => ({
    backgroundColor: COLORS.background,
    borderRadius: 0,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    width: "100vw",
    height: "100vh",
}));

const Header = styled(Box)(() => ({
    backgroundColor: COLORS.header,
    minHeight: 96,
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-end",
    gap: 10,
}));

const Toolbar = styled(Box)(() => ({
    display: "flex",
    gap: 10,
    width: 393,
    height: 47,
    alignItems: "center",
    padding: "0 12px",
    position: "relative",
}));

const PageTools = styled(Box)(() => ({
    display: "flex",
    gap: 8,
    alignItems: "center",
    position: "absolute",
    right: 0,
    width: 224,
    justifyContent: "flex-end",
    padding: "0 12px",
}));

const InfoCard = styled(Card)(() => ({
    backgroundColor: COLORS.infoCard,
    borderRadius: "12px",
    boxShadow: "2px 4px 4px rgba(0, 0, 0, 0.25)",
    cursor: "grab",
    overflow: "visible",
    position: "relative",
    userSelect: "none",
    WebkitUserSelect: "none",
    MozUserSelect: "none",
    msUserSelect: "none",
    touchAction: "pan-y",
    "&:active": {
        cursor: "grabbing",
    },
}));

const TabsContainer = styled(Box)(() => ({
    position: "absolute",
    top: -18,
    left: 0,
    right: 0,
    display: "flex",
    justifyContent: "center",
    gap: 4,
    padding: "0 16px",
    pointerEvents: "none",
    zIndex: 10,
}));

const Tab = styled(Box)<{ isSelected: boolean; color: string }>(({ isSelected, color }) => ({
    width: 56,
    height: isSelected ? 18 : 16,
    backgroundColor: isSelected ? color : alpha(color, 0.5),
    borderRadius: "4px 4px 0 0",
    transform: isSelected ? "translateY(-4px)" : "translateY(0)",
    transition: "all 0.3s ease-in-out",
    cursor: "pointer",
    pointerEvents: "auto",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
}));

const ArrowIndicator = styled(Box)(() => ({
    position: "absolute",
    top: "50%",
    transform: "translateY(-50%)",
    color: COLORS.gray,
    opacity: 0.4,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    zIndex: 5,
    transition: "opacity 0.2s ease-in-out",
    "&:hover": {
        opacity: 0.7,
    },
}));

const BreakdownLineItem = styled(Box)(() => ({
    display: "flex",
    alignItems: "center",
    gap: 36,
    padding: "3px 8px 3px 2px",
    borderBottom: `1px dashed ${COLORS.border}`,
    "&:last-child": {
        borderBottom: "none",
    },
}));


const DefinitionColumn = styled(Box)(() => ({
    flex: 1,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    height: "100%",
    textAlign: "right",
}));

const DefinitionText = styled(Typography)(() => ({
    fontSize: 12,
    color: COLORS.onSurface,
    lineHeight: "16px",
    fontFamily: '"Inter", sans-serif',
}));

const ContentArea = styled(Box)(() => ({
    flex: 1,
    overflow: "hidden",
    padding: "36px 0",
    display: "flex",
    flexDirection: "column",
    gap: 36,
    alignItems: "center",
}));

// Draggable card wrapper
const DraggableCardContainer = styled(Box)(() => ({
    width: 295,
    minHeight: 426,
    position: "relative",
    perspective: "1200px",
    touchAction: "none",
    userSelect: "none",
}));

// Breakdown Line Item Component
const BreakdownLineItemComponent: React.FC<{
    character: string;
    pinyin: string;
    definition: string;
}> = ({ character, pinyin, definition }) => (
    <BreakdownLineItem className="mobile-demo-breakdown-item">
        <CharacterPinyinColorDisplay
            character={character}
            pinyin={pinyin}
            size="sm"
            useToneColor={true}
            showPinyin={true}
        />
        <DefinitionColumn className="mobile-demo-definition-column">
            <DefinitionText className="mobile-demo-definition-text">{definition}</DefinitionText>
        </DefinitionColumn>
    </BreakdownLineItem>
);

// Main Component
const FlashcardsLearnPage: React.FC = () => {
    const navigate = useNavigate();
    const { token } = useAuth();
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down("md"));
    const [searchParams] = useSearchParams();
    const selectedCategory: string | null = searchParams.get('category');
    const [workingLoop, setWorkingLoop] = useState<VocabEntry[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isFlipped, setIsFlipped] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [isAnimating, setIsAnimating] = useState(false);
    const [isUndoing, setIsUndoing] = useState(false);
    const [selectedTab, setSelectedTab] = useState(0);
    const [lastMarkUndoSnapshot, setLastMarkUndoSnapshot] = useState<LastMarkUndoSnapshot | null>(null);
    const cardRef = useRef<HTMLDivElement>(null);
    const dragStart = useRef({ x: 0, y: 0 });

    // Work points integration — activity detection is handled globally by useActivityDetection
    // inside useWorkPoints. No need for manual recordActivity() calls.
    const workPoints = useWorkPoints();

    // Tab colors and labels (order matches: bt, sct, st, est, et)
    const tabColors = [COLORS.pink, COLORS.green, COLORS.blue, COLORS.orange, COLORS.gray];
    const tabLabels = ["breakdown", "similar", "synonyms", "examples", "literal"];

    // Current entry derived from working loop
    const currentEntry: VocabEntry | null = workingLoop.length > 0 ? workingLoop[currentIndex] : null;

    // Convert breakdown object to array for display
    const getBreakdownItems = (): BreakdownItem[] => {
        if (!currentEntry || !currentEntry.breakdown) return [];
        const breakdown = currentEntry.breakdown;
        const allChars = [...currentEntry.entryKey];
        const pinyinParts = currentEntry.pronunciation ? currentEntry.pronunciation.split(' ') : [];
        return allChars
            .map((char, index) => ({
                character: char,
                pinyin: pinyinParts[index] ?? '',
                definition: breakdown[char]?.definition ?? '',
            }))
            .filter(item => item.character in breakdown);
    };

    const breakdownItems = getBreakdownItems();

    // Swipe handler for InfoCard tabs
    const bindInfoCard = useDrag(
        ({ swipe: [swipeX], event }) => {
            // Prevent text selection during drag
            if (event) {
                event.preventDefault();
            }

            // Only handle swipes, not taps
            if (swipeX !== 0) {
                if (swipeX < 0) {
                    // Swiped left - move to previous tab (with wrap-around)
                    setSelectedTab((prev) => (prev === 0 ? 4 : prev - 1));
                } else if (swipeX > 0) {
                    // Swiped right - move to next tab (with wrap-around)
                    setSelectedTab((prev) => (prev === 4 ? 0 : prev + 1));
                }
            }
        },
        {
            swipe: {
                distance: 50, // Minimum distance to trigger swipe
                velocity: 0.3,
            },
            preventDefault: true,
            filterTaps: true, // Don't trigger on simple taps
            eventOptions: { passive: false }, // Required so preventDefault() is honoured on touch events
        }
    );

    // Fetch distributed working loop (1 Mastered, 2 Comfortable, 2 Unfamiliar, 5 Target)
    useEffect(() => {
        const fetchInitialCards = async () => {
            try {
                setLoading(true);
                setError(null);

                // Build URL with optional category filter
                const url = selectedCategory
                    ? `${API_BASE_URL}/api/onDeck/distributed-working-loop?category=${selectedCategory}`
                    : `${API_BASE_URL}/api/onDeck/distributed-working-loop`;

                const response = await fetch(url, {
                    credentials: 'include'
                });

                if (!response.ok) throw new Error("Failed to fetch distributed working loop");
                const data = await response.json();
                const cards = Array.isArray(data) ? data : [data];

                console.log(`Loaded ${cards.length} cards in distributed working loop${selectedCategory ? ` (category: ${selectedCategory})` : ''}`);
                setWorkingLoop(cards);
                setLastMarkUndoSnapshot(null);

                // Randomly set initial flip state
                setIsFlipped(Math.random() < 0.5);
            } catch (err) {
                setError(err instanceof Error ? err.message : "Unknown error");
            } finally {
                setLoading(false);
            }
        };

        if (token) {
            fetchInitialCards();
        }
    }, [token, selectedCategory]);

    // Mark card with retry logic
    const markCard = async (cardId: number, isCorrect: boolean, retryCount = 0): Promise<MarkCardResult | null> => {
        try {
            const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
            const headers: HeadersInit = {
                'Content-Type': 'application/json',
                'x-user-timezone': userTimeZone,
            };

            // Add Authorization header if token exists
            if (token && token !== 'null' && token !== 'undefined') {
                headers['Authorization'] = `Bearer ${token}`;
            }

            const response = await fetch(`${API_BASE_URL}/api/flashcards/mark`, {
                method: 'POST',
                headers,
                credentials: 'include',
                body: JSON.stringify({ cardId, isCorrect }),
            });

            if (!response.ok) {
                throw new Error('Failed to mark card');
            }

            const data = await response.json();
            if (!data?.markTimestamp) {
                throw new Error('Mark response missing mark timestamp');
            }

            return {
                newCard: data.newCard || null,
                markTimestamp: data.markTimestamp,
                displacedMark: data.displacedMark || null,
            };
        } catch (err) {
            if (retryCount < 3) {
                // Exponential backoff: wait 500ms, 1s, 2s
                await new Promise(resolve => setTimeout(resolve, 500 * Math.pow(2, retryCount)));
                return markCard(cardId, isCorrect, retryCount + 1);
            }
            console.error('Failed to mark card after retries:', err);
            setError('Failed to save progress. Please check your connection.');
            return null;
        }
    };

    // Handle card dismiss
    const handleCardDismiss = async (direction: 'left' | 'right') => {
        if (workingLoop.length === 0 || isAnimating) return;

        const currentCard = workingLoop[currentIndex];
        const isCorrect = direction === 'right';
        const preDismissSnapshot: Omit<LastMarkUndoSnapshot, 'cardId' | 'markTimestamp' | 'displacedMark'> = {
            workingLoop: [...workingLoop],
            currentIndex,
            isFlipped,
            selectedTab,
        };

        setIsAnimating(true);

        // Animate card off screen
        const exitX = direction === 'left' ? -400 : 400;
        setDragPosition({ x: exitX, y: 0 });

        // Mark card and get response
        const markResult = await markCard(currentCard.id, isCorrect);
        if (!markResult) {
            setDragPosition({ x: 0, y: 0 });
            setIsAnimating(false);
            return;
        }

        const { newCard, markTimestamp, displacedMark } = markResult;

        console.log(`Card marked: ${currentCard.entryKey} (${isCorrect ? 'correct' : 'incorrect'})`);
        if (newCard) {
            console.log('New replacement card:', {
                id: newCard.id,
                entryKey: newCard.entryKey,
                entryValue: newCard.entryValue,
            });
            console.log('New card enrichment:', {
                breakdown: newCard.breakdown ?? 'none',
                synonyms: newCard.synonyms ?? 'none',
                exampleSentences: newCard.exampleSentences ?? 'none',
                expansion: newCard.expansion ?? 'none',
                expansionMetadata: newCard.expansionMetadata ?? 'none',
                relatedWords: newCard.relatedWords ?? 'none',
            });
        } else {
            console.log('No new card received (card stays in loop)');
        }

        // Wait for animation to complete
        await new Promise(resolve => setTimeout(resolve, 300));

        // Update working loop
        setWorkingLoop(prevLoop => {
            const newLoop = [...prevLoop];
            if (isCorrect && newCard) {
                // Replace current card with new card
                newLoop[currentIndex] = newCard;
            }
            // If incorrect, card stays in loop
            return newLoop;
        });

        // Move to next card in loop
        setCurrentIndex(prev => (prev + 1) % workingLoop.length);

        // Reset card position and state
        setDragPosition({ x: 0, y: 0 });
        setIsFlipped(Math.random() < 0.5); // Random flip for new card
        setLastMarkUndoSnapshot({
            cardId: currentCard.id,
            markTimestamp,
            displacedMark,
            ...preDismissSnapshot,
        });
        setIsAnimating(false);
    };

    const handleUndoLastMark = async () => {
        if (!lastMarkUndoSnapshot || isAnimating || isUndoing) return;

        try {
            setIsUndoing(true);
            setError(null);

            const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
            const headers: HeadersInit = {
                'Content-Type': 'application/json',
                'x-user-timezone': userTimeZone,
            };

            if (token && token !== 'null' && token !== 'undefined') {
                headers['Authorization'] = `Bearer ${token}`;
            }

            const response = await fetch(`${API_BASE_URL}/api/flashcards/undo-last-mark`, {
                method: 'POST',
                headers,
                credentials: 'include',
                body: JSON.stringify({
                    cardId: lastMarkUndoSnapshot.cardId,
                    markTimestamp: lastMarkUndoSnapshot.markTimestamp,
                    displacedMark: lastMarkUndoSnapshot.displacedMark,
                }),
            });

            if (!response.ok) {
                const responseData = await response.json().catch(() => null);
                throw new Error(responseData?.error || 'Failed to undo last mark');
            }

            setWorkingLoop(lastMarkUndoSnapshot.workingLoop);
            setCurrentIndex(lastMarkUndoSnapshot.currentIndex);
            setIsFlipped(lastMarkUndoSnapshot.isFlipped);
            setSelectedTab(lastMarkUndoSnapshot.selectedTab);
            setDragPosition({ x: 0, y: 0 });
            setIsDragging(false);
            setLastMarkUndoSnapshot(null);
        } catch (err) {
            console.error('Failed to undo last mark:', err);
            setError(err instanceof Error ? err.message : 'Failed to undo last mark');
        } finally {
            setIsUndoing(false);
        }
    };

    // Touch and Mouse handlers for dragging
    const handleTouchStart = (e: React.TouchEvent) => {
        if (isAnimating) return;

        const touch = e.touches[0];
        dragStart.current = { x: touch.clientX, y: touch.clientY };
        setIsDragging(true);
    };

    const handleTouchMove = useCallback((e: TouchEvent) => {
        if (!isDragging || isAnimating) return;

        // Prevent default to avoid scrolling while dragging the card.
        // Must be a native (non-React) listener registered with { passive: false }
        // so that preventDefault() is actually honoured by the browser.
        e.preventDefault();

        const touch = e.touches[0];
        const deltaX = touch.clientX - dragStart.current.x;
        const deltaY = touch.clientY - dragStart.current.y;
        setDragPosition({ x: deltaX, y: deltaY });
    }, [isDragging, isAnimating]);

    // Attach touchmove as a non-passive native listener so preventDefault works
    useEffect(() => {
        const el = cardRef.current;
        if (!el) return;
        el.addEventListener('touchmove', handleTouchMove, { passive: false });
        return () => el.removeEventListener('touchmove', handleTouchMove);
    }, [handleTouchMove]);

    const handleTouchEnd = (e: React.TouchEvent) => {
        // Prevent the browser from firing synthetic mouse events (mousedown/mouseup/click)
        // after this touch interaction, which would cause a double-flip bug.
        e.preventDefault();
        if (!isDragging || isAnimating) return;

        setIsDragging(false);

        const threshold = 150;
        const tapThreshold = 10; // Small movement threshold to distinguish tap from drag
        const { x, y } = dragPosition;

        // Calculate total drag distance
        const dragDistance = Math.sqrt(x * x + y * y);

        if (dragDistance < tapThreshold) {
            // This was a tap, not a drag - flip the card
            setDragPosition({ x: 0, y: 0 });
            setIsFlipped(prev => !prev);
        } else if (Math.abs(x) > threshold) {
            // Card dismissed
            handleCardDismiss(x < 0 ? 'left' : 'right');
        } else {
            // Snap back
            setDragPosition({ x: 0, y: 0 });
        }
    };

    // Mouse handlers for desktop
    const handleMouseDown = (e: React.MouseEvent) => {
        if (isAnimating) return;

        dragStart.current = { x: e.clientX, y: e.clientY };
        setIsDragging(true);
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!isDragging || isAnimating) return;

        const deltaX = e.clientX - dragStart.current.x;
        const deltaY = e.clientY - dragStart.current.y;
        setDragPosition({ x: deltaX, y: deltaY });
    };

    const handleMouseUp = () => {
        if (!isDragging || isAnimating) return;
        setIsDragging(false);

        const threshold = 150;
        const tapThreshold = 10; // Small movement threshold to distinguish click from drag
        const { x, y } = dragPosition;

        // Calculate total drag distance
        const dragDistance = Math.sqrt(x * x + y * y);

        if (dragDistance < tapThreshold) {
            // This was a click, not a drag - flip the card
            setDragPosition({ x: 0, y: 0 });
            setIsFlipped(prev => !prev);
        } else if (Math.abs(x) > threshold) {
            // Card dismissed
            handleCardDismiss(x < 0 ? 'left' : 'right');
        } else {
            // Snap back
            setDragPosition({ x: 0, y: 0 });
        }
    };

    const handleMouseLeave = () => {
        // Reset drag state if mouse leaves the card while dragging
        if (isDragging && !isAnimating) {
            setIsDragging(false);
            setDragPosition({ x: 0, y: 0 });
        }
    };


    // On desktop the Layout wraps this page normally; restore the phone-frame look
    const desktopFrameSx = !isMobile ? {
        maxWidth: 393,
        width: "100%",
        borderRadius: "20px",
        margin: "0 auto",
        minHeight: "852px",
        maxHeight: "932px",
    } : {};

    if (loading) {
        return (
            <Box
                className="flashcards-learn__loading-wrapper"
                sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: isMobile ? "100vw" : "100%",
                    height: "100vh",
                    backgroundColor: COLORS.background,
                }}
            >
                <CircularProgress />
            </Box>
        );
    }

    if (error) {
        return (
            <Box
                className="flashcards-learn__error-wrapper"
                sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: isMobile ? "100vw" : "100%",
                    height: "100vh",
                    backgroundColor: COLORS.background,
                }}
            >
                <Typography color="error">{error}</Typography>
            </Box>
        );
    }

    const rotation = dragPosition.x * 0.05; // Subtle rotation based on drag
    const opacity = 1 - Math.abs(dragPosition.x) / 400;

    return (
        <IPhoneFrame className="mobile-demo-frame" sx={desktopFrameSx}>
                {/* Header */}
                <Header className="mobile-demo-header">
                    <Toolbar className="mobile-demo-toolbar">
                        <IconButton
                            className="mobile-demo-back-button"
                            size="small"
                            sx={{ color: COLORS.onSurface }}
                            onClick={() => navigate('/flashcards/decks')}
                        >
                            <ExpandMoreIcon />
                        </IconButton>
                        <Typography
                            className="mobile-demo-page-title"
                            sx={{
                                fontSize: 16,
                                fontWeight: 400,
                                color: COLORS.onSurface,
                                textAlign: "left",
                            }}
                        >
                            {selectedCategory ? `Learn: ${selectedCategory}` : 'Learn'}
                        </Typography>
                        <PageTools className="mobile-demo-page-tools">
                            <IconButton
                                className="mobile-demo-tool-button"
                                size="small"
                                sx={{ color: COLORS.onSurface }}
                                onClick={handleUndoLastMark}
                                disabled={!lastMarkUndoSnapshot || isAnimating || isUndoing}
                            >
                                <UndoIcon />
                            </IconButton>
                            <IconButton className="mobile-demo-tool-button" size="small" sx={{ color: COLORS.onSurface }}>
                                <SettingsIcon />
                            </IconButton>
                            {/* Work Points Fire Icon with Seconds Counter */}
                            <Box className="mobile-demo-work-points" sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
                                <Badge
                                    className="mobile-demo-work-points-badge"
                                    badgeContent={workPoints.currentPoints}
                                    color="primary"
                                    max={99}
                                    sx={{
                                        '& .MuiBadge-badge': {
                                            fontSize: '0.625rem',
                                            fontWeight: 'bold',
                                            minWidth: '16px',
                                            height: '16px',
                                            padding: '0 4px',
                                            backgroundColor: workPoints.isActive ? COLORS.fireActive : COLORS.gray,
                                            color: 'white',
                                            border: `1px solid ${COLORS.header}`,
                                        }
                                    }}
                                >
                                    <IconButton
                                        className="mobile-demo-tool-button work-points-fire-icon"
                                        size="small"
                                        sx={{
                                            padding: '4px',
                                        }}
                                    >
                                        <LocalFireDepartmentIcon
                                            className="mobile-demo-fire-icon"
                                            sx={{
                                                color: workPoints.isActive ? COLORS.fireActive : COLORS.gray,
                                                fontSize: '1.25rem',
                                                filter: workPoints.isActive ? 'drop-shadow(0 0 4px rgba(230, 81, 0, 0.6))' : 'none',
                                                animation: workPoints.isAnimating ? 'pulse 0.6s ease-out' : 'none',
                                                '@keyframes pulse': {
                                                    '0%, 100%': { transform: 'scale(1)' },
                                                    '50%': { transform: 'scale(1.2)', filter: 'drop-shadow(0 0 8px rgba(230, 81, 0, 0.8))' },
                                                },
                                            }}
                                        />
                                    </IconButton>
                                </Badge>
                                {/* Seconds counter — driven by hook's live 1s timer */}
                                <Typography
                                    className="mobile-demo-seconds-counter"
                                    sx={{
                                        fontSize: '0.625rem',
                                        fontWeight: 'bold',
                                        color: workPoints.isActive ? COLORS.fireActive : COLORS.gray,
                                        lineHeight: 1,
                                        marginTop: '-2px',
                                    }}
                                >
                                    {workPoints.liveSeconds}s
                                </Typography>
                            </Box>
                        </PageTools>
                    </Toolbar>
                </Header>

                {/* Content Area */}
                <ContentArea className="mobile-demo-content">
                    {/* Info Card with breakdown and arrow indicators */}
                    <Box className="mobile-demo-info-card-wrapper" sx={{ position: "relative", width: 295 }}>
                        {/* Left Arrow Indicator */}
                        <ArrowIndicator
                            className="mobile-demo-left-arrow"
                            sx={{ left: -32 }}
                            onClick={() => setSelectedTab((prev) => (prev === 0 ? 4 : prev - 1))}
                        >
                            <ChevronLeftIcon className="mobile-demo-chevron-left" sx={{ fontSize: 24 }} />
                        </ArrowIndicator>

                        <InfoCard
                            className="mobile-demo-info-card"
                            sx={{ width: 295, height: 203 }}
                            {...bindInfoCard()}
                        >
                            {/* Tabs at top of card */}
                            <TabsContainer className="mobile-demo-tabs">
                                {tabColors.map((color, index) => (
                                    <Tab
                                        key={index}
                                        isSelected={selectedTab === index}
                                        color={color}
                                        onClick={() => setSelectedTab(index)}
                                    >
                                        <Typography
                                            sx={{
                                                fontSize: "8px",
                                                fontWeight: selectedTab === index ? 700 : 500,
                                                color: "text.primary",
                                                lineHeight: 1,
                                                userSelect: "none",
                                                letterSpacing: "0.02em",
                                            }}
                                        >
                                            {tabLabels[index]}
                                        </Typography>
                                    </Tab>
                                ))}
                            </TabsContainer>

                            <CardContent
                                className="mobile-demo-card-content"
                                sx={{
                                    display: "flex",
                                    flexDirection: "column",
                                    height: "100%",
                                    padding: 0,
                                    "&:last-child": {
                                        paddingBottom: 0,
                                    },
                                }}
                            >
                                <Box className="mobile-demo-breakdown-list" sx={{ flex: 1, overflow: "auto", padding: "8px" }}>
                                    {/* Tab 0: Breakdown */}
                                    {selectedTab === 0 && breakdownItems.length > 0 ? (
                                        breakdownItems.map((item, index) => (
                                            <BreakdownLineItemComponent
                                                key={index}
                                                character={item.character}
                                                pinyin={item.pinyin}
                                                definition={item.definition}
                                            />
                                        ))
                                    ) : selectedTab === 0 ? (
                                        <Box className="mobile-demo-tab-empty" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 2 }}>
                                            <Typography className="mobile-demo-tab-empty-text" sx={{ fontSize: 14, color: COLORS.gray, textAlign: 'center', fontFamily: '"Inter", sans-serif' }}>
                                                Breakdown not available for this card
                                            </Typography>
                                        </Box>
                                    ) : null}

                                    {/* Tab 1: Related Words */}
                                    {selectedTab === 1 && currentEntry?.relatedWords && currentEntry.relatedWords.length > 0 ? (
                                        <Box className="mobile-demo-related-words-list">
                                            {currentEntry.relatedWords.map((word) => (
                                                <BreakdownLineItem className="mobile-demo-related-word-item" key={word.id}>
                                                    <CPCDRow size="sm">
                                                        {[...word.entryKey].map((char, i) => (
                                                            <CharacterPinyinColorDisplay
                                                                key={i}
                                                                character={char}
                                                                pinyin={word.pronunciation?.split(' ')[i] ?? ''}
                                                                showPinyin={true}
                                                                useToneColor={true}
                                                                size="sm"
                                                            />
                                                        ))}
                                                    </CPCDRow>
                                                    {word.definition && (
                                                        <DefinitionColumn>
                                                            <DefinitionText>{word.definition}</DefinitionText>
                                                        </DefinitionColumn>
                                                    )}
                                                </BreakdownLineItem>
                                            ))}
                                        </Box>
                                    ) : selectedTab === 1 ? (
                                        <Box className="mobile-demo-tab-empty" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 2 }}>
                                            <Typography className="mobile-demo-tab-empty-text" sx={{ fontSize: 14, color: COLORS.gray, textAlign: 'center', fontFamily: '"Inter", sans-serif' }}>
                                                No related words found
                                            </Typography>
                                        </Box>
                                    ) : null}

                                    {/* Tab 2: Synonyms */}
                                    {selectedTab === 2 && currentEntry?.synonyms && currentEntry.synonyms.length > 0 ? (
                                        <Box className="mobile-demo-synonyms-list">
                                            {currentEntry.synonyms.map((synonym, index) => {
                                                const synPronunciations = currentEntry.synonymsMetadata?.[synonym]?.pronunciation?.split(' ') ?? [];
                                                const synDefinition = currentEntry.synonymsMetadata?.[synonym]?.definition;
                                                return (
                                                    <BreakdownLineItem className="mobile-demo-synonym-item" key={index}>
                                                        <CPCDRow size="sm">
                                                            {[...synonym].map((char, i) => (
                                                                <CharacterPinyinColorDisplay
                                                                    key={i}
                                                                    character={char}
                                                                    pinyin={synPronunciations[i] ?? ''}
                                                                    showPinyin={true}
                                                                    useToneColor={true}
                                                                    size="sm"
                                                                />
                                                            ))}
                                                        </CPCDRow>
                                                        {synDefinition && (
                                                            <DefinitionColumn>
                                                                <DefinitionText>{synDefinition}</DefinitionText>
                                                            </DefinitionColumn>
                                                        )}
                                                    </BreakdownLineItem>
                                                );
                                            })}
                                        </Box>
                                    ) : selectedTab === 2 ? (
                                        <Box className="mobile-demo-tab-empty" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 2 }}>
                                            <Typography className="mobile-demo-tab-empty-text" sx={{ fontSize: 14, color: COLORS.gray, textAlign: 'center', fontFamily: '"Inter", sans-serif' }}>
                                                No synonyms available
                                            </Typography>
                                        </Box>
                                    ) : null}

                                    {/* Tab 3: Example Sentences */}
                                    {selectedTab === 3 && currentEntry?.exampleSentences && currentEntry.exampleSentences.length > 0 ? (
                                        <Box className="mobile-demo-sentences-list" sx={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                            {currentEntry.exampleSentences.map((sentence, index) => (
                                                <Box
                                                    className="mobile-demo-sentence-item"
                                                    key={index}
                                                    sx={{
                                                        display: 'flex',
                                                        flexDirection: 'column',
                                                        gap: '4px',
                                                        padding: '8px',
                                                        backgroundColor: 'rgba(255, 255, 255, 0.5)',
                                                        borderRadius: '8px',
                                                        borderLeft: `4px solid ${COLORS.orange}`,
                                                    }}
                                                >
                                                    <SegmentedSentenceDisplay
                                                        sentence={sentence}
                                                        size="xs"
                                                        flexWrap="wrap"
                                                    />
                                                    <Typography className="mobile-demo-sentence-english" sx={{ fontSize: 11, color: COLORS.gray, fontFamily: '"Inter", sans-serif', lineHeight: 1.3 }}>
                                                        {sentence.english}
                                                    </Typography>
                                                </Box>
                                            ))}
                                        </Box>
                                    ) : selectedTab === 3 ? (
                                        <Box className="mobile-demo-tab-empty" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 2 }}>
                                            <Typography className="mobile-demo-tab-empty-text" sx={{ fontSize: 14, color: COLORS.gray, textAlign: 'center', fontFamily: '"Inter", sans-serif' }}>
                                                No example sentences available
                                            </Typography>
                                        </Box>
                                    ) : null}

                                    {/* Tab 4: Expansion */}
                                    {selectedTab === 4 && currentEntry?.expansion ? (
                                        <Box className="mobile-demo-expansion-wrapper" sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 2, gap: 2 }}>
                                            <Typography className="mobile-demo-expansion-label" sx={{ fontSize: 12, color: COLORS.gray, fontFamily: '"Inter", sans-serif', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                                Expanded Form
                                            </Typography>
                                            <SegmentedSentenceDisplay
                                                sentence={{
                                                    chinese: currentEntry.expansion,
                                                    _segments: [...currentEntry.expansion],
                                                    segmentMetadata: currentEntry.expansionMetadata ?? undefined,
                                                }}
                                                size="md"
                                                compact
                                                flexWrap="wrap"
                                                justifyContent="center"
                                                className="mobile-demo-expansion-chars"
                                            />
                                            {/* Literal translation: segment definitions strung together */}
                                            {currentEntry.expansionLiteralTranslation && (
                                                <Typography sx={{
                                                    fontSize: "0.8rem",
                                                    color: COLORS.textSecondary,
                                                    fontFamily: '"Inter", sans-serif',
                                                    mt: 0.5,
                                                    lineHeight: 1.4,
                                                    wordBreak: 'break-word',
                                                    textAlign: 'center',
                                                }}>
                                                    {currentEntry.expansionLiteralTranslation}
                                                </Typography>
                                            )}
                                        </Box>
                                    ) : selectedTab === 4 ? (
                                        <Box className="mobile-demo-tab-empty" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 2 }}>
                                            <Typography className="mobile-demo-tab-empty-text" sx={{ fontSize: 14, color: COLORS.gray, textAlign: 'center', fontFamily: '"Inter", sans-serif' }}>
                                                No expansion available
                                            </Typography>
                                        </Box>
                                    ) : null}
                                </Box>
                            </CardContent>
                        </InfoCard>

                        {/* Right Arrow Indicator */}
                        <ArrowIndicator
                            className="mobile-demo-right-arrow"
                            sx={{ right: -32 }}
                            onClick={() => setSelectedTab((prev) => (prev === 4 ? 0 : prev + 1))}
                        >
                            <ChevronRightIcon className="mobile-demo-chevron-right" sx={{ fontSize: 24 }} />
                        </ArrowIndicator>
                    </Box>

                    {/* Draggable Flashcard or Empty State */}
                    <DraggableCardContainer className="mobile-demo-draggable-container">
                        {currentEntry ? (
                            <Card
                                className="mobile-demo-flashcard"
                                ref={cardRef}
                                onTouchStart={handleTouchStart}
                                onTouchEnd={handleTouchEnd}
                                onMouseDown={handleMouseDown}
                                onMouseMove={handleMouseMove}
                                onMouseUp={handleMouseUp}
                                onMouseLeave={handleMouseLeave}
                                sx={{
                                    backgroundColor: 'transparent',
                                    background: 'none',
                                    borderRadius: "12px",
                                    boxShadow: "2px 4px 4px rgba(0, 0, 0, 0.25)",
                                    cursor: "pointer",
                                    minHeight: 426,
                                    width: 295,
                                    position: "absolute",
                                    top: 0,
                                    left: 0,
                                    transformStyle: "preserve-3d",
                                    transform: `translate(${dragPosition.x}px, ${dragPosition.y}px) rotate(${rotation}deg) rotateY(${isFlipped ? 180 : 0}deg)`,
                                    transition: isDragging ? 'none' : 'transform 0.45s ease',
                                    opacity: opacity,
                                    overflow: 'visible',
                                }}
                            >
                                    {/* Front face */}
                                    <Box sx={{
                                        position: "absolute",
                                        top: 0, left: 0, width: "100%", height: "100%",
                                        backfaceVisibility: "hidden",
                                        WebkitBackfaceVisibility: "hidden",
                                        backgroundColor: COLORS.flashCard,
                                        borderRadius: "12px",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: CARD_FACE_JUSTIFY,
                                    }}>
                                        <CardContent
                                            className="mobile-demo-flashcard-content"
                                            sx={{ padding: "72px 30px", width: "100%" }}
                                        >
                                            <Box className="mobile-demo-flashcard-inner" sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '80px' }}>
                                                <Box className="mobile-demo-flashcard-image" sx={{ width: 106, height: 83, backgroundColor: '#ffffff', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                    <Typography sx={{ fontSize: 11, color: COLORS.gray, fontFamily: '"Inter", sans-serif', textAlign: 'center' }}>insert image here</Typography>
                                                </Box>
                                                <Box className="mobile-demo-flashcard-text" sx={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'center', width: '100%' }}>
                                                    <Typography
                                                        className="mobile-demo-flashcard-word"
                                                        sx={{
                                                            fontSize: 30,
                                                            fontWeight: 400,
                                                            color: COLORS.onSurface,
                                                            fontFamily: '"Inter", "Noto Sans JP", sans-serif',
                                                        }}
                                                    >
                                                        {currentEntry.entryKey}
                                                    </Typography>
                                                    {currentEntry.pronunciation && (
                                                        <Typography
                                                            className="mobile-demo-flashcard-pronunciation"
                                                            sx={{
                                                                fontSize: 16,
                                                                color: COLORS.onSurface,
                                                                opacity: 0.8,
                                                                fontFamily: '"Inter", sans-serif',
                                                                fontStyle: 'italic',
                                                            }}
                                                        >
                                                            {currentEntry.pronunciation}
                                                        </Typography>
                                                    )}
                                                </Box>
                                            </Box>
                                        </CardContent>
                                    </Box>

                                    {/* Back face */}
                                    <Box sx={{
                                        position: "absolute",
                                        top: 0, left: 0, width: "100%", height: "100%",
                                        backfaceVisibility: "hidden",
                                        WebkitBackfaceVisibility: "hidden",
                                        transform: "rotateY(180deg)",
                                        backgroundColor: COLORS.flashCard,
                                        borderRadius: "12px",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: CARD_FACE_JUSTIFY,
                                    }}>
                                        <CardContent sx={{ padding: "72px 30px" }}>
                                            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '80px' }}>
                                                <Box sx={{ width: 106, height: 83, backgroundColor: '#ffffff', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                    <Typography sx={{ fontSize: 11, color: COLORS.gray, fontFamily: '"Inter", sans-serif', textAlign: 'center' }}>insert image here</Typography>
                                                </Box>
                                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'center', width: '100%' }}>
                                                    <Typography sx={{
                                                        fontSize: 30,
                                                        fontWeight: 400,
                                                        color: COLORS.onSurface,
                                                        fontFamily: '"Inter", "Noto Sans JP", sans-serif',
                                                    }}>
                                                        {currentEntry.entryValue}
                                                    </Typography>
                                                </Box>
                                            </Box>
                                        </CardContent>
                                    </Box>

                                {/* Drag overlay — above flip faces */}
                                <Box sx={{
                                    position: 'absolute',
                                    top: 0, left: 0, right: 0, bottom: 0,
                                    backgroundColor: dragPosition.x > 50 ? COLORS.correct : dragPosition.x < -50 ? COLORS.incorrect : 'transparent',
                                    opacity: Math.min(Math.abs(dragPosition.x) / 150, 0.3),
                                    borderRadius: "12px",
                                    pointerEvents: 'none',
                                    zIndex: 3,
                                }} />
                            </Card>
                        ) : (
                            <Card
                                className="mobile-demo-flashcard-empty"
                                sx={{
                                    backgroundColor: COLORS.flashCard,
                                    borderRadius: "12px",
                                    boxShadow: "2px 4px 4px rgba(0, 0, 0, 0.25)",
                                    minHeight: 426,
                                    width: 295,
                                    position: "absolute",
                                    top: 0,
                                    left: 0,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                }}
                            >
                                <CardContent className="mobile-demo-flashcard-empty-content" sx={{ padding: "32px", textAlign: 'center' }}>
                                    <Typography
                                        className="mobile-demo-flashcard-empty-text"
                                        sx={{
                                            fontSize: 20,
                                            fontWeight: 400,
                                            color: COLORS.onSurface,
                                            fontFamily: '"Inter", sans-serif',
                                            lineHeight: 1.5,
                                        }}
                                    >
                                        {selectedCategory
                                            ? `No cards in the ${selectedCategory} category yet. Cards will appear here as you study!`
                                            : 'No library cards available. Add cards from the Discover page!'}
                                    </Typography>
                                </CardContent>
                            </Card>
                        )}
                    </DraggableCardContainer>
                </ContentArea>
        </IPhoneFrame>
    );
};

export default FlashcardsLearnPage;
