import React, { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { Box, Button, Typography } from "@mui/material";
import DelayedCircularProgress from "../../components/DelayedCircularProgress";
import ProvisionalCardsNotice from "../../components/ProvisionalCardsNotice";
import ProvisionalSortOffer from "../../components/ProvisionalSortOffer";
import AudioModeChip from "../../components/AudioModeChip";
import { useAuth } from "../../AuthContext";
import { useTTS } from "../../hooks/useTTS";
import { useFlashcardLearnSettings } from "../../hooks/useFlashcardLearnSettings";
import { useGameWins } from "../../hooks/useGameWins";
import { useProvisionalSortOffer } from "../../hooks/useProvisionalSortOffer";
import { markFlashcard } from "../../api/flashcards";
import { fetchGamePool, type GamePoolResponse } from "../../api/gamePool";
import { isProvisional, provisionalEntries, provisionalWords } from "../../utils/provisionalCards";
import { formatTimeMs } from "../../utils/timeUtils";
import type { Language, MarkType, VocabEntry } from "../../types";
import { SIZE, LEADING } from "../../theme/scale";
import type { FlpBreakResults } from "../flpBreak/types";
import { GameCentered, GameFrame } from "../shared/GameFrame";
import { GAME_FRAME_EXIT_CLEARANCE_PX } from "../shared/gameFrameExit";
import { usePersonalBest } from "../shared/usePersonalBest";
import ChallengeRoundScoreboard from "../runtime/ChallengeRoundScoreboard";
import { useBackgroundPause } from "../runtime/useBackgroundPause";
import { useChallengeRound } from "../runtime/useChallengeRound";
import { useGameBack } from "../runtime/useGameBack";
import type { GameStageFrameProps, GameStageHost } from "../types";
import BucketDropBoard from "./BucketDropBoard";
import BucketDropEndPopup from "./BucketDropEndPopup";
import { bucketDropPoolRequest } from "./poolRequest";
import {
    DROP_FALL_MS,
    GAME_ID,
    GAME_KEY,
    TOTAL_WORDS,
    WIN_LEVEL,
    medalFor,
    runResultDetail,
    runResultTitle,
    runTrackFor,
    type BucketDropModeConfig,
} from "./constants";

type Phase = "loading" | "blocked" | "playing" | "ended";

interface BucketDropStageProps {
    host: GameStageHost;
    /** The host's chrome — `GameLeafPage` on the route, `GameBreakFrame` in the flp. */
    Frame: ComponentType<GameStageFrameProps>;
    modeConfig: BucketDropModeConfig;
    /**
     * The run's track when the host has already decided it: an flp break's candidate, so
     * the marks land on the bar being studied whatever the language. Omitted on the route,
     * where it is `runTrackFor(language, modeConfig)`.
     */
    track?: MarkType;
    /** An flp break's working loop, seeding the board (docs/FLP_GAME_BREAKS.md § 4). */
    seedIds?: number[];
    /** An flp break's board, fetched while the card before it was up, so Play has no spinner. */
    prefetchedPool?: GamePoolResponse | null;
    /** Close with no results to show: "Back to …" (page), or a break that never dealt. */
    onDone: () => void;
    /** Names `onDone`'s destination: "Back to {doneLabel}". */
    doneLabel: string;
    /** flp break only: FlpBreakStageProps `onRunEnded`. Replaces the end popup. */
    onRunEnded?: (results: FlpBreakResults) => void;
    /** flp break only: FlpBreakStageProps `onCardCleared`. */
    onCardCleared?: (cardId: number) => void;
}

/**
 * BucketDropStage — one Bucket Drop run, whichever host it is in: drag each word from the
 * pile into the bucket holding its meaning, against a count-up clock
 * (docs/BUCKET_DROP_GAME.md). Hosted by BucketDropPage on the route and by the flp's game
 * break (src/games/flpBreak/bucketDropBreak.ts, docs/FLP_GAME_BREAKS.md § 6).
 *
 * Flow: loading → (blocked) → playing → ended → (Play Again, page only) loading …
 *
 * ── Layers ───────────────────────────────────────────────────────────────────
 *   page   BucketDropPage    the route's title, launch state and exit.
 *   stage  (this file)       pool fetch, the run's track, the stopwatch, marks, challenge
 *                            scoring, personal best, wins, every popup.
 *   board  BucketDropBoard   perimeter geometry, the queue, hit-testing and the drop
 *                            animations. Remounted per run (`key={runId}`).
 *   pure   perimeterLayout,  geometry and the run model, unit-tested without React.
 *          bucketQueue
 *
 * ── What differs by host ─────────────────────────────────────────────────────
 *   - the chrome (`Frame`);
 *   - the opening board (a break seeds it with the working loop, prefetched);
 *   - the track (a break's comes off its candidate, § "The run's track" below);
 *   - the results: the page shows its end popup, a break hands them to the flp's card
 *     (`onRunEnded`);
 *   - the way out: the page's Back is `useGameBack` (with the challenge confirm); a
 *     break's Leave ENDS a live run into its results card, unmedalled.
 *
 * ── The run's track ──────────────────────────────────────────────────────────
 * Latched at the first pool fetch, because the pool is bucketed and cooled on that track,
 * so the marks must name the same one. Route: `runTrackFor(language, mode)` (Pinyin ⇒
 * production, No Pinyin ⇒ reading). Break: `track`.
 *
 * ── The clock is ACCUMULATED ACTIVE TIME, and never on screen during play ─────
 * Nothing ticks on the board; the time is only read at the end, for the medal, the personal
 * best and the challenge score. It starts when the board is dealt and the provisional notice (if any) is closed, and
 * freezes for the notice and for backgrounding (docs/GAMES_FEATURE.md § Popups pause
 * the clock / § Backgrounding pauses the clock). It is banked into `activeMsRef` at each
 * pause, never derived from `now − startedAt`, so a pause can never be billed.
 *
 * ── Marks ────────────────────────────────────────────────────────────────────
 * One mark per word, ever: a word's FIRST wrong drop writes a negative mark, and its
 * correct drop writes a positive one only if it was never missed. A word missed and then
 * placed ends the run with just its negative — the same once-per-word rule as the
 * challenge spec's `missChargedOncePerWord`.
 */
const BucketDropStage: React.FC<BucketDropStageProps> = ({
    host,
    Frame,
    modeConfig,
    track,
    seedIds,
    prefetchedPool,
    onDone,
    doneLabel,
    onRunEnded,
    onCardCleared,
}) => {
    const isBreak = host === "flpBreak";
    const onCardClearedRef = useRef(onCardCleared);
    onCardClearedRef.current = onCardCleared;
    const { user } = useAuth();
    const tts = useTTS();
    const { settings } = useFlashcardLearnSettings();
    const { recordWin } = useGameWins(GAME_KEY);

    const language = (user?.selectedLanguage ?? "zh") as Language;

    const [phase, setPhase] = useState<Phase>("loading");
    const [blockMessage, setBlockMessage] = useState("");
    const [pool, setPool] = useState<VocabEntry[]>([]);
    const [runId, setRunId] = useState(0);
    const [noticeOpen, setNoticeOpen] = useState(false);
    const [misses, setMisses] = useState(0);
    /** Every word was placed. False on a run a break's Leave cut short. */
    const [finished, setFinished] = useState(false);
    /**
     * The run's result is final: the end popup opens, or a break reports. A beat after the
     * last drop, so its fall is seen.
     */
    const [resultsReady, setResultsReady] = useState(false);

    // ── The run's track, latched at the first fetch (see the header) ────────────
    const runTrackRef = useRef<MarkType | null>(null);
    const [runTrack, setRunTrack] = useState<MarkType>(track ?? modeConfig.markType);
    const lockRunTrack = useCallback((): MarkType => {
        if (!runTrackRef.current) {
            runTrackRef.current = track ?? runTrackFor(language, modeConfig);
            setRunTrack(runTrackRef.current);
        }
        return runTrackRef.current;
    }, [language, modeConfig, track]);
    // What the board draws follows the locked track, so display and marks agree: only a
    // READING run hides the pinyin.
    const boardShowPinyin = runTrack !== "reading";

    // ── Pause sources → one boolean ─────────────────────────────────────────────
    const { paused: backgroundPaused } = useBackgroundPause(phase === "playing");
    const clockPaused = noticeOpen || backgroundPaused;

    // ── Study Challenge round (inert for an ordinary launch, and so for a break) ─
    const challengeRound = useChallengeRound({
        gameId: GAME_ID,
        mode: modeConfig.mode,
        paused: clockPaused,
        running: phase === "playing",
    });
    const onBack = useGameBack(challengeRound);
    // Read through refs inside callbacks whose identity must survive a token refresh.
    const challengeParamsRef = useRef("");
    challengeParamsRef.current = challengeRound.poolParams;
    const challengeRef = useRef(challengeRound);
    challengeRef.current = challengeRound;

    // ── Pool ────────────────────────────────────────────────────────────────────
    const fetchPool = useCallback(async (): Promise<VocabEntry[] | null> => {
        try {
            const data = await fetchGamePool(bucketDropPoolRequest({
                markType: lockRunTrack(),
                challengeParams: challengeParamsRef.current,
                seedIds,
                flpBreak: isBreak,
            }));
            // NO CARD-COUNT GATE: the server has already lent cards up to the baseline
            // (docs/PROVISIONAL_CARDS.md). Only an empty pool cannot be played.
            if (!data.cards.length) {
                setBlockMessage("No cards are playable right now. Sort a few words in Add New Cards and try again.");
                setPhase("blocked");
                return null;
            }
            if (runTrackRef.current !== "reading") data.cards.forEach((c) => tts.prefetch(c));
            return data.cards;
        } catch {
            setBlockMessage("Couldn't load the game. Please try again.");
            setPhase("blocked");
            return null;
        }
        // `seedIds` and `isBreak` are fixed for the Stage's lifetime (the break's dealt
        // loop); `tts` is read at call time. No token anywhere (CLAUDE.md ⛔).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lockRunTrack]);

    // ── Stopwatch: accumulated active time ──────────────────────────────────────
    const activeMsRef = useRef(0);
    /** `Date.now()` the current running segment began, or null while stopped. */
    const segmentStartRef = useRef<number | null>(null);
    /** The banked total, as of the last pause or the run's end. Not a live reading. */
    const [elapsedMs, setElapsedMs] = useState(0);
    const clockRunning = phase === "playing" && !clockPaused;
    useEffect(() => {
        if (!clockRunning) return;
        segmentStartRef.current = Date.now();
        return () => {
            // Bank the segment. Runs on pause, on run end and on unmount alike.
            if (segmentStartRef.current !== null) activeMsRef.current += Date.now() - segmentStartRef.current;
            segmentStartRef.current = null;
            setElapsedMs(activeMsRef.current);
        };
    }, [clockRunning]);

    // ── Run lifecycle ───────────────────────────────────────────────────────────
    const missedIdsRef = useRef<Set<number>>(new Set());
    /** Words placed this run: the headline of a run left early. */
    const placedRef = useRef(0);
    const beginRun = useCallback((cards: VocabEntry[]) => {
        missedIdsRef.current = new Set();
        placedRef.current = 0;
        activeMsRef.current = 0;
        segmentStartRef.current = null;
        setElapsedMs(0);
        setMisses(0);
        setFinished(false);
        setResultsReady(false);
        setPool(cards);
        setNoticeOpen(provisionalWords(cards).length > 0);
        setRunId((n) => n + 1);
        setPhase("playing");
    }, []);

    // A challenge round that cannot be played says so instead of dealing a board.
    useEffect(() => {
        if (challengeRound.error) {
            setBlockMessage(challengeRound.error);
            setPhase("blocked");
        }
    }, [challengeRound.error]);

    useEffect(() => {
        if (!user) {
            setBlockMessage("Sign in to play Bucket Drop.");
            setPhase("blocked");
            return;
        }
        // Wait for the challenge payload: a board dealt before it lands would score
        // every word as filler (docs/GAMES_FEATURE.md § Challenge-eligible games).
        if (challengeRound.active && !challengeRound.ready) return;
        let cancelled = false;
        void (async () => {
            // A break's prefetched board, when it landed with cards; Play Again never
            // comes through here, so it is only ever the opening deal.
            const handedOver = prefetchedPool?.cards.length ? prefetchedPool.cards : null;
            if (handedOver) {
                if (lockRunTrack() !== "reading") handedOver.forEach((c) => tts.prefetch(c));
            }
            const cards = handedOver ?? await fetchPool();
            if (!cancelled && cards) beginRun(cards);
        })();
        return () => { cancelled = true; };
        // Keyed on the STABLE auth identity, never `token` (CLAUDE.md ⛔).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id, challengeRound.active, challengeRound.ready]);

    // Fastest FULL run per mode (docs/BUCKET_DROP_GAME.md § 6); recorded below.
    const { best: personalBestMs, isNewBest, record: recordPersonalBest, reset: resetPersonalBest } =
        usePersonalBest(GAME_ID, modeConfig.mode);
    /** This run's `recordPersonalBest`: whether it set a best. Read by the break's results. */
    const newBestRef = useRef<Promise<boolean>>(Promise.resolve(false));

    const playAgain = useCallback(async () => {
        tts.unlockAudio();
        setPhase("loading");
        resetPersonalBest();
        newBestRef.current = Promise.resolve(false);
        const cards = await fetchPool();
        if (cards) beginRun(cards);
    }, [tts, fetchPool, beginRun, resetPersonalBest]);

    // ── Board callbacks ─────────────────────────────────────────────────────────
    const onPickUp = useCallback((entry: VocabEntry) => {
        // Narrate on pickup, like Bubble Match's word bubbles — but never on a READING
        // run, where the sound would hand over the reading being tested. A production run
        // already shows the pinyin, and the sound names only the word in hand, never the
        // bucket it belongs in.
        if (runTrackRef.current !== "reading") void tts.autoSpeak(entry);
    }, [tts]);

    const onDrop = useCallback((entry: VocabEntry, correct: boolean) => {
        const firstMiss = !correct && !missedIdsRef.current.has(entry.id);
        if (correct) {
            placedRef.current += 1;
        } else {
            missedIdsRef.current.add(entry.id);
            setMisses((n) => n + 1);
        }
        // One mark per word (see the header): the first miss, or a clean placement.
        if (firstMiss || (correct && !missedIdsRef.current.has(entry.id))) {
            markFlashcard({ cardId: entry.id, isCorrect: correct, type: runTrackRef.current ?? modeConfig.markType, surface: GAME_ID })
                .then((result) => {
                    // The Deck Tower's tally: a recorded correct mark on a card that was on it.
                    if (correct && !result.suppressed && !isProvisional(entry) && !entry.outsideFocus) onCardClearedRef.current?.(entry.id);
                })
                .catch((err) => console.error(`[BucketDrop] mark failed → card ${entry.id}:`, err));
        }
        // Every drop is a scored event; the spec charges a word's misses once.
        const round = challengeRef.current;
        round.emit({ kind: correct ? "hit" : "miss", word: entry.entryKey, contested: round.isContested(entry.entryKey) });
    }, [modeConfig.markType]);

    const resultsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => { if (resultsTimerRef.current) clearTimeout(resultsTimerRef.current); }, []);
    const onComplete = useCallback(() => {
        // The clock stops on the drop itself (the phase change banks the segment); only
        // the results wait, so the last word's fall is seen.
        setFinished(true);
        setPhase("ended");
        challengeRef.current.finish(true);
        resultsTimerRef.current = setTimeout(() => setResultsReady(true), DROP_FALL_MS);
    }, []);

    // ── Result ──────────────────────────────────────────────────────────────────
    const finalMs = elapsedMs;
    /**
     * A medal and a personal best need a FULL, FINISHED run. A pool the dictionary could
     * not fill to TOTAL_WORDS is still playable, but its short time is not comparable, and
     * a run left early has no finish time.
     */
    const fullRun = pool.length >= TOTAL_WORDS;
    const earnsResult = finished && fullRun;
    const medal = phase === "ended" && earnsResult ? medalFor(finalMs) : null;

    // Once per run, when the result is final (`resultsReady` means the clock has been
    // banked). A challenge round is not a free-play best, like Word Search.
    const resultRecordedRef = useRef(-1);
    useEffect(() => {
        if (!resultsReady || resultRecordedRef.current === runId) return;
        resultRecordedRef.current = runId;
        if (medal) recordWin(WIN_LEVEL);
        if (earnsResult && !challengeRound.active) newBestRef.current = recordPersonalBest(finalMs);
    }, [resultsReady, runId, medal, earnsResult, finalMs, recordWin, recordPersonalBest, challengeRound.active]);

    const lentWords = provisionalWords(pool);
    const sortOffer = useProvisionalSortOffer(resultsReady, lentWords);
    const dismissSortOffer = sortOffer.dismiss;

    /**
     * The flp break's Leave (docs/FLP_GAME_BREAKS.md § 2). A LIVE run ends with what it
     * managed: no finish time, so no medal, win or personal best. From every other phase
     * there is nothing to show, so the break closes.
     */
    const leaveBreak = useCallback(() => {
        if (phase === "playing") {
            setPhase("ended");
            setResultsReady(true);
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

    // A break's run reports to the flp instead of showing the end popup, which is what
    // starts the shrink back to the card. A lent-card offer holds it: the offer lives over
    // this board, so it has to be answered before the board goes.
    const sortOfferPending = lentWords.length > 0 && !sortOffer.dismissed;
    useEffect(() => {
        if (!isBreak || !resultsReady || sortOfferPending) return;
        const bestBefore = personalBestMs;
        onRunEnded?.({
            title: runResultTitle(finished, medal),
            score: finished ? formatTimeMs(finalMs) : `${placedRef.current} of ${pool.length} words`,
            details: [runResultDetail(pool.length, misses, fullRun)],
            personalBest: newBestRef.current.then((isNew) => {
                const best = isNew ? finalMs : bestBefore;
                return best === null ? null : { game: GAME_ID, best, isNewBest: isNew };
            }),
        });
        // Once per run: nothing on the board can move after the run ends.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isBreak, resultsReady, sortOfferPending]);

    // ── Render ──────────────────────────────────────────────────────────────────
    return (
        <>
        <ProvisionalCardsNotice
            open={noticeOpen}
            onDismiss={() => setNoticeOpen(false)}
            surfaceName="Bucket Drop"
            entries={provisionalEntries(pool)}
            language={language}
        />
        <Frame
            title="Bucket Drop"
            onExitRequest={onExitRequest}
            // The app-wide narration chip, the same self-contained `AudioModeChip` as Bubble
            // Match / Word Search / Match Speed (docs/AUDIO_PLAYBACK.md). Offered only when
            // the run narrates (`onPickUp`): a READING run is silent, since hearing the word
            // would hand over the reading being tested — Bubble Match's `showAudioChip` rule.
            // A break's frame ignores it.
            headerRight={runTrack !== "reading" ? <AudioModeChip className="bucket-drop__audio-chip" /> : undefined}
        >
            <Box
                className="bucket-drop__content"
                sx={{
                    position: "relative",
                    flex: 1,
                    minHeight: 0,
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                    touchAction: "none",
                    userSelect: "none",
                    WebkitUserSelect: "none",
                    WebkitTouchCallout: "none",
                }}
            >
                {phase === "loading" && (
                    <GameCentered className="bucket-drop__overlay">
                        <DelayedCircularProgress className="bucket-drop__spinner" />
                    </GameCentered>
                )}

                {phase === "blocked" && (
                    <GameCentered className="bucket-drop__overlay">
                        <Typography className="bucket-drop__block-msg" sx={{ fontSize: SIZE.subtitle, lineHeight: LEADING.normal }}>
                            {blockMessage}
                        </Typography>
                        <Button className="bucket-drop__block-back" variant="contained" onClick={onDone}>
                            Back to {doneLabel}
                        </Button>
                    </GameCentered>
                )}

                {(phase === "playing" || phase === "ended") && (
                    <GameFrame className="bucket-drop__frame">
                        {/* No clock on the board. A break's bare screen keeps the buckets clear
                            of Leave's arrow at the top-left. */}
                        {isBreak && (
                            <Box className="bucket-drop__exit-clearance" sx={{ flexShrink: 0, height: GAME_FRAME_EXIT_CLEARANCE_PX }} />
                        )}
                        <BucketDropBoard
                            key={runId}
                            pool={pool}
                            showPinyin={boardShowPinyin}
                            showPinyinColor={settings.showPinyinColor}
                            paused={clockPaused || phase !== "playing"}
                            onPickUp={onPickUp}
                            onDrop={onDrop}
                            onComplete={onComplete}
                        />
                    </GameFrame>
                )}

                {/* A challenge round ends on the scoreboard, never on the game's own card. */}
                {resultsReady && challengeRound.active && (
                    <ChallengeRoundScoreboard round={challengeRound} classPrefix="bucket-drop" />
                )}

                {/* An flp break has no end popup: its results land on the break's card
                    (docs/FLP_GAME_BREAKS.md § 5b). */}
                {resultsReady && !challengeRound.active && !isBreak && (
                    <BucketDropEndPopup
                        medal={medal}
                        finalMs={finalMs}
                        total={pool.length}
                        misses={misses}
                        fullRun={fullRun}
                        personalBestMs={personalBestMs}
                        isNewBest={isNewBest}
                        exitLabel={doneLabel}
                        onPlayAgain={() => void playAgain()}
                        onLeave={onDone}
                    />
                )}

                <ProvisionalSortOffer
                    open={sortOffer.open}
                    words={lentWords}
                    language={language}
                    onDismiss={sortOffer.dismiss}
                    onNothingToOffer={sortOffer.dismiss}
                    minimized={sortOffer.minimized}
                    onMinimize={sortOffer.onMinimize}
                    onRestore={sortOffer.onRestore}
                />
            </Box>
        </Frame>
        </>
    );
};

export default BucketDropStage;
