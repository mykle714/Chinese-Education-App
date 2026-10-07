import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Button, Typography } from "@mui/material";
import { GameLeafPage } from "../shared/GameSurface";
import { ON_ACCENT_INK } from "../shared/gameSurface";
// The game's accent hue — one constant drives its hub row and its own ground (§ A6b).
import { GAME_HUE, OUTCOME_FILL } from "./constants";
import DelayedCircularProgress from "../../components/DelayedCircularProgress";
import GameEndPopup from "../runtime/GameEndPopup";
import ForeignText from "../../components/ForeignText";
import MinimizablePopup from "../../components/MinimizablePopup";
import MemoryMapWorld from "./MemoryMapWorld";
import MemoryMapPrompt from "./MemoryMapPrompt";
import { GameFrame, GameHudLabel } from "../shared/GameFrame";
import MemoryMapRestartDialog from "./MemoryMapRestartDialog";
import { HeaderIconButton } from "../../components/PageHeader";
import { useMemoryMapRun } from "./useMemoryMapRun";
import { useGameExit } from "../runtime/gameExit";
import { useAuth } from "../../AuthContext";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useBlockEdgeSwipe } from "../../hooks/useBlockEdgeSwipe";
import { useTTS } from "../../hooks/useTTS";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";
import { GROWTH_TOAST_MS, PROMPT_AUDIO_GAP_MS } from "./constants";
import AudioModeChip from "../../components/AudioModeChip";
import type { MemoryMapWord as MemoryMapWordData } from "../../api/memoryMap";

/**
 * Memory Map — a persistent map of everything you are learning to READ.
 *
 * See docs/MEMORY_MAP_GAME.md. This page owns chrome, the camera surface and the
 * popups; every rule about prompts, colours and marks lives in `useMemoryMapRun`.
 *
 * ── THERE IS NO WINNING AND NO LOSING ────────────────────────────────────────
 * No medals, no wins row, no `POST /api/users/me/wins`, no hub stat badge. The only
 * outputs a run has are the reading marks it emits and the colours it leaves behind.
 * That is not an omission to be filled in later — it is the game.
 *
 * ── AND NO PAUSE-ON-BACKGROUND ───────────────────────────────────────────────
 * Every other game calls `useBackgroundPause` + renders `GamePausedOverlay`. Memory
 * Map deliberately does NOT (Q22). That rule exists to stop a CLOCK draining while the
 * app is backgrounded; this game has no clock and no timed state, so the overlay would
 * cover the screen to protect nothing. Documented here so its absence is not later
 * "fixed" by someone auditing games against the framework checklist.
 *
 * ── AND NO CARD BASELINE ─────────────────────────────────────────────────────
 * There is no entry in `CARD_BASELINES` and no provisional top-up (§ 10). Nothing
 * blocks on card count because nothing CAN block: a small library is simply a small
 * map. The empty state below is the only place that decision is visible to a user.
 */
const MemoryMapPage: React.FC = () => {
    usePageTitle("Memory Map");
    const navigate = useNavigate();
    // Where Back / Exit lead: the Reading Center when launched from its games belt
    // (ReadingGamesCarousel → `state.exitTo`), else the Games hub.
    const gameExit = useGameExit();
    const { user } = useAuth();
    // Mandatory on every game page: stops the OS back-swipe stealing a pan that
    // starts near the screen edge (CLAUDE.md § Touch & Scroll).
    useBlockEdgeSwipe(true);

    const language = user?.selectedLanguage ?? "zh";
    const run = useMemoryMapRun(user?.id, language);
    // Narration: the committed word on every answer (§ 3.3b), and the new target's
    // pronunciation each time a prompt appears (§ 3.1a). Both are AUTOMATIC
    // (`autoSpeakSentence`), so the header's AudioModeChip mutes them. The prompt bar's
    // speaker (`replayTarget`) is the one MANUAL call and speaks in every mode.
    const tts = useTTS();
    // `useTTS()` returns a fresh object every render; the prompt-autoplay effect reads it
    // through this ref so it can key on the target alone (docs/AUDIO_PLAYBACK.md § 1 —
    // an autoplay effect must key on content identity only).
    const ttsRef = useRef(tts);
    ttsRef.current = tts;
    // The answer narration still playing, if any — the next prompt's word waits for it.
    const answerAudioRef = useRef<Promise<void> | null>(null);

    const [restartOpen, setRestartOpen] = useState(false);
    // The word whose definition popup is open. Tapping a COLOURED word opens this at
    // any time, including mid-prompt, and never burns a try (§ 3.4).
    const [inspecting, setInspecting] = useState<MemoryMapWordData | null>(null);

    // The growth toast auto-dismisses; it is an announcement, not a decision.
    React.useEffect(() => {
        if (run.newlyPlaced.length === 0) return;
        const timer = window.setTimeout(run.dismissGrowthToast, GROWTH_TOAST_MS);
        return () => window.clearTimeout(timer);
    }, [run.newlyPlaced, run.dismissGrowthToast]);

    /**
     * The word ARMED by a first tap and awaiting its confirming tap (§ 3.3a).
     *
     * ── WHY SELECTION LIVES HERE AND NOT IN THE RUN HOOK ─────────────────────
     * It is an input affordance, not a game rule: nothing about it is saved, restored,
     * marked or scored, and the hook's contract ("a tap on this word is an answer") is
     * unchanged — the page simply decides WHICH tap gets to make that call. Putting it
     * in `useMemoryMapRun` would drag a pointer-interaction concept into the state
     * machine that owns prompts and marks, and would land it in the saved run.
     */
    const [selectedId, setSelectedId] = useState<number | null>(null);

    // A selection belongs to ONE prompt. When the target changes — answered, skipped,
    // restarted — anything still armed is stale, and leaving it armed would mean the
    // player's next single tap answered the NEW question, which is the accident this
    // whole mechanism exists to prevent.
    useEffect(() => {
        setSelectedId(null);
    }, [run.target?.vocabEntryId]);

    /**
     * A tap on a word.
     *
     * ── THE FIRST TAP SELECTS; THE SECOND ANSWERS (§ 3.3a) ───────────────────
     * The map is dense, the words are small and the board is panned with the same
     * finger that answers it, so a single-tap answer meant a fumbled touch could burn a
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
     * arbitrary-text entry point is the one that accepts it (SortCardsPage does the
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
     * ── IT GIVES NOTHING AWAY ────────────────────────────────────────────────
     * The prompt bar already prints the target's pinyin outright (§ 3.1, Q11
     * superseded), so hearing it adds the sound of what is on screen, not a hint about
     * where the word is. This is why Memory Map shows the AudioModeChip on every run,
     * unlike Bubble Match / Bucket Drop's reading runs, which hide it because there the
     * audio WOULD hand over the pronunciation being tested.
     *
     * No gesture unlock here: the prompt can land with no tap in its call stack (a load
     * resolves after an await). The app-wide pointerdown listener has primed the sinks
     * from the tap that opened the game (AUDIO_PLAYBACK.md § 5); on iOS a suspended
     * AudioContext (`media` route) may still drop the very first word until the next tap.
     */
    const targetId = run.target?.vocabEntryId ?? null;
    useEffect(() => {
        if (run.phase !== "playing" || targetId === null) return;
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
     * (`speakSentence`, not `autoSpeakSentence`), so it speaks even when the header chip
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

    const playing = run.phase === "playing" || run.phase === "complete";

    /**
     * LeafPage's own header carries the page controls, as it does on every other game.
     *
     * An earlier revision hid that header and folded the prompt into it, chasing
     * vertical space. That went too far — it cost the page title and put the question
     * in amongst the chrome. The space actually being wasted was in the PROMPT block
     * (four stacked rows: gloss, a standing hint line, the spoiler, the try pips), and
     * that is what got compacted instead: MemoryMapPrompt is now a single in-game row.
     */
    const header = (
        <Box className="memory-map-header-actions" sx={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {/* The app-wide narration setting, the same self-contained chip every other
                game header carries (docs/AUDIO_PLAYBACK.md § 1). Mutes the prompt
                autoplay and the answer narration alike; shown in every phase. */}
            <AudioModeChip className="memory-map-header-actions__audio" />

            {/* A direct Restart button rather than a settings gear: Restart was the
                gear's only item, and a cog that opens a one-row sheet is a drawer
                hiding a single tool. `RestartAltRounded` is the house restart icon
                (Bubble Match's header uses the same one). The CONFIRM still stands —
                it is what keeps a long run one deliberate step from being destroyed,
                which is the job the gear was doing. */}
            {playing && (
                <HeaderIconButton
                    className="memory-map-header-actions__restart"
                    icon="restart_alt"
                    onClick={() => setRestartOpen(true)}
                    label="Restart Memory Map"
                />
            )}
        </Box>
    );

    const accuracy =
        run.answered > 0 ? Math.round((run.tally.green / run.answered) * 100) : 0;

    return (
        <GameLeafPage
            hue={GAME_HUE}
            className="memory-map-page"
            title="Memory Map"
            onBack={() => navigate(gameExit.path, { state: gameExit.state })}
            rightContent={header}
            contentClassName="memory-map-page__content"
        >
            {run.phase === "loading" && (
                <Box className="memory-map-page__loading" sx={centeredSx}>
                    <DelayedCircularProgress />
                </Box>
            )}

            {run.phase === "error" && (
                <Box className="memory-map-page__error" sx={centeredSx}>
                    <Typography sx={{ fontSize: SIZE.body, textAlign: "center" }}>
                        Your map couldn&apos;t be loaded. Check your connection and try again.
                    </Typography>
                </Box>
            )}

            {/* The one user-visible consequence of declaring no card baseline (§ 6). */}
            {run.phase === "empty" && (
                <Box className="memory-map-page__empty" sx={centeredSx}>
                    <Typography
                        sx={{ fontSize: SIZE.subtitle, fontWeight: WEIGHT.semibold, mb: 1, textAlign: "center" }}
                    >
                        Your map is empty
                    </Typography>
                    <Typography
                        sx={{ fontSize: SIZE.body, mb: 3, textAlign: "center" }}
                    >
                        Sort some cards and they&apos;ll appear here.
                    </Typography>
                    <Button
                        className="memory-map-page__empty-cta"
                        variant="contained"
                        onClick={() => navigate("/discover")}
                    >
                        Find words
                    </Button>
                </Box>
            )}

            {(run.phase === "playing" || run.phase === "complete") && (
                /* `.play` — the inset panel (docs/SHELF_REDESIGN.md § A6). Memory Map has
                   no artboard, but the design anticipates it: `.mapw` exists in the
                   stylesheet. The growth toast and the inspect popup below stay OUTSIDE
                   the panel — both are page-level overlays. */
                <GameFrame className="memory-map-page__frame">
                    <MemoryMapPrompt
                        definition={run.target?.definition ?? null}
                        phase={run.promptPhase}
                        pronunciation={run.target?.pronunciation ?? null}
                        onSpeak={replayTarget}
                        speaking={run.target !== null && tts.speakingKey === run.target.entryKey}
                        onSkip={run.skipWord}
                        canSkip={run.canSkip}
                    />
                    <MemoryMapWorld
                        slots={run.slots}
                        words={run.words}
                        language={language}
                        fontKey={user?.chineseFont}
                        outcomes={run.outcomes}
                        pulsingId={run.promptPhase === "failed" ? run.target?.vocabEntryId ?? null : null}
                        selectedId={selectedId}
                        flashing={run.flashing}
                        fading={run.fading}
                        camera={run.camera}
                        onCameraChange={run.setCamera}
                        onTapWord={handleTapWord}
                        onTapWater={handleTapWater}
                        overlay={
                            // ── THE RUN COUNTER FLOATS ON THE MAP ────────────────
                            // Top-left corner of the play space, no container (owner,
                            // 2026-10-06). It lived in LeafPage's header as a
                            // `HeaderMetaLabel` before; on the map it sits beside what
                            // it counts. `GameHudLabel` is the house style for an
                            // in-play fact (full ink, mono) — legible straight on the
                            // water, where the header's faint meta grey would not be.
                            // Viewport-fixed (it does not pan) and pointerEvents none,
                            // so a drag starting on it still pans the map.
                            <GameHudLabel
                                className="memory-map-page__progress"
                                sx={{ position: "absolute", top: "8px", left: "16px", pointerEvents: "none" }}
                            >
                                {run.answered}/{run.total}
                            </GameHudLabel>
                        }
                    />
                </GameFrame>
            )}

            {/* Growth toast (§ 2.5): without it the map's growth is invisible, which is
                the whole emotional point of a persistent map. No auto-pan — the words
                are placed where they are placed, and hunting for them is the game. */}
            {run.newlyPlaced.length > 0 && run.phase === "playing" && (
                <Box
                    className="memory-map-page__growth-toast"
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

            {/* Completion (§ 5). NOT minimizable: unlike Bubble Match or Word Search
                there is no cleanup mode underneath worth uncovering — the map is fully
                coloured, which is exactly what the popup is reporting. */}
            {run.phase === "complete" && (
                <GameEndPopup classPrefix="memory-map-end">
                    <Box className="memory-map-end__body" sx={{ textAlign: "center", p: 1 }}>
                        <Typography sx={{ fontSize: SIZE.title, fontWeight: WEIGHT.bold, mb: 1 }}>
                            Map complete
                        </Typography>
                        <Typography sx={{ fontSize: SIZE.display, fontWeight: WEIGHT.bold, color: COLORS.successInk }}>
                            {accuracy}%
                        </Typography>
                        <Typography sx={{ fontSize: SIZE.caption, color: COLORS.textSecondary, mb: 2 }}>
                            first-try accuracy
                        </Typography>

                        <Box
                            className="memory-map-end__tally"
                            sx={{ display: "flex", justifyContent: "center", gap: 2.5, mb: 3 }}
                        >
                            {(
                                [
                                    ["green", run.tally.green, "knew it"],
                                    ["orange", run.tally.orange, "recovered"],
                                    ["red", run.tally.red, "missed"],
                                ] as const
                            ).map(([key, count, label]) => (
                                <Box key={key} className={`memory-map-end__tally-item memory-map-end__tally-item--${key}`}>
                                    {/* v2: the count sits on its outcome's fill (OUTCOME_FILL,
                                        the mid tier of the hue the map's outlines wear) in ink — the
                                        semantic inks it used to be tinted with are all
                                        plain ink now, which would have made the three
                                        counts indistinguishable. */}
                                    <Typography
                                        className="memory-map-end__tally-count"
                                        sx={{
                                            fontSize: SIZE.title,
                                            fontWeight: WEIGHT.bold,
                                            color: COLORS.onSurface,
                                            backgroundColor: OUTCOME_FILL[key],
                                            borderRadius: "8px",
                                            px: 1,
                                            mb: 0.5,
                                        }}
                                    >
                                        {count}
                                    </Typography>
                                    <Typography sx={{ fontSize: SIZE.micro, color: COLORS.textSecondary }}>
                                        {label}
                                    </Typography>
                                </Box>
                            ))}
                        </Box>

                        <Box sx={{ display: "flex", gap: 1 }}>
                            <Button
                                className="memory-map-end__exit"
                                fullWidth
                                variant="outlined"
                                onClick={() => navigate(gameExit.path, { state: gameExit.state })}
                            >
                                Exit
                            </Button>
                            <Button
                                className="memory-map-end__again"
                                fullWidth
                                variant="contained"
                                onClick={run.restart}
                            >
                                Play Again
                            </Button>
                        </Box>
                    </Box>
                </GameEndPopup>
            )}

            <MemoryMapRestartDialog
                open={restartOpen}
                onClose={() => setRestartOpen(false)}
                onRestart={run.restart}
                answered={run.answered}
            />
        </GameLeafPage>
    );
};

/**
 * Shared layout for the three non-playing states.
 *
 * `color` is the accent-ground rule the other five games get from `GameCentered`
 * (§ A6b): these three blocks are drawn straight onto the game's saturated ground,
 * where the ink ramp is unreadable. Children that must stay dimmer than the rest set
 * their own colour — see the error copy, which deliberately does not.
 */
const centeredSx = {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px",
    color: ON_ACCENT_INK,
} as const;

export default MemoryMapPage;
