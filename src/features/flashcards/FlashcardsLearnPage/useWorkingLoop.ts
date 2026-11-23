import { useCallback, useEffect, useRef, useState } from "react";
import { afterNextPaint } from "../../../utils/afterNextPaint";
import type { RefObject } from "react";
import { markFlashcard, undoFlashcardMark } from "../../../api/flashcards";
import { fetchDistributedWorkingLoop, fetchLoopRefill, type WorkingLoopRequest } from "../../../api/workingLoop";
import { insertBehindFront, removeFromLoop } from "./loopSplice";
import { CARD_FLY_OUT_MS, LAST_CARD_RETURN_MS } from "../constants";
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
    // Full flip-tracking reset for when the SAME card must start over on Side 1.
    // useCardDrag resets on its own whenever the front card's id changes; this covers
    // the cases where it doesn't — a re-deal whose first card is the one already
    // showing, and the last card's incorrect return (FlyOut.returnsAlone).
    resetCard: () => void;
    // Brings a card back on Side 2 (used by mark-undo — the user has already seen
    // that card's answer). Takes the restored card's id (useCardDrag's resetKey) so
    // the drag layer's per-card reset effect doesn't flip it back to Side 1.
    restoreFlipped: (targetResetKey: number | null) => void;
    // Snaps the front card's drag translation back to center. Called once the
    // fly-out completes — useCardDrag's per-card reset effect resets flip state
    // but intentionally leaves drag position alone (the fly-out animates from the
    // release position), so the working loop clears it here.
    resetDragPosition: () => void;
}

// The session's flp bar (server/contracts/studyMode.ts) — the Deck Tower world studied.
export type { FlpWorld } from "../../../../server/contracts/studyMode";
import type { FlpWorld } from "../../../../server/contracts/studyMode";

/**
 * The card flying out after a dismiss. `armed` is false for the dismiss's own commit (the
 * slot holds at the release point) and true from the next paint, when its animation runs.
 * Read by FlashCardSection. Docs: docs/FLP_CARD_GESTURES.md § "Fly-out".
 */
/**
 * One of the card stack's three slots. Slots rotate through the roles front → (flying →)
 * deep → back → front: at rest two cards sit behind the front, so a fast learner who flips
 * or swipes the new front during a fly-out still has a card behind it (with two slots the
 * only other slot was the one flying away, and the frame showed through).
 */
export type CardSlot = 0 | 1 | 2;

export interface FlyOut {
    slot: CardSlot;
    direction: "left" | "right";
    armed: boolean;
    /**
     * An incorrect mark on the loop's ONLY card: there is no other card to promote, so the
     * same card goes off-screen and slides back in on top, labelled "Last card!"
     * (FlashCardSection → LAST_CARD_RETURN_KEYFRAMES), over LAST_CARD_RETURN_MS rather
     * than CARD_FLY_OUT_MS. Without it the stack "advanced" onto the same card with no
     * visible change, which read as a broken swipe. Docs: docs/FLP_CARD_GESTURES.md §
     * "The last card".
     */
    returnsAlone: boolean;
}

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
    /** The card two behind the front — the stack's deep slot (see CardSlot). */
    deepEntry: VocabEntry | null;
    /** Side 1 of `deepEntry`. Derived, not rolled: sideOneForCard is a pure rule. */
    deepSideOneLanguage: SideOneLanguage;
    loading: boolean;
    error: string | null;
    isAnimating: boolean;
    lastMarkUndoSnapshot: LastMarkUndoSnapshot | null;
    activeFrontSlot: CardSlot;
    flyOut: FlyOut | null;
    /**
     * The front card is the loop's only card, just marked correct, and the server has not
     * said yet whether a replacement comes. In a one-card loop the stack advances onto the
     * same card, so without this the swiped card would sit back on the front while its copy
     * flies off — and then vanish when the reply empties the loop. FlashCardSection does not
     * draw the front while this is set, so the card behind (the out-of-ready-cards backing
     * card) shows instead. Docs: docs/FLP_CARD_GESTURES.md § "The last card".
     */
    frontVacated: boolean;
    currentSideOneLanguage: SideOneLanguage;
    nextSideOneLanguage: SideOneLanguage;
    /**
     * `writing` is the writing flp's graded attempt (docs/WRITING_PRACTICE_REWORK.md § 3):
     * required on `world: "writing"`, where the server fans it out per character.
     */
    handleCardDismiss: (direction: "left" | "right", writing?: WritingAttempt) => Promise<void>;
    /** Live from the swipe on; a tap mid-fly-out is queued (docs/FLP_CARD_GESTURES.md § "Undo"). */
    handleUndoLastMark: () => void;
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
 * three-slot card-stack animation state machine, the mark/undo network layer, and
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
    // ── Undo (docs/FLP_CARD_GESTURES.md § "Undo") ──────────────────────────────────
    // The snapshot is taken AT THE SWIPE, so the button lights up at once. Pressing it
    // restores the card locally straight away (or right after the fly-out, if one is
    // running — `undoQueued`) and sends the server's revert once the mark's reply has
    // supplied its key.
    const [lastMarkUndoSnapshot, setLastMarkUndoSnapshot] = useState<LastMarkUndoSnapshot | null>(null);
    // Undo pressed mid-fly-out: run it the moment `isAnimating` drops (effect below).
    const [undoQueued, setUndoQueued] = useState(false);
    // (A swipe undone before its mark reply lands is told so through its snapshot's
    // `undone` flag — see LastMarkUndoSnapshot.)
    // The latest server revert, settled or not. Every mark sent afterwards waits on it:
    // the server reverts only the card's NEWEST mark on that track (FlashcardMarkService
    // → `undoMark`, ERR_UNDO_TARGET_MISMATCH), so a re-swipe of the restored card must
    // not reach the server before the revert does. Never rejects (errors are caught where
    // the revert is issued).
    const serverUndoChainRef = useRef<Promise<void>>(Promise.resolve());
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

    // Three-slot card stack (CardSlot): tracks which slot is the front card and which
    // slot is currently animating off-screen. Back = front + 1, deep = front + 2 (mod 3).
    const [activeFrontSlot, setActiveFrontSlot] = useState<CardSlot>(0);
    const [flyOut, setFlyOut] = useState<FlyOut | null>(null);
    // The id of the loop's only card while its correct mark is in flight (`frontVacated`).
    const [soleCardLeavingId, setSoleCardLeavingId] = useState<number | null>(null);

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
    // The card after that, pre-rendered in the deep slot. Only with 3+ cards: in a shorter
    // loop it would be the front card itself.
    const deepEntry: VocabEntry | null =
        workingLoop.length > 2 ? workingLoop[(currentIndex + 2) % workingLoop.length] : null;
    const deepSideOneLanguage = sideOneForCard(deepEntry, world);
    // By id: a replacement patched into the loop is a different card, and shows at once.
    const frontVacated = currentEntry !== null && currentEntry.id === soleCardLeavingId;

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
            // flip-tracking when the front card's id changes, but a re-deal can open
            // on the card already showing (the lend switch going off at a visit's
            // end) — run the FULL reset here (not just isFlipped=false, which left
            // hasFlippedCurrentCard stale).
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
        // Flipped by the undo if this swipe is undone; the mark reply checks it.
        const undone = { current: false };

        setIsAnimating(true);
        countersRef.current.onDismissed?.();
        countersRef.current.onMarked?.(isCorrect, isProvisional(currentCard));

        // Begin fly-out: current front slot animates off-screen in the swipe
        // direction. The back slot (already showing the next card) is immediately
        // promoted to front.
        // Un-armed: the flying slot is held at the release point while this dismiss's big
        // synchronous update commits; it is armed after the next paint (below).
        // The loop's only card, marked wrong, comes straight back (FlyOut.returnsAlone).
        const returnsAlone = !isCorrect && workingLoop.length === 1;
        setFlyOut({ slot: activeFrontSlot, direction, armed: false, returnsAlone });
        // The only card, passed: it is not coming straight back (frontVacated).
        if (isCorrect && workingLoop.length === 1) setSoleCardLeavingId(currentCard.id);
        // The back slot is promoted; the flying slot lands as the new deep card.
        setActiveFrontSlot(prev => ((prev + 1) % 3) as CardSlot);
        setCurrentIndex(prev => (prev + 1) % workingLoop.length);
        // Promote the peeking card's language to current and choose the new
        // back-slot card's Side 1 from ITS own history (weaker know track). The new
        // back card is two ahead of the outgoing front (the
        // card just promoted to front sits one ahead). useCardDrag resets
        // isFlipped=false on card change (keyed off the front card's id).
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
        // Queued behind any server revert still in flight (serverUndoChainRef): the
        // revert must reach the server before a re-swipe of the restored card does.
        const markRequest = serverUndoChainRef.current.then(() =>
            markCard(currentCard.id, isCorrect, markType, excludeIds, writing));

        // The undo snapshot is taken NOW, not when the reply lands, so the undo button
        // lights up with the swipe (it used to wait out the ~1–2 s refill round trip, and
        // a tap before then did nothing). The server key follows through `markWritten`.
        // A writing result fans out onto several character cards and cannot be undone
        // (FlashcardMarkService.undoMark refuses it) — and the previous swipe's snapshot
        // goes too, since restoring it would rewind the loop past this writing mark.
        if (markType === "writing") {
            setLastMarkUndoSnapshot(null);
        } else {
            setLastMarkUndoSnapshot({
                undone,
                cardId: currentCard.id,
                markType,
                isCorrect,
                markWritten: markRequest.then(
                    (result) => (result && !result.suppressed && result.markTimestamp !== null
                        ? { markTimestamp: result.markTimestamp, displacedMarks: result.displacedMarks }
                        : null),
                    () => null,
                ),
                workingLoop: [...workingLoop],
                currentIndex,
                currentSideOneLanguage,
                nextSideOneLanguage,
            });
        }

        markRequest
            .then(markResult => {
                if (!markResult) return;
                // Undone before the reply landed: the loop is already back where it was
                // before this swipe, and the server revert is queued behind this reply.
                if (undone.current) return;
                // SUPPRESSED: the server refused the mark (the card is cooling on this
                // bar, or another gate dropped it) and wrote nothing. Wind the card out
                // of the loop, either swipe direction, exactly like a pass with no
                // replacement. Keeping it was a bug (until 2026-11-22): the loop is a
                // ring, so the card came straight back on the next pass, was refused
                // again, and repeated for the rest of the visit — near the end of a
                // session it was all the learner saw, and every right swipe took
                // another card off the tower's count. The usual trigger was a card
                // marked behind the loop's back: a writing break marking a loop
                // character (docs/WRITING_PRACTICE_REWORK.md § 4), a mark on another
                // surface mid-visit, a fast-swipe race. A suppressed mark owes no
                // refill (POST /api/flashcards/mark), so the loop shrinks by one; an
                // empty loop raises the out-of-ready-cards card (docs/DECK_TOWER.md
                // § Running out of ready cards). An undo of it is local only: its
                // snapshot's `markWritten` resolves null, so no revert is sent for a
                // mark that never existed.
                if (markResult.suppressed || markResult.markTimestamp === null) {
                    console.log(`Mark suppressed, card leaves the loop: ${currentCard.entryKey}`);
                    setWorkingLoop(prevLoop => prevLoop.some(card => card.id === currentCard.id)
                        ? removeCardAndReanchor(prevLoop, currentCard.id)
                        : prevLoop);
                    return;
                }
                const { newCard, markTimestamp } = markResult;
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
                    //
                    // Both questions below are read from the live refs BEFORE the
                    // update, not from inside the updater: React may run an updater
                    // lazily at the next render, so a flag it sets can still read its
                    // initial value on the line after `setWorkingLoop` (the old
                    // `duplicate` flag did — every replacement got prefetched).
                    const liveLoop = workingLoopRef.current;
                    const duplicate = liveLoop.some(card => card.id === newCard.id);
                    // FRONT-SLOT REPLACEMENT: in a one-card loop the dismissed card's slot
                    // IS the front ((0 + 1) % 1 = 0), so the replacement lands straight on
                    // screen. Its flip resets on its own (useCardDrag keys on the front
                    // card's id — keying on currentIndex is what made it arrive flipped,
                    // 2026-11-22: a card back off cooldown, served behind the
                    // out-of-ready-cards card). Its Side 1 language does not: the dismiss
                    // promoted `nextSideOneLanguage`, computed from the passed card itself.
                    const replacesFront = !duplicate
                        && liveLoop[currentIndexRef.current]?.id === currentCard.id;
                    setWorkingLoop(prevLoop => {
                        // Locate the slot by id, not the dismiss-time index: an
                        // intervening wind-down may have shifted the indices since.
                        const slot = prevLoop.findIndex(card => card.id === currentCard.id);
                        if (slot < 0) return prevLoop; // already gone (e.g. undo restored an older loop)
                        if (prevLoop.some((card, i) => i !== slot && card.id === newCard.id)) {
                            return removeCardAndReanchor(prevLoop, currentCard.id);
                        }
                        const newLoop = [...prevLoop];
                        newLoop[slot] = newCard;
                        return newLoop;
                    });
                    if (replacesFront) {
                        // Its own weaker know track opens it; it is also the back card
                        // (the ring of one wraps to itself).
                        setCurrentSideOneLanguage(sideOneForCard(newCard, world));
                        setNextSideOneLanguage(sideOneForCard(newCard, world));
                    }
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
            })
            .catch(err => {
                // markCard handles retries internally and sets error state on
                // failure, but this catch prevents an unhandled promise rejection
                // if something unexpected throws after all retries are exhausted.
                console.error("Unhandled error in markCard background task:", err);
                setError("Failed to save progress. Please check your connection.");
            })
            // The reply is in (and applied above, in its own batch): the loop now holds the
            // replacement or nothing (a suppressed mark also leaves nothing), or — a failed
            // request — the same card, shown again.
            .finally(() => setSoleCardLeavingId(prev => (prev === currentCard.id ? null : prev)));

        // Wait for the fly-out CSS transition to complete, then clear the fly-out
        // state. The flew-out slot snaps back to center (hidden behind the new
        // front card) and becomes the next back card; its drag offset is cleared by
        // resetDragPosition below (useCardDrag's per-card reset leaves drag alone).
        // Arm the fly-out only once the dismiss update above has painted. That update
        // (slot swap, next card, narration, counters) runs synchronously before the first
        // paint; an animation committed with it got its start time at commit, so on a phone
        // its first visible frame landed 70–280 ms in — the card was already mostly
        // off-screen — and the fixed timer then cut the rest short (docs/FLP_CARD_GESTURES.md
        // § "Fly-out"). Armed in a light follow-up commit, it is painted at once and then
        // runs on the compositor, unaffected by later main-thread work. The fly-out's
        // clock starts here, so the full CARD_FLY_OUT_MS is always shown.
        await new Promise<void>(resolve => afterNextPaint(resolve));
        setFlyOut(prev => (prev ? { ...prev, armed: true } : prev));
        if (returnsAlone) {
            // The card comes back as a fresh front, on Side 1. `currentIndex` does not move
            // in a one-card loop ((0 + 1) % 1 = 0), so useCardDrag's per-card reset (keyed
            // on it) never fires and the card would return still flipped. The front slot is
            // hidden for the whole return (FlashCardSection), so resetting it now is unseen;
            // the flying copy keeps its own face until it is off-screen. On the page's
            // cardDragRef this also wipes a writing card's graded attempt.
            cardDragRef.current?.resetCard();
        }
        await new Promise(resolve => setTimeout(resolve, returnsAlone ? LAST_CARD_RETURN_MS : CARD_FLY_OUT_MS));
        setFlyOut(null);
        cardDragRef.current?.resetDragPosition();
        setIsAnimating(false);
    }, [workingLoop, isAnimating, currentIndex, activeFrontSlot, currentSideOneLanguage, nextSideOneLanguage, markCard, removeCardAndReanchor, noteMarkedLent, prefetch, cardDragRef, world]);

    // Runs one undo: the card comes back on screen at once, and the server revert is
    // sent as soon as the mark's reply has supplied its key (`markWritten`). Only called
    // once no fly-out is running (handleUndoLastMark queues it otherwise).
    const runUndo = useCallback((snapshot: LastMarkUndoSnapshot) => {
        // Tell the swipe's mark reply, if it is still in flight, to leave the loop alone.
        snapshot.undone.current = true;
        setError(null);

        // ── Local restore, immediately ──
        setWorkingLoop(snapshot.workingLoop);
        setCurrentIndex(snapshot.currentIndex);
        // The loop's only card, passed and undone before its reply: un-hide the front
        // (frontVacated), or the restored card would stay invisible until the reply.
        setSoleCardLeavingId(null);
        // Undo always lands on Side 2: a card can only be dismissed after it
        // has been flipped, so the user has already seen its answer — sending
        // it back to Side 1 would re-quiz them on a card they just marked.
        cardDragRef.current?.restoreFlipped(snapshot.cardId);
        setCurrentSideOneLanguage(snapshot.currentSideOneLanguage);
        setNextSideOneLanguage(snapshot.nextSideOneLanguage);
        setLastMarkUndoSnapshot(null);
        const restored = snapshot.workingLoop.find((card) => card.id === snapshot.cardId);
        countersRef.current.onUndone?.(snapshot.isCorrect, !!restored && isProvisional(restored));

        // ── Server revert, once the mark's key is known ──
        // Chained so later marks wait for it (serverUndoChainRef). A null key means the
        // server wrote nothing (suppressed, or the request failed): nothing to revert.
        serverUndoChainRef.current = snapshot.markWritten
            .then((written) => {
                if (!written) return;
                // ApiError carries the server's `error` field as its message.
                return undoFlashcardMark({
                    cardId: snapshot.cardId,
                    markTimestamp: written.markTimestamp,
                    markType: snapshot.markType,
                    displacedMarks: written.displacedMarks,
                });
            })
            .catch((err) => {
                // The card is already back on screen but the server kept the mark. Rare
                // (the revert targets the card's newest mark, and no newer mark can be
                // sent before it — see serverUndoChainRef), so it is surfaced, not retried.
                console.error("Failed to undo last mark:", err);
                setError(err instanceof Error ? err.message : "Failed to undo last mark");
            });
        // No `token` dep — see the note on markCard above.
    }, [cardDragRef]);

    // Enabled the moment a swipe happens. A tap during that swipe's fly-out is queued and
    // runs when it ends — restoring mid-flight would fight the stack's slot animation.
    const handleUndoLastMark = useCallback(() => {
        if (!lastMarkUndoSnapshot) return;
        if (isAnimating) {
            setUndoQueued(true);
            return;
        }
        runUndo(lastMarkUndoSnapshot);
    }, [lastMarkUndoSnapshot, isAnimating, runUndo]);

    // Drain a queued undo once the fly-out ends. Dropped if the snapshot was cleared in
    // the meantime (a re-deal, a break clear, the visit parked).
    useEffect(() => {
        if (!undoQueued) return;
        if (!lastMarkUndoSnapshot) {
            setUndoQueued(false);
            return;
        }
        if (isAnimating) return;
        setUndoQueued(false);
        runUndo(lastMarkUndoSnapshot);
    }, [undoQueued, isAnimating, lastMarkUndoSnapshot, runUndo]);

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
        // A new front card opens on its own weaker face (unflipped: useCardDrag resets
        // on the front id change); a new back card peeks with its own face. An unchanged
        // card keeps the face it is showing — and its flip.
        const ringAt = (state: typeof after, offset: number) =>
            state.loop.length > offset ? state.loop[(state.index + offset) % state.loop.length] : null;
        const front = ringAt(after, 0);
        const back = ringAt(after, 1);
        if (front && front.id !== ringAt(before, 0)?.id) setCurrentSideOneLanguage(sideOneForCard(front, world));
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
        deepEntry,
        deepSideOneLanguage,
        loading: loading || (breakRefillsInFlight > 0 && workingLoop.length === 0),
        error,
        isAnimating,
        lastMarkUndoSnapshot,
        activeFrontSlot,
        flyOut,
        frontVacated,
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
