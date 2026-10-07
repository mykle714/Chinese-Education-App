import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Button, Typography } from "@mui/material";
import { GameLeafPage } from "../shared/GameSurface";
import { GameCentered, GameFrame, GameTimer } from "../shared/GameFrame";
import GameEndPopup from "../runtime/GameEndPopup";
import GamePausedOverlay from "../runtime/GamePausedOverlay";
import { useBackgroundPause } from "../runtime/useBackgroundPause";
import { useGameExit } from "../runtime/gameExit";
import { usePersonalBest } from "../shared/usePersonalBest";
import { useLocalGameSettings } from "../shared/useLocalGameSettings";
import PersonalBestLine from "../shared/PersonalBestLine";
import DelayedCircularProgress from "../../components/DelayedCircularProgress";
import { recognizeHandwriting } from "../../components/handwriting/recognize";
import type { Ink } from "../../components/handwriting/types";
import { useAuth } from "../../AuthContext";
import { markFlashcard } from "../../api/flashcards";
import { dealWritingGrid, type WritingGridCharacter } from "../../api/writingGrid";
import { useBlockEdgeSwipe } from "../../hooks/useBlockEdgeSwipe";
import { useGameWins } from "../../hooks/useGameWins";
import { usePageTitle } from "../../hooks/usePageTitle";
import { formatTimeMs } from "../../utils/timeUtils";
import { COLORS } from "../../theme/colors";
import { SIZE, WEIGHT } from "../../theme/scale";
import { medalForWritingGrid } from "../../../server/contracts/writingGrid";
import WritingGridBoard, { type BoardPhase, type CellResult } from "./WritingGridBoard";
import WritingFocusEditor from "../../components/handwriting/WritingFocusEditor";
import { moveItem } from "./gridOrder";
import { CANVAS_SIZE, COUNTDOWN_STEPS, COUNTDOWN_STEP_MS, DEFAULT_SETTINGS, GAME_HUE, GAME_ID, GAME_KEY, MEDAL_LABEL, SETTINGS_STORAGE_KEY } from "./constants";

/**
 * Writing Grid — write eight characters, each at a different level of help
 * (docs/WRITING_PRACTICE_REWORK.md § 2). Launched from the Writing Center only.
 *
 * Flow: loading → (empty) → countdown → arrange (Phase 1) → write (Phase 2) → ended
 *
 *   countdown — Match Speed's 3·2·1·Go over the readable board; no time billed.
 *   arrange   — the stopwatch runs. The learner drags characters between slots; slot i
 *               is Level i + 1, so arranging = choosing which character gets which help.
 *               "Start writing" ends the phase.
 *   write     — glyphs hide. Tap a cell → WritingFocusEditor at that slot's level; tap
 *               out → top-1 Verify → ✓ / ✗ and a writing mark on the character's own
 *               card (the server applies the anti-farming gate). A ✗ cell can be
 *               reopened and rewritten (a fresh attempt: new ink, new Level 8 clock).
 *   ended     — every cell ✓; the stopwatch stops. Time, medal, personal best. The
 *               popup minimizes to the corner puck so the finished board (every cell's
 *               ink over its full shadow) can be viewed. Tapping a cell reopens its
 *               canvas as drawn; a redraw is verified (✓ / ✗) but never marked.
 *
 * The stopwatch is ACCUMULATED active time, so a backgrounded app (useBackgroundPause)
 * is not billed — the app-wide games rule.
 */
const WritingGridPage: React.FC = () => {
    usePageTitle("Writing Grid");
    useBlockEdgeSwipe(true);
    const navigate = useNavigate();
    const gameExit = useGameExit();
    const { token, isAuthenticated } = useAuth();
    const { recordWin } = useGameWins(GAME_KEY);
    const personalBest = usePersonalBest(GAME_ID, "default");

    const [phase, setPhase] = useState<"loading" | "empty" | BoardPhase>("loading");
    const [cells, setCells] = useState<WritingGridCharacter[]>([]);
    const [results, setResults] = useState<Record<string, CellResult>>({});
    const [inks, setInks] = useState<Record<string, Ink>>({});
    const [openIndex, setOpenIndex] = useState<number | null>(null);
    // The open cell's element — the editor grows out of it and shrinks back into it.
    const [openOrigin, setOpenOrigin] = useState<HTMLElement | null>(null);
    const [countdownStep, setCountdownStep] = useState(0);
    const [loadNonce, setLoadNonce] = useState(0);

    // ── Deal ─────────────────────────────────────────────────────────────────────
    // Keyed on isAuthenticated, never the token (CLAUDE.md "Never reload on token refresh").
    useEffect(() => {
        if (!isAuthenticated) return;
        let cancelled = false;
        setPhase("loading");
        dealWritingGrid()
            .then((dealt) => {
                if (cancelled) return;
                setCells(dealt);
                setResults({});
                setInks({});
                setOpenIndex(null);
                setCountdownStep(0);
                setPhase(dealt.length > 0 ? "countdown" : "empty");
            })
            .catch((err) => {
                console.error("[WritingGrid] deal failed", err);
                if (!cancelled) setPhase("empty");
            });
        return () => {
            cancelled = true;
        };
    }, [isAuthenticated, loadNonce]);

    // ── Countdown ────────────────────────────────────────────────────────────────
    useEffect(() => {
        if (phase !== "countdown") return;
        const id = window.setTimeout(() => {
            if (countdownStep >= COUNTDOWN_STEPS.length - 1) {
                startStopwatch();
                setPhase("arrange");
            } else {
                setCountdownStep((s) => s + 1);
            }
        }, COUNTDOWN_STEP_MS);
        return () => window.clearTimeout(id);
    }, [phase, countdownStep]);

    // ── Stopwatch: accumulated ACTIVE time ───────────────────────────────────────
    const running = phase === "arrange" || phase === "write";
    const { paused: backgroundPaused, resume: resumeFromBackground } = useBackgroundPause(running);
    const accumulatedRef = useRef(0);
    const runningSinceRef = useRef<number | null>(null);
    const [elapsedMs, setElapsedMs] = useState(0);
    // Device-local "show timer" preference behind the stopwatch's eye — Word Search's
    // behaviour, kept under this game's own key (the clock keeps running while hidden).
    const { settings: gridSettings, update: updateGridSettings } = useLocalGameSettings(SETTINGS_STORAGE_KEY, DEFAULT_SETTINGS);
    const { showTimer } = gridSettings;

    const startStopwatch = () => {
        accumulatedRef.current = 0;
        runningSinceRef.current = Date.now();
        setElapsedMs(0);
    };
    const readStopwatch = () =>
        accumulatedRef.current + (runningSinceRef.current ? Date.now() - runningSinceRef.current : 0);
    const holdStopwatch = () => {
        accumulatedRef.current = readStopwatch();
        runningSinceRef.current = null;
    };

    // Background pause latches the clock off until the learner taps Resume.
    useEffect(() => {
        if (!running) return;
        if (backgroundPaused) holdStopwatch();
        else if (runningSinceRef.current === null) runningSinceRef.current = Date.now();
        // holdStopwatch only touches refs, so it cannot go stale.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [backgroundPaused, running]);

    useEffect(() => {
        if (!running) return;
        const id = window.setInterval(() => setElapsedMs(readStopwatch()), 200);
        return () => window.clearInterval(id);
    }, [running]);

    // ── Phase 1 ──────────────────────────────────────────────────────────────────
    const handleReorder = useCallback((from: number, to: number) => {
        setCells((prev) => moveItem(prev, from, to));
    }, []);

    // ── Phase 2: check a cell on tap-out ─────────────────────────────────────────
    // Also the End board's practice redraw: once the board is finished, a tapped cell
    // reopens with its ink as drawn; a CHANGED drawing is re-verified (✓ / ✗ on the
    // cell) but emits no mark — the run's marks were already sent while it was timed.
    const handleCellDone = async (index: number, ink: Ink) => {
        const cell = cells[index];
        setOpenIndex(null);
        if (!cell) return;
        const practice = phase === "ended";
        // Practice: closing with the canvas untouched — or cleared and left empty — keeps
        // the board's drawing and verdict rather than blanking a finished cell.
        if (practice && (ink.length === 0 || sameInk(ink, inks[cell.char] ?? []))) return;
        setInks((prev) => ({ ...prev, [cell.char]: ink }));
        if (ink.length === 0) return; // nothing written: no check, no mark
        setResults((prev) => ({ ...prev, [cell.char]: "checking" }));
        let correct = false;
        try {
            const { top1 } = await recognizeHandwriting(ink, CANVAS_SIZE, CANVAS_SIZE, token);
            correct = top1 === cell.char;
        } catch (err) {
            console.warn("[WritingGrid] verify failed", err);
        }
        setResults((prev) => ({ ...prev, [cell.char]: correct ? "correct" : "wrong" }));
        if (practice) return; // End-board redraws are evaluated, never marked
        const level = index + 1;
        // Every check marks the character's own card; the server drops it when
        // level ≤ that character's mastery (farming) or the card is resting.
        markFlashcard({
            cardId: cell.cardId,
            isCorrect: correct,
            type: "writing",
            surface: "writing-grid",
            writing: { level, perChar: [correct] },
        }).catch((err) => console.error(`[WritingGrid] writing mark failed → card ${cell.cardId}:`, err));
    };

    // Phase 2: a ✗ cell reopened is a fresh attempt — drop its old ink (and with it the
    // old Level 8 clock, which lives in the editor). On the End board a cell reopens
    // with its canvas exactly as drawn (✓ or ✗); the editor's Clear starts it over.
    const handleOpenCell = (index: number, el: HTMLElement) => {
        const cell = cells[index];
        if (phase === "write" && cell && results[cell.char] === "wrong") {
            setInks((prev) => ({ ...prev, [cell.char]: [] }));
            setResults((prev) => ({ ...prev, [cell.char]: "idle" }));
        }
        setOpenOrigin(el);
        setOpenIndex(index);
    };

    // ── End: every cell correct ──────────────────────────────────────────────────
    const allCorrect = cells.length > 0 && cells.every((c) => results[c.char] === "correct");
    const [finalMs, setFinalMs] = useState(0);
    // The end popup collapses to the top-right puck (its ×) so the finished board —
    // every cell's ink over its shadow — can be looked over; the puck restores it.
    const [popupMinimized, setPopupMinimized] = useState(false);
    useEffect(() => {
        if (phase !== "write" || !allCorrect) return;
        holdStopwatch();
        const total = accumulatedRef.current;
        setFinalMs(total);
        setElapsedMs(total);
        setPhase("ended");
        void personalBest.record(total);
        if (medalForWritingGrid(total)) recordWin(1);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [allCorrect, phase]);

    const medal = phase === "ended" ? medalForWritingGrid(finalMs) : null;

    const playAgain = () => {
        personalBest.reset();
        setPopupMinimized(false);
        setLoadNonce((n) => n + 1);
    };
    const leave = () => navigate(gameExit.path, { state: gameExit.state });

    const openCell = openIndex !== null ? cells[openIndex] : null;
    const boardPhase: BoardPhase = phase === "loading" || phase === "empty" ? "countdown" : phase;

    return (
        <GameLeafPage hue={GAME_HUE} title="Writing Grid" onBack={leave}>
            {phase === "loading" && (
                <GameCentered className="writing-grid__loading">
                    <DelayedCircularProgress className="writing-grid__spinner" />
                </GameCentered>
            )}

            {phase === "empty" && (
                <GameCentered className="writing-grid__empty">
                    <Typography className="writing-grid__empty-message">
                        No characters to write yet — add some Chinese cards first.
                    </Typography>
                    <Button className="writing-grid__empty-back" variant="outlined" onClick={leave} sx={{ textTransform: "none" }}>
                        Back to {gameExit.label}
                    </Button>
                </GameCentered>
            )}

            {phase !== "loading" && phase !== "empty" && (
                <GameFrame className="writing-grid__frame" sx={{ touchAction: "none" }}>
                    <GameTimer
                        className="writing-grid__stopwatch"
                        value={formatTimeMs(elapsedMs)}
                        // A bare stopwatch: no `fraction`, so no track under the clock.
                        dimmed={phase === "ended"}
                        valueShown={showTimer}
                        onToggleValueShown={() => updateGridSettings({ showTimer: !showTimer })}
                        // The phase rides in the clock strip's top-left corner rather than on
                        // its own row, so the board gets that row's height back.
                        leading={
                            <Box className="writing-grid__phase" sx={{ fontWeight: WEIGHT.bold, color: COLORS.onSurface }}>
                                {phase === "arrange" || phase === "countdown" ? "Phase 1" : "Phase 2"}
                            </Box>
                        }
                    />

                    {/* No side padding here: the board's frame runs edge to edge so the Easiest /
                        Hardest labels can centre between the screen edge and the grid. The
                        board reserves the page's edge padding itself (DIFFICULTY_GUTTER). */}
                    <Box className="writing-grid__board-area" sx={{ flex: 1, minHeight: 0, pt: 1.5, display: "flex", flexDirection: "column", gap: 1.5 }}>
                        <WritingGridBoard
                            cells={cells}
                            phase={boardPhase}
                            results={results}
                            inks={inks}
                            onReorder={handleReorder}
                            onOpenCell={handleOpenCell}
                        />
                    </Box>

                    {/* Mounted for the WHOLE game, not just Phase 1: the board sizes itself
                        to the space left over (WritingGridBoard fits its frame), so a bar
                        that appeared after the countdown — or vanished on Phase 2 — would
                        resize every cell mid-game. It sits under the countdown scrim from
                        the first frame, is live only in Phase 1, and keeps its space
                        (hidden, not unmounted) after. */}
                    <Box
                        className="writing-grid__start-bar"
                        sx={{ p: 2, pt: 0, visibility: phase === "write" || phase === "ended" ? "hidden" : "visible" }}
                    >
                        <Button
                            className="writing-grid__start-writing"
                            variant="contained"
                            fullWidth
                            disableElevation
                            disabled={phase !== "arrange"}
                            onClick={() => setPhase("write")}
                            sx={{ py: 1.25, borderRadius: "14px", textTransform: "none", fontWeight: WEIGHT.bold, border: `1px solid ${COLORS.border}` }}
                        >
                            Start writing
                        </Button>
                    </Box>

                    {phase === "countdown" && (
                        <Box
                            className="writing-grid__countdown"
                            sx={{
                                position: "absolute",
                                inset: 0,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                backgroundColor: COLORS.scrim,
                                pointerEvents: "none",
                                zIndex: 5,
                            }}
                        >
                            <Typography
                                className="writing-grid__countdown-step"
                                key={countdownStep}
                                sx={{
                                    fontSize: "72px",
                                    fontWeight: WEIGHT.bold,
                                    color: COLORS.white,
                                    textShadow: "0 2px 12px rgba(0,0,0,0.4)",
                                    animation: "writing-grid-countdown-pop 400ms ease-out",
                                    "@keyframes writing-grid-countdown-pop": {
                                        from: { opacity: 0, transform: "scale(0.5)" },
                                        to: { opacity: 1, transform: "scale(1)" },
                                    },
                                }}
                            >
                                {COUNTDOWN_STEPS[countdownStep]}
                            </Typography>
                        </Box>
                    )}

                    {openCell && openIndex !== null && (
                        <WritingFocusEditor
                            key={`${openCell.char}-${openIndex}`}
                            char={openCell.char}
                            pinyin={openCell.pinyin}
                            level={openIndex + 1}
                            initialInk={inks[openCell.char] ?? []}
                            origin={openOrigin}
                            onDone={(ink) => void handleCellDone(openIndex, ink)}
                        />
                    )}
                </GameFrame>
            )}

            {phase === "ended" && (
                <GameEndPopup
                    classPrefix="writing-grid"
                    minimized={popupMinimized}
                    onMinimize={() => setPopupMinimized(true)}
                    onRestore={() => setPopupMinimized(false)}
                >
                    <Typography className="writing-grid__popup-title" sx={{ fontSize: SIZE.heading, fontWeight: WEIGHT.bold, color: COLORS.onSurface }}>
                        {medal ? `${MEDAL_LABEL[medal]}!` : "Finished!"}
                    </Typography>
                    <Typography className="writing-grid__popup-time" sx={{ fontSize: SIZE.heading, fontWeight: WEIGHT.bold, color: COLORS.onSurface }}>
                        {formatTimeMs(finalMs)}
                    </Typography>
                    <PersonalBestLine game="writing-grid" best={personalBest.best} isNewBest={personalBest.isNewBest} className="writing-grid__personal-best" />
                    <Box className="writing-grid__popup-actions" sx={{ display: "flex", flexDirection: "column", gap: 1.25, width: "100%" }}>
                        <Button
                            className="writing-grid__popup-again"
                            variant="contained"
                            onClick={playAgain}
                            sx={{ py: 1.25, borderRadius: "14px", textTransform: "none", fontWeight: WEIGHT.bold }}
                        >
                            Play Again
                        </Button>
                        <Button
                            className="writing-grid__popup-back"
                            variant="outlined"
                            onClick={leave}
                            sx={{ py: 1, borderRadius: "14px", textTransform: "none", fontWeight: WEIGHT.medium }}
                        >
                            Back to {gameExit.label}
                        </Button>
                    </Box>
                </GameEndPopup>
            )}

            <GamePausedOverlay open={backgroundPaused} onResume={resumeFromBackground} classPrefix="writing-grid" />
        </GameLeafPage>
    );
};

/**
 * Same drawing? Compared stroke by stroke on the timestamps, which are unique to a
 * drawing — the editor hands back copies, so reference equality cannot be used.
 */
function sameInk(a: Ink, b: Ink): boolean {
    if (a.length !== b.length) return false;
    return a.every((stroke, i) => {
        const other = b[i];
        return stroke.ts.length === other.ts.length && stroke.ts.every((t, j) => t === other.ts[j]);
    });
}

export default WritingGridPage;
