import { Box, Typography } from "@mui/material";
import { COLORS, RAMP } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { DIVISION_NAMES, divisionName } from "./arenaStyles";

/**
 * `.banner` — the arena's division plate (docs/SHELF_REDESIGN.md entry 9, artboard 9).
 *
 * The rung the viewer currently holds, drawn as a hanging banner: the division's name
 * large, its position in the ladder small beside it, the next rung named underneath, and
 * a twelve-tick climb along the bottom.
 *
 * ── WHY A BANNER AND NOT A CARD ──────────────────────────────────────────────────────
 * Every other boxed thing on this page is a `SectionCard` — white, hairline, 18px radius,
 * sitting ON the paper. The banner is the one element that is not a container of
 * information but a STATEMENT of standing, so it is the one element the design lets break
 * the page's material: its corners are square at the bottom and it ends in a notch rather
 * than a radius. That notch is doing real work — it is what makes the shape read as a
 * hanging pennant rather than as a card someone tinted.
 *
 * ── ⚠️ THE PLATE IS AN UNSTYLED PLACEHOLDER (user's ruling, 2026-08-24) ──────────────
 * The design project's `Arena Division Banners.html` draws all twelve rungs as distinct
 * MATERIALS — quarried stone, struck medals, machined alloys, cut gems. Those were ported
 * and then **withdrawn**: twelve hand-authored gradients meant ~30 hex values living
 * outside the ramp, and that palette decision is not being taken yet.
 *
 * So every rung currently wears the SAME neutral grey. This is deliberately a placeholder
 * and not a design — it means the banner is honest about the shape and silent about the
 * material. **A ladder whose rungs all look alike is not a finished ladder**: the whole
 * point of twelve named rungs is that climbing one should look like something, and right
 * now it does not. What still works is the tick row, which is the only thing on the
 * banner currently distinguishing rung 3 from rung 11.
 *
 * When the material question is settled, everything needed is right here: give this
 * component a per-rung fill and, if any of those fills are dark, a per-rung ink. Nothing
 * else on the page reads the division's appearance. Tracked in docs/DEFERRED_WORK.md.
 *
 * ── THE TICKS ARE THE LADDER, AND THEY REPLACED `.ladder` ────────────────────────────
 * § A7 of the redesign listed a separate `.ladder` widget (twelve bars with a `.now`
 * outline). It appears in `shelf-system.css` but in NONE of the 27 spec artboards — the
 * shipped design folds the same information into this banner's twelve ticks, which is
 * strictly better: a lone ladder would be a second place the app says which rung you are
 * on, and two of those can disagree. `.ladder` is closed as superseded, not deferred.
 */

export interface DivisionBannerProps {
    /** 1-based rung, 1…12. Clamped, so bad data degrades to Slate rather than blanking. */
    division: number;
    /**
     * A short mono note in the top-right, where the ladder position sits.
     *
     * Defaults to "N of 12" — the rung as a fraction, which is the fact a competitor
     * wants when the NAME alone does not say whether "Steel" is good.
     *
     * It carries more weight than it looks like it should while the plate is a
     * placeholder: with every rung the same colour, this line and the ticks are the only
     * things on the banner that change as you climb.
     */
    meta?: React.ReactNode;
    className?: string;
}

const TICK_COUNT = DIVISION_NAMES.length;

/** Clamp any incoming value to a real rung, so bad data cannot blank the banner. */
function clampDivision(division: number): number {
    return Math.min(Math.max(Math.round(division), 1), TICK_COUNT);
}

const DivisionBanner: React.FC<DivisionBannerProps> = ({ division, meta, className }) => {
    const rung = clampDivision(division);
    // At the top of the ladder there is no next rung, and the design says so by OMITTING
    // the line rather than by writing "you are at the top" — the full row of lit ticks
    // above it already says that, and a line explaining it would be the only place on the
    // banner that needed reading rather than seeing.
    const nextRung = rung < TICK_COUNT ? divisionName(rung + 1) : null;

    return (
        <Box
            className={`division-banner division-banner--${rung}${className ? ` ${className}` : ""}`}
            sx={{
                position: "relative",
                margin: "15px 22px 0",
                padding: "15px 17px 26px",
                // Square at the foot: the notch is cut there, and a radius under a
                // clip-path would just be clipped away.
                borderRadius: "15px 15px 0 0",
                // The pennant notch. The extra 15px of bottom padding above is what keeps
                // the ticks clear of the cut — without it the clip eats the row.
                clipPath: "polygon(0 0, 100% 0, 100% 100%, 50% calc(100% - 15px), 0 100%)",
                // ⚠️ PLACEHOLDER — the same neutral for all twelve rungs. See the header.
                backgroundColor: RAMP.grey.fill,
                color: COLORS.onSurface,
            }}
        >
            <Box
                className="division-banner__top"
                // Baseline, not centre: the 27px name and the 10px note are wildly
                // different sizes, and centring them would leave the small one floating in
                // the middle of the big one's line rather than sitting on it.
                sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "12px" }}
            >
                <Typography
                    className="division-banner__name"
                    sx={{
                        fontFamily: FONTS.sans,
                        fontSize: 27,
                        fontWeight: 700,
                        letterSpacing: "-0.032em",
                        lineHeight: 1,
                        color: COLORS.onSurface,
                    }}
                >
                    {divisionName(rung)}
                </Typography>
                <Typography
                    className="division-banner__meta"
                    sx={{
                        fontFamily: FONTS.mono,
                        fontSize: 10,
                        letterSpacing: "0.1em",
                        textTransform: "uppercase",
                        // Opacity rather than a second ink token. That is a placeholder
                        // decision that should SURVIVE the placeholder: whatever the twelve
                        // plates end up being, a fixed "muted" colour will fail on some of
                        // them, while a transparency of the ink that already works cannot.
                        opacity: 0.7,
                        color: COLORS.onSurface,
                        whiteSpace: "nowrap",
                    }}
                >
                    {meta ?? `${rung} of ${TICK_COUNT}`}
                </Typography>
            </Box>

            {nextRung && (
                <Typography
                    className="division-banner__next"
                    sx={{
                        fontFamily: FONTS.mono,
                        fontSize: 10,
                        letterSpacing: "0.1em",
                        textTransform: "uppercase",
                        opacity: 0.7,
                        color: COLORS.onSurface,
                        marginTop: "4px",
                    }}
                >
                    next rung · {nextRung}
                </Typography>
            )}

            <Box className="division-banner__ticks" sx={{ display: "flex", gap: "3px", marginTop: "11px" }}>
                {Array.from({ length: TICK_COUNT }, (_, i) => (
                    <Box
                        key={i}
                        className={`division-banner__tick${i < rung ? " division-banner__tick--on" : ""}`}
                        sx={{
                            flex: 1,
                            height: "4px",
                            borderRadius: "2px",
                            // Both states are transparencies of the same ink, for the same
                            // reason the meta line is.
                            backgroundColor: i < rung ? COLORS.onSurface : COLORS.border,
                        }}
                    />
                ))}
            </Box>
        </Box>
    );
};

export default DivisionBanner;
