import { alpha } from "@mui/material/styles";
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Box, ButtonBase, Typography } from "@mui/material";
import Icon from "./Icon";
import { nearestOverlayHost } from "./overlayHost";
import { useHideFooter } from "../hooks/useHideFooter";
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
 * footer bar paints above every page surface. Both would eat the Next button.
 */
function SteppedHelpPopup({ open, steps, resolveShot, tokens, onClose }: SteppedHelpPopupProps) {
    const [index, setIndex] = useState(0);
    // Written here, painted at frame level — see the portal note above.
    const anchorRef = useRef<HTMLSpanElement | null>(null);
    const [host, setHost] = useState<HTMLElement | null>(null);

    const showing = open && steps.length > 0;
    useLayoutEffect(() => {
        if (!showing) { setHost(null); return; }
        const el = anchorRef.current;
        if (el) setHost(nearestOverlayHost(el));
    }, [showing]);
    useHideFooter(showing);

    if (!showing) return null;
    // Guard the index rather than resetting it in an effect: `steps` can change
    // identity between the two explainers on the same page, and an effect would race
    // the render that is already using the stale index.
    const step = steps[Math.min(index, steps.length - 1)];
    const last = index >= steps.length - 1;
    const shot = resolveShot(step.shot);

    return (
        <>
            <Box component="span" ref={anchorRef} className="stepped-help__anchor" sx={{ display: "none" }} />
            {host && createPortal(
                <>
                    <Box
                        className="stepped-help__scrim"
                        onClick={onClose}
                        sx={{ position: "fixed", inset: 0, zIndex: 1300, backgroundColor: COLORS.modalScrim }}
                    />
                    <Box
                        className="stepped-help"
                        sx={{
                            position: "fixed",
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
                        {/* The image, with the step's heading and the close control floated over
                            it under a scrim gradient — the shot is the largest thing in the card,
                            so putting chrome beside it rather than on it would shrink the one
                            part that carries the instruction. */}
                        <Box
                            className="stepped-help__shot"
                            sx={{
                                position: "relative",
                                aspectRatio: "3 / 4",
                                borderBottom: `1px solid ${COLORS.rowBorder}`,
                                overflow: "hidden",
                                backgroundColor: COLORS.white,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                textAlign: "center",
                                // The hatch shows through wherever there is no image yet.
                                backgroundImage: `repeating-linear-gradient(135deg,${COLORS.rowHoverBg} 0 6px,${alpha(COLORS.onSurface, 0.015)} 6px 12px)`,
                            }}
                        >
                            {shot ? (
                                <Box
                                    component="img"
                                    className="stepped-help__shot-image"
                                    src={shot}
                                    alt={step.shotDescription}
                                    draggable={false}
                                    sx={{ width: "100%", height: "100%", objectFit: "cover", userSelect: "none" }}
                                />
                            ) : (
                                <Typography
                                    className="stepped-help__shot-placeholder"
                                    sx={{ fontFamily: FONTS.mono, fontSize: SIZE.micro, letterSpacing: "0.06em", color: alpha(COLORS.onSurface, 0.34), lineHeight: 1.5, px: 2.5 }}
                                >
                                    screenshot · {step.shotDescription}
                                </Typography>
                            )}

                            <Box
                                className="stepped-help__shot-chrome"
                                sx={{
                                    position: "absolute",
                                    left: 0,
                                    right: 0,
                                    top: 0,
                                    display: "flex",
                                    alignItems: "flex-start",
                                    gap: 1.25,
                                    px: 1.75,
                                    pt: 1.75,
                                    pb: 4.25,
                                    background: `linear-gradient(to bottom,${alpha(COLORS.onSurface, 0.82)} 0%,${alpha(COLORS.onSurface, 0.62)} 48%,${alpha(COLORS.onSurface, 0)} 100%)`,
                                }}
                            >
                                <Box sx={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                                    <Typography sx={{ fontFamily: FONTS.sans, fontSize: SIZE.bodyLg, fontWeight: WEIGHT.semibold, letterSpacing: "-0.015em", color: COLORS.white }}>
                                        {step.heading}
                                    </Typography>
                                    <Typography sx={{ fontFamily: FONTS.label, fontSize: SIZE.micro, letterSpacing: "0.11em", textTransform: "uppercase", color: "rgba(255,255,255,.88)", mt: 0.5 }}>
                                        step {Math.min(index, steps.length - 1) + 1} of {steps.length}
                                    </Typography>
                                </Box>
                                <ButtonBase
                                    className="stepped-help__close"
                                    onClick={onClose}
                                    aria-label="Close"
                                    sx={{ flexShrink: 0, borderRadius: "999px", p: 0.75, backgroundColor: "rgba(255,255,255,.9)", color: COLORS.onSurface }}
                                >
                                    <Icon name="close" size={18} color={COLORS.onSurface} />
                                </ButtonBase>
                            </Box>
                        </Box>

                        <Box className="stepped-help__caption" sx={{ px: 2.25, pt: 1.9 }}>
                            <Typography sx={{ fontFamily: FONTS.sans, fontSize: SIZE.body, fontWeight: WEIGHT.semibold, color: COLORS.onSurface }}>
                                {substitute(step.title, tokens)}
                            </Typography>
                            <Typography sx={{ fontFamily: FONTS.sans, fontSize: SIZE.caption, color: COLORS.textSecondary, lineHeight: 1.5, mt: 0.5, textWrap: "pretty" }}>
                                {step.body}
                            </Typography>
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
                                            width: dotIndex === index ? 16 : 6,
                                            backgroundColor: dotIndex === index ? COLORS.onSurface : COLORS.border,
                                            transition: "width 160ms ease, background-color 160ms ease",
                                        }}
                                    />
                                ))}
                            </Box>
                            <ButtonBase
                                className="stepped-help__next"
                                onClick={() => (last ? onClose() : setIndex((n) => n + 1))}
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
