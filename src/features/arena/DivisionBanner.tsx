import { Box, Typography } from "@mui/material";
import { COLORS, RAMP } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { DIVISION_NAMES, divisionName } from "./arenaStyles";

/**
 * `.banner.fullbleed` — the arena's division plate (docs/ARENA_FEATURE.md § 7,
 * `Arena Flow - Shelf System.html` artboards A1–A17, which draw it on EVERY state).
 *
 * The rung the viewer currently holds, drawn as a hanging pennant that runs wall to wall
 * from the very top of the screen, with the PAGE HEADER sitting inside it.
 *
 * ── WHY IT SWALLOWS THE HEADER ───────────────────────────────────────────────────────
 * In the first cut this was a card-width plate floating below a normal page header, and
 * the two read as two things: some chrome, and then a coloured box about a division. The
 * arena flow redraws it as the page's own masthead — the back arrow, the title and the
 * header actions all sit ON the plate, so the first thing the screen says is the rung you
 * hold, and everything else is inside it. That is why this component takes a `header`
 * slot rather than being rendered after one: the header is not above the banner, it is
 * part of it.
 *
 * It is handed in through `MobileTabScreen`'s `wrapHeader`, so the banner still scrolls
 * away with the header exactly as every other page's header does (A2 draws the scrolled
 * state: plain paper, no plate).
 *
 * ── WHY A BANNER AND NOT A CARD ──────────────────────────────────────────────────────
 * Every other boxed thing on this page is a `SectionCard` — white, hairline, 18px radius,
 * sitting ON the paper. The banner is the one element that is not a container of
 * information but a STATEMENT of standing, so it is the one element the design lets break
 * the page's material: full bleed, square corners, and it ends in a notch rather than a
 * radius. That notch is doing real work — it is what makes the shape read as a hanging
 * pennant rather than as a coloured strip someone put behind the header.
 *
 * ── ⚠️ THE PLATE IS STILL AN UNSTYLED PLACEHOLDER ────────────────────────────────────
 * The design project's `Arena Division Banners.html` draws all twelve rungs as distinct
 * MATERIALS — quarried stone, struck medals, machined alloys, cut gems. Those were ported
 * and then withdrawn, because twelve hand-authored gradients meant ~30 hex values living
 * outside the ramp. **The arena flow artboards all paint this `var(--grey)`**, so the
 * placeholder is now what the design itself draws, not merely what we settled for.
 *
 * It is still not a finished ladder: the whole point of twelve named rungs is that
 * climbing one should look like something. What distinguishes rung 3 from rung 11 today
 * is the tick row alone — and, as of the arena flow, ONLY the tick row, because the
 * "N of 12" meta and the "next rung" line were both removed (see below).
 *
 * When the material question is settled, everything needed is here: give this component a
 * per-rung fill and, if any of those fills are dark, a per-rung ink. Nothing else on the
 * page reads the division's appearance. Note the palette objection is now weaker than it
 * was — `RAMP.gld` exists (theme/colors), so a metals ladder has at least one real ramp
 * entry to build from. Tracked in docs/DEFERRED_WORK.md.
 *
 * ── WHAT THE ARENA FLOW REMOVED, AND WHY IT IS NOT AN OVERSIGHT ──────────────────────
 * Two lines that used to sit here are gone, both confirmed with the product owner:
 *
 *   • the `meta` note ("5 OF 12") in the top-right
 *   • the "NEXT RUNG · PLATINUM" line under the name
 *
 * `.top2` in the artboards carries the division NAME and nothing else. The argument for
 * keeping the meta was that it changes as you climb while the grey plate does not — but
 * the ticks already say the same thing in a form you see rather than read, and three
 * restatements of one number is what made the old banner feel like a dashboard instead of
 * a nameplate. The `meta` prop was removed rather than defaulted, so nothing can quietly
 * pass one back.
 *
 * ── THE TICKS ARE THE LADDER, AND THEY REPLACED `.ladder` ────────────────────────────
 * § A7 of the redesign listed a separate `.ladder` widget (twelve bars with a `.now`
 * outline). It appears in `shelf-system.css` but in NONE of the spec artboards — the
 * shipped design folds the same information into this banner's twelve ticks, which is
 * strictly better: a lone ladder would be a second place the app says which rung you are
 * on, and two of those can disagree. `.ladder` is closed as superseded, not deferred.
 */

export interface DivisionBannerProps {
    /** 1-based rung, 1…12. Clamped, so bad data degrades to Slate rather than blanking. */
    division: number;
    /**
     * The page header, rendered INSIDE the plate above the division name.
     *
     * Supplied by `MobileTabScreen`'s `wrapHeader`; see the note above on why the header
     * belongs to the banner rather than sitting above it.
     */
    header?: React.ReactNode;
    className?: string;
}

const TICK_COUNT = DIVISION_NAMES.length;

/** Clamp any incoming value to a real rung, so bad data cannot blank the banner. */
function clampDivision(division: number): number {
    return Math.min(Math.max(Math.round(division), 1), TICK_COUNT);
}

const DivisionBanner: React.FC<DivisionBannerProps> = ({ division, header, className }) => {
    const rung = clampDivision(division);

    return (
        <Box
            className={`division-banner division-banner--${rung}${className ? ` ${className}` : ""}`}
            sx={{
                position: "relative",
                // Wall to wall and up to the ceiling — no margin, no radius. The header
                // inside it carries the status-bar inset, so nothing is needed here.
                width: "100%",
                margin: 0,
                padding: "0 22px 30px",
                borderRadius: 0,
                // The pennant notch. The 30px of bottom padding above is what keeps the
                // ticks clear of the cut — without it the clip eats the row.
                clipPath: "polygon(0 0, 100% 0, 100% 100%, 50% calc(100% - 15px), 0 100%)",
                // ⚠️ PLACEHOLDER — the same neutral for all twelve rungs. See the header.
                backgroundColor: RAMP.grey.fill,
                color: COLORS.onSurface,
            }}
        >
            {/* The header's own horizontal padding is cancelled: the banner already pads
                to 22px, and letting the header pad again would indent the back arrow
                relative to the division name directly under it. */}
            <Box
                className="division-banner__header"
                sx={{ marginBottom: "17px", "& .page-header": { paddingLeft: 0, paddingRight: 0 } }}
            >
                {header}
            </Box>

            <Typography
                className="division-banner__name"
                sx={{
                    fontFamily: FONTS.sans,
                    // 40px, not the old 27px: with the meta and next-rung lines gone the
                    // name is the only thing on this line, and at full bleed it has the
                    // width to be the page's masthead rather than a label.
                    fontSize: 40,
                    fontWeight: 700,
                    letterSpacing: "-0.032em",
                    lineHeight: 1,
                    color: COLORS.onSurface,
                }}
            >
                {divisionName(rung)}
            </Typography>

            <Box className="division-banner__ticks" sx={{ display: "flex", gap: "3px", marginTop: "11px" }}>
                {Array.from({ length: TICK_COUNT }, (_, i) => (
                    <Box
                        key={i}
                        className={`division-banner__tick${i < rung ? " division-banner__tick--on" : ""}`}
                        sx={{
                            flex: 1,
                            height: "4px",
                            borderRadius: "2px",
                            // Both states are transparencies of the same ink. That is a
                            // placeholder decision which should SURVIVE the placeholder:
                            // whatever the twelve plates end up being, a fixed "muted"
                            // colour will fail on some of them, while a transparency of
                            // the ink that already works cannot.
                            backgroundColor: i < rung ? COLORS.onSurface : COLORS.border,
                        }}
                    />
                ))}
            </Box>
        </Box>
    );
};

export default DivisionBanner;
