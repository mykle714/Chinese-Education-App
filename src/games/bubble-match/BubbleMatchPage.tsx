import React, { useCallback, useEffect, useRef, useState } from "react";
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
import { authHeader } from "../../utils/authHeader";
import type { VocabEntry } from "../../types";
import LeafPage from "../../components/LeafPage";
import BubbleMatchHeaderControls from "./BubbleMatchHeader";
import BubbleMatchEndPopup from "./BubbleMatchEndPopup";
import BubbleMatchLevelMenu from "./BubbleMatchLevelMenu";
import BubbleStage from "./BubbleStage";
import { GAME_DISTRIBUTION, GAME_KEY, LEVEL_CONFIGS, TOTAL_PAIRS } from "./constants";
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
    | "playing"
    | "won" // cleared the chosen level
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

/**
 * Two-line replay button for the game-over grid: a bold "<Same|Different> Level"
 * top line and a "<Same|Different> Cards" bottom line, split by a short centered
 * divider that floats clear of both side edges (inset to 55% width). The divider
 * uses `currentColor`, so it tints to match the button text on both the contained
 * (filled) and outlined variants without a hardcoded color.
 */
const ReplayGridButton: React.FC<{
    className: string;
    variant: "contained" | "outlined";
    topLabel: string;
    bottomLabel: string;
    onClick: () => void;
}> = ({ className, variant, topLabel, bottomLabel, onClick }) => (
    <Button
        className={className}
        variant={variant}
        onClick={onClick}
        sx={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 0.6,
            py: 1.25,
            px: 0.5,
            minWidth: 0,
            borderRadius: "14px",
            textTransform: "none",
            lineHeight: LEADING.tight,
        }}
    >
        <Box component="span" className="bubble-match__replay-btn-top" sx={{ fontSize: SIZE.body, fontWeight: WEIGHT.bold, whiteSpace: "nowrap" }}>
            {topLabel}
        </Box>
        {/* Centered inset divider — stops short of both edges (does not connect). */}
        <Box
            component="span"
            aria-hidden
            className="bubble-match__replay-btn-divider"
            sx={{ width: "55%", height: "1px", backgroundColor: "currentColor", opacity: 0.4 }}
        />
        <Box component="span" className="bubble-match__replay-btn-bottom" sx={{ fontSize: SIZE.caption, fontWeight: WEIGHT.medium, opacity: 0.85, whiteSpace: "nowrap" }}>
            {bottomLabel}
        </Box>
    </Button>
);

/**
 * Bubble Match — page shell + game-flow state machine.
 *
 * Flow: loading → (blocked) → playing → (won | lost) → playing (replay) …
 * The level is chosen on the Games hub (one HubMenuArrayItem sub-card per
 * LEVEL_CONFIGS entry — see GamesPage.tsx) and passed in via `location.state.
 * level`; this page no longer has its own in-game level picker. A run locks
 * in a single set of TOTAL_PAIRS cards (20 pairs = 40 bubbles); the chosen
 * level only sets the launch cadence + clock. Clearing the level wins the run
 * (and banks its weekly badge plus every easier level's), and the field
 * over-packing loses it.
 *
 * Minute-points: the fire badge lives in the header and earning is gated by
 * route prefix in the global activity-detection layer (see the eligible-pages
 * list), so this page only needs to render the badge — no per-page hook.
 */
const BubbleMatchPage: React.FC = () => {
    usePageTitle("Bubble Match");
    const navigate = useNavigate();
    const location = useLocation();
    const theme = useTheme();
    const fc = theme.palette.flashcard;
    const { token, user } = useAuth();
    const tts = useTTS();
    const { settings, update } = useFlashcardLearnSettings();
    const { showPinyin, showPinyinColor, autoplayChinese } = settings;
    const { clearedLevels, recordWin } = useGameWins(GAME_KEY);

    // Block the mobile browser's edge-swipe-back gesture while this page is
    // mounted — an edge swipe would otherwise navigate away mid-drag. CSS
    // touch-action can't stop the history gesture, so this is handled at the
    // touch-event layer (see the hook).
    useBlockEdgeSwipe(true);

    // The level tapped on the Games hub, via nav `state` (HubMenuArrayItem /
    // HubMenuRow's `state` prop). Falls back to the easiest level for any
    // direct/stray navigation that arrives with no state (e.g. a manual URL
    // visit) — there's no in-game picker to fall back to anymore.
    const requestedLevel = (location.state as { level?: number } | null)?.level;
    const initialLevel = LEVEL_CONFIGS.find((cfg) => cfg.level === requestedLevel) ?? LEVEL_CONFIGS[0];

    const [phase, setPhase] = useState<Phase>("loading");
    const [blockMessage, setBlockMessage] = useState<string>("");
    const [pool, setPool] = useState<VocabEntry[]>([]);
    const [level, setLevel] = useState<LevelConfig>(initialLevel);
    // Whether the game-over card is collapsed into the top-right corner puck.
    const [popupMinimized, setPopupMinimized] = useState(false);
    // Whether the "Different Level / Same Cards" floating level menu is open over
    // the end popup. Selecting a level replays the loaded pool at that level.
    const [levelMenuOpen, setLevelMenuOpen] = useState(false);
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
                headers: authHeader(),
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
        // authHeader() reads the token at call time, so this callback's identity
        // stays stable across a silent token refresh. See CLAUDE.md "Never
        // reload on token refresh".
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Apply the state transitions that kick off a fresh run with the given pool.
    // The pool is reshuffled here so the launch order differs every run.
    const beginRun = useCallback((cfg: LevelConfig, runPool: VocabEntry[]) => {
        setLevel(cfg);
        setPopupMinimized(false);
        setLevelMenuOpen(false);
        setPool(shuffle(runPool));
        runIdRef.current += 1;
        setRunId(runIdRef.current);
        setPhase("playing");
    }, []);

    // Fetch the game pool once on mount, then start straight into the level
    // requested from the hub (no in-game picker to land on anymore).
    useEffect(() => {
        if (!user) {
            setBlockMessage("Sign in to play Bubble Match.");
            setPhase("blocked");
            return;
        }
        let cancelled = false;
        (async () => {
            const cards = await fetchGamePool();
            if (cancelled || !cards) return;
            beginRun(initialLevel, cards);
        })();
        return () => {
            cancelled = true;
        };
        // Keyed on the STABLE auth identity, NOT `token`: a silent access-token
        // refresh (~every 15 min) must not re-run this loader mid-game. initialLevel
        // is derived from location.state on mount, so it's intentionally excluded
        // too. See CLAUDE.md "Never reload on token refresh".
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id]);

    // Start (or replay) the given level on the already-loaded card set
    // (reshuffled launch order). Primes the audio element inside this real click
    // gesture: in-game autoplay fires from a bubble's pointerdown but only after
    // an awaited fetch, which loses gesture context — without this, mobile
    // autoplay policy would silently drop the first Chinese bubble's narration.
    const startLevel = useCallback((cfg: LevelConfig) => {
        tts.unlockAudio();
        beginRun(cfg, pool);
    }, [tts.unlockAudio, beginRun, pool]);

    // Start the given level on a freshly fetched (different) card set. Primes
    // audio inside the click gesture before the awaited fetch — same reason as
    // startLevel.
    const startLevelNewVocab = useCallback(async (cfg: LevelConfig) => {
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

    // Clearing the chosen level wins the run and logs the win (via useGameWins'
    // recordWin, shared with the Games hub's level badges). Levels don't chain
    // — the win popup offers replay / picker, not an auto-advance.
    const onLevelWin = useCallback(() => {
        setPopupMinimized(false);
        recordWin(level.level);
        setPhase("won");
    }, [recordWin, level.level]);
    const onLevelLose = useCallback(() => {
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
                pb: 3,
                textAlign: "center",
            }}
        >
            {children}
        </Box>
    );

    // Shared replay actions for BOTH end-of-run popups (won / lost), laid out as
    // a 2×2 grid so the victory and game-over cards share identical controls and
    // differ only in their text box:
    //   Same Level / Same Cards        Same Level / Different Cards
    //   Different Level / Same Cards   Back to Games
    // "Different Level / Same Cards" opens the floating level menu (over the end
    // popup); picking a level replays the same loaded pool at that level. `level`
    // is the level that just ended.
    const replayGridActions = (
        <Box
            className="bubble-match__replay-actions"
            sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5, width: "100%" }}
        >
            <ReplayGridButton
                className="bubble-match__replay-btn bubble-match__replay-btn--same-same"
                variant="contained"
                topLabel="Same Level"
                bottomLabel="Same Cards"
                onClick={() => startLevel(level)}
            />
            <ReplayGridButton
                className="bubble-match__replay-btn bubble-match__replay-btn--same-diff"
                variant="contained"
                topLabel="Same Level"
                bottomLabel="Different Cards"
                onClick={() => startLevelNewVocab(level)}
            />
            <ReplayGridButton
                className="bubble-match__replay-btn bubble-match__replay-btn--diff-same"
                variant="outlined"
                topLabel="Different Level"
                bottomLabel="Same Cards"
                onClick={() => setLevelMenuOpen(true)}
            />
            <Button
                className="bubble-match__replay-btn bubble-match__replay-btn--back"
                variant="outlined"
                onClick={() => navigate("/games")}
                sx={{ textTransform: "none", borderRadius: "14px", fontWeight: WEIGHT.medium }}
            >
                Back to Games
            </Button>
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
    } else if (phase === "won") {
        popup = (
            <BubbleMatchEndPopup
                minimized={popupMinimized}
                onMinimize={() => setPopupMinimized(true)}
                onRestore={() => setPopupMinimized(false)}
            >
                <Typography className="bubble-match__popup-title" sx={{ fontSize: SIZE.heading, fontWeight: WEIGHT.bold, color: fc.onSurface }}>🏆 Level {level.level} cleared!</Typography>
                <Typography className="bubble-match__popup-msg" sx={{ fontSize: SIZE.bodyLg, color: fc.textSecondary }}>
                    You matched all {TOTAL_PAIRS} pairs on Level {level.level} — {level.label}. 🎉
                </Typography>
                {/* Weekly ⭐ badge for the level just cleared. */}
                <Typography className="bubble-match__popup-weekly" sx={{ fontSize: SIZE.body, fontWeight: WEIGHT.bold, color: fc.onSurface }}>
                    ⭐ Weekly badge unlocked: {level.label}!
                </Typography>
                {replayGridActions}
            </BubbleMatchEndPopup>
        );
    } else if (phase === "lost") {
        popup = (
            <BubbleMatchEndPopup
                minimized={popupMinimized}
                onMinimize={() => setPopupMinimized(true)}
                onRestore={() => setPopupMinimized(false)}
            >
                <Typography className="bubble-match__popup-title" sx={{ fontSize: SIZE.heading, fontWeight: WEIGHT.bold, color: fc.onSurface }}>Try again?</Typography>
                {replayGridActions}
            </BubbleMatchEndPopup>
        );
    }

    // The stage stays mounted across playing → won/lost (same runId key) so the
    // popup overlays a live, still-animating field rather than replacing it.
    const showStage = phase === "playing" || phase === "won" || phase === "lost";

    return (
        // Bubble Match is a LEAF PAGE (see docs/LEAF_NODE_PAGES.md): no footer, DOWN
        // back arrow (→ /games), slides up on enter / down on exit. The pinyin +
        // autoplay toggles and the fire badge live in the header's right slot.
        <LeafPage
            title="Bubble Match"
            onBack={() => navigate("/games")}
            rightContent={
                <BubbleMatchHeaderControls
                    showPinyin={showPinyin}
                    onTogglePinyin={() => update({ showPinyin: !showPinyin })}
                    autoplayChinese={autoplayChinese}
                    onToggleAutoplayChinese={() => update({ autoplayChinese: !autoplayChinese })}
                    // Restart is only meaningful mid-run; the won/lost popup owns
                    // replay otherwise. Restarts the live level on the same words.
                    onRestart={phase === "playing" ? () => startLevel(level) : undefined}
                />
            }
        >
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
                            // hoverable for studying the pairs. (A win clears the
                            // field, so only the lost phase has anything to study.)
                            studyMode={phase === "lost" && popupMinimized}
                        />
                        {popup}
                        {/* "Different Level / Same Cards" floating menu — layered
                            over the end popup; picking a level replays the loaded
                            pool at that level. */}
                        {(phase === "won" || phase === "lost") && levelMenuOpen && (
                            <BubbleMatchLevelMenu
                                levels={LEVEL_CONFIGS}
                                currentLevel={level.level}
                                clearedLevels={clearedLevels}
                                onPick={(cfg) => {
                                    setLevelMenuOpen(false);
                                    startLevel(cfg);
                                }}
                                onClose={() => setLevelMenuOpen(false)}
                            />
                        )}
                    </>
                ) : (
                    centered
                )}
            </Box>
        </LeafPage>
    );
};

export default BubbleMatchPage;
