import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Box, Button, Typography } from "@mui/material";
import DelayedCircularProgress from "../../components/DelayedCircularProgress";
import ProvisionalCardsNotice from "../../components/ProvisionalCardsNotice";
import ProvisionalSortOffer from "../../components/ProvisionalSortOffer";
import AudioModeChip from "../../components/AudioModeChip";
import { useAuth } from "../../AuthContext";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useTTS } from "../../hooks/useTTS";
import { useFlashcardLearnSettings } from "../../hooks/useFlashcardLearnSettings";
import { useBlockEdgeSwipe } from "../../hooks/useBlockEdgeSwipe";
import { useGameWins } from "../../hooks/useGameWins";
import { useProvisionalSortOffer } from "../../hooks/useProvisionalSortOffer";
import { markFlashcard } from "../../api/flashcards";
import { fetchGamePool } from "../../api/gamePool";
import { useLaunchCollection } from "../../features/flashcards/useLaunchCollection";
import { provisionalEntries, provisionalWords } from "../../utils/provisionalCards";
import { formatTimeMs } from "../../utils/timeUtils";
import type { Language, MarkType, VocabEntry } from "../../types";
import { SIZE, LEADING } from "../../theme/scale";
import { GameLeafPage } from "../shared/GameSurface";
import { GameCentered, GameFrame, GameTimer } from "../shared/GameFrame";
import { usePersonalBest } from "../shared/usePersonalBest";
import { useLocalGameSettings } from "../shared/useLocalGameSettings";
import GamePausedOverlay from "../runtime/GamePausedOverlay";
import ChallengeRoundScoreboard from "../runtime/ChallengeRoundScoreboard";
import { useBackgroundPause } from "../runtime/useBackgroundPause";
import { useChallengeRound } from "../runtime/useChallengeRound";
import { useGameBack } from "../runtime/useGameBack";
import { useGameExit } from "../runtime/gameExit";
import BucketDropStage from "./BucketDropStage";
import BucketDropEndPopup from "./BucketDropEndPopup";
import {
    DROP_FALL_MS,
    GAME_DISTRIBUTION,
    GAME_HUE,
    GAME_ID,
    GAME_KEY,
    SETTINGS_STORAGE_KEY,
    DEFAULT_SETTINGS,
    TOTAL_WORDS,
    WIN_LEVEL,
    medalFor,
    modeConfigFor,
    runTrackFor,
} from "./constants";

type Phase = "loading" | "blocked" | "playing" | "ended";

/**
 * Bucket Drop — drag each word from the pile into the bucket holding its meaning, against a
 * count-up clock (docs/BUCKET_DROP_GAME.md).
 *
 * Flow: loading → (blocked) → playing → ended → (Play Again) loading …
 *
 * ── Layers ───────────────────────────────────────────────────────────────────
 *   page   (this file)       pool fetch, the run's track, the stopwatch, marks, challenge
 *                            scoring, personal best, wins, every popup.
 *   stage  BucketDropStage   the board: perimeter geometry, the queue, hit-testing and
 *                            the drop animations. Remounted per run (`key={runId}`).
 *   pure   perimeterLayout,  geometry and the run model, unit-tested without React.
 *          bucketQueue
 *
 * ── Mode = launch surface ────────────────────────────────────────────────────
 * `state.mode` from the launch: the Games hub tile sends nothing (Pinyin), the Reading
 * Center carousel sends `no-pinyin`. The run's TRACK is `runTrackFor(language, mode)`
 * (Pinyin ⇒ production, No Pinyin ⇒ reading), latched at the first pool fetch — the
 * pool is bucketed and cooled on that track, so the marks must name the same one.
 *
 * ── The clock is ACCUMULATED ACTIVE TIME ─────────────────────────────────────
 * It starts when the board is dealt and the provisional notice (if any) is closed, and
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
const BucketDropPage: React.FC = () => {
    usePageTitle("Bucket Drop");
    const navigate = useNavigate();
    const location = useLocation();
    const gameExit = useGameExit();
    const { user } = useAuth();
    const tts = useTTS();
    const { settings } = useFlashcardLearnSettings();
    const { recordWin } = useGameWins(GAME_KEY);
    // Which collection the hub was pointed at (docs/DECKS_FEATURE.md) — appended to the
    // pool request so the run stays inside it. Null for the Reading Center launch.
    const launchCollection = useLaunchCollection();

    // Every game page blocks the browser's edge-swipe-back (CLAUDE.md "Touch & Scroll").
    useBlockEdgeSwipe(true);

    const modeConfig = modeConfigFor((location.state as { mode?: unknown } | null)?.mode);
    const language = (user?.selectedLanguage ?? "zh") as Language;

    const [phase, setPhase] = useState<Phase>("loading");
    const [blockMessage, setBlockMessage] = useState("");
    const [pool, setPool] = useState<VocabEntry[]>([]);
    const [runId, setRunId] = useState(0);
    const [noticeOpen, setNoticeOpen] = useState(false);
    const [misses, setMisses] = useState(0);
    /** The end popup opens a beat after the last drop, so its fall is seen. */
    const [popupOpen, setPopupOpen] = useState(false);

    // ── The run's track, latched at the first fetch (see the header) ────────────
    const runTrackRef = useRef<MarkType | null>(null);
    const [runTrack, setRunTrack] = useState<MarkType>(modeConfig.markType);
    const lockRunTrack = useCallback((): MarkType => {
        if (!runTrackRef.current) {
            runTrackRef.current = runTrackFor(language, modeConfig);
            setRunTrack(runTrackRef.current);
        }
        return runTrackRef.current;
    }, [language, modeConfig]);
    // What the board draws follows the locked track, so display and marks agree: only a
    // READING run hides the pinyin.
    const boardShowPinyin = runTrack !== "reading";

    // ── Pause sources → one boolean ─────────────────────────────────────────────
    const { paused: backgroundPaused, resume: resumeFromBackground } = useBackgroundPause(phase === "playing");
    const clockPaused = noticeOpen || backgroundPaused;

    // ── Study Challenge round (inert for an ordinary launch) ────────────────────
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
            const data = await fetchGamePool({
                markType: lockRunTrack(),
                surface: GAME_ID,
                distribution: GAME_DISTRIBUTION,
                collection: launchCollection,
                challengeParams: challengeParamsRef.current,
            });
            // NO CARD-COUNT GATE: the server has already lent cards up to the baseline
            // (docs/PROVISIONAL_CARDS.md). Only an empty pool cannot be played.
            if (!data.cards.length) {
                setBlockMessage("No cards are playable right now. Sort a few words in Discover and try again.");
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
        // `launchCollection` comes from this page's own URL and cannot change without a
        // remount; `tts` is read at call time. No token anywhere (CLAUDE.md ⛔).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lockRunTrack]);

    // ── Stopwatch: accumulated active time ──────────────────────────────────────
    const activeMsRef = useRef(0);
    /** `Date.now()` the current running segment began, or null while stopped. */
    const segmentStartRef = useRef<number | null>(null);
    const [elapsedMs, setElapsedMs] = useState(0);
    // Device-local "show timer" preference behind the stopwatch's eye — Word Search's /
    // Writing Grid's behaviour, kept under this game's own key. Hiding never pauses the clock.
    const { settings: dropSettings, update: updateDropSettings } = useLocalGameSettings(SETTINGS_STORAGE_KEY, DEFAULT_SETTINGS);
    const { showTimer } = dropSettings;
    const readClock = () => activeMsRef.current + (segmentStartRef.current === null ? 0 : Date.now() - segmentStartRef.current);
    const clockRunning = phase === "playing" && !clockPaused;
    useEffect(() => {
        if (!clockRunning) return;
        segmentStartRef.current = Date.now();
        const id = setInterval(() => setElapsedMs(readClock()), 200);
        return () => {
            clearInterval(id);
            // Bank the segment. Runs on pause, on run end and on unmount alike.
            if (segmentStartRef.current !== null) activeMsRef.current += Date.now() - segmentStartRef.current;
            segmentStartRef.current = null;
            setElapsedMs(activeMsRef.current);
        };
    }, [clockRunning]);

    // ── Run lifecycle ───────────────────────────────────────────────────────────
    const missedIdsRef = useRef<Set<number>>(new Set());
    const beginRun = useCallback((cards: VocabEntry[]) => {
        missedIdsRef.current = new Set();
        activeMsRef.current = 0;
        segmentStartRef.current = null;
        setElapsedMs(0);
        setMisses(0);
        setPopupOpen(false);
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
            const cards = await fetchPool();
            if (!cancelled && cards) beginRun(cards);
        })();
        return () => { cancelled = true; };
        // Keyed on the STABLE auth identity, never `token` (CLAUDE.md ⛔).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id, challengeRound.active, challengeRound.ready]);

    // Fastest FULL run per mode (docs/BUCKET_DROP_GAME.md § 6); recorded below.
    const { best: personalBestMs, isNewBest, record: recordPersonalBest, reset: resetPersonalBest } =
        usePersonalBest(GAME_ID, modeConfig.mode);

    const playAgain = useCallback(async () => {
        tts.unlockAudio();
        setPhase("loading");
        resetPersonalBest();
        const cards = await fetchPool();
        if (cards) beginRun(cards);
    }, [tts, fetchPool, beginRun, resetPersonalBest]);

    // ── Stage callbacks ─────────────────────────────────────────────────────────
    const onPickUp = useCallback((entry: VocabEntry) => {
        // Narrate on pickup, like Bubble Match's word bubbles — but never on a READING
        // run, where the sound would hand over the reading being tested. A production run
        // already shows the pinyin, and the sound names only the word in hand, never the
        // bucket it belongs in.
        if (runTrackRef.current !== "reading") void tts.autoSpeak(entry);
    }, [tts]);

    const onDrop = useCallback((entry: VocabEntry, correct: boolean) => {
        const firstMiss = !correct && !missedIdsRef.current.has(entry.id);
        if (!correct) {
            missedIdsRef.current.add(entry.id);
            setMisses((n) => n + 1);
        }
        // One mark per word (see the header): the first miss, or a clean placement.
        if (firstMiss || (correct && !missedIdsRef.current.has(entry.id))) {
            markFlashcard({ cardId: entry.id, isCorrect: correct, type: runTrackRef.current ?? modeConfig.markType, surface: GAME_ID })
                .catch((err) => console.error(`[BucketDrop] mark failed → card ${entry.id}:`, err));
        }
        // Every drop is a scored event; the spec charges a word's misses once.
        const round = challengeRef.current;
        round.emit({ kind: correct ? "hit" : "miss", word: entry.entryKey, contested: round.isContested(entry.entryKey) });
    }, [modeConfig.markType]);

    const popupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => { if (popupTimerRef.current) clearTimeout(popupTimerRef.current); }, []);
    const onComplete = useCallback(() => {
        // The clock stops on the drop itself (the phase change banks the segment); only
        // the popup waits, so the last word's fall is seen.
        setPhase("ended");
        challengeRef.current.finish(true);
        popupTimerRef.current = setTimeout(() => setPopupOpen(true), DROP_FALL_MS);
    }, []);

    // ── Result ──────────────────────────────────────────────────────────────────
    const finalMs = elapsedMs;
    /**
     * A medal and a personal best need a FULL run. A pool the dictionary could not fill
     * to TOTAL_WORDS is still playable, but its short time is not comparable.
     */
    const fullRun = pool.length >= TOTAL_WORDS;
    const medal = phase === "ended" && fullRun ? medalFor(finalMs) : null;

    // Once per run, when the result is final (the popup opening means the clock has
    // been banked). A challenge round is not a free-play best, like Word Search.
    const resultRecordedRef = useRef(-1);
    useEffect(() => {
        if (!popupOpen || resultRecordedRef.current === runId) return;
        resultRecordedRef.current = runId;
        if (medal) recordWin(WIN_LEVEL);
        if (fullRun && !challengeRound.active) void recordPersonalBest(finalMs);
    }, [popupOpen, runId, medal, fullRun, finalMs, recordWin, recordPersonalBest, challengeRound.active]);

    const sortOffer = useProvisionalSortOffer(popupOpen, provisionalWords(pool));

    // ── Render ──────────────────────────────────────────────────────────────────
    const leave = () => navigate(gameExit.path, { state: gameExit.state });
    const total = pool.length;

    return (
        <>
        <ProvisionalCardsNotice
            open={noticeOpen}
            onDismiss={() => setNoticeOpen(false)}
            surfaceName="Bucket Drop"
            entries={provisionalEntries(pool)}
            language={language}
        />
        <GameLeafPage
            hue={GAME_HUE}
            title="Bucket Drop"
            onBack={onBack}
            // The app-wide narration chip, the same self-contained `AudioModeChip` as Bubble
            // Match / Word Search / Match Speed (docs/AUDIO_PLAYBACK.md). Offered only when
            // the run narrates (`onPickUp`): a READING run is silent, since hearing the word
            // would hand over the reading being tested — Bubble Match's `showAudioChip` rule.
            rightContent={runTrack !== "reading" ? <AudioModeChip className="bucket-drop__audio-chip" /> : undefined}
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
                        <Button className="bucket-drop__block-back" variant="contained" onClick={leave}>
                            Back to {gameExit.label}
                        </Button>
                    </GameCentered>
                )}

                {(phase === "playing" || phase === "ended") && (
                    <GameFrame className="bucket-drop__frame">
                        {/* A bare stopwatch: no `fraction`, so no track under it. */}
                        <GameTimer
                            className="bucket-drop__stopwatch"
                            value={formatTimeMs(elapsedMs)}
                            dimmed={phase === "ended"}
                            valueShown={showTimer}
                            onToggleValueShown={() => updateDropSettings({ showTimer: !showTimer })}
                        />
                        <BucketDropStage
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
                {popupOpen && challengeRound.active && (
                    <ChallengeRoundScoreboard round={challengeRound} classPrefix="bucket-drop" />
                )}

                {popupOpen && !challengeRound.active && (
                    <BucketDropEndPopup
                        medal={medal}
                        finalMs={finalMs}
                        total={total}
                        misses={misses}
                        fullRun={fullRun}
                        personalBestMs={personalBestMs}
                        isNewBest={isNewBest}
                        exitLabel={gameExit.label}
                        onPlayAgain={() => void playAgain()}
                        onLeave={leave}
                    />
                )}

                <ProvisionalSortOffer
                    open={sortOffer.open}
                    words={provisionalWords(pool)}
                    language={language}
                    onDismiss={sortOffer.dismiss}
                    minimized={sortOffer.minimized}
                    onMinimize={sortOffer.onMinimize}
                    onRestore={sortOffer.onRestore}
                />
            </Box>

            {/* Backgrounding paused the run — covers the board until Resume. */}
            <GamePausedOverlay open={backgroundPaused} onResume={resumeFromBackground} classPrefix="bucket-drop" />
        </GameLeafPage>
        </>
    );
};

export default BucketDropPage;
