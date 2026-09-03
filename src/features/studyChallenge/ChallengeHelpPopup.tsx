import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Box, ButtonBase, Typography } from "@mui/material";
import Icon from "../../components/Icon";
import { nearestOverlayHost } from "../../components/overlayHost";
import { useHideFooter } from "../../hooks/useHideFooter";
import type { ChallengeHelpStep } from "./challengeHelpSteps";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";
import { SHADOW } from "../../theme/shadows";

/**
 * Every screenshot in `src/assets/challengeHelp/`, resolved at build time.
 *
 * `import.meta.glob(..., { eager: true })` rather than a static import per file so a
 * new step is a data change in `challengeHelpSteps.ts` plus a dropped file — never an
 * edit here. A step naming a file that does not exist yet resolves to `undefined` and
 * renders the placeholder frame, which is why the explainer is usable before the
 * screenshots are captured.
 */
const SHOTS = import.meta.glob<{ default: string }>(
    "../../assets/challengeHelp/*.{png,jpg,jpeg,webp}",
    { eager: true }
);

function shotUrl(filename: string): string | undefined {
    const match = Object.entries(SHOTS).find(([path]) => path.endsWith(`/${filename}`));
    return match?.[1].default;
}

interface ChallengeHelpPopupProps {
    open: boolean;
    steps: readonly ChallengeHelpStep[];
    /** Substituted into any `{deck}` in a step's title — the generated deck's name. */
    deckName?: string;
    onClose: () => void;
}

/**
 * The stepped explainer used by both "How to study this deck" (F20) and "How the test
 * works" (F21) — ONE component, so the two read as one system rather than as two
 * things somebody built on different days.
 *
 * The shape is deliberate: image on top, instruction under it, one idea per step. Both
 * explainers teach WHERE something is or WHAT a rule is, and neither is worth a page —
 * a page would be somewhere to navigate back from, for content read once.
 *
 * ⚠️ IT DOES NOT REMEMBER BEING READ. There is no "seen" flag and no auto-open: both
 * explainers are behind an explicit control, so a learner who wants them twice gets
 * them twice and one who never wants them never sees them. Adding a first-run
 * auto-open would make the study button's one job — teaching a filter — into an
 * interruption.
 *
 * ⚠️ IT PORTALS OUT OF ITS HOST PAGE, for the same reason ChallengeSheet does: the
 * page's scroll area carries the edge-fade mask, which clips fixed descendants, and the
 * footer bar paints above every page surface. Both would eat the Next button.
 */
function ChallengeHelpPopup({ open, steps, deckName, onClose }: ChallengeHelpPopupProps) {
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
    const shot = shotUrl(step.shot);

    return (
        <>
            <Box component="span" ref={anchorRef} className="challenge-help__anchor" sx={{ display: "none" }} />
            {host && createPortal(
                <>
                    <Box
                        className="challenge-help__scrim"
                        onClick={onClose}
                        sx={{ position: "fixed", inset: 0, zIndex: 1300, backgroundColor: COLORS.modalScrim }}
                    />
                    <Box
                        className="challenge-help"
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
                            className="challenge-help__shot"
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
                                backgroundImage: "repeating-linear-gradient(135deg,rgba(23,22,26,.05) 0 6px,rgba(23,22,26,.015) 6px 12px)",
                            }}
                        >
                            {shot ? (
                                <Box
                                    component="img"
                                    className="challenge-help__shot-image"
                                    src={shot}
                                    alt={step.shotDescription}
                                    draggable={false}
                                    sx={{ width: "100%", height: "100%", objectFit: "cover", userSelect: "none" }}
                                />
                            ) : (
                                <Typography
                                    className="challenge-help__shot-placeholder"
                                    sx={{ fontFamily: FONTS.mono, fontSize: SIZE.micro, letterSpacing: "0.06em", color: "rgba(23,22,26,.34)", lineHeight: 1.5, px: 2.5 }}
                                >
                                    screenshot · {step.shotDescription}
                                </Typography>
                            )}

                            <Box
                                className="challenge-help__shot-chrome"
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
                                    background: "linear-gradient(to bottom,rgba(20,18,26,.82) 0%,rgba(20,18,26,.62) 48%,rgba(20,18,26,0) 100%)",
                                }}
                            >
                                <Box sx={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                                    <Typography sx={{ fontFamily: FONTS.sans, fontSize: SIZE.bodyLg, fontWeight: WEIGHT.semibold, letterSpacing: "-0.015em", color: "#fff" }}>
                                        {step.heading}
                                    </Typography>
                                    <Typography sx={{ fontFamily: FONTS.mono, fontSize: SIZE.micro, letterSpacing: "0.11em", textTransform: "uppercase", color: "rgba(255,255,255,.88)", mt: 0.5 }}>
                                        step {Math.min(index, steps.length - 1) + 1} of {steps.length}
                                    </Typography>
                                </Box>
                                <ButtonBase
                                    className="challenge-help__close"
                                    onClick={onClose}
                                    aria-label="Close"
                                    sx={{ flexShrink: 0, borderRadius: "999px", p: 0.75, backgroundColor: "rgba(255,255,255,.9)", color: COLORS.onSurface }}
                                >
                                    <Icon name="close" size={18} color={COLORS.onSurface} />
                                </ButtonBase>
                            </Box>
                        </Box>

                        <Box className="challenge-help__caption" sx={{ px: 2.25, pt: 1.9 }}>
                            <Typography sx={{ fontFamily: FONTS.sans, fontSize: SIZE.body, fontWeight: WEIGHT.semibold, color: COLORS.onSurface }}>
                                {deckName ? step.title.replace("{deck}", deckName) : step.title.replace("{deck}", "challenge")}
                            </Typography>
                            <Typography sx={{ fontFamily: FONTS.sans, fontSize: SIZE.caption, color: COLORS.textSecondary, lineHeight: 1.5, mt: 0.5, textWrap: "pretty" }}>
                                {step.body}
                            </Typography>
                        </Box>

                        <Box
                            className="challenge-help__footer"
                            sx={{ display: "flex", alignItems: "center", gap: 1.5, px: 2, pt: 1.75, pb: 2 }}
                        >
                            <Box className="challenge-help__dots" sx={{ display: "flex", gap: 0.65, flex: 1 }}>
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
                                className="challenge-help__next"
                                onClick={() => (last ? onClose() : setIndex((n) => n + 1))}
                                sx={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 0.75,
                                    px: 1.9,
                                    py: 1.25,
                                    borderRadius: "999px",
                                    backgroundColor: COLORS.onSurface,
                                    color: "#fff",
                                    fontFamily: FONTS.sans,
                                    fontSize: SIZE.body,
                                    fontWeight: WEIGHT.semibold,
                                }}
                            >
                                {last ? "Done" : "Next"}
                                {!last && <Icon name="arrow_forward" size={15} color="#fff" />}
                            </ButtonBase>
                        </Box>
                    </Box>
                </>,
                host
            )}
        </>
    );
}

export default ChallengeHelpPopup;
