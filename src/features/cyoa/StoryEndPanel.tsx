import { useEffect, useState } from "react";
import { Box, Button, Typography, useMediaQuery } from "@mui/material";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { LEADING, SIZE, TRACKING, WEIGHT } from "../../theme/scale";
import type { Tier2Look } from "../../timeOfDay/tier2Look";
import type { StoryEndingReached } from "../../../server/contracts/stories";
import { cyoaPillButtonSx } from "./cyoaStyles";

/**
 * StoryEndPanel — what replaces (or follows) the choice stack when the story cannot go on
 * (docs/CYOA_FEATURE.md § 3.6 End screen, § 3.6a "To be continued").
 *
 *   kind="ending"        — an ending passage. Shows the ending's NAME (or "The End" when
 *                          the author left it unnamed), a "New!" badge the first time it
 *                          is reached, and "Endings found n/total". On a new ending the
 *                          count TICKS from the old value to the new one (1/7 → 2/7).
 *                          Under it, "Pages found x/y": the distinct passages this
 *                          learner has ever been served in the story (§ 3.6b,
 *                          migration 198). It does not tick — it moves on every page, so
 *                          the end card is not where it changes.
 *                          Progress was cleared server-side: reopening starts over.
 *   kind="toBeContinued" — every choice is disabled (no targets yet). Not an ending:
 *                          nothing is counted and progress stays put. Rendered UNDER the
 *                          disabled choices by StoryPlayPage.
 *
 * Both have exactly one action: back to the story list. There is no "start over"
 * (owner's call 2026-11-20).
 *
 * Colours: the "New!" badge is the yellow ramp MID with ink text (pastels stay pastel at
 * night); everything else is the look's ink / muted.
 *
 * Layer: feature presentation (src/features/cyoa). Local state: the tick only.
 * Rendered by StoryPlayPage.
 */

/** Delay before the counter ticks, so the eye lands on it first. */
const TICK_DELAY_MS = 550;

type StoryEndPanelProps =
    | {
        kind: "ending";
        look: Tier2Look;
        ending: StoryEndingReached;
        endingsFound: number;
        endingsTotal: number;
        /** The count before this ending (null = no tick: a repeat ending or a reload). */
        endingsFoundBefore: number | null;
        passagesSeen: number;
        passagesTotal: number;
        onBackToList: () => void;
    }
    | {
        kind: "toBeContinued";
        look: Tier2Look;
        onBackToList: () => void;
    };

function StoryEndPanel(props: StoryEndPanelProps) {
    const { look, onBackToList } = props;
    return (
        <Box
            className={`story-end-panel story-end-panel--${props.kind}`}
            sx={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "10px",
                pt: 1,
                textAlign: "center",
            }}
        >
            {props.kind === "ending" ? (
                <EndingSummary {...props} />
            ) : (
                <Typography
                    className="story-end-panel__to-be-continued"
                    sx={{
                        fontFamily: FONTS.sans,
                        fontSize: SIZE.subtitle,
                        fontWeight: WEIGHT.semibold,
                        fontStyle: "italic",
                        color: look.ink,
                    }}
                >
                    To be continued…
                </Typography>
            )}
            <Button
                className="story-end-panel__back-button"
                onClick={onBackToList}
                sx={{ ...cyoaPillButtonSx(look), mt: 0.5 }}
            >
                Back to Adventures
            </Button>
        </Box>
    );
}

/** The ending's name, its "New!" badge, the ticking endings-found count and pages found. */
function EndingSummary({
    look,
    ending,
    endingsFound,
    endingsTotal,
    endingsFoundBefore,
    passagesSeen,
    passagesTotal,
}: Extract<StoryEndPanelProps, { kind: "ending" }>) {
    const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
    const shouldTick = ending.isNew && endingsFoundBefore !== null && endingsFoundBefore < endingsFound && !reducedMotion;
    const [shownCount, setShownCount] = useState(shouldTick ? endingsFoundBefore! : endingsFound);
    const [ticked, setTicked] = useState(false);

    useEffect(() => {
        if (!shouldTick) {
            setShownCount(endingsFound);
            return;
        }
        setShownCount(endingsFoundBefore!);
        const timer = window.setTimeout(() => {
            setShownCount(endingsFound);
            setTicked(true);
        }, TICK_DELAY_MS);
        return () => window.clearTimeout(timer);
    }, [shouldTick, endingsFound, endingsFoundBefore]);

    return (
        <>
            <Box className="story-end-panel__title-row" sx={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", justifyContent: "center" }}>
                <Typography
                    className="story-end-panel__ending-title"
                    sx={{
                        fontFamily: FONTS.sans,
                        fontSize: SIZE.title,
                        fontWeight: WEIGHT.bold,
                        letterSpacing: "-0.015em",
                        lineHeight: LEADING.tight,
                        color: look.ink,
                    }}
                >
                    {ending.title ?? "The End"}
                </Typography>
                {ending.isNew && (
                    <Box
                        component="span"
                        className="story-end-panel__new-badge"
                        sx={{
                            fontFamily: FONTS.sans,
                            fontSize: SIZE.micro,
                            fontWeight: WEIGHT.bold,
                            letterSpacing: TRACKING.wide,
                            color: COLORS.onSurface,
                            backgroundColor: COLORS.yelM,
                            // Pastel mark → the inset mark ring (CLAUDE.md § Buttons & cards).
                            boxShadow: `inset 0 0 0 1px ${COLORS.markOutline}`,
                            borderRadius: "999px",
                            px: 1,
                            py: "2px",
                        }}
                    >
                        New!
                    </Box>
                )}
            </Box>
            <Typography
                className="story-end-panel__endings-found"
                sx={{ fontFamily: FONTS.sans, fontSize: SIZE.body, color: look.muted }}
            >
                Endings found{" "}
                <Box
                    component="span"
                    className="story-end-panel__endings-count"
                    sx={{
                        display: "inline-block",
                        fontWeight: WEIGHT.bold,
                        color: look.ink,
                        fontVariantNumeric: "tabular-nums",
                        // A small pop the moment the count ticks.
                        animation: ticked ? "storyEndCountPop 320ms ease-out" : "none",
                        "@keyframes storyEndCountPop": {
                            "0%": { transform: "scale(1)" },
                            "40%": { transform: "scale(1.25)" },
                            "100%": { transform: "scale(1)" },
                        },
                    }}
                >
                    {shownCount}/{endingsTotal}
                </Box>
            </Typography>
            <Typography
                className="story-end-panel__pages-found"
                sx={{ fontFamily: FONTS.sans, fontSize: SIZE.body, color: look.muted, mt: -0.5 }}
            >
                Pages found{" "}
                <Box
                    component="span"
                    className="story-end-panel__pages-count"
                    sx={{ fontWeight: WEIGHT.bold, color: look.ink, fontVariantNumeric: "tabular-nums" }}
                >
                    {passagesSeen}/{passagesTotal}
                </Box>
            </Typography>
        </>
    );
}

export default StoryEndPanel;
