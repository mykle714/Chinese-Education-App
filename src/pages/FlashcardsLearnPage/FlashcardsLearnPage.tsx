import React, { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Box, CircularProgress, Typography, useMediaQuery, useTheme } from "@mui/material";
import { useAuth } from "../../AuthContext";
import { useWorkPoints } from "../../hooks/useWorkPoints";
import { API_BASE_URL } from "../../constants";
import { IPhoneFrame, ContentArea } from "./styled";
import { COLORS } from "./constants";
import type { VocabEntry, BreakdownItem, MarkCardResult, LastMarkUndoSnapshot } from "./types";
import { useCardDrag } from "./useCardDrag";
import FlashcardsLearnHeader from "./FlashcardsLearnHeader";
import InfoCardSection from "./InfoCardSection";
import FlashCardSection from "./FlashCardSection";

const FlashcardsLearnPage: React.FC = () => {
    const navigate = useNavigate();
    const { token } = useAuth();
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down("md"));
    const [searchParams] = useSearchParams();
    const selectedCategory: string | null = searchParams.get('category');

    const [workingLoop, setWorkingLoop] = useState<VocabEntry[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isAnimating, setIsAnimating] = useState(false);
    const [isUndoing, setIsUndoing] = useState(false);
    const [selectedTab, setSelectedTab] = useState(0);
    const [lastMarkUndoSnapshot, setLastMarkUndoSnapshot] = useState<LastMarkUndoSnapshot | null>(null);
    const [showPinyin, setShowPinyin] = useState(true);
    // Two-slot card stack: tracks which slot (0 or 1) is the front card and
    // which slot is currently animating off-screen.
    const [activeFrontSlot, setActiveFrontSlot] = useState<0 | 1>(0);
    const [flyOut, setFlyOut] = useState<{ slot: 0 | 1; direction: 'left' | 'right' } | null>(null);

    // Work points integration — activity detection is handled globally by useActivityDetection
    // inside useWorkPoints. No need for manual recordActivity() calls.
    const workPoints = useWorkPoints();

    // Current entry derived from working loop
    const currentEntry: VocabEntry | null = workingLoop.length > 0 ? workingLoop[currentIndex] : null;
    // Next entry pre-rendered in the back card slot
    const nextEntry: VocabEntry | null = workingLoop.length > 1 ? workingLoop[(currentIndex + 1) % workingLoop.length] : null;

    // Log enrichment data for the current card whenever it changes (covers both correct and incorrect advances)
    useEffect(() => {
        if (!currentEntry) return;
        console.log('Current card:', { id: currentEntry.id, entryKey: currentEntry.entryKey });
        console.log('Current card enrichment:', {
            breakdown: currentEntry.breakdown ?? 'none',
            longDefinition: currentEntry.longDefinition ?? 'none',
            exampleSentences: currentEntry.exampleSentences ?? 'none',
            expansion: currentEntry.expansion ?? 'none',
            expansionMetadata: currentEntry.expansionMetadata ?? 'none',
            relatedWords: currentEntry.relatedWords ?? 'none',
        });
        // Working loop cards grouped by category
        const categories = ['Unfamiliar', 'Target', 'Comfortable', 'Mastered'] as const;
        const byCategory = Object.fromEntries(
            categories.map(cat => [cat, workingLoop.filter(c => c.category === cat)])
        );
        console.log('Working loop by category:', byCategory);
    }, [currentEntry, workingLoop]);

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

    // Drag/flip logic extracted into a custom hook
    const {
        cardRef,
        dragPosition,
        isDragging,
        isFlipped,
        setIsFlipped,
        resetDragPosition,
        handlers,
    } = useCardDrag(isAnimating, (direction) => handleCardDismiss(direction), currentIndex);

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

        // Begin fly-out: current front slot animates off-screen in the swipe direction.
        // The back slot (already showing the next card) is immediately promoted to front.
        setFlyOut({ slot: activeFrontSlot, direction });
        setActiveFrontSlot(prev => (1 - prev) as 0 | 1);
        setCurrentIndex(prev => (prev + 1) % workingLoop.length);
        setIsFlipped(Math.random() < 0.5);

        // Fire mark API in background — newCard replaces the current slot, not the next one,
        // so the UI doesn't need to wait for the response before advancing.
        markCard(currentCard.id, isCorrect).then(markResult => {
            if (!markResult) return;
            const { newCard, markTimestamp, displacedMark } = markResult;
            console.log(`Card marked: ${currentCard.entryKey} (${isCorrect ? 'correct' : 'incorrect'})`);
            if (isCorrect && newCard) {
                // Patch the slot the dismissed card occupied — user won't see it for a full cycle
                setWorkingLoop(prevLoop => {
                    const newLoop = [...prevLoop];
                    newLoop[preDismissSnapshot.currentIndex] = newCard;
                    return newLoop;
                });
            }
            setLastMarkUndoSnapshot({
                cardId: currentCard.id,
                markTimestamp,
                displacedMark,
                ...preDismissSnapshot,
            });
        });

        // Wait for the fly-out CSS transition (0.45s) to complete, then clear the
        // fly-out state. The flew-out slot snaps back to center (hidden behind the
        // new front card) and becomes the next back card.
        await new Promise(resolve => setTimeout(resolve, 450));
        setFlyOut(null);
        resetDragPosition();
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
            setLastMarkUndoSnapshot(null);
        } catch (err) {
            console.error('Failed to undo last mark:', err);
            setError(err instanceof Error ? err.message : 'Failed to undo last mark');
        } finally {
            setIsUndoing(false);
        }
    };

    // On desktop the Layout wraps this page normally; restore the phone-frame look
    // Height always supplied via sx to avoid specificity conflicts with styled()
    const frameSx = !isMobile ? {
        maxWidth: 393,
        width: "100%",
        borderRadius: "20px",
        margin: "0 auto",
        height: "calc(100dvh - 80px)", // account for Layout chrome (mt + pt top, footer bottom)
        maxHeight: "932px",
    } : {
        height: "100dvh",
    };

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

    return (
        <IPhoneFrame className="mobile-demo-frame" sx={frameSx}>
            <FlashcardsLearnHeader
                selectedCategory={selectedCategory}
                lastMarkUndoSnapshot={lastMarkUndoSnapshot}
                isAnimating={isAnimating}
                isUndoing={isUndoing}
                onBack={() => navigate('/flashcards/decks')}
                onUndo={handleUndoLastMark}
                workPoints={workPoints}
                showPinyin={showPinyin}
                onTogglePinyin={() => setShowPinyin(v => !v)}
            />
            <ContentArea className="mobile-demo-content">
                <InfoCardSection
                    currentEntry={currentEntry}
                    selectedTab={selectedTab}
                    onTabChange={setSelectedTab}
                    breakdownItems={breakdownItems}
                    showPinyin={showPinyin}
                    isFlipped={isFlipped}
                />
                <FlashCardSection
                    currentEntry={currentEntry}
                    nextEntry={nextEntry}
                    activeFrontSlot={activeFrontSlot}
                    flyOut={flyOut}
                    cardRef={cardRef}
                    dragPosition={dragPosition}
                    isDragging={isDragging}
                    isFlipped={isFlipped}
                    isAnimating={isAnimating}
                    selectedCategory={selectedCategory}
                    showPinyin={showPinyin}
                    handlers={handlers}
                />
            </ContentArea>
        </IPhoneFrame>
    );
};

export default FlashcardsLearnPage;
