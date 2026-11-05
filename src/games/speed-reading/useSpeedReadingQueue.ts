import { useCallback, useEffect, useRef, useState } from "react";
import { fetchGamePool, type GamePoolResponse } from "../../api/gamePool";
import { fetchSpeedReadingDistractors } from "../../api/speedReading";
import type { DistractorChar, VocabEntry } from "../../types";
import { provisionalEntries, provisionalWords } from "../../utils/provisionalCards";
import { SENTENCE_ROUNDS, TOPUP_BATCH, TOPUP_THRESHOLD } from "./constants";
import { hasSentenceRound } from "./buildRound";
import { speedReadingPoolRequest } from "./poolRequest";

/**
 * A run's opening supply: the card pool and the distractor characters. The flp break
 * adapter fetches exactly this pair while the card before the break is on screen
 * (src/games/flpBreak/speedReadingBreak.ts), so Play has no spinner.
 */
export interface SpeedReadingOpening {
    pool: GamePoolResponse;
    distractors: DistractorChar[];
}

export interface SpeedReadingQueueOptions {
    /** Signed in; nothing loads otherwise. */
    enabled: boolean;
    /** The working loop, sent on the opening batch (docs/FLP_GAME_BREAKS.md § 4). */
    seedIds?: number[];
    /** The opening supply, already fetched by the break adapter. */
    prefetched?: SpeedReadingOpening | null;
}

/**
 * Split a freshly-loaded pool into the cards reserved for the run's sentence
 * rounds and the ones that stay in the play queue.
 *
 * Takes the FIRST `count` eligible cards rather than the "best" ones: the pool
 * arrives already ordered by the mastery distribution the game asked for, and
 * re-ranking it here would quietly bias the finale toward whatever happens to be
 * richest in example sentences (which correlates with how long a word has been
 * discoverable, not with how well the player reads it).
 */
function reserveFinaleCards(
    cards: VocabEntry[],
    count: number
): { finale: VocabEntry[]; rest: VocabEntry[] } {
    const finale: VocabEntry[] = [];
    const rest: VocabEntry[] = [];
    for (const card of cards) {
        if (finale.length < count && hasSentenceRound(card)) finale.push(card);
        else rest.push(card);
    }
    return { finale, rest };
}

/**
 * Card queue for Speed Reading: a flat FIFO of vocab entries plus the distractor
 * pool each round draws its wrong character from.
 *
 * A flat queue rather than per-category client buffering (Match Speed's model)
 * because this game shows ONE word at a time and has no board to balance, so
 * bucketing would buy nothing.
 *
 * `markType=reading` on every pool request: this game emits READING marks, so its
 * candidates must be bucketed by — and cooled on — the reading track. Without it
 * the pool would gate on recognition, and a card just read correctly here would
 * come straight back while a card weak in reading would be treated as strong.
 *
 * ── Why the queue lives in a REF, mirrored to state ─────────────────────────
 * `dequeue()` is called from a tap handler and must return the next card
 * SYNCHRONOUSLY — the round is built from it in the same tick. Reading it out of
 * a `setQueue` updater would be both async and unsafe (React may invoke an
 * updater twice in StrictMode, which would consume two cards per tap). The ref
 * is the source of truth; `queueLength` exists only so the UI can react.
 *
 * Speed Reading is BREAK-ONLY (src/games/registry.ts): the hook serves exactly one run
 * per mount, and every pool request is flagged as an flp break's.
 */
export function useSpeedReadingQueue({
    enabled,
    seedIds,
    prefetched = null,
}: SpeedReadingQueueOptions) {
    // The prefetched supply, captured at mount. Read rather than consumed: StrictMode
    // runs the load effect twice in dev, and both passes must see the same supply.
    const prefetchedRef = useRef(prefetched);
    const queueRef = useRef<VocabEntry[]>([]);
    /**
     * Cards held back for the run's SENTENCE rounds (the last SENTENCE_ROUNDS of
     * the run), reserved out of the very first pool response and never returned
     * by `dequeue`.
     *
     * Reserved at LOAD rather than picked when round 20 comes up: the run's whole
     * card set is known on the first call, so the finale must not depend on
     * whether a mid-run top-up happens to return a card carrying an example
     * sentence. A card is eligible only if one of its example sentences actually
     * contains its headword (`hasSentenceRound`).
     */
    const finaleRef = useRef<VocabEntry[]>([]);
    const distractorsRef = useRef<DistractorChar[]>([]);

    const [queueLength, setQueueLength] = useState(0);
    const [ready, setReady] = useState(false);
    const [loading, setLoading] = useState(true);
    const [blockMessage, setBlockMessage] = useState<string>("");

    // Guards against overlapping top-ups: the trigger fires on every dequeue, so
    // a slow request would otherwise spawn one per card consumed.
    const toppingUpRef = useRef(false);
    // Temporary cards the server lent to reach the baseline (docs/PROVISIONAL_CARDS.md).
    // Kept in both shapes: the WORDS drive the end-of-round sort offer, the CARDS the
    // pre-round mini-card preview — derived here from the served pool so the notice
    // needs no second round-trip.
    const [provisional, setProvisional] = useState<string[]>([]);
    const [provisionalTable, setProvisionalTable] = useState<VocabEntry[]>([]);

    /** One pool request. Passing `opts` makes it a partial top-up. */
    const fetchPool = useCallback(
        async (opts?: { need: number; excludeIds: number[] }): Promise<GamePoolResponse> => {
            return fetchGamePool(speedReadingPoolRequest({
                need: opts?.need,
                exclude: opts?.excludeIds,
                // The seed fills the OPENING batch only; a top-up is ordinary supply.
                seedIds: opts ? undefined : seedIds,
                flpBreak: true,
            }));
        },
        // Every input is fixed for the break's lifetime: its context is captured when it
        // falls due.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        []
    );

    // ── Initial load ─────────────────────────────────────────────────────────
    useEffect(() => {
        if (!enabled) return;
        let cancelled = false;
        setLoading(true);
        setReady(false);

        (async () => {
            try {
                // The pool and the distractor list are independent, so overlap them. A
                // break takes the pair its adapter already fetched.
                const opening = prefetchedRef.current;
                const [pool, distractors] = opening
                    ? [opening.pool, opening.distractors]
                    : await Promise.all([fetchPool(), fetchSpeedReadingDistractors()]);
                if (cancelled) return;

                // NO CARD-COUNT GATE (docs/PROVISIONAL_CARDS.md). The server has already
                // lent whatever was needed to reach the Speed Reading baseline, so
                // `sufficient` can only be false when the dictionary itself ran dry.
                // A shorter queue still plays — the round builder consumes it card by
                // card — so we start the game rather than refusing it.
                // Split the pool ONCE, here: the finale's cards come off the top
                // of the eligible ones and the rest stay in the FIFO. Fewer than
                // SENTENCE_ROUNDS eligible cards is not fatal — the Stage falls
                // back to a word round for the rounds it can't fill — but it does
                // mean the run quietly loses its finale, so say so out loud.
                const { finale, rest } = reserveFinaleCards(pool.cards, SENTENCE_ROUNDS);
                if (finale.length < SENTENCE_ROUNDS) {
                    console.warn(
                        `[SpeedReading] only ${finale.length}/${SENTENCE_ROUNDS} pool cards carry an example `
                        + `sentence containing their headword; the rest of the finale falls back to word rounds.`
                    );
                }
                queueRef.current = rest;
                finaleRef.current = finale;
                distractorsRef.current = distractors;
                setQueueLength(rest.length);
                // Speed Reading plays a fixed, known set, so the notice can name the
                // exact lent words (CARD_BASELINE_ITEMIZED).
                setProvisional(provisionalWords(pool.cards));
                setProvisionalTable(provisionalEntries(pool.cards));
                setReady(true);
                setLoading(false);
            } catch {
                if (cancelled) return;
                setBlockMessage("Couldn't load the game. Please try again.");
                setLoading(false);
            }
        })();

        return () => {
            cancelled = true;
        };
        // Keyed on `enabled` — a stable identity that changes only on a deliberate
        // action. NOT on `token`: a silent access-token refresh
        // (~every 15 min) must not re-run this loader and wipe a run in progress.
        // apiGet reads the token at call time. See CLAUDE.md
        // "Never reload on token refresh".
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled]);

    // ── Top-up ───────────────────────────────────────────────────────────────
    /**
     * Fire-and-forget refill, triggered on dequeue when the queue runs low. Never
     * awaited in a tap handler: a failed top-up degrades to a shorter run, never
     * a stall.
     */
    const topUp = useCallback(() => {
        if (toppingUpRef.current) return;
        toppingUpRef.current = true;

        (async () => {
            try {
                // `exclude` carries every id still queued — INCLUDING the cards
                // held back for the finale — so a refill can't hand back a word
                // already waiting, or one the run is going to end on.
                const pool = await fetchPool({
                    need: TOPUP_BATCH,
                    excludeIds: [...queueRef.current, ...finaleRef.current].map((c) => c.id),
                });
                if (pool.cards.length === 0) return;

                // A concurrent dequeue can shift the queue under the request, so
                // re-check membership rather than trusting `exclude` alone.
                const known = new Set([...queueRef.current, ...finaleRef.current].map((c) => c.id));
                const added = pool.cards.filter((c) => !known.has(c.id));
                queueRef.current = [...queueRef.current, ...added];
                setQueueLength(queueRef.current.length);
            } catch (err) {
                console.error("[SpeedReading] top-up failed:", err);
            } finally {
                toppingUpRef.current = false;
            }
        })();
    }, [fetchPool]);

    /**
     * Take the next card, synchronously. Triggers a top-up once the remaining
     * depth falls below the threshold. Returns null when the queue is empty —
     * the caller ends the run early rather than stalling.
     */
    const dequeue = useCallback((): VocabEntry | null => {
        const next = queueRef.current.shift() ?? null;
        setQueueLength(queueRef.current.length);
        if (queueRef.current.length < TOPUP_THRESHOLD) topUp();
        return next;
    }, [topUp]);

    /**
     * Take the next card RESERVED for a sentence round, synchronously. Returns
     * null once the reservation is used up (or was never filled), which the Stage
     * treats as "build an ordinary word round instead".
     *
     * Deliberately does NOT fall back to the main queue: a card pulled from there
     * has no example sentence by construction, so there would be nothing to build
     * a sentence round out of.
     */
    const dequeueSentenceCard = useCallback((): VocabEntry | null => {
        return finaleRef.current.shift() ?? null;
    }, []);

    return {
        /** Live ref, read at round-build time. */
        distractorsRef,
        dequeueSentenceCard,
        queueLength,
        ready,
        loading,
        blockMessage,
        dequeue,
        /** Lent (temporary) words in this run's queue; empty when none were needed. */
        provisional,
        /** The same lent cards as pre-round table rows (word1 / pinyin / dd). */
        provisionalTable,
    };
}
