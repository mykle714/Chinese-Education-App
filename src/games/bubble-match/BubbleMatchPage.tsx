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
import MobileFooter, { FLOATING_FOOTER_CLEARANCE } from "../../components/MobileFooter";
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

/** Per-level weekly-achievement keys. Each level banks its own badge in the
 *  per-user `weeklies` table (wiped weekly by a prod cron); clearing a harder
 *  level also banks every easier level's badge (see recordWeeklyWin). Keys look
 *  like `bubbleMatch-1` (Relaxed) … `bubbleMatch-3` (Frantic). */
const WEEKLY_PREFIX = "bubbleMatch";
const weeklyKeyForLevel = (level: number) => `${WEEKLY_PREFIX}-${level}`;
/** Parse a stored activity key back into its level number, or null if it isn't a
 *  Bubble Match per-level key (also tolerates a legacy bare `bubbleMatch`). */
const levelFromWeeklyKey = (activity: string): number | null => {
    const m = /^bubbleMatch-(\d+)$/.exec(activity);
    return m ? Number(m[1]) : null;
};

/** Human-readable preferred mix, e.g. "2 Unfamiliar, 10 Target, 6 Comfortable, and 2 Mastered". */
const RECOMMENDED_MIX = (() => {
    const parts = Object.entries(GAME_DISTRIBUTION).map(([cat, n]) => `${n} ${cat}`);
    if (parts.length <= 1) return parts.join("");
    return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
})();

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
    const [loseReason, setLoseReason] = useState<LoseReason | null>(null);
    // Whether the game-over card is collapsed into the top-right corner puck.
    const [popupMinimized, setPopupMinimized] = useState(false);
    // Set of level numbers the user has already cleared this week (from the
    // weeklies table). Seeded on mount and updated optimistically on a fresh win,
    // so the picker / win popup can surface the per-level weekly badges.
    const [clearedLevels, setClearedLevels] = useState<Set<number>>(new Set());
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

    // Seed the per-level cleared set from the weeklies table so the picker / win
    // popup can reflect badges earned earlier this week. Fire-and-forget: a
    // failure just leaves the set empty (no UI blocking).
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
                const levels = (data.weeklies ?? [])
                    .map((w) => levelFromWeeklyKey(w.activity))
                    .filter((lv): lv is number => lv !== null);
                setClearedLevels(new Set(levels));
            } catch {
                /* leave clearedLevels empty */
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

    // Drop back to the level picker (keeps the loaded pool for a quick replay).
    const backToPicker = useCallback(() => setPhase("start"), []);

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

    // Bank the weekly badges for clearing `clearedLevel`: that level plus every
    // easier one (lower level number). Fire-and-forget per key (mirrors
    // markBubbleMatch): the win UI never blocks on it, and the cleared set is
    // updated optimistically so the popup reflects the badges even if a POST is
    // slow. Already-earned levels are skipped (the upsert would just re-stamp).
    const recordWeeklyWin = useCallback((clearedLevel: number) => {
        const earned = LEVEL_CONFIGS.map((c) => c.level).filter((lv) => lv <= clearedLevel);
        setClearedLevels((prev) => {
            const next = new Set(prev);
            earned.forEach((lv) => next.add(lv));
            return next;
        });
        const headers: HeadersInit = { "Content-Type": "application/json" };
        if (token && token !== "null" && token !== "undefined") {
            headers["Authorization"] = `Bearer ${token}`;
        }
        earned.forEach((lv) => {
            fetch(`${API_BASE_URL}/api/users/me/weeklies`, {
                method: "POST",
                headers,
                credentials: "include",
                body: JSON.stringify({ key: weeklyKeyForLevel(lv), value: true }),
            })
                .then((res) => console.log(`[BubbleMatch] weekly badge L${lv} recorded → HTTP ${res.status}`))
                .catch((err) => console.error(`[BubbleMatch] weekly badge L${lv} record failed:`, err));
        });
    }, [token]);

    // Clearing the chosen level wins the run and banks its weekly badge (plus
    // every easier level's). Levels don't chain — the win popup offers replay /
    // picker, not an auto-advance.
    const onLevelWin = useCallback(() => {
        setPopupMinimized(false);
        recordWeeklyWin(level.level);
        setPhase("won");
    }, [recordWeeklyWin, level.level]);
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
                // Clear the floating footer pill that overlays the non-gameplay
                // (info / loading / blocked) screens so centered content never
                // tucks behind it.
                pb: `${FLOATING_FOOTER_CLEARANCE}px`,
                textAlign: "center",
            }}
        >
            {children}
        </Box>
    );

    // Shared replay actions for the end-of-run popups (won / lost). Levels don't
    // chain, so both offer: replay this level (same / different vocab set), jump
    // back to the picker, or quit. `level` is the level that just ended.
    const endActions = (
        <Box className="bubble-match__popup-actions" sx={{ display: "flex", flexDirection: "column", gap: 1.5, width: "100%" }}>
            <Button variant="contained" onClick={() => startLevel(level)} sx={{ textTransform: "none" }}>
                Play Level {level.level} again (same vocab set)
            </Button>
            <Button variant="outlined" onClick={() => startLevelNewVocab(level)} sx={{ textTransform: "none" }}>
                Play again with a different vocab set
            </Button>
            <Button variant="text" onClick={backToPicker}>Choose another level</Button>
            <Button variant="text" onClick={() => navigate("/games")}>Back to Games</Button>
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
                    Match each word to its meaning by dragging one bubble onto the other before the screen fills up. Pick a level — each one plays a single {TOTAL_PAIRS}-pair set, and higher levels launch the bubbles faster with less time on the clock. Clearing a harder level also earns every easier level's badge.
                </Typography>
                <Typography className="bubble-match__recommended-mix" sx={{ fontSize: SIZE.body, color: fc.textSecondary, lineHeight: LEADING.normal, maxWidth: 300, fontStyle: "italic" }}>
                    For the best practice mix, play with at least {RECOMMENDED_MIX} cards in your Learn Now deck.
                </Typography>
                {/* Level picker — one button per level, each independently playable.
                    A ⭐ marks a level already cleared this week (from the weeklies
                    table); higher levels launch faster (shorter interval, less time). */}
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
                            <Box component="span" className="bubble-match__level-btn-name" sx={{ fontSize: SIZE.caption, opacity: 0.85 }}>
                                {cfg.label}
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
                {/* Weekly badge(s) banked — this level plus every easier one. */}
                <Typography className="bubble-match__popup-weekly" sx={{ fontSize: SIZE.body, fontWeight: WEIGHT.bold, color: fc.onSurface }}>
                    ⭐ Weekly badge unlocked: {level.label}{level.level > 1 ? ` (and every easier level)` : ""}!
                </Typography>
                {endActions}
            </BubbleMatchEndPopup>
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
                    {" "}You were playing Level {level.level} — {level.label}.
                </Typography>
                {endActions}
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
                            // hoverable for studying the pairs. (A win clears the
                            // field, so only the lost phase has anything to study.)
                            studyMode={phase === "lost" && popupMinimized}
                        />
                        {popup}
                    </>
                ) : (
                    centered
                )}

                {/* Floating bottom nav on the non-gameplay (info / loading /
                    blocked) screens so players can jump to other tabs without
                    backing out first. Hidden during the live stage (playing / won
                    / lost), where the stage owns the full surface and the
                    end-popup provides its own navigation. Anchors to this
                    position:relative content box. */}
                {!showStage && <MobileFooter activePage="home" />}
            </Box>
        </>
    );
};

export default BubbleMatchPage;
