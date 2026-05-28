import React, { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Box, CircularProgress, Tooltip, Typography, useMediaQuery, useTheme } from "@mui/material";
import { useAuth } from "../../AuthContext";
import { API_BASE_URL } from "../../constants";
import { ContentArea, MoreInfoPill } from "./styled";
import type { VocabEntry, MarkCardResult, LastMarkUndoSnapshot, SideOneLanguage } from "./types";

// Pick a random language for a card's Side 1. Side 2 always shows both.
const randomSideOneLanguage = (): SideOneLanguage => (Math.random() < 0.5 ? 'en' : 'zh');
import { useCardDrag } from "./useCardDrag";
import FlashcardsLearnHeader from "./FlashcardsLearnHeader";
import InfoCardSection from "./InfoCardSection";
import { getBreakdownItems as buildBreakdownItems } from "./breakdownUtils";
import { useEipTabs } from "./useEipTabs";
import EipTabStrip from "./EipTabStrip";
import TooManyTabsSnackbar from "./TooManyTabsSnackbar";
import FlashCardSection from "./FlashCardSection";
import SheetPanel, { type SheetPanelBodyHandle } from "./SheetPanel";
import SettingsPanelBody from "./SettingsPanelBody";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useTTS } from "../../hooks/useTTS";
import { useFlashcardLearnSettings } from "../../hooks/useFlashcardLearnSettings";

const FlashcardsLearnPage: React.FC = () => {
    usePageTitle("Learn");
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
    // -1 = no tab selected (deselected header state); set on tab-tap or sheet open.
    const [selectedTab, setSelectedTab] = useState(-1);
    const [lastMarkUndoSnapshot, setLastMarkUndoSnapshot] = useState<LastMarkUndoSnapshot | null>(null);
    const { settings: learnSettings, update: updateLearnSettings } = useFlashcardLearnSettings();
    const { showPinyin, showPinyinColor, showSegmentSpaces, autoplayChinese } = learnSettings;
    // Settings sheet open/close. Independent from the EIC sheet so the two can
    // coexist if needed (each one renders its own SheetPanel).
    const [settingsOpen, setSettingsOpen] = useState(false);
    // Ref to SettingsPanelBody so SheetPanel can wire its scroll/resize coupling.
    const settingsBodyRef = useRef<SheetPanelBodyHandle | null>(null);
    // Two-slot card stack: tracks which slot (0 or 1) is the front card and
    // which slot is currently animating off-screen.
    const [activeFrontSlot, setActiveFrontSlot] = useState<0 | 1>(0);
    const [flyOut, setFlyOut] = useState<{ slot: 0 | 1; direction: 'left' | 'right' } | null>(null);
    // Side 1 language for the current card and the next (back-slot) card.
    // Rolled forward on dismiss so the peeking card's language matches what it
    // will be once promoted to front.
    const [currentSideOneLanguage, setCurrentSideOneLanguage] = useState<SideOneLanguage>('zh');
    const [nextSideOneLanguage, setNextSideOneLanguage] = useState<SideOneLanguage>('zh');

    // Current entry derived from working loop
    const currentEntry: VocabEntry | null = workingLoop.length > 0 ? workingLoop[currentIndex] : null;
    // Next entry pre-rendered in the back card slot
    const nextEntry: VocabEntry | null = workingLoop.length > 1 ? workingLoop[(currentIndex + 1) % workingLoop.length] : null;

    // Log enrichment data for the current card whenever it changes (covers both correct and incorrect advances)
    useEffect(() => {
        if (!currentEntry) return;
        console.log('Current card:', { id: currentEntry.id, entryKey: currentEntry.entryKey });
        console.log('Current card enrichment:', {
            definition: currentEntry.definition ?? 'none',
            pronunciation: currentEntry.pronunciation ?? 'none',
            hskLevel: currentEntry.hskLevel ?? 'none',
            partsOfSpeech: currentEntry.partsOfSpeech ?? 'none',
            vernacularScore: currentEntry.vernacularScore ?? 'none',
            category: currentEntry.category ?? 'none',
            breakdown: currentEntry.breakdown ?? 'none',
            longDefinition: currentEntry.longDefinition ?? 'none',
            exampleSentences: currentEntry.exampleSentences ?? 'none',
            expansion: currentEntry.expansion ?? 'none',
            expansionSegments: currentEntry.expansionSegments ?? 'none',
            expansionMetadata: currentEntry.expansionMetadata ?? 'none',
            expansionLiteralTranslation: currentEntry.expansionLiteralTranslation ?? 'none',
            relatedWords: currentEntry.relatedWords ?? 'none',
            usedIn: currentEntry.usedIn ?? 'none',
            hasAudio: currentEntry.hasAudio ?? 'none',
        });
        // Working loop cards grouped by category
        const categories = ['Unfamiliar', 'Target', 'Comfortable', 'Mastered'] as const;
        const byCategory = Object.fromEntries(
            categories.map(cat => [cat, workingLoop.filter(c => c.category === cat)])
        );
        console.log('Working loop by category:', byCategory);
    }, [currentEntry, workingLoop]);

    const breakdownItems = buildBreakdownItems(currentEntry);

    // Drag/flip logic extracted into a custom hook
    const {
        cardRef,
        dragPosition,
        isDragging,
        isFlipped,
        setIsFlipped,
        resetDragPosition,
        showSwipeHint,
        showTapToFlipHint,
        shakeNonce,
        handlers,
    } = useCardDrag(isAnimating, (direction) => handleCardDismiss(direction), currentIndex);

    // TTS narration: auto-play the Chinese word the moment the Chinese face of
    // the card first becomes visible. Side 1 is randomized per card — when it's
    // 'zh' we play on mount; when it's 'en' we wait for the flip (Side 2 always
    // shows Chinese). Either way, exactly one play per card.
    //
    // Note: this effect can briefly see `chineseVisible === true` on a fresh
    // card before `setCurrentSideOneLanguage(randomSideOneLanguage())` swaps in
    // the new random value. The cleanup calls tts.cancel(); CloudTTSProvider's
    // cancel() bumps its generation so any in-flight fetch from this stale-state
    // render is dropped before it produces audio.
    const tts = useTTS();
    const chineseVisible = currentSideOneLanguage === 'zh' || isFlipped;
    useEffect(() => {
        if (!tts.enabled || !autoplayChinese) return;
        if (!chineseVisible || !currentEntry) return;
        tts.speak(currentEntry);
        // Cancel narration if the user advances mid-utterance.
        return () => tts.cancel();
        // tts.speak/cancel are stable across renders; depending on them would
        // re-fire narration on every settings change.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chineseVisible, currentEntry?.id, tts.enabled, autoplayChinese]);

    // EIC modal sheet — opened by the centered "More Info" pill button.
    const [isEicOpen, setIsEicOpen] = useState(false);
    // Tracks whether the sheet has been opened at least once for the current card
    // to suppress the discoverability pulse animation after first use.
    const [eicHintConsumed, setEicHintConsumed] = useState(false);

    // True until the first working-loop fetch resolves. Used to force the very
    // first card the user sees after navigating to /flashcards/learn to show
    // English on side one, regardless of the random side-one toggle. Subsequent
    // fetches (e.g. category swaps without unmounting) go back to random.
    const isFirstWorkingLoopFetchRef = useRef<boolean>(true);

    // Entry-tab system: tapping a breakdown/used-in row inside the EIP adds a
    // tab to the panel instead of stacking another panel on top. Each tab is
    // its own looked-up dictionary entry. Tapping the scrim closes the panel
    // and clears every tab (see closeEip).
    const eipStripRef = useRef<HTMLDivElement | null>(null);
    const eip = useEipTabs({ apiBaseUrl: API_BASE_URL, token, stripRef: eipStripRef });

    const openEicSheet = () => {
        if (!currentEntry) return;
        setIsEicOpen(true);
        setEicHintConsumed(true);
        if (selectedTab === -1) setSelectedTab(0);
        eip.openForRoot(currentEntry);
    };

    // Closes the EIP entirely and discards every tab (scrim tap or drag-dismiss).
    const closeEip = useCallback(() => {
        setIsEicOpen(false);
        eip.clear();
    }, [eip]);

    // Hint shown when the user taps the pill before flipping the card.
    // Auto-dismisses after a couple seconds, and clears immediately on flip.
    const [showFlipHint, setShowFlipHint] = useState(false);
    useEffect(() => {
        if (!showFlipHint) return;
        const t = setTimeout(() => setShowFlipHint(false), 2000);
        return () => clearTimeout(t);
    }, [showFlipHint]);
    useEffect(() => {
        if (isFlipped) setShowFlipHint(false);
    }, [isFlipped]);

    const handleMoreInfoClick = () => {
        if (!isFlipped) {
            setShowFlipHint(true);
            return;
        }
        openEicSheet();
    };

    // Lock body scroll while this page is mounted so wheel/touch events that
    // bubble past the EIC sheet can't shift the iPhone frame.
    useEffect(() => {
        const previous = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = previous; };
    }, []);

    // Reset EIC state when a new card loads — close the panel and drop all tabs.
    useEffect(() => {
        setIsEicOpen(false);
        setSelectedTab(-1);
        setEicHintConsumed(false);
        eip.clear();
    // eip.clear is stable but its identity changes when tabs change; we only
    // want to react to card changes, not tab changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentIndex]);

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

                // Server pre-warmed the TTS disk cache before responding, so
                // these prefetches just stream the MP3 bytes across the wire
                // into the browser's in-session blob cache. Skipped per-card
                // when hasAudio === false (synthesis errored server-side).
                cards.forEach((card: VocabEntry) => tts.prefetch(card));

                // New deck: both visible cards start on Side 1 with a freshly
                // randomized language. useCardDrag also resets isFlipped on
                // card change, but we set it explicitly here for clarity.
                setIsFlipped(false);
                // First time the user lands on /flashcards/learn, force English
                // on side one so the first card is always the EN prompt. Avoids
                // the iOS autoplay edge case on Chinese-side-one auto-narration
                // and gives a consistent initial view. Subsequent fetches
                // (category swaps without unmount) go back to random.
                setCurrentSideOneLanguage(
                    isFirstWorkingLoopFetchRef.current ? 'en' : randomSideOneLanguage()
                );
                isFirstWorkingLoopFetchRef.current = false;
                setNextSideOneLanguage(randomSideOneLanguage());
            } catch (err) {
                setError(err instanceof Error ? err.message : "Unknown error");
            } finally {
                setLoading(false);
            }
        };

        if (token) {
            fetchInitialCards();
        }
    // setIsFlipped is a useState setter from useCardDrag — React guarantees its
    // reference is stable, so adding it here doesn't cause extra re-runs.
    }, [token, selectedCategory, setIsFlipped]);

    // Mark card with retry logic.
    // `excludeIds` tells the server which cards are already in the working loop,
    // so the replacement card it returns won't duplicate one the user already has.
    const markCard = async (
        cardId: number,
        isCorrect: boolean,
        excludeIds: number[],
        retryCount = 0
    ): Promise<MarkCardResult | null> => {
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
                body: JSON.stringify({ cardId, isCorrect, excludeIds }),
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
                return markCard(cardId, isCorrect, excludeIds, retryCount + 1);
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
            currentSideOneLanguage,
            nextSideOneLanguage,
        };

        setIsAnimating(true);

        // Begin fly-out: current front slot animates off-screen in the swipe direction.
        // The back slot (already showing the next card) is immediately promoted to front.
        setFlyOut({ slot: activeFrontSlot, direction });
        setActiveFrontSlot(prev => (1 - prev) as 0 | 1);
        setCurrentIndex(prev => (prev + 1) % workingLoop.length);
        // Promote the peeking card's language to current and generate a fresh
        // random language for the new back-slot card. useCardDrag resets
        // isFlipped=false on card change (keyed off currentIndex).
        setCurrentSideOneLanguage(nextSideOneLanguage);
        setNextSideOneLanguage(randomSideOneLanguage());

        // Fire mark API in background — newCard replaces the current slot, not the next one,
        // so the UI doesn't need to wait for the response before advancing.
        // Send the current working loop's ids so the server doesn't return a duplicate.
        const excludeIds = workingLoop.map(card => card.id);
        markCard(currentCard.id, isCorrect, excludeIds)
            .then(markResult => {
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
                    // Pull the replacement's audio into the in-session blob
                    // cache while the user is studying other cards in the loop.
                    tts.prefetch(newCard);
                }
                setLastMarkUndoSnapshot({
                    cardId: currentCard.id,
                    markTimestamp,
                    displacedMark,
                    ...preDismissSnapshot,
                });
            })
            .catch(err => {
                // markCard handles retries internally and sets error state on failure,
                // but this catch prevents an unhandled promise rejection if something
                // unexpected throws after all retries are exhausted.
                console.error('Unhandled error in markCard background task:', err);
                setError('Failed to save progress. Please check your connection.');
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
            setCurrentSideOneLanguage(lastMarkUndoSnapshot.currentSideOneLanguage);
            setNextSideOneLanguage(lastMarkUndoSnapshot.nextSideOneLanguage);
            setLastMarkUndoSnapshot(null);
        } catch (err) {
            console.error('Failed to undo last mark:', err);
            setError(err instanceof Error ? err.message : 'Failed to undo last mark');
        } finally {
            setIsUndoing(false);
        }
    };

    // Phone-frame sizing comes from MobileDemoFrame via Layout.tsx

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
                    backgroundColor: theme.palette.flashcard.background,
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
                    backgroundColor: theme.palette.flashcard.background,
                }}
            >
                <Typography color="error">{error}</Typography>
            </Box>
        );
    }

    return (
        <>
            <FlashcardsLearnHeader
                selectedCategory={selectedCategory}
                lastMarkUndoSnapshot={lastMarkUndoSnapshot}
                isAnimating={isAnimating}
                isUndoing={isUndoing}
                onBack={() => navigate('/flashcards/decks')}
                onUndo={handleUndoLastMark}
                showPinyin={showPinyin}
                onTogglePinyin={() => updateLearnSettings({ showPinyin: !showPinyin })}
                autoplayChinese={autoplayChinese}
                onToggleAutoplayChinese={() => updateLearnSettings({ autoplayChinese: !autoplayChinese })}
                onSettingsClick={() => setSettingsOpen(true)}
            />
            <ContentArea className="mobile-demo-content">
                {/* Flashcard fills the full ContentArea. The EIC sheet now overlays
                    at the bottom rather than stacking above the flashcard. */}
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
                    showPinyinColor={showPinyinColor}
                    sideOneLanguage={currentSideOneLanguage}
                    nextSideOneLanguage={nextSideOneLanguage}
                    showSwipeHint={showSwipeHint}
                    showTapToFlipHint={showTapToFlipHint}
                    shakeNonce={shakeNonce}
                    handlers={handlers}
                    onSpeak={tts.enabled ? tts.speak : undefined}
                    speakingKey={tts.speakingKey}
                />
                {/* Centered pill button — ghosted before flip, full opacity after */}
                <Tooltip
                    open={showFlipHint}
                    title="Flip the card first to see extra info."
                    placement="top"
                    arrow
                >
                    <MoreInfoPill
                        className="mobile-demo-more-info-pill"
                        isFlipped={isFlipped}
                        hintActive={isFlipped && !eicHintConsumed}
                        onClick={handleMoreInfoClick}
                        aria-label="Open extra info"
                    >
                        <Typography sx={{ fontSize: 13, color: theme.palette.flashcard.onSurface, lineHeight: 1, transform: "translateY(-1px)" }}>↑</Typography>
                        <Typography sx={{ fontSize: 12, fontWeight: 600, color: theme.palette.flashcard.onSurface, letterSpacing: "0.02em", fontFamily: '"Inter", sans-serif' }}>More Info</Typography>
                    </MoreInfoPill>
                </Tooltip>
                {/* Modal EIC sheet — only mounted when open to reset animation on reopen.
                    Tapping a breakdown/used-in row inside the panel pushes a tab onto
                    the entry-tab strip above the grabber instead of stacking another
                    panel. Scrim/drag-dismiss closes the panel and clears every tab. */}
                {isEicOpen && (() => {
                    // Use the active tab's entry/breakdown when present; fall back to
                    // the current flashcard's data if the hook hasn't seeded yet
                    // (the openEicSheet path always seeds, so this fallback is only
                    // a paint-safety net).
                    const active = eip.activeTab;
                    const panelEntry = active?.entry ?? currentEntry;
                    const panelBreakdown = active?.breakdownItems ?? breakdownItems;
                    const panelSubTab = active ? active.selectedSubTab : (selectedTab === -1 ? 0 : selectedTab);
                    const onPanelTabChange = active ? eip.setActiveSubTab : setSelectedTab;
                    return (
                        <InfoCardSection
                            currentEntry={panelEntry}
                            selectedTab={panelSubTab}
                            onTabChange={onPanelTabChange}
                            breakdownItems={panelBreakdown}
                            showPinyin={showPinyin}
                            showPinyinColor={showPinyinColor}
                            showSegmentSpaces={showSegmentSpaces}
                            isFlipped={isFlipped}
                            onClose={closeEip}
                            onBreakdownItemClick={(item) => eip.openForEntryKey(item.character)}
                            onUsedInItemClick={(item) => eip.openForEntryKey(item.entryKey)}
                            depth={0}
                            onSpeak={tts.enabled ? tts.speak : undefined}
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
                    );
                })()}
                <TooManyTabsSnackbar signal={eip.overflowSignal} />
                {/* Settings sheet — same drag/scroll behavior as the EIP. Mounted
                    only while open so the open animation replays on each invocation.
                    Depth 99 keeps it above any open EIP panel stack. */}
                {settingsOpen && (
                    <SheetPanel
                        onClose={() => setSettingsOpen(false)}
                        bodyRef={settingsBodyRef}
                        depth={99}
                    >
                        <SettingsPanelBody
                            ref={settingsBodyRef}
                            settings={learnSettings}
                            update={updateLearnSettings}
                        />
                    </SheetPanel>
                )}
            </ContentArea>
        </>
    );
};

export default FlashcardsLearnPage;
