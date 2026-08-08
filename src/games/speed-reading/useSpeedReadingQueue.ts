import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE_URL } from "../../constants";
import { authHeader } from "../../utils/authHeader";
import { apiGet } from "../../api/http";
import type { DistractorChar, VocabEntry } from "../../types";
import { provisionalWords } from "../../utils/provisionalCards";
import { useLaunchCollection } from "../../features/flashcards/useLaunchCollection";
import { collectionLaunchParams } from "../../features/flashcards/collectionRef";
import {
    GAME_DISTRIBUTION,
    TOPUP_BATCH,
    TOPUP_THRESHOLD,
} from "./constants";

/** Shape returned by GET /api/onDeck/gamePool. */
interface GamePoolResponse {
    cards: VocabEntry[];
    available: Record<string, number>;
    total: number;
    sufficient: boolean;
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
 * `runId` is the RELOAD KEY: Play Again bumps it, which re-runs the initial load
 * (fresh cards, fresh distractor pool) without remounting the page. It is a
 * plain counter, never a token or any other rotating value — see the effect's
 * dependency comment.
 */
export function useSpeedReadingQueue(enabled: boolean, runId: number) {
    // Which collection this run was launched from (docs/DECKS_FEATURE.md) — null for
    // an ordinary launch from the Games hub. Folded into every pool request so the
    // round's headwords stay inside the set the learner picked. (Distractor
    // characters are deliberately NOT restricted: they are foils, and drawing them
    // from the deck would make the deck itself the answer key.)
    const launchCollection = useLaunchCollection();
    const queueRef = useRef<VocabEntry[]>([]);
    const distractorsRef = useRef<DistractorChar[]>([]);

    const [queueLength, setQueueLength] = useState(0);
    const [ready, setReady] = useState(false);
    const [loading, setLoading] = useState(true);
    const [blockMessage, setBlockMessage] = useState<string>("");

    // Guards against overlapping top-ups: the trigger fires on every dequeue, so
    // a slow request would otherwise spawn one per card consumed.
    const toppingUpRef = useRef(false);
    // Temporary cards the server lent to reach the baseline (docs/PROVISIONAL_CARDS.md).
    const [provisional, setProvisional] = useState<string[]>([]);

    /** One pool request. Passing `opts` makes it a partial top-up. */
    const fetchPool = useCallback(
        async (opts?: { need: number; excludeIds: number[] }): Promise<GamePoolResponse> => {
            const params = new URLSearchParams();
            params.set("markType", "reading");
            // Names the baseline the server tops the player up to before building the
            // pool, so a small deck is filled with temporary cards instead of blocking
            // (docs/PROVISIONAL_CARDS.md). Omitted on a partial top-up below — a
            // mid-run refill must not keep lending cards.
            if (!opts) params.set("surface", "speed-reading");
            for (const [cat, n] of Object.entries(GAME_DISTRIBUTION)) params.set(cat, String(n));
            // On BOTH the initial pool and a mid-run top-up: a refill that dropped the
            // restriction would start serving off-collection words.
            if (launchCollection) {
                for (const [key, value] of Object.entries(collectionLaunchParams(launchCollection))) {
                    params.set(key, value);
                }
            }
            if (opts) {
                params.set("need", String(opts.need));
                params.set("exclude", opts.excludeIds.join(","));
            }
            const res = await fetch(`${API_BASE_URL}/api/onDeck/gamePool?${params.toString()}`, {
                credentials: "include",
                headers: authHeader(),
            });
            if (!res.ok) throw new Error("Failed to load game pool");
            return (await res.json()) as GamePoolResponse;
        },
        // `launchCollection` comes from the page's own URL, which cannot change
        // without a remount, so the closure can never go stale.
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
                // The pool and the distractor list are independent, so overlap them.
                const [pool, distractorRes] = await Promise.all([
                    fetchPool(),
                    apiGet<{ chars: DistractorChar[] }>("/api/games/speedReading/distractors"),
                ]);
                if (cancelled) return;

                // NO CARD-COUNT GATE (docs/PROVISIONAL_CARDS.md). The server has already
                // lent whatever was needed to reach the Speed Reading baseline, so
                // `sufficient` can only be false when the dictionary itself ran dry.
                // A shorter queue still plays — the round builder consumes it card by
                // card — so we start the game rather than refusing it.
                queueRef.current = pool.cards;
                distractorsRef.current = distractorRes.chars;
                setQueueLength(pool.cards.length);
                // Speed Reading plays a fixed, known set, so the notice can name the
                // exact lent words (CARD_BASELINE_ITEMIZED).
                setProvisional(provisionalWords(pool.cards));
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
        // Keyed on `enabled` + `runId` — both stable identities that change only
        // on a deliberate action. NOT on `token`: a silent access-token refresh
        // (~every 15 min) must not re-run this loader and wipe a run in progress.
        // authHeader()/apiGet read the token at call time. See CLAUDE.md
        // "Never reload on token refresh".
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, runId]);

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
                // `exclude` carries every id still queued so a refill can't hand
                // back a word already waiting.
                const pool = await fetchPool({
                    need: TOPUP_BATCH,
                    excludeIds: queueRef.current.map((c) => c.id),
                });
                if (pool.cards.length === 0) return;

                // A concurrent dequeue can shift the queue under the request, so
                // re-check membership rather than trusting `exclude` alone.
                const known = new Set(queueRef.current.map((c) => c.id));
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

    return {
        /** Live ref, read at round-build time. */
        distractorsRef,
        queueLength,
        ready,
        loading,
        blockMessage,
        dequeue,
        /** Lent (temporary) words in this run's queue; empty when none were needed. */
        provisional,
    };
}
