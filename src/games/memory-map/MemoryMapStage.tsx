import React, { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { Box, Button, Typography } from "@mui/material";
import { GAME_FRAME_EXIT_CLEARANCE_PX } from "../shared/gameFrameExit";
import {
    BREAK_END_HOLD_MS,
    BREAK_PROMPTS,
    GROWTH_TOAST_MS,
    PROMPT_AUDIO_GAP_MS,
} from "./constants";
import DelayedCircularProgress from "../../components/DelayedCircularProgress";
import ForeignText from "../../components/ForeignText";
import MinimizablePopup from "../../components/MinimizablePopup";
import MemoryMapWorld, { type ViewportSize } from "./MemoryMapWorld";
import MemoryMapPrompt from "./MemoryMapPrompt";
import { GameFrame } from "../shared/GameFrame";
import { useMemoryMapRun } from "./useMemoryMapRun";
import { useAuth } from "../../AuthContext";
import { DEFAULT_CHINESE_FONT_ID } from "../../types";
import { useTTS } from "../../hooks/useTTS";
import { isProvisional } from "../../utils/provisionalCards";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";
import type { MemoryMapResponse, MemoryMapWord as MemoryMapWordData } from "../../api/memoryMap";
import type { GameStageFrameProps } from "../types";
import type { FlpBreakResults } from "../flpBreak/types";
import type { RunTally } from "./types";

const TITLE = "Memory Map";

export interface MemoryMapStageProps {
    /** The break's chrome — `GameBreakFrame` in the flp (FLP_GAME_BREAKS.md § 6). */
    Frame: ComponentType<GameStageFrameProps>;
    /** Close the break with no run to report (FlpBreakStageProps `onDone`). */
    onDone: () => void;
    /** The adapter's prefetched map, or null to fetch it here. */
    prefetched?: MemoryMapResponse | null;
    /** FlpBreakStageProps `onRunEnded`: hands the results to the flp's card. */
    onRunEnded?: (results: FlpBreakResults) => void;
    /** FlpBreakStageProps `onCardCleared`. */
    onCardCleared?: (cardId: number) => void;
}

/**
 * Memory Map's run (docs/MEMORY_MAP_GAME.md, FLP_GAME_BREAKS.md § 6). BREAK-ONLY: the game
 * has no route of its own (src/games/registry.ts), so its one host is an flp game break
 * (`src/games/flpBreak/memoryMapBreak.ts`): the learner's saved run, on their own map in
 * whatever state they left it, closed after `BREAK_PROMPTS` words are found — or fewer,
 * when fewer are left, which completes the map. A break that opens on a complete map
 * reshuffles it first (`useMemoryMapRun`), so the next break after a finish starts again
 * (MEMORY_MAP_GAME.md § 4a).
 *
 * Every rule about prompts, colours and marks lives in `useMemoryMapRun`; this file owns
 * chrome, selection, narration, the break's quota and the inspect popup.
 *
 * ── THERE IS NO WINNING AND NO LOSING ────────────────────────────────────────
 * No medals, no wins row, no `POST /api/users/me/wins`, and no personal best on the
 * break's results card. The only outputs a run has are the reading marks it
 * emits and the colours it leaves behind. That is the game.
 *
 * ── AND NO PAUSE-ON-BACKGROUND ───────────────────────────────────────────────
 * Every other game calls `useBackgroundPause`. Memory Map deliberately does NOT (Q22).
 * That rule exists to stop a CLOCK draining while the app is backgrounded; this game has
 * no clock and no timed state, so the pause would protect nothing.
 *
 * ── AND NO CARD BASELINE ─────────────────────────────────────────────────────
 * There is no entry in `CARD_BASELINES` and no provisional top-up (§ 10). A small library
 * is simply a small map. The break's adapter declines an empty map (`isPlayable`), so the
 * empty state below is only a defensive fallback.
 */
const MemoryMapStage: React.FC<MemoryMapStageProps> = ({
    Frame,
    onDone,
    prefetched = null,
    onRunEnded,
    onCardCleared,
}) => {
    const { user } = useAuth();

    // Latest-ref: the run hook calls this off a mark's response, which can land after a
    // re-render (or after the break has closed — useBreakClears passes it through).
    const onCardClearedRef = useRef(onCardCleared);
    onCardClearedRef.current = onCardCleared;

    const language = user?.selectedLanguage ?? "zh";

    // ── The game viewport (§ 2.4b, § 6a) ─────────────────────────────────────
    // Reported by MemoryMapWorld, which is mounted from the LOADING phase on (see the
    // render below) so the first fetch can send the viewport's shape. Null until measured.
    const [viewport, setViewport] = useState<ViewportSize | null>(null);
    const handleViewportChange = useCallback(
        (size: ViewportSize) => setViewport(size.width > 0 && size.height > 0 ? size : null),
        []
    );
    const viewportAspect = viewport ? viewport.width / viewport.height : null;

    const run = useMemoryMapRun(user?.id, language, {
        prefetched,
        viewportAspect,
        // A correct, recorded mark on the learner's OWN card is the break's clear: it
        // leaves the Deck Tower and the working loop (FLP_GAME_BREAKS.md § 4a). A lent
        // card was never on either.
        onCorrectMarkRecorded: (word) => {
            if (!isProvisional(word)) onCardClearedRef.current?.(word.vocabEntryId);
        },
    });
    // Narration: the committed word on every answer (§ 3.3b), and the new target's
    // pronunciation each time a prompt appears (§ 3.1a). Both are AUTOMATIC
    // (`autoSpeakSentence`), so the app-wide autoplay setting mutes them. The prompt bar's
    // speaker (`replayTarget`) is the one MANUAL call and speaks in every mode.
    const tts = useTTS();
    // `useTTS()` returns a fresh object every render; the prompt-autoplay effect reads it
    // through this ref so it can key on the target alone (docs/AUDIO_PLAYBACK.md § 1 —
    // an autoplay effect must key on content identity only).
    const ttsRef = useRef(tts);
    ttsRef.current = tts;
    // The answer narration still playing, if any — the next prompt's word waits for it.
    const answerAudioRef = useRef<Promise<void> | null>(null);

    // The word whose definition popup is open. Tapping a COLOURED word opens this at
    // any time, including mid-prompt, and never burns a try (§ 3.4).
    const [inspecting, setInspecting] = useState<MemoryMapWordData | null>(null);

    // The growth toast auto-dismisses; it is an announcement, not a decision.
    useEffect(() => {
        if (run.newlyPlaced.length === 0) return;
        const timer = window.setTimeout(run.dismissGrowthToast, GROWTH_TOAST_MS);
        return () => window.clearTimeout(timer);
    }, [run.newlyPlaced, run.dismissGrowthToast]);

    // ── The break's quota (MEMORY_MAP_GAME.md § 4a) ──────────────────────────
    //
    // The run is the saved one, so "found this break" is counted against the outcomes the
    // run already held when it opened: every resolution adds exactly one new id. Captured
    // on the first `playing` render, which is after any complete-map reshuffle.
    const openingOutcomesRef = useRef<Set<string> | null>(null);
    if (run.phase === "playing" && openingOutcomesRef.current === null) {
        openingOutcomesRef.current = new Set(Object.keys(run.outcomes));
    }
    const breakTally = useMemo<RunTally>(() => {
        const counts: RunTally = { green: 0, orange: 0, red: 0 };
        const opening = openingOutcomesRef.current;
        if (!opening) return counts;
        for (const [id, outcome] of Object.entries(run.outcomes)) {
            if (!opening.has(id)) counts[outcome]++;
        }
        return counts;
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the ref is set before outcomes can change
    }, [run.outcomes, run.phase]);
    const found = breakTally.green + breakTally.orange + breakTally.red;
    /** Words on the map still uncoloured — the most this break can still ask. */
    const uncoloured = run.words.filter((w) => !run.outcomes[w.vocabEntryId]).length;
    /** This break's target: five, or whatever is left of the map. */
    const goal = Math.min(BREAK_PROMPTS, found + uncoloured);
    /** The break has stopped taking answers and is about to close. */
    const [ending, setEnding] = useState<"done" | "left" | null>(null);

    /**
     * The word ARMED by a first tap and awaiting its confirming tap (§ 3.3a).
     *
     * ── WHY SELECTION LIVES HERE AND NOT IN THE RUN HOOK ─────────────────────
     * It is an input affordance, not a game rule: nothing about it is saved, restored,
     * marked or scored, and the hook's contract ("a tap on this word is an answer") is
     * unchanged — the Stage simply decides WHICH tap gets to make that call. Putting it
     * in `useMemoryMapRun` would drag a pointer-interaction concept into the state
     * machine that owns prompts and marks, and would land it in the saved run.
     */
    const [selectedId, setSelectedId] = useState<number | null>(null);

    /**
     * The word finder's text (§ 3.7). Lives here, beside the selection, for the same
     * reason: an input affordance with nothing to save, mark or score.
     */
    const [finderQuery, setFinderQuery] = useState("");

    // A selection belongs to ONE prompt. When the target changes — answered or skipped —
    // anything still armed is stale, and leaving it armed would mean the
    // player's next single tap answered the NEW question, which is the accident this
    // whole mechanism exists to prevent.
    //
    // The word finder clears on the same beat (owner, 2026-11-04): a search written for
    // the last prompt would otherwise sit there lighting words for the next one.
    useEffect(() => {
        setSelectedId(null);
        setFinderQuery("");
    }, [run.target?.vocabEntryId]);

    /**
     * A tap on a word.
     *
     * ── THE FIRST TAP SELECTS; THE SECOND ANSWERS (§ 3.3a) ───────────────────
     * The map is dense and the words are small (all fifty fitted on one screen since
     * the camera became fixed), so a single-tap answer meant a fumbled touch could burn a
     * try — or resolve the prompt orange — with no chance to take it back. Arming the
     * word first makes every answer a deliberate act: tap once to point, tap the SAME
     * word again to commit. Tapping a different word moves the arming; tapping open
     * water drops it (`handleTapWater`).
     *
     * Two taps stay single, and both for the same reason — there is nothing to take
     * back:
     *   • a COLOURED word only opens its definition (§ 3.4), which burns no try;
     *   • the FAILED prompt's pulsing target only locks in a red that is already
     *     decided, so confirming it would be ceremony over a foregone conclusion.
     *
     * The coloured/uncoloured split happens HERE rather than in the hook, because what
     * a coloured word does is a UI affordance (open a popup) rather than a game rule.
     * The rule the hook enforces is only that a coloured word is never an answer.
     */
    const handleTapWord = (word: MemoryMapWordData) => {
        // A closing break takes no more answers (its last colour is landing).
        if (ending) return;
        if (run.outcomes[word.vocabEntryId]) {
            setInspecting(word);
            setSelectedId(null);
            return;
        }

        // Arm it, unless this tap is the confirmation of a word already armed or the
        // lock-in tap on a failed prompt's target (neither of which can cost anything).
        const isLockIn =
            run.promptPhase === "failed" && word.vocabEntryId === run.target?.vocabEntryId;
        if (!isLockIn && selectedId !== word.vocabEntryId) {
            setSelectedId(word.vocabEntryId);
            return;
        }

        setSelectedId(null);
        const result = run.tapWord(word);
        if (result === "ignored") return;
        // Narration is the only sound on a tap — the app has no answer-feedback sound.
        speakWord(word);
    };

    /**
     * Say the word the player just committed to (§ 3.3b).
     *
     * ── WHY THE COMMITTED WORD AND NOT THE TARGET ────────────────────────────
     * On a correct tap the two are the same word. On a WRONG one, speaking the tapped
     * word is what makes the mistake legible: the prompt bar is showing the target's
     * pronunciation, so hearing something else is the answer to "why was that wrong?".
     * Speaking the target there would instead hand over the answer the player still has
     * tries to find.
     *
     * ── WHY `speakSentence` AND NOT `speak` ──────────────────────────────────
     * `useTTS.speak` takes a `VocabEntry` so it can run `resolveDisplayPronunciation`.
     * A `MemoryMapWord` is not one — the server already resolved the sense when it built
     * the placement, so `word.pronunciation` IS the reading on screen, and the
     * arbitrary-text entry point is the one that accepts it (AddNewCardsPage does the
     * same for the same reason).
     *
     * Fire-and-forget with a `.catch`: narration failing must never break an answer, and
     * `useTTS` already falls back cloud → browser internally.
     */
    function speakWord(word: MemoryMapWordData) {
        // Synchronous, from inside the real pointer gesture: primes the shared
        // AudioContext so mobile autoplay policy does not swallow the first play of the
        // session, which resolves only after an await.
        tts.unlockAudio();
        // autoSpeakSentence: answer feedback is automatic narration, so the
        // autoplay setting gates it inside the hook. Its promise settles when the sound
        // ENDS (AUDIO_PLAYBACK.md § 4), which is what lets the next prompt wait for it.
        const playing: Promise<void> = tts
            .autoSpeakSentence(word.entryKey, word.pronunciation ?? undefined)
            .then(
                () => {},
                () => {}
            )
            .finally(() => {
                if (answerAudioRef.current === playing) answerAudioRef.current = null;
            });
        answerAudioRef.current = playing;
    }

    /**
     * Autoplay the target's pronunciation whenever a new prompt appears (§ 3.1a) — the
     * first prompt on load or resume, and each one after an answer, skip or restart.
     *
     * ── KEYED ON THE TARGET ALONE ────────────────────────────────────────────
     * Deps are the target's identity and the run phase, never the autoplay setting:
     * switching the chip to `default` must not narrate the prompt already on screen
     * (AUDIO_PLAYBACK.md § 1, "Changing the mode must not make a sound"). Muting
     * mid-word is handled once inside `useTTS`.
     *
     * ── AFTER THE ANSWER, NOT OVER IT ────────────────────────────────────────
     * A correct commit speaks the committed word AND advances the target in the same
     * tap. Speaking the new target straight away would cancel the answer narration
     * (every speak cancels the one before it), so when one is in flight this waits for
     * it to end, then leaves `PROMPT_AUDIO_GAP_MS` of silence. The cleanup's `cancelled`
     * flag drops a pending word whose prompt has already moved on (a quick skip), and
     * absorbs StrictMode's double-invoke.
     *
     * ── NOT AFTER A BREAK'S LAST WORD ────────────────────────────────────────
     * When that answer met the break's quota the map is closing; the next target is
     * never asked here, so it is not spoken either (`ending`).
     *
     * ── IT GIVES NOTHING AWAY ────────────────────────────────────────────────
     * The prompt bar already prints the target's pinyin outright (§ 3.1, Q11
     * superseded), so hearing it adds the sound of what is on screen, not a hint about
     * where the word is. This is why Memory Map autoplays on every run, unlike Bubble
     * Match / Bucket Drop's reading runs, where the audio WOULD hand over the
     * pronunciation being tested.
     *
     * No gesture unlock here: the prompt can land with no tap in its call stack (a load
     * resolves after an await). The app-wide pointerdown listener has primed the sinks
     * from the tap that opened the game (AUDIO_PLAYBACK.md § 5); on iOS a suspended
     * AudioContext (`media` route) may still drop the very first word until the next tap.
     */
    const targetId = run.target?.vocabEntryId ?? null;
    const quotaMet = found >= goal && found > 0;
    useEffect(() => {
        if (run.phase !== "playing" || targetId === null || quotaMet) return;
        const target = run.target;
        if (!target) return;
        let cancelled = false;
        const pendingAnswer = answerAudioRef.current;
        void (async () => {
            if (pendingAnswer) {
                await pendingAnswer;
                await new Promise((resolve) => window.setTimeout(resolve, PROMPT_AUDIO_GAP_MS));
            }
            if (cancelled) return;
            await ttsRef.current
                .autoSpeakSentence(target.entryKey, target.pronunciation ?? undefined)
                .catch(() => {});
        })();
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on target identity only (see above)
    }, [run.phase, targetId]);

    /**
     * The prompt bar's speaker: replay the target's word (§ 3.1a). MANUAL narration
     * (`speakSentence`, not `autoSpeakSentence`), so it speaks even when the autoplay setting
     * says mute — the speaker is the learner's explicit request (AUDIO_PLAYBACK.md § 4).
     * The speaker's spinner reads `speakingKey`, which `useTTS` sets for any narration
     * that actually RUNS — so it also lights while the prompt's autoplay is sounding the
     * same word, and stays dark when a muted autoplay was suppressed.
     */
    function replayTarget() {
        const target = run.target;
        if (!target) return;
        tts.unlockAudio();
        void tts.speakSentence(target.entryKey, target.pronunciation ?? undefined).catch(() => {});
    }

    /** A tap on open water disarms — the map's "never mind" (§ 3.3a). */
    const handleTapWater = useCallback(() => setSelectedId(null), []);

    // ── Ending a break (FLP_GAME_BREAKS.md § 5b) ─────────────────────────────
    //
    // The quota met, or the map coloured (fewer than five were left): hold on the map
    // for a beat so the last colour lands, then report. Leave with words found reports
    // at once. Once per Stage — the flp shrinks the game back onto the break's card.
    useEffect(() => {
        if (ending) return;
        if (quotaMet || (run.phase === "complete" && found > 0)) setEnding("done");
    }, [ending, quotaMet, run.phase, found]);

    const reportedRef = useRef(false);
    useEffect(() => {
        if (!ending || reportedRef.current) return;
        const report = () => {
            if (reportedRef.current) return;
            reportedRef.current = true;
            const mapDone = uncoloured === 0;
            onRunEnded?.({
                title: ending === "left" ? "Run ended" : mapDone ? "Map complete!" : "Finished!",
                score: `${found} word${found === 1 ? "" : "s"} found`,
                details: [
                    `${breakTally.green} knew it · ${breakTally.orange} recovered · ${breakTally.red} missed`,
                    mapDone
                        ? "Your whole map is coloured. The next break starts it again."
                        : `${run.words.length - uncoloured}/${run.words.length} of your map coloured`,
                ],
                personalBest: Promise.resolve(null),
            });
        };
        if (ending === "left") {
            report();
            return;
        }
        const timer = window.setTimeout(report, BREAK_END_HOLD_MS);
        return () => window.clearTimeout(timer);
        // Reads the final tallies at report time; keyed on the decision only.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ending]);

    /**
     * The break's Leave. Nothing is lost by leaving: the run is the saved one and every
     * answer is already in it. So a break with words found reports them (the results
     * card), and one with none — or no map to play — simply closes.
     */
    const leaveBreak = useCallback(() => {
        if (ending) return;
        if (run.phase === "playing" && found > 0) {
            setEnding("left");
            return;
        }
        onDone();
    }, [ending, run.phase, found, onDone]);

    const playing = run.phase === "playing" || run.phase === "complete";

    const content = (
        <>
            {run.phase === "error" && (
                <Box className="memory-map-stage__error" sx={CENTERED_SX}>
                    <Typography sx={{ fontSize: SIZE.body, textAlign: "center" }}>
                        Your map couldn&apos;t be loaded. Check your connection and try again.
                    </Typography>
                </Box>
            )}

            {/* The one user-visible consequence of declaring no card baseline (§ 6). */}
            {run.phase === "empty" && (
                <Box className="memory-map-stage__empty" sx={CENTERED_SX}>
                    <Typography
                        sx={{ fontSize: SIZE.subtitle, fontWeight: WEIGHT.semibold, mb: 1, textAlign: "center" }}
                    >
                        Your map is empty
                    </Typography>
                    <Typography sx={{ fontSize: SIZE.body, mb: 3, textAlign: "center" }}>
                        Sort some cards and they&apos;ll appear here.
                    </Typography>
                </Box>
            )}

            {(playing || run.phase === "loading") && (
                /* `.play` — in a break `GameFrame` drops its panel and the map is the
                   screen. The growth
                   toast and the inspect popup below stay OUTSIDE it — both are overlays.

                   Mounted from LOADING on, with an empty prompt and an empty world, so the
                   world's viewport is measured before the map is fetched: the first load
                   sends its shape (the frame, § 2.4b), and only the real panel — inside the
                   frame, below the prompt — has the right one. The spinner sits over the
                   empty water. */
                /* No progress counter (owner, 2026-11-04): the map is
                   the whole screen. It floated top-left as `answered/total` from
                   2026-10-06 until then. */
                <GameFrame className="memory-map-stage__frame">
                    {/* The break draws Leave + the title top-left over the frame; the prompt
                        starts below that row, as the other break games' boards do. */}
                    <Box
                        className="memory-map-stage__exit-clearance"
                        sx={{ flexShrink: 0, height: GAME_FRAME_EXIT_CLEARANCE_PX }}
                    />
                    <MemoryMapPrompt
                        definition={playing ? run.target?.definition ?? null : null}
                        definitionClusters={playing ? run.target?.definitionClusters ?? null : null}
                        selectedSense={playing ? run.target?.selectedSense ?? null : null}
                        phase={run.promptPhase}
                        pronunciation={playing ? run.target?.pronunciation ?? null : null}
                        onSpeak={replayTarget}
                        speaking={run.target !== null && tts.speakingKey === run.target.entryKey}
                        onSkip={run.skipWord}
                        canSkip={playing && run.canSkip && !ending}
                        finderQuery={finderQuery}
                        onFinderChange={setFinderQuery}
                    />
                    <MemoryMapWorld
                        // While loading, the world is mounted EMPTY purely to be measured.
                        // (On a regenerate the old map would otherwise flash under the
                        // spinner and then jump to the new one.)
                        slots={playing ? run.slots : []}
                        words={playing ? run.words : []}
                        language={language}
                        fontKey={DEFAULT_CHINESE_FONT_ID}
                        outcomes={run.outcomes}
                        pulsingId={run.promptPhase === "failed" ? run.target?.vocabEntryId ?? null : null}
                        selectedId={selectedId}
                        flashing={run.flashing}
                        fading={run.fading}
                        finderQuery={finderQuery}
                        onTapWord={handleTapWord}
                        onTapWater={handleTapWater}
                        onViewportChange={handleViewportChange}
                    />
                    {run.phase === "loading" && (
                        <Box
                            className="memory-map-stage__loading"
                            sx={{
                                position: "absolute",
                                inset: 0,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                pointerEvents: "none",
                            }}
                        >
                            <DelayedCircularProgress />
                        </Box>
                    )}
                </GameFrame>
            )}

            {/* Growth toast (§ 2.5): without it the map's growth is invisible, which is
                the whole emotional point of a persistent map. No auto-pan — the words
                are placed where they are placed, and hunting for them is the game. */}
            {run.newlyPlaced.length > 0 && run.phase === "playing" && (
                <Box
                    className="memory-map-stage__growth-toast"
                    sx={{
                        position: "absolute",
                        bottom: 24,
                        left: "50%",
                        transform: "translateX(-50%)",
                        backgroundColor: COLORS.onSurface,
                        color: COLORS.background,
                        borderRadius: "999px",
                        padding: "8px 16px",
                        fontSize: SIZE.caption,
                        fontFamily: FONTS.sans,
                        pointerEvents: "none",
                    }}
                >
                    {run.newlyPlaced.length} new word{run.newlyPlaced.length === 1 ? "" : "s"} joined
                    your map
                </Box>
            )}

            {/* A coloured word's definition — reference, not an answer (§ 3.4). */}
            {inspecting && (
                <MinimizablePopup
                    classPrefix="memory-map-inspect"
                    corner="top-right"
                    onMinimize={() => setInspecting(null)}
                >
                    <Box className="memory-map-inspect__body" sx={{ textAlign: "center", p: 1 }}>
                        <ForeignText
                            text={inspecting.entryKey}
                            pronunciation={inspecting.pronunciation}
                            language={inspecting.language as never}
                            size="lg"
                            showPinyin
                            useToneColor
                        />
                        <Typography sx={{ fontSize: SIZE.body, color: COLORS.textSecondary, mt: 1.5 }}>
                            {inspecting.definition}
                        </Typography>
                        <Button
                            className="memory-map-inspect__close"
                            sx={{ mt: 2 }}
                            variant="outlined"
                            fullWidth
                            onClick={() => setInspecting(null)}
                        >
                            Close
                        </Button>
                    </Box>
                </MinimizablePopup>
            )}

        </>
    );

    return (
        <Frame title={TITLE} onExitRequest={leaveBreak}>
            {content}
        </Frame>
    );
};

/**
 * Shared layout for the two non-playing end states (error, empty). Loading draws over
 * the empty map panel instead (see the render above). The break's ground is the area's
 * white, so these keep the default ink.
 */
const CENTERED_SX = {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px",
} as const;

export default MemoryMapStage;
