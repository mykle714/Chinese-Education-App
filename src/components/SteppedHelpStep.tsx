import { alpha } from "@mui/material/styles";
import { Box, Typography } from "@mui/material";
import { COLORS } from "../theme/colors";
import { FONTS } from "../theme/fonts";
import { SIZE, WEIGHT } from "../theme/scale";
import type { HelpStep } from "./steppedHelp";

interface SteppedHelpStepProps {
    step: HelpStep;
    /** 0-based position, for the "step N of M" kicker. */
    position: number;
    total: number;
    /** Already resolved by the popup; `undefined` renders the placeholder frame. */
    shotUrl: string | undefined;
    /** The step's title with `{token}` placeholders already substituted. */
    title: string;
}

/**
 * ONE PAGE of the shp strip — the shot with its heading floated over it, and the
 * caption under it. Everything in here slides with the swipe; the close control and the
 * footer (dots, Back, Next) belong to `SteppedHelpPopup` and stay put.
 *
 * Split out of `SteppedHelpPopup.tsx` when the popup became a swipeable strip that
 * renders every step at once (2026-09-25), which pushed that file past ~300 lines.
 *
 * Documented in: docs/STUDY_CHALLENGE.md § 5.4c, docs/ARENA_FEATURE.md (rules card).
 */
function SteppedHelpStep({ step, position, total, shotUrl, title }: SteppedHelpStepProps) {
    return (
        <Box className="stepped-help__page" sx={{ flex: "0 0 100%", minWidth: 0 }}>
            {/* The image, with the step's heading floated over it under a scrim
                gradient — the shot is the largest thing in the card, so putting chrome
                beside it rather than on it would shrink the one part that carries the
                instruction. */}
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
                {shotUrl ? (
                    <Box
                        component="img"
                        className="stepped-help__shot-image"
                        src={shotUrl}
                        alt={step.shotDescription}
                        draggable={false}
                        sx={{ width: "100%", height: "100%", objectFit: "cover", userSelect: "none", pointerEvents: "none" }}
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
                        // Right padding clears the popup's close button, which floats
                        // over this corner but does not slide with the page.
                        pl: 1.75,
                        pr: 6.5,
                        pt: 1.75,
                        pb: 4.25,
                        textAlign: "left",
                        background: `linear-gradient(to bottom,${alpha(COLORS.onSurface, 0.82)} 0%,${alpha(COLORS.onSurface, 0.62)} 48%,${alpha(COLORS.onSurface, 0)} 100%)`,
                    }}
                >
                    <Typography sx={{ fontFamily: FONTS.sans, fontSize: SIZE.bodyLg, fontWeight: WEIGHT.semibold, letterSpacing: "-0.015em", color: COLORS.white }}>
                        {step.heading}
                    </Typography>
                    <Typography sx={{ fontFamily: FONTS.label, fontSize: SIZE.micro, letterSpacing: "0.11em", textTransform: "uppercase", color: "rgba(255,255,255,.88)", mt: 0.5 }}>
                        step {position + 1} of {total}
                    </Typography>
                </Box>
            </Box>

            <Box className="stepped-help__caption" sx={{ px: 2.25, pt: 1.9 }}>
                <Typography sx={{ fontFamily: FONTS.sans, fontSize: SIZE.body, fontWeight: WEIGHT.semibold, color: COLORS.onSurface }}>
                    {title}
                </Typography>
                <Typography sx={{ fontFamily: FONTS.sans, fontSize: SIZE.caption, color: COLORS.textSecondary, lineHeight: 1.5, mt: 0.5, textWrap: "pretty" }}>
                    {step.body}
                </Typography>
            </Box>
        </Box>
    );
}

export default SteppedHelpStep;
