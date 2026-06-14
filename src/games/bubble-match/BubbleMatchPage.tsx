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
import type { VocabEntry } from "../../pages/FlashcardsLearnPage/types";
import BubbleMatchHeader from "./BubbleMatchHeader";
import BubbleMatchEndPopup from "./BubbleMatchEndPopup";
import BubbleStage, { type LoseReason } from "./BubbleStage";
import { GAME_DISTRIBUTION, LEVEL_CONFIGS, TOTAL_PAIRS } from "./constants";
import type { LevelConfig } from "./types";
import { SIZE, WEIGHT, LEADING } from "../../theme/scale";

/** Shape returned by GET /api/onDeck/game-pool. */
interface GamePoolResponse {
    cards: VocabEntry[];
    requested: Record<string, number>;
    available: Record<string, number>;
    /** Number of cards the game needs to run (sum of the requested distribution). */
    total: number;
    sufficient: boolean;
}

type Phase =
    | "loading"
    | "blocked"
    | "start"
    | "playing"
    | "levelCleared" // beat a non-final level → interstitial before the next one
    | "gameWon" // beat the final level → whole game cleared
    | "lost";

function shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

/** Build the `?Unfamiliar=2&Target=10&...` query from the launch distribution. */
const poolQuery = Object.entries(GAME_DISTRIBUTION)
    .map(([cat, n]) => `${encodeURIComponent(cat)}=${n}`)
    .join("&");

/** Weekly-achievement key recorded when the player clears the final level. The
 *  server stores this in the per-user `weeklies` table (wiped weekly by a prod
 *  cron), so its presence means "beat Bubble Match this week". */
const WEEKLY_ACTIVITY = "bubbleMatch";

/** Human-readable preferred mix, e.g. "2 Unfamiliar, 10 Target, 6 Comfortable, and 2 Mastered". */
const RECOMMENDED_MIX = (() => {
    const parts = Object.entries(GAME_DISTRIBUTION).map(([cat, n]) => `${n} ${cat}`);
    if (parts.length <= 1) return parts.join("");
    return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
})();

/**
 * Bubble Match — page shell + game-flow state machine.
 *
 * Flow: loading → (blocked | start) → playing → (levelCleared → playing …)*
 *       → (gameWon | lost).
 * One game locks in a single set of TOTAL_PAIRS cards (20 pairs = 40 bubbles)
 * and the player climbs the LEVEL_CONFIGS ladder with that same set: clearing a
 * level advances to the next (faster launch cadence + shorter clock), clearing
 * the final level wins the game, and running out of time/space loses it.
 *
 * Minute-points: the fire badge lives in the header and earning is gated by
 * route prefix in the global activity-detection layer (see the eligible-pages
 * list), so this page only needs to render the badge — no per-page hook.
 */
const BubbleMatchPage: React.FC = () => {
    usePageTitle("Bubble Match");
    const navigate = useNavigate();
    const theme = useTheme();
    const fc = theme.palette.flashcard;
    const { token } = useAuth();
    const tts = useTTS();
    const { settings, update } = useFlashcardLearnSettings();
    const { showPinyin, showPinyinColor, autoplayChinese } = settings;

    // Block the mobile browser's edge-swipe-back gesture while this page is
    // mounted — an edge swipe would otherwise navigate away mid-drag. CSS
    // touch-action can't stop the history gesture, so this is handled at the
    // touch-event layer (see the hook).
    useBlockEdgeSwipe(true);

    const [phase, setPhase] = useState<Phase>("loading");
    const [blockMessage, setBlockMessage] = useState<string>("");
    const [pool, setPool] = useState<VocabEntry[]>([]);
    const [level, setLevel] = useState<LevelConfig>(LEVEL_CONFIGS[0]);
    const [loseReason, setLoseReason] = useState<LoseReason | null>(null);
    // Whether the game-over card is collapsed into the top-right corner puck.
    const [popupMinimized, setPopupMinimized] = useState(false);
    // Whether the user has already cleared Bubble Match this week (from the
    // weeklies table). Seeded on mount and set optimistically on a fresh win, so
    // the start screen / win popup can surface the weekly achievement.
    const [beatThisWeek, setBeatThisWeek] = useState(false);
    // Bumped on each (re)start so BubbleStage remounts with a clean slate.
    const runIdRef = useRef(0);
    const [runId, setRunId] = useState(0);

    // Where the current level sits in the ladder, and what (if anything) comes
    // next. Levels chain: clearing one advances to the next on the same card set;
    // clearing the final level (no next) wins the whole game.
    const levelIdx = LEVEL_CONFIGS.findIndex((c) => c.level === level.level);
    const nextLevelConfig = LEVEL_CONFIGS[levelIdx + 1] ?? null;
    const isFinalLevel = nextLevelConfig === null;

    // Fetch a fresh, randomized game pool from the server (the endpoint orders
    // candidates by RANDOM(), so each call yields a different vocab set).
    // Returns the cards on success, or null after switching to the blocked phase
    // (insufficient cards or a network error). Shared by the initial mount load
    // and the "different vocab set" replay.
    const fetchGamePool = useCallback(async (): Promise<VocabEntry[] | null> => {
        try {
            const res = await fetch(`${API_BASE_URL}/api/onDeck/game-pool?${poolQuery}`, {
                credentials: "include",
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) throw new Error("Failed to load game pool");
            const data: GamePoolResponse = await res.json();

            if (!data.sufficient) {
                // The game tops up across buckets, so the only hard requirement is
                // a total of `data.total` library cards. Report the shortfall.
                const have = Object.values(data.available).reduce((sum, n) => sum + n, 0);
                setBlockMessage(
                    `You need ${data.total} Learn Now cards to play Bubble Match — you have ${have}. Study more cards to unlock it.`
                );
                setPhase("blocked");
                return null;
            }

            // Warm the TTS cache so in-game autoplay is instant (mirrors flp).
            data.cards.forEach((c) => tts.prefetch(c));
            return data.cards;
        } catch {
            setBlockMessage("Couldn't load the game. Please try again.");
            setPhase("blocked");
            return null;
        }
        // tts.prefetch is stable; only re-create on auth change.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token]);

    // Fetch the game pool once on mount, then drop into the difficulty picker.
    useEffect(() => {
        if (!token) {
            setBlockMessage("Sign in to play Bubble Match.");
            setPhase("blocked");
            return;
        }
        let cancelled = false;
        (async () => {
            const cards = await fetchGamePool();
            if (cancelled || !cards) return;
            setPool(cards);
            setPhase("start");
        })();
        return () => {
            cancelled = true;
        };
    }, [token, fetchGamePool]);

    // Seed the "already beat it this week" flag from the weeklies table so the
    // start screen / win popup can reflect a win earned earlier this week.
    // Fire-and-forget: a failure just leaves the flag false (no UI blocking).
    useEffect(() => {
        if (!token) return;
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch(`${API_BASE_URL}/api/users/me/weeklies`, {
                    credentials: "include",
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (!res.ok) return;
                const data: { weeklies?: Array<{ activity: string }> } = await res.json();
                if (cancelled) return;
                setBeatThisWeek(!!data.weeklies?.some((w) => w.activity === WEEKLY_ACTIVITY));
            } catch {
                /* leave beatThisWeek false */
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [token]);

    // Apply the state transitions that kick off a fresh run with the given pool.
    // The pool is reshuffled here so the launch order differs every run.
    const beginRun = useCallback((cfg: LevelConfig, runPool: VocabEntry[]) => {
        setLevel(cfg);
        setLoseReason(null);
        setPopupMinimized(false);
        setPool(shuffle(runPool));
        runIdRef.current += 1;
        setRunId(runIdRef.current);
        setPhase("playing");
    }, []);

    // Start (or restart) the whole game from Level 1 on the already-loaded card
    // set (reshuffled launch order). Primes the audio element inside this real
    // click gesture: in-game autoplay fires from a bubble's pointerdown but only
    // after an awaited fetch, which loses gesture context — without this, mobile
    // autoplay policy would silently drop the first Chinese bubble's narration.
    const startGame = useCallback(() => {
        tts.unlockAudio();
        beginRun(LEVEL_CONFIGS[0], pool);
    }, [tts.unlockAudio, beginRun, pool]);

    // Start the whole game from Level 1 on a freshly fetched (different) card set.
    // Primes audio inside the click gesture before the awaited fetch — same reason
    // as startGame.
    const startGameNewVocab = useCallback(async () => {
        tts.unlockAudio();
        setPhase("loading");
        const cards = await fetchGamePool();
        if (!cards) return; // fetchGamePool already switched to the blocked phase
        beginRun(LEVEL_CONFIGS[0], cards);
    }, [tts.unlockAudio, fetchGamePool, beginRun]);

    // Advance from a cleared level to the next one, keeping the SAME card set
    // (reshuffled). Only reachable from the levelCleared interstitial, where a
    // next level is guaranteed to exist.
    const continueToNextLevel = useCallback(() => {
        tts.unlockAudio();
        if (nextLevelConfig) beginRun(nextLevelConfig, pool);
    }, [tts.unlockAudio, beginRun, nextLevelConfig, pool]);

    // Record a flashcard review mark for a matched/mismatched bubble's vocab
    // entry, reusing the same endpoint flp's working loop calls. Fire-and-forget:
    // the game never blocks on it, and a failure only logs (no run interruption).
    // Only invoked from in-game drag matches — not from study-mode taps after the
    // game ends (BubbleStage gates those out of the match-resolution path).
    const markBubbleMatch = useCallback((entry: VocabEntry, isCorrect: boolean) => {
        const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
        const headers: HeadersInit = {
            "Content-Type": "application/json",
            "x-user-timezone": userTimeZone,
        };
        if (token && token !== "null" && token !== "undefined") {
            headers["Authorization"] = `Bearer ${token}`;
        }
        console.log(`[BubbleMatch] mark → card ${entry.id} (${entry.entryKey}) as ${isCorrect ? "correct" : "incorrect"}`);
        fetch(`${API_BASE_URL}/api/flashcards/mark`, {
            method: "POST",
            headers,
            credentials: "include",
            // excludeIds empty: the game doesn't use the replacement card the
            // endpoint returns, so there's nothing to dedupe against.
            body: JSON.stringify({ cardId: entry.id, isCorrect, excludeIds: [] }),
        })
            .then((res) => console.log(`[BubbleMatch] mark response → card ${entry.id}: HTTP ${res.status}`))
            .catch((err) => console.error(`[BubbleMatch] mark failed → card ${entry.id}:`, err));
    }, [token]);

    // Record the weekly Bubble Match achievement on the server. Fire-and-forget
    // (mirrors markBubbleMatch): the win UI never blocks on it, and the flag is
    // set optimistically so the popup reflects the win even if the POST is slow.
    const recordWeeklyWin = useCallback(() => {
        setBeatThisWeek(true);
        const headers: HeadersInit = { "Content-Type": "application/json" };
        if (token && token !== "null" && token !== "undefined") {
            headers["Authorization"] = `Bearer ${token}`;
        }
        fetch(`${API_BASE_URL}/api/users/me/weeklies`, {
            method: "POST",
            headers,
            credentials: "include",
            body: JSON.stringify({ key: WEEKLY_ACTIVITY, value: true }),
        })
            .then((res) => console.log(`[BubbleMatch] weekly win recorded → HTTP ${res.status}`))
            .catch((err) => console.error("[BubbleMatch] weekly win record failed:", err));
    }, [token]);

    // Clearing a level shows the level-cleared interstitial; clearing the final
    // level (no next config) wins the whole game — and banks the weekly achievement.
    const onLevelWin = useCallback(() => {
        setPopupMinimized(false);
        if (isFinalLevel) {
            recordWeeklyWin();
            setPhase("gameWon");
        } else {
            setPhase("levelCleared");
        }
    }, [isFinalLevel, recordWeeklyWin]);
    const onLevelLose = useCallback((reason: LoseReason) => {
        setLoseReason(reason);
        setPopupMinimized(false);
        setPhase("lost");
    }, []);

    // ---- Sub-screens --------------------------------------------------------
    // Full-screen centered content for the non-gameplay phases (loading / blocked
    // / picker). These fully replace the stage.
    const renderCentered = (children: React.ReactNode) => (
        <Box
            className="bubble-match__overlay"
            sx={{
                flex: 1,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 2.5,
                px: 4,
                textAlign: "center",
            }}
        >
            {children}
        </Box>
    );

    // Plain (non-minimizable) scrim + card for the level-cleared interstitial and
    // the game-won screen. Translucent so the live field shows through behind it.
    const renderScrim = (children: React.ReactNode) => (
        <Box
            className="bubble-match__popup-scrim"
            sx={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                px: 4,
                zIndex: 200,
                backgroundColor: "rgba(20, 20, 28, 0.32)",
            }}
        >
            <Box
                className="bubble-match__popup-card"
                sx={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 2,
                    textAlign: "center",
                    width: "100%",
                    maxWidth: 340,
                    px: 4,
                    py: 3.5,
                    borderRadius: "20px",
                    backgroundColor: fc.flashCard,
                    boxShadow: "0 18px 48px rgba(0, 0, 0, 0.32)",
                }}
            >
                {children}
            </Box>
        </Box>
    );

    // Centered content for the non-gameplay phases; null while gameplay phases
    // render the stage instead.
    let centered: React.ReactNode = null;
    // Popup card layered over the stage for the end-of-run phases.
    let popup: React.ReactNode = null;

    if (phase === "loading") {
        centered = renderCentered(<DelayedCircularProgress className="bubble-match__spinner" />);
    } else if (phase === "blocked") {
        centered = renderCentered(
            <>
                <Typography className="bubble-match__block-msg" sx={{ fontSize: SIZE.subtitle, color: fc.onSurface, lineHeight: LEADING.normal }}>
                    {blockMessage}
                </Typography>
                <Button className="bubble-match__block-back" variant="contained" onClick={() => navigate("/games")}>
                    Back to Games
                </Button>
            </>
        );
    } else if (phase === "start") {
        centered = renderCentered(
            <>
                <Typography className="bubble-match__title" sx={{ fontSize: SIZE.heading, fontWeight: WEIGHT.bold, color: fc.onSurface }}>
                    Bubble Match
                </Typography>
                <Typography className="bubble-match__rules" sx={{ fontSize: SIZE.body, color: fc.textSecondary, lineHeight: LEADING.normal, maxWidth: 300 }}>
                    Match each word to its meaning by dragging one bubble onto the other before the screen fills up. One set of {TOTAL_PAIRS} pairs carries through all {LEVEL_CONFIGS.length} levels — each one launches the bubbles faster. Clear Level {LEVEL_CONFIGS[LEVEL_CONFIGS.length - 1].level} to win.
                </Typography>
                <Typography className="bubble-match__recommended-mix" sx={{ fontSize: SIZE.body, color: fc.textSecondary, lineHeight: LEADING.normal, maxWidth: 300, fontStyle: "italic" }}>
                    For the best practice mix, play with at least {RECOMMENDED_MIX} cards in your Learn Now deck.
                </Typography>
                {/* Weekly achievement badge — shown once the user has cleared the
                    final level this week (from the weeklies table). */}
                {beatThisWeek && (
                    <Typography className="bubble-match__weekly-badge" sx={{ fontSize: SIZE.body, fontWeight: WEIGHT.bold, color: fc.onSurface }}>
                        ⭐ You already beat Bubble Match this week!
                    </Typography>
                )}
                <Box className="bubble-match__start" sx={{ display: "flex", flexDirection: "column", gap: 1.5, width: "100%", maxWidth: 280, mt: 1 }}>
                    <Button
                        className="bubble-match__start-btn"
                        variant="contained"
                        onClick={startGame}
                        sx={{ py: 1.5, fontSize: SIZE.bodyLg, textTransform: "none", borderRadius: "12px" }}
                    >
                        Start Game
                    </Button>
                </Box>
            </>
        );
    } else if (phase === "levelCleared") {
        // Interstitial between levels: the field stays live behind a plain scrim
        // (no minimize affordance — the player is moving forward, not studying).
        popup = renderScrim(
            <>
                <Typography className="bubble-match__popup-title" sx={{ fontSize: SIZE.heading, fontWeight: WEIGHT.bold, color: fc.onSurface }}>
                    ✅ Level {level.level} cleared!
                </Typography>
                <Typography className="bubble-match__popup-msg" sx={{ fontSize: SIZE.bodyLg, color: fc.textSecondary }}>
                    You matched all {TOTAL_PAIRS} pairs.{nextLevelConfig ? ` Next up: Level ${nextLevelConfig.level} — ${nextLevelConfig.label}, with the same cards but a faster launch.` : ""}
                </Typography>
                <Box className="bubble-match__popup-actions" sx={{ display: "flex", flexDirection: "column", gap: 1.5, width: "100%" }}>
                    {nextLevelConfig && (
                        <Button variant="contained" onClick={continueToNextLevel} sx={{ textTransform: "none" }}>
                            Continue to Level {nextLevelConfig.level}
                        </Button>
                    )}
                    <Button variant="text" onClick={() => navigate("/games")}>Quit Game</Button>
                </Box>
            </>
        );
    } else if (phase === "gameWon") {
        // Whole game cleared (final level beaten) — plain scrim, restart options.
        popup = renderScrim(
            <>
                <Typography className="bubble-match__popup-title" sx={{ fontSize: SIZE.heading, fontWeight: WEIGHT.bold, color: fc.onSurface }}>🏆 You win!</Typography>
                <Typography className="bubble-match__popup-msg" sx={{ fontSize: SIZE.bodyLg, color: fc.textSecondary }}>
                    You cleared all {LEVEL_CONFIGS.length} levels on a single {TOTAL_PAIRS}-pair set. 🎉
                </Typography>
                {/* Weekly achievement banked — sourced from the weeklies table. */}
                <Typography className="bubble-match__popup-weekly" sx={{ fontSize: SIZE.body, fontWeight: WEIGHT.bold, color: fc.onSurface }}>
                    ⭐ Weekly achievement unlocked: you beat Bubble Match this week!
                </Typography>
                <Box className="bubble-match__popup-actions" sx={{ display: "flex", flexDirection: "column", gap: 1.5, width: "100%" }}>
                    {/* Same-card-set restart from Level 1. */}
                    <Button variant="contained" onClick={startGame} sx={{ textTransform: "none" }}>
                        Play again with the same vocab set
                    </Button>
                    {/* Re-fetches a fresh randomized pool, then restarts from Level 1. */}
                    <Button variant="outlined" onClick={startGameNewVocab} sx={{ textTransform: "none" }}>
                        Play again with a different vocab set
                    </Button>
                    <Button variant="text" onClick={() => navigate("/games")}>Back to Games</Button>
                </Box>
            </>
        );
    } else if (phase === "lost") {
        popup = (
            <BubbleMatchEndPopup
                minimized={popupMinimized}
                onMinimize={() => setPopupMinimized(true)}
                onRestore={() => setPopupMinimized(false)}
            >
                <Typography className="bubble-match__popup-title" sx={{ fontSize: SIZE.heading, fontWeight: WEIGHT.bold, color: fc.onSurface }}>Game over</Typography>
                <Typography className="bubble-match__popup-msg" sx={{ fontSize: SIZE.bodyLg, color: fc.textSecondary }}>
                    {loseReason === "full"
                        ? "The screen filled up before you could clear it."
                        : "Time ran out before all pairs were matched."}
                    {" "}You reached Level {level.level} — {level.label}.
                </Typography>
                <Box className="bubble-match__popup-actions" sx={{ display: "flex", flexDirection: "column", gap: 1.5, width: "100%" }}>
                    {/* A loss ends the run; restarting drops back to Level 1 on the
                        already-loaded card pool (reshuffled). */}
                    <Button variant="contained" onClick={startGame} sx={{ textTransform: "none" }}>
                        Restart from Level 1 (same vocab set)
                    </Button>
                    {/* Re-fetches a fresh randomized pool, then restarts from Level 1. */}
                    <Button variant="outlined" onClick={startGameNewVocab} sx={{ textTransform: "none" }}>
                        Restart with a different vocab set
                    </Button>
                    <Button variant="text" onClick={() => navigate("/games")}>Back to Games</Button>
                </Box>
            </BubbleMatchEndPopup>
        );
    }

    // The stage stays mounted across playing → won/lost (same runId key) so the
    // popup overlays a live, still-animating field rather than replacing it.
    const showStage = phase === "playing" || phase === "levelCleared" || phase === "gameWon" || phase === "lost";

    return (
        <>
            <BubbleMatchHeader
                onBack={() => navigate("/games")}
                showPinyin={showPinyin}
                onTogglePinyin={() => update({ showPinyin: !showPinyin })}
                autoplayChinese={autoplayChinese}
                onToggleAutoplayChinese={() => update({ autoplayChinese: !autoplayChinese })}
            />
            <Box
                className="bubble-match__content"
                sx={{
                    // position: relative anchors the absolutely-positioned game-over
                    // / cleared popup scrim to this content area.
                    position: "relative",
                    flex: 1,
                    minHeight: 0,
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                    // Disable text selection across every game screen (info/picker,
                    // the playing stage, won, and game-over) — selecting bubble
                    // words/definitions while tapping is never intended.
                    userSelect: "none",
                    WebkitUserSelect: "none",
                    WebkitTouchCallout: "none",
                }}
            >
                {showStage ? (
                    <>
                        <BubbleStage
                            key={runId}
                            levelPairs={pool}
                            config={level}
                            levelNumber={level.level}
                            levelLabel={level.label}
                            showPinyin={showPinyin}
                            showPinyinColor={showPinyinColor}
                            onSpeak={autoplayChinese && tts.enabled ? tts.speak : undefined}
                            onLevelWin={onLevelWin}
                            onLevelLose={onLevelLose}
                            onMark={markBubbleMatch}
                            // Game-over popup minimized → bubbles become tappable/
                            // hoverable for studying the pairs.
                            studyMode={phase === "lost" && popupMinimized}
                        />
                        {popup}
                    </>
                ) : (
                    centered
                )}
            </Box>
        </>
    );
};

export default BubbleMatchPage;
