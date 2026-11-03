import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { Box, Button, Typography } from "@mui/material";
import { GameCentered, GameFrame, GameHud, GameHudLabel } from "../shared/GameFrame";
import { GAME_FRAME_EXIT_CLEARANCE_PX } from "../shared/gameFrameExit";
import GameEndPopup from "../runtime/GameEndPopup";
import { useBackgroundPause } from "../runtime/useBackgroundPause";
import { usePersonalBest } from "../shared/usePersonalBest";
import PersonalBestLine from "../shared/PersonalBestLine";
import { HeaderToggleChip } from "../../components/PageHeader";
import { useConfirmation } from "../../contexts/ConfirmationContext";
import DelayedCircularProgress from "../../components/DelayedCircularProgress";
import { recognizeHandwriting } from "../../components/handwriting/recognize";
import type { Ink } from "../../components/handwriting/types";
import { useAuth } from "../../AuthContext";
import { markFlashcard } from "../../api/flashcards";
import { dealWritingGrid, type WritingGridCharacter, type WritingGridDealRequest } from "../../api/writingGrid";
import { useGameWins } from "../../hooks/useGameWins";
import { DENSE_HEADER_PAD_TOP_PX, DENSE_HEADER_PAD_X_PX } from "../../components/pageHeaderSizing";
import { formatTimeMs } from "../../utils/timeUtils";
import { COLORS } from "../../theme/colors";
import { SIZE, WEIGHT } from "../../theme/scale";
import { medalForWritingGrid } from "../../../server/contracts/writingGrid";
import WritingGridBoard, { type BoardPhase, type CellResult } from "./WritingGridBoard";
import WritingFocusEditor from "../../components/handwriting/WritingFocusEditor";
import { moveItem } from "./gridOrder";
import { CANVAS_SIZE, COUNTDOWN_STEPS, COUNTDOWN_STEP_MS, GAME_ID, GAME_KEY, MEDAL_LABEL } from "./constants";
import type { GameStageFrameProps, GameStageHost } from "../types";
import type { FlpBreakResults } from "../flpBreak/types";

export interface WritingGridStageProps {
    host: GameStageHost;
    /** The host's chrome: `GameLeafPage` on the route, `GameBreakFrame` in the flp. */
    Frame: ComponentType<GameStageFrameProps>;
    /** flp break only: what its deals add (the seed, the focus rule). */
    dealRequest?: WritingGridDealRequest;
    /** flp break only: the board prefetched for it. Null = the Stage deals its own. */
    prefetchedCells?: WritingGridCharacter[] | null;
    /** The page's Back; a break's close with no run to report. */
    onDone: () => void;
    /** The destination `onDone` names, for "Back to …". */
    doneLabel: string;
    /** flp break only: FlpBreakStageProps `onRunEnded`. Replaces the end popup. */
    onRunEnded?: (results: FlpBreakResults) => void;
    /** flp break only: FlpBreakStageProps `onCardCleared`. */
    onCardCleared?: () => void;
}

/**
 * Writing Grid — write eight characters, each at a different level of help
 * (docs/WRITING_PRACTICE_REWORK.md § 2). Runs on its route (the Writing Center's launch)
 * and as an flp game break (docs/FLP_GAME_BREAKS.md § 6).
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
 *   ended     — every cell ✓ (or the learner gave up); the stopwatch stops. Time, medal, personal best. The
 *               popup minimizes to the corner puck so the finished board (every cell's
 *               ink over its full shadow) can be viewed. Tapping a cell reopens its
 *               canvas as drawn; a redraw is verified (✓ / ✗) but never marked.
 *
 * Give up — the header's "give up" chip (Phase 1 or 2, after a confirm) ends the run
 * early onto the same End board, which reveals every character's full shadow. No
 * medal, no personal best, no win, and no marks beyond the cells already checked.
 *
 * The stopwatch is ACCUMULATED active time, so a backgrounded app (useBackgroundPause)
 * is not billed — the app-wide games rule.
 *
 * What differs by host:
 *   - the chrome (`Frame`), and with it the give-up chip, which only the page's header
 *     has room for;
 *   - the opening board: a break seeds it and may hand over the prefetched cells;
 *   - the way out: the page's Back leaves; a break's Leave ENDS a live run like give up,
 *     with no confirm, as Leave does in every game;
 *   - the end: a break reports to the flp (`onRunEnded`) in place of the popup, so it has
 *     no End board and no Play Again.
 */
const WritingGridStage: React.FC<WritingGridStageProps> = ({
    host,
    Frame,
    dealRequest,
    prefetchedCells = null,
    onDone,
    doneLabel,
    onRunEnded,
    onCardCleared,
}) => {
    const isBreak = host === "flpBreak";
    const onCardClearedRef = useRef(onCardCleared);
    onCardClearedRef.current = onCardCleared;
    const { token, isAuthenticated } = useAuth();
    const { recordWin } = useGameWins(GAME_KEY);
    const { confirm } = useConfirmation();
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
    // Set when the run ended through "give up" rather than an all-✓ board: the number of
    // cells that were ✓ at that moment (frozen, so End-board practice redraws cannot
    // change it). null = not given up. The End board is the same either way; only the
    // popup (no time / medal / best) differs.
    const [gaveUpCorrect, setGaveUpCorrect] = useState<number | null>(null);
    const gaveUp = gaveUpCorrect !== null;
    // A break's Leave during Phase 1. The run still ends and reports, but the screen stays
    // as Phase 1 while the break shrinks away, so "ended" never flashes the Phase 2 label
    // or the revealed End board on the way out. A break has no Play Again to reset this.
    const [leftDuringArrange, setLeftDuringArrange] = useState(false);

    // ── Deal ─────────────────────────────────────────────────────────────────────
    // Keyed on isAuthenticated, never the token (CLAUDE.md "Never reload on token refresh").
    useEffect(() => {
        if (!isAuthenticated) return;
        let cancelled = false;
        setPhase("loading");
        // Keyed on the nonce, not spent through a ref, so a StrictMode re-run uses it too.
        // A break never bumps the nonce: it has no Play Again.
        const deal = prefetchedCells && loadNonce === 0 ? Promise.resolve(prefetchedCells) : dealWritingGrid(dealRequest);
        deal
            .then((dealt) => {
                if (cancelled) return;
                setCells(dealt);
                setResults({});
                setInks({});
                setOpenIndex(null);
                setCountdownStep(0);
                setGaveUpCorrect(null);
                setPhase(dealt.length > 0 ? "countdown" : "empty");
            })
            .catch((err) => {
                console.error("[WritingGrid] deal failed", err);
                if (!cancelled) setPhase("empty");
            });
        return () => {
            cancelled = true;
        };
        // The request and the prefetch are fixed for a Stage's life.
        // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const { paused: backgroundPaused } = useBackgroundPause(running);
    const accumulatedRef = useRef(0);
    const runningSinceRef = useRef<number | null>(null);

    const startStopwatch = () => {
        accumulatedRef.current = 0;
        runningSinceRef.current = Date.now();
    };
    const readStopwatch = () =>
        accumulatedRef.current + (runningSinceRef.current ? Date.now() - runningSinceRef.current : 0);
    const holdStopwatch = () => {
        accumulatedRef.current = readStopwatch();
        runningSinceRef.current = null;
    };

    // Background pause holds the clock while the app is hidden; it resumes on return.
    useEffect(() => {
        if (!running) return;
        if (backgroundPaused) holdStopwatch();
        else if (runningSinceRef.current === null) runningSinceRef.current = Date.now();
        // holdStopwatch only touches refs, so it cannot go stale.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [backgroundPaused, running]);

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
        })
            .then((result) => {
                // Only the learner's own single-character card can leave a tower: a hidden
                // row and a focused break's outside card were never on it, and a word's
                // cards stay, since a character's mark does not start the word's clock.
                if (correct && !result.suppressed && cell.ownCard && !cell.outsideFocus) onCardClearedRef.current?.();
            })
            .catch((err) => console.error(`[WritingGrid] writing mark failed → card ${cell.cardId}:`, err));
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
    // Settles once the server has judged the run; the break's results card waits on it.
    const newBestRef = useRef<Promise<boolean>>(Promise.resolve(false));
    useEffect(() => {
        if (phase !== "write" || !allCorrect) return;
        holdStopwatch();
        const total = accumulatedRef.current;
        setFinalMs(total);
        setPhase("ended");
        newBestRef.current = personalBest.record(total);
        if (medalForWritingGrid(total)) recordWin(1);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [allCorrect, phase]);

    const medal = phase === "ended" && !gaveUp ? medalForWritingGrid(finalMs) : null;

    // ── Give up: end the run early and reveal the board ─────────────────────────
    // Read through a ref so the confirm's async resolution sees the CURRENT phase —
    // the closure's `phase` is whatever it was when the chip was tapped.
    const phaseRef = useRef(phase);
    phaseRef.current = phase;
    const correctCountRef = useRef(0);
    correctCountRef.current = cells.filter((c) => results[c.char] === "correct").length;
    const endRunEarly = () => {
        holdStopwatch();
        // An open canvas is discarded unchecked: ending early sends no further marks.
        setOpenIndex(null);
        setGaveUpCorrect(correctCountRef.current);
        setPopupMinimized(false);
        setPhase("ended");
    };
    const handleGiveUp = () => {
        void confirm("The run ends now and every character is revealed. It won't count for a medal or your personal best.", {
            title: "Give up this grid?",
            confirmText: "Give up",
            cancelText: "Keep writing",
        }).then((ok) => {
            const live = phaseRef.current;
            if (!ok || (live !== "arrange" && live !== "write")) return;
            endRunEarly();
        });
    };

    // The flp break's Leave (docs/FLP_GAME_BREAKS.md § 2): a live run ends with what it
    // wrote; before one has started there is nothing to show, so the break closes.
    const leaveBreak = () => {
        if (running) {
            setLeftDuringArrange(phase === "arrange");
            endRunEarly();
        } else if (phase !== "ended") {
            onDone();
        }
    };
    const onExitRequest = isBreak ? leaveBreak : onDone;

    // A break's run reports to the flp instead of showing the end popup, which is what
    // starts the shrink back to the card. Read on the commit that entered "ended", where
    // `personalBest.best` is still the best from before this run.
    useEffect(() => {
        if (!isBreak || phase !== "ended") return;
        const bestBefore = personalBest.best;
        const heading = medal ? `${MEDAL_LABEL[medal]}!` : "Finished!";
        onRunEnded?.({
            title: gaveUp ? "Run ended" : heading,
            score: gaveUp
                ? `${gaveUpCorrect} of ${cells.length} written`
                : `All ${cells.length} written in ${formatTimeMs(finalMs)}`,
            details: [],
            personalBest: gaveUp
                ? Promise.resolve(null)
                : newBestRef.current.then((isNew) => {
                    const best = isNew ? finalMs : bestBefore;
                    return best === null ? null : { game: GAME_ID, best, isNewBest: isNew };
                }),
        });
        // Once per run: the board and the clock cannot move after the run ends.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isBreak, phase]);

    const playAgain = () => {
        personalBest.reset();
        setPopupMinimized(false);
        setLoadNonce((n) => n + 1);
    };

    const openCell = openIndex !== null ? cells[openIndex] : null;
    // "countdown" is the board's read-only Phase 1: the same picture as "arrange", no drag.
    const boardPhase: BoardPhase = phase === "loading" || phase === "empty" || leftDuringArrange ? "countdown" : phase;
    const showsPhase1 = boardPhase === "countdown" || boardPhase === "arrange";

    return (
        <Frame
            title="Writing Grid"
            onExitRequest={onExitRequest}
            headerRight={
                // Only while the stopwatch runs: nothing to give up during the countdown,
                // and the End popup owns replay / exit once the run is over.
                running ? (
                    <HeaderToggleChip className="writing-grid__give-up" active={false} onClick={handleGiveUp}>
                        give up
                    </HeaderToggleChip>
                ) : undefined
            }
        >
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
                    <Button className="writing-grid__empty-back" variant="outlined" onClick={onDone} sx={{ textTransform: "none" }}>
                        Back to {doneLabel}
                    </Button>
                </GameCentered>
            )}

            {phase !== "loading" && phase !== "empty" && (
                <GameFrame className="writing-grid__frame" sx={{ touchAction: "none" }}>
                    {/* In a break the strip IS the study header's row, so the phase shares a
                        line with Leave's arrow and the board starts below both. */}
                    <GameHud
                        className="writing-grid__phase-strip"
                        sx={{
                            justifyContent: "flex-end",
                            ...(isBreak && {
                                boxSizing: "border-box",
                                height: GAME_FRAME_EXIT_CLEARANCE_PX,
                                padding: `${DENSE_HEADER_PAD_TOP_PX}px ${DENSE_HEADER_PAD_X_PX}px 0`,
                            }),
                        }}
                    >
                        <GameHudLabel className="writing-grid__phase">
                            {showsPhase1 ? "Phase 1" : "Phase 2"}
                        </GameHudLabel>
                    </GameHud>

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
                        sx={{ p: 2, pt: 0, visibility: showsPhase1 ? "visible" : "hidden" }}
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

            {phase === "ended" && !isBreak && (
                <GameEndPopup
                    classPrefix="writing-grid"
                    minimized={popupMinimized}
                    onMinimize={() => setPopupMinimized(true)}
                    onRestore={() => setPopupMinimized(false)}
                >
                    <Typography className="writing-grid__popup-title" sx={{ fontSize: SIZE.heading, fontWeight: WEIGHT.bold, color: COLORS.onSurface }}>
                        {gaveUp ? "Gave up" : medal ? `${MEDAL_LABEL[medal]}!` : "Finished!"}
                    </Typography>
                    {gaveUp ? (
                        // A given-up run has no time worth reporting — say how far it got.
                        <Typography className="writing-grid__popup-progress" sx={{ fontSize: SIZE.bodyLg, color: COLORS.onSurface }}>
                            {gaveUpCorrect} of {cells.length} written
                        </Typography>
                    ) : (
                        <>
                            <Typography className="writing-grid__popup-time" sx={{ fontSize: SIZE.heading, fontWeight: WEIGHT.bold, color: COLORS.onSurface }}>
                                {formatTimeMs(finalMs)}
                            </Typography>
                            <PersonalBestLine game="writing-grid" best={personalBest.best} isNewBest={personalBest.isNewBest} className="writing-grid__personal-best" />
                        </>
                    )}
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
                            onClick={onDone}
                            sx={{ py: 1, borderRadius: "14px", textTransform: "none", fontWeight: WEIGHT.medium }}
                        >
                            Back to {doneLabel}
                        </Button>
                    </Box>
                </GameEndPopup>
            )}
        </Frame>
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

export default WritingGridStage;
