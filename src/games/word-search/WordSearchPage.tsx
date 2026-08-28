import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Box, Button, Typography, useTheme } from "@mui/material";
import DelayedCircularProgress from "../../components/DelayedCircularProgress";
import { useAuth } from "../../AuthContext";
import { API_BASE_URL } from "../../constants";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useTTS } from "../../hooks/useTTS";
import { useBlockEdgeSwipe } from "../../hooks/useBlockEdgeSwipe";
import { useGameWins } from "../../hooks/useGameWins";
import { markFlashcard } from "../../api/flashcards";
import { authHeader } from "../../utils/authHeader";
import { useLaunchCollection } from "../../features/flashcards/useLaunchCollection";
import { collectionQuerySuffix } from "../../features/flashcards/collectionRef";
import { GameLeafPage } from "../shared/GameSurface";
// The game's accent hue — one constant drives its hub row and its own ground (§ A6b).
import { GAME_HUE } from "./constants";
import { SIZE, WEIGHT, LEADING } from "../../theme/scale";
import WordSearchHeaderControls from "./WordSearchHeader";
import WordSearchSettingsDialog from "./WordSearchSettingsDialog";
import WordSearchWordList from "./WordSearchWordList";
import WordSearchHintRow from "./WordSearchHintRow";
import WordSearchGrid, { type WordSearchGridHandle } from "./WordSearchGrid";
import WordSearchHintBar from "./WordSearchHintBar";
import { GameCentered, GameFrame, GameHud, GameHudLabel } from "../shared/GameFrame";
import { Label } from "../../components/primitives";
import GameEndPopup from "../runtime/GameEndPopup";
import { useWordSearchSettings } from "./useWordSearchSettings";
import { saveGameState, loadGameState, clearGameState, type SavedWordSearchState } from "./gameStateStorage";
import { GAME_KEY, WIN_LEVEL, GRID_QUERY, HINT_BAR_UNITS, HINT_COST, medalForTime, modeConfigFor, modeMarkTypes } from "./constants";
import type { Language } from "../../types";
import ProvisionalCardsNotice from "../../components/ProvisionalCardsNotice";
import ProvisionalSortOffer from "../../components/ProvisionalSortOffer";
import { useProvisionalSortOffer } from "../../hooks/useProvisionalSortOffer";
import { formatTimeMs } from "../../utils/timeUtils";
import { useChallengeRound } from "../runtime/useChallengeRound";
import ChallengeRoundScoreboard from "../runtime/ChallengeRoundScoreboard";
import { countPinyinRevealSteps } from "./pinyinUnits";
import { countComponentUnits } from "./componentUnits";
import type { BonusWord, PlacedWord, WordSearchResponse } from "./types";

type Phase = "loading" | "blocked" | "playing" | "won";

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
    // Which collection this game was launched from (docs/DECKS_FEATURE.md) — null
    // for an ordinary launch from the Games hub. Appended to every pool request so
    // the round stays inside the set the learner picked.
    const launchCollection = useLaunchCollection();
    const collectionSuffix = collectionQuerySuffix(launchCollection);
    usePageTitle("Word Search");
    const navigate = useNavigate();
    const location = useLocation();
    const [searchParams] = useSearchParams();
    const theme = useTheme();
    const fc = theme.palette.flashcard;
    const { user } = useAuth();
    const userId = user?.id;
    const tts = useTTS();
    const { settings: wsSettings, update: updateWsSettings } = useWordSearchSettings();
    const { showTimer } = wsSettings;
    // Win logging goes through the shared hook (same one Bubble Match and the
    // Games hub use) instead of a hand-rolled POST — one place owns the `wins`
    // endpoint contract and the optimistic local update.
    const { recordWin } = useGameWins(GAME_KEY);

    // The board mode ("pinyin" / "no-pinyin") is chosen on the Games hub (one
    // sub-card each — see GamesPage) and passed in via nav `state.mode`; there's
    // no in-game switch, so it's read once on mount and fixed for the whole run.
    // A direct/stray visit with no valid mode redirects to /games (see the
    // redirect effect below) rather than defaulting. Pinyin, when shown, is
    // always tone-colored — the colorless variant was removed.
    //
    // A challenge round's `?mode=` query param is the fallback: `state` does not
    // survive a reload (challengeLaunch.ts), and without this a mid-round refresh
    // lost `modeConfig` and bounced the player to /games, discarding an in-progress
    // challenge round even though `useChallengeRound` itself reads `challengeId`
    // from the URL and stays active. Only a challenge launch ever sets `?mode=`, so
    // an ordinary hub launch is unaffected.
    const [modeConfig] = useState(() => modeConfigFor(
        (location.state as { mode?: string } | null)?.mode ?? searchParams.get("mode")
    ));
    const mode = modeConfig?.mode;
    const showPinyin = modeConfig?.showPinyin ?? false;
    // Which mastery track(s) a find marks — a property of the chosen mode, not of
    // this page. Empty only in the no-valid-mode case, which redirects to /games.
    // No-Pinyin marks TWO (reading + production); Pinyin marks one. `markTypes[0]` is
    // the mode's primary track — the one the board itself was pooled on.
    const markTypes = useMemo(() => (modeConfig ? modeMarkTypes(modeConfig) : []), [modeConfig]);
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
    /**
     * Backgrounded right now — a MIRROR of the visibility listener below, kept as
     * state purely so the challenge round's active-time clock can see it.
     *
     * Word Search predates the shared `useBackgroundPause` hook and owns its
     * pause/resume directly (it is the reference implementation the other three were
     * generalised from), so there is no `paused` boolean to reuse. Deriving one here
     * keeps the challenge time penalty on ACCUMULATED ACTIVE TIME (§ 5.8) — the −10/s
     * must not run while the app is in the background.
     */
    const [backgrounded, setBackgrounded] = useState(false);
    const [data, setData] = useState<WordSearchResponse | null>(null);
    // Pre-round notice for lent cards (docs/PROVISIONAL_CARDS.md).
    const [noticeOpen, setNoticeOpen] = useState(false);
    const [found, setFound] = useState<Set<string>>(new Set());
    // Whether the end-of-run popup is collapsed into the corner puck.
    const [popupMinimized, setPopupMinimized] = useState(false);
    // Settings sheet (pinyin display + timer visibility), behind the header cog.
    const [settingsOpen, setSettingsOpen] = useState(false);
    const gridRef = useRef<WordSearchGridHandle>(null);

    // Hint meter: each successful find adds a unit (capped at HINT_BAR_UNITS); a
    // hint is spendable once >= HINT_COST units are banked. The hint row is
    // BLANK until the first hint spend. `hintEntryKey` is the one word currently
    // being hinted (or null); `hintRevealCount` is how many reveal steps of that
    // word have been bought, hangman-style — on the Pinyin board the first steps
    // buy each character's letter count in turn and the rest buy phonetic units
    // (see pinyinUnits.ts / WordSearchHintRow's buildMask) — each further hint
    // buys another step of the SAME word until it's found (row clears)
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
    // Every word that has EVER received a hint on this board (any reveal step —
    // pinyin/component units OR the yellow location reveal). Finding one of these
    // does NOT emit a flashcard mark: the player was shown part of the answer, so
    // it isn't evidence of recall and would inflate mastery. A ref, not state,
    // because nothing renders from it — only `markWordFound` reads it.
    const hintedWordsRef = useRef<Set<string>>(new Set());

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

    // ── STUDY CHALLENGE ROUND (docs/STUDY_CHALLENGE.md § 5) ──
    // Word Search is eligible as PINYIN ONLY (No Pinyin is a reading drill, and a
    // challenge round is recognition or production) — the server enforces that by
    // matching the caller's (gameId, mode) against the drawn sequence, so a
    // No-Pinyin launch simply never resolves to a round.
    //
    // `clockPaused` is declared further down, next to the run clock it protects, so
    // the two pause SOURCES are restated here rather than reused: the modal sheets
    // and backgrounding. Both must freeze the −10/s time penalty (§ 5.8).
    const challengeRound = useChallengeRound({
        gameId: "word-search",
        mode: mode ?? null,
        paused: noticeOpen || settingsOpen || backgrounded,
        running: phase === "playing",
    });
    const challengeParamsRef = useRef("");
    challengeParamsRef.current = challengeRound.poolParams;
    // Read inside `persistSnapshot`, whose deps are deliberately minimal.
    const challengeRoundActiveRef = useRef(false);
    challengeRoundActiveRef.current = challengeRound.active;

    // Snapshot the current board to localStorage — no-op unless a board is
    // actually in progress and unfinished. Reads elapsed time directly off
    // startRef/pausedElapsedRef (not the `elapsedMs` state) so it's accurate
    // even mid-tick, not lagged by up to one 500ms interval step.
    const persistSnapshot = useCallback(() => {
        if (!userId || !mode) return;
        // A CHALLENGE ROUND IS NEVER SAVED. The saved slot is offered back as the
        // hub's "Resume" card, which would restore a scored board OUTSIDE its
        // challenge — same grid, no round behind it — and would also overwrite the
        // player's own casual save. The round is instead re-entered from the
        // challenge, which rebuilds the board server-side.
        if (challengeRoundActiveRef.current) return;
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
            hintedWords: [...hintedWordsRef.current],
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
            //
            // An active challenge round's `poolParams` (challengeParamsRef.current)
            // already carries its own `&mode=` (useChallengeRound.ts) — appending
            // ours too would send TWO `mode` keys on the query string. Express's
            // default parser turns duplicate keys into an array, which fails
            // `resolveChallengeRound`'s `typeof req.query.mode === 'string'` check
            // and silently coerces the round's mode to null, mismatching the drawn
            // round and permanently 400ing every challenge Word Search launch
            // (`ValidationError: Round N of this test is not that game`). So the
            // page's own `mode=` is only appended when no challenge round supplies it.
            const ownModeParam = challengeRoundActiveRef.current ? "" : `&mode=${mode ?? ""}`;
            const res = await fetch(`${API_BASE_URL}/api/onDeck/wordSearchGrid?${GRID_QUERY}${ownModeParam}&surface=word-search${collectionSuffix}${challengeParamsRef.current}`, {
                credentials: "include",
                headers: authHeader(),
            });
            if (!res.ok) throw new Error("Failed to load grid");
            const payload: WordSearchResponse = await res.json();

            if (!payload.sufficient || !payload.grid) {
                // The ONLY remaining block is the language one — Word Search is zh-only
                // because a round substitutes single characters, and no amount of card
                // lending changes the player's study language.
                //
                // The old "you need N cards with distinct characters" block is gone: the
                // server now tops the player up to the Word Search baseline and RETRIES
                // the grid with a progressively larger lent pool (see
                // OnDeckVocabController.getWordSearchGrid + PROVISION_RETRY_FACTOR), so
                // reaching here with a non-language reason means the dictionary itself
                // is exhausted. That is a genuine dead end rather than a "study more
                // cards" nudge, so it says so plainly.
                // See docs/PROVISIONAL_CARDS.md § Word Search is the awkward one.
                setBlockMessage(
                    payload.reason === "language"
                        ? "Word Search is available for Chinese right now. Switch your study language to Chinese to play."
                        : "We couldn't build a grid right now — there aren't enough words with distinct characters left. Try another game for now."
                );
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
        // reload on token refresh". `collectionSuffix` is likewise omitted: it comes
        // from this page's own URL, which cannot change without a remount.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Load a fresh board and drop into play (resetting found state, then
    // starting the count-up timer immediately — the player doesn't need to
    // touch the grid first).
    const startBoard = useCallback((payload: WordSearchResponse) => {
        // Word Search plays a fixed, known grid, so the notice names the lent words
        // (docs/PROVISIONAL_CARDS.md).
        setNoticeOpen((payload.provisionalWords?.length ?? 0) > 0);
        setData(payload);
        setFound(new Set());
        setHintUnits(0);
        setHintEntryKey(null);
        setHintRevealCount(0);
        setHintLocationRevealed(false);
        setHintShakeNonce(0);
        rewardedBonusWordsRef.current = new Set();
        hintedWordsRef.current = new Set();
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
        // Older snapshots predate hint-tracking — treat them as "nothing hinted".
        hintedWordsRef.current = new Set(saved.hintedWords ?? []);
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
        // WAIT FOR THE CHALLENGE CONTEXT. The round's contested set arrives with the
        // challenge payload, and a board dealt before it lands would be classified
        // entirely as filler — a round scored at 20 points a card with no way to tell
        // afterwards that it went wrong. `ready` flips once, so this costs an
        // ordinary launch nothing (`active` is false and the guard never fires).
        if (challengeRound.active && !challengeRound.ready) return;
        let cancelled = false;
        (async () => {
            // Resume card → restore the single saved board (in its saved mode).
            // Mode button → always a fresh board; any existing save is discarded
            // by the hub's confirm flow before we get here, and starting fresh
            // (then re-saving on exit) overwrites the slot anyway.
            if (resumeIntent && !challengeRoundActiveRef.current) {
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
    }, [user?.id, challengeRound.active, challengeRound.ready]);

    // A challenge round that cannot be played says so rather than dealing a casual
    // board that scores nothing.
    useEffect(() => {
        if (challengeRound.error) {
            setBlockMessage(challengeRound.error);
            setPhase("blocked");
        }
    }, [challengeRound.error]);

    // ── Popup pause gate ─────────────────────────────────────────────────────
    // No game clock may run while a MODAL popup covers the board. Word Search's
    // clock counts UP and is the run's score, so time spent reading the
    // provisional-cards notice or changing settings would show up as a worse
    // result. Both overlays block input, so a frozen clock can't be used to study
    // the live grid. The in-grid gloss popups are deliberately NOT included: they
    // are small anchored tooltips that leave the board playable, so pausing on
    // them would hand out a free stopwatch stop. Shared rule across all four games
    // — see docs/GAMES_FEATURE.md § Popups pause the clock.
    const clockPaused = noticeOpen || settingsOpen;
    // Read by the visibility listener below, which fires outside React's render
    // and must not resume a clock a popup is still holding.
    const clockPausedRef = useRef(clockPaused);
    clockPausedRef.current = clockPaused;

    useEffect(() => {
        if (phase !== "playing") return;
        if (clockPaused) pauseTimer();
        else resumeTimer();
    }, [phase, clockPaused, pauseTimer, resumeTimer]);

    // Pause on backgrounding (tab hidden / app switched away), resume on
    // return — snapshot to localStorage first so a background pause that
    // never comes back (tab closed while hidden) still isn't lost.
    useEffect(() => {
        if (phase !== "playing") return;
        const handleVisibility = () => {
            setBackgrounded(document.hidden);
            if (document.hidden) {
                persistSnapshot();
                pauseTimer();
            } else if (!clockPausedRef.current) {
                // Coming back to a board with a popup still open leaves the clock
                // paused; the popup's own effect resumes it on dismiss.
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


    // Record a flashcard review mark for a found word's vet entry, reusing the
    // same endpoint flp's working loop and Bubble Match call. Fire-and-forget:
    // the game never blocks on it, and a failure only logs.
    const markWordFound = useCallback((word: PlacedWord) => {
        // A word that was hinted on this board earns NO mark at all (not even a
        // negative one): the reveal handed the player part of the answer, so the
        // find says nothing about recall in either direction. See §5a.
        if (hintedWordsRef.current.has(word.entryKey)) return;
        // Board mode decides the mark type(s) (docs/MASTERY_REWORK.md): the "Pinyin"
        // board is a production drill (the pinyin row is a phonetic crutch), while the
        // "No Pinyin" board is BOTH a reading drill (bare characters) and a production
        // one (the prompt is an English gloss, so finding the word is recall). That
        // mapping lives on the mode's config (`modeMarkTypes`) so the hub's track
        // label and this call can never disagree. Word Search only ever emits POSITIVE
        // marks — a found word is a correct answer.
        //
        // ONE POST PER TRACK, not one post carrying a list: /api/flashcards/mark types
        // exactly one mark per call (it computes a before/after band for the single bar
        // that mark moves), and widening its contract to serve the one surface that
        // wants two would push the multi-track case into every other caller's response
        // shape. Two fire-and-forget posts cost nothing here — this game reads neither
        // the replacement card nor the undo key.
        //
        // Each post is judged on ITS OWN track's cooldown, so the secondary mark may be
        // dropped server-side while the primary lands (see WordSearchModeConfig
        // `extraMarkTypes`). That is intended, and invisible: a suppressed mark is a
        // 200, not an error.
        //
        // excludeIds defaults to []: the game doesn't use the replacement card the
        // endpoint returns, so there's nothing to dedupe against.
        for (const type of markTypes) {
            markFlashcard({
                cardId: word.id,
                isCorrect: true,
                type,
                surface: "word-search",
            }).catch((err) => console.error(`[WordSearch] ${type} mark failed → card ${word.id}:`, err));
        }
        // No `token` dep — markFlashcard reads the header at call time, so this
        // callback's identity is stable across a silent refresh (CLAUDE.md ⛔ rule).
    }, [markTypes]);

    // Play a word's narration. Shared by the find-time play below and the grid's
    // tap-to-replay / blue-match plays; the CloudTTSProvider caches the audio, so
    // repeats within a game are instant and only the first play hits the server.
    // autoSpeakSentence, not speakSentence: the game speaks on its own schedule,
    // so it is gated by the autoplay setting (a grid tap is a game move, not a
    // press of a speaker button).
    const speakWord = useCallback((entryKey: string, pinyin: string) => {
        void tts.autoSpeakSentence(entryKey, pinyin);
    }, [tts]);

    // Stop whatever the grid last asked for. Passed to the grid as `silence` and
    // called on a DESELECTING tap: the narration belongs to the selection, so
    // closing a review popup must also cut a play that is still fetching or still
    // sounding — without this it arrives after the highlight it explained is gone.
    const silenceWord = useCallback(() => {
        tts.cancel();
    }, [tts]);

    const onFound = useCallback((word: PlacedWord) => {
        speakWord(word.entryKey, word.pinyin);
        markWordFound(word);
        // A challenge round scores finds only — there is no "miss" event in Word
        // Search (a drag either spells a word or it does not), which is why its spec
        // charges TIME instead (§ 5.4). Filler reaches a challenge grid whenever a
        // contested word had to be substituted out for sharing characters, and is
        // paid 20 rather than 100 for exactly that reason.
        challengeRound.emit({
            kind: "hit",
            word: word.entryKey,
            contested: challengeRound.isContested(word.entryKey),
        });
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
        // challengeRound's emit/isContested are stable by construction.
        // eslint-disable-next-line react-hooks/exhaustive-deps
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

    // How many reveals the hinted word offers before its location is the only thing
    // left to give. The two boards spend DIFFERENT currencies for the same ladder:
    // the Pinyin board buys each character's letter count first and then spells out
    // phonetic units (countPinyinRevealSteps = chars + units), while the No Pinyin
    // board — which exists to hide exactly that — reveals sub-character component
    // glyphs and then the character itself, per character (see componentUnits.ts).
    // Everything after "fully revealed" (location reveal, then the free re-shake)
    // is shared.
    const totalRevealUnits = useCallback(
        (word: PlacedWord): number =>
            showPinyin
                ? countPinyinRevealSteps(word.pinyin)
                : countComponentUnits(word.entryKey, word.charComponents),
        [showPinyin]
    );

    // Spend a hint:
    // - Current hinted word already has its LOCATION revealed (fully spelled
    //   out and nagged once before): re-shake it for FREE, no unit cost — the
    //   player has already paid for this reveal, so repeat presses are just a
    //   "where was that again?" nudge, not a new hint.
    // - Current hinted word still unfound, reveal units left: drain
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
            hintedWordsRef.current.add(current.entryKey);
            if (hintRevealCount < totalRevealUnits(current)) {
                setHintRevealCount((c) => c + 1);
            } else {
                setHintLocationRevealed(true);
                setHintShakeNonce((n) => n + 1);
            }
            setHintUnits((u) => u - HINT_COST);
            // −20 in a challenge round, per SPEND (§ 5.4). Charged where the units
            // are, so the free re-shake above — which costs no units — costs no
            // points either.
            challengeRound.emit({ kind: "use", ruleId: "hintUsed" });
            return;
        }
        if (hintUnits < HINT_COST) return;
        const unfound = data.words.filter((w) => !found.has(w.entryKey));
        if (unfound.length === 0) return;
        const pick = unfound[Math.floor(Math.random() * unfound.length)];
        hintedWordsRef.current.add(pick.entryKey);
        setHintEntryKey(pick.entryKey);
        setHintRevealCount(1);
        setHintLocationRevealed(false);
        setHintUnits((u) => u - HINT_COST);
        challengeRound.emit({ kind: "use", ruleId: "hintUsed" });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data, hintUnits, hintEntryKey, hintRevealCount, hintLocationRevealed, found, totalRevealUnits]);

    // Win when every target is found. Freeze the timer, capture the final time.
    useEffect(() => {
        if (phase !== "playing" || !data) return;
        if (found.size >= data.words.length && data.words.length > 0) {
            stopTimer();
            const ms = startRef.current ? Date.now() - startRef.current : elapsedMs;
            setFinalMs(ms);
            setPopupMinimized(false);
            // Every completion logs under level 1 — Word Search's two modes
            // deliberately share one wins bucket (see GAME_KEY in ./constants).
            recordWin(WIN_LEVEL);
            if (userId) clearGameState(userId);
            setPhase("won");
            // Word Search's board is always completable, so `won` is always true —
            // it exists for the all-or-nothing survival bonus other games have.
            challengeRound.finish(true);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [found, phase, data, elapsedMs, stopTimer, recordWin, userId]);

    // Discard the current board and load a fresh one. Only reachable from the
    // win screen's "Play Again" now — the header restart button was removed, so
    // a board in progress can no longer be thrown away mid-game.
    const resetBoard = useCallback(async () => {
        if (userId) clearGameState(userId);
        tts.unlockAudio();
        setPhase("loading");
        const payload = await fetchGrid();
        if (!payload) return; // fetchGrid already switched to blocked
        startBoard(payload);
    }, [tts, fetchGrid, startBoard, userId]);

    // The centred column shown INSTEAD of the board (spinner, or the blocked
    // message). The shape is shared — `GameCentered` also owns the rule that text on
    // the accent ground is white — so this is only the page's class name for it.
    const renderCentered = (children: React.ReactNode) => (
        <GameCentered className="word-search__overlay">{children}</GameCentered>
    );

    // End-of-run offer to keep the lent cards; opens a beat after the win popup.
    const sortOffer = useProvisionalSortOffer(phase === "won", data?.provisionalWords ?? []);

    let content: React.ReactNode = null;

    if (phase === "loading") {
        content = renderCentered(<DelayedCircularProgress className="word-search__spinner" />);
    } else if (phase === "blocked") {
        content = renderCentered(
            <>
                <Typography className="word-search__block-msg" sx={{ fontSize: SIZE.subtitle, lineHeight: LEADING.normal }}>
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
                {/* `.play` — the inset panel holding the whole board stack
                    (docs/SHELF_REDESIGN.md § A6). The win popup and the sort offer stay
                    OUTSIDE it: both cover the full content area and must not be clipped
                    by the panel's radius. */}
                <GameFrame className="word-search__frame">
                {/* HUD: what this board IS on the left, how it is going on the right,
                    the clock in the middle.

                    The MODE is stated, not offered — it is fixed by which hub entry the
                    run was launched from, so there is nothing to toggle (artboard 13
                    draws a `pinyin` chip in the header; that would be a second statement
                    of the same fact, and a chip that looks like a switch but is not).

                    The clock is the MIDDLE child, and that placement is load-bearing.
                    It is the one element that can vanish (the settings sheet hides it),
                    and under `space-between` only a middle child can be removed without
                    moving anything else — the old layout had the clock first and had to
                    position the hint meter absolutely to stop it drifting. */}
                <GameHud className="word-search__hud">
                    {/* No Pinyin's label ("NO PINYIN · READING & PRODUCTION") is long enough
                        to overflow the HUD row and clip the timer/found-count off the edge
                        of GameFrame's `overflow:hidden` panel — this is the one HUD fact
                        allowed to truncate, so those two stay fully visible. */}
                    <GameHudLabel
                        className="word-search__hud-mode"
                        sx={{ minWidth: 0, flexShrink: 1, overflow: "hidden", textOverflow: "ellipsis" }}
                    >
                        {modeConfig?.label ?? "Word Search"} · {markTypes.join(" & ") || "recognition"}
                    </GameHudLabel>
                    {showTimer && (
                        <GameHudLabel className="word-search__hud-timer">
                            {formatTimeMs(phase === "won" ? finalMs : elapsedMs)}
                        </GameHudLabel>
                    )}
                    <GameHudLabel className="word-search__hud-count">
                        {found.size} of {data.words.length} found
                    </GameHudLabel>
                </GameHud>

                {/* The hint mechanic, whole, on one row: press · charges · reveal. */}
                <WordSearchHintBar
                    units={hintUnits}
                    ready={phase === "playing" && canUseHint()}
                    onHint={useHint}
                >
                    <WordSearchHintRow
                        word={data.words.find((w) => w.entryKey === hintEntryKey) ?? null}
                        revealCount={hintRevealCount}
                        currency={showPinyin ? "pinyin" : "components"}
                    />
                </WordSearchHintBar>

                {/* `.shelfhd` — names the list under it and states the gesture. The
                    gesture line is the only place the app ever says "trace"; a
                    first-time player otherwise has to discover that tapping does
                    nothing. */}
                <Box
                    className="word-search__list-header"
                    sx={{
                        flexShrink: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "12px",
                        padding: "11px 15px 0",
                    }}
                >
                    <Label>Find these words</Label>
                    <Label>trace to select</Label>
                </Box>

                <WordSearchWordList words={data.words} found={found} hintEntryKey={hintEntryKey} />

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
                    silence={silenceWord}
                />
                </GameFrame>

                {/* A challenge round ends on the scoreboard (§ 5.5) — points, not a
                    time medal, and no Play Again: the round is final (§ 5.1a). */}
                {phase === "won" && challengeRound.active && (
                    <ChallengeRoundScoreboard round={challengeRound} classPrefix="word-search" />
                )}

                {phase === "won" && !challengeRound.active && (
                    <GameEndPopup
                        classPrefix="word-search"
                        minimized={popupMinimized}
                        onMinimize={() => setPopupMinimized(true)}
                        onRestore={() => setPopupMinimized(false)}
                    >
                        <Typography className="word-search__win-title" sx={{ fontSize: SIZE.heading, fontWeight: WEIGHT.bold, color: fc.onSurface }}>
                            {medal.emoji} All {data.words.length} found!
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

                {/* Opens a beat after the win popup and stacks over it, collapsing to
                    the opposite corner. Renders nothing unless this grid used lent cards. */}
                <ProvisionalSortOffer
                    open={sortOffer.open}
                    words={data?.provisionalWords ?? []}
                    language={(user?.selectedLanguage ?? "zh") as Language}
                    onDismiss={sortOffer.dismiss}
                    minimized={sortOffer.minimized}
                    onMinimize={sortOffer.onMinimize}
                    onRestore={sortOffer.onRestore}
                />
            </Box>
        );
    }

    return (
        <>
            <ProvisionalCardsNotice
                open={noticeOpen}
                onDismiss={() => setNoticeOpen(false)}
                surfaceName="Word Search"
                words={data?.provisionalWords ?? []}
                language={(user?.selectedLanguage ?? "zh") as Language}
            />
            <GameLeafPage
            hue={GAME_HUE}
                title="Word Search"
                // Back lands where the player came FROM — the challenge mid-test, or
                // the Games hub for an ordinary run.
                onBack={() => navigate(challengeRound.challengeId
                    ? `/friends/challenges/${challengeRound.challengeId}`
                    : "/games")}
                rightContent={
                    <WordSearchHeaderControls onSettingsClick={() => setSettingsOpen(true)} />
                }
            >
                {content}
            </GameLeafPage>
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
