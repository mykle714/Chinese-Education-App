import React, { useState } from "react";
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
import MemoryMapRestartDialog from "./MemoryMapRestartDialog";
import MinutePointsFireBadge from "../../minutePoints/MinutePointsFireBadge";
import { useMemoryMapRun } from "./useMemoryMapRun";
import { useAuth } from "../../AuthContext";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useBlockEdgeSwipe } from "../../hooks/useBlockEdgeSwipe";
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
     * A tap on a word.
     *
     * The coloured/uncoloured split happens HERE rather than in the hook, because what
     * a coloured word does is a UI affordance (open a popup) rather than a game rule.
     * The rule the hook enforces is only that a coloured word is never an answer.
     */
    const handleTapWord = (word: MemoryMapWordData) => {
        if (run.outcomes[word.vocabEntryId]) {
            setInspecting(word);
            return;
        }
        const result = run.tapWord(word);
        if (result === "correct") playCorrectSound();
        else if (result === "wrong") playWrongSound();
    };

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
        <Box className="memory-map-header-actions" sx={{ display: "flex", alignItems: "center", gap: "4px" }}>
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
                <>
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
                        flashing={run.flashing}
                        fading={run.fading}
                        camera={run.camera}
                        onCameraChange={run.setCamera}
                        onTapWord={handleTapWord}
                    />
                </>
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
                        <Typography sx={{ fontSize: SIZE.display, fontWeight: WEIGHT.bold, color: COLORS.greenMain }}>
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
                                    ["green", run.tally.green, COLORS.greenMain, "knew it"],
                                    ["orange", run.tally.orange, COLORS.yellowMain, "recovered"],
                                    ["red", run.tally.red, COLORS.redMain, "missed"],
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
