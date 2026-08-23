import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Button, IconButton, Typography } from "@mui/material";
import RestartAltRoundedIcon from "@mui/icons-material/RestartAltRounded";
import LeafPage from "../../components/LeafPage";
import DelayedCircularProgress from "../../components/DelayedCircularProgress";
import GameEndPopup from "../runtime/GameEndPopup";
import ForeignText from "../../components/ForeignText";
import MinimizablePopup from "../../components/MinimizablePopup";
import MemoryMapWorld from "./MemoryMapWorld";
import MemoryMapPrompt from "./MemoryMapPrompt";
import { GameFrame } from "../shared/GameFrame";
import MemoryMapRestartDialog from "./MemoryMapRestartDialog";
import MinutePointsFireBadge from "../../minutePoints/MinutePointsFireBadge";
import { useMemoryMapRun } from "./useMemoryMapRun";
import { useAuth } from "../../AuthContext";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useBlockEdgeSwipe } from "../../hooks/useBlockEdgeSwipe";
import { useTTS } from "../../hooks/useTTS";
import { playCorrectSound, playWrongSound } from "../runtime/gameSounds";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";
import { GROWTH_TOAST_MS, MAX_TRIES } from "./constants";
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
    const { user } = useAuth();
    // Mandatory on every game page: stops the OS back-swipe stealing a pan that
    // starts near the screen edge (CLAUDE.md § Touch & Scroll).
    useBlockEdgeSwipe(true);

    const language = user?.selectedLanguage ?? "zh";
    const run = useMemoryMapRun(user?.id, language);
    // Narration for the committed word (§ 3.3b). No speaker button anywhere on the
    // page — the lock-in tap is the only thing that ever speaks.
    const tts = useTTS();

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
     * The map is dense, the parcels are small and the board is panned with the same
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
        if (result === "correct") playCorrectSound();
        else playWrongSound();
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
        if (!tts.enabled) return;
        // Synchronous, from inside the real pointer gesture: primes the shared
        // AudioContext so mobile autoplay policy does not swallow the first play of the
        // session, which resolves only after an await.
        tts.unlockAudio();
        void tts
            .speakSentence(word.entryKey, word.pronunciation ?? undefined)
            .catch(() => {});
    }

    /** A tap on open water disarms — the map's "never mind" (§ 3.3a). */
    const handleTapWater = useCallback(() => setSelectedId(null), []);

    // The hook owns the try counter; the bar only draws it. Clamped because a failed
    // prompt stops incrementing (a wrong tap after the third costs nothing) and the
    // pips must still read as all-spent.
    const triesUsed = run.promptPhase === "failed" ? MAX_TRIES : run.tries;

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
            {playing && (
                <Typography
                    className="memory-map-header-actions__progress"
                    sx={{
                        fontFamily: FONTS.sans,
                        fontSize: SIZE.caption,
                        fontWeight: WEIGHT.semibold,
                        color: COLORS.textSecondary,
                    }}
                >
                    {run.answered}/{run.total}
                </Typography>
            )}

            {/* A direct Restart button rather than a settings gear: Restart was the
                gear's only item, and a cog that opens a one-row sheet is a drawer
                hiding a single tool. `RestartAltRounded` is the house restart icon
                (Bubble Match's header uses the same one). The CONFIRM still stands —
                it is what keeps a long run one deliberate step from being destroyed,
                which is the job the gear was doing. */}
            {playing && (
                <IconButton
                    className="memory-map-header-actions__restart"
                    size="small"
                    onClick={() => setRestartOpen(true)}
                    aria-label="Restart Memory Map"
                >
                    <RestartAltRoundedIcon fontSize="small" />
                </IconButton>
            )}

            {/* RIGHTMOST, and it stays that way: the flame sits in the same corner slot
                on every surface that shows it (flp, Sort Cards, Quick Mark, Word
                Search), so a learner's eye can find their minute credits without
                reading the header. Game-specific controls queue up to its left.

                Shown in EVERY phase, including the empty and error states, because the
                route is in MINUTE_POINTS_ELIGIBLE_PAGES and in the `/games`
                start-on-entry subset — time is credited from the moment the page
                mounts, whether or not a run is under way.

                It calls useMinutePoints() INTERNALLY rather than taking it as a prop,
                so its per-second tick re-renders the badge alone. That matters more
                here than anywhere else: a page-level re-render every second would
                interrupt an in-progress pan. */}
            <MinutePointsFireBadge />
        </Box>
    );

    const accuracy =
        run.answered > 0 ? Math.round((run.tally.green / run.answered) * 100) : 0;

    return (
        <LeafPage
            className="memory-map-page"
            title="Memory Map"
            onBack={() => navigate("/games")}
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
                    <Typography sx={{ fontSize: SIZE.body, color: COLORS.textSecondary, textAlign: "center" }}>
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
                        sx={{ fontSize: SIZE.body, color: COLORS.textSecondary, mb: 3, textAlign: "center" }}
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
                        triesUsed={triesUsed}
                        pronunciation={run.target?.pronunciation ?? null}
                        onSkip={run.skipWord}
                        canSkip={run.canSkip}
                    />
                    <MemoryMapWorld
                        words={run.words}
                        outcomes={run.outcomes}
                        pulsingId={run.promptPhase === "failed" ? run.target?.vocabEntryId ?? null : null}
                        selectedId={selectedId}
                        flashing={run.flashing}
                        fading={run.fading}
                        camera={run.camera}
                        onCameraChange={run.setCamera}
                        onTapWord={handleTapWord}
                        onTapWater={handleTapWater}
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
                                    ["green", run.tally.green, COLORS.successInk, "knew it"],
                                    ["orange", run.tally.orange, COLORS.warnInk, "recovered"],
                                    ["red", run.tally.red, COLORS.dangerInk, "missed"],
                                ] as const
                            ).map(([key, count, color, label]) => (
                                <Box key={key} className={`memory-map-end__tally-item memory-map-end__tally-item--${key}`}>
                                    <Typography sx={{ fontSize: SIZE.title, fontWeight: WEIGHT.bold, color }}>
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
                                onClick={() => navigate("/games")}
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
        </LeafPage>
    );
};

/** Shared layout for the three non-playing states. */
const centeredSx = {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px",
} as const;

export default MemoryMapPage;
