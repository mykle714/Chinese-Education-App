import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { API_BASE_URL } from "../../../constants";
import { CARD_FLY_OUT_MS } from "./constants";
import type {
    VocabEntry,
    MarkCardResult,
    LastMarkUndoSnapshot,
    SideOneLanguage,
    MarkType,
} from "./types";

// Which mark type a flp review produces (docs/MASTERY_REWORK.md): an English-first
// prompt asks the learner to PRODUCE the foreign word; any other (foreign-first)
// prompt tests RECOGNITION of the meaning.
const markTypeForSideOne = (sideOne: SideOneLanguage): MarkType =>
    sideOne === "en" ? "production" : "recognition";

// Pick a random language for a card's Side 1. Side 2 always shows both.
const randomSideOneLanguage = (): SideOneLanguage => (Math.random() < 0.5 ? "en" : "zh");

// Minimal contract the working loop needs from the card-drag layer. Passed as a
// ref so this hook can read the latest flip value (for undo snapshots) and drive
// the drag layer (reset flip / reset drag position) without taking a render-time
// dependency on useCardDrag, which is initialized *after* this hook in the page.
export interface CardDragControls {
    isFlipped: boolean;
    setIsFlipped: (value: boolean) => void;
    // Snaps the front card's drag translation back to center. Called once the
    // fly-out completes — useCardDrag's per-card reset effect resets flip state
    // but intentionally leaves drag position alone (the fly-out animates from the
    // release position), so the working loop clears it here.
    resetDragPosition: () => void;
}

// Difficulty modes launched from the decks page Easy/Hard buttons. null = Mix.
export type StudyMode = "easy" | "hard";

interface UseWorkingLoopArgs {
    token: string | null;
    selectedCategory: string | null;
    // Difficulty mode for this session, or null for the default Mix distribution.
    // Drives the loop-fetch distribution, the mark replacement pool, and the
    // wind-down behavior when the eligible pool is exhausted.
    mode: StudyMode | null;
    // TTS prefetch — warms the in-session blob cache for newly loaded cards.
    prefetch: (entry: VocabEntry) => void;
    cardDragRef: RefObject<CardDragControls>;
}

export interface UseWorkingLoopReturn {
    workingLoop: VocabEntry[];
    currentIndex: number;
    currentEntry: VocabEntry | null;
    nextEntry: VocabEntry | null;
    loading: boolean;
    error: string | null;
    isAnimating: boolean;
    isUndoing: boolean;
    lastMarkUndoSnapshot: LastMarkUndoSnapshot | null;
    activeFrontSlot: 0 | 1;
    flyOut: { slot: 0 | 1; direction: "left" | "right" } | null;
    currentSideOneLanguage: SideOneLanguage;
    nextSideOneLanguage: SideOneLanguage;
    handleCardDismiss: (direction: "left" | "right") => Promise<void>;
    handleUndoLastMark: () => Promise<void>;
}

/**
 * Owns the flashcard working-loop domain: the distributed-loop fetch, the
 * two-slot card-stack animation state machine, the mark/undo network layer, and
 * the per-card Side 1 language. Extracted from FlashcardsLearnPage so the page
 * is a thin presentational shell and this retry/snapshot logic is isolated.
 *
 * The card-drag layer (useCardDrag) is intentionally *not* owned here — it
 * depends on this hook's `isAnimating`/`currentIndex`/`handleCardDismiss`, so it
 * must be initialized after. The `cardDragRef` bridge breaks that cycle.
 */
export function useWorkingLoop({
    token,
    selectedCategory,
    mode,
    prefetch,
    cardDragRef,
}: UseWorkingLoopArgs): UseWorkingLoopReturn {
    const [workingLoop, setWorkingLoop] = useState<VocabEntry[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isAnimating, setIsAnimating] = useState(false);
    const [isUndoing, setIsUndoing] = useState(false);
    const [lastMarkUndoSnapshot, setLastMarkUndoSnapshot] = useState<LastMarkUndoSnapshot | null>(null);

    // Two-slot card stack: tracks which slot (0 or 1) is the front card and
    // which slot is currently animating off-screen.
    const [activeFrontSlot, setActiveFrontSlot] = useState<0 | 1>(0);
    const [flyOut, setFlyOut] = useState<{ slot: 0 | 1; direction: "left" | "right" } | null>(null);

    // Side 1 language for the current card and the next (back-slot) card. Rolled
    // forward on dismiss so the peeking card's language matches what it will be
    // once promoted to front.
    const [currentSideOneLanguage, setCurrentSideOneLanguage] = useState<SideOneLanguage>("zh");
    const [nextSideOneLanguage, setNextSideOneLanguage] = useState<SideOneLanguage>("zh");

    // True until the first working-loop fetch resolves. Used to force the very
    // first card the user sees after navigating to /flashcards/learn to show
    // English on side one, regardless of the random side-one toggle. Subsequent
    // fetches (e.g. category swaps without unmounting) go back to random.
    const isFirstWorkingLoopFetchRef = useRef<boolean>(true);

    // Current entry derived from the working loop.
    const currentEntry: VocabEntry | null = workingLoop.length > 0 ? workingLoop[currentIndex] : null;
    // Next entry pre-rendered in the back card slot.
    const nextEntry: VocabEntry | null =
        workingLoop.length > 1 ? workingLoop[(currentIndex + 1) % workingLoop.length] : null;

    // Fetch distributed working loop (1 Mastered, 2 Comfortable, 2 Unfamiliar, 5 Target).
    useEffect(() => {
        const fetchInitialCards = async () => {
            try {
                setLoading(true);
                setError(null);

                const params = new URLSearchParams();
                if (selectedCategory) params.set("category", selectedCategory);
                if (mode) params.set("mode", mode);
                const query = params.toString();
                const url = `${API_BASE_URL}/api/onDeck/distributed-working-loop${query ? `?${query}` : ""}`;

                const response = await fetch(url, { credentials: "include" });

                if (!response.ok) throw new Error("Failed to fetch distributed working loop");
                const data = await response.json();
                const cards = Array.isArray(data) ? data : [data];

                console.log(
                    `Loaded ${cards.length} cards in distributed working loop${selectedCategory ? ` (category: ${selectedCategory})` : ""}${mode ? ` (mode: ${mode})` : ""}`
                );
                setWorkingLoop(cards);
                setLastMarkUndoSnapshot(null);

                // Server pre-warmed the TTS disk cache before responding, so these
                // prefetches just stream the MP3 bytes across the wire into the
                // browser's in-session blob cache. Skipped per-card when
                // hasAudio === false (synthesis errored server-side).
                cards.forEach((card: VocabEntry) => prefetch(card));

                // New deck: both visible cards start on Side 1. useCardDrag also
                // resets isFlipped on card change, but currentIndex stays 0 on a
                // fresh fetch so that reset may not fire — reset explicitly here.
                cardDragRef.current?.setIsFlipped(false);
                // First time the user lands on /flashcards/learn, force English on
                // side one so the first card is always the EN prompt. Avoids the
                // iOS autoplay edge case on Chinese-side-one auto-narration and
                // gives a consistent initial view. Subsequent fetches (category
                // swaps without unmount) go back to random.
                setCurrentSideOneLanguage(
                    isFirstWorkingLoopFetchRef.current ? "en" : randomSideOneLanguage()
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
    // Keyed on Boolean(token) — the STABLE auth-presence flag — NOT the raw
    // `token` string. The access token silently refreshes every ~15 min; keying
    // on `token` would re-fetch the working loop and reset the card stack
    // mid-study. Boolean(token) only flips on login/logout. See CLAUDE.md
    // "Never reload on token refresh". prefetch/cardDragRef are stable refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [Boolean(token), selectedCategory, mode]);

    // Mark card with retry logic.
    // `excludeIds` tells the server which cards are already in the working loop,
    // so the replacement card it returns won't duplicate one the user already has.
    const markCard = useCallback(async (
        cardId: number,
        isCorrect: boolean,
        markType: MarkType,
        excludeIds: number[],
        retryCount = 0
    ): Promise<MarkCardResult | null> => {
        try {
            const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
            const headers: HeadersInit = {
                "Content-Type": "application/json",
                "x-user-timezone": userTimeZone,
            };
            if (token && token !== "null" && token !== "undefined") {
                headers["Authorization"] = `Bearer ${token}`;
            }

            const response = await fetch(`${API_BASE_URL}/api/flashcards/mark`, {
                method: "POST",
                headers,
                credentials: "include",
                // `mode` lets the server cap the replacement card to the mode's
                // allowed categories (and return newCard:null when exhausted).
                body: JSON.stringify({ cardId, isCorrect, type: markType, excludeIds, mode: mode ?? undefined }),
            });

            if (!response.ok) {
                throw new Error("Failed to mark card");
            }

            const data = await response.json();
            if (!data?.markTimestamp) {
                throw new Error("Mark response missing mark timestamp");
            }

            return {
                newCard: data.newCard || null,
                markTimestamp: data.markTimestamp,
                markType,
                displacedMark: data.displacedMark || null,
            };
        } catch (err) {
            if (retryCount < 3) {
                // Exponential backoff: wait 500ms, 1s, 2s
                await new Promise(resolve => setTimeout(resolve, 500 * Math.pow(2, retryCount)));
                return markCard(cardId, isCorrect, markType, excludeIds, retryCount + 1);
            }
            console.error("Failed to mark card after retries:", err);
            setError("Failed to save progress. Please check your connection.");
            return null;
        }
    }, [token, mode]);

    const handleCardDismiss = useCallback(async (direction: "left" | "right") => {
        if (workingLoop.length === 0 || isAnimating) return;

        const currentCard = workingLoop[currentIndex];
        const isCorrect = direction === "right";
        // The prompt language showing on Side 1 decides the mark type.
        const markType = markTypeForSideOne(currentSideOneLanguage);
        const preDismissSnapshot: Omit<LastMarkUndoSnapshot, "cardId" | "markTimestamp" | "markType" | "displacedMark"> = {
            workingLoop: [...workingLoop],
            currentIndex,
            isFlipped: cardDragRef.current?.isFlipped ?? false,
            currentSideOneLanguage,
            nextSideOneLanguage,
        };

        setIsAnimating(true);

        // Begin fly-out: current front slot animates off-screen in the swipe
        // direction. The back slot (already showing the next card) is immediately
        // promoted to front.
        setFlyOut({ slot: activeFrontSlot, direction });
        setActiveFrontSlot(prev => (1 - prev) as 0 | 1);
        setCurrentIndex(prev => (prev + 1) % workingLoop.length);
        // Promote the peeking card's language to current and generate a fresh
        // random language for the new back-slot card. useCardDrag resets
        // isFlipped=false on card change (keyed off currentIndex).
        setCurrentSideOneLanguage(nextSideOneLanguage);
        setNextSideOneLanguage(randomSideOneLanguage());

        // Fire mark API in background — newCard replaces the current slot, not the
        // next one, so the UI doesn't need to wait for the response before
        // advancing. Send the current working loop's ids so the server doesn't
        // return a duplicate.
        const excludeIds = workingLoop.map(card => card.id);
        markCard(currentCard.id, isCorrect, markType, excludeIds)
            .then(markResult => {
                if (!markResult) return;
                const { newCard, markTimestamp, displacedMark } = markResult;
                console.log(`Card marked: ${currentCard.entryKey} (${isCorrect ? "correct" : "incorrect"})`);
                if (isCorrect && newCard) {
                    // Patch the slot the dismissed card occupied — user won't see it for a full cycle
                    setWorkingLoop(prevLoop => {
                        const newLoop = [...prevLoop];
                        newLoop[preDismissSnapshot.currentIndex] = newCard;
                        return newLoop;
                    });
                    // Pull the replacement's audio into the in-session blob cache
                    // while the user is studying other cards in the loop.
                    prefetch(newCard);
                } else if (mode && isCorrect && !newCard) {
                    // Mode session, card passed, but the eligible pool is exhausted —
                    // wind the loop down by removing the just-passed card instead of
                    // recycling it. Remove by id (the optimistic currentIndex has
                    // already advanced, so index math would be brittle), then re-anchor
                    // currentIndex to the card now on front (the one promoted on dismiss)
                    // so the visible card doesn't jump. Empty loop ⇒ currentEntry null
                    // ⇒ "no more <mode> cards remaining" empty state.
                    const preLoop = preDismissSnapshot.workingLoop;
                    const promotedCard = preLoop.length > 1
                        ? preLoop[(preDismissSnapshot.currentIndex + 1) % preLoop.length]
                        : null;
                    setWorkingLoop(prevLoop => {
                        const newLoop = prevLoop.filter(card => card.id !== currentCard.id);
                        const anchorIndex = promotedCard
                            ? newLoop.findIndex(card => card.id === promotedCard.id)
                            : -1;
                        setCurrentIndex(anchorIndex >= 0 ? anchorIndex : 0);
                        return newLoop;
                    });
                }
                setLastMarkUndoSnapshot({
                    cardId: currentCard.id,
                    markTimestamp,
                    markType,
                    displacedMark,
                    ...preDismissSnapshot,
                });
            })
            .catch(err => {
                // markCard handles retries internally and sets error state on
                // failure, but this catch prevents an unhandled promise rejection
                // if something unexpected throws after all retries are exhausted.
                console.error("Unhandled error in markCard background task:", err);
                setError("Failed to save progress. Please check your connection.");
            });

        // Wait for the fly-out CSS transition to complete, then clear the fly-out
        // state. The flew-out slot snaps back to center (hidden behind the new
        // front card) and becomes the next back card. The drag layer resets its
        // own drag position via the resetKey effect on currentIndex change.
        await new Promise(resolve => setTimeout(resolve, CARD_FLY_OUT_MS));
        setFlyOut(null);
        cardDragRef.current?.resetDragPosition();
        setIsAnimating(false);
    }, [workingLoop, isAnimating, currentIndex, activeFrontSlot, currentSideOneLanguage, nextSideOneLanguage, markCard, prefetch, cardDragRef, mode]);

    const handleUndoLastMark = useCallback(async () => {
        if (!lastMarkUndoSnapshot || isAnimating || isUndoing) return;

        try {
            setIsUndoing(true);
            setError(null);

            const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
            const headers: HeadersInit = {
                "Content-Type": "application/json",
                "x-user-timezone": userTimeZone,
            };
            if (token && token !== "null" && token !== "undefined") {
                headers["Authorization"] = `Bearer ${token}`;
            }

            const response = await fetch(`${API_BASE_URL}/api/flashcards/undo-last-mark`, {
                method: "POST",
                headers,
                credentials: "include",
                body: JSON.stringify({
                    cardId: lastMarkUndoSnapshot.cardId,
                    markTimestamp: lastMarkUndoSnapshot.markTimestamp,
                    markType: lastMarkUndoSnapshot.markType,
                    displacedMark: lastMarkUndoSnapshot.displacedMark,
                }),
            });

            if (!response.ok) {
                const responseData = await response.json().catch(() => null);
                throw new Error(responseData?.error || "Failed to undo last mark");
            }

            setWorkingLoop(lastMarkUndoSnapshot.workingLoop);
            setCurrentIndex(lastMarkUndoSnapshot.currentIndex);
            cardDragRef.current?.setIsFlipped(lastMarkUndoSnapshot.isFlipped);
            setCurrentSideOneLanguage(lastMarkUndoSnapshot.currentSideOneLanguage);
            setNextSideOneLanguage(lastMarkUndoSnapshot.nextSideOneLanguage);
            setLastMarkUndoSnapshot(null);
        } catch (err) {
            console.error("Failed to undo last mark:", err);
            setError(err instanceof Error ? err.message : "Failed to undo last mark");
        } finally {
            setIsUndoing(false);
        }
    }, [lastMarkUndoSnapshot, isAnimating, isUndoing, token, cardDragRef]);

    return {
        workingLoop,
        currentIndex,
        currentEntry,
        nextEntry,
        loading,
        error,
        isAnimating,
        isUndoing,
        lastMarkUndoSnapshot,
        activeFrontSlot,
        flyOut,
        currentSideOneLanguage,
        nextSideOneLanguage,
        handleCardDismiss,
        handleUndoLastMark,
    };
}
