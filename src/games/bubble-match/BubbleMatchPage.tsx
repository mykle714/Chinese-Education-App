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
import type { VocabEntry } from "../../types";
import LeafPage from "../../components/LeafPage";
import BubbleMatchHeaderControls from "./BubbleMatchHeader";
import BubbleMatchEndPopup from "./BubbleMatchEndPopup";
import BubbleMatchLevelMenu from "./BubbleMatchLevelMenu";
import BubbleStage from "./BubbleStage";
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
    | "start" // level picker
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

/** Game key under which Bubble Match wins are logged in the shared `wins` table
 *  ({ game, level }). Each win is one row; the per-level ⭐ "earned this week"
 *  badge is derived server-side as a timestamp filter over that log (see
 *  WinsDAL.getWeeklyWins). The level is stored as a string ('1'…'3'). */
const GAME_KEY = "bubbleMatch";

/** Human-readable preferred mix, e.g. "2 Unfamiliar, 10 Target, 6 Comfortable, and 2 Mastered". */
const RECOMMENDED_MIX = (() => {
    const parts = Object.entries(GAME_DISTRIBUTION).map(([cat, n]) => `${n} ${cat}`);
    if (parts.length <= 1) return parts.join("");
    return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
})();

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
 * Flow: loading → (blocked | start) → playing → (won | lost) → start …
 * The start screen is a level picker: the player chooses one LEVEL_CONFIGS entry
 * and plays it on its own (levels do NOT chain). A run locks in a single set of
 * TOTAL_PAIRS cards (20 pairs = 40 bubbles); the chosen level only sets the
 * launch cadence + clock. Clearing the level wins the run (and banks its weekly
 * badge plus every easier level's), and running out of time/space loses it.
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
    // Whether the game-over card is collapsed into the top-right corner puck.
    const [popupMinimized, setPopupMinimized] = useState(false);
    // Whether the "Different Level / Same Cards" floating level menu is open over
    // the end popup. Selecting a level replays the loaded pool at that level.
    const [levelMenuOpen, setLevelMenuOpen] = useState(false);
    // Set of level numbers the user has won this week (derived from the wins log
    // via GET /api/users/me/wins). Seeded on mount and updated optimistically on a
    // fresh win, so the picker / win popup can surface the per-level ⭐ badges.
    const [clearedLevels, setClearedLevels] = useState<Set<number>>(new Set());
    // Lifetime win count per level number (all-time, never reset), from the
    // `lifetime` half of GET /api/users/me/wins. Seeded on mount and bumped
    // optimistically on a fresh win; rendered as the "×N" tally on each picker
    // button. Levels with no wins are simply absent (treated as 0).
    const [lifetimeWins, setLifetimeWins] = useState<Record<number, number>>({});
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

    // Seed the picker badges from GET /api/users/me/wins, which returns both:
    //   • `weekly`   — distinct (game, level) won since the user's week boundary
    //                  → drives the per-level ⭐.
    //   • `lifetime` — nested all-time counts { game: { level: count } }
    //                  → drives the per-level "×N" tally.
    // Fire-and-forget: a failure just leaves the badges empty (no UI blocking).
    useEffect(() => {
        if (!token) return;
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch(`${API_BASE_URL}/api/users/me/wins`, {
                    credentials: "include",
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (!res.ok) return;
                const data: {
                    weekly?: Array<{ game: string; level: string }>;
                    lifetime?: Record<string, Record<string, number>>;
                } = await res.json();
                if (cancelled) return;

                const levels = (data.weekly ?? [])
                    .filter((w) => w.game === GAME_KEY)
                    .map((w) => Number(w.level))
                    .filter((lv) => Number.isFinite(lv));
                setClearedLevels(new Set(levels));

                // Flatten this game's { level: count } into a numeric-keyed map.
                const counts: Record<number, number> = {};
                for (const [lvStr, count] of Object.entries(data.lifetime?.[GAME_KEY] ?? {})) {
                    const lv = Number(lvStr);
                    if (Number.isFinite(lv)) counts[lv] = count;
                }
                setLifetimeWins(counts);
            } catch {
                /* leave badges empty */
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
        setPopupMinimized(false);
        setLevelMenuOpen(false);
        setPool(shuffle(runPool));
        runIdRef.current += 1;
        setRunId(runIdRef.current);
        setPhase("playing");
    }, []);

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

    // Log one win for the level just cleared. Fire-and-forget (mirrors
    // markBubbleMatch): the win UI never blocks on it, and the cleared set is
    // updated optimistically so the ⭐ shows immediately even if the POST is slow.
    // Records ONLY the level actually cleared — each row is a real lifetime win,
    // so easier levels are not fabricated. The server derives both the lifetime
    // count and the "this week" badge from these rows.
    const recordWin = useCallback((clearedLevel: number) => {
        setClearedLevels((prev) => {
            const next = new Set(prev);
            next.add(clearedLevel);
            return next;
        });
        // Optimistically bump the lifetime tally so the picker's "×N" reflects
        // this win immediately (the server is the source of truth on next load).
        setLifetimeWins((prev) => ({ ...prev, [clearedLevel]: (prev[clearedLevel] ?? 0) + 1 }));
        const headers: HeadersInit = { "Content-Type": "application/json" };
        if (token && token !== "null" && token !== "undefined") {
            headers["Authorization"] = `Bearer ${token}`;
        }
        fetch(`${API_BASE_URL}/api/users/me/wins`, {
            method: "POST",
            headers,
            credentials: "include",
            body: JSON.stringify({ game: GAME_KEY, level: clearedLevel }),
        })
            .then((res) => console.log(`[BubbleMatch] win L${clearedLevel} recorded → HTTP ${res.status}`))
            .catch((err) => console.error(`[BubbleMatch] win L${clearedLevel} record failed:`, err));
    }, [token]);

    // Clearing the chosen level wins the run and logs the win. Levels don't chain
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
    } else if (phase === "start") {
        centered = renderCentered(
            <>
                <Typography className="bubble-match__title" sx={{ fontSize: SIZE.heading, fontWeight: WEIGHT.bold, color: fc.onSurface }}>
                    Bubble Match
                </Typography>
                <Typography className="bubble-match__rules" sx={{ fontSize: SIZE.body, color: fc.textSecondary, lineHeight: LEADING.normal, maxWidth: 300 }}>
                    Match each word to its meaning by dragging one bubble onto the other before the field fills up. Once every bubble is out, the ceiling starts closing in from the top — clear the field before it crushes you. Pick a level — each one plays a single {TOTAL_PAIRS}-pair set, and higher levels launch the bubbles faster and drop the ceiling quicker. Clear a level to earn its ⭐ badge for the week.
                </Typography>
                <Typography className="bubble-match__recommended-mix" sx={{ fontSize: SIZE.body, color: fc.textSecondary, lineHeight: LEADING.normal, maxWidth: 300, fontStyle: "italic" }}>
                    For the best practice mix, play with at least {RECOMMENDED_MIX} cards in your Learn Now deck.
                </Typography>
                {/* Level picker — one button per level, each independently playable.
                    A ⭐ marks a level already won this week (from the wins log);
                    higher levels launch faster and drop the ceiling quicker. */}
                <Box className="bubble-match__level-picker" sx={{ display: "flex", flexDirection: "column", gap: 1.5, width: "100%", maxWidth: 300, mt: 1 }}>
                    {LEVEL_CONFIGS.map((cfg) => (
                        <Button
                            key={cfg.level}
                            className={`bubble-match__level-btn bubble-match__level-btn--${cfg.level}`}
                            variant="contained"
                            onClick={() => startLevel(cfg)}
                            sx={{ py: 1.25, px: 2, fontSize: SIZE.bodyLg, textTransform: "none", borderRadius: "12px", justifyContent: "space-between" }}
                        >
                            <Box component="span" className="bubble-match__level-btn-label" sx={{ fontWeight: WEIGHT.bold }}>
                                {clearedLevels.has(cfg.level) ? "⭐ " : ""}Level {cfg.level}
                            </Box>
                            {/* Right group: difficulty name + lifetime "×N" win tally. */}
                            <Box component="span" className="bubble-match__level-btn-meta" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                                <Box component="span" className="bubble-match__level-btn-name" sx={{ fontSize: SIZE.caption, opacity: 0.85 }}>
                                    {cfg.label}
                                </Box>
                                {(lifetimeWins[cfg.level] ?? 0) > 0 && (
                                    <Box
                                        component="span"
                                        className="bubble-match__level-btn-wins"
                                        title={`${lifetimeWins[cfg.level]} lifetime win${lifetimeWins[cfg.level] === 1 ? "" : "s"}`}
                                        sx={{ fontSize: SIZE.caption, fontWeight: WEIGHT.bold, opacity: 0.9 }}
                                    >
                                        ×{lifetimeWins[cfg.level]}
                                    </Box>
                                )}
                            </Box>
                        </Button>
                    ))}
                </Box>
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
