import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { Box, Button, Typography, useTheme } from "@mui/material";
import DelayedCircularProgress from "../../components/DelayedCircularProgress";
import { useAuth } from "../../AuthContext";
import { useTTS } from "../../hooks/useTTS";
import { useFlashcardLearnSettings } from "../../hooks/useFlashcardLearnSettings";
import { useGameWins } from "../../hooks/useGameWins";
import { markFlashcard } from "../../api/flashcards";
import { fetchGamePool, type GamePoolDistribution, type GamePoolResponse } from "../../api/gamePool";
import type { GameStageFrameProps, GameStageHost } from "../types";
import type { FlpBreakResults } from "../flpBreak/types";
import { matchSpeedPoolRequest } from "./poolRequest";
import { COLORS } from "../../theme/colors";
import type { Language, MarkType, VocabEntry } from "../../types";
import MatchSpeedBoard from "./MatchSpeedBoard";
import MatchSpeedEndPopup from "./MatchSpeedEndPopup";
import { usePersonalBest } from "../shared/usePersonalBest";
import PersonalBestLine from "../shared/PersonalBestLine";
import { GameCentered, GameFrame, GameHint, GameHud, GameHudLabel } from "../shared/GameFrame";
import { GAME_FRAME_EXIT_CLEARANCE_PX } from "../shared/gameFrameExit";
import {
    bufferSize,
    bufferedEntryIds,
    emptyBuffer,
    fillBuffer,
    takePairs,
    topUpDistribution,
    topUpRequest,
    type CardBuffer,
} from "./cardBuffer";
import type { CardPair, GameCategory, Phase } from "./types";
import { dealChallengePairs, emptyDealState, type ChallengeDealState } from "./challengeDeal";
import {
    COUNTDOWN_STEPS,
    COUNTDOWN_STEP_MS,
    GAME_KEY,
    MARK_TYPE,
    PERSONAL_BEST_MODE,
    POOL_DISTRIBUTION,
    TARGET_PAIRS,
    WIN_LEVEL,
    medalForTime,
    runResultAccuracy,
    runResultScore,
    runResultTitle,
    BREAK_CARD_ASPECT,
    CATEGORY_FALLBACK_ORDER,
    BREAK_CARD_SCALE,
    CARD_ASPECT,
} from "./constants";
import { SIZE, WEIGHT, LEADING } from "../../theme/scale";
import ProvisionalCardsNotice from "../../components/ProvisionalCardsNotice";
import ProvisionalSortOffer from "../../components/ProvisionalSortOffer";
import { useProvisionalSortOffer } from "../../hooks/useProvisionalSortOffer";
import { useMarkedLentWords } from "../../hooks/useMarkedLentWords";
import { isProvisional, provisionalWords } from "../../utils/provisionalCards";
import { useBackgroundPause } from "../runtime/useBackgroundPause";
import { useChallengeRound } from "../runtime/useChallengeRound";
import { useGameBack } from "../runtime/useGameBack";
import ChallengeRoundScoreboard from "../runtime/ChallengeRoundScoreboard";
import { GAMES_HUB_EXIT } from "../runtime/gameExit";

export interface MatchSpeedStageProps {
    /** Who is hosting this run (docs/FLP_GAME_BREAKS.md § 6). */
    host: GameStageHost;
    /** The host's chrome — `GameLeafPage` on the route, `GameBreakFrame` in the flp. */
    Frame: ComponentType<GameStageFrameProps>;
    /** Header controls, passed through to `Frame` (the page's pinyin chip). */
    headerRight?: ReactNode;
    /** Pinyin on the board. The page passes the learner's setting; an flp break passes
        the flp bar's answer (core ⇒ shown — docs/FLP_GAME_BREAKS.md § 5a). */
    showPinyin: boolean;
    /** The track this run marks (and draws its pool by). Omitted ⇒ `MARK_TYPE`
        (recognition) — the page host. An flp break passes its candidate's track:
        `reading` on the reading flp, where pinyin is hidden (docs/FLP_GAME_BREAKS.md § 3). */
    markType?: MarkType;
    /** flp break only: the working loop to seed the OPENING board with (§ 4). */
    seedIds?: number[];
    /** flp break only: the opening pool, already fetched while card 10 was on screen,
        so Play has no spinner. Consumed by the first run only; Play Again (page host)
        always fetches fresh. */
    prefetchedPool?: GamePoolResponse | null;
    /** Close with no results to show: "Back to <GAMES_HUB_EXIT.label>" (page), or a break that never dealt. */
    onDone: () => void;
    /** flp break only: FlpBreakStageProps `onRunEnded`. Replaces the end popup. */
    onRunEnded?: (results: FlpBreakResults) => void;
    /** flp break only: FlpBreakStageProps `onCardCleared`. */
    onCardCleared?: (cardId: number) => void;
}

/**
 * Match Speed — the STAGE: phase machine, card supply, and marks, hosted either by
 * `MatchSpeedPage` (the game's own route) or by an flp game break
 * (src/games/flpBreak/matchSpeedBreak.ts, docs/FLP_GAME_BREAKS.md § 6).
 *
 * What differs by host is deliberately small:
 *   - the chrome (`Frame`);
 *   - the opening board (an flp break seeds it with the working loop, prefetched);
 *   - the results: the page shows its end popup (Play Again, cleanup); a break has none,
 *     and hands them to the flp's card instead (`onRunEnded`);
 *   - the way out: the page's Back is `useGameBack` (with the challenge confirm), while
 *     a break's Leave ENDS a live run into its results card — "leaving early" still
 *     shows what the player did — and closes the break from any other phase;
 *   - the results card offers Play Again only on the page.
 *
 * A recognition speed drill: how fast can you match TARGET_PAIRS pairs? 5 foreign words
 * on the left, their 5 English glosses (shuffled independently) on the right. Tap one
 * from each column to attempt a match; every 3 seconds the board refills the holes,
 * until all the run's pairs have been dealt and it just drains.
 *
 * Flow: loading → (blocked) → countdown → playing → ended → (popup minimized =
 * cleanup) → Play Again → countdown …
 *
 * One difficulty (the Study Mix weight table, constants.ts → CATEGORY_WEIGHTS): the
 * Review/Challenge modes were removed (docs/DEFERRED_WORK.md § 31), so every host deals
 * the same distribution (`POOL_DISTRIBUTION`).
 *
 * Layer split: this stage owns ALL I/O (the pool fetch, the buffer, marks, the
 * clock) and the phase machine; `MatchSpeedBoard` owns board/selection state and
 * asks for cards through `drawPairs`; `cardBuffer.ts` is pure. Nothing below this
 * file touches the network.
 *
 * Minute-points: the fire badge lives in the header and earning is gated by route
 * prefix in the global activity-detection layer (MINUTE_POINTS_ELIGIBLE_PAGES); the
 * page host renders the badge in its header.
 *
 * See docs/MATCH_SPEED_GAME.md, docs/FLP_GAME_BREAKS.md.
 */
const MatchSpeedStage: React.FC<MatchSpeedStageProps> = ({
    host,
    Frame,
    headerRight,
    showPinyin,
    markType = MARK_TYPE,
    seedIds,
    prefetchedPool,
    onDone,
    onRunEnded,
    onCardCleared,
}) => {
    const isBreak = host === "flpBreak";
    // Read through a ref: `markCard` is deliberately stable.
    const onCardClearedRef = useRef(onCardCleared);
    onCardClearedRef.current = onCardCleared;
    const theme = useTheme();
    const fc = theme.palette.flashcard;
    const { user } = useAuth();
    const tts = useTTS();
    // Only the colour setting is read here; `showPinyin` is the host's call (prop).
    const { settings } = useFlashcardLearnSettings();
    const { showPinyinColor } = settings;
    const { recordWin } = useGameWins(GAME_KEY);

    // Fastest finish, keyed on the Study Mix slug every existing best was recorded
    // under (docs/MATCH_SPEED_GAME.md § Personal best).
    const {
        best: personalBestPairs,
        isNewBest,
        record: recordPersonalBest,
        reset: resetPersonalBest,
    } = usePersonalBest("match-speed-30", PERSONAL_BEST_MODE);

    // Temporary cards are in play this run. Match Speed deals from a rolling buffer, so
    // the played set isn't known up front — the notice is the GENERIC form (no word
    // list), per CARD_BASELINE_ITEMIZED in server/contracts/wire.ts.
    const [noticeOpen, setNoticeOpen] = useState(false);
    // The lent words the player actually REVIEWED this run, which is what the end-of-run
    // "keep these" offer asks about even though the notice couldn't name anything up
    // front. This used to accumulate every lent card the buffer FETCHED — a set that
    // includes cards which never reached the board at all. Destructured because
    // `note`/`reset` are stable while the object identity is not, and `markCard`'s
    // identity has to survive a word being added.
    const {
        words: markedLentWords,
        note: noteMarkedLent,
        reset: resetMarkedLent,
    } = useMarkedLentWords();

    // `useBlockEdgeSwipe(true)` is the HOST's job (the page, or the flp break area):
    // it must hold for the whole time the game is on screen.

    const language = (user?.selectedLanguage ?? "zh") as Language;

    const [phase, setPhase] = useState<Phase>("loading");
    const [blockMessage, setBlockMessage] = useState("");
    /** Index into COUNTDOWN_STEPS while phase === "countdown". */
    const [countdownStep, setCountdownStep] = useState(0);
    // The finish time, stamped once by the final match. Nothing shows a live clock, so
    // this is the only clock state that renders.
    const [finishMs, setFinishMs] = useState(0);
    // The run's stopwatch. Refs, not state: there is nothing to display mid-run, so
    // timing must not cost the board a render. `bankedMsRef` is the playable time up
    // to the last pause; `clockStartRef` is when the current stretch began.
    const bankedMsRef = useRef(0);
    const clockStartRef = useRef(0);
    const [score, setScore] = useState(0);
    // Mirror of `score`, so the 30th match is detected in the tap that made it. Two
    // fingers can land two matches inside one batch, before `score` re-renders.
    const matchedRef = useRef(0);
    // Pairs handed to the board this run. This is what stops the refills at the end:
    // `drawPairs` never deals past TARGET_PAIRS.
    const dealtPairsRef = useRef(0);
    /** Attempts (correct + wrong) — the denominator of the end card's accuracy. */
    const [attempts, setAttempts] = useState(0);
    const [popupMinimized, setPopupMinimized] = useState(false);
    /** This run's `recordPersonalBest`: whether it set a best. Read by the break's results. */
    const newBestRef = useRef<Promise<boolean>>(Promise.resolve(false));
    /** Bumped per run so the board remounts with a clean slate on Play Again. */
    const [runId, setRunId] = useState(0);

    // The per-category pair buffer. A ref, not state: it is read and mutated from
    // the board's refill tick and from fetch callbacks, and nothing renders from
    // it — making it state would re-render the whole page on every top-up.
    const bufferRef = useRef<CardBuffer>(emptyBuffer());
    // Vocab-entry ids currently ON THE BOARD. Together with the buffer's ids this
    // is the `exclude` list every top-up sends. See the fetch comment for why.
    const onBoardIdsRef = useRef<Set<number>>(new Set());
    // Guards against overlapping top-ups: ticks fire every 3s but a request can
    // take longer, and two in flight would both exclude the same ids and hand back
    // the same cards — a duplicate on screen, the exact thing exclude prevents.
    const topUpInFlightRef = useRef(false);

    // Hoisted above the loaders because the challenge round's active-time clock
    // needs it (the pause GATE itself still reads below, next to the run clock it
    // protects — see `clockPaused`).
    const { paused: backgroundPaused } =
        useBackgroundPause(phase === "countdown" || phase === "playing");

    // ── STUDY CHALLENGE ROUND (docs/STUDY_CHALLENGE.md § 5) ──
    // `paused`/`running` are the same two facts the run clock already uses, restated
    // here rather than read from `clockPaused` (declared below, after the loaders):
    // a challenge round's ACTIVE-TIME clock and the run clock must stop on
    // exactly the same conditions (§ 5.8), and Match Speed's pause sources are the
    // provisional notice plus backgrounding. (A settings sheet used to be a third:
    // it was deleted on 2026-08-28 when both its settings moved to the header and
    // /settings. Its replacements are header chips, which do NOT pause — they leave
    // the board playable, and the pause rule covers input-blocking overlays only.
    // See docs/GAMES_FEATURE.md § Backgrounding pauses the clock.)
    const challengeRound = useChallengeRound({
        gameId: "match-speed",
        paused: noticeOpen || backgroundPaused,
        running: phase === "playing",
    });
    // Back: the challenge mid-test, or the Games hub — and, on a claimed challenge
    // round, the confirm that says leaving ends it (docs/STUDY_CHALLENGE.md § 5.1a).
    const onBack = useGameBack(challengeRound);
    // Read from a ref inside `fetchPool`, whose identity is stable by design.
    const challengeParamsRef = useRef("");
    challengeParamsRef.current = challengeRound.poolParams;

    /**
     * The challenge deal state — the contested queue plus its parity counter. The
     * RULE itself lives in `challengeDeal.ts` (pure, tested); this is just where the
     * run's copy of it is kept. See § 5.3.
     */
    const dealStateRef = useRef<ChallengeDealState>(emptyDealState());

    /**
     * Fetch pool cards into the buffer.
     *
     * `exclude` carries every card on the board PLUS every card in the buffer.
     * This is NOT a repeat gate: repeats across a run are prevented by the
     * server's own cooldown, and when a library is small, falling back to
     * a cooled card is correct behavior the client must not block. `exclude`
     * exists solely to prevent a DUPLICATE ON SCREEN — a card on the board or in
     * the buffer has not been marked yet, so it isn't on cooldown and a top-up
     * would happily hand it back, putting the same word in two rows at once.
     * (Bubble Match has the identical case and solves it identically via keepIds.)
     *
     * We deliberately do not use the `avoid` soft-demote param.
     */
    const fetchPool = useCallback(
        async (distribution: GamePoolDistribution, topUp = false): Promise<GamePoolResponse | null> => {
            const data = await fetchGamePool(matchSpeedPoolRequest({
                distribution,
                exclude: [...onBoardIdsRef.current, ...bufferedEntryIds(bufferRef.current)],
                challengeParams: challengeParamsRef.current,
                // MID-RUN TOP-UPS ARE FILLER ONLY (§ 5.3). The contested words
                // are dealt once, from the opening fetch, and are never recycled back
                // into the buffer — so a refill that re-served them would hand the
                // player a second bite at a word the round has already scored.
                excludeContested: topUp,
                // An flp break seeds the OPENING board only; a top-up is a refill of
                // what the run has used, never another pass over the working loop.
                seedIds: topUp ? undefined : seedIds,
                markType,
                // On every request, top-ups included: a focused flp break stays outside
                // the day's set for the whole run (docs/FOCUS_MODE.md § 4a).
                flpBreak: isBreak,
            }));
            // Warm the TTS cache so in-game autoplay is instant (mirrors flp).
            data.cards.forEach((c) => tts.prefetch(c));
            return data;
        },
        // apiGet reads the token at call time, so this callback's identity stays
        // stable across a silent token refresh. See CLAUDE.md "Never reload on token
        // refresh". `seedIds`, `markType` and `isBreak` are likewise omitted: all are
        // fixed for the stage's lifetime (the break's dealt loop).
        // eslint-disable-next-line react-hooks/exhaustive-deps
        []
    );

    /**
     * Restore every bucket toward BUFFER_DEPTH. Fired after each refill tick for
     * exactly what was consumed, so the requests stay small and steady.
     *
     * FIRE-AND-FORGET with a .catch(): a failed top-up degrades to a thinner
     * buffer and more category fallbacks, never to a broken run.
     */
    const topUpBuffer = useCallback(() => {
        if (topUpInFlightRef.current) return;
        // Enough cards are already in hand to finish the run: stop fetching.
        const inHand = bufferSize(bufferRef.current) + dealStateRef.current.contested.length;
        if (TARGET_PAIRS - dealtPairsRef.current <= inHand) return;
        const request = topUpRequest(bufferRef.current);
        if (!request) return;
        topUpInFlightRef.current = true;
        fetchPool(topUpDistribution(request), true)
            .then((data) => {
                if (data) {
                    // NOTHING IS ANNOUNCED HERE, deliberately. A top-up may well lend —
                    // the buffer refills all run — but a modal mid-run costs a
                    // reaction-time game clock and lands over a board the player is
                    // mid-tap on. Lent cards arriving mid-run are visible instead
                    // through the corner badge on the card itself (MatchSpeedCard).
                    fillBuffer(bufferRef.current, data.cards);
                    // A RUN MUST ALWAYS BE ABLE TO FINISH: with no clock, a board that
                    // stops being fed would hang forever. So when the server has
                    // nothing at all and the board has drained, end the run where it
                    // stands.
                    if (
                        bufferSize(bufferRef.current) === 0
                        && dealStateRef.current.contested.length === 0
                        && onBoardIdsRef.current.size === 0
                    ) {
                        setPhase((current) => (current === "playing" ? "ended" : current));
                    }
                }
            })
            .catch((err) => console.error("[MatchSpeed] buffer top-up failed:", err))
            .finally(() => {
                topUpInFlightRef.current = false;
            });
    }, [fetchPool]);

    /**
     * Hand the board `count` pairs, remembering them as on-board for `exclude`.
     *
     * The `isBlocked` predicate is the client-side duplicate gate: a pair whose
     * entry is already on the board is discarded rather than placed, because two
     * cards for one entry share a `pairId` and would make every combination of
     * the four a "correct" match. `takePairs` separately gates within the batch.
     * See cardBuffer.ts § takePairs for why `exclude` alone isn't sufficient.
     *
     * Reads the ref inside the predicate (not a captured value) so the test is
     * against the board as it stands at draw time.
     */
    const drawPairs = useCallback((count: number): CardPair[] => {
        const takeFiller = (n: number): CardPair[] =>
            takePairs(bufferRef.current, n, Math.random, (pair) =>
                onBoardIdsRef.current.has(pair.entry.id)
            );

        // A challenge round deals under the alternation rule (§ 5.3); an ordinary run
        // is the buffered draw it has always been.
        // Never past the run's total. This cap is the whole end-of-run behavior: the
        // last holes simply stay empty and the board drains to the final pair.
        const allowed = Math.min(count, TARGET_PAIRS - dealtPairsRef.current);
        const pairs = challengeRound.active
            ? dealChallengePairs(dealStateRef.current, allowed, () => takeFiller(1)[0] ?? null)
            : takeFiller(allowed);
        dealtPairsRef.current += pairs.length;
        pairs.forEach((p) => onBoardIdsRef.current.add(p.entry.id));
        return pairs;
    }, [challengeRound.active]);

    // The flp break's prefetched opening pool, handed over ONCE: the first run adopts
    // it, and anything after (there is no Play Again on that host, but a remount-less
    // re-deal must still be fresh) fetches normally.
    const prefetchedRef = useRef<GamePoolResponse | null>(prefetchedPool ?? null);

    /** Prime the buffer and start a run (shared by first load and Play Again). */
    const beginRun = useCallback(async (): Promise<void> => {
        setPhase("loading");
        bufferRef.current = emptyBuffer();
        onBoardIdsRef.current = new Set();
        dealtPairsRef.current = 0;
        matchedRef.current = 0;
        // A replay is judged on its own borrowed words, not the previous run's.
        resetMarkedLent();
        try {
            const handedOver = prefetchedRef.current;
            prefetchedRef.current = null;
            if (handedOver) handedOver.cards.forEach((c) => tts.prefetch(c));
            const data = handedOver ?? await fetchPool(POOL_DISTRIBUTION);
            if (!data) return;
            // NO CARD-COUNT GATE. The server topped the player up to the Match Speed
            // baseline before building this pool, so `sufficient` can only be false
            // when the dictionary itself ran dry — and a short buffer still deals a
            // playable run. See docs/PROVISIONAL_CARDS.md.

            // Generic notice only — Match Speed cannot name its set up front. Fired
            // from HERE and nowhere else: this is the one moment before the clock
            // starts, so the notice never interrupts a live run (see topUpBuffer).
            setNoticeOpen(provisionalWords(data.cards).length > 0);

            // A challenge board arrives as one shuffled set of contested + filler
            // (the server never reveals which is which by position — Q74), so the
            // split happens HERE, once, against the challenge's own word list. Fixed
            // at deal time and never re-derived: a word can band up mid-round.
            dealStateRef.current = emptyDealState();
            const dealt = challengeRound.active
                ? data.cards.filter((card) => {
                    if (!challengeRound.isContested(card.entryKey)) return true;
                    dealStateRef.current.contested.push({
                        pairId: `pair-${card.id}`,
                        entry: card,
                        // The buffer's category stamp is a BAND, and a contested pair
                        // is not drawn by band — it is dealt by the alternation. The
                        // first fallback bucket stands in for a missing stamp, as in
                        // `fillBuffer`.
                        category: (card.gameCategory ?? CATEGORY_FALLBACK_ORDER[0]) as GameCategory,
                    });
                    return false;
                })
                : data.cards;
            fillBuffer(bufferRef.current, dealt);
            setScore(0);
            setAttempts(0);
            setFinishMs(0);
            bankedMsRef.current = 0;
            setPopupMinimized(false);
            setCountdownStep(0);
            setRunId((n) => n + 1);
            setPhase("countdown");
        } catch {
            setBlockMessage("Couldn't load the game. Please try again.");
            setPhase("blocked");
        }
        // `challengeRound`'s members are stable by construction; the object identity
        // is not, and listing it would re-create `beginRun` on every render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fetchPool, resetMarkedLent]);

    // A challenge round that cannot be played is stated, never silently downgraded
    // to a casual run that scores nothing.
    useEffect(() => {
        if (challengeRound.error) {
            setBlockMessage(challengeRound.error);
            setPhase("blocked");
        }
    }, [challengeRound.error]);

    // Initial load. Keyed on the STABLE auth identity, NOT `token`: a silent
    // access-token refresh (~every 15 min) must not restart the game mid-run.
    // See CLAUDE.md "Never reload/reset a page on a silent token refresh".
    useEffect(() => {
        if (!user) {
            setBlockMessage("Sign in to play Match Speed.");
            setPhase("blocked");
            return;
        }
        // WAIT FOR THE CHALLENGE CONTEXT. The round's contested set arrives with the
        // challenge payload, and a board dealt before it lands would be classified
        // entirely as filler — a round scored at 20 points a card with no way to tell
        // afterwards that it went wrong. `ready` flips once, so this costs an
        // ordinary launch nothing (`active` is false and the guard never fires).
        if (challengeRound.active && !challengeRound.ready) return;
        void beginRun();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id, challengeRound.active, challengeRound.ready]);

    // ── Popup pause gate ─────────────────────────────────────────────────────
    // No game clock may run while a MODAL popup is covering the board: the
    // provisional-cards notice opens the instant a run is primed and the settings
    // sheet can be opened mid-run, and both take the whole screen — reading them
    // would otherwise be billed to the player's time. Both are input-blocking
    // overlays, so freezing the clock can't be used to study the live board for
    // free. The end popup is deliberately absent: by then the clock has stopped.
    // Shared rule across all four games — see docs/GAMES_FEATURE.md § Popups pause
    // the clock.
    // BACKGROUNDING IS THE SECOND SOURCE for this same boolean — the app-wide rule
    // (docs/GAMES_FEATURE.md § Backgrounding pauses the clock). The run clock is the
    // thing being protected here: without this, time in the background would count
    // against the player's finish.
    const clockPaused = noticeOpen || backgroundPaused;

    // The 3·2·1·Go countdown. The board is already primed and readable behind it,
    // so the opening board gets a beat to be read and the run clock starts from an
    // identical state every time — nobody is billed for reading time.
    //
    // Driven by one timeout per step, re-armed by `countdownStep` changing, rather
    // than an interval whose callback inspects the step inside a state updater —
    // an updater must stay a pure function of previous state (StrictMode runs it
    // twice), and advancing the phase from inside one is exactly the side effect
    // that rule exists to prevent.
    useEffect(() => {
        if (phase !== "countdown" || clockPaused) return;
        const isLastStep = countdownStep >= COUNTDOWN_STEPS.length - 1;
        const id = setTimeout(
            () => (isLastStep ? setPhase("playing") : setCountdownStep((step) => step + 1)),
            COUNTDOWN_STEP_MS
        );
        return () => clearTimeout(id);
    }, [phase, countdownStep, clockPaused]);

    // The run's hidden stopwatch. No timer is shown; it only produces the finish time.
    //
    // Each stretch of play banks its time when it stops, so a pause (see `clockPaused`)
    // costs nothing — the finish time counts only *playable* time, no matter how long a
    // popup sat on top of the board. Only the final match ends the run (handleMatch).
    useEffect(() => {
        if (phase !== "playing" || clockPaused) return;
        clockStartRef.current = Date.now();
        return () => {
            bankedMsRef.current += Date.now() - clockStartRef.current;
        };
    }, [phase, clockPaused]);

    // Bank the win badge on a gold run only, once the run has ended. Gold-only
    // keeps the hub badge an achievement rather than a play counter. Logged under
    // WIN_LEVEL (1), the key the game's win history has always used.
    useEffect(() => {
        if (phase !== "ended") return;
        // `won: true` unconditionally: Match Speed has no win/loss and no survival
        // bonus (its challenge shape is the alternation rule instead), so the flag
        // only ever decides an all-or-nothing bonus this game does not have.
        challengeRound.finish(true);
        // An unfinished run (left early, or out of cards) has no finish time to judge.
        const finished = score >= TARGET_PAIRS;
        if (finished && medalForTime(finishMs)?.medal === "gold") recordWin(WIN_LEVEL);
        // A challenge round's deal is the round's shared word set, not the player's
        // own pool, so it does not compete with their personal best.
        newBestRef.current = finished && !challengeRound.active
            ? recordPersonalBest(finishMs)
            : Promise.resolve(false);
        // Runs once per run end; recordWin's identity is not stable across renders.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phase]);

    /**
     * Record a recognition mark for a matched/mismatched card. Fire-and-forget
     * with a .catch(): the game never blocks or fails on a mark request.
     * Suppressed entirely during cleanup — the board itself never calls onMatch /
     * onMiss in that mode, so this is only ever reached from live play.
     */
    const markCard = useCallback(
        (entry: VocabEntry, isCorrect: boolean) => {
            // A foreign → meaning drill: recognition with pinyin, reading on the
            // reading flp's no-pinyin break (`markType` prop). excludeIds defaults to
            // []: the game doesn't use the replacement card the endpoint returns.
            markFlashcard({ cardId: entry.id, isCorrect, type: markType, surface: "match-speed" })
                .then((result) => {
                    if (isCorrect && !result.suppressed && !isProvisional(entry) && !entry.outsideFocus) onCardClearedRef.current?.(entry.id);
                })
                .catch((err) => console.error(`[MatchSpeed] mark failed → card ${entry.id}:`, err));
            // Feeds the end-of-run "keep these cards?" offer. Recorded on the ATTEMPT,
            // so a miss and a cooldown-suppressed mark both count, and never on the
            // fetch — the buffer holds cards that never reach the board
            // (docs/PROVISIONAL_CARDS.md § 5).
            noteMarkedLent(entry);
            // A challenge round is normal play plus a scored event (§ 5.7). A miss is
            // charged at most once per foreign word per run, which the shared runner
            // enforces off the spec — not here.
            challengeRound.emit({
                kind: isCorrect ? "hit" : "miss",
                word: entry.entryKey,
                contested: challengeRound.isContested(entry.entryKey),
            });
        },
        // No `token` dep — markFlashcard reads the header at call time, so this
        // callback's identity is stable across a silent refresh (CLAUDE.md ⛔ rule).
        // The challenge round's emit/isContested are stable by construction, as is
        // `noteMarkedLent` (useCallback with no deps). `markType` is fixed for the
        // stage's lifetime (the page's constant, or the break's dealt candidate).
        // eslint-disable-next-line react-hooks/exhaustive-deps
        []
    );

    const handleMatch = useCallback(
        (entry: VocabEntry) => {
            matchedRef.current += 1;
            setScore(matchedRef.current);
            setAttempts((n) => n + 1);
            // The last pair stops the clock on the tap itself, not on the next tick.
            if (matchedRef.current >= TARGET_PAIRS) {
                setFinishMs(bankedMsRef.current + Date.now() - clockStartRef.current);
                setPopupMinimized(false);
                setPhase("ended");
            }
            // The pair is leaving the board, so it stops excluding itself from
            // top-ups; the server's cooldown governs whether it comes back.
            onBoardIdsRef.current.delete(entry.id);
            markCard(entry, true);
        },
        [markCard]
    );

    const handleMiss = useCallback(
        (entry: VocabEntry) => {
            // Score is pairs matched and nothing else — a wrong attempt costs only
            // the time it wastes. It still counts toward accuracy, and still marks
            // the FOREIGN card incorrect (the board resolves which that is).
            setAttempts((n) => n + 1);
            markCard(entry, false);
        },
        [markCard]
    );

    /** Play Again: Match Speed's board is fully transient, so a replay just
     *  re-primes the buffer and starts a fresh run. Primes the audio element
     *  inside this real click gesture, before the awaited fetch, or mobile autoplay
     *  policy would drop the first spoken word. */
    const playAgain = useCallback(() => {
        tts.unlockAudio();
        resetPersonalBest();
        void beginRun();
    }, [tts.unlockAudio, beginRun, resetPersonalBest]);

    // End-of-run offer to keep the lent cards; opens a beat after the end popup. Named
    // from what the player REVIEWED — the pre-round notice could not name anything, and
    // the served set would include cards that sat in the buffer untouched.
    const sortOffer = useProvisionalSortOffer(phase === "ended", markedLentWords);
    const dismissSortOffer = sortOffer.dismiss;

    /**
     * The flp break's Leave (docs/FLP_GAME_BREAKS.md § 2). A LIVE run ends with what it
     * managed. It has no finish time, so it earns no medal,
     * win or personal best unless all the pairs were already matched.
     * From every other phase there is nothing to show, so the break closes.
     */
    const leaveBreak = useCallback(() => {
        if (phase === "countdown" || phase === "playing") {
            setPopupMinimized(false);
            setPhase("ended");
            return;
        }
        // An ended run is only ever still here for the sort offer: Leave is its "not now".
        if (phase === "ended") {
            dismissSortOffer();
            return;
        }
        onDone();
        // `dismissSortOffer` is a fresh closure over stable setters.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phase, onDone]);
    const onExitRequest = isBreak ? leaveBreak : onBack;

    // Cleanup: the run is scored and the popup has been tucked into its corner
    // puck, so the leftover board becomes a no-stakes study surface — no clock, no
    // refills, no marks, and tapping a card reveals its partner. Derived rather
    // than a separate phase value so the two can never disagree.
    const cleanupMode = phase === "ended" && popupMinimized;
    // False for a run left early, or one that ran out of cards.
    const runFinished = score >= TARGET_PAIRS;

    // A break's run reports to the flp instead of showing an end popup, which is what
    // starts the shrink back to the card. A lent-card offer holds it: the offer lives
    // over this board, so it has to be answered before the board goes.
    const sortOfferPending = markedLentWords.length > 0 && !sortOffer.dismissed;
    useEffect(() => {
        if (!isBreak || phase !== "ended" || sortOfferPending) return;
        const bestBefore = personalBestPairs;
        onRunEnded?.({
            title: runResultTitle(score, finishMs),
            score: runResultScore(score, finishMs),
            details: [runResultAccuracy(score, attempts)],
            personalBest: newBestRef.current.then((isNewBest) => {
                const best = isNewBest ? finishMs : bestBefore;
                return best === null ? null : { game: "match-speed-30", best, isNewBest };
            }),
        });
        // Once per run: the score and the clock cannot move after the run ends.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isBreak, phase, sortOfferPending]);

    // The centred column shown INSTEAD of the board (spinner, or the blocked
    // message). The shape is shared — `GameCentered` also owns the rule that text on
    // the accent ground is white — so this is only the page's class name for it.
    const renderCentered = (children: React.ReactNode) => (
        <GameCentered className="match-speed__overlay">{children}</GameCentered>
    );

    const showBoard = phase === "countdown" || phase === "playing" || phase === "ended";

    return (
        // The host's `Frame` supplies the chrome: a LEAF PAGE on the route
        // (docs/LEAF_NODE_PAGES.md), the game area's header in an flp break.
        <>
        {/* Generic (non-itemized) notice: Match Speed deals from a rolling buffer, so
            the set of lent cards isn't known before the run starts. */}
        <ProvisionalCardsNotice
            open={noticeOpen}
            onDismiss={() => setNoticeOpen(false)}
            surfaceName="Match Speed"
            language={(user?.selectedLanguage ?? "zh") as Language}
            // Match Speed badges its lent cards in-round (MatchSpeedCard), so the
            // notice teaches the mark instead of only announcing the lending.
            badgedInRound
        />
        <Frame title="Match Speed" onExitRequest={onExitRequest} headerRight={headerRight}>
            <Box
                className="match-speed__content"
                sx={{
                    // Anchors the absolutely-positioned end-popup scrim.
                    position: "relative",
                    flex: 1,
                    minHeight: 0,
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                    userSelect: "none",
                    WebkitUserSelect: "none",
                    WebkitTouchCallout: "none",
                }}
            >
                {phase === "loading" && renderCentered(<DelayedCircularProgress className="match-speed__spinner" />)}

                {phase === "blocked" &&
                    renderCentered(
                        <>
                            <Typography
                                className="match-speed__block-msg"
                                sx={{ fontSize: SIZE.subtitle, lineHeight: LEADING.normal }}
                            >
                                {blockMessage}
                            </Typography>
                            <Button
                                className="match-speed__block-back"
                                variant="contained"
                                onClick={onDone}
                            >
                                {isBreak ? "Back to cards" : `Back to ${GAMES_HUB_EXIT.label}`}
                            </Button>
                        </>
                    )}

                {showBoard && (
                    <GameFrame className="match-speed__frame">
                        {/* How the run is going: the score, pinned right like Writing
                            Grid's one-label strip (the game has one mode and no launch
                            collection, so there is nothing to name on the left). An flp
                            break has no strip: a blank row keeps the board clear of
                            Leave's arrow at the top-left
                            (docs/MATCH_SPEED_GAME.md § The HUD strip and the hint line). */}
                        {isBreak ? (
                            <Box className="match-speed__exit-clearance" sx={{ flexShrink: 0, height: GAME_FRAME_EXIT_CLEARANCE_PX }} />
                        ) : (
                            <GameHud className="match-speed__hud" sx={{ justifyContent: "flex-end" }}>
                                <GameHudLabel className="match-speed__hud-score">{score}/{TARGET_PAIRS} matched</GameHudLabel>
                            </GameHud>
                        )}

                        <MatchSpeedBoard
                            // Remounting per run is what resets the board; the buffer
                            // and score are reset by beginRun.
                            key={runId}
                            language={language}
                            showPinyin={showPinyin}
                            showPinyinColor={showPinyinColor}
                            drawPairs={drawPairs}
                            onRefilled={topUpBuffer}
                            onMatch={handleMatch}
                            onMiss={handleMiss}
                            cleanupMode={cleanupMode}
                            // Readable but not yet live during the countdown, and
                            // frozen once the run ends until the popup is minimized
                            // into cleanup mode.
                            frozen={phase === "countdown" || (phase === "ended" && !cleanupMode)}
                            onSpeak={tts.autoplay ? tts.autoSpeak : undefined}
                            cardAspect={isBreak ? BREAK_CARD_ASPECT : CARD_ASPECT}
                            cardScale={isBreak ? BREAK_CARD_SCALE : 1}
                        />

                        {/* 3·2·1·Go, over a readable board. */}
                        {phase === "countdown" && (
                            <Box
                                className="match-speed__countdown"
                                sx={{
                                    position: "absolute",
                                    inset: 0,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    backgroundColor: COLORS.scrim,
                                    pointerEvents: "none",
                                    zIndex: 5,
                                }}
                            >
                                <Typography
                                    className="match-speed__countdown-step"
                                    // Keyed by step so the zoom animation replays on
                                    // each tick rather than only on mount.
                                    key={countdownStep}
                                    sx={{
                                        fontSize: "72px",
                                        fontWeight: WEIGHT.bold,
                                        color: COLORS.white,
                                        textShadow: "0 2px 12px rgba(0,0,0,0.4)",
                                        animation: "match-speed-countdown-pop 400ms ease-out",
                                        "@keyframes match-speed-countdown-pop": {
                                            from: { opacity: 0, transform: "scale(0.5)" },
                                            to: { opacity: 1, transform: "scale(1)" },
                                        },
                                    }}
                                >
                                    {COUNTDOWN_STEPS[countdownStep]}
                                </Typography>
                            </Box>
                        )}

                        {!isBreak && <GameHint className="match-speed__hint">tap a word, then its meaning</GameHint>}
                    </GameFrame>
                )}

                {/* A CHALLENGE ROUND ENDS ON THE SCOREBOARD (§ 5.5), which replaces
                    the medal card entirely: the round is scored on contested/filler
                    points rather than on finish time alone, and there is no Play Again to
                    offer because a submitted round is final (§ 5.1a). */}
                {showBoard && phase === "ended" && challengeRound.active && (
                    <ChallengeRoundScoreboard round={challengeRound} classPrefix="match-speed" />
                )}

                {/* An flp break has no end popup: its results land on the break's card
                    (docs/FLP_GAME_BREAKS.md § 5b). */}
                {showBoard && phase === "ended" && !challengeRound.active && !isBreak && (
                    <MatchSpeedEndPopup
                        minimized={popupMinimized}
                        // A finished run leaves an empty board, so there is nothing to
                        // uncover. Only a run cut short has a leftover board to study.
                        onMinimize={runFinished ? undefined : () => setPopupMinimized(true)}
                        onRestore={() => setPopupMinimized(false)}
                    >
                        <Typography
                            className="match-speed__popup-title"
                            sx={{ fontSize: SIZE.heading, fontWeight: WEIGHT.bold, color: fc.onSurface }}
                        >
                            {runResultTitle(score, finishMs)}
                        </Typography>
                        <Typography
                            className="match-speed__popup-score"
                            sx={{ fontSize: SIZE.bodyLg, color: fc.onSurface, fontWeight: WEIGHT.bold }}
                        >
                            {runResultScore(score, finishMs)}
                        </Typography>
                        {/* Information only — accuracy never gates a medal. */}
                        <Typography
                            className="match-speed__popup-accuracy"
                            sx={{ fontSize: SIZE.body, color: fc.textSecondary }}
                        >
                            {runResultAccuracy(score, attempts)}
                        </Typography>
                        <PersonalBestLine
                            game="match-speed-30"
                            best={personalBestPairs}
                            isNewBest={isNewBest}
                            className="match-speed__personal-best"
                        />
                        <Box
                            className="match-speed__replay-actions"
                            sx={{ display: "flex", flexDirection: "column", gap: 1.25, width: "100%" }}
                        >
                            <Button
                                className="match-speed__replay-btn match-speed__replay-btn--play-again"
                                variant="contained"
                                onClick={playAgain}
                                sx={{
                                    py: 1.25,
                                    borderRadius: "14px",
                                    textTransform: "none",
                                    fontSize: SIZE.bodyLg,
                                    fontWeight: WEIGHT.bold,
                                    lineHeight: LEADING.tight,
                                }}
                            >
                                Play Again
                            </Button>
                            <Button
                                className="match-speed__replay-btn match-speed__replay-btn--back"
                                variant="outlined"
                                onClick={onDone}
                                sx={{
                                    py: 1,
                                    borderRadius: "14px",
                                    textTransform: "none",
                                    fontWeight: WEIGHT.medium,
                                }}
                            >
                                Back to {GAMES_HUB_EXIT.label}
                            </Button>
                        </Box>
                    </MatchSpeedEndPopup>
                )}

                {/* Stacks over the end popup, collapsing to the opposite corner.
                    Renders nothing unless this run used lent cards. A sibling of the
                    frame, not a child of it: both this and the end popup cover the whole
                    content area, so they must not be clipped by the panel's radius. */}
                {showBoard && (
                    <ProvisionalSortOffer
                        open={sortOffer.open}
                        words={markedLentWords}
                        language={(user?.selectedLanguage ?? "zh") as Language}
                        onDismiss={sortOffer.dismiss}
                        onNothingToOffer={sortOffer.dismiss}
                        minimized={sortOffer.minimized}
                        onMinimize={sortOffer.onMinimize}
                        onRestore={sortOffer.onRestore}
                    />
                )}
            </Box>
        </Frame>
        </>
    );
};

export default MatchSpeedStage;
