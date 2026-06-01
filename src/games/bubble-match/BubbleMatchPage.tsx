import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Button, CircularProgress, Typography, useTheme } from "@mui/material";
import { useAuth } from "../../AuthContext";
import { API_BASE_URL } from "../../constants";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useTTS } from "../../hooks/useTTS";
import { useFlashcardLearnSettings } from "../../hooks/useFlashcardLearnSettings";
import MobileFooter from "../../components/MobileFooter";
import type { VocabEntry } from "../../pages/FlashcardsLearnPage/types";
import BubbleMatchHeader from "./BubbleMatchHeader";
import BubbleMatchEndPopup from "./BubbleMatchEndPopup";
import BubbleStage, { type LoseReason } from "./BubbleStage";
import { GAME_DISTRIBUTION, LEVEL_CONFIGS, TOTAL_PAIRS } from "./constants";
import type { LevelConfig } from "./types";

/** Shape returned by GET /api/onDeck/game-pool. */
interface GamePoolResponse {
    cards: VocabEntry[];
    requested: Record<string, number>;
    available: Record<string, number>;
    /** Number of cards the game needs to run (sum of the requested distribution). */
    total: number;
    sufficient: boolean;
}

type Phase = "loading" | "blocked" | "picker" | "playing" | "won" | "lost";

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

/** Human-readable preferred mix, e.g. "2 Unfamiliar, 10 Target, 6 Comfortable, and 2 Mastered". */
const RECOMMENDED_MIX = (() => {
    const parts = Object.entries(GAME_DISTRIBUTION).map(([cat, n]) => `${n} ${cat}`);
    if (parts.length <= 1) return parts.join("");
    return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
})();

/**
 * Bubble Match — page shell + game-flow state machine.
 *
 * Flow: loading → (blocked | picker) → playing → (won | lost) → picker.
 * A single game uses the full pool (all 25 pairs = 50 bubbles); the picker only
 * selects difficulty (launch cadence). Levels do not chain.
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

    const [phase, setPhase] = useState<Phase>("loading");
    const [blockMessage, setBlockMessage] = useState<string>("");
    const [pool, setPool] = useState<VocabEntry[]>([]);
    const [level, setLevel] = useState<LevelConfig>(LEVEL_CONFIGS[0]);
    const [loseReason, setLoseReason] = useState<LoseReason | null>(null);
    // Whether the game-over card is collapsed into the top-right corner puck.
    const [popupMinimized, setPopupMinimized] = useState(false);
    // Bumped on each (re)start so BubbleStage remounts with a clean slate.
    const runIdRef = useRef(0);
    const [runId, setRunId] = useState(0);

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
                    `You need ${data.total} library cards to play Bubble Match — you have ${have}. Study more cards to unlock it.`
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
            setPhase("picker");
        })();
        return () => {
            cancelled = true;
        };
    }, [token, fetchGamePool]);

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

    // Replay on the same vocab set (the already-loaded pool, reshuffled).
    const startLevel = useCallback((cfg: LevelConfig) => {
        // Prime the audio element inside this real click gesture. In-game autoplay
        // fires from a bubble's pointerdown but only after an awaited fetch, which
        // loses gesture context — without this, mobile autoplay policy would
        // silently drop the very first Chinese bubble's narration.
        tts.unlockAudio();
        beginRun(cfg, pool);
    }, [tts.unlockAudio, beginRun, pool]);

    // Replay with a freshly fetched (different) vocab set. Primes audio inside the
    // click gesture before the awaited fetch — same reason as startLevel.
    const startWithNewVocab = useCallback(async (cfg: LevelConfig) => {
        tts.unlockAudio();
        setPhase("loading");
        const cards = await fetchGamePool();
        if (!cards) return; // fetchGamePool already switched to the blocked phase
        beginRun(cfg, cards);
    }, [tts.unlockAudio, fetchGamePool, beginRun]);

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

    const onLevelWin = useCallback(() => {
        setPopupMinimized(false);
        setPhase("won");
    }, []);
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

    // Centered content for the non-gameplay phases; null while gameplay phases
    // render the stage instead.
    let centered: React.ReactNode = null;
    // Popup card layered over the stage for the end-of-run phases.
    let popup: React.ReactNode = null;

    if (phase === "loading") {
        centered = renderCentered(<CircularProgress className="bubble-match__spinner" />);
    } else if (phase === "blocked") {
        centered = renderCentered(
            <>
                <Typography className="bubble-match__block-msg" sx={{ fontSize: 17, color: fc.onSurface, lineHeight: 1.5 }}>
                    {blockMessage}
                </Typography>
                <Button className="bubble-match__block-back" variant="contained" onClick={() => navigate("/games")}>
                    Back to Games
                </Button>
            </>
        );
    } else if (phase === "picker") {
        centered = renderCentered(
            <>
                <Typography className="bubble-match__title" sx={{ fontSize: 24, fontWeight: 700, color: fc.onSurface }}>
                    Bubble Match
                </Typography>
                <Typography className="bubble-match__rules" sx={{ fontSize: 14, color: fc.textSecondary, lineHeight: 1.5, maxWidth: 300 }}>
                    Match each word to its meaning by dragging one bubble onto the other before the screen fills up. {TOTAL_PAIRS} pairs · {LEVEL_CONFIGS[0].durationSec} seconds.
                </Typography>
                <Typography className="bubble-match__recommended-mix" sx={{ fontSize: 13, color: fc.textSecondary, lineHeight: 1.5, maxWidth: 300, fontStyle: "italic" }}>
                    For the best practice mix, play with at least {RECOMMENDED_MIX} cards in your library.
                </Typography>
                <Box className="bubble-match__levels" sx={{ display: "flex", flexDirection: "column", gap: 1.5, width: "100%", maxWidth: 280, mt: 1 }}>
                    {LEVEL_CONFIGS.map((cfg) => (
                        <Button
                            key={cfg.level}
                            className={`bubble-match__level-btn bubble-match__level-btn--${cfg.level}`}
                            variant="contained"
                            onClick={() => startLevel(cfg)}
                            sx={{ py: 1.5, fontSize: 16, textTransform: "none", borderRadius: "12px" }}
                        >
                            Level {cfg.level} — {cfg.label}
                        </Button>
                    ))}
                </Box>
            </>
        );
    } else if (phase === "won") {
        // The cleared screen has no minimize affordance — there's nothing to come
        // back to mid-field (the run is already won), so it renders a plain scrim.
        popup = (
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
                    // Translucent so the floating bubbles stay visible behind the card.
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
                    <Typography className="bubble-match__popup-title" sx={{ fontSize: 28, fontWeight: 800, color: fc.onSurface }}>🎉 Cleared!</Typography>
                    <Typography className="bubble-match__popup-msg" sx={{ fontSize: 15, color: fc.textSecondary }}>
                        You matched all {TOTAL_PAIRS} pairs on Level {level.level} ({level.label}).
                    </Typography>
                    <Box className="bubble-match__popup-actions" sx={{ display: "flex", flexDirection: "column", gap: 1.5, width: "100%" }}>
                        {/* Same-vocab-set restart, mirroring the game-over popup. */}
                        <Button variant="contained" onClick={() => startLevel(level)} sx={{ textTransform: "none" }}>
                            Play again with the same vocab set
                        </Button>
                        {/* Re-fetches a fresh randomized pool, then restarts. */}
                        <Button variant="outlined" onClick={() => startWithNewVocab(level)} sx={{ textTransform: "none" }}>
                            Play again with a different vocab set
                        </Button>
                        <Button variant="text" onClick={() => navigate("/games")}>Back to Games</Button>
                    </Box>
                </Box>
            </Box>
        );
    } else if (phase === "lost") {
        popup = (
            <BubbleMatchEndPopup
                minimized={popupMinimized}
                onMinimize={() => setPopupMinimized(true)}
                onRestore={() => setPopupMinimized(false)}
            >
                <Typography className="bubble-match__popup-title" sx={{ fontSize: 28, fontWeight: 800, color: fc.onSurface }}>Game over</Typography>
                <Typography className="bubble-match__popup-msg" sx={{ fontSize: 15, color: fc.textSecondary }}>
                    {loseReason === "full"
                        ? "The screen filled up before you could clear it."
                        : "Time ran out before all pairs were matched."}
                </Typography>
                <Box className="bubble-match__popup-actions" sx={{ display: "flex", flexDirection: "column", gap: 1.5, width: "100%" }}>
                    {/* Drops straight back into a fresh run on the same level using
                        the already-loaded card pool (reshuffled). */}
                    <Button variant="contained" onClick={() => startLevel(level)} sx={{ textTransform: "none" }}>
                        Try again with the same vocab set
                    </Button>
                    {/* Re-fetches a fresh randomized pool, then restarts. */}
                    <Button variant="outlined" onClick={() => startWithNewVocab(level)} sx={{ textTransform: "none" }}>
                        Try again with a different vocab set
                    </Button>
                    <Button variant="text" onClick={() => navigate("/games")}>Back to Games</Button>
                </Box>
            </BubbleMatchEndPopup>
        );
    }

    // The stage stays mounted across playing → won/lost (same runId key) so the
    // popup overlays a live, still-animating field rather than replacing it.
    const showStage = phase === "playing" || phase === "won" || phase === "lost";

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
            <MobileFooter activePage="games" />
        </>
    );
};

export default BubbleMatchPage;
