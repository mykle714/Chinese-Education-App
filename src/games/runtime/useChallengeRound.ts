import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { fetchChallenge, submitChallengeRound } from "../../api/studyChallenges";
import type { ChallengeSummary } from "../../api/studyChallenges";
import type { ChallengeScoreBreakdown } from "../../types";
import { challengeScoringFor } from "../registry";
import { createChallengeScorer, type ChallengeEvent, type ChallengeScorer } from "./challengeScoring";
import { anytimeQuerySuffix, useChallengeAnytime } from "../../features/studyChallenge/challengeAnytime";

/**
 * ONE STUDY CHALLENGE ROUND, from a game page's point of view
 * (docs/STUDY_CHALLENGE.md § 5).
 *
 * Every challenge-eligible game mounts this hook unconditionally and then behaves
 * exactly as it always did, except for three things:
 *
 *   1. it appends `poolParams` to its pool request, which turns the ordinary game
 *      pool into the round's board (the CHALLENGE_WORD_COUNT contested words +
 *      `mastered-first`
 *      filler — the server assembles it, see `OnDeckVocabService.getChallengeGamePool`);
 *   2. it calls `emit` where it already calls its mark function, tagging each event
 *      `contested` via `isContested`;
 *   3. it calls `finish(won)` where its run ends, and renders
 *      `<ChallengeRoundScoreboard>` from the returned `result`;
 *   4. it guards its own Back control with `armed` — see below.
 *
 * `active` is false for an ordinary launch, and then every method here is a no-op —
 * so a game needs no `if (challenge)` branches around its own logic.
 *
 * ── WHY THE HOOK OWNS THE SCORER AND THE CLOCK ────────────────────────────────
 * The scoring spec is data (`CHALLENGE_GAMES`, server/contracts/wire.ts) and the
 * runner is a pure function over it (`challengeScoring.ts`), so the only per-game
 * work left is emitting events. Putting the accumulator here means four games
 * cannot drift into four subtly different interpretations of the same spec, and it
 * is what makes the § 5.6 rule — the breakdown and the total come from ONE
 * accumulator — structurally true rather than a convention.
 *
 * The ACTIVE-TIME clock lives here too, driven by the `paused` flag the page
 * already computes for its own popup/backgrounding gate. Time-based scoring rides
 * accumulated active time, never `now − startedAt` (§ 5.8): otherwise reading a
 * pre-round provisional notice, or taking a phone call, costs the player points
 * with no server-side clock to correct it.
 *
 * ── CONTESTED IS FIXED WHEN THE BOARD IS GENERATED ────────────────────────────
 * `isContested` tests the card's foreign word against the challenge's own set,
 * which is immutable for the whole week. It deliberately does NOT consult mastery:
 * a challenge round writes real marks, so a word can cross into Mastered MID-ROUND
 * (§ 5.7), and band-dependent scoring would be non-deterministic.
 *
 * The split is invisible on the board (Q74) — no glow, no ordering, nothing. The
 * server even shuffles the board so the deal order cannot leak it.
 *
 * ── THE ROUND IS SPENT AT THE FIRST MARK, NOT AT THE END ──────────────────────
 * (§ 5.1a.) The first `hit`/`miss` ARMS the round: it POSTs a claim, which the
 * server stores as a round with `completedAt: null`. From that instant:
 *
 *   • the attempt is used up — `nextRoundIndex` walks past a claimed round, so the
 *     board is never issued again. Quitting the app, reloading the tab or clearing
 *     local storage no longer buys a fresh run at the same round;
 *   • every later mark posts the CUMULATIVE score to the same slot, so the banked
 *     score tracks the run even if the app is killed without warning;
 *   • leaving the page — Back, a route change, a tab close — FINALISES the round
 *     where it stands, exactly as if the run had ended in a loss.
 *
 * This deliberately reverses the old "there is no abandoned round to score" rule
 * (Q33): backgrounding still merely pauses (§ 5.8), but actually walking out of the
 * game is now a completed, scored attempt. Because that is irreversible, a game
 * page must not let Back fire silently — it reads `armed` and confirms first.
 *
 * Progress writes are COALESCED (one in flight, ~1.2s apart minimum) rather than
 * one-per-mark on the wire. That is free precisely because each write carries the
 * whole snapshot rather than a delta: a dropped intermediate write loses nothing,
 * and it keeps a fast Bubble Match run from doubling every player's write rate
 * against the global `writeLimiter`.
 */

/** What a game page gets back. Every field is inert when `active` is false. */
export interface ChallengeRoundState {
    /** True when this page was opened as a challenge round. */
    active: boolean;
    /** The round's context has loaded and play may be scored. */
    ready: boolean;
    /** Why this round cannot be played, if it cannot. */
    error: string | null;
    challengeId: string | null;
    /** 1-based; `roundCount` may be fewer than 3 for a cross-language pair. */
    roundIndex: number;
    roundCount: number;
    /** The challenge, once loaded — the scoreboard reads the opponent and totals off it. */
    challenge: ChallengeSummary | null;
    /** `&challengeId=…&gameId=…&mode=…`, ready to append to a pool query. */
    poolParams: string;
    /** Is this board card one of the contested set? Always false outside a challenge. */
    isContested: (entryKey: string) => boolean;
    /**
     * The round has been CLAIMED — a mark has been made, the attempt is spent, and
     * leaving now banks the score as it stands (§ 5.1a).
     *
     * A game page must use this to guard its Back control: an irreversible, scored
     * exit that happens on a single silent tap is a trap. False outside a challenge,
     * and false again once the run has ended (there is then nothing left to lose).
     */
    armed: boolean;
    /** Feed the scorer. Ignored outside a challenge, and after the run has ended. */
    emit: (event: ChallengeEvent) => void;
    /** End the run and submit it. Idempotent — a second call is ignored. */
    finish: (won: boolean) => void;
    /** Present once `finish` has run: what to show on the between-games card (§ 5.5). */
    result: ChallengeRoundResult | null;
}

/** The finished round, as the scoreboard renders it. */
export interface ChallengeRoundResult {
    /**
     * WHICH round this card is showing — FROZEN at `finish`, deliberately.
     *
     * The submit response is a fresh challenge summary that already contains this
     * round, so the live `roundIndex` advances to the NEXT one the moment the POST
     * lands. A card reading it live would relabel itself mid-view ("Round 2 of 3"
     * over round 1's numbers) and would then compute the wrong "next round" button.
     */
    roundIndex: number;
    breakdown: ChallengeScoreBreakdown;
    /** Points banked in the player's EARLIER rounds — the "previous rounds" line. */
    previousTotal: number;
    /** null while the POST is in flight. */
    submitted: boolean;
    /** A failed submit, stated rather than swallowed — the round cannot be replayed. */
    error: string | null;
}

/** How often active time is pushed into the scorer. */
const TICK_MS = 250;

/**
 * Floor on the gap between two PROGRESS writes.
 *
 * Not a fidelity setting — every write carries the cumulative snapshot, so the only
 * thing a longer gap costs is how much of the run a hard kill would lose. It exists
 * because a challenge round already writes one mark per answer, and a second write
 * beside it would double every player's write rate against the global 600-per-5-min
 * `writeLimiter` (server/middleware/rateLimits.ts). The claim and the final write
 * ignore it.
 */
const PROGRESS_MIN_INTERVAL_MS = 1200;

export function useChallengeRound(opts: {
    /** This page's game id, as it appears in the challenge's drawn sequence. */
    gameId: string;
    /** The game's mode, for a moded game (Word Search). Null when it has one mode. */
    mode?: string | null;
    /** The page's own clock gate — popups AND backgrounding (§ 5.8). */
    paused: boolean;
    /** True only while the run is genuinely in progress. */
    running: boolean;
}): ChallengeRoundState {
    const [params] = useSearchParams();
    const challengeId = params.get("challengeId");
    const urlGameId = params.get("gameId");
    const mode = opts.mode ?? null;

    // A round belongs to THIS page only when the URL names this game. A stale link
    // to another game's round must not quietly score against this one; the server
    // would refuse the board anyway, but failing here keeps the page honest about
    // what it is running.
    const active = !!challengeId && (!urlGameId || urlGameId === opts.gameId);

    // Mounted for its side effect, not its value: `useChallengeAnytime` is what feeds
    // the validator latch that `anytimeQuerySuffix()` reads (docs/STUDY_CHALLENGE.md
    // § 2a). Without it a game opened by direct URL — rather than by walking through
    // the challenge list — would drop the hatch and be refused its board.
    const [anytime] = useChallengeAnytime();

    const [challenge, setChallenge] = useState<ChallengeSummary | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<ChallengeRoundResult | null>(null);

    // The accumulator. A ref, not state: it is written from the pointer/rAF path and
    // nothing renders from it until the run ends.
    const scorerRef = useRef<ChallengeScorer | null>(null);
    const endedRef = useRef(false);
    const activeMsRef = useRef(0);

    // ── The claim, and the write pipeline that follows it (§ 5.1a) ────────────
    // `armedRef` is the ref twin of the `armed` flag a page renders off; the ref is
    // what the unmount/pagehide handlers read, since they must see the value at the
    // instant they fire rather than the one captured when they were installed.
    const [armed, setArmed] = useState(false);
    const armedRef = useRef(false);
    /**
     * The round index FROZEN at the claim. Every later write for this run must name
     * the same slot: the submit response advances the derived index, and a write that
     * followed it would try to open the NEXT round from inside this one.
     */
    const claimedIndexRef = useRef<number | null>(null);
    /** A progress write is on the wire. */
    const writingRef = useRef(false);
    /** The score moved since the last write went out. */
    const dirtyRef = useRef(false);
    const lastWriteAtRef = useRef(0);
    const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const spec = useMemo(
        () => (active ? challengeScoringFor(opts.gameId, mode) : undefined),
        [active, opts.gameId, mode]
    );

    // Load the challenge. Keyed on the id and the stable auth-free identity of the
    // round — never on `token` (CLAUDE.md ⛔): a silent refresh mid-round must not
    // re-enter this and reset the scorer.
    useEffect(() => {
        if (!active || !challengeId) return;
        let cancelled = false;
        fetchChallenge(challengeId)
            .then((summary) => {
                if (cancelled) return;
                setChallenge(summary);
                // The sequence is withheld until the window opens (Q63), so its
                // absence IS "your test is not open" — there is no second check to
                // get wrong.
                if (!summary.gameSequence) {
                    setError("Your test window isn't open yet.");
                    return;
                }
                setError(null);
            })
            .catch((err: unknown) => {
                if (!cancelled) {
                    setError(err instanceof Error ? err.message : "Could not load that challenge round");
                }
            });
        return () => { cancelled = true; };
    }, [active, challengeId]);

    /**
     * The round this player is on — the first unplayed one, derived exactly the way
     * the server derives it (`StudyChallengeService.nextRoundIndex`). The `?round=`
     * in the URL is a display convenience and is never trusted: rounds are strictly
     * sequential with one attempt each (§ 5.1a), so the answer is a fact about the
     * challenge, not a parameter.
     */
    const roundIndex = useMemo(() => {
        const played = challenge?.rounds ?? {};
        let index = 1;
        while (played[String(index)]) index += 1;
        return index;
    }, [challenge?.rounds]);

    const contested = useMemo(
        () => new Set((challenge?.words ?? []).map((word) => word.word1)),
        [challenge?.words]
    );
    // Read through a ref inside `isContested` so the callback identity stays stable
    // across the load — a game that captured it in a board-generation closure must
    // not have to re-run that closure when the set arrives.
    const contestedRef = useRef(contested);
    contestedRef.current = contested;

    const isContested = useCallback(
        (entryKey: string) => contestedRef.current.has(entryKey),
        []
    );

    /** Created lazily on the first event, so a page that never plays never builds one. */
    const scorer = useCallback((): ChallengeScorer | null => {
        if (!active || !spec) return null;
        if (!scorerRef.current) scorerRef.current = createChallengeScorer(spec);
        return scorerRef.current;
    }, [active, spec]);

    /**
     * The slot this run owns. Tracks the derived index until the round is claimed,
     * then freezes: the final write's response advances `roundIndex` to the NEXT
     * round, and a late progress write reading it live would try to open that one
     * from inside this game.
     */
    const roundIndexRef = useRef(roundIndex);
    if (claimedIndexRef.current === null) roundIndexRef.current = roundIndex;

    /** One write of the current snapshot to this run's round slot. Never throws. */
    const send = useCallback(
        (breakdown: ChallengeScoreBreakdown, final: boolean, keepalive: boolean) => {
            const index = claimedIndexRef.current ?? roundIndexRef.current;
            if (!challengeId) return Promise.reject(new Error("No challenge round is open"));
            lastWriteAtRef.current = Date.now();
            return submitChallengeRound(challengeId, index, breakdown.total, breakdown, {
                final,
                keepalive,
            });
        },
        [challengeId]
    );

    /**
     * Push the running score to the server, at most one write in flight and no more
     * often than PROGRESS_MIN_INTERVAL_MS.
     *
     * Coalescing is lossless here BECAUSE EVERY WRITE IS A CUMULATIVE SNAPSHOT: a
     * dropped intermediate write is simply superseded by the next one. `dirtyRef`
     * exists so the last mark of a burst is not the one that gets dropped — when a
     * write lands with the score already moved on, another goes out behind it.
     */
    const flushProgress = useCallback(() => {
        if (endedRef.current || claimedIndexRef.current === null) return;
        if (writingRef.current) { dirtyRef.current = true; return; }

        const wait = PROGRESS_MIN_INTERVAL_MS - (Date.now() - lastWriteAtRef.current);
        if (wait > 0) {
            dirtyRef.current = true;
            // One timer, rearmed rather than stacked: several marks inside the window
            // must produce ONE write at the end of it, not one each.
            if (flushTimerRef.current === null) {
                flushTimerRef.current = setTimeout(() => {
                    flushTimerRef.current = null;
                    flushProgress();
                }, wait);
            }
            return;
        }

        const breakdown = scorerRef.current?.snapshot();
        if (!breakdown) return;
        dirtyRef.current = false;
        writingRef.current = true;
        send(breakdown, false, false)
            // A progress write is best-effort by design: the round is already claimed,
            // so failing one costs at most the points earned since the last success,
            // and the finalising write re-sends the whole snapshot anyway. Logged, not
            // surfaced — there is nothing the player could do about it mid-run.
            .catch((err: unknown) => console.error("[challenge] round progress write failed:", err))
            .finally(() => {
                writingRef.current = false;
                if (dirtyRef.current) flushProgress();
            });
    }, [send]);

    const emit = useCallback((event: ChallengeEvent) => {
        if (endedRef.current) return;
        scorer()?.apply(event);

        // ── THE CLAIM (§ 5.1a) ────────────────────────────────────────────────
        // A hit or a miss is a real flashcard mark, and the first one spends the
        // attempt. Deliberately NOT armed by a `use` (Word Search's hint) or a
        // `tick`: opening a board, reading it and backing out is not an attempt, and
        // a player who has answered nothing has nothing to be scored on.
        if (event.kind !== "hit" && event.kind !== "miss") return;
        if (claimedIndexRef.current === null) {
            claimedIndexRef.current = roundIndexRef.current;
            armedRef.current = true;
            setArmed(true);
        }
        flushProgress();
    }, [scorer, flushProgress]);

    // The active-time clock. Ticks only while the run is genuinely playing and not
    // paused, so backgrounding and modal popups cost the player nothing (§ 5.8).
    useEffect(() => {
        if (!active || !opts.running || opts.paused) return;
        const id = setInterval(() => {
            activeMsRef.current += TICK_MS;
            scorer()?.apply({ kind: "tick", activeMs: activeMsRef.current });
        }, TICK_MS);
        return () => clearInterval(id);
    }, [active, opts.running, opts.paused, scorer]);

    /**
     * End the run and write the round as FINAL.
     *
     * `keepalive` is the unload path: the request has to outlive the document, or a
     * tab closed mid-round banks whatever the last progress write had rather than
     * the real end-of-run score (survival bonuses and elapsed penalties in
     * particular are only correct once `end` has been applied).
     */
    const endRound = useCallback((won: boolean, keepalive: boolean) => {
        if (!active || !challengeId || endedRef.current) return;
        const current = scorer();
        if (!current) return;
        endedRef.current = true;
        // Nothing may follow the final write into this slot — the server would refuse
        // it, but a queued flush would also report a spurious failure.
        if (flushTimerRef.current !== null) {
            clearTimeout(flushTimerRef.current);
            flushTimerRef.current = null;
        }
        dirtyRef.current = false;

        current.apply({ kind: "end", won });
        // ONE ACCUMULATOR (§ 5.6): the number posted and the lines drawn are the same
        // snapshot object, so the card on screen can never disagree with the score
        // stored — there would be nothing to arbitrate between them if it did.
        const breakdown = current.snapshot();
        const index = claimedIndexRef.current ?? roundIndexRef.current;
        // EARLIER rounds only. Keyed comparison rather than "everything in `rounds`"
        // because this run's own round is now one of them — the claim put it there —
        // and counting it would add the round's score to itself.
        const previousTotal = Object.entries(challenge?.rounds ?? {})
            .filter(([key]) => Number(key) < index)
            .reduce((sum, [, round]) => sum + (round.score ?? 0), 0);

        setResult({ roundIndex: index, breakdown, previousTotal, submitted: false, error: null });
        send(breakdown, true, keepalive)
            .then((updated) => {
                setChallenge(updated);
                setResult((prev) => (prev ? { ...prev, submitted: true } : prev));
            })
            .catch((err: unknown) => {
                // A completed round is FINAL and there is no replay, so a failure here
                // is stated on the card rather than retried silently — the player needs
                // to know their score may not have been recorded.
                setResult((prev) => prev ? {
                    ...prev,
                    error: err instanceof Error ? err.message : "Could not save your round",
                } : prev);
            });
    }, [active, challengeId, challenge?.rounds, scorer, send]);

    const finish = useCallback((won: boolean) => endRound(won, false), [endRound]);

    /**
     * LEAVING A CLAIMED ROUND FINALISES IT (§ 5.1a).
     *
     * Read through a ref because both triggers fire outside React's control flow and
     * must see the CURRENT closure: the unmount cleanup runs after the last render,
     * and `pagehide` fires whenever the browser feels like it.
     */
    const endRoundRef = useRef(endRound);
    endRoundRef.current = endRound;

    useEffect(() => {
        if (!active) return;
        /**
         * `pagehide`, not `beforeunload` or `visibilitychange`:
         *  — `visibilitychange` is BACKGROUNDING, which pauses the round and must not
         *    score it (§ 5.8). Ending the round there would punish taking a phone call.
         *  — `beforeunload` does not fire reliably on mobile Safari, which is where a
         *    tab is most likely to disappear.
         * `persisted` distinguishes a real teardown from a bfcache freeze; a frozen
         * page can still come back, so it is treated as backgrounding.
         */
        const onPageHide = (event: PageTransitionEvent) => {
            if (event.persisted) return;
            if (!armedRef.current || endedRef.current) return;
            endRoundRef.current(false, true);
        };
        window.addEventListener("pagehide", onPageHide);
        return () => {
            window.removeEventListener("pagehide", onPageHide);
            if (flushTimerRef.current !== null) clearTimeout(flushTimerRef.current);
            // Unmount = the player navigated out of the game (Back, a footer tab, any
            // route change). The attempt was already spent at the first mark, so the
            // only question is what score it banks — and it banks the run as it stood,
            // scored as a loss, exactly like an abandoned live round would be.
            if (armedRef.current && !endedRef.current) endRoundRef.current(false, true);
        };
    }, [active]);

    const poolParams = useMemo(() => {
        if (!active || !challengeId) return "";
        const query = new URLSearchParams({ challengeId, gameId: opts.gameId });
        if (mode) query.set("mode", mode);
        // The tester hatch has to ride the BOARD read too, or a tester can open a
        // round from the challenge page and then be refused its cards
        // (docs/STUDY_CHALLENGE.md § 2a). Read at build time rather than captured, so
        // toggling it between rounds takes effect on the next board.
        return `&${query.toString()}${anytimeQuerySuffix()}`;
        // `anytime` is a dependency, not decoration: it is the effective (validator-
        // gated) value, and it changing is what makes the suffix change.
    }, [active, challengeId, opts.gameId, mode, anytime]);

    return {
        active,
        ready: active && !!challenge && !!challenge.gameSequence && !error,
        error,
        challengeId,
        // Frozen once claimed, for the same reason the result card freezes it: the
        // final write's response advances the derived index, and the header must not
        // relabel itself to "Round 2" over round 1's board. `armed` is what makes this
        // re-render, so the ref read is never stale.
        roundIndex: claimedIndexRef.current ?? roundIndex,
        roundCount: challenge?.roundCount ?? 0,
        challenge,
        poolParams,
        isContested: active ? isContested : NEVER_CONTESTED,
        // Nothing left to warn about once the run has ended — the round is written and
        // the player is looking at the scoreboard.
        armed: armed && !result,
        emit,
        finish,
        result,
    };
}

/** Stable identity for the inactive case, so a game's deps array never churns. */
const NEVER_CONTESTED = (): boolean => false;
