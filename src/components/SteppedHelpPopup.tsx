import { useState } from "react";
import { createPortal } from "react-dom";
import { Box, ButtonBase } from "@mui/material";
import Icon from "./Icon";
import SteppedHelpStep from "./SteppedHelpStep";
import { useSwipePager } from "../hooks/useSwipePager";
import { useScreenOverlayHost } from "../hooks/useScreenOverlayHost";
import { COLORS } from "../theme/colors";
import { FONTS } from "../theme/fonts";
import { SIZE, WEIGHT } from "../theme/scale";
import { SHADOW } from "../theme/shadows";
import type { HelpStep } from "./steppedHelp";

interface SteppedHelpPopupProps {
    open: boolean;
    steps: readonly HelpStep[];
    /** Resolves a step's `shot` filename to a URL. See {@link makeShotResolver}. */
    resolveShot: (filename: string) => string | undefined;
    /**
     * `{key}` placeholders substituted into each step's title — e.g. `{deck}` with the
     * generated deck's name. A placeholder with no entry here is left as written rather
     * than blanked, so a missing substitution is visible instead of silently eating text.
     */
    tokens?: Record<string, string>;
    onClose: () => void;
}

/**
 * THE STEPPED EXPLAINER — an image, a caption and one idea per step, over a scrim.
 *
 * Used by Study Challenge's two explainers ("How to study this deck" F20, "How the test
 * works" F21) and by the arena's three-step rules card (`Arena Flow - Shelf System.html`
 * A16/A17). ONE component, so every explainer in the app reads as one system rather than
 * as things somebody built on different days — which is exactly what the arena flow asks
 * for: its caption says the overlay is "ported unchanged from the challenge flow".
 *
 * It lives in `components/` rather than in either feature because `features/` is
 * exclusive (docs/FRONTEND_LAYERING.md) — a second feature importing it from
 * `features/studyChallenge/` would be the back-edge that layering rule forbids.
 *
 * The shape is deliberate: image on top, instruction under it, one idea per step. These
 * explainers teach WHERE something is or WHAT a rule is, and none is worth a page — a
 * page would be somewhere to navigate back from, for content read once.
 *
 * ⚠️ IT DOES NOT REMEMBER BEING READ, AND THAT IS THE CALLER'S JOB. There is no "seen"
 * flag and no auto-open in here. Study Challenge puts both explainers behind an explicit
 * control and wants no memory at all; the arena auto-opens its own on first visit and
 * keeps that flag itself (`ArenaPage`, localStorage). Putting the flag in the component
 * would force one policy on both.
 *
 * ⚠️ IT PORTALS OUT OF ITS HOST PAGE, for the same reason ChallengeSheet does: the
 * page's scroll area carries the edge-fade mask, which clips fixed descendants, and the
 * footer bar paints above every page surface. Both would eat the Next button. It hosts
 * at the phone frame (`useScreenOverlayHost`), `absolute` and above the footer's z-index,
 * so the scrim dims the ENTIRE screen, footer bar included; the bar stays put
 * (src/components/overlayHost.ts § "THE RULE FOR A DIM").
 */
function SteppedHelpPopup({ open, steps, resolveShot, tokens, onClose }: SteppedHelpPopupProps) {
    const [index, setIndex] = useState(0);
    const showing = open && steps.length > 0;
    // Written here, painted at frame level — see the portal note above.
    const { anchorRef, host } = useScreenOverlayHost(showing);

    // Guard the index rather than resetting it in an effect: `steps` can change
    // identity between the two explainers on the same page, and an effect would race
    // the render that is already using the stale index.
    const current = Math.min(index, Math.max(0, steps.length - 1));
    const last = current >= steps.length - 1;
    // Swipe left/right over the pages turns them, mirroring Next/Back. Called before the
    // early return below, as every hook must be.
    const swipe = useSwipePager(current, steps.length, setIndex);

    if (!showing) return null;

    return (
        <>
            <Box component="span" ref={anchorRef} className="stepped-help__anchor" sx={{ display: "none" }} />
            {host && createPortal(
                <>
                    <Box
                        className="stepped-help__scrim"
                        onClick={onClose}
                        // `absolute` on the frame host — `fixed` would escape the desktop phone card.
                        sx={{ position: "absolute", inset: 0, zIndex: 1300, backgroundColor: COLORS.modalScrim }}
                    />
                    <Box
                        className="stepped-help"
                        sx={{
                            position: "absolute",
                            left: 32,
                            right: 32,
                            top: 88,
                            zIndex: 1301,
                            display: "flex",
                            flexDirection: "column",
                            backgroundColor: COLORS.white,
                            borderRadius: "24px",
                            boxShadow: SHADOW.popover,
                            overflow: "hidden",
                        }}
                    >
                        {/* THE SWIPE VIEWPORT. Every step is rendered side by side in one
                            strip and the strip is translated, so a swipe drags the real
                            neighbouring page into view rather than cross-fading on release.
                            A side effect worth keeping: the strip is as tall as its tallest
                            page, so the card no longer changes height between steps and
                            Next does not jump under the thumb. */}
                        <Box
                            className="stepped-help__viewport"
                            {...swipe.handlers}
                            sx={{ position: "relative", overflow: "hidden", touchAction: "none", cursor: swipe.dragging ? "grabbing" : "grab" }}
                        >
                            <Box
                                className="stepped-help__strip"
                                sx={{
                                    display: "flex",
                                    transform: `translateX(calc(${-current * 100}% + ${swipe.dragDx}px))`,
                                    // Off while dragging so the strip tracks the finger 1:1;
                                    // on otherwise, so a release, Back, or Next all glide.
                                    transition: swipe.dragging ? "none" : "transform 280ms cubic-bezier(.2,.8,.2,1)",
                                    "@media (prefers-reduced-motion: reduce)": { transition: "none" },
                                }}
                            >
                                {steps.map((entry, stepIndex) => (
                                    <SteppedHelpStep
                                        key={entry.shot}
                                        step={entry}
                                        position={stepIndex}
                                        total={steps.length}
                                        shotUrl={resolveShot(entry.shot)}
                                        title={substitute(entry.title, tokens)}
                                    />
                                ))}
                            </Box>

                            {/* The close control floats over the viewport rather than
                                riding a page, so it stays under the thumb mid-swipe. It
                                stops pointerdown so pressing it never starts a drag. */}
                            <ButtonBase
                                className="stepped-help__close"
                                onClick={onClose}
                                onPointerDown={(e) => e.stopPropagation()}
                                aria-label="Close"
                                sx={{ position: "absolute", top: 14, right: 14, borderRadius: "999px", p: 0.75, backgroundColor: "rgba(255,255,255,.9)", color: COLORS.onSurface }}
                            >
                                <Icon name="close" size={18} color={COLORS.onSurface} />
                            </ButtonBase>
                        </Box>

                        <Box
                            className="stepped-help__footer"
                            sx={{ display: "flex", alignItems: "center", gap: 1.5, px: 2, pt: 1.75, pb: 2 }}
                        >
                            <Box className="stepped-help__dots" sx={{ display: "flex", gap: 0.65, flex: 1 }}>
                                {steps.map((entry, dotIndex) => (
                                    <Box
                                        key={entry.shot}
                                        sx={{
                                            height: 6,
                                            borderRadius: "99px",
                                            // The current dot stretches rather than changing colour
                                            // alone: at 6px a fill change is easy to miss, a width
                                            // change is not.
                                            width: dotIndex === current ? 16 : 6,
                                            backgroundColor: dotIndex === current ? COLORS.onSurface : COLORS.border,
                                            transition: "width 160ms ease, background-color 160ms ease",
                                        }}
                                    />
                                ))}
                            </Box>
                            {/* Back is the secondary action, so it is an outlined ghost pill
                                beside the solid Next rather than a second filled one. It is
                                absent (not disabled) on step 1: a dead button there reads as
                                broken, and since the dots take `flex: 1` on the left, its
                                arrival on step 2 moves neither the dots nor Next. */}
                            {current > 0 && (
                                <ButtonBase
                                    className="stepped-help__back"
                                    onClick={() => setIndex(current - 1)}
                                    aria-label="Previous step"
                                    sx={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 0.75,
                                        px: 1.6,
                                        py: 1.25,
                                        borderRadius: "999px",
                                        // Inset shadow rather than a border so the pill's box is
                                        // the same height as Next's and the two sit on one line.
                                        boxShadow: `inset 0 0 0 1px ${COLORS.border}`,
                                        color: COLORS.onSurface,
                                        fontFamily: FONTS.sans,
                                        fontSize: SIZE.body,
                                        fontWeight: WEIGHT.semibold,
                                    }}
                                >
                                    <Icon name="arrow_back" size={15} color={COLORS.onSurface} />
                                    Back
                                </ButtonBase>
                            )}
                            <ButtonBase
                                className="stepped-help__next"
                                onClick={() => (last ? onClose() : setIndex(current + 1))}
                                sx={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 0.75,
                                    px: 1.9,
                                    py: 1.25,
                                    borderRadius: "999px",
                                    backgroundColor: COLORS.onSurface,
                                    color: COLORS.white,
                                    fontFamily: FONTS.sans,
                                    fontSize: SIZE.body,
                                    fontWeight: WEIGHT.semibold,
                                }}
                            >
                                {last ? "Done" : "Next"}
                                {!last && <Icon name="arrow_forward" size={15} color={COLORS.white} />}
                            </ButtonBase>
                        </Box>
                    </Box>
                </>,
                host
            )}
        </>
    );
}

/** Replace `{key}` with `tokens[key]`, leaving unknown placeholders untouched. */
function substitute(text: string, tokens?: Record<string, string>): string {
    if (!tokens) return text;
    return text.replace(/\{(\w+)\}/g, (whole, key: string) => tokens[key] ?? whole);
}

export default SteppedHelpPopup;
