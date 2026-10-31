import React, { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { Box } from "@mui/material";
import { SAFE_BOTTOM } from "../../../../theme/safeArea";
import DelayedCircularProgress from "../../../../components/DelayedCircularProgress";
import { useBlockEdgeSwipe } from "../../../../hooks/useBlockEdgeSwipe";
import { flpBreakGameFor } from "../../../../games/flpBreak";
import { BREAK_AREA_MOTION } from "../../flpLaunch";
import { FLP_CARD_CORNER_RATIO, FLP_CARD_STOCK_INSET_RATIO } from "../../constants";
import { COLORS, RAMP } from "../../../../theme/colors";
import { TOWER_SLAB, TOWER_SLAB_WALL_PX } from "../../../../theme/towerSlab";
import { useDayWash } from "../../../../timeOfDay/useDayWash";
import { breakPanelBox, GAME_PANEL, gameBreakFrameFor } from "./GameBreakFrame";
import type { UseGameBreakReturn } from "./useGameBreak";

function prefersReducedMotion(): boolean {
    return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/**
 * GameBreakArea — the flp game break once Play is tapped (docs/FLP_GAME_BREAKS.md § 2).
 * Until then the break is a card in the stack (`GameBreakCard`). A TRANSPARENT layer over
 * the flp's ContentArea (below the flp header, which stays).
 *
 * Choreography split:
 *   - this component animates the GROW: `grow-plate` starts exactly on the card and takes
 *     the game panel's box, its cream rim thinning away, then fades off the mounted game.
 *     A game drawn on the ground (`panelFill` null) has no panel to grow into: the plate
 *     just fades on the spot, and the game's paint comes up after it;
 *   - it animates ITS OWN box's fall on `leaving`;
 *   - the page plays the RETURN (`playBreakReturn`) when `returnNonce` bumps, because
 *     that has to run on the commit that re-shows the card stack — after this unmounts.
 *
 * The plate is drawn HERE because the card slot clips (`overflow: hidden`), so the card
 * itself can't outgrow it. Mounted only while `gameBreak.areaMounted`.
 * Layer: feature component (features/flashcards).
 */
const GameBreakArea: React.FC<{
    gameBreak: UseGameBreakReturn;
    /** The flp's ContentArea — where the card frame is measured from. */
    contentAreaRef: RefObject<HTMLElement | null>;
    /** A tower session's report of a card the game took off the tower. */
    onCardCleared?: () => void;
    /** A tower session: the sky is behind this area. The routed flp has its pale ground. */
    onSky: boolean;
}> = ({ gameBreak, contentAreaRef, onCardCleared, onSky }) => {
    const areaRef = useRef<HTMLDivElement | null>(null);
    const plateRef = useRef<HTMLDivElement | null>(null);
    const [plateGone, setPlateGone] = useState(false);
    const { phase, planned, finishGrow, beginLeave, finishLeave } = gameBreak;

    const wash = useDayWash();
    const adapter = planned ? flpBreakGameFor(planned.candidate.game.gameId) : null;
    const drawnOnGround = adapter?.panelFill === null;

    // Mandatory while any game is on screen (CLAUDE.md § Touch & Scroll): an edge swipe
    // would navigate out of the session mid-run.
    useBlockEdgeSwipe(true);

    // GROW, on mount. A layout effect with fill:both, so the first painted frame already
    // has the plate on the card.
    useLayoutEffect(() => {
        const area = areaRef.current;
        const plate = plateRef.current;
        const frame = contentAreaRef.current?.querySelector(".mobile-demo-card-frame");
        if (!area || !plate || !frame || prefersReducedMotion() || typeof plate.animate !== "function") {
            finishGrow();
            return;
        }
        const areaBox = area.getBoundingClientRect();
        const card = frame.getBoundingClientRect();
        const safeBottom = parseFloat(getComputedStyle(area).paddingBottom) || 0;
        const panel = breakPanelBox(areaBox.width, areaBox.height - safeBottom);
        const cardKeyframe = {
            left: `${card.left - areaBox.left}px`,
            top: `${card.top - areaBox.top}px`,
            width: `${card.width}px`,
            height: `${card.height}px`,
            borderRadius: `${card.width * FLP_CARD_CORNER_RATIO}px`,
            borderWidth: `${card.width * FLP_CARD_STOCK_INSET_RATIO}px`,
            backgroundColor: COLORS.cardBeige,
        };
        if (drawnOnGround) {
            const fade = plate.animate(
                [{ ...cardKeyframe, opacity: 1 }, { ...cardKeyframe, opacity: 0 }],
                { duration: BREAK_AREA_MOTION.growMs, easing: "ease-in-out", fill: "both" },
            );
            fade.finished.then(finishGrow, () => undefined);
            return;
        }
        const animation = plate.animate(
            [
                { ...cardKeyframe, boxShadow: `0 0 0 ${wash(TOWER_SLAB.right)}` },
                {
                    left: `${panel.left}px`,
                    top: `${panel.top}px`,
                    width: `${panel.width}px`,
                    height: `${panel.height}px`,
                    borderRadius: `${GAME_PANEL.radius}px`,
                    borderWidth: "0px",
                    // Ends on the Stage's own washed panel; starts on the unwashed flp card.
                    backgroundColor: wash(adapter?.panelFill ?? COLORS.white),
                    // The card thickens into the platform as it grows.
                    boxShadow: `0 ${TOWER_SLAB_WALL_PX}px 0 ${wash(TOWER_SLAB.right)}`,
                },
            ],
            { duration: BREAK_AREA_MOTION.growMs, easing: BREAK_AREA_MOTION.growEasing, fill: "both" },
        );
        // A cancelled grow (unmount mid-flight) leaves nothing to advance.
        animation.finished.then(finishGrow, () => undefined);
        // Mount-only: the area exists for exactly one break.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // The game is mounted under the plate: fade the plate off it.
    useEffect(() => {
        if (phase !== "playing") return;
        const plate = plateRef.current;
        // A ground game's plate has already faded on the spot.
        if (drawnOnGround || !plate || typeof plate.animate !== "function" || prefersReducedMotion()) {
            setPlateGone(true);
            return;
        }
        const fade = plate.animate([{ opacity: 1 }, { opacity: 0 }], { duration: BREAK_AREA_MOTION.plateFadeMs, fill: "forwards" });
        fade.finished.then(() => setPlateGone(true), () => undefined);
    }, [phase, drawnOnGround]);

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
        // `finishLeave` changes identity with the phase; the fall runs once.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phase]);

    const Frame = useMemo(() => (planned ? gameBreakFrameFor(planned.candidate.game.hue) : null), [planned]);

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
                // Except white paint with no sky behind it: the routed flp's pale ground
                // would swallow it, so a ground game brings its own (the game page's).
                ...(drawnOnGround && !onSky && planned && { backgroundColor: RAMP[planned.candidate.game.hue].mark }),
                // The card stack behind is hidden by FlashCardSection's `gameBreak` hold,
                // and the word tools / More Info were sent away when the break's card
                // reached the top (FlashcardsLearnPage → `breakCardOnTop`).
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
            {planned && adapter && Frame && gameBreak.stageMounted && (
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
                        onCardCleared={onCardCleared}
                    />
                </Suspense>
            )}
            {!plateGone && (
                <Box
                    ref={plateRef}
                    className="flp-game-break__grow-plate"
                    sx={{
                        position: "absolute",
                        boxSizing: "border-box",
                        borderStyle: "solid",
                        borderColor: COLORS.cardFace,
                        pointerEvents: "none",
                    }}
                />
            )}
        </Box>
    );
};

export default GameBreakArea;
