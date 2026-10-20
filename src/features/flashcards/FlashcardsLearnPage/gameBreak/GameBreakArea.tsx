import React, { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";
import { Box } from "@mui/material";
import { SAFE_BOTTOM } from "../../../../theme/safeArea";
import DelayedCircularProgress from "../../../../components/DelayedCircularProgress";
import { useBlockEdgeSwipe } from "../../../../hooks/useBlockEdgeSwipe";
import GameBreakTitleCard from "../../../../games/shared/GameBreakTitleCard";
import { flpBreakGameFor } from "../../../../games/flpBreak";
import { BREAK_AREA_MOTION, playBreakAway } from "../../flpLaunch";
import { gameBreakFrameFor } from "./GameBreakFrame";
import type { UseGameBreakReturn } from "./useGameBreak";

/** The title card's eyebrow (docs/FLP_GAME_BREAKS.md § 5 — decided 2026-10-18). */
const BREAK_EYEBROW = "Game break";

function prefersReducedMotion(): boolean {
    return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/**
 * GameBreakArea — the flp game break on screen (docs/FLP_GAME_BREAKS.md § 2). A
 * TRANSPARENT layer over the flp's ContentArea (below the flp header, which stays): what
 * the learner sees fade in is the game's PLAY PANEL (`GameFrame`) on the flp's own ground,
 * where the card was — first filled with the game's colour as the title card, then, on
 * Play, the game's own panel in the same place. It falls away again on Skip /
 * "Back to cards".
 *
 * Choreography split:
 *   - this component animates ITS OWN box (fade in on mount, fall on `leaving`), and on
 *     mount sends the More Info pill / word tools away (`playBreakAway`);
 *   - the page plays the RETURN (`playBreakReturn`) when `returnNonce` bumps, because
 *     that has to run on the commit that re-shows the card stack — after this unmounts.
 *
 * Mounted only while `phase !== "cards"`. Layer: feature component (features/flashcards).
 */
const GameBreakArea: React.FC<{
    gameBreak: UseGameBreakReturn;
    /** The flp's ContentArea — the choreography root for the pill / word tools. */
    contentAreaRef: RefObject<HTMLElement | null>;
}> = ({ gameBreak, contentAreaRef }) => {
    const areaRef = useRef<HTMLDivElement | null>(null);
    const { phase, planned, playPending, play, beginLeave, finishLeave } = gameBreak;

    // Mandatory while any game is on screen (CLAUDE.md § Touch & Scroll): an edge swipe
    // would navigate out of the session mid-run. Held for the title card too.
    useBlockEdgeSwipe(true);

    // FADE IN, on mount (was a rise until 2026-10-18). A layout effect with
    // fill:backwards, so the first painted frame already has the area at opacity 0 (no
    // flash at rest). The delay lets the last card get most of the way off first, so the
    // panel appears into the space it vacated.
    useLayoutEffect(() => {
        const el = areaRef.current;
        if (contentAreaRef.current) void playBreakAway(contentAreaRef.current);
        if (!el || prefersReducedMotion() || typeof el.animate !== "function") return;
        el.animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: BREAK_AREA_MOTION.enterMs,
            delay: BREAK_AREA_MOTION.enterDelayMs,
            easing: BREAK_AREA_MOTION.enterEasing,
            fill: "backwards",
        });
        // Mount-only: the area exists for exactly one break.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // FALL, on `leaving`; the break ends when it lands (or at once under reduced motion).
    useEffect(() => {
        if (phase !== "leaving") return;
        const el = areaRef.current;
        if (!el || prefersReducedMotion() || typeof el.animate !== "function") {
            finishLeave();
            return;
        }
        const animation = el.animate([{ translate: "0px 0px" }, { translate: "0px 100%" }], {
            duration: BREAK_AREA_MOTION.exitMs,
            easing: BREAK_AREA_MOTION.exitEasing,
            fill: "forwards",
        });
        // A cancelled fall (unmount mid-flight) is still the end of the break.
        animation.finished.then(finishLeave, finishLeave);
    }, [phase, finishLeave]);

    const adapter = planned ? flpBreakGameFor(planned.candidate.game.gameId) : null;
    const Frame = useMemo(() => (planned ? gameBreakFrameFor(planned.candidate.game.hue) : null), [planned]);

    // Which body is showing. `leaving` keeps whatever was up, so the area falls away
    // with its content rather than blanking first.
    const showingStage = gameBreak.stageMounted;

    return (
        <Box
            ref={areaRef}
            className="flp-game-break"
            sx={{
                position: "absolute",
                inset: 0,
                // Above the card stack and the fie toolbar (20); below the frame-level
                // sheets (1200+), which portal out of ContentArea anyway.
                zIndex: 30,
                // No fill: the flp's ground shows around the panel (decided 2026-10-18).
                // The card stack behind is hidden by FlashCardSection's `gameBreak` hold,
                // and the word tools / More Info have been sent away (`playBreakAway`).
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
                // Input stops the moment the area starts falling.
                pointerEvents: phase === "leaving" ? "none" : "auto",
                // The flp's ContentArea runs to the screen's bottom edge (More Info clears
                // the home indicator with the same inset); the panel must too.
                paddingBottom: SAFE_BOTTOM,
            }}
        >
            {planned && adapter && Frame && (
                showingStage ? (
                    <Suspense
                        fallback={
                            <Box className="flp-game-break__loading" sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                                <DelayedCircularProgress className="flp-game-break__spinner" />
                            </Box>
                        }
                    >
                        <adapter.Stage
                            candidate={planned.candidate}
                            context={planned.context}
                            prefetched={planned.prefetched}
                            Frame={Frame}
                            onDone={beginLeave}
                        />
                    </Suspense>
                ) : (
                    <Box className="flp-game-break__title" sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
                        <GameBreakTitleCard
                            eyebrow={BREAK_EYEBROW}
                            title={planned.candidate.game.title}
                            glyph={planned.candidate.game.glyph}
                            hue={planned.candidate.game.hue}
                            rulesLine={adapter.rulesLine}
                            medalLine={adapter.medalLine(planned.candidate, planned.context)}
                            personalBest={adapter.personalBest(planned.candidate, planned.context)}
                            onSkip={beginLeave}
                            onPlay={play}
                            playPending={playPending}
                        />
                    </Box>
                )
            )}
        </Box>
    );
};

export default GameBreakArea;
