import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { markFlashcard, undoFlashcardMark } from "../../../api/flashcards";
import { fetchDistributedWorkingLoop, fetchLoopRefill, type WorkingLoopRequest } from "../../../api/workingLoop";
import { insertBehindFront, removeFromLoop } from "./loopSplice";
import { CARD_FLY_OUT_MS } from "../constants";
import { isProvisional } from "../../../utils/provisionalCards";
import { useMarkedLentWords } from "../../../hooks/useMarkedLentWords";
import type {
    VocabEntry,
    MarkCardResult,
    LastMarkUndoSnapshot,
    SideOneLanguage,
    MarkType,
} from "../types";
// Face steering — which language Side 1 shows, and which mark type that face writes.
// Pure util so the weaker-track rule can be tested without the hook.
import { markTypeForSideOne, sideOneForCard } from "../../../utils/flpFaceSteering";
import { FLP_MARK_SURFACE } from "../../../../server/contracts/wire";
import { appendTypedMark } from "../../../../server/contracts/mastery";
import type { WritingAttempt } from "../../../components/handwriting/types";

// Minimal contract the working loop needs from the card-drag layer. Passed as a
// ref so this hook can read the latest flip value (for undo snapshots) and drive
// the drag layer (reset flip / reset drag position) without taking a render-time
// dependency on useCardDrag, which is initialized *after* this hook in the page.
export interface CardDragControls {
    // Full flip-tracking reset for a card swapped in WITHOUT a currentIndex change
    // (a fresh fetch lands at index 0, so useCardDrag's per-card effect won't fire).
    resetCard: () => void;
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

// The session's flp bar (server/contracts/studyMode.ts) — the Deck Tower world studied.
export type { FlpWorld } from "../../../../server/contracts/studyMode";
import type { FlpWorld } from "../../../../server/contracts/studyMode";

interface UseWorkingLoopArgs {
    token: string | null;
    // The session's flp bar (server/contracts/studyMode.ts): `reading` for the reading flp.
    // Drives the loop fetch, the refill, the face and the mark type. Always Study Mix.
    world: FlpWorld;
    // TTS prefetch — warms the in-session blob cache for newly loaded cards.
    prefetch: (entry: VocabEntry) => void;
    cardDragRef: RefObject<CardDragControls>;
    /**
     * Fired once per dismiss that actually ADVANCES the stack (after the empty-loop /
     * mid-animation guards) — left, right and the writing flp's tap alike, including a
     * mark the server later suppresses on cooldown. And once per undo that actually
     * restored a card. The flp game break counts cards off these
     * (docs/FLP_GAME_BREAKS.md § 1). Read through a ref, so an inline callback does not
     * rebuild `handleCardDismiss` every render.
     */
    onDismissed?: () => void;
    /**
     * `wasCorrect`: the undone mark was a right swipe (the snapshot's `isCorrect`).
     * `lent`: the restored card is a lent (provisional) one, which the tower never counted.
     */
    onUndone?: (wasCorrect: boolean, lent: boolean) => void;
    /**
     * Fired with each dismiss's DIRECTION, alongside `onDismissed` (true = right swipe =
     * correct), and whether the card was LENT. Optimistic: it fires at the swipe, before
     * the server answers. The Deck Tower takes a card off its own count per correct mark
     * on a non-lent card — the loop deals only off-cooldown cards, which are exactly what
     * the tower counts — and reconciles against the server's figure when the visit ends
     * (docs/DECK_TOWER.md § "Studying the tower").
     */
    onMarked?: (isCorrect: boolean, lent: boolean) => void;
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
    /**
     * `writing` is the writing flp's graded attempt (docs/WRITING_PRACTICE_REWORK.md § 3):
     * required on `world: "writing"`, where the server fans it out per character.
     */
    handleCardDismiss: (direction: "left" | "right", writing?: WritingAttempt) => Promise<void>;
    handleUndoLastMark: () => Promise<void>;
    clearUndo: () => void;
    /**
     * Temporary (provisional) words this session actually REVIEWED — the lent cards the
     * learner marked. Drives the "keep these cards?" offers, which must not ask
     * about the loop's untouched tail: the loop holds ~10 cards, so a session ended
     * after three would otherwise offer ten. See docs/PROVISIONAL_CARDS.md § 5.
     */
    provisionalReviewed: string[];
    /**
     * Take the cards an flp game break cleared out of the loop and refill their slots
     * (docs/FLP_GAME_BREAKS.md § 4a). Ids not in the loop are ignored. The cards leave at
     * once; replacements are spliced in behind the front card when they arrive.
     */
    replaceGameCleared: (cardIds: readonly number[]) => void;
    /**
     * The session's LEND SWITCH (docs/DECK_TOWER.md § "Running out of ready cards"). Off,
     * the loop holds only the learner's own off-cooldown cards and every refill is one
     * too, so it runs down to empty. On, the deal and every refill may be lent cards.
     */
    lendMode: boolean;
    /** Turn the lend switch on: the loop is re-dealt with lending allowed. No-op if on. */
    enableLend: () => void;
    /**
     * Turn the lend switch off (the Deck Tower visit ended). If it was on, the loop is
     * re-dealt from the learner's own ready cards, so the next visit starts on those.
     */
    resetLend: () => void;
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
    world,
    prefetch,
    cardDragRef,
    onDismissed,
    onUndone,
    onMarked,
}: UseWorkingLoopArgs): UseWorkingLoopReturn {
    // Latest-ref for the counter callbacks (see UseWorkingLoopArgs.onDismissed).
    const countersRef = useRef({ onDismissed, onUndone, onMarked });
    countersRef.current = { onDismissed, onUndone, onMarked };
    // The session's lend switch. Owned here, with the loop it governs — NOT by the Deck
    // Tower, whose count is a separate figure (docs/DECK_TOWER.md § "Running out of ready
    // cards"). Flipping it re-runs the deal effect below, so the loop is re-dealt under the
    // new rule. A ref mirrors it for the background mark/refill calls.
    const [lendMode, setLendMode] = useState(false);
    const lendModeRef = useRef(lendMode);
    lendModeRef.current = lendMode;
    // Flipping the switch also marks the loop LOADING in the same batch: the deal effect
    // only sets it a render later, and in between the page would read "switch on, loaded,
    // no card" as "nothing more to deal" (FlashcardsLearnPage → `loopDry`). No-ops when the
    // switch is already where it is asked to be, so nothing is re-dealt for nothing.
    const enableLend = useCallback(() => {
        if (lendModeRef.current) return;
        setLoading(true);
        setLendMode(true);
    }, []);
    const resetLend = useCallback(() => {
        if (!lendModeRef.current) return;
        setLoading(true);
        setLendMode(false);
    }, []);
    // The deal's request: the session's world and its lend switch (src/api/workingLoop.ts).
    const loopRequest: WorkingLoopRequest = { world, lend: lendMode };
    const [workingLoop, setWorkingLoop] = useState<VocabEntry[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isAnimating, setIsAnimating] = useState(false);
    const [isUndoing, setIsUndoing] = useState(false);
    const [lastMarkUndoSnapshot, setLastMarkUndoSnapshot] = useState<LastMarkUndoSnapshot | null>(null);
    // Latest committed currentIndex, readable from inside a background mark's
    // `.then` — by the time a refill response lands the learner may have swiped
    // on (often more than once), so the dismiss-time closure's index is stale.
    // Used to re-anchor on the card actually on front when a slot is removed.
    const currentIndexRef = useRef(0);
    currentIndexRef.current = currentIndex;
    // Latest loop, for `replaceGameCleared` (called from an effect after a break, so it
    // must not close over a stale loop, and must not rebuild on every loop change).
    const workingLoopRef = useRef(workingLoop);
    workingLoopRef.current = workingLoop;
    // Break refills in flight. While one is and the loop is EMPTY (the game cleared every
    // card), the hook reports `loading`, so neither the empty state nor the Deck Tower's
    // "loop ran dry → climb out" fires before the replacements land.
    const [breakRefillsInFlight, setBreakRefillsInFlight] = useState(0);

    // Two-slot card stack: tracks which slot (0 or 1) is the front card and
    // which slot is currently animating off-screen.
    const [activeFrontSlot, setActiveFrontSlot] = useState<0 | 1>(0);
    const [flyOut, setFlyOut] = useState<{ slot: 0 | 1; direction: "left" | "right" } | null>(null);

    // Side 1 language for the current card and the next (back-slot) card. Rolled
    // forward on dismiss so the peeking card's language matches what it will be
    // once promoted to front. Set from the dealt cards when the loop lands (`dealLoop`).
    const [currentSideOneLanguage, setCurrentSideOneLanguage] = useState<SideOneLanguage>("zh");
    const [nextSideOneLanguage, setNextSideOneLanguage] = useState<SideOneLanguage>("zh");

    // Current entry derived from the working loop.
    const currentEntry: VocabEntry | null = workingLoop.length > 0 ? workingLoop[currentIndex] : null;
    // Next entry pre-rendered in the back card slot.
    const nextEntry: VocabEntry | null =
        workingLoop.length > 1 ? workingLoop[(currentIndex + 1) % workingLoop.length] : null;

    // Temporary (provisional) cards the server lent once the session's lend switch came
    // on (docs/PROVISIONAL_CARDS.md). The words the learner MARKED are recorded at the mark
    // call site below, so the end-of-visit offer can name them. (The words merely SHOWN
    // used to be accumulated too, for an arrival notice; the flp's out-of-ready-cards card
    // replaced that notice on 2026-11-11.) `note` is stable, so destructuring keeps
    // `markCard`'s identity from churning as words are added.
    const { words: provisionalReviewed, note: noteMarkedLent } = useMarkedLentWords();

    // Fetch distributed working loop (1 Mastered, 2 Comfortable, 2 Unfamiliar, 5 Target).
    // Re-runs when the lend switch flips: on, the loop is re-dealt with lent cards allowed
    // (it was empty — that is what turned the switch on); off again at the end of a visit,
    // it is re-dealt from the learner's own ready cards for the next one.
    useEffect(() => {
        // Only the LATEST fetch may apply. Without this, two overlapping fetches (React
        // StrictMode's dev double-mount, or a dep change while one is in flight) BOTH
        // land: the first renders a card the learner can already tap and flip, then the
        // second swaps a different card in under it — at the same index 0, so the
        // per-card flip reset never runs (the "flipped the wrong card, More Info stays
        // greyed" bug, 2026-10-06).
        let cancelled = false;

        // Everything a freshly dealt loop needs beyond `setWorkingLoop`.
        const dealLoop = (cards: VocabEntry[]) => {
            setWorkingLoop(cards);
            setLastMarkUndoSnapshot(null);

            // Server pre-warmed the TTS disk cache before responding, so these
            // prefetches just stream the MP3 bytes across the wire into the
            // browser's in-session blob cache. Skipped per-card when
            // hasAudio === false (synthesis errored server-side).
            cards.forEach((card: VocabEntry) => prefetch(card));

            // New deck: both visible cards start on Side 1. useCardDrag resets
            // flip-tracking on a currentIndex change, but currentIndex stays 0 on a
            // fresh fetch so that reset may not fire — run the FULL reset here
            // (not just isFlipped=false, which left hasFlippedCurrentCard stale).
            cardDragRef.current?.resetCard();
            // Each card opens on its weaker know track, recognition on a tie
            // (docs/MASTERY_REWORK.md § 6). This includes the session's FIRST card,
            // which used to be forced English-first to dodge an iOS autoplay edge
            // case on Chinese-side-one auto-narration — that override would break
            // the rule, so it is gone; see the flag in docs/MASTERY_REWORK.md § 6.
            setCurrentSideOneLanguage(sideOneForCard(cards[0], world));
            setNextSideOneLanguage(sideOneForCard(cards[1], world));
        };

        const fetchInitialCards = async () => {
            try {
                setLoading(true);
                setError(null);

                const cards = await fetchDistributedWorkingLoop(loopRequest);
                if (cancelled) return;

                console.log(`Loaded ${cards.length} cards in distributed working loop (${world})`);
                dealLoop(cards);
            } catch (err) {
                if (cancelled) return;
                setError(err instanceof Error ? err.message : "Unknown error");
            } finally {
                // A superseded fetch leaves `loading` alone — the newer one owns it.
                if (!cancelled) setLoading(false);
            }
        };

        if (token) {
            fetchInitialCards();
        }
        return () => { cancelled = true; };
    // Keyed on Boolean(token) — the STABLE auth-presence flag — NOT the raw
    // `token` string. The access token silently refreshes every ~15 min; keying
    // on `token` would re-fetch the working loop and reset the card stack
    // mid-study. Boolean(token) only flips on login/logout. See CLAUDE.md
    // "Never reload on token refresh". prefetch/cardDragRef are stable refs;
    // `loopRequest` is rebuilt every render, but it is a pure function of `world` and
    // `lendMode`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [Boolean(token), world, lendMode]);

    // Mark card with retry logic.
    // `excludeIds` tells the server which cards are already in the working loop,
    // so the replacement card it returns won't duplicate one the user already has.
    const markCard = useCallback(async (
        cardId: number,
        isCorrect: boolean,
        markType: MarkType,
        excludeIds: number[],
        writing?: WritingAttempt,
        retryCount = 0
    ): Promise<MarkCardResult | null> => {
        try {
            // THIS call is what refills the working loop: the server returns a
            // replacement card (`newCard`) drawn on the session's bar.
            const data = await markFlashcard({
                cardId,
                isCorrect,
                type: markType,
                excludeIds,
                world: world === "core" ? undefined : world,
                // The lend switch AS IT IS when the mark is sent (a ref, so this callback
                // keeps its identity): only then may the replacement be a lent card.
                lend: lendModeRef.current || undefined,
                // NOT merely diagnostic: once a card's core pbh reaches 6 the server
                // records know marks ONLY from this surface (docs/MASTERY_REWORK.md § 6).
                surface: FLP_MARK_SURFACE,
                writing,
            });

            // A SUPPRESSED mark (the card's know clock had not finished cooling —
            // docs/HYDRA_BUBBLES.md § 8) wrote nothing, so there is no timestamp and
            // nothing to undo. Reported as its own result rather than an error: the
            // review DID happen, it just did not change any history, and surfacing it
            // as a failure would show "Failed to save progress" for a working app.
            if (data.suppressed || data.markTimestamp === null) {
                return { suppressed: true, newCard: null, markTimestamp: null, markType, displacedMarks: [] };
            }

            return {
                suppressed: false,
                newCard: data.newCard,
                markTimestamp: data.markTimestamp,
                markType,
                displacedMarks: data.displacedMarks,
            };
        } catch (err) {
            if (retryCount < 3) {
                // Exponential backoff: wait 500ms, 1s, 2s
                await new Promise(resolve => setTimeout(resolve, 500 * Math.pow(2, retryCount)));
                return markCard(cardId, isCorrect, markType, excludeIds, writing, retryCount + 1);
            }
            console.error("Failed to mark card after retries:", err);
            setError("Failed to save progress. Please check your connection.");
            return null;
        }
        // No `token` dep: markFlashcard reads the header at call time, so this
        // callback's identity survives a silent refresh (CLAUDE.md ⛔ rule).
    }, [world]);

    // Removes `cardId` from the loop and re-anchors currentIndex on whichever card is
    // on front RIGHT NOW (read via currentIndexRef), so the visible card does not jump.
    // Shared by the two wind-down paths in handleCardDismiss: the server had no
    // replacement, or its replacement was already in the loop (the dedupe guard).
    //
    // Anchoring on the live front card rather than the card promoted at dismiss time
    // matters because a mark response can land after the learner has swiped on
    // again; anchoring on the dismiss-time successor would yank them backwards.
    //
    // Called from inside a setWorkingLoop updater: setCurrentIndex there is
    // idempotent (same input ⇒ same index), so a StrictMode double-invoke is harmless.
    const removeCardAndReanchor = useCallback((prevLoop: VocabEntry[], cardId: number): VocabEntry[] => {
        const frontCard = prevLoop[currentIndexRef.current] ?? null;
        const newLoop = prevLoop.filter(card => card.id !== cardId);
        const anchorIndex = frontCard && frontCard.id !== cardId
            ? newLoop.findIndex(card => card.id === frontCard.id)
            : -1;
        setCurrentIndex(anchorIndex >= 0 ? anchorIndex : 0);
        return newLoop;
    }, []);

    const handleCardDismiss = useCallback(async (direction: "left" | "right", writing?: WritingAttempt) => {
        if (workingLoop.length === 0 || isAnimating) return;

        const currentCard = workingLoop[currentIndex];
        const isCorrect = direction === "right";
        // The prompt language showing on Side 1 decides the mark type.
        const markType = markTypeForSideOne(currentSideOneLanguage, world);
        const preDismissSnapshot: Omit<LastMarkUndoSnapshot, "cardId" | "markTimestamp" | "markType" | "displacedMarks" | "isCorrect"> = {
            workingLoop: [...workingLoop],
            currentIndex,
            currentSideOneLanguage,
            nextSideOneLanguage,
        };

        setIsAnimating(true);
        countersRef.current.onDismissed?.();
        countersRef.current.onMarked?.(isCorrect, isProvisional(currentCard));

        // Begin fly-out: current front slot animates off-screen in the swipe
        // direction. The back slot (already showing the next card) is immediately
        // promoted to front.
        setFlyOut({ slot: activeFrontSlot, direction });
        setActiveFrontSlot(prev => (1 - prev) as 0 | 1);
        setCurrentIndex(prev => (prev + 1) % workingLoop.length);
        // Promote the peeking card's language to current and choose the new
        // back-slot card's Side 1 from ITS own history (weaker know track). The new
        // back card is two ahead of the outgoing front (the
        // card just promoted to front sits one ahead). useCardDrag resets
        // isFlipped=false on card change (keyed off currentIndex).
        setCurrentSideOneLanguage(nextSideOneLanguage);
        const newBackCard = workingLoop[(currentIndex + 2) % workingLoop.length];
        setNextSideOneLanguage(sideOneForCard(newBackCard, world));

        // Fire mark API in background — newCard replaces the current slot, not the
        // next one, so the UI doesn't need to wait for the response before
        // advancing. Send the current working loop's ids so the server doesn't
        // return a duplicate.
        const excludeIds = workingLoop.map(card => card.id);
        // Recorded on the ATTEMPT, before the request — so a mark the server drops on
        // cooldown still counts as "the learner reviewed this borrowed word", and the
        // offer does not race the fire-and-forget response (docs/PROVISIONAL_CARDS.md § 5).
        noteMarkedLent(currentCard);
        markCard(currentCard.id, isCorrect, markType, excludeIds, writing)
            .then(markResult => {
                if (!markResult) return;
                // Nothing was written server-side, so leave the loop exactly as it is:
                // no replacement to patch in, no card to wind down, and no undo
                // snapshot (an undo keyed on a mark that never existed would be
                // rejected and read to the user as a failure). The card stays in the
                // loop and comes around again once its cooldown has actually elapsed.
                if (markResult.suppressed || markResult.markTimestamp === null) {
                    console.log(`Mark suppressed (still cooling): ${currentCard.entryKey}`);
                    return;
                }
                const { newCard, markTimestamp, displacedMarks } = markResult;
                console.log(`Card marked: ${currentCard.entryKey} (${isCorrect ? "correct" : "incorrect"})`);
                if (isCorrect && newCard) {
                    // Patch the slot the dismissed card occupied — user won't see it for a full cycle.
                    //
                    // DEDUPE GUARD: two marks in flight at once (a fast swiper — each
                    // refill takes ~1–2 s server-side) were each sent the SAME
                    // `excludeIds`, because neither knew the other's replacement yet. The
                    // server's ranking is deterministic, so both came back with the same
                    // card and it landed in two adjacent slots — the learner saw it twice
                    // in a row, and the second mark was dropped on cooldown (the 猪
                    // report, 2026-10-08). If the replacement is already in the loop,
                    // wind the dismissed slot down instead of duplicating it; the next
                    // correct mark refills the loop back up.
                    let duplicate = false;
                    setWorkingLoop(prevLoop => {
                        // Locate the slot by id, not the dismiss-time index: an
                        // intervening wind-down may have shifted the indices since.
                        const slot = prevLoop.findIndex(card => card.id === currentCard.id);
                        if (slot < 0) return prevLoop; // already gone (e.g. undo restored an older loop)
                        if (prevLoop.some((card, i) => i !== slot && card.id === newCard.id)) {
                            duplicate = true;
                            return removeCardAndReanchor(prevLoop, currentCard.id);
                        }
                        const newLoop = [...prevLoop];
                        newLoop[slot] = newCard;
                        return newLoop;
                    });
                    // Pull the replacement's audio into the in-session blob cache
                    // while the user is studying other cards in the loop.
                    if (!duplicate) prefetch(newCard);
                } else if (isCorrect && !newCard) {
                    // Card passed, but the server has no replacement — wind the loop
                    // down by removing the just-passed card instead of recycling it.
                    //
                    // The server honors the know cooldown rather than re-serving a resting
                    // card, so a session can legitimately run out — a reading/writing
                    // session when every card is cooling on its bar, and even a core one
                    // when every card is cooling and the dictionary has no more words to
                    // lend. Recycling the passed card instead would re-show a card the
                    // server just declined to serve.
                    //
                    // Remove by id (the optimistic currentIndex has already advanced, so
                    // index math would be brittle) and re-anchor on the card now on
                    // front. Empty loop ⇒ currentEntry null ⇒ empty state.
                    setWorkingLoop(prevLoop => removeCardAndReanchor(prevLoop, currentCard.id));
                } else if (!isCorrect && markType !== "writing") {
                    // A missed card STAYS in the loop and comes around again, still carrying
                    // the history it was dealt with. Mirror the server's write onto the
                    // loop's copy so anything reading the history in-session sees this miss
                    // — the hint pawn's wrong-streak check (pawnHints.ts → `hasWrongStreak`,
                    // docs/HINT_PAWN.md § "Hints") counts the last 3 marks. A miss is never
                    // accelerated, so one append is exactly what the server stored. Writing
                    // is left alone: its result fans out onto other cards server-side.
                    // Undo restores the pre-dismiss loop, which drops this patch with it.
                    const missed = { timestamp: markTimestamp, isCorrect: false };
                    setWorkingLoop(prevLoop => prevLoop.map(card => card.id === currentCard.id
                        ? { ...card, typedMarkHistory: appendTypedMark(card.typedMarkHistory, markType, missed) }
                        : card));
                }
                // A writing result fans out onto several character cards and cannot be
                // undone (FlashcardMarkService.undoMark refuses it), so offer no undo.
                if (markType === "writing") return;
                setLastMarkUndoSnapshot({
                    cardId: currentCard.id,
                    markTimestamp,
                    markType,
                    displacedMarks,
                    isCorrect,
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
    }, [workingLoop, isAnimating, currentIndex, activeFrontSlot, currentSideOneLanguage, nextSideOneLanguage, markCard, removeCardAndReanchor, noteMarkedLent, prefetch, cardDragRef, world]);

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
                displacedMarks: lastMarkUndoSnapshot.displacedMarks,
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
            const restored = lastMarkUndoSnapshot.workingLoop.find((card) => card.id === lastMarkUndoSnapshot.cardId);
            countersRef.current.onUndone?.(lastMarkUndoSnapshot.isCorrect, !!restored && isProvisional(restored));
        } catch (err) {
            console.error("Failed to undo last mark:", err);
            setError(err instanceof Error ? err.message : "Failed to undo last mark");
        } finally {
            setIsUndoing(false);
        }
        // No `token` dep — see the note on markCard above.
    }, [lastMarkUndoSnapshot, isAnimating, isUndoing, cardDragRef]);

    const clearUndo = useCallback(() => setLastMarkUndoSnapshot(null), []);

    // ── Break clears (docs/FLP_GAME_BREAKS.md § 4a) ─────────────────────────────
    // A correct game mark on a loop card is the game's version of a right swipe, so the
    // card leaves the loop and its slot is refilled — otherwise the flp dealt the same
    // cards straight after the game (2026-11-03 report). Removed at once, refilled in one
    // `GET /api/onDeck/loopRefill` rather than per mark, because the games' mark calls
    // know nothing of the loop's session params.
    //
    // Runs between the game and the next card (the stack is behind the break's results
    // card, so no swipe is in flight); only the refill can land later, which is why the
    // insert goes through an updater against the live loop.
    const replaceGameCleared = useCallback((cardIds: readonly number[]) => {
        const before = { loop: workingLoopRef.current, index: currentIndexRef.current };
        const inLoop = new Set(cardIds.filter((id) => before.loop.some((card) => card.id === id)));
        if (inLoop.size === 0) return;

        const after = removeFromLoop(before, inLoop);
        setWorkingLoop(after.loop);
        setCurrentIndex(after.index);
        // The undo snapshot holds the old loop, cleared cards and all.
        setLastMarkUndoSnapshot(null);
        // A new front card opens on its own weaker face, unflipped; a new back card
        // peeks with its own face. An unchanged card keeps the face it is showing.
        const ringAt = (state: typeof after, offset: number) =>
            state.loop.length > offset ? state.loop[(state.index + offset) % state.loop.length] : null;
        const front = ringAt(after, 0);
        const back = ringAt(after, 1);
        if (front && front.id !== ringAt(before, 0)?.id) {
            setCurrentSideOneLanguage(sideOneForCard(front, world));
            cardDragRef.current?.resetCard();
        }
        if (back && back.id !== ringAt(before, 1)?.id) setNextSideOneLanguage(sideOneForCard(back, world));

        setBreakRefillsInFlight((n) => n + 1);
        fetchLoopRefill(loopRequest, [...inLoop], before.loop.map((card) => card.id))
            .then((cards) => {
                if (cards.length === 0) return; // pool spent: the loop winds down, as for a swipe
                const wasEmpty = workingLoopRef.current.length === 0;
                const wasSingle = workingLoopRef.current.length === 1;
                setWorkingLoop((prevLoop) => {
                    const next = insertBehindFront({ loop: prevLoop, index: currentIndexRef.current }, cards);
                    setCurrentIndex(next.index); // idempotent, as in removeCardAndReanchor
                    return next.loop;
                });
                cards.forEach((card) => prefetch(card));
                // Only an emptied loop gets a new front; a one-card loop gets a new back.
                if (wasEmpty) {
                    setCurrentSideOneLanguage(sideOneForCard(cards[0], world));
                    setNextSideOneLanguage(sideOneForCard(cards[1] ?? cards[0], world));
                    cardDragRef.current?.resetCard();
                } else if (wasSingle) {
                    setNextSideOneLanguage(sideOneForCard(cards[0], world)); // the ring wraps to the first insert
                }
            })
            .catch((err) => console.error("Break refill failed; the loop keeps its remaining cards:", err))
            .finally(() => setBreakRefillsInFlight((n) => n - 1));
        // `loopRequest` is a pure function of the session inputs (see the fetch effect).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [world, lendMode, prefetch, cardDragRef]);

    return {
        workingLoop,
        currentIndex,
        currentEntry,
        nextEntry,
        loading: loading || (breakRefillsInFlight > 0 && workingLoop.length === 0),
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
        /** Forget the last mark's undo (a Deck Tower visit ended: FlpTowerHost `parked`). */
        clearUndo,
        /** Lent words this session REVIEWED; drives the "keep these" offers. */
        provisionalReviewed,
        replaceGameCleared,
        lendMode,
        enableLend,
        resetLend,
    };
}
