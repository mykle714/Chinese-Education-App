import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { Button, Typography } from "@mui/material";
import { GameCentered, GameFrame } from "../shared/GameFrame";
import { GAME_FRAME_EXIT_ARROW_BOTTOM_PX } from "../shared/gameFrameExit";
import { useBackgroundPause } from "../runtime/useBackgroundPause";
import { usePersonalBest } from "../shared/usePersonalBest";
import DelayedCircularProgress from "../../components/DelayedCircularProgress";
import { loadGlyph } from "../../components/handwriting/GlyphSvg";
import { useAuth } from "../../AuthContext";
import { markFlashcard } from "../../api/flashcards";
import { dealSuperposition, type SuperpositionWord } from "../../api/superposition";
import type { WritingGridDealRequest } from "../../api/writingGrid";
import { useTTS } from "../../hooks/useTTS";
import { formatTimeMs } from "../../utils/timeUtils";
import { WRITING_LEVEL_COUNT } from "../../../server/contracts/writingLevels";
import { BACK_ARROW_PX } from "../../components/pageHeaderSizing";
import { buildTiles, lockFinishedStacks, moveTile, pickHintPair, scatterTiles, stackKey, type BoardCharacter, type Tile } from "./board";
import SuperpositionBoard from "./SuperpositionBoard";
import SuperpositionExitButton from "./SuperpositionExitButton";
import SuperpositionHintButton from "./SuperpositionHintButton";
import SuperpositionHints from "./SuperpositionHints";
import { GAME_ID, HINT_BUTTON_PX, HINT_COOLDOWN_SECONDS, LOOKALIKE_TOLERANCE_UNITS, SPAWN_MARGIN_UNITS, SPAWN_SPREAD_UNITS, TILE_UNITS } from "./constants";
import type { GameStageFrameProps } from "../types";
import type { FlpBreakResults } from "../flpBreak/types";

export interface SuperpositionStageProps {
    /** The break's chrome: `GameBreakFrame` in the flp (docs/FLP_GAME_BREAKS.md § 6). */
    Frame: ComponentType<GameStageFrameProps>;
    /** What the break's deals add (the seed, the focus rule). */
    dealRequest?: WritingGridDealRequest;
    /** The board prefetched for the break. Null = the Stage deals its own. */
    prefetchedWords?: SuperpositionWord[] | null;
    /** Close the break with no run to report. */
    onDone: () => void;
    /** The destination `onDone` names, for the empty screen's "Back to …". */
    doneLabel: string;
    /** FlpBreakStageProps `onRunEnded` — the run's one ending, the td flp's end card. */
    onRunEnded?: (results: FlpBreakResults) => void;
    /** FlpBreakStageProps `onCardCleared`. */
    onCardCleared?: (cardId: number) => void;
}

/** The hint button's top edge: on the Leave arrow's row, centred on the arrow. */
const HINT_TOP_PX = GAME_FRAME_EXIT_ARROW_BOTTOM_PX - (BACK_ARROW_PX + HINT_BUTTON_PX) / 2;
/** The gap between the hint button and the word info below it. */
const INFO_GAP_PX = 4;

/** The characters of a board, with their stroke data. Null if any failed to load. */
async function loadCharacters(words: readonly SuperpositionWord[]): Promise<BoardCharacter[] | null> {
    const dealt = words.flatMap((word) => word.characters);
    const chars = dealt.map((character) => character.char);
    // A separate chunk, so the table only loads with the game.
    const [glyphs, { default: strokeParts }] = await Promise.all([Promise.all(chars.map(loadGlyph)), import("./strokeParts.json")]);
    if (glyphs.some((glyph) => !glyph?.medians)) return null;
    const partsOf = strokeParts as Record<string, number[][]>;
    return chars.map((char, index) => ({
        char,
        strokes: glyphs[index]!.strokes,
        medians: glyphs[index]!.medians!,
        parts: partsOf[char],
        // Stored groups, sent only while FEATURE_FLAGS.superpositionStoredGroups is on.
        groups: dealt[index].strokeGroups,
    }));
}

/**
 * Superposition — every stroke of four characters is scattered on a snapping grid, and the
 * learner stacks them back into place (docs/SUPERPOSITION_GAME.md). BREAK-ONLY: the game
 * has no route of its own (src/games/registry.ts), so it runs only as an flp game break
 * (docs/FLP_GAME_BREAKS.md § 6).
 *
 * Flow: loading → (empty) → playing → (inspecting) → ended.
 *
 * A WIN does not end the run on the spot: it enters "inspecting", where the finished board
 * stays on screen, locked, so the learner can look over what they built. The → button in the
 * bottom-right corner (or the break's Leave) moves on to "ended", whose only ending is the
 * Deck Tower flp's end card (`onRunEnded`). There is no end popup. Leaving early skips
 * inspection.
 *
 * Untimed on screen: no clock is drawn and a run cannot be lost. The stopwatch still runs,
 * as ACCUMULATED active time so a backgrounded app is not billed, for the personal best.
 *
 * Each finished stack marks its character's own card, once a run: a stack pulled apart and
 * rebuilt does not mark again. All four finished ends the run.
 */
const SuperpositionStage: React.FC<SuperpositionStageProps> = ({
    Frame,
    dealRequest,
    prefetchedWords = null,
    onDone,
    doneLabel,
    onRunEnded,
    onCardCleared,
}) => {
    const onCardClearedRef = useRef(onCardCleared);
    onCardClearedRef.current = onCardCleared;
    const { isAuthenticated } = useAuth();
    const personalBest = usePersonalBest(GAME_ID, "default");
    const tts = useTTS();

    const [phase, setPhase] = useState<"loading" | "empty" | "playing" | "inspecting" | "ended">("loading");
    const [words, setWords] = useState<SuperpositionWord[]>([]);
    const [characters, setCharacters] = useState<BoardCharacter[]>([]);
    const [tiles, setTiles] = useState<Tile[]>([]);
    // The tile held in a drag. Stacks are judged without it, so finishing happens on the drop.
    const [liftedId, setLiftedId] = useState<number | null>(null);
    const [hintedTileIds, setHintedTileIds] = useState<number[]>([]);
    const [hintSecondsLeft, setHintSecondsLeft] = useState(0);
    const [finalMs, setFinalMs] = useState(0);
    // Set when the run ended through Leave: how many characters stood finished by then.
    const [leftWith, setLeftWith] = useState<number | null>(null);

    // ── Deal ─────────────────────────────────────────────────────────────────────
    // Keyed on isAuthenticated, never the token (CLAUDE.md "Never reload on token refresh").
    useEffect(() => {
        if (!isAuthenticated) return;
        let cancelled = false;
        setPhase("loading");
        const deal = prefetchedWords ? Promise.resolve(prefetchedWords) : dealSuperposition(dealRequest);
        deal
            .then(async (dealt) => {
                const loaded = await loadCharacters(dealt);
                if (cancelled) return;
                const playable = loaded !== null && loaded.length > 0;
                setWords(dealt);
                setCharacters(loaded ?? []);
                // Unplaced until the board measures itself (`handleMeasured`).
                setTiles(playable ? buildTiles(loaded, LOOKALIKE_TOLERANCE_UNITS) : []);
                markedRef.current = new Set();
                placedRef.current = false;
                setPlaced(false);
                setLiftedId(null);
                setHintedTileIds([]);
                setHintSecondsLeft(0);
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
    }, [isAuthenticated]);

    // ── Placement ────────────────────────────────────────────────────────────────
    // Until the board measures itself every tile sits at 0,0, which is not a stack anyone
    // built, so no hint is offered before `placed`. (Stacks are only judged on a drop, which
    // cannot happen before placement.)
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

    // A locked stack moves as one (`moveTile`), on top of the pile.
    const handleMove = useCallback((tileId: number, x: number, y: number) => {
        setTiles((current) => moveTile(current, tileId, x, y));
    }, []);

    // The drop is the one moment a stack can finish: any loose stack that now holds exactly a
    // character fuses into a locked stack. Both updates are functional, so this runs after the
    // drag's last `handleMove`.
    const handleLift = useCallback((tileId: number | null) => {
        setLiftedId(tileId);
        if (tileId === null) setTiles(lockFinishedStacks);
    }, []);

    // ── Stopwatch: accumulated ACTIVE time ───────────────────────────────────────
    const running = phase === "playing";
    const { paused: backgroundPaused } = useBackgroundPause(running);
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

    // ── Marks and the end ────────────────────────────────────────────────────────
    // A finished character is a locked stack, and a lock never opens, so a finish stands
    // for the rest of the run.
    const finishedChars = useMemo(
        () => new Set(tiles.flatMap((tile) => (tile.lock ? [characters[tile.lock.charIndex]?.char ?? ""] : []))),
        [tiles, characters]
    );
    const markedRef = useRef(new Set<string>());
    const newBestRef = useRef<Promise<boolean>>(Promise.resolve(false));
    // The personal best as it stood when the run was won. Inspection delays the break's report,
    // and by then `personalBest.best` may already hold this run's own time.
    const bestBeforeRunRef = useRef<number | null>(null);

    // ── Hint ─────────────────────────────────────────────────────────────────────
    // The cooldown counts down one second per commit and holds while the app is backgrounded.
    useEffect(() => {
        if (hintSecondsLeft <= 0 || backgroundPaused) return;
        const timer = window.setTimeout(() => setHintSecondsLeft((seconds) => seconds - 1), 1000);
        return () => window.clearTimeout(timer);
    }, [hintSecondsLeft, backgroundPaused]);

    // The hint reads the board at rest. A drag moves the held tile's x,y on every hover, so a
    // live read would re-judge mid-air: hovering the last tile over its partial stack puts
    // every open tile at one stackKey, `pickHintPair` finds no pair, and the button dims
    // until the drop. While a tile is lifted, the pair from before the lift stands. This uses
    // React's "store info from previous renders" pattern (setState during render, guarded so
    // it settles in one extra pass) rather than an effect, so the button never flashes.
    const liveHintPair = useMemo(
        () => (running && placed && liftedId === null ? pickHintPair(tiles) : null),
        [running, placed, liftedId, tiles]
    );
    const [restingHintPair, setRestingHintPair] = useState<[number, number] | null>(null);
    if (liftedId === null && liveHintPair !== restingHintPair) setRestingHintPair(liveHintPair);
    const hintPair = liftedId === null ? liveHintPair : restingHintPair;

    const showHint = () => {
        if (!hintPair) return;
        setHintedTileIds(hintPair);
        setHintSecondsLeft(HINT_COOLDOWN_SECONDS);
    };

    // The outline stays until the hint is taken: the two tiles dropped together, or either
    // one finished as part of another stack. Moving one elsewhere keeps it, because the
    // learner may still need to find the other.
    useEffect(() => {
        if (hintedTileIds.length === 0 || liftedId !== null) return;
        const hinted = tiles.filter((tile) => hintedTileIds.includes(tile.id));
        const joined = hinted.length === 2 && stackKey(hinted[0]) === stackKey(hinted[1]);
        if (joined || hinted.some((tile) => tile.lock)) setHintedTileIds([]);
    }, [tiles, liftedId, hintedTileIds]);

    const endRun = (leftEarlyWith: number | null) => {
        holdStopwatch();
        setFinalMs(accumulatedRef.current);
        setLeftWith(leftEarlyWith);
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
                        if (!result.suppressed && character.ownCard && !character.outsideFocus) onCardClearedRef.current?.(character.cardId);
                    })
                    .catch((err) => console.error(`[Superposition] writing mark failed → card ${character.cardId}:`, err));
            });
        if (boardCharacters.length > 0 && boardCharacters.every(({ char }) => finishedChars.has(char))) {
            // Won: stop the clock and record now, then hold the board for inspection.
            holdStopwatch();
            setFinalMs(accumulatedRef.current);
            setLeftWith(null);
            setLiftedId(null);
            setHintedTileIds([]);
            bestBeforeRunRef.current = personalBest.best;
            newBestRef.current = personalBest.record(accumulatedRef.current);
            setPhase("inspecting");
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [finishedChars, phase]);

    // Inspection over (the → button): the run reports to the td flp's end card.
    const finishInspecting = () => setPhase("ended");

    // The break's Leave: a live run ends with what stands finished; during inspection
    // it acts as the → button, so a won run is still reported.
    const leaveBreak = () => {
        if (running) endRun(finishedChars.size);
        else if (phase === "inspecting") finishInspecting();
        else if (phase !== "ended") onDone();
    };

    // The run reports to the flp (there is no end popup). A won run's best-before
    // was captured at the win (`bestBeforeRunRef`); a left run reports no best.
    useEffect(() => {
        if (phase !== "ended") return;
        const bestBefore = bestBeforeRunRef.current;
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
    }, [phase]);

    const speakWord = (word: SuperpositionWord) => {
        void tts.speakSentence(word.entryKey, word.pinyin ?? undefined);
    };

    return (
        <Frame title="Superposition" onExitRequest={leaveBreak}>
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

            {(phase === "playing" || phase === "inspecting" || phase === "ended") && (
                // The grid is the whole play area, so the panel's inset, corner and line go
                // (the break's frame already drops them; stated here so the board never
                // depends on that). The word info is drawn on the grid, starting below
                // Leave's arrow, top-left.
                <GameFrame className="superposition__frame" sx={{ touchAction: "none", margin: 0, borderRadius: 0, border: "none" }}>
                    <SuperpositionBoard
                        tiles={tiles}
                        hintedTileIds={hintedTileIds}
                        locked={phase !== "playing"}
                        info={
                            <>
                                <SuperpositionHints
                                    words={words}
                                    finishedChars={finishedChars}
                                    topInsetPx={HINT_TOP_PX + HINT_BUTTON_PX + INFO_GAP_PX}
                                    onSpeak={speakWord}
                                />
                                {/* Nothing left to hint once the board is complete. */}
                                {phase === "playing" && (
                                    <SuperpositionHintButton
                                        secondsLeft={hintSecondsLeft}
                                        ready={hintSecondsLeft === 0 && hintPair !== null}
                                        topPx={HINT_TOP_PX}
                                        onHint={showHint}
                                    />
                                )}
                            </>
                        }
                        onMeasured={handleMeasured}
                        onMove={handleMove}
                        onLift={handleLift}
                    />
                    {/* Inspection's exit: an "Exit →" pill that inflates in. */}
                    {phase === "inspecting" && <SuperpositionExitButton onClick={finishInspecting} />}
                </GameFrame>
            )}
        </Frame>
    );
};

export default SuperpositionStage;
