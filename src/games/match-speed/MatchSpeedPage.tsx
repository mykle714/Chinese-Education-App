import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
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
import { useLaunchCollection } from "../../features/flashcards/useLaunchCollection";
import { collectionQuerySuffix } from "../../features/flashcards/collectionRef";
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
import type { CardPair, GameCategory, Phase } from "./types";
import {
    CATEGORY_FALLBACK_ORDER,
    COUNTDOWN_STEPS,
    COUNTDOWN_STEP_MS,
    GAME_KEY,
    RUN_DURATION_MS,
    medalForScore,
    modeConfigFor,
} from "./constants";
import { SIZE, WEIGHT, LEADING } from "../../theme/scale";
import ProvisionalCardsNotice from "../../components/ProvisionalCardsNotice";
import SortProvisionalCta from "../../components/SortProvisionalCta";
import { provisionalWords } from "../../utils/provisionalCards";

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
 * A 30-second recognition throughput drill: 6 foreign words on the left, their 6
 * English glosses (shuffled independently) on the right. Tap one from each column
 * to attempt a match; every 3 seconds the board refills the holes.
 *
 * Flow: loading → (blocked) → countdown → playing → ended → (popup minimized =
 * cleanup) → Play Again → countdown …
 *
 * The difficulty MODE (Study Mix / Review / Challenge) is picked on the Games hub and arrives
 * as `location.state.mode`; it only narrows which mastery buckets the pool may
 * draw from (the /decks rule) — the clock, board and medals are identical across
 * modes. Everything mode-dependent is read off one `ModeConfig`; see
 * docs/MATCH_SPEED_GAME.md § Difficulty modes.
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
    // Which collection this game was launched from (docs/DECKS_FEATURE.md) — null
    // for an ordinary launch from the Games hub. Appended to every pool request so
    // the round stays inside the set the learner picked.
    const launchCollection = useLaunchCollection();
    const collectionSuffix = collectionQuerySuffix(launchCollection);
    usePageTitle("Match Speed");
    const navigate = useNavigate();
    const location = useLocation();
    const theme = useTheme();
    const fc = theme.palette.flashcard;
    const { user } = useAuth();
    const tts = useTTS();
    const { settings, update } = useFlashcardLearnSettings();
    const { showPinyin, showPinyinColor, autoplayChinese } = settings;
    const { recordWin } = useGameWins(GAME_KEY);

    // The difficulty mode tapped on the Games hub, via nav `state`
    // (HubMenuArrayItem's `state` prop). A direct visit with no/invalid state
    // falls back to Mix rather than bouncing to the hub the way Bubble Match
    // does — this route predates the modes and must stay playable on its own.
    // The returned object is a module constant, so its identity is stable across
    // renders and it is safe in effect/callback dep arrays.
    const baseModeConfig = modeConfigFor((location.state as { mode?: string } | null)?.mode);

    // RELAXED MODE (docs/PROVISIONAL_CARDS.md § Nothing blocks on card count).
    //
    // Review/Challenge restrict the board to their own mastery buckets (MODE_CONFIGS in
    // constants.ts — Review = Comfortable + Mastered, Challenge = Unfamiliar + Target).
    //
    // A lent card starts with an EMPTY mark history, so it is Unfamiliar. That means
    // provisioning fills CHALLENGE's buckets for free, but can never fill REVIEW's:
    // Comfortable and Mastered are earned, not granted, so a learner with no real
    // progress has nothing on-mode no matter how many cards we lend them.
    //
    // Rather than blocking Review for everyone who hasn't got a card comfortable yet, a
    // run with nothing on-mode widens the fallback order to all four buckets, so the
    // server's cross-bucket top-up actually reaches the board.
    //
    // The mode's WEIGHTS are untouched: once the learner has real on-mode cards the
    // widened fallback stops being reached and the mode plays exactly as designed.
    const [relaxed, setRelaxed] = useState(false);
    const modeConfig = useMemo(
        () => (relaxed ? { ...baseModeConfig, fallbackOrder: CATEGORY_FALLBACK_ORDER } : baseModeConfig),
        [relaxed, baseModeConfig]
    );

    // Temporary cards are in play this run. Match Speed deals from a rolling buffer, so
    // the played set isn't known up front — the notice is the GENERIC form (no word
    // list), per CARD_BASELINE_ITEMIZED in server/contracts/wire.ts.
    const [noticeOpen, setNoticeOpen] = useState(false);
    // Every lent word this run actually dealt, accumulated as the buffer fills, so the
    // end-of-run "keep these" offer can name them even though the notice couldn't.
    const provisionalSeenRef = useRef<Set<string>>(new Set());
    const [provisionalSeen, setProvisionalSeen] = useState<string[]>([]);

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
    // Guards against overlapping top-ups: ticks fire every 3s but a request can
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
                `${API_BASE_URL}/api/onDeck/gamePool?${query}&markType=recognition&surface=match-speed&exclude=${excludeIds.join(",")}${collectionSuffix}`,
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
        // on token refresh". `collectionSuffix` is likewise omitted: it comes from
        // this page's own URL, which cannot change without a remount.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        []
    );

    /**
     * Record any lent (provisional) words in a freshly-fetched batch, so the
     * end-of-run "keep these" offer can name them even though the pre-run notice
     * could not. Returns the batch's lent words. Accumulates across buffer top-ups,
     * because a long run keeps pulling new cards in.
     */
    const noteProvisional = useCallback((cards: VocabEntry[]): string[] => {
        const words = provisionalWords(cards);
        if (words.length === 0) return words;
        let changed = false;
        for (const word of words) {
            if (!provisionalSeenRef.current.has(word)) {
                provisionalSeenRef.current.add(word);
                changed = true;
            }
        }
        if (changed) setProvisionalSeen([...provisionalSeenRef.current]);
        return words;
    }, []);

    /**
     * Restore every bucket toward BUFFER_DEPTH. Fired after each refill tick for
     * exactly what was consumed, so the requests stay small and steady.
     *
     * FIRE-AND-FORGET with a .catch(): a failed top-up degrades to a thinner
     * buffer and more category fallbacks, never to a broken run.
     */
    const topUpBuffer = useCallback(() => {
        if (topUpInFlightRef.current) return;
        const request = topUpRequest(bufferRef.current, modeConfig);
        if (!request) return;
        topUpInFlightRef.current = true;
        fetchPool(topUpQuery(request))
            .then((data) => {
                if (data) {
                    noteProvisional(data.cards);
                    fillBuffer(bufferRef.current, data.cards, modeConfig);
                }
            })
            .catch((err) => console.error("[MatchSpeed] buffer top-up failed:", err))
            .finally(() => {
                topUpInFlightRef.current = false;
            });
    }, [fetchPool, modeConfig, noteProvisional]);

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
        const pairs = takePairs(bufferRef.current, count, Math.random, modeConfig, (pair) =>
            onBoardIdsRef.current.has(pair.entry.id)
        );
        pairs.forEach((p) => onBoardIdsRef.current.add(p.entry.id));
        return pairs;
    }, [modeConfig]);

    /** Prime the buffer and start a run (shared by first load and Play Again). */
    const beginRun = useCallback(async (): Promise<void> => {
        setPhase("loading");
        bufferRef.current = emptyBuffer();
        onBoardIdsRef.current = new Set();
        provisionalSeenRef.current = new Set();
        setProvisionalSeen([]);
        try {
            const data = await fetchPool(modeConfig.poolQuery);
            if (!data) return;
            // NO CARD-COUNT GATE. The server topped the player up to the Match Speed
            // baseline before building this pool, so `sufficient` can only be false
            // when the dictionary itself ran dry — and a short buffer still deals a
            // playable run. See docs/PROVISIONAL_CARDS.md.
            // How much the player has inside the mode's OWN buckets. This used to be a
            // second block ("you have no Comfortable or Mastered cards"); it now only
            // decides whether this run needs the widened fallback — in practice that is
            // Review, whose buckets provisioning cannot fill.
            const inModeAvailable = modeConfig.categories.reduce(
                (sum: number, cat: GameCategory) => sum + (data.available[cat] ?? 0),
                0
            );
            // Nothing on-mode: widen the fallback for this run instead of blocking (see
            // `relaxed` above). The board fills from whatever the server could give,
            // which for a new learner is a set of freshly-lent Unfamiliar cards.
            const runMode = inModeAvailable === 0
                ? { ...modeConfig, fallbackOrder: CATEGORY_FALLBACK_ORDER }
                : modeConfig;
            setRelaxed(inModeAvailable === 0);

            // Generic notice only — Match Speed cannot name its set up front.
            const lent = noteProvisional(data.cards);
            setNoticeOpen(lent.length > 0);

            fillBuffer(bufferRef.current, data.cards, runMode);
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
    }, [fetchPool, modeConfig, noteProvisional]);

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
        // Keyed on the mode too: navigating from one hub sub-card to another lands
        // on the SAME route with only `state.mode` changed, so without this a
        // remount-less switch would keep playing the previous mode's buffer.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id, modeConfig.mode]);

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
    // backgrounded tab or a slow frame can't stretch the run past 30 seconds.
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
    // keeps the hub badge an achievement rather than a play counter. The win is
    // logged under the MODE's level key, so the hub stars the mode that was
    // actually cleared (Mix keeps key 1 — the game's pre-modes key).
    useEffect(() => {
        if (phase !== "ended") return;
        if (medalForScore(score)?.medal === "gold") recordWin(modeConfig.winLevel);
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
     *  re-primes the buffer and starts a fresh 30s run. Primes the audio element
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
        <>
        {/* Generic (non-itemized) notice: Match Speed deals from a rolling buffer, so
            the set of lent cards isn't known before the run starts. */}
        <ProvisionalCardsNotice
            open={noticeOpen}
            onDismiss={() => setNoticeOpen(false)}
            surfaceName="Match Speed"
            language={(user?.selectedLanguage ?? "zh") as Language}
        />
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
                                    {/* By now the run HAS dealt its cards, so the
                                        lent words can finally be named. */}
                                    <SortProvisionalCta
                                        words={provisionalSeen}
                                        language={(user?.selectedLanguage ?? "zh") as Language}
                                    />
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
        </>
    );
};

export default MatchSpeedPage;
