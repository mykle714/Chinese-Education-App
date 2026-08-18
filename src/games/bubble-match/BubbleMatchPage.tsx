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
import { markFlashcard } from "../../api/flashcards";
import { authHeader } from "../../utils/authHeader";
import { useLaunchCollection } from "../../features/flashcards/useLaunchCollection";
import { collectionQuerySuffix } from "../../features/flashcards/collectionRef";
import type { Language, VocabEntry } from "../../types";
import LeafPage from "../../components/LeafPage";
import BubbleMatchHeaderControls from "./BubbleMatchHeader";
import BubbleMatchEndPopup from "./BubbleMatchEndPopup";
import BubbleStage from "./BubbleStage";
import { GAME_DISTRIBUTION, GAME_KEY, LEVEL_CONFIGS, MARK_TYPE, MAX_AVOID_IDS, MIN_REPLAY_PAIRS, TOTAL_PAIRS } from "./constants";
import type { LevelConfig } from "./types";
import { SIZE, WEIGHT, LEADING } from "../../theme/scale";
import ProvisionalCardsNotice from "../../components/ProvisionalCardsNotice";
import ProvisionalSortOffer from "../../components/ProvisionalSortOffer";
import { useProvisionalSortOffer } from "../../hooks/useProvisionalSortOffer";
import { provisionalEntries, provisionalWords } from "../../utils/provisionalCards";
import GamePausedOverlay from "../runtime/GamePausedOverlay";
import { useBackgroundPause } from "../runtime/useBackgroundPause";

/** Shape returned by GET /api/onDeck/gamePool. */
interface GamePoolResponse {
    cards: VocabEntry[];
    requested: Record<string, number>;
    available: Record<string, number>;
    /** Number of cards a full board needs (sum of the requested distribution). */
    total: number;
    /** Cards this particular call had to return (< total for a partial refill). */
    needed: number;
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

/** Build the `?markType=recognition&Unfamiliar=2&Target=10&...` query from the
    launch distribution. Bubble Match is a recognition drill (foreign → meaning),
    so its pool must be bucketed and cooled by the RECOGNITION track. The endpoint
    used to hardcode that; it is now parameterized (Speed Reading pools on `reading`),
    and every caller states its own type rather than relying on the default.
    See docs/MASTERY_REWORK.md § "Games select by their own mark type". */
// `surface` names which baseline the server tops the player up to before it builds
// the pool, so a small deck is filled with temporary cards instead of blocking
// (docs/PROVISIONAL_CARDS.md). Bubble Match's baseline is CARD_BASELINES['bubble-match'].
const poolQuery = [`markType=${MARK_TYPE}`, "surface=bubble-match"]
    .concat(Object.entries(GAME_DISTRIBUTION).map(([cat, n]) => `${encodeURIComponent(cat)}=${n}`))
    .join("&");

/**
 * Bubble Match — page shell + game-flow state machine.
 *
 * Flow: loading → (blocked) → playing → (won | lost) → playing (replay) …
 * The level is chosen on the Games hub (one HubMenuArrayItem sub-card per
 * LEVEL_CONFIGS entry — see GamesPage.tsx) and passed in via `location.state.
 * level`; this page no longer has its own in-game level picker. A run locks
 * in a single set of TOTAL_PAIRS cards (20 pairs = 40 bubbles); the chosen
 * level only sets the launch cadence + ceiling-shrink speed (there is no clock —
 * see LEVEL_CONFIGS in constants.ts). Clearing the level wins the run
 * (and banks its weekly badge plus every easier level's), and the field
 * over-packing loses it.
 *
 * Minute-points: the fire badge lives in the header and earning is gated by
 * route prefix in the global activity-detection layer (see the eligible-pages
 * list), so this page only needs to render the badge — no per-page hook.
 */
const BubbleMatchPage: React.FC = () => {
    // Which collection this game was launched from (docs/DECKS_FEATURE.md) — null
    // for an ordinary launch from the Games hub. Appended to every pool request so
    // the round stays inside the set the learner picked.
    const launchCollection = useLaunchCollection();
    const collectionSuffix = collectionQuerySuffix(launchCollection);
    usePageTitle("Bubble Match");
    const navigate = useNavigate();
    const location = useLocation();
    const theme = useTheme();
    const fc = theme.palette.flashcard;
    const { user } = useAuth();
    const tts = useTTS();
    const { settings, update } = useFlashcardLearnSettings();
    const { showPinyin, showPinyinColor, autoplayChinese } = settings;
    const { recordWin } = useGameWins(GAME_KEY);

    // Block the mobile browser's edge-swipe-back gesture while this page is
    // mounted — an edge swipe would otherwise navigate away mid-drag. CSS
    // touch-action can't stop the history gesture, so this is handled at the
    // touch-event layer (see the hook).
    useBlockEdgeSwipe(true);

    // The level tapped on the Games hub, via nav `state` (HubMenuArrayItem /
    // HubMenuRow's `state` prop). There's no in-game picker to fall back to, so
    // a direct/stray visit with no valid level (e.g. a manual URL) redirects to
    // the Games hub (see the redirect effect below) rather than silently
    // defaulting. `initialLevel` still resolves to a safe value so the hooks
    // below stay valid until that redirect fires.
    const requestedLevel = (location.state as { level?: number } | null)?.level;
    const chosenLevel = LEVEL_CONFIGS.find((cfg) => cfg.level === requestedLevel) ?? null;
    const initialLevel = chosenLevel ?? LEVEL_CONFIGS[0];

    const [phase, setPhase] = useState<Phase>("loading");
    // Temporary cards the server lent for THIS board, if any. Drives the pre-round
    // notice and the end-of-round "keep these" offer (docs/PROVISIONAL_CARDS.md).
    // Bubble Match plays a fixed 20-card set, so the notice names the exact words.
    const [noticeOpen, setNoticeOpen] = useState(false);
    const [blockMessage, setBlockMessage] = useState<string>("");
    const [pool, setPool] = useState<VocabEntry[]>([]);
    const [level, setLevel] = useState<LevelConfig>(initialLevel);
    // Whether the game-over card is collapsed into the top-right corner puck.
    const [popupMinimized, setPopupMinimized] = useState(false);
    // Vocab-entry ids the player successfully matched DURING the run (post-loss
    // cleanup drags are excluded — BubbleStage suppresses onMark in cleanup mode).
    // "Play Again" retires exactly these and keeps the rest of the board, so words
    // the player couldn't match come back until they get them. Reset by beginRun.
    const matchedIdsRef = useRef<Set<number>>(new Set());
    // Every card cleared at any point THIS PAGE SESSION — a client-side cooldown
    // that outlives a single run. Sent as the refill's `avoid` list so round 3
    // doesn't hand back what was cleared in round 1. Never reset while mounted;
    // the server treats it as a soft preference, so a small library can still
    // fill a board from it rather than starving.
    const clearedThisSessionRef = useRef<Set<number>>(new Set());
    // Bumped on each (re)start so BubbleStage remounts with a clean slate.
    const runIdRef = useRef(0);
    const [runId, setRunId] = useState(0);

    // Fetch a randomized game pool from the server (the endpoint orders candidates
    // by RANDOM(), so each call yields a different vocab set).
    //
    // `refill` requests a PARTIAL pool: only `need` cards, never one of `keepIds`
    // (hard exclude — those are still on the board) and preferring not to return
    // one of `avoidIds` (soft — cards already cleared this session). That's the
    // "Play Again" path. A partial fetch never blocks on a shortfall (the caller
    // still has its kept cards to play with); a full fetch does.
    //
    // Returns the cards on success, or null after switching to the blocked phase
    // (insufficient cards or a network error).
    const fetchGamePool = useCallback(async (
        refill?: { need: number; keepIds: number[]; avoidIds: number[] }
    ): Promise<VocabEntry[] | null> => {
        try {
            // The collection suffix (docs/DECKS_FEATURE.md) goes on BOTH the full
            // board and the Play-Again refill: a deck-launched game that dropped it
            // on refill would start pulling replacements from the whole library.
            const query = (refill
                ? `${poolQuery}&need=${refill.need}&exclude=${refill.keepIds.join(",")}`
                  + `&avoid=${refill.avoidIds.join(",")}`
                : poolQuery) + collectionSuffix;
            const res = await fetch(`${API_BASE_URL}/api/onDeck/gamePool?${query}`, {
                credentials: "include",
                headers: authHeader(),
            });
            if (!res.ok) throw new Error("Failed to load game pool");
            const data: GamePoolResponse = await res.json();

            // NO CARD-COUNT GATE. The server has already topped the player up to the
            // Bubble Match baseline with temporary cards, so `sufficient` can only be
            // false when the dictionary itself ran dry — and even then a short board
            // plays fine (BubbleStage sizes itself off the pool length). The old
            // "you need 20 Learn Now cards" block is gone for good; see
            // docs/PROVISIONAL_CARDS.md § Nothing blocks on card count.

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
        // reload on token refresh". `collectionSuffix` is likewise omitted: it comes
        // from this page's own URL, which cannot change without remounting the page,
        // so the closure can never go stale.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Apply the state transitions that kick off a fresh run with the given pool.
    // The pool is reshuffled here so the launch order differs every run.
    const beginRun = useCallback((cfg: LevelConfig, runPool: VocabEntry[]) => {
        // Announce lent cards before the bubbles start launching, so the player isn't
        // surprised by words they never sorted.
        setNoticeOpen(provisionalWords(runPool).length > 0);
        setLevel(cfg);
        setPopupMinimized(false);
        matchedIdsRef.current = new Set(); // new run → nothing matched yet
        setPool(shuffle(runPool));
        runIdRef.current += 1;
        setRunId(runIdRef.current);
        setPhase("playing");
    }, []);

    // Fetch the game pool once on mount, then start straight into the level
    // requested from the hub (no in-game picker to land on anymore).
    // No level chosen (direct URL / stray nav) — bounce back to the Games hub,
    // where the player picks a difficulty. Runs before any pool loads.
    useEffect(() => {
        if (!chosenLevel) navigate("/games", { replace: true });
    }, [chosenLevel, navigate]);

    useEffect(() => {
        if (!chosenLevel) return; // no level → the redirect effect handles it
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

    // Restart the current level on the already-loaded card set (reshuffled launch
    // order) — the header's mid-run restart. Primes the audio element inside this
    // real click gesture: in-game autoplay fires from a bubble's pointerdown but
    // only after an awaited fetch, which loses gesture context — without this,
    // mobile autoplay policy would silently drop the first Chinese bubble's
    // narration.
    const startLevel = useCallback((cfg: LevelConfig) => {
        tts.unlockAudio();
        beginRun(cfg, pool);
    }, [tts.unlockAudio, beginRun, pool]);

    // The end popup's single "Play Again": same level, PARTIALLY refreshed board.
    // Cards the player matched during the run are retired and replaced by fresh
    // ones; cards they failed to match stay in the set so they get another go at
    // them. The refill request carries BOTH lists: the kept ids as a hard exclude
    // (they're still on the board — a duplicate would be two identical bubbles)
    // and every card cleared this session as a soft avoid (so the words just
    // retired don't come straight back as their own replacements). Primes audio
    // inside the click gesture before the awaited fetch (see startLevel).
    const playAgain = useCallback(async () => {
        tts.unlockAudio();
        const kept = pool.filter((c) => !matchedIdsRef.current.has(c.id));
        const need = TOTAL_PAIRS - kept.length;
        // Nothing matched (or the board is somehow already full) → straight replay,
        // no round trip.
        if (need <= 0) {
            beginRun(level, kept);
            return;
        }
        setPhase("loading");
        const fresh = await fetchGamePool({
            need,
            keepIds: kept.map((c) => c.id),
            // Newest-first cap: a Set keeps insertion order, so the tail is the
            // most recently cleared. See MAX_AVOID_IDS.
            avoidIds: [...clearedThisSessionRef.current].slice(-MAX_AVOID_IDS),
        });
        if (!fresh) return; // network error → fetchGamePool switched to blocked
        let nextPool = [...kept, ...fresh];
        // A refill can come up short if the library shrank mid-session. A slightly
        // smaller board still plays (BubbleStage sizes itself off the pool), but below
        // the floor there's no game left to offer.
        //
        // Rather than blocking, fall back to a FULL pool fetch. A partial refill
        // deliberately skips the baseline top-up (OnDeckVocabController.getGamePool —
        // lending cards on every Play Again tap would quietly grow the player's deck),
        // so the full fetch is what re-triggers provisioning and rebuilds a real board.
        // See docs/PROVISIONAL_CARDS.md § Nothing blocks on card count.
        if (nextPool.length < MIN_REPLAY_PAIRS) {
            const fullPool = await fetchGamePool();
            if (!fullPool) return; // fetchGamePool already surfaced the network error
            nextPool = fullPool;
        }
        beginRun(level, nextPool);
    }, [tts.unlockAudio, fetchGamePool, beginRun, pool, level]);

    // Record a flashcard review mark for a matched/mismatched bubble's vocab
    // entry, reusing the same endpoint flp's working loop calls. Fire-and-forget:
    // the game never blocks on it, and a failure only logs (no run interruption).
    // Only invoked from in-game drag matches — not from post-loss cleanup drags
    // after the game ends (BubbleStage suppresses onMark while cleanupMode is on).
    const markBubbleMatch = useCallback((entry: VocabEntry, isCorrect: boolean) => {
        // Remember which cards were cleared in-run so "Play Again" can retire them
        // and keep the ones still on the field. Only successful matches count — a
        // wrong drop leaves both bubbles in play.
        if (isCorrect) {
            matchedIdsRef.current.add(entry.id);
            clearedThisSessionRef.current.add(entry.id);
        }
        // Bubble Match is a recognition drill (foreign → meaning); see
        // docs/MASTERY_REWORK.md.
        // excludeIds defaults to []: the game doesn't use the replacement card the
        // endpoint returns, so there's nothing to dedupe against.
        markFlashcard({ cardId: entry.id, isCorrect, type: MARK_TYPE, surface: "bubble-match" })
            .catch((err) => console.error(`[BubbleMatch] mark failed → card ${entry.id}:`, err));
        // No `token` dep — markFlashcard reads the header at call time, so this
        // callback's identity is stable across a silent refresh (CLAUDE.md ⛔ rule).
    }, []);

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

    // ── Popup pause gate ─────────────────────────────────────────────────────
    // No game clock may run while a MODAL popup covers the board. Bubble Match has
    // no clock, but it has the same problem in another currency: the launcher keeps
    // firing and the ceiling keeps descending, so a player reading the
    // provisional-cards notice can come back to a field that filled up (or lost)
    // without them. The notice is a full-screen input-blocking overlay, so freezing
    // the field buys no free study time. Shared rule across all four games — see
    // docs/GAMES_FEATURE.md § Popups pause the clock.
    // BACKGROUNDING IS THE SECOND SOURCE for this same boolean — the app-wide rule
    // (docs/GAMES_FEATURE.md § Backgrounding pauses the clock). It latches, so the
    // ceiling does not resume descending the instant the player returns; they tap
    // Resume on the overlay below. Only while genuinely playing, so returning to a
    // finished board shows no prompt.
    const { paused: backgroundPaused, resume: resumeFromBackground } =
        useBackgroundPause(phase === "playing");
    const clockPaused = noticeOpen || backgroundPaused;

    // End-of-run offer to keep the lent cards. It opens a beat AFTER the win/loss
    // popup so the result lands first, then stacks over it in the opposite corner.
    const sortOffer = useProvisionalSortOffer(
        phase === "won" || phase === "lost",
        provisionalWords(pool)
    );

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

    // Shared replay actions for BOTH end-of-run popups (won / lost): a single
    // primary "Play Again" (same level, matched cards swapped out — see playAgain)
    // above a secondary "Back to Games". The victory and game-over cards share
    // identical controls and differ only in their text box.
    const replayActions = (
        <Box
            className="bubble-match__replay-actions"
            sx={{ display: "flex", flexDirection: "column", gap: 1.25, width: "100%" }}
        >
            <Button
                className="bubble-match__replay-btn bubble-match__replay-btn--play-again"
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
                className="bubble-match__replay-btn bubble-match__replay-btn--back"
                variant="outlined"
                onClick={() => navigate("/games")}
                sx={{ py: 1, borderRadius: "14px", textTransform: "none", fontWeight: WEIGHT.medium }}
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
                    You matched all {pool.length} pairs on Level {level.level} — {level.label}. 🎉
                </Typography>
                {/* Weekly ⭐ badge for the level just cleared. */}
                <Typography className="bubble-match__popup-weekly" sx={{ fontSize: SIZE.body, fontWeight: WEIGHT.bold, color: fc.onSurface }}>
                    ⭐ Weekly badge unlocked: {level.label}!
                </Typography>
                {replayActions}
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
                {replayActions}
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
        <>
        {/* Pre-round notice: names the temporary cards this board was topped up with. */}
        <ProvisionalCardsNotice
            open={noticeOpen}
            onDismiss={() => setNoticeOpen(false)}
            surfaceName="Bubble Match"
            // The board's cards are in hand, so the preview needs no extra round-trip.
            entries={provisionalEntries(pool)}
            language={(user?.selectedLanguage ?? "zh") as Language}
        />
        <LeafPage
            title="Bubble Match"
            onBack={() => navigate("/games")}
            rightContent={
                <BubbleMatchHeaderControls
                    // Gates the pinyin toggle out for Latin-script languages, where
                    // ForeignText ignores it entirely.
                    language={(user?.selectedLanguage ?? "zh") as Language}
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
                            // Game-over popup minimized → the packed field becomes a
                            // no-stakes cleanup playground (draggable/matchable, no
                            // marks). A win clears the field, so only the lost phase
                            // has anything left to clean up.
                            cleanupMode={phase === "lost" && popupMinimized}
                            // Freeze the launcher, the descending ceiling and the
                            // overfill check while a modal popup covers the stage
                            // (see the `paused` prop, and docs/GAMES_FEATURE.md
                            // § Popups pause the clock).
                            paused={clockPaused}
                        />
                        {popup}
                        {/* Stacks over the win/loss popup; collapses to the OTHER
                            corner so the two pucks stay tellable apart. */}
                        <ProvisionalSortOffer
                            open={sortOffer.open}
                            words={provisionalWords(pool)}
                            language={(user?.selectedLanguage ?? "zh") as Language}
                            onDismiss={sortOffer.dismiss}
                            minimized={sortOffer.minimized}
                            onMinimize={sortOffer.onMinimize}
                            onRestore={sortOffer.onRestore}
                        />
                    </>
                ) : (
                    centered
                )}
            </Box>

            {/* Backgrounding paused the round — the app-wide rule
                (docs/GAMES_FEATURE.md § Backgrounding pauses the clock). A SIBLING of
                the board, like GameEndPopup, so the layout does not change shape when
                paused; it covers the board so the pause cannot be used as a free look
                at it, and the clock only restarts when the player taps Resume. */}
            <GamePausedOverlay
                open={backgroundPaused}
                onResume={resumeFromBackground}
                classPrefix="bubble-match"
            />
        </LeafPage>
        </>
    );
};

export default BubbleMatchPage;
