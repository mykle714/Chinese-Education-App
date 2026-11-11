import React, { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Box } from "@mui/material";
import { SAFE_BOTTOM, SAFE_TOP } from "../../../../theme/safeArea";
import DelayedCircularProgress from "../../../../components/DelayedCircularProgress";
import { useBlockEdgeSwipe } from "../../../../hooks/useBlockEdgeSwipe";
import { useScreenOverlayHost } from "../../../../hooks/useScreenOverlayHost";
import { flpBreakGameFor } from "../../../../games/flpBreak";
import { BREAK_AREA_MOTION, circleCoverDiameter, prefersReducedMotion } from "./breakMotion";
import { COLORS } from "../../../../theme/colors";
import { gameBreakFrameFor } from "./GameBreakFrame";
import GameBreakChrome, { type BreakChromeWave } from "./GameBreakChrome";
import { GameBreakHostContext, type GameBreakHost } from "./gameBreakHost";
import type { UseGameBreakReturn } from "./useGameBreak";

/** Above the footer bar (100); below `MinimizablePopup`'s 200, so a game's popups stay on top. */
const GAME_BREAK_Z_INDEX = 120;

/** Size `circle` to pass `area`'s corners from its centre (`circleCoverDiameter`). */
function sizeCircleToCover(circle: HTMLElement, area: HTMLElement): void {
    const diameter = circleCoverDiameter(area);
    circle.style.width = `${diameter}px`;
    circle.style.height = `${diameter}px`;
    circle.style.margin = `${-diameter / 2}px`;
}

/**
 * GameBreakArea — the flp game break once Play is tapped (docs/FLP_GAME_BREAKS.md § 2).
 * Until then the break is a card in the stack (`GameBreakCard`). From here the game IS the
 * screen: portaled to the phone frame, so it covers the flp header and everything else.
 *
 * Choreography split:
 *   - this component animates the GROW: a circle of the game's ground grows out of the
 *     screen's middle over the still-visible break card. `transform`, not an animated
 *     `clip-path`, so the compositor runs it. It must start from nothing and end past the
 *     corners, hence the radius below. The header row (GameBreakChrome: Leave, the game's
 *     name, the audio chip, the flame) is up from the grow's first frame, its ink turning
 *     dark as the circle passes under it; the game mounts on the finished circle and its
 *     content fades in (GameFrame under a host);
 *   - Leave DURING the grow cancels the break (`beginLeave` → `leaving`): the circle
 *     freezes where it is and falls away with the area;
 *   - it animates the SHRINK when a run ends (`shrinking`), the grow in reverse: the Stage
 *     fades to the circle at full size, which closes back onto the break's card, already
 *     showing the results underneath;
 *   - it animates ITS OWN box's fall on `leaving`, the exit with no run to report;
 *   - the page plays the RETURN (`playBreakReturn`) when `returnNonce` bumps, because
 *     that has to run on the commit that re-shows the card stack — after this unmounts.
 *
 * Mounted only while `gameBreak.areaMounted`.
 * Layer: feature component (features/flashcards).
 */
const GameBreakArea: React.FC<{
    gameBreak: UseGameBreakReturn;
    /**
     * A card the game cleared (FlpBreakStageProps.onCardCleared): the page takes it off
     * the tower and out of the working loop (docs/FLP_GAME_BREAKS.md § 4a).
     */
    onCardCleared?: (cardId: number) => void;
}> = ({ gameBreak, onCardCleared }) => {
    const { anchorRef, host } = useScreenOverlayHost();
    const areaRef = useRef<HTMLDivElement | null>(null);
    const circleRef = useRef<HTMLDivElement | null>(null);
    const stageRef = useRef<HTMLDivElement | null>(null);
    const { phase, planned, finishGrow, finishRun, finishShrink, beginLeave, finishLeave } = gameBreak;

    const adapter = planned ? flpBreakGameFor(planned.candidate.game.gameId) : null;

    // The grow animation, so a Leave mid-grow can freeze it where it is.
    const growRef = useRef<Animation | null>(null);
    // The circle finished growing: the area is the game's white ground from here on.
    const [grown, setGrown] = useState(false);
    useEffect(() => {
        if (phase === "playing") setGrown(true);
    }, [phase]);

    // THE HOST HANDSHAKE (gameBreakHost.ts). Leave is drawn by the area from the grow on;
    // while a Stage is mounted it does what the Stage says (it may end a run), otherwise —
    // the grow, the Stage's lazy load — it ends the break itself.
    const stageExitRef = useRef<(() => void) | null>(null);
    const registerExit = useCallback((onExit: (() => void) | null) => {
        stageExitRef.current = onExit;
    }, []);
    const handleLeave = useCallback(() => {
        if (stageExitRef.current) stageExitRef.current();
        else beginLeave();
    }, [beginLeave]);
    const [trailingSlot, setTrailingSlot] = useState<HTMLElement | null>(null);
    const breakHost = useMemo<GameBreakHost>(() => ({ registerExit, trailingSlot }), [registerExit, trailingSlot]);

    // Mandatory while any game is on screen (CLAUDE.md § Touch & Scroll): an edge swipe
    // would navigate out of the session mid-run.
    useBlockEdgeSwipe(true);

    // GROW, once the portal has landed. A layout effect with fill:both, so the first
    // painted frame already has the circle at nothing.
    useLayoutEffect(() => {
        if (!host) return;
        const area = areaRef.current;
        const circle = circleRef.current;
        if (!area || !circle || prefersReducedMotion() || typeof circle.animate !== "function") {
            finishGrow();
            return;
        }
        sizeCircleToCover(circle, area);
        const animation = circle.animate([{ transform: "scale(0)" }, { transform: "scale(1)" }], {
            duration: BREAK_AREA_MOTION.growMs,
            easing: BREAK_AREA_MOTION.growEasing,
            fill: "both",
        });
        growRef.current = animation;
        // A cancelled grow (unmount mid-flight) leaves nothing to advance.
        animation.finished.then(finishGrow, () => undefined);
        // Once per area: it exists for exactly one break, and `host` settles once.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [host]);

    // SHRINK, once the run has ended. A layout effect with the circle already full-size
    // behind the Stage (fill:both), so the area can go clear on this very commit.
    useLayoutEffect(() => {
        if (phase !== "shrinking") return;
        const area = areaRef.current;
        const circle = circleRef.current;
        const stage = stageRef.current;
        if (!area || !circle || !stage || prefersReducedMotion() || typeof circle.animate !== "function") {
            finishShrink();
            return;
        }
        sizeCircleToCover(circle, area);
        const { shrinkHoldMs, shrinkFadeMs, growMs, shrinkEasing } = BREAK_AREA_MOTION;
        const fade = stage.animate([{ opacity: 1 }, { opacity: 0 }], {
            delay: shrinkHoldMs,
            duration: shrinkFadeMs,
            easing: "ease",
            fill: "both",
        });
        const shrink = circle.animate([{ transform: "scale(1)" }, { transform: "scale(0)" }], {
            delay: shrinkHoldMs + shrinkFadeMs,
            duration: growMs,
            easing: shrinkEasing,
            fill: "both",
        });
        // A cancelled shrink (unmount mid-flight) leaves nothing to advance.
        shrink.finished.then(finishShrink, () => undefined);
        return () => {
            fade.cancel();
            shrink.cancel();
        };
        // `finishShrink` is stable; the shrink runs once.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phase]);

    // FALL, on `leaving`; the break ends when it lands (or at once under reduced motion).
    // From a half-finished grow the circle freezes first and falls with the area.
    useEffect(() => {
        if (phase !== "leaving") return;
        growRef.current?.pause();
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
    // The circle is the ground while it moves (and while a cancelled grow falls away with
    // it frozen part-way); the flp shows round it.
    const circling = phase === "growing" || phase === "shrinking" || (phase === "leaving" && !grown);
    // The header row's ink (GameBreakChrome § THE INK SWAP), from the same phase.
    const chromeWave: BreakChromeWave =
        phase === "growing" ? "in"
        : phase === "shrinking" ? "out"
        : phase === "leaving" && !grown ? "paused"
        : "dark";

    return (
        <>
            <span ref={anchorRef} hidden />
            {host && createPortal(
                <Box
                    ref={areaRef}
                    className="flp-game-break"
                    sx={{
                        position: "absolute",
                        inset: 0,
                        zIndex: GAME_BREAK_Z_INDEX,
                        // Clear while the circle moves, so the flp shows round it. The
                        // ground otherwise: a Stage's loading and blocked states draw no
                        // panel of their own.
                        backgroundColor: circling ? "transparent" : COLORS.white,
                        display: "flex",
                        flexDirection: "column",
                        overflow: "hidden",
                        // The tap on Play must not land on the session under the circle;
                        // input stops the moment the game starts going away.
                        pointerEvents: phase === "leaving" || phase === "shrinking" ? "none" : "auto",
                        paddingBottom: SAFE_BOTTOM,
                    }}
                >
                    {/* Before the Stage in the DOM: the Stage fades off this circle. */}
                    {circling && (
                        <Box
                            ref={circleRef}
                            className="flp-game-break__circle"
                            sx={{
                                position: "absolute",
                                left: "50%",
                                top: "50%",
                                borderRadius: "50%",
                                backgroundColor: COLORS.white,
                                pointerEvents: "none",
                            }}
                        />
                    )}
                    {/* The status bar's band, so the body (the game and the header row over it)
                        starts below it — as the study header's padding does. */}
                    <Box className="flp-game-break__status-spacer" sx={{ flexShrink: 0, height: SAFE_TOP }} />
                    <GameBreakHostContext.Provider value={breakHost}>
                    <Box className="flp-game-break__body" sx={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
                    {planned && adapter && Frame && gameBreak.stageMounted && (
                        <Box
                            ref={stageRef}
                            className="flp-game-break__stage"
                            sx={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
                        >
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
                                    onRunEnded={finishRun}
                                    onCardCleared={onCardCleared}
                                />
                            </Suspense>
                        </Box>
                    )}
                    {planned && adapter && (
                        <GameBreakChrome
                            title={planned.candidate.game.title}
                            showAudioChip={!adapter.hidesAudioChip?.(planned.candidate)}
                            sideways={adapter.sideways === true}
                            wave={chromeWave}
                            areaRef={areaRef}
                            onLeave={handleLeave}
                            onTrailingSlot={setTrailingSlot}
                        />
                    )}
                    </Box>
                    </GameBreakHostContext.Provider>
                </Box>,
                host,
            )}
        </>
    );
};

export default GameBreakArea;
