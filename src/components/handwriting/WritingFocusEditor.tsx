import { useEffect, useRef, useState } from "react";
import { Box, Button } from "@mui/material";
import WritingStage from "./WritingStage";
import WritingPanel, { WritingPanelLevelLabel, type WritingPanelHandle } from "./WritingPanel";
import { WRITING_PANEL_ACTION_SX } from "./writingPanelStyles";
import { useLevelGuide } from "./useLevelGuide";
import { useStrokeClock } from "./useStrokeClock";
import { guideFades, regionClipPath, WRITING_FOCUS_SIZE } from "./levelBehavior";
import type { Ink, WritingCanvasHandle } from "./types";
import { WRITING_LEVELS } from "../../../server/contracts/writingLevels";
import { COLORS } from "../../theme";

const CANVAS_SIZE = WRITING_FOCUS_SIZE;

/**
 * WritingFocusEditor — a focused writing panel for ONE character at one level.
 *
 * Shared by the Writing Grid game's Phase 2 (src/games/writing-grid) and the writing
 * flp card (FlashcardsLearnPage/useWritingFlashcard) — docs/WRITING_PRACTICE_REWORK.md §§ 2–3. It fills
 * its positioned parent (`position: absolute; inset: 0`), so a host either places it
 * over its own board or inside a phone-sized Dialog.
 *
 * A modal layer: the level guide (useLevelGuide, the same state
 * machine the Practice Writing popup runs) inside one WritingPanel — level label on
 * top, the capture canvas, Clear / Undo + the level's assist button in the footer. The
 * panel grows out of the tapped cell (`origin`) and shrinks back into it on tap-out.
 * Tapping the scrim — "tapping out" — hands the ink back to the page (after the shrink),
 * which verifies it. Level 8's clock locks the canvas when it runs out and taps out on
 * the learner's behalf, so what was drawn is graded.
 *
 * Every gesture is absorbed here so a stroke can never reach the board's drag handlers.
 */
export interface WritingFocusEditorProps {
    char: string;
    pinyin: string | null;
    /** 1-based level (the cell's position + 1). */
    level: number;
    /** Ink from an earlier attempt on this cell (restored on reopen). */
    initialInk: Ink;
    /**
     * Tap-out: the host verifies `ink`. `clockStarted` is true when Level 8's clock ran
     * for this attempt — a host that lets a character be reopened must treat that
     * character as final, or closing and reopening would reset the clock.
     */
    onDone: (ink: Ink, meta: { clockStarted: boolean }) => void;
    /** The tapped preview cell: the panel grows out of it and shrinks back into it. */
    origin?: HTMLElement | null;
}

export default function WritingFocusEditor({ char, pinyin, level, initialInk, onDone, origin }: WritingFocusEditorProps) {
    const spec = WRITING_LEVELS[level - 1];
    const guide = useLevelGuide(spec.mode);
    const behavior = guide.behavior;
    const canvasRef = useRef<WritingCanvasHandle>(null);
    const panelRef = useRef<WritingPanelHandle>(null);
    const scrimRef = useRef<HTMLDivElement>(null);
    const hintRef = useRef<HTMLDivElement>(null);
    const [hasInk, setHasInk] = useState(initialInk.length > 0);
    // Tap-out runs once: the clock can expire while the panel is already shrinking.
    const finishingRef = useRef(false);

    // Tap-out reads the live canvas FIRST (the ink is final the moment the learner taps
    // out), shrinks the panel back into its cell, then hands the ink to the host. Held in
    // a ref so the clock's expiry (a stale closure inside a timer) uses the current one.
    const finish = () => {
        if (finishingRef.current) return;
        finishingRef.current = true;
        const ink = (canvasRef.current?.getInk() ?? []).map((s) => ({ ...s }));
        const meta = { clockStarted: clock.clockFor(0) !== null };
        void (panelRef.current?.collapse() ?? Promise.resolve()).then(() => onDone(ink, meta));
    };
    const finishRef = useRef(finish);
    finishRef.current = finish;

    const clock = useStrokeClock([char], {
        enabled: behavior.timed,
        onExpire: () => finishRef.current(),
    });
    const expired = clock.isExpired(0);

    // Opening the editor is entering the level on this surface.
    useEffect(() => {
        guide.enter();
        return guide.leave;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const stop = (e: React.SyntheticEvent) => e.stopPropagation();

    return (
        <Box
            className="writing-focus-editor"
            onPointerDown={stop}
            onTouchStart={stop}
            onMouseDown={stop}
            // Any tap that is not on the panel lands on the scrim (the column above it is
            // pointer-transparent) = tap out.
            onClick={(e) => {
                e.stopPropagation();
                if (e.target === scrimRef.current) finish();
            }}
            sx={{ position: "absolute", inset: 0, zIndex: 10, touchAction: "none" }}
        >
            {/* Its own layer so it can fade with the morph while the panel stays opaque. */}
            <Box ref={scrimRef} className="writing-focus-editor__scrim" sx={{ position: "absolute", inset: 0, bgcolor: COLORS.modalScrim }} />

            <Box
                className="writing-focus-editor__column"
                sx={{
                    position: "relative",
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 1.5,
                    pointerEvents: "none",
                    "& > *": { pointerEvents: "auto" },
                }}
            >
                <WritingPanel
                    ref={panelRef}
                    className="writing-focus-editor__panel"
                    size={CANVAS_SIZE}
                    origin={origin}
                    companions={[scrimRef, hintRef]}
                    header={<WritingPanelLevelLabel level={spec.level} name={spec.name} pinyin={pinyin} />}
                    onClear={() => canvasRef.current?.clear()}
                    onUndo={() => canvasRef.current?.undo()}
                    editDisabled={!hasInk || expired}
                    assist={
                        behavior.button && (
                            <Button
                                className="writing-focus-editor__assist"
                                variant="contained"
                                disableElevation
                                onClick={guide.press}
                                disabled={guide.cooldownSec > 0}
                                sx={WRITING_PANEL_ACTION_SX}
                            >
                                {guide.cooldownSec > 0 ? `${guide.cooldownSec}s` : behavior.button.label}
                            </Button>
                        )
                    }
                >
                    <WritingStage
                        ref={canvasRef}
                        character={char}
                        size={CANVAS_SIZE}
                        drawable
                        showGuide={behavior.guide !== "none"}
                        guideVisible={guide.outlineVisible}
                        loopAnimation={behavior.animation === "loop"}
                        snap={behavior.snap}
                        regionClip={behavior.regions ? regionClipPath(behavior.regions, guide.regionIndex) : undefined}
                        guideKey={spec.mode}
                        {...guideFades(spec.mode)}
                        drawLocked={guide.drawLocked || expired}
                        loading={guide.loading}
                        blocked={guide.blocked}
                        onBlockedAttempt={guide.blockedAttempt}
                        onStrokeStart={() => clock.start(0)}
                        clock={behavior.timed ? clock.clockFor(0) : null}
                        initialInk={initialInk}
                        onInkChange={(ink) => setHasInk(ink.length > 0)}
                        result="idle"
                    />
                </WritingPanel>

                <Box ref={hintRef} className="writing-focus-editor__hint" sx={{ color: COLORS.white, fontSize: "0.8rem", pointerEvents: "none !important" }}>
                    Tap outside to check
                </Box>
            </Box>
        </Box>
    );
}
