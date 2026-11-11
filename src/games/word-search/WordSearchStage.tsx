import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { Box, Button, Typography } from "@mui/material";
import DelayedCircularProgress from "../../components/DelayedCircularProgress";
import { useAuth } from "../../AuthContext";
import { useTTS } from "../../hooks/useTTS";
import { useGameWins } from "../../hooks/useGameWins";
import { markFlashcard } from "../../api/flashcards";
import { fetchWordSearchGrid } from "../../api/wordSearchGrid";
import { SIZE, LEADING } from "../../theme/scale";
import WordSearchWordList from "./WordSearchWordList";
import WordSearchHintRow from "./WordSearchHintRow";
import WordSearchGrid, { type WordSearchGridHandle } from "./WordSearchGrid";
import WordSearchHintBar from "./WordSearchHintBar";
import { GameCentered, GameFrame } from "../shared/GameFrame";
import { GameCountdown } from "../shared/GameCountdown";
import { useGameCountdown } from "../shared/useGameCountdown";
import { boardNaturalHeight } from "./boardMetrics";
import { useGridScreenAnchor } from "./useGridScreenAnchor";
import { GAME_FRAME_EXIT_ARROW_BOTTOM_PX } from "../shared/gameFrameExit";
import { usePersonalBest } from "../shared/usePersonalBest";
import { wordSearchGridRequest } from "./gridRequest";
import type { GameStageFrameProps, GameStageHost } from "../types";
import type { FlpBreakResults } from "../flpBreak/types";
import { saveGameState, loadGameState, clearGameState, type SavedWordSearchState } from "./gameStateStorage";
import {
    BOARD_CELL_SIZE,
    GAME_KEY,
    GRID_EDGE_PX,
    WIN_LEVEL,
    modeMarkTypes,
    personalBestMode,
    runResultScore,
    runResultTiers,
    runResultTitle,
    type WordSearchModeConfig,
} from "./constants";
import type { Language } from "../../types";
import type { WordSearchBoardId } from "../../../server/contracts/wire";
import ProvisionalCardsNotice from "../../components/ProvisionalCardsNotice";
import ProvisionalSortOffer from "../../components/ProvisionalSortOffer";
import { useProvisionalSortOffer } from "../../hooks/useProvisionalSortOffer";
import { useChallengeRound } from "../runtime/useChallengeRound";
import { useGameBack } from "../runtime/useGameBack";
import ChallengeRoundScoreboard from "../runtime/ChallengeRoundScoreboard";
import { useRunClock } from "./useRunClock";
import { useWordSearchHints } from "./useWordSearchHints";
import type { PlacedWord, WordSearchResponse } from "./types";

/** `left`: an flp break's Leave ended the run short; it has no finish time and no tiers. */
type Phase = "loading" | "blocked" | "playing" | "won" | "left";

export interface WordSearchStageProps {
    /** Who is hosting this run (docs/FLP_GAME_BREAKS.md § 6). */
    host: GameStageHost;
    /** The host's chrome — `GameLeafPage` on the route, `GameBreakFrame` in the flp. */
    Frame: ComponentType<GameStageFrameProps>;
    /** Header controls, passed through to `Frame`. */
    headerRight?: ReactNode;
    /** The board mode: the hub's sub-card, or the flp bar's (docs/FLP_GAME_BREAKS.md § 3).
        Fixed for the Stage's lifetime. */
    modeConfig: WordSearchModeConfig;
    /** The grid this run deals on. Default `standard` (the route); an flp break plays
        `compact` (flpBreak/wordSearchBreak.ts → WORD_SEARCH_BREAK_BOARD). */
    board?: WordSearchBoardId;
    /** Page host only: restore this mode's saved board instead of dealing a new one. */
    resume?: boolean;
    /** flp break only: the working loop to seed the board with (§ 4). */
    seedIds?: number[];
    /** flp break only: the board, already fetched while card 10 was on screen, so Play
        has no spinner. Read by the first deal only. */
    prefetchedBoard?: WordSearchResponse | null;
    /** Close with no results to show: "Back to …" (page), or a break that never dealt. */
    onDone: () => void;
    /** The destination `onDone` names, for "Back to …". */
    doneLabel: string;
    /** flp break only: FlpBreakStageProps `onRunEnded`. */
    onRunEnded?: (results: FlpBreakResults) => void;
    /** flp break only: FlpBreakStageProps `onCardCleared`. */
    onCardCleared?: (cardId: number) => void;
}

/**
 * Word Search — the STAGE: flow state machine, board supply, hints, marks and the clock,
 * hosted either by `WordSearchPage` (the game's own route) or by an flp game break
 * (src/games/flpBreak/wordSearchBreak.ts, docs/FLP_GAME_BREAKS.md § 6).
 *
 * What differs by host is deliberately small:
 *   - the chrome (`Frame`);
 *   - the opening board (a break seeds it with the working loop, prefetched);
 *   - the save slot: a break NEVER touches it, because that slot holds the board parked
 *     on the Games hub, and a break's board has no way back (see `persistSnapshot`);
 *   - the results: a break hands them to the flp's card (`onRunEnded`). The page has no
 *     end card any more (its win popup and Play Again were deleted 2026-11-10, with the
 *     medals); the routed page is behind the OFF `standaloneGames` flag
 *     (docs/DEFERRED_WORK.md);
 *   - the way out: the page's Back is `useGameBack`; a break's Leave ENDS a live run into
 *     its results card and closes the break from any other phase.
 *
 * Flow: loading → (blocked | playing → won). One relaxed mode: a count-up clock runs
 * out of sight from the deal until every word is found, and the finish time earns a
 * speed tier (see docs/WORD_SEARCH_GAME.md §5).
 *
 * Pause/resume (§5b): the board + timer + hint state are snapshotted to
 * localStorage (gameStateStorage.ts) whenever the tab is backgrounded or the
 * page unmounts, and restored on the next mount instead of fetching a fresh
 * board — see `persistSnapshot` / `restoreBoard` below.
 */
const WordSearchStage: React.FC<WordSearchStageProps> = ({
    host,
    Frame,
    headerRight,
    modeConfig,
    board = "standard",
    resume: resumeIntent = false,
    seedIds,
    prefetchedBoard,
    onDone,
    doneLabel,
    onRunEnded,
    onCardCleared,
}) => {
    const isBreak = host === "flpBreak";
    // Read through a ref: `markWordFound` is deliberately stable.
    const onCardClearedRef = useRef(onCardCleared);
    onCardClearedRef.current = onCardCleared;
    const { user } = useAuth();
    const userId = user?.id;
    const tts = useTTS();
    // Win logging goes through the shared hook (same one Bubble Match and the
    // Games hub use) instead of a hand-rolled POST — one place owns the `wins`
    // endpoint contract and the optimistic local update.
    const { recordWin } = useGameWins(GAME_KEY);

    // The board mode ("pinyin" / "no-pinyin") is fixed for the whole run: there's no
    // in-game switch. Pinyin, when shown, is always tone-colored — the colorless variant
    // was removed.
    const { mode, showPinyin } = modeConfig;
    // Which mastery track(s) a find marks — a property of the chosen mode, not of this
    // Stage. No-Pinyin marks TWO (reading + production); Pinyin marks one. `markTypes[0]`
    // is the mode's primary track — the one the board itself was pooled on.
    const markTypes = useMemo(() => modeMarkTypes(modeConfig), [modeConfig]);
    // Fastest completion per board mode and size (docs/WORD_SEARCH_GAME.md § Personal best).
    const { best: personalBestMs, record: recordPersonalBest } = usePersonalBest("word-search", personalBestMode(mode, board));
    const showPinyinColor = true;

    // `useBlockEdgeSwipe(true)` is the HOST's job (the page, or the flp break area): it
    // must hold for the whole time the game is on screen.

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
    /**
     * The pre-run 3·2·1 is up (src/games/shared/GameCountdown.tsx). A flag beside `phase`
     * rather than a phase of its own: the board is fully drawn and "playing" in every sense
     * but input and the clock, and a new phase would have to be added to every
     * `phase === "playing"` read below. The clock holds while it is set (`clockPaused`).
     */
    const [counting, setCounting] = useState(false);
    const [data, setData] = useState<WordSearchResponse | null>(null);
    // Pre-round notice for lent cards (docs/PROVISIONAL_CARDS.md).
    const [noticeOpen, setNoticeOpen] = useState(false);
    const [found, setFound] = useState<Set<string>>(new Set());
    const gridRef = useRef<WordSearchGridHandle>(null);
    // Places the board on the screen. `data` is null until the deal lands, and the rows only
    // change with it, so a null board simply measures nothing.
    const [wordBandEl, setWordBandEl] = useState<HTMLElement | null>(null);
    const hintSlotRef = useRef<HTMLElement | null>(null);
    const wordBandHeight = useGridScreenAnchor(
        wordBandEl,
        hintSlotRef,
        boardNaturalHeight(data?.grid?.length ?? 0, BOARD_CELL_SIZE[board], showPinyin),
    );

    // −20 in a challenge round, per SPEND (§ 5.4): charged where the units are, so the free
    // re-shake costs no points either. An arrow because `challengeRound` is declared below.
    const hints = useWordSearchHints({
        data,
        found,
        showPinyin,
        onSpend: () => challengeRound.emit({ kind: "use", ruleId: "hintUsed" }),
    });
    const { noteBonus, isHinted, reset: resetHints, restore: restoreHints, snapshot: hintSnapshot } = hints;

    // Tapping anywhere that isn't a grid cell deselects the in-progress word.
    const handleBackgroundPointerDown = useCallback((e: React.PointerEvent) => {
        if (!(e.target as Element).closest?.('[data-cell="1"]')) {
            gridRef.current?.clearSelection();
        }
    }, []);

    const { startClock, stopTimer, pauseTimer, resumeTimer, readElapsedMs, hasStarted } = useRunClock();
    const [finalMs, setFinalMs] = useState(0);
    /** This run's `recordPersonalBest`: whether it set a best. Read by the break's results. */
    const newBestRef = useRef<Promise<boolean>>(Promise.resolve(false));

    // Always-fresh snapshot of state a background listener might need to read
    // without a stale closure — updated after every render (no dep array).
    const latestStateRef = useRef<{
        phase: Phase;
        data: WordSearchResponse | null;
        found: Set<string>;
    }>({
        phase: "loading",
        data: null,
        found: new Set(),
    });
    useEffect(() => {
        latestStateRef.current = { phase, data, found };
    });

    // ── STUDY CHALLENGE ROUND (docs/STUDY_CHALLENGE.md § 5) ──
    // Word Search is eligible as PINYIN ONLY (No Pinyin is a reading drill, and a
    // challenge round is recognition or production) — the server enforces that by
    // matching the caller's (gameId, mode) against the drawn sequence, so a
    // No-Pinyin launch simply never resolves to a round.
    //
    // `clockPaused` is declared further down, next to the run clock it protects, so
    // the two pause SOURCES are restated here rather than reused: the modal notice
    // and backgrounding. Both must freeze the −10/s time penalty (§ 5.8).
    const challengeRound = useChallengeRound({
        gameId: "word-search",
        mode,
        paused: noticeOpen || backgrounded || counting,
        running: phase === "playing",
    });
    // Back: the challenge mid-test, or the Games hub — and, on a claimed challenge
    // round, the confirm that says leaving ends it (docs/STUDY_CHALLENGE.md § 5.1a).
    const onBack = useGameBack(challengeRound);
    const challengeParamsRef = useRef("");
    challengeParamsRef.current = challengeRound.poolParams;
    // Read inside `persistSnapshot`, whose deps are deliberately minimal.
    const challengeRoundActiveRef = useRef(false);
    challengeRoundActiveRef.current = challengeRound.active;

    // Snapshot the current board to localStorage — no-op unless a board is
    // actually in progress and unfinished.
    const persistSnapshot = useCallback(() => {
        // A BREAK'S BOARD IS NEVER SAVED. The slot is the Games hub's "Resume" card, so a
        // save here would overwrite the board parked there with one the hub has no
        // business offering. Likewise `clearGameState` below.
        if (!userId || isBreak) return;
        // A CHALLENGE ROUND IS NEVER SAVED. The saved slot is offered back as the
        // hub's "Resume" card, which would restore a scored board OUTSIDE its
        // challenge — same grid, no round behind it — and would also overwrite the
        // player's own casual save. The round is instead re-entered from the
        // challenge, which rebuilds the board server-side.
        if (challengeRoundActiveRef.current) return;
        const s = latestStateRef.current;
        if (s.phase !== "playing" || !s.data || !s.data.grid) return;
        if (s.found.size >= s.data.words.length) return;
        saveGameState(userId, {
            mode,
            data: s.data,
            found: [...s.found],
            elapsedMs: readElapsedMs(),
            timerStarted: hasStarted(),
            ...hintSnapshot(),
        });
    }, [userId, mode, isBreak, readElapsedMs, hasStarted, hintSnapshot]);

    /** A grid the server sent, ready to play; null after switching to the blocked phase. */
    const adoptBoard = useCallback((payload: WordSearchResponse): WordSearchResponse | null => {
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
        // tts.prefetchSentence is stable.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Fetch a fresh randomized grid. Returns the payload, or null after switching
    // to the blocked phase (insufficient cards / wrong language / network error).
    const fetchGrid = useCallback(async (): Promise<WordSearchResponse | null> => {
        try {
            // `mode` steers the server's cooldown filter: No-Pinyin gates on the reading
            // clock, Pinyin on the know clock (docs/MASTERY_REWORK.md § 6). An active
            // challenge round's `poolParams` carries its own `mode`, which wins
            // (`wordSearchGridParams`).
            return adoptBoard(await fetchWordSearchGrid(wordSearchGridRequest({
                mode,
                challengeParams: challengeParamsRef.current,
                seedIds,
                flpBreak: isBreak,
                board,
            })));
        } catch {
            setBlockMessage("Couldn't load the game. Please try again.");
            setPhase("blocked");
            return null;
        }
        // apiGet reads the token at call time, so this callback's identity stays stable
        // across a silent token refresh. See CLAUDE.md "Never reload on token refresh".
        // Everything else it reads is fixed for the Stage's lifetime.
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
        resetHints();
        setFinalMs(0);
        setPhase("playing");
        // Started frozen at 0: the countdown runs first, and the pause gate below resumes
        // the clock when it releases.
        startClock(0);
        pauseTimer();
        setCounting(true);
    }, [startClock, pauseTimer, resetHints]);

    // Restore a previously saved board in place of fetching a new one — same
    // end state as startBoard, but seeded from a SavedWordSearchState instead
    // of a fresh server payload. Always resumes ticking from the saved
    // elapsed time, even if the timer had never been started when the board
    // was saved (older snapshots) — the timer now always runs while playing.
    const restoreBoard = useCallback((saved: SavedWordSearchState) => {
        setData(saved.data);
        setFound(new Set(saved.found));
        restoreHints(saved);
        setFinalMs(0);
        startClock(saved.elapsedMs);
        pauseTimer();
        setCounting(true);
        // Re-warm TTS for the restored targets.
        saved.data.words.forEach((w) => tts.prefetchSentence(w.entryKey, w.pinyin));
        setPhase("playing");
        // tts.prefetchSentence is stable; only re-create on auth change.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [startClock, pauseTimer, restoreHints]);

    // Initial load, once per authenticated session: resume a saved board if one
    // exists, else fetch a new one. Keyed on the STABLE auth identity (`user?.id`),
    // NOT `token`: the access token silently refreshes every ~15 min, and re-running
    // this effect on that refresh would reload a brand-new board and wipe the
    // in-progress game (found words + timer). See the "Never reload on token
    // refresh" rule in CLAUDE.md. `fetchGrid`/`startBoard`/`restoreBoard` are
    // deliberately omitted from the deps for the same reason.
    useEffect(() => {
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
            // Resume → restore this mode's saved board (one slot per mode — see
            // gameStateStorage). A fresh launch → always a new board; any existing
            // save is discarded by the launching surface's confirm flow before we
            // get here, and starting fresh (then re-saving on exit) overwrites the
            // slot anyway.
            if (resumeIntent && !challengeRoundActiveRef.current) {
                const saved = loadGameState(userId, mode);
                if (saved) {
                    if (!cancelled) restoreBoard(saved);
                    return;
                }
                // Save vanished between hub and here — fall through to fresh.
            }
            // A break's board was fetched while card 10 was on screen. Read from the prop,
            // not consumed: StrictMode's second run of this effect must find it too.
            const payload = prefetchedBoard ? adoptBoard(prefetchedBoard) : await fetchGrid();
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
    // provisional-cards notice would show up as a worse result. The notice blocks
    // input, so a frozen clock can't be used to study the live grid. (The settings
    // sheet used to be a second source; it was deleted when its only row, timer
    // visibility, moved into the HUD strip as an inline eye toggle.) The in-grid gloss popups are deliberately NOT included: they
    // are small anchored tooltips that leave the board playable, so pausing on
    // them would hand out a free stopwatch stop. Shared rule across all four games
    // — see docs/GAMES_FEATURE.md § Popups pause the clock.
    // The countdown is the second source: the run's time starts when it releases.
    const clockPaused = noticeOpen || counting;
    // Read by the visibility listener below, which fires outside React's render
    // and must not resume a clock a popup is still holding.
    const clockPausedRef = useRef(clockPaused);
    clockPausedRef.current = clockPaused;

    // 3·2·1 over the dealt board, once the lent-cards notice is dismissed (it sits under
    // the countdown's screen-wide dim, so the two are never up together). Holds while the
    // app is backgrounded, then releases into the live run. Gated on "playing" too, so a
    // break's Leave mid-count (→ "left") takes the dim down with the run.
    const countdownStep = useGameCountdown({
        active: counting && phase === "playing" && !noticeOpen,
        paused: backgrounded,
        onRelease: () => setCounting(false),
    });

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
    // find), and persistSnapshot reads the live elapsed off the clock, so the saved
    // time is current at each write. No-ops once the board is complete (its guard).
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
        if (isHinted(word.entryKey)) return;
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
        markTypes.forEach((type) => {
            markFlashcard({
                cardId: word.id,
                isCorrect: true,
                type,
                surface: "word-search",
            })
                .then((result) => {
                    // Off the PRIMARY track only: that is the flp bar this break sits on,
                    // so it is the mark that takes the card off the tower. A lent card
                    // and a focused break's outside card were never on it.
                    const board = latestStateRef.current.data;
                    if (
                        type === markTypes[0]
                        && !result.suppressed
                        && !board?.provisionalWords?.includes(word.entryKey)
                        && !board?.outsideFocusWords?.includes(word.entryKey)
                    ) onCardClearedRef.current?.(word.id);
                })
                .catch((err) => console.error(`[WordSearch] ${type} mark failed → card ${word.id}:`, err));
        });
        // No `token` dep — markFlashcard reads the header at call time, so this
        // callback's identity is stable across a silent refresh (CLAUDE.md ⛔ rule).
    }, [markTypes, isHinted]);

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
        // One unit for the find; the row clears if this was the hinted word.
        hints.noteFound(word);
        // challengeRound's emit/isContested are stable by construction.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [speakWord, markWordFound, hints.noteFound]);

    // Win when every target is found. Freeze the timer, capture the final time.
    useEffect(() => {
        if (phase !== "playing" || !data) return;
        if (found.size >= data.words.length && data.words.length > 0) {
            stopTimer();
            const ms = readElapsedMs();
            setFinalMs(ms);
            // Every completion logs under level 1 — Word Search's two modes
            // deliberately share one wins bucket (see GAME_KEY in ./constants).
            recordWin(WIN_LEVEL);
            if (userId && !isBreak) clearGameState(userId, mode);
            // A challenge board is drawn from the round's shared word set, not the
            // player's own pool, so it does not compete with their personal best.
            newBestRef.current = challengeRound.active ? Promise.resolve(false) : recordPersonalBest(ms);
            setPhase("won");
            // Word Search's board is always completable, so `won` is always true —
            // it exists for the all-or-nothing survival bonus other games have.
            challengeRound.finish(true);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [found, phase, data, stopTimer, readElapsedMs, recordWin, userId, mode]);

    // The centred column shown INSTEAD of the board (spinner, or the blocked
    // message). The shape is shared — `GameCentered` also owns the rule that text on
    // the accent ground is white — so this is only the page's class name for it.
    const renderCentered = (children: React.ReactNode) => (
        <GameCentered className="word-search__overlay">{children}</GameCentered>
    );

    const runOver = phase === "won" || phase === "left";
    // End-of-run offer to keep the lent cards; opens a beat after the run ends. Only the
    // ones the player found: a run left short has words it never reached.
    const sortOfferWords = useMemo(
        () => (data?.provisionalWords ?? []).filter((word) => found.has(word)),
        [data, found]
    );
    const sortOffer = useProvisionalSortOffer(runOver, sortOfferWords);
    const dismissSortOffer = sortOffer.dismiss;

    /**
     * The flp break's Leave (docs/FLP_GAME_BREAKS.md § 2). A LIVE run ends with what it
     * found, so it has no finish time, and so no tiers, win or personal best.
     * From every other phase there is nothing to show, so the break closes.
     */
    const leaveBreak = useCallback(() => {
        if (phase === "playing") {
            stopTimer();
            setFinalMs(readElapsedMs());
            setPhase("left");
            return;
        }
        // A finished run is only ever still here for the sort offer: Leave is its "not now".
        if (runOver) {
            dismissSortOffer();
            return;
        }
        onDone();
        // `dismissSortOffer` is a fresh closure over stable setters.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phase, runOver, onDone, stopTimer, readElapsedMs]);
    const onExitRequest = isBreak ? leaveBreak : onBack;

    // A break's run reports to the flp, which is what
    // starts the shrink back to the card. A lent-card offer holds it: the offer lives over
    // this board, so it has to be answered before the board goes.
    const sortOfferPending = sortOfferWords.length > 0 && !sortOffer.dismissed;
    useEffect(() => {
        if (!isBreak || !runOver || sortOfferPending) return;
        const finished = phase === "won";
        const bestBefore = personalBestMs;
        onRunEnded?.({
            title: runResultTitle(finished),
            tiers: runResultTiers(finished, finalMs, data?.words.length),
            score: runResultScore(found.size, data?.words.length ?? 0, finalMs),
            details: [],
            personalBest: newBestRef.current.then((isNew) => {
                const best = isNew ? finalMs : bestBefore;
                return best === null ? null : { game: "word-search", best, isNewBest: isNew };
            }),
        });
        // Once per run: the board and the clock cannot move after the run ends.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isBreak, runOver, sortOfferPending]);

    let content: React.ReactNode = null;

    if (phase === "loading") {
        content = renderCentered(<DelayedCircularProgress className="word-search__spinner" />);
    } else if (phase === "blocked") {
        content = renderCentered(
            <>
                <Typography className="word-search__block-msg" sx={{ fontSize: SIZE.subtitle, lineHeight: LEADING.normal }}>
                    {blockMessage}
                </Typography>
                <Button className="word-search__block-back" variant="contained" onClick={onDone}>
                    Back to {doneLabel}
                </Button>
            </>
        );
    } else if ((phase === "playing" || runOver) && data && data.grid) {
        const glossBandTop = isBreak ? GAME_FRAME_EXIT_ARROW_BOTTOM_PX : 0;
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
                    (docs/SHELF_REDESIGN.md § A6). The sort offer stays OUTSIDE it: it
                    covers the full content area and must not be clipped by the panel's
                    radius. */}
                <GameFrame className="word-search__frame">
                {/* The glosses, centred both ways in the height above the board: between
                    the top of the panel (in a break, the bottom of Leave's arrow) and the
                    first row of tiles. The grid already holds GRID_EDGE_PX of empty space
                    above those tiles, so the same amount on top of this band puts the list
                    at the middle of what is visible.

                    This band's height is what places the board (`useGridScreenAnchor`). A
                    MIN height, so glosses too tall for it push the board down. */}
                <Box
                    ref={setWordBandEl}
                    className="word-search__word-band"
                    sx={{
                        flex: "0 0 auto",
                        boxSizing: "border-box",
                        minHeight: `${wordBandHeight}px`,
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "center",
                        paddingTop: `${glossBandTop + GRID_EDGE_PX}px`,
                    }}
                >
                    <WordSearchWordList words={data.words} found={found} hintEntryKey={hints.entryKey} />
                </Box>

                <WordSearchGrid
                    ref={gridRef}
                    grid={data.grid}
                    words={data.words}
                    found={found}
                    bonusWords={data.bonusWords}
                    showPinyin={showPinyin}
                    showPinyinColor={showPinyinColor}
                    hintedWord={hints.locationRevealed ? data.words.find((w) => w.entryKey === hints.entryKey) ?? null : null}
                    hintShakeNonce={hints.shakeNonce}
                    onFound={onFound}
                    onBonusFound={noteBonus}
                    onFirstInteraction={handleFirstInteraction}
                    speak={speakWord}
                    silence={silenceWord}
                    cellSize={BOARD_CELL_SIZE[board]}
                />

                {/* Takes the height the board leaves below it, so the hint row stays pinned
                    to the panel's bottom edge wherever the board is anchored. */}
                <Box className="word-search__grid-spacer" sx={{ flex: "1 1 0", minHeight: 0 }} />

                {/* The hint mechanic, whole, on one row: press · charges · reveal. It is the
                    LAST child of the panel, in thumb reach. */}
                <Box ref={hintSlotRef} className="word-search__hint-slot" sx={{ flexShrink: 0 }}>
                    <WordSearchHintBar
                        units={hints.units}
                        ready={phase === "playing" && hints.canUse()}
                        onHint={hints.spend}
                    >
                        <WordSearchHintRow
                            word={data.words.find((w) => w.entryKey === hints.entryKey) ?? null}
                            revealCount={hints.revealCount}
                            currency={showPinyin ? "pinyin" : "components"}
                        />
                    </WordSearchHintBar>
                </Box>

                <GameCountdown step={countdownStep} classPrefix="word-search" />
                </GameFrame>

                {/* A challenge round ends on the scoreboard (§ 5.5) — points, not a
                    time tier, and no Play Again: the round is final (§ 5.1a). */}
                {phase === "won" && challengeRound.active && (
                    <ChallengeRoundScoreboard round={challengeRound} classPrefix="word-search" />
                )}

                {/* Opens a beat after the run ends. Renders nothing unless this grid used
                    lent cards. */}
                <ProvisionalSortOffer
                    open={sortOffer.open}
                    words={sortOfferWords}
                    language={(user?.selectedLanguage ?? "zh") as Language}
                    onDismiss={sortOffer.dismiss}
                    onNothingToOffer={sortOffer.dismiss}
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
            {/* The host's `Frame` supplies the chrome: a LEAF PAGE on the route
                (docs/LEAF_NODE_PAGES.md), the bare screen in an flp break. */}
            <Frame title="Word Search" onExitRequest={onExitRequest} headerRight={headerRight}>
                {content}
            </Frame>
        </>
    );
};

export default WordSearchStage;
