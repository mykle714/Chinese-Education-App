import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { fetchChallenge, submitChallengeRound } from "../../api/studyChallenges";
import type { ChallengeSummary } from "../../api/studyChallenges";
import type { ChallengeScoreBreakdown } from "../../types";
import { challengeScoringFor } from "../registry";
import { createChallengeScorer, type ChallengeEvent, type ChallengeScorer } from "./challengeScoring";
import { anytimeQuerySuffix } from "../../features/studyChallenge/challengeAnytime";

/**
 * ONE STUDY CHALLENGE ROUND, from a game page's point of view
 * (docs/STUDY_CHALLENGE.md § 5).
 *
 * Every challenge-eligible game mounts this hook unconditionally and then behaves
 * exactly as it always did, except for three things:
 *
 *   1. it appends `poolParams` to its pool request, which turns the ordinary game
 *      pool into the round's board (twelve contested words + `mastered-first`
 *      filler — the server assembles it, see `OnDeckVocabService.getChallengeGamePool`);
 *   2. it calls `emit` where it already calls its mark function, tagging each event
 *      `contested` via `isContested`;
 *   3. it calls `finish(won)` where its run ends, and renders
 *      `<ChallengeRoundScoreboard>` from the returned `result`.
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
    /** Is this board card one of the twelve? Always false outside a challenge. */
    isContested: (entryKey: string) => boolean;
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

    const [challenge, setChallenge] = useState<ChallengeSummary | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<ChallengeRoundResult | null>(null);

    // The accumulator. A ref, not state: it is written from the pointer/rAF path and
    // nothing renders from it until the run ends.
    const scorerRef = useRef<ChallengeScorer | null>(null);
    const endedRef = useRef(false);
    const activeMsRef = useRef(0);

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

    const emit = useCallback((event: ChallengeEvent) => {
        if (endedRef.current) return;
        scorer()?.apply(event);
    }, [scorer]);

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

    const finish = useCallback((won: boolean) => {
        if (!active || !challengeId || endedRef.current) return;
        const current = scorer();
        if (!current) return;
        endedRef.current = true;

        current.apply({ kind: "end", won });
        // ONE ACCUMULATOR (§ 5.6): the number posted and the lines drawn are the same
        // snapshot object, so the card on screen can never disagree with the score
        // stored — there would be nothing to arbitrate between them if it did.
        const breakdown = current.snapshot();
        const previousTotal = Object.values(challenge?.rounds ?? {})
            .reduce((sum, round) => sum + (round.score ?? 0), 0);

        setResult({ roundIndex, breakdown, previousTotal, submitted: false, error: null });
        submitChallengeRound(challengeId, roundIndex, breakdown.total, breakdown)
            .then((updated) => {
                setChallenge(updated);
                setResult((prev) => (prev ? { ...prev, submitted: true } : prev));
            })
            .catch((err: unknown) => {
                // A submitted round is FINAL and there is no replay, so a failure here
                // is stated on the card rather than retried silently — the player needs
                // to know their score may not have been recorded.
                setResult((prev) => prev ? {
                    ...prev,
                    error: err instanceof Error ? err.message : "Could not save your round",
                } : prev);
            });
    }, [active, challengeId, challenge?.rounds, roundIndex, scorer]);

    const poolParams = useMemo(() => {
        if (!active || !challengeId) return "";
        const query = new URLSearchParams({ challengeId, gameId: opts.gameId });
        if (mode) query.set("mode", mode);
        // The tester hatch has to ride the BOARD read too, or a tester can open a
        // round from the challenge page and then be refused its cards
        // (docs/STUDY_CHALLENGE.md § 2a). Read at build time rather than captured, so
        // toggling it between rounds takes effect on the next board.
        return `&${query.toString()}${anytimeQuerySuffix()}`;
    }, [active, challengeId, opts.gameId, mode]);

    return {
        active,
        ready: active && !!challenge && !!challenge.gameSequence && !error,
        error,
        challengeId,
        roundIndex,
        roundCount: challenge?.roundCount ?? 0,
        challenge,
        poolParams,
        isContested: active ? isContested : NEVER_CONTESTED,
        emit,
        finish,
        result,
    };
}

/** Stable identity for the inactive case, so a game's deps array never churns. */
const NEVER_CONTESTED = (): boolean => false;
