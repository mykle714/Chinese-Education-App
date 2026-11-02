import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { Box, Button, Typography } from "@mui/material";
import { GameCentered, GameFrame } from "../shared/GameFrame";
import { GAME_FRAME_EXIT_ARROW_BOTTOM_PX } from "../shared/gameFrameExit";
import GameEndPopup from "../runtime/GameEndPopup";
import GamePausedOverlay from "../runtime/GamePausedOverlay";
import { useBackgroundPause } from "../runtime/useBackgroundPause";
import { usePersonalBest } from "../shared/usePersonalBest";
import PersonalBestLine from "../shared/PersonalBestLine";
import DelayedCircularProgress from "../../components/DelayedCircularProgress";
import { loadGlyph } from "../../components/handwriting/GlyphSvg";
import { useAuth } from "../../AuthContext";
import { markFlashcard } from "../../api/flashcards";
import { dealSuperposition, type SuperpositionWord } from "../../api/superposition";
import type { WritingGridDealRequest } from "../../api/writingGrid";
import { useTTS } from "../../hooks/useTTS";
import { formatTimeMs } from "../../utils/timeUtils";
import { COLORS } from "../../theme/colors";
import { SIZE, WEIGHT } from "../../theme/scale";
import { WRITING_LEVEL_COUNT } from "../../../server/contracts/writingLevels";
import { buildTiles, completedStacks, scatterTiles, type BoardCharacter, type Tile } from "./board";
import SuperpositionBoard from "./SuperpositionBoard";
import SuperpositionHints from "./SuperpositionHints";
import { GAME_ID, INK_MERGE_THRESHOLD, LOOKALIKE_TOLERANCE_UNITS, SPAWN_MARGIN_UNITS, SPAWN_SPREAD_UNITS, TILE_UNITS } from "./constants";
import type { GameStageFrameProps, GameStageHost } from "../types";
import type { FlpBreakResults } from "../flpBreak/types";

export interface SuperpositionStageProps {
    host: GameStageHost;
    /** The host's chrome: `GameLeafPage` on the route, `GameBreakFrame` in the flp. */
    Frame: ComponentType<GameStageFrameProps>;
    /** flp break only: what its deals add (the seed, the focus rule). */
    dealRequest?: WritingGridDealRequest;
    /** flp break only: the board prefetched for it. Null = the Stage deals its own. */
    prefetchedWords?: SuperpositionWord[] | null;
    /** The page's Back; a break's close with no run to report. */
    onDone: () => void;
    /** The destination `onDone` names, for "Back to …". */
    doneLabel: string;
    /** flp break only: FlpBreakStageProps `onRunEnded`. Replaces the end popup. */
    onRunEnded?: (results: FlpBreakResults) => void;
    /** flp break only: FlpBreakStageProps `onCardCleared`. */
    onCardCleared?: () => void;
}

/** The characters of a board, with their stroke data. Null if any failed to load. */
async function loadCharacters(words: readonly SuperpositionWord[]): Promise<BoardCharacter[] | null> {
    const chars = words.flatMap((word) => word.characters.map((character) => character.char));
    // A separate chunk, so the table only loads with the game.
    const [glyphs, { default: strokeParts }] = await Promise.all([Promise.all(chars.map(loadGlyph)), import("./strokeParts.json")]);
    if (glyphs.some((glyph) => !glyph?.medians)) return null;
    const partsOf = strokeParts as Record<string, number[][]>;
    return chars.map((char, index) => ({
        char,
        strokes: glyphs[index]!.strokes,
        medians: glyphs[index]!.medians!,
        parts: partsOf[char],
    }));
}

/**
 * Superposition — every stroke of four characters is scattered on a snapping grid, and the
 * learner stacks them back into place (docs/SUPERPOSITION_GAME.md). Runs on its route and
 * as an flp game break (docs/FLP_GAME_BREAKS.md § 6).
 *
 * Flow: loading → (empty) → playing → ended.
 *
 * Untimed on screen: no clock is drawn and a run cannot be lost. The stopwatch still runs,
 * as ACCUMULATED active time so a backgrounded app is not billed, for the personal best.
 *
 * Each finished stack marks its character's own card, once a run: a stack pulled apart and
 * rebuilt does not mark again. All four finished ends the run.
 */
const SuperpositionStage: React.FC<SuperpositionStageProps> = ({
    host,
    Frame,
    dealRequest,
    prefetchedWords = null,
    onDone,
    doneLabel,
    onRunEnded,
    onCardCleared,
}) => {
    const isBreak = host === "flpBreak";
    const onCardClearedRef = useRef(onCardCleared);
    onCardClearedRef.current = onCardCleared;
    const { isAuthenticated } = useAuth();
    const personalBest = usePersonalBest(GAME_ID, "default");
    const tts = useTTS();

    const [phase, setPhase] = useState<"loading" | "empty" | "playing" | "ended">("loading");
    const [words, setWords] = useState<SuperpositionWord[]>([]);
    const [characters, setCharacters] = useState<BoardCharacter[]>([]);
    const [tiles, setTiles] = useState<Tile[]>([]);
    // The tile held in a drag. Stacks are judged without it, so finishing happens on the drop.
    const [liftedId, setLiftedId] = useState<number | null>(null);
    const [loadNonce, setLoadNonce] = useState(0);
    const [finalMs, setFinalMs] = useState(0);
    const [popupMinimized, setPopupMinimized] = useState(false);
    // Set when the run ended through Leave: how many characters stood finished by then.
    const [leftWith, setLeftWith] = useState<number | null>(null);

    // ── Deal ─────────────────────────────────────────────────────────────────────
    // Keyed on isAuthenticated, never the token (CLAUDE.md "Never reload on token refresh").
    useEffect(() => {
        if (!isAuthenticated) return;
        let cancelled = false;
        setPhase("loading");
        const deal = prefetchedWords && loadNonce === 0 ? Promise.resolve(prefetchedWords) : dealSuperposition(dealRequest);
        deal
            .then(async (dealt) => {
                const loaded = await loadCharacters(dealt);
                if (cancelled) return;
                const playable = loaded !== null && loaded.length > 0;
                setWords(dealt);
                setCharacters(loaded ?? []);
                // Unplaced until the board measures itself (`handleMeasured`).
                setTiles(playable ? buildTiles(loaded, LOOKALIKE_TOLERANCE_UNITS, INK_MERGE_THRESHOLD) : []);
                markedRef.current = new Set();
                placedRef.current = false;
                setPlaced(false);
                setLiftedId(null);
                setLeftWith(null);
                setPhase(playable ? "playing" : "empty");
            })
            .catch((err) => {
                console.error("[Superposition] deal failed", err);
                if (!cancelled) setPhase("empty");
            });
        return () => {
            cancelled = true;
        };
        // The request and the prefetch are fixed for a Stage's life.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAuthenticated, loadNonce]);

    // ── Placement ────────────────────────────────────────────────────────────────
    // Until the board measures itself every tile sits at 0,0, which is not a stack anyone
    // built, so nothing is judged before `placed`.
    const placedRef = useRef(false);
    const [placed, setPlaced] = useState(false);
    const handleMeasured = useCallback((cols: number, rows: number, infoRows: number) => {
        // Once per deal: a later resize must not reshuffle a board in progress.
        if (placedRef.current) return;
        placedRef.current = true;
        setTiles((current) => scatterTiles(current, cols, rows, TILE_UNITS, {
            marginUnits: SPAWN_MARGIN_UNITS,
            topUnits: infoRows + SPAWN_MARGIN_UNITS,
            spreadUnits: SPAWN_SPREAD_UNITS,
        }));
        setPlaced(true);
    }, []);

    const handleMove = useCallback((tileId: number, x: number, y: number) => {
        setTiles((current) => {
            const moved = current.find((tile) => tile.id === tileId);
            if (!moved || (moved.x === x && moved.y === y)) return current;
            // Moves to the top of the pile, and z values stay a compact 0..n-1.
            return current.map((tile) => {
                if (tile.id === tileId) return { ...tile, x, y, z: current.length - 1 };
                return tile.z > moved.z ? { ...tile, z: tile.z - 1 } : tile;
            });
        });
    }, []);

    // ── Stopwatch: accumulated ACTIVE time ───────────────────────────────────────
    const running = phase === "playing";
    const { paused: backgroundPaused, resume: resumeFromBackground } = useBackgroundPause(running);
    const accumulatedRef = useRef(0);
    const runningSinceRef = useRef<number | null>(null);
    const holdStopwatch = () => {
        if (runningSinceRef.current !== null) accumulatedRef.current += Date.now() - runningSinceRef.current;
        runningSinceRef.current = null;
    };
    useEffect(() => {
        if (!running) return;
        if (backgroundPaused) holdStopwatch();
        else if (runningSinceRef.current === null) runningSinceRef.current = Date.now();
    }, [backgroundPaused, running]);
    useEffect(() => {
        if (loadNonce > 0) accumulatedRef.current = 0;
    }, [loadNonce]);

    // ── Marks and the end ────────────────────────────────────────────────────────
    const stacks = useMemo(() => (placed ? completedStacks(tiles, liftedId) : new Map<string, number>()), [placed, tiles, liftedId]);
    const finishedStackKeys = useMemo(() => new Set(stacks.keys()), [stacks]);
    const finishedChars = useMemo(() => new Set(Array.from(stacks.values(), (index) => characters[index]?.char ?? "")), [stacks, characters]);
    const markedRef = useRef(new Set<string>());
    const newBestRef = useRef<Promise<boolean>>(Promise.resolve(false));

    const endRun = (leftEarlyWith: number | null) => {
        holdStopwatch();
        setFinalMs(accumulatedRef.current);
        setLeftWith(leftEarlyWith);
        setPopupMinimized(false);
        setPhase("ended");
    };

    useEffect(() => {
        if (phase !== "playing") return;
        const boardCharacters = words.flatMap((word) => word.characters);
        boardCharacters
            .filter((character) => finishedChars.has(character.char) && !markedRef.current.has(character.char))
            .forEach((character) => {
                markedRef.current.add(character.char);
                // The top level, so the mark clears the anti-farming gate as a full
                // writing mark; only a character at full mastery (or resting) drops it.
                markFlashcard({
                    cardId: character.cardId,
                    isCorrect: true,
                    type: "writing",
                    surface: GAME_ID,
                    writing: { level: WRITING_LEVEL_COUNT, perChar: [true] },
                })
                    .then((result) => {
                        if (!result.suppressed && character.ownCard && !character.outsideFocus) onCardClearedRef.current?.();
                    })
                    .catch((err) => console.error(`[Superposition] writing mark failed → card ${character.cardId}:`, err));
            });
        if (boardCharacters.length > 0 && boardCharacters.every(({ char }) => finishedChars.has(char))) {
            endRun(null);
            newBestRef.current = personalBest.record(accumulatedRef.current);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [finishedChars, phase]);

    // The flp break's Leave: a live run ends with what stands finished.
    const leaveBreak = () => {
        if (running) endRun(finishedChars.size);
        else if (phase !== "ended") onDone();
    };

    // A break reports to the flp instead of showing the end popup. Read on the commit that
    // entered "ended", where `personalBest.best` is still the best from before this run.
    useEffect(() => {
        if (!isBreak || phase !== "ended") return;
        const bestBefore = personalBest.best;
        const left = leftWith !== null;
        onRunEnded?.({
            title: left ? "Run ended" : "Finished!",
            score: left
                ? `${leftWith} of ${characters.length} built`
                : `All ${characters.length} built in ${formatTimeMs(finalMs)}`,
            details: [],
            personalBest: left
                ? Promise.resolve(null)
                : newBestRef.current.then((isNew) => {
                    const best = isNew ? finalMs : bestBefore;
                    return best === null ? null : { game: GAME_ID, best, isNewBest: isNew };
                }),
        });
        // Once per run.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isBreak, phase]);

    const playAgain = () => {
        personalBest.reset();
        setPopupMinimized(false);
        setLoadNonce((n) => n + 1);
    };

    const speakWord = (word: SuperpositionWord) => {
        void tts.speakSentence(word.entryKey, word.pinyin ?? undefined);
    };

    return (
        <Frame title="Superposition" onExitRequest={isBreak ? leaveBreak : onDone}>
            {phase === "loading" && (
                <GameCentered className="superposition__loading">
                    <DelayedCircularProgress className="superposition__spinner" />
                </GameCentered>
            )}

            {phase === "empty" && (
                <GameCentered className="superposition__empty">
                    <Typography className="superposition__empty-message">
                        No characters to build yet — add some Chinese cards first.
                    </Typography>
                    <Button className="superposition__empty-back" variant="outlined" onClick={onDone} sx={{ textTransform: "none" }}>
                        Back to {doneLabel}
                    </Button>
                </GameCentered>
            )}

            {(phase === "playing" || phase === "ended") && (
                // The grid is the whole play area, so the panel's inset, corner and line go on
                // the route too; a break's frame already drops them. The word info is drawn
                // on the grid, and in a break it starts below Leave's arrow, top-left.
                <GameFrame className="superposition__frame" sx={{ touchAction: "none", margin: 0, borderRadius: 0, border: "none" }}>
                    <SuperpositionBoard
                        tiles={tiles}
                        finishedStacks={finishedStackKeys}
                        liftedId={liftedId}
                        locked={phase === "ended"}
                        info={
                            <SuperpositionHints
                                words={words}
                                finishedChars={finishedChars}
                                topInsetPx={isBreak ? GAME_FRAME_EXIT_ARROW_BOTTOM_PX : 4}
                                onSpeak={speakWord}
                            />
                        }
                        onMeasured={handleMeasured}
                        onMove={handleMove}
                        onLift={setLiftedId}
                    />
                </GameFrame>
            )}

            {phase === "ended" && !isBreak && (
                <GameEndPopup
                    classPrefix="superposition"
                    minimized={popupMinimized}
                    onMinimize={() => setPopupMinimized(true)}
                    onRestore={() => setPopupMinimized(false)}
                >
                    <Typography className="superposition__popup-title" sx={{ fontSize: SIZE.heading, fontWeight: WEIGHT.bold, color: COLORS.onSurface }}>
                        Finished!
                    </Typography>
                    <Typography className="superposition__popup-time" sx={{ fontSize: SIZE.heading, fontWeight: WEIGHT.bold, color: COLORS.onSurface }}>
                        {formatTimeMs(finalMs)}
                    </Typography>
                    <PersonalBestLine game={GAME_ID} best={personalBest.best} isNewBest={personalBest.isNewBest} className="superposition__personal-best" />
                    <Box className="superposition__popup-actions" sx={{ display: "flex", flexDirection: "column", gap: 1.25, width: "100%" }}>
                        <Button className="superposition__popup-again" variant="contained" onClick={playAgain} sx={{ py: 1.25, borderRadius: "14px", textTransform: "none", fontWeight: WEIGHT.bold }}>
                            Play Again
                        </Button>
                        <Button className="superposition__popup-back" variant="outlined" onClick={onDone} sx={{ py: 1, borderRadius: "14px", textTransform: "none", fontWeight: WEIGHT.medium }}>
                            Back to {doneLabel}
                        </Button>
                    </Box>
                </GameEndPopup>
            )}

            <GamePausedOverlay open={backgroundPaused} onResume={resumeFromBackground} classPrefix="superposition" />
        </Frame>
    );
};

export default SuperpositionStage;
