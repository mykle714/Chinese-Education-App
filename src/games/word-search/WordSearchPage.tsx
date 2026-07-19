import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Box, Button, Typography, useTheme } from "@mui/material";
import DelayedCircularProgress from "../../components/DelayedCircularProgress";
import { useAuth } from "../../AuthContext";
import { API_BASE_URL } from "../../constants";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useTTS } from "../../hooks/useTTS";
import { useBlockEdgeSwipe } from "../../hooks/useBlockEdgeSwipe";
import { authHeader } from "../../utils/authHeader";
import LeafPage from "../../components/LeafPage";
import { SIZE, WEIGHT, LEADING } from "../../theme/scale";
import WordSearchHeaderControls from "./WordSearchHeader";
import WordSearchSettingsDialog from "./WordSearchSettingsDialog";
import WordSearchWordList from "./WordSearchWordList";
import WordSearchHintRow from "./WordSearchHintRow";
import WordSearchGrid, { type WordSearchGridHandle } from "./WordSearchGrid";
import WordSearchHintBar from "./WordSearchHintBar";
import GameEndPopup from "../runtime/GameEndPopup";
import { useWordSearchSettings } from "./useWordSearchSettings";
import { saveGameState, loadGameState, clearGameState, type SavedWordSearchState } from "./gameStateStorage";
import { GRID_QUERY, TOTAL_WORDS, HINT_BAR_UNITS, HINT_COST, medalForTime, modeConfigFor, formatTimeMs } from "./constants";
import { countPinyinUnits } from "./pinyinUnits";
import type { BonusWord, PlacedWord, WordSearchResponse } from "./types";

type Phase = "loading" | "blocked" | "playing" | "won";

/** Win-log key for Word Search completions (shared `wins` table). */
const GAME_KEY = "wordSearch";

/**
 * Word Search — page shell + game-flow state machine.
 *
 * Flow: loading → (blocked | playing → won). One relaxed mode: a count-up timer
 * runs from the first interaction until all 20 words are found, and the finish
 * time earns a medal (see docs/WORD_SEARCH_GAME.md §5). Word Search is a LEAF
 * PAGE (down-arrow back → /games, no footer).
 *
 * Pause/resume (§5b): the board + timer + hint state are snapshotted to
 * localStorage (gameStateStorage.ts) whenever the tab is backgrounded or the
 * page unmounts, and restored on the next mount instead of fetching a fresh
 * board — see `persistSnapshot` / `restoreBoard` below.
 */
const WordSearchPage: React.FC = () => {
    usePageTitle("Word Search");
    const navigate = useNavigate();
    const location = useLocation();
    const theme = useTheme();
    const fc = theme.palette.flashcard;
    const { token, user } = useAuth();
    const userId = user?.id;
    const tts = useTTS();
    const { settings: wsSettings, update: updateWsSettings } = useWordSearchSettings();
    const { showTimer } = wsSettings;

    // The board mode ("pinyin" / "no-pinyin") is chosen on the Games hub (one
    // sub-card each — see GamesPage) and passed in via nav `state.mode`; there's
    // no in-game switch, so it's read once on mount and fixed for the whole run.
    // A direct/stray visit with no valid mode redirects to /games (see the
    // redirect effect below) rather than defaulting. Pinyin, when shown, is
    // always tone-colored — the colorless variant was removed.
    const [modeConfig] = useState(() => modeConfigFor((location.state as { mode?: string } | null)?.mode));
    const mode = modeConfig?.mode;
    const showPinyin = modeConfig?.showPinyin ?? false;
    const showPinyinColor = true;

    // Whether this mount was launched from the hub's RESUME card (restore the
    // saved board) vs a mode button (always start a fresh board). Captured once
    // on mount — both modes share a single saved slot now, so a mode button must
    // never silently resume; only the resume card does. See GamesPage /
    // WordSearchHubItem and docs/WORD_SEARCH_GAME.md §5b.
    const [resumeIntent] = useState(() => (location.state as { resume?: boolean } | null)?.resume === true);

    // An edge swipe would navigate away mid-drag; block it while mounted.
    useBlockEdgeSwipe(true);

    // No mode chosen (direct URL / stray nav) — bounce back to the Games hub,
    // where the player picks Pinyin vs No Pinyin. Runs before any board loads.
    useEffect(() => {
        if (!modeConfig) navigate("/games", { replace: true });
    }, [modeConfig, navigate]);

    const [phase, setPhase] = useState<Phase>("loading");
    const [blockMessage, setBlockMessage] = useState("");
    const [data, setData] = useState<WordSearchResponse | null>(null);
    const [found, setFound] = useState<Set<string>>(new Set());
    // Whether the end-of-run popup is collapsed into the corner puck.
    const [popupMinimized, setPopupMinimized] = useState(false);
    // Settings sheet (pinyin display + timer visibility), behind the header cog.
    const [settingsOpen, setSettingsOpen] = useState(false);
    const gridRef = useRef<WordSearchGridHandle>(null);

    // Hint meter: each successful find adds a unit (capped at HINT_BAR_UNITS); a
    // hint is spendable once >= HINT_COST units are banked. The hint row is
    // BLANK until the first hint spend. `hintEntryKey` is the one word currently
    // being hinted (or null); `hintRevealCount` is how many of its pinyin
    // units (see pinyinUnits.ts) have been revealed, hangman-style — each further
    // hint reveals another unit of the SAME word until it's found (row clears)
    // or fully spelled out. Once fully spelled out, pressing hint again doesn't
    // move on to a different word: it flips `hintLocationRevealed` (the word's
    // actual grid cells show in yellow, persistently, until it's found) and
    // bumps `hintShakeNonce` to re-shake those cells. See §5a.
    const [hintUnits, setHintUnits] = useState(0);
    const [hintEntryKey, setHintEntryKey] = useState<string | null>(null);
    const [hintRevealCount, setHintRevealCount] = useState(0);
    const [hintLocationRevealed, setHintLocationRevealed] = useState(false);
    const [hintShakeNonce, setHintShakeNonce] = useState(0);
    // Each DISTINCT "blue match" (multi-character bonus word, see
    // WordSearchGrid's onBonusFound) awards one hint unit the first time it's
    // traced. Tracked by entryKey so re-tracing the SAME bonus word again
    // (its popup has no auto-dismiss, so it's easy to re-trigger) doesn't
    // re-award — a different bonus word still grants its own unit.
    const rewardedBonusWordsRef = useRef<Set<string>>(new Set());

    // Tapping anywhere that isn't a grid cell deselects the in-progress word.
    const handleBackgroundPointerDown = useCallback((e: React.PointerEvent) => {
        if (!(e.target as Element).closest?.('[data-cell="1"]')) {
            gridRef.current?.clearSelection();
        }
    }, []);

    // Count-up timer. `startRef` is non-null ONLY while the interval is
    // actively ticking (invariant relied on by pause/resume/win below);
    // `pausedElapsedRef` mirrors the last known elapsed value so a paused (or
    // not-yet-started) board can be measured/resumed without it.
    // `hasStartedRef` records whether the clock has EVER been started on this
    // board, independent of whether it's currently ticking — this is what
    // gates whether a resumed board should auto-resume ticking.
    const [elapsedMs, setElapsedMs] = useState(0);
    const startRef = useRef<number | null>(null);
    const pausedElapsedRef = useRef(0);
    const hasStartedRef = useRef(false);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const [finalMs, setFinalMs] = useState(0);

    // Hard stop: clears the interval only (used on win / starting a fresh
    // board, where nothing needs to resume afterward).
    const stopTimer = useCallback(() => {
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    // (Re)start ticking from a given elapsed baseline. Shared by the first
    // real interaction, resuming after a pause, and restoring a saved board.
    const startTicking = useCallback((fromElapsedMs: number) => {
        if (timerRef.current) return;
        startRef.current = Date.now() - fromElapsedMs;
        hasStartedRef.current = true;
        timerRef.current = setInterval(() => {
            if (startRef.current !== null) {
                const ms = Date.now() - startRef.current;
                pausedElapsedRef.current = ms;
                setElapsedMs(ms);
            }
        }, 500);
    }, []);

    // Temporary pause (tab hidden / navigating away, board still resumable):
    // freezes elapsed time instead of letting it keep advancing with the wall
    // clock while backgrounded.
    const pauseTimer = useCallback(() => {
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
        if (startRef.current !== null) {
            const ms = Date.now() - startRef.current;
            pausedElapsedRef.current = ms;
            setElapsedMs(ms);
            startRef.current = null;
        }
    }, []);

    const resumeTimer = useCallback(() => {
        if (!hasStartedRef.current) return; // never interacted yet — nothing to resume
        if (startRef.current !== null) return; // already ticking
        startTicking(pausedElapsedRef.current);
    }, [startTicking]);

    // Always-fresh snapshot of state a background listener might need to read
    // without a stale closure — updated after every render (no dep array).
    const latestStateRef = useRef<{
        phase: Phase;
        data: WordSearchResponse | null;
        found: Set<string>;
        hintUnits: number;
        hintEntryKey: string | null;
        hintRevealCount: number;
        hintLocationRevealed: boolean;
    }>({
        phase: "loading",
        data: null,
        found: new Set(),
        hintUnits: 0,
        hintEntryKey: null,
        hintRevealCount: 0,
        hintLocationRevealed: false,
    });
    useEffect(() => {
        latestStateRef.current = { phase, data, found, hintUnits, hintEntryKey, hintRevealCount, hintLocationRevealed };
    });

    // Snapshot the current board to localStorage — no-op unless a board is
    // actually in progress and unfinished. Reads elapsed time directly off
    // startRef/pausedElapsedRef (not the `elapsedMs` state) so it's accurate
    // even mid-tick, not lagged by up to one 500ms interval step.
    const persistSnapshot = useCallback(() => {
        if (!userId || !mode) return;
        const s = latestStateRef.current;
        if (s.phase !== "playing" || !s.data || !s.data.grid) return;
        if (s.found.size >= s.data.words.length) return;
        const elapsedNow = startRef.current !== null ? Date.now() - startRef.current : pausedElapsedRef.current;
        saveGameState(userId, {
            mode,
            data: s.data,
            found: [...s.found],
            elapsedMs: elapsedNow,
            timerStarted: hasStartedRef.current,
            hintUnits: s.hintUnits,
            hintEntryKey: s.hintEntryKey,
            hintRevealCount: s.hintRevealCount,
            hintLocationRevealed: s.hintLocationRevealed,
            rewardedBonusWords: [...rewardedBonusWordsRef.current],
        });
    }, [userId, mode]);

    // Fetch a fresh randomized grid. Returns the payload, or null after switching
    // to the blocked phase (insufficient cards / wrong language / network error).
    const fetchGrid = useCallback(async (): Promise<WordSearchResponse | null> => {
        try {
            // `mode` steers the server's per-type cooldown filter: No-Pinyin gates
            // on the reading track, Pinyin on production (docs/MASTERY_REWORK.md
            // § Per-type cooldown). `mode` is set once on mount, so capturing it in
            // this empty-deps callback is stable.
            const res = await fetch(`${API_BASE_URL}/api/onDeck/word-search-grid?${GRID_QUERY}&mode=${mode ?? ""}`, {
                credentials: "include",
                headers: authHeader(),
            });
            if (!res.ok) throw new Error("Failed to load grid");
            const payload: WordSearchResponse = await res.json();

            if (!payload.sufficient || !payload.grid) {
                if (payload.reason === "language") {
                    setBlockMessage(
                        "Word Search is available for Chinese right now. Switch your study language to Chinese to play."
                    );
                } else {
                    setBlockMessage(
                        `You need at least ${payload.total} Learn Now cards with distinct characters to play Word Search. Study more cards to unlock it.`
                    );
                }
                setPhase("blocked");
                return null;
            }
            if (payload.templateIndex != null) {
                console.log(`[word-search] used template #${payload.templateIndex}`);
            } else {
                console.log("[word-search] used random generation");
            }

            // Warm TTS for every target so the found-word narration is instant.
            payload.words.forEach((w) =>
                tts.prefetchSentence(w.entryKey, w.pinyin)
            );
            return payload;
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

    // Load a fresh board and drop into play (resetting found state, then
    // starting the count-up timer immediately — the player doesn't need to
    // touch the grid first).
    const startBoard = useCallback((payload: WordSearchResponse) => {
        setData(payload);
        setFound(new Set());
        setHintUnits(0);
        setHintEntryKey(null);
        setHintRevealCount(0);
        setHintLocationRevealed(false);
        setHintShakeNonce(0);
        rewardedBonusWordsRef.current = new Set();
        setElapsedMs(0);
        setFinalMs(0);
        setPopupMinimized(false);
        startRef.current = null;
        pausedElapsedRef.current = 0;
        hasStartedRef.current = false;
        stopTimer();
        setPhase("playing");
        startTicking(0);
    }, [stopTimer, startTicking]);

    // Restore a previously saved board in place of fetching a new one — same
    // end state as startBoard, but seeded from a SavedWordSearchState instead
    // of a fresh server payload. Always resumes ticking from the saved
    // elapsed time, even if the timer had never been started when the board
    // was saved (older snapshots) — the timer now always runs while playing.
    const restoreBoard = useCallback((saved: SavedWordSearchState) => {
        setData(saved.data);
        setFound(new Set(saved.found));
        setHintUnits(saved.hintUnits);
        setHintEntryKey(saved.hintEntryKey);
        setHintRevealCount(saved.hintRevealCount);
        setHintLocationRevealed(saved.hintLocationRevealed);
        setHintShakeNonce(0);
        rewardedBonusWordsRef.current = new Set(saved.rewardedBonusWords);
        setFinalMs(0);
        setPopupMinimized(false);
        stopTimer();
        pausedElapsedRef.current = saved.elapsedMs;
        setElapsedMs(saved.elapsedMs);
        startTicking(saved.elapsedMs);
        // Re-warm TTS for the restored targets.
        saved.data.words.forEach((w) => tts.prefetchSentence(w.entryKey, w.pinyin));
        setPhase("playing");
        // tts.prefetchSentence is stable; only re-create on auth change.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [stopTimer, startTicking]);

    // Initial load, once per authenticated session: resume a saved board if one
    // exists, else fetch a new one. Keyed on the STABLE auth identity (`user?.id`),
    // NOT `token`: the access token silently refreshes every ~15 min, and re-running
    // this effect on that refresh would reload a brand-new board and wipe the
    // in-progress game (found words + timer). See the "Never reload on token
    // refresh" rule in CLAUDE.md. `fetchGrid`/`startBoard`/`restoreBoard` are
    // deliberately omitted from the deps for the same reason.
    useEffect(() => {
        if (!mode) return; // no mode → the redirect effect handles it
        if (!userId) {
            setBlockMessage("Sign in to play Word Search.");
            setPhase("blocked");
            return;
        }
        let cancelled = false;
        (async () => {
            // Resume card → restore the single saved board (in its saved mode).
            // Mode button → always a fresh board; any existing save is discarded
            // by the hub's confirm flow before we get here, and starting fresh
            // (then re-saving on exit) overwrites the slot anyway.
            if (resumeIntent) {
                const saved = loadGameState(userId);
                if (saved) {
                    if (!cancelled) restoreBoard(saved);
                    return;
                }
                // Save vanished between hub and here — fall through to fresh.
            }
            const payload = await fetchGrid();
            if (cancelled || !payload) return;
            startBoard(payload);
        })();
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id]);

    // Pause on backgrounding (tab hidden / app switched away), resume on
    // return — snapshot to localStorage first so a background pause that
    // never comes back (tab closed while hidden) still isn't lost.
    useEffect(() => {
        if (phase !== "playing") return;
        const handleVisibility = () => {
            if (document.hidden) {
                persistSnapshot();
                pauseTimer();
            } else {
                resumeTimer();
            }
        };
        document.addEventListener("visibilitychange", handleVisibility);
        return () => document.removeEventListener("visibilitychange", handleVisibility);
    }, [phase, persistSnapshot, pauseTimer, resumeTimer]);

    // Keep the single saved slot continuously in sync while playing — not just
    // on exit/background. Two reasons: (1) a hard crash keeps progress, and
    // (2) the Games hub reads the save during ITS OWN render when you navigate
    // back, which — for the same back-transition — happens BEFORE this page's
    // unmount save would run; without an already-written save the resume card
    // wouldn't appear until the next hub visit. Keyed on `found` (a new Set each
    // find), NOT the 500ms `elapsedMs` tick, to avoid a write every half-second;
    // persistSnapshot reads the live elapsed off startRef, so the saved time is
    // still current at each write. No-ops once the board is complete (its guard).
    useEffect(() => {
        if (phase === "playing") persistSnapshot();
    }, [phase, found, persistSnapshot]);

    // Safety net for a hard close/refresh (visibilitychange won't fire for these).
    useEffect(() => {
        if (phase !== "playing") return;
        const handleUnload = () => persistSnapshot();
        window.addEventListener("beforeunload", handleUnload);
        return () => window.removeEventListener("beforeunload", handleUnload);
    }, [phase, persistSnapshot]);

    // Exiting the page (the leaf-page back arrow, or any other unmount) saves
    // the board the same way backgrounding does.
    useEffect(() => {
        return () => {
            persistSnapshot();
            stopTimer();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // The timer now starts as soon as the board loads (see startBoard /
    // restoreBoard); this handler only needs to unlock audio inside the real
    // pointer gesture so the first find narrates.
    const handleFirstInteraction = useCallback(() => {
        tts.unlockAudio();
    }, [tts]);

    // Log one Word Search completion (fire-and-forget), mirroring Bubble Match.
    const recordWin = useCallback(() => {
        const headers: HeadersInit = { "Content-Type": "application/json" };
        if (token && token !== "null" && token !== "undefined") {
            headers["Authorization"] = `Bearer ${token}`;
        }
        fetch(`${API_BASE_URL}/api/users/me/wins`, {
            method: "POST",
            headers,
            credentials: "include",
            body: JSON.stringify({ game: GAME_KEY, level: 1 }),
        }).catch((err) => console.error("[WordSearch] win record failed:", err));
    }, [token]);

    // Record a flashcard review mark for a found word's vet entry, reusing the
    // same endpoint flp's working loop and Bubble Match call. Fire-and-forget:
    // the game never blocks on it, and a failure only logs.
    const markWordFound = useCallback((word: PlacedWord) => {
        const headers: HeadersInit = { "Content-Type": "application/json" };
        if (token && token !== "null" && token !== "undefined") {
            headers["Authorization"] = `Bearer ${token}`;
        }
        fetch(`${API_BASE_URL}/api/flashcards/mark`, {
            method: "POST",
            headers,
            credentials: "include",
            // Board mode decides the mark type (docs/MASTERY_REWORK.md): the "Pinyin"
            // board is a production drill; the "No Pinyin" board is a reading drill
            // (recognizing the characters without the pinyin crutch). Word Search only
            // ever emits POSITIVE marks — a found word is a correct answer.
            // excludeIds empty: the game doesn't use the replacement card the
            // endpoint returns, so there's nothing to dedupe against.
            body: JSON.stringify({
                cardId: word.id,
                isCorrect: true,
                type: mode === "no-pinyin" ? "reading" : "production",
                excludeIds: [],
            }),
        }).catch((err) => console.error(`[WordSearch] mark failed → card ${word.id}:`, err));
    }, [token, mode]);

    // Play a word's narration (guarded by the TTS enabled flag). Shared by the
    // find-time play below and the grid's tap-to-replay / blue-match plays; the
    // CloudTTSProvider caches the decoded buffer, so repeats within a game are
    // instant and only the first play hits the server.
    const speakWord = useCallback((entryKey: string, pinyin: string) => {
        if (tts.enabled) tts.speakSentence(entryKey, pinyin);
    }, [tts]);

    const onFound = useCallback((word: PlacedWord) => {
        speakWord(word.entryKey, word.pinyin);
        markWordFound(word);
        setFound((prev) => {
            const next = new Set(prev);
            next.add(word.entryKey);
            return next;
        });
        // Reward the successful query with one hint unit (capped at the bar size).
        setHintUnits((u) => Math.min(HINT_BAR_UNITS, u + 1));
        // If the player found the word we were hinting, clear the row (and the
        // grid's yellow location reveal, if it got that far) back to blank.
        if (hintEntryKey === word.entryKey) {
            setHintEntryKey(null);
            setHintRevealCount(0);
            setHintLocationRevealed(false);
        }
    }, [speakWord, markWordFound, hintEntryKey]);

    // The first multi-character bonus word ("blue match") found on a board
    // awards one hint unit, one time only — see WordSearchGrid's onBonusFound.
    const onBonusFound = useCallback((bonus: BonusWord) => {
        if (rewardedBonusWordsRef.current.has(bonus.entryKey)) return;
        rewardedBonusWordsRef.current.add(bonus.entryKey);
        setHintUnits((u) => Math.min(HINT_BAR_UNITS, u + 1));
    }, []);

    // Pressing hint is "usable" if the currently-hinted word's location is
    // already revealed (re-shaking it is FREE — see useHint), or if there are
    // spare units and any word is still unfound.
    const canUseHint = useCallback((): boolean => {
        if (!data) return false;
        const current = data.words.find((w) => w.entryKey === hintEntryKey);
        if (hintLocationRevealed && current && !found.has(current.entryKey)) return true;
        if (hintUnits < HINT_COST) return false;
        return data.words.some((w) => !found.has(w.entryKey));
    }, [data, hintEntryKey, hintLocationRevealed, hintUnits, found]);

    // Spend a hint:
    // - Current hinted word already has its LOCATION revealed (fully spelled
    //   out and nagged once before): re-shake it for FREE, no unit cost — the
    //   player has already paid for this reveal, so repeat presses are just a
    //   "where was that again?" nudge, not a new hint.
    // - Current hinted word still unfound, pinyin units left to reveal: drain
    //   HINT_COST and reveal one more.
    // - Current hinted word still unfound, fully spelled out for the first
    //   time: drain HINT_COST, lock onto it, and reveal its actual grid
    //   location in yellow (persists until found).
    // - No active hint, or the active word was just found: drain HINT_COST,
    //   pick a new random unfound word, and reveal its first unit.
    const useHint = useCallback(() => {
        if (!data) return;
        const current = data.words.find((w) => w.entryKey === hintEntryKey);
        if (current && !found.has(current.entryKey)) {
            if (hintLocationRevealed) {
                setHintShakeNonce((n) => n + 1);
                return;
            }
            if (hintUnits < HINT_COST) return;
            if (hintRevealCount < countPinyinUnits(current.pinyin)) {
                setHintRevealCount((c) => c + 1);
            } else {
                setHintLocationRevealed(true);
                setHintShakeNonce((n) => n + 1);
            }
            setHintUnits((u) => u - HINT_COST);
            return;
        }
        if (hintUnits < HINT_COST) return;
        const unfound = data.words.filter((w) => !found.has(w.entryKey));
        if (unfound.length === 0) return;
        const pick = unfound[Math.floor(Math.random() * unfound.length)];
        setHintEntryKey(pick.entryKey);
        setHintRevealCount(1);
        setHintLocationRevealed(false);
        setHintUnits((u) => u - HINT_COST);
    }, [data, hintUnits, hintEntryKey, hintRevealCount, hintLocationRevealed, found]);

    // Win when every target is found. Freeze the timer, capture the final time.
    useEffect(() => {
        if (phase !== "playing" || !data) return;
        if (found.size >= data.words.length && data.words.length > 0) {
            stopTimer();
            const ms = startRef.current ? Date.now() - startRef.current : elapsedMs;
            setFinalMs(ms);
            setPopupMinimized(false);
            recordWin();
            if (userId) clearGameState(userId);
            setPhase("won");
        }
    }, [found, phase, data, elapsedMs, stopTimer, recordWin, userId]);

    // Discard the current board (win-screen "Play Again", or the header
    // restart button mid-game) and load a fresh one.
    const resetBoard = useCallback(async () => {
        if (userId) clearGameState(userId);
        tts.unlockAudio();
        setPhase("loading");
        const payload = await fetchGrid();
        if (!payload) return; // fetchGrid already switched to blocked
        startBoard(payload);
    }, [tts, fetchGrid, startBoard, userId]);

    const renderCentered = (children: React.ReactNode) => (
        <Box
            className="word-search__overlay"
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

    let content: React.ReactNode = null;

    if (phase === "loading") {
        content = renderCentered(<DelayedCircularProgress className="word-search__spinner" />);
    } else if (phase === "blocked") {
        content = renderCentered(
            <>
                <Typography className="word-search__block-msg" sx={{ fontSize: SIZE.subtitle, color: fc.onSurface, lineHeight: LEADING.normal }}>
                    {blockMessage}
                </Typography>
                <Button className="word-search__block-back" variant="contained" onClick={() => navigate("/games")}>
                    Back to Games
                </Button>
            </>
        );
    } else if ((phase === "playing" || phase === "won") && data && data.grid) {
        const medal = medalForTime(Math.floor((phase === "won" ? finalMs : elapsedMs) / 1000));
        content = (
            <Box
                className="word-search__content"
                onPointerDown={handleBackgroundPointerDown}
                sx={{
                    position: "relative",
                    flex: 1,
                    minHeight: 0,
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                    userSelect: "none",
                    WebkitUserSelect: "none",
                }}
            >
                {/* HUD row above the glosses: count-up timer flush-left, found
                    count flush-right. The timer's text is hidden when the header's
                    timer toggle is off, but the clock keeps ticking. */}
                <Box
                    className="word-search__hud"
                    sx={{ position: "relative", display: "flex", justifyContent: "space-between", alignItems: "baseline", px: 1.5, pt: 0.75 }}
                >
                    <Typography
                        className="word-search__hud-timer"
                        sx={{ fontSize: SIZE.body, fontWeight: WEIGHT.bold, color: "#6b6b6b", lineHeight: 1.25 }}
                    >
                        {showTimer ? `⏱ ${formatTimeMs(phase === "won" ? finalMs : elapsedMs)}` : ""}
                    </Typography>
                    {/* Hint meter: fills on finds, arms at HINT_COST. Positioned
                        absolutely (not a flex sibling) so toggling the timer's
                        visibility off — which shrinks the timer Typography — can't
                        shift it via space-between. */}
                    <Box
                        sx={{
                            position: "absolute",
                            left: "50%",
                            top: "50%",
                            transform: "translate(-50%, -50%)",
                        }}
                    >
                        <WordSearchHintBar units={hintUnits} />
                    </Box>
                    <Typography
                        className="word-search__hud-count"
                        sx={{ fontSize: SIZE.body, fontWeight: WEIGHT.bold, color: "#6b6b6b", lineHeight: 1.25 }}
                    >
                        {found.size}/{data.words.length}
                    </Typography>
                </Box>
                <WordSearchWordList words={data.words} found={found} hintedEntryKey={hintEntryKey} />

                <WordSearchHintRow
                    word={data.words.find((w) => w.entryKey === hintEntryKey) ?? null}
                    revealCount={hintRevealCount}
                />

                <WordSearchGrid
                    ref={gridRef}
                    grid={data.grid}
                    words={data.words}
                    found={found}
                    bonusWords={data.bonusWords}
                    showPinyin={showPinyin}
                    showPinyinColor={showPinyinColor}
                    hintedWord={hintLocationRevealed ? data.words.find((w) => w.entryKey === hintEntryKey) ?? null : null}
                    hintShakeNonce={hintShakeNonce}
                    onFound={onFound}
                    onBonusFound={onBonusFound}
                    onFirstInteraction={handleFirstInteraction}
                    speak={speakWord}
                />

                {phase === "won" && (
                    <GameEndPopup
                        classPrefix="word-search"
                        minimized={popupMinimized}
                        onMinimize={() => setPopupMinimized(true)}
                        onRestore={() => setPopupMinimized(false)}
                    >
                        <Typography className="word-search__win-title" sx={{ fontSize: SIZE.heading, fontWeight: WEIGHT.bold, color: fc.onSurface }}>
                            {medal.emoji} All {TOTAL_WORDS} found!
                        </Typography>
                        <Typography className="word-search__win-time" sx={{ fontSize: SIZE.bodyLg, color: fc.textSecondary }}>
                            Time {formatTimeMs(finalMs)} — {medal.medal} medal
                        </Typography>
                        <Box className="word-search__win-actions" sx={{ display: "flex", flexDirection: "column", gap: 1.5, width: "100%", maxWidth: 260 }}>
                            <Button className="word-search__play-again" variant="contained" onClick={resetBoard} sx={{ borderRadius: "12px", textTransform: "none", fontWeight: WEIGHT.bold }}>
                                Play Again
                            </Button>
                            <Button className="word-search__back-to-games" variant="outlined" onClick={() => navigate("/games")} sx={{ borderRadius: "12px", textTransform: "none" }}>
                                Back to Games
                            </Button>
                        </Box>
                    </GameEndPopup>
                )}
            </Box>
        );
    }

    return (
        <>
            <LeafPage
                title="Word Search"
                onBack={() => navigate("/games")}
                rightContent={
                    <WordSearchHeaderControls
                        hintReady={phase === "playing" && canUseHint()}
                        onHint={useHint}
                        onRestart={resetBoard}
                        onSettingsClick={() => setSettingsOpen(true)}
                    />
                }
            >
                {content}
            </LeafPage>
            <WordSearchSettingsDialog
                open={settingsOpen}
                onClose={() => setSettingsOpen(false)}
                showTimer={showTimer}
                onToggleShowTimer={(v) => updateWsSettings({ showTimer: v })}
            />
        </>
    );
};

export default WordSearchPage;
