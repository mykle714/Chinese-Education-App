import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { API_BASE_URL } from "../../../constants";
import { useLaunchCollection } from "../useLaunchCollection";
import { collectionLaunchParams, collectionMarkFields } from "../collectionRef";
import { markFlashcard, undoFlashcardMark } from "../../../api/flashcards";
import { CARD_FLY_OUT_MS } from "../constants";
import { provisionalWords } from "../../../utils/provisionalCards";
import type {
    VocabEntry,
    MarkCardResult,
    LastMarkUndoSnapshot,
    SideOneLanguage,
    MarkType,
} from "../types";

// Which mark type a flp review produces (docs/MASTERY_REWORK.md): an English-first
// prompt asks the learner to PRODUCE the foreign word; any other (foreign-first)
// prompt tests RECOGNITION of the meaning.
const markTypeForSideOne = (sideOne: SideOneLanguage): MarkType =>
    sideOne === "en" ? "production" : "recognition";

// Choose which language shows on a specific card's Side 1, honoring the server's
// per-type cooldown steering (docs/MASTERY_REWORK.md § Per-type cooldown). The
// card's `readyMarkTypes` lists the flp mark types currently off cooldown; we map
// production ↔ 'en' (English-first) and recognition ↔ 'zh' (foreign-first),
// mirroring markTypeForSideOne:
//   - only production ready  → English-first
//   - only recognition ready → foreign-first
//   - both ready (or the field is absent, e.g. an older payload) → honor
//     `preferEnglishFirst`, otherwise a coin flip (the historical behavior).
// Side 2 always shows both.
const sideOneForCard = (
    card: VocabEntry | null | undefined,
    preferEnglishFirst = false
): SideOneLanguage => {
    const ready = card?.readyMarkTypes;
    const canProduction = !ready || ready.includes("production");
    const canRecognition = !ready || ready.includes("recognition");
    if (canProduction && !canRecognition) return "en";
    if (canRecognition && !canProduction) return "zh";
    if (preferEnglishFirst) return "en";
    return Math.random() < 0.5 ? "en" : "zh";
};

// Minimal contract the working loop needs from the card-drag layer. Passed as a
// ref so this hook can read the latest flip value (for undo snapshots) and drive
// the drag layer (reset flip / reset drag position) without taking a render-time
// dependency on useCardDrag, which is initialized *after* this hook in the page.
export interface CardDragControls {
    setIsFlipped: (value: boolean) => void;
    // Brings a card back on Side 2 (used by mark-undo — the user has already seen
    // that card's answer). Takes the resetKey (currentIndex) the restore targets
    // so the drag layer's per-card reset effect doesn't flip it back to Side 1.
    restoreFlipped: (targetResetKey: number) => void;
    // Snaps the front card's drag translation back to center. Called once the
    // fly-out completes — useCardDrag's per-card reset effect resets flip state
    // but intentionally leaves drag position alone (the fly-out animates from the
    // release position), so the working loop clears it here.
    resetDragPosition: () => void;
}

// Difficulty modes launched from the decks page Review/Challenge buttons. null = Study.
export type StudyMode = "review" | "challenge";

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
    /**
     * Temporary (provisional) words this session has shown, accumulated across the
     * initial loop AND every refill. Empty when the learner's own deck covered the
     * session. See docs/PROVISIONAL_CARDS.md.
     */
    provisionalSeen: string[];
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
    // Which collection this session was launched from (docs/DECKS_FEATURE.md) — null
    // for an ordinary launch from the Review/Study/Challenge buttons. Read from the flp's own
    // URL, and threaded into BOTH the initial loop fetch and every mark call (which
    // is what refills the loop).
    const launchCollection = useLaunchCollection();
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

    // Temporary (provisional) cards the server lent so this loop could reach the flp
    // baseline (docs/PROVISIONAL_CARDS.md). flp is NOT itemized — the loop refills as
    // you go, so the played set isn't known up front and the arrival notice is generic
    // — but the words are accumulated here anyway so the end-of-session offer can name
    // them. The ref is the authoritative accumulator; the state exists to re-render.
    const provisionalSeenRef = useRef<Set<string>>(new Set());
    const [provisionalSeen, setProvisionalSeen] = useState<string[]>([]);

    // Fold every lent word the loop has shown into the accumulator. Keyed on the loop
    // itself so refills (a mark's replacement card) are picked up as they land, not
    // just the initial fetch.
    useEffect(() => {
        const words = provisionalWords(workingLoop);
        if (words.length === 0) return;
        let changed = false;
        for (const word of words) {
            if (!provisionalSeenRef.current.has(word)) {
                provisionalSeenRef.current.add(word);
                changed = true;
            }
        }
        if (changed) setProvisionalSeen([...provisionalSeenRef.current]);
    }, [workingLoop]);

    // Fetch distributed working loop (1 Mastered, 2 Comfortable, 2 Unfamiliar, 5 Target).
    useEffect(() => {
        const fetchInitialCards = async () => {
            try {
                setLoading(true);
                setError(null);

                const params = new URLSearchParams();
                if (selectedCategory) params.set("category", selectedCategory);
                if (mode) params.set("mode", mode);
                // Restrict the loop to the collection this session was launched from
                // (docs/DECKS_FEATURE.md). Composes with `mode`: a deck opened in Challenge
                // mode draws that deck's Unfamiliar/Target cards.
                if (launchCollection) {
                    for (const [key, value] of Object.entries(collectionLaunchParams(launchCollection))) {
                        params.set(key, value);
                    }
                }
                const query = params.toString();
                const url = `${API_BASE_URL}/api/onDeck/distributedWorkingLoop${query ? `?${query}` : ""}`;

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
                // First time the user lands on /flashcards/learn, prefer English on
                // side one so the first card is (when eligible) the EN prompt. Avoids
                // the iOS autoplay edge case on Chinese-side-one auto-narration and
                // gives a consistent initial view. Per-type cooldown still wins: if
                // the first card's production track is cooling, sideOneForCard falls
                // back to the recognition face. Subsequent fetches (category swaps
                // without unmount) go back to the steered coin flip.
                setCurrentSideOneLanguage(
                    sideOneForCard(cards[0], isFirstWorkingLoopFetchRef.current)
                );
                isFirstWorkingLoopFetchRef.current = false;
                setNextSideOneLanguage(sideOneForCard(cards[1]));
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
            // `mode` lets the server cap the replacement card to the mode's
            // allowed categories (and return newCard:null when exhausted).
            //
            // The collection fields matter just as much: THIS call is what refills the
            // working loop, so a deck-launched session that omitted them would serve
            // an off-deck card the moment the learner answered correctly
            // (docs/DECKS_FEATURE.md).
            const data = await markFlashcard({
                cardId,
                isCorrect,
                type: markType,
                excludeIds,
                mode: mode ?? undefined,
                ...collectionMarkFields(launchCollection),
            });

            return {
                newCard: data.newCard,
                markTimestamp: data.markTimestamp,
                markType,
                displacedMark: data.displacedMark,
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
        // No `token` dep: markFlashcard reads the header at call time, so this
        // callback's identity survives a silent refresh (CLAUDE.md ⛔ rule).
        // `launchCollection` is likewise omitted: it is parsed from this page's own
        // URL, which cannot change without remounting the flp, so the closure can
        // never go stale — and listing it would rebuild this callback on every
        // render that re-parses the query string.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mode]);

    const handleCardDismiss = useCallback(async (direction: "left" | "right") => {
        if (workingLoop.length === 0 || isAnimating) return;

        const currentCard = workingLoop[currentIndex];
        const isCorrect = direction === "right";
        // The prompt language showing on Side 1 decides the mark type.
        const markType = markTypeForSideOne(currentSideOneLanguage);
        const preDismissSnapshot: Omit<LastMarkUndoSnapshot, "cardId" | "markTimestamp" | "markType" | "displacedMark"> = {
            workingLoop: [...workingLoop],
            currentIndex,
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
        // Promote the peeking card's language to current and choose the new
        // back-slot card's Side 1 from ITS readyMarkTypes (steered per-type
        // cooldown). The new back card is two ahead of the outgoing front (the
        // card just promoted to front sits one ahead). useCardDrag resets
        // isFlipped=false on card change (keyed off currentIndex).
        setCurrentSideOneLanguage(nextSideOneLanguage);
        const newBackCard = workingLoop[(currentIndex + 2) % workingLoop.length];
        setNextSideOneLanguage(sideOneForCard(newBackCard));

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

            // ApiError carries the server's `error` field as its message, which is
            // what the hand-rolled version reconstructed from the response body.
            await undoFlashcardMark({
                cardId: lastMarkUndoSnapshot.cardId,
                markTimestamp: lastMarkUndoSnapshot.markTimestamp,
                markType: lastMarkUndoSnapshot.markType,
                displacedMark: lastMarkUndoSnapshot.displacedMark,
            });

            setWorkingLoop(lastMarkUndoSnapshot.workingLoop);
            setCurrentIndex(lastMarkUndoSnapshot.currentIndex);
            // Undo always lands on Side 2: a card can only be dismissed after it
            // has been flipped, so the user has already seen its answer — sending
            // it back to Side 1 would re-quiz them on a card they just marked.
            cardDragRef.current?.restoreFlipped(lastMarkUndoSnapshot.currentIndex);
            setCurrentSideOneLanguage(lastMarkUndoSnapshot.currentSideOneLanguage);
            setNextSideOneLanguage(lastMarkUndoSnapshot.nextSideOneLanguage);
            setLastMarkUndoSnapshot(null);
        } catch (err) {
            console.error("Failed to undo last mark:", err);
            setError(err instanceof Error ? err.message : "Failed to undo last mark");
        } finally {
            setIsUndoing(false);
        }
        // No `token` dep — see the note on markCard above.
    }, [lastMarkUndoSnapshot, isAnimating, isUndoing, cardDragRef]);

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
        /** Lent words this session has shown; drives the notice + the "keep these" offer. */
        provisionalSeen,
    };
}
