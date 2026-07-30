import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Button, Typography, useTheme } from "@mui/material";
import DelayedCircularProgress from "../../components/DelayedCircularProgress";
import { useAuth } from "../../AuthContext";
import { API_BASE_URL } from "../../constants";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useTTS } from "../../hooks/useTTS";
import { useFlashcardLearnSettings } from "../../hooks/useFlashcardLearnSettings";
import { useBlockEdgeSwipe } from "../../hooks/useBlockEdgeSwipe";
import { useGameWins } from "../../hooks/useGameWins";
import { markFlashcard } from "../../api/flashcards";
import { authHeader } from "../../utils/authHeader";
import LeafPage from "../../components/LeafPage";
import type { Language, VocabEntry } from "../../types";
import MatchSpeedBoard from "./MatchSpeedBoard";
import MatchSpeedHeaderControls from "./MatchSpeedHeader";
import MatchSpeedEndPopup from "./MatchSpeedEndPopup";
import MatchSpeedSettingsDialog from "./MatchSpeedSettingsDialog";
import MatchSpeedTimerBar from "./MatchSpeedTimerBar";
import {
    bufferedEntryIds,
    emptyBuffer,
    fillBuffer,
    takePairs,
    topUpQuery,
    topUpRequest,
    type CardBuffer,
} from "./cardBuffer";
import type { CardPair, Phase } from "./types";
import {
    COUNTDOWN_STEPS,
    COUNTDOWN_STEP_MS,
    ENTRY_GATE_CARDS,
    GAME_KEY,
    POOL_QUERY,
    RUN_DURATION_MS,
    WIN_LEVEL,
    medalForScore,
} from "./constants";
import { SIZE, WEIGHT, LEADING } from "../../theme/scale";

/** Shape returned by GET /api/onDeck/gamePool. */
interface GamePoolResponse {
    cards: VocabEntry[];
    requested: Record<string, number>;
    available: Record<string, number>;
    total: number;
    needed: number;
    sufficient: boolean;
}

/** How often the run clock re-renders. Fine enough for a smooth `m:ss`. */
const CLOCK_INTERVAL_MS = 200;

/**
 * Match Speed — page shell, phase machine, card supply, and marks.
 *
 * A 60-second recognition throughput drill: 5 foreign words on the left, their 5
 * English glosses (shuffled independently) on the right. Tap one from each column
 * to attempt a match; every 2 seconds the board refills the holes.
 *
 * Flow: loading → (blocked) → countdown → playing → ended → (popup minimized =
 * cleanup) → Play Again → countdown …
 *
 * Layer split: this page owns ALL I/O (the pool fetch, the buffer, marks, the
 * clock) and the phase machine; `MatchSpeedBoard` owns board/selection state and
 * asks for cards through `drawPairs`; `cardBuffer.ts` is pure. Nothing below this
 * file touches the network.
 *
 * Minute-points: the fire badge lives in the header and earning is gated by route
 * prefix in the global activity-detection layer (MINUTE_POINTS_ELIGIBLE_PAGES), so
 * this page only renders the badge.
 *
 * See docs/MATCH_SPEED_GAME.md.
 */
const MatchSpeedPage: React.FC = () => {
    usePageTitle("Match Speed");
    const navigate = useNavigate();
    const theme = useTheme();
    const fc = theme.palette.flashcard;
    const { user } = useAuth();
    const tts = useTTS();
    const { settings, update } = useFlashcardLearnSettings();
    const { showPinyin, showPinyinColor, autoplayChinese } = settings;
    const { recordWin } = useGameWins(GAME_KEY);

    // Mandatory on every game page (CLAUDE.md): an edge swipe would otherwise
    // navigate away mid-run. CSS touch-action can't stop the history gesture.
    useBlockEdgeSwipe(true);

    const language = (user?.selectedLanguage ?? "zh") as Language;

    const [phase, setPhase] = useState<Phase>("loading");
    const [blockMessage, setBlockMessage] = useState("");
    /** Index into COUNTDOWN_STEPS while phase === "countdown". */
    const [countdownStep, setCountdownStep] = useState(0);
    const [remainingMs, setRemainingMs] = useState(RUN_DURATION_MS);
    const [score, setScore] = useState(0);
    /** Attempts (correct + wrong) — the denominator of the end card's accuracy. */
    const [attempts, setAttempts] = useState(0);
    const [popupMinimized, setPopupMinimized] = useState(false);
    /** Settings sheet (pinyin / tone colors / autoplay), behind the header cog. */
    const [settingsOpen, setSettingsOpen] = useState(false);
    /** Bumped per run so the board remounts with a clean slate on Play Again. */
    const [runId, setRunId] = useState(0);

    // The per-category pair buffer. A ref, not state: it is read and mutated from
    // the board's refill tick and from fetch callbacks, and nothing renders from
    // it — making it state would re-render the whole page on every top-up.
    const bufferRef = useRef<CardBuffer>(emptyBuffer());
    // Vocab-entry ids currently ON THE BOARD. Together with the buffer's ids this
    // is the `exclude` list every top-up sends. See the fetch comment for why.
    const onBoardIdsRef = useRef<Set<number>>(new Set());
    // Guards against overlapping top-ups: ticks fire every 2s but a request can
    // take longer, and two in flight would both exclude the same ids and hand back
    // the same cards — a duplicate on screen, the exact thing exclude prevents.
    const topUpInFlightRef = useRef(false);

    /**
     * Fetch pool cards into the buffer.
     *
     * `exclude` carries every card on the board PLUS every card in the buffer.
     * This is NOT a repeat gate: repeats across a run are prevented by the
     * server's own per-type cooldown, and when a library is small, falling back to
     * a cooled card is correct behavior the client must not block. `exclude`
     * exists solely to prevent a DUPLICATE ON SCREEN — a card on the board or in
     * the buffer has not been marked yet, so it isn't on cooldown and a top-up
     * would happily hand it back, putting the same word in two rows at once.
     * (Bubble Match has the identical case and solves it identically via keepIds.)
     *
     * We deliberately do not use the `avoid` soft-demote param.
     */
    const fetchPool = useCallback(
        async (query: string): Promise<GamePoolResponse | null> => {
            const excludeIds = [
                ...onBoardIdsRef.current,
                ...bufferedEntryIds(bufferRef.current),
            ];
            const res = await fetch(
                `${API_BASE_URL}/api/onDeck/gamePool?${query}&markType=recognition&exclude=${excludeIds.join(",")}`,
                { credentials: "include", headers: authHeader() }
            );
            if (!res.ok) throw new Error("Failed to load game pool");
            const data: GamePoolResponse = await res.json();
            // Warm the TTS cache so in-game autoplay is instant (mirrors flp).
            data.cards.forEach((c) => tts.prefetch(c));
            return data;
        },
        // authHeader() reads the token at call time, so this callback's identity
        // stays stable across a silent token refresh. See CLAUDE.md "Never reload
        // on token refresh".
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
        const request = topUpRequest(bufferRef.current);
        if (!request) return;
        topUpInFlightRef.current = true;
        fetchPool(topUpQuery(request))
            .then((data) => {
                if (data) fillBuffer(bufferRef.current, data.cards);
            })
            .catch((err) => console.error("[MatchSpeed] buffer top-up failed:", err))
            .finally(() => {
                topUpInFlightRef.current = false;
            });
    }, [fetchPool]);

    /** Hand the board `count` pairs, remembering them as on-board for `exclude`. */
    const drawPairs = useCallback((count: number): CardPair[] => {
        const pairs = takePairs(bufferRef.current, count);
        pairs.forEach((p) => onBoardIdsRef.current.add(p.entry.id));
        return pairs;
    }, []);

    /** Prime the buffer and start a run (shared by first load and Play Again). */
    const beginRun = useCallback(async (): Promise<void> => {
        setPhase("loading");
        bufferRef.current = emptyBuffer();
        onBoardIdsRef.current = new Set();
        try {
            const data = await fetchPool(POOL_QUERY);
            if (!data) return;
            if (!data.sufficient) {
                // The game tops up across buckets, so the only hard requirement is
                // a total of ENTRY_GATE_CARDS library cards. Report the shortfall.
                const have = Object.values(data.available).reduce((sum, n) => sum + n, 0);
                setBlockMessage(
                    `You need ${ENTRY_GATE_CARDS} Learn Now cards to play Match Speed — you have ${have}. Study more cards to unlock it.`
                );
                setPhase("blocked");
                return;
            }
            fillBuffer(bufferRef.current, data.cards);
            setScore(0);
            setAttempts(0);
            setRemainingMs(RUN_DURATION_MS);
            setPopupMinimized(false);
            setCountdownStep(0);
            setRunId((n) => n + 1);
            setPhase("countdown");
        } catch {
            setBlockMessage("Couldn't load the game. Please try again.");
            setPhase("blocked");
        }
    }, [fetchPool]);

    // Initial load. Keyed on the STABLE auth identity, NOT `token`: a silent
    // access-token refresh (~every 15 min) must not restart the game mid-run.
    // See CLAUDE.md "Never reload/reset a page on a silent token refresh".
    useEffect(() => {
        if (!user) {
            setBlockMessage("Sign in to play Match Speed.");
            setPhase("blocked");
            return;
        }
        void beginRun();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id]);

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
        if (phase !== "countdown") return;
        const isLastStep = countdownStep >= COUNTDOWN_STEPS.length - 1;
        const id = setTimeout(
            () => (isLastStep ? setPhase("playing") : setCountdownStep((step) => step + 1)),
            COUNTDOWN_STEP_MS
        );
        return () => clearTimeout(id);
    }, [phase, countdownStep]);

    // The run clock. Deadline-based rather than decrementing a counter, so a
    // backgrounded tab or a slow frame can't stretch the run past 60 seconds.
    useEffect(() => {
        if (phase !== "playing") return;
        const deadline = Date.now() + RUN_DURATION_MS;
        const id = setInterval(() => {
            const left = deadline - Date.now();
            if (left <= 0) {
                clearInterval(id);
                setRemainingMs(0);
                setPopupMinimized(false);
                setPhase("ended");
                return;
            }
            setRemainingMs(left);
        }, CLOCK_INTERVAL_MS);
        return () => clearInterval(id);
    }, [phase]);

    // Bank the win badge on a gold run only, once the run has ended. Gold-only
    // keeps the hub badge an achievement rather than a play counter; a single
    // difficulty means WIN_LEVEL is the only key.
    useEffect(() => {
        if (phase !== "ended") return;
        if (medalForScore(score)?.medal === "gold") recordWin(WIN_LEVEL);
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
            // Match Speed is a recognition drill (foreign → meaning), same track
            // as Bubble Match. excludeIds defaults to []: the game doesn't use the
            // replacement card the endpoint returns.
            markFlashcard({ cardId: entry.id, isCorrect, type: "recognition" })
                .catch((err) => console.error(`[MatchSpeed] mark failed → card ${entry.id}:`, err));
        },
        // No `token` dep — markFlashcard reads the header at call time, so this
        // callback's identity is stable across a silent refresh (CLAUDE.md ⛔ rule).
        []
    );

    const handleMatch = useCallback(
        (entry: VocabEntry) => {
            setScore((n) => n + 1);
            setAttempts((n) => n + 1);
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
     *  re-primes the buffer and starts a fresh 60s run. Primes the audio element
     *  inside this real click gesture, before the awaited fetch, or mobile autoplay
     *  policy would drop the first spoken word. */
    const playAgain = useCallback(() => {
        tts.unlockAudio();
        void beginRun();
    }, [tts.unlockAudio, beginRun]);

    // Cleanup: the run is scored and the popup has been tucked into its corner
    // puck, so the leftover board becomes a no-stakes study surface — no clock, no
    // refills, no marks, and tapping a card reveals its partner. Derived rather
    // than a separate phase value so the two can never disagree.
    const cleanupMode = phase === "ended" && popupMinimized;
    const medal = medalForScore(score);
    const accuracy = attempts > 0 ? Math.round((score / attempts) * 100) : 0;

    const renderCentered = (children: React.ReactNode) => (
        <Box
            className="match-speed__overlay"
            sx={{
                flex: 1,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 2.5,
                px: 4,
                pb: 3,
                textAlign: "center",
            }}
        >
            {children}
        </Box>
    );

    const showBoard = phase === "countdown" || phase === "playing" || phase === "ended";

    return (
        // Match Speed is a LEAF PAGE (docs/LEAF_NODE_PAGES.md): no footer, DOWN back
        // arrow (→ /games), slides up on enter. No per-page IPhoneFrame — the frame
        // comes from MobileDemoFrame via Layout.tsx.
        <LeafPage
            title="Match Speed"
            onBack={() => navigate("/games")}
            rightContent={<MatchSpeedHeaderControls onSettingsClick={() => setSettingsOpen(true)} />}
        >
            <MatchSpeedSettingsDialog
                open={settingsOpen}
                onClose={() => setSettingsOpen(false)}
                language={language}
                showPinyin={showPinyin}
                onToggleShowPinyin={(v) => update({ showPinyin: v })}
                showPinyinColor={showPinyinColor}
                onToggleShowPinyinColor={(v) => update({ showPinyinColor: v })}
                autoplayChinese={autoplayChinese}
                onToggleAutoplayChinese={(v) => update({ autoplayChinese: v })}
            />
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
                                sx={{ fontSize: SIZE.subtitle, color: fc.onSurface, lineHeight: LEADING.normal }}
                            >
                                {blockMessage}
                            </Typography>
                            <Button
                                className="match-speed__block-back"
                                variant="contained"
                                onClick={() => navigate("/games")}
                            >
                                Back to Games
                            </Button>
                        </>
                    )}

                {showBoard && (
                    <>
                        {/* Top of the PLAY AREA, not the header — the clock is game
                            state and belongs where the player is already looking.
                            Shown from the countdown on (at a full bar) so the board
                            never shifts down when the run starts, and dimmed once
                            the run is over rather than removed, for the same
                            reason. */}
                        <MatchSpeedTimerBar remainingMs={remainingMs} dimmed={phase === "ended"} />

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
                            onSpeak={autoplayChinese && tts.enabled ? tts.speak : undefined}
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
                                    backgroundColor: "rgba(0,0,0,0.28)",
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
                                        color: "#FFFFFF",
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

                        {phase === "ended" && (
                            <MatchSpeedEndPopup
                                minimized={popupMinimized}
                                onMinimize={() => setPopupMinimized(true)}
                                onRestore={() => setPopupMinimized(false)}
                            >
                                <Typography
                                    className="match-speed__popup-title"
                                    sx={{ fontSize: SIZE.heading, fontWeight: WEIGHT.bold, color: fc.onSurface }}
                                >
                                    {medal ? `${medal.emoji} ${medal.medal[0].toUpperCase()}${medal.medal.slice(1)}!` : "Time!"}
                                </Typography>
                                <Typography
                                    className="match-speed__popup-score"
                                    sx={{ fontSize: SIZE.bodyLg, color: fc.onSurface, fontWeight: WEIGHT.bold }}
                                >
                                    {score} {score === 1 ? "pair" : "pairs"} matched
                                </Typography>
                                {/* Information only — accuracy never gates a medal. */}
                                <Typography
                                    className="match-speed__popup-accuracy"
                                    sx={{ fontSize: SIZE.body, color: fc.textSecondary }}
                                >
                                    Accuracy {score}/{attempts} ({accuracy}%)
                                </Typography>
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
                                        onClick={() => navigate("/games")}
                                        sx={{
                                            py: 1,
                                            borderRadius: "14px",
                                            textTransform: "none",
                                            fontWeight: WEIGHT.medium,
                                        }}
                                    >
                                        Back to Games
                                    </Button>
                                </Box>
                            </MatchSpeedEndPopup>
                        )}
                    </>
                )}
            </Box>
        </LeafPage>
    );
};

export default MatchSpeedPage;
