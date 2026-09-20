import { Box, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import InfoTip from "./InfoTip";
import { StatCard } from "./primitives";
import { CATEGORY_BOUNDARIES } from "../../server/contracts/mastery";
import { getBandInk } from "../utils/categoryColors";
import { COLORS } from "../theme/colors";
import { FONTS } from "../theme/fonts";

/**
 * `VelocityStatCard` — the Velocity figure as a `StatCard`, with the ⓘ that explains
 * what a level-up is (docs/VELOCITY.md).
 *
 * Extracted from `AccountPage` when the user profile grew a per-language copy of the
 * same figure. Velocity is a number nobody can interpret without the definition — it
 * counts CARDS CROSSING A MASTERY BAND over a window, not cards studied — so the
 * definition has to travel with it. Two pages each writing out that sentence is two
 * sentences that will drift, and a profile that explained velocity differently from
 * the account page would be worse than one that did not explain it at all.
 *
 * The ⓘ is why the card has no `description`: the explanation is one tap away instead
 * of a permanent line of small print, which is what keeps the figure the loudest thing
 * in the card (`InfoTip`'s header).
 *
 * ── ONE LINE: THE FIGURE IS AN EQUATION ───────────────────────────────────────
 * The card reads `9 = 4 U→T + 3 T→C + 2 C→M` on a single baseline: the headline total,
 * then one term per adjacent band boundary — which cards crossed *where*
 * (docs/VELOCITY.md § 2b). It is literally an equation and not three stats beside a
 * total, because a card that climbs two bands in one mark is counted at BOTH
 * boundaries it passed, so the terms always sum to the headline. The `=` and `+` are
 * load-bearing: without them a reader has no reason to believe the small figures
 * belong to the big one.
 *
 * Everything sits in `StatCard`'s `value` slot rather than in a second row under it —
 * so the primitive keeps its "one big figure" shape (its own header warns that three
 * stacked figures is a data table wearing a costume) and the card stays one line tall
 * on both hosts. The slot renders inside a `<p>`, which is why every node here is a
 * `span`: a `div` in there is invalid HTML and React says so at runtime.
 *
 * Each term takes its DESTINATION band's ink (`getBandInk`) — the same four hues the
 * shelf, the band chips and the mini-card pips use — so "cards that reached Mastered"
 * is the blue figure on every surface in the app.
 *
 * Rendered by: `src/pages/AccountPage.tsx` (the signed-in user's own, page-wide) and
 * `src/features/profile/ProfileStatsCard.tsx` (one per language, inside a panel that
 * already insets it — hence the `sx` escape hatch).
 */

export interface VelocityStatCardProps {
    /** Level-ups in the window. */
    velocity: number;
    /** The window the figure covers, in days — the server decides it, not the client. */
    windowDays: number;
    /**
     * `velocity` split per band boundary, ascending and aligned with
     * `CATEGORY_BOUNDARIES` — `[Unfamiliar→Target, Target→Comfortable,
     * Comfortable→Mastered]`. The server always sends a full-length array; a caller
     * that passes the wrong length (or nothing) gets the bare figure rather than terms
     * labelled with the wrong boundary.
     */
    boundaryCounts?: number[];
    className?: string;
    /** Placement overrides for the underlying `SectionCard` shell, e.g. `{ mx: 0 }`. */
    sx?: SxProps<Theme>;
}

/** First letter of a band name — "U", "T", "C", "M". The ⓘ spells them out. */
const initial = (category: string): string => category.charAt(0);

/** The `=` and `+` operators. Faint, because they are grammar rather than data. */
const operatorSx = {
    fontFamily: FONTS.mono,
    fontSize: 15,
    fontWeight: 500,
    color: COLORS.textFaint,
    marginX: "6px",
} as const;

/**
 * The equation that follows the headline: `= 4 U→T + 3 T→C + 2 C→M`.
 *
 * Pure presentation — it does no summing of its own, because the total it would
 * produce is the headline the server already sent, and two places computing one number
 * is how they come to disagree.
 *
 * Allowed to WRAP. It almost never does (three single-digit terms are ~200px), but a
 * three-digit velocity inside the profile's already-inset panel would otherwise push
 * past the card's edge, and a centred second line is a far better failure than a
 * clipped one.
 */
const VelocityEquation: React.FC<{ counts: number[] }> = ({ counts }) => (
    <Box
        component="span"
        className="velocity-stat-card__equation"
        sx={{ display: "inline-flex", alignItems: "baseline", flexWrap: "wrap", justifyContent: "center" }}
    >
        <Typography component="span" className="velocity-stat-card__equals" aria-hidden sx={operatorSx}>
            =
        </Typography>
        {CATEGORY_BOUNDARIES.map((boundary, i) => (
            <Box
                component="span"
                key={`${boundary.from}-${boundary.to}`}
                className="velocity-stat-card__term"
                sx={{ display: "inline-flex", alignItems: "baseline" }}
            >
                {i > 0 && (
                    <Typography component="span" className="velocity-stat-card__plus" aria-hidden sx={operatorSx}>
                        +
                    </Typography>
                )}
                <Typography
                    component="span"
                    className="velocity-stat-card__term-value"
                    sx={{
                        fontFamily: FONTS.mono,
                        fontSize: 17,
                        fontWeight: 600,
                        letterSpacing: "-0.01em",
                        // The band the cards ARRIVED in — the one the learner earned.
                        color: getBandInk(boundary.to),
                    }}
                >
                    {counts[i]}
                </Typography>
                <Typography
                    component="span"
                    className="velocity-stat-card__term-label"
                    // Screen readers get the band names; the abbreviation is a
                    // space-saving device for sighted readers, not the content.
                    aria-label={`${boundary.from} to ${boundary.to}`}
                    sx={{
                        fontFamily: FONTS.label,
                        fontSize: 10,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        marginLeft: "3px",
                        color: COLORS.textFaint,
                        whiteSpace: "nowrap",
                    }}
                >
                    {initial(boundary.from)}→{initial(boundary.to)}
                </Typography>
            </Box>
        ))}
    </Box>
);

const VelocityStatCard: React.FC<VelocityStatCardProps> = ({
    velocity,
    windowDays,
    boundaryCounts,
    className,
    sx,
}) => {
    // Only drawn when the array matches the contract's shape. A short array would mean
    // labelling a count with the wrong boundary, which is worse than not showing it.
    const showEquation = boundaryCounts?.length === CATEGORY_BOUNDARIES.length;

    return (
        <StatCard
            className={className ? `velocity-stat-card ${className}` : "velocity-stat-card"}
            sx={sx}
            label={
                <>
                    Velocity{" "}
                    <InfoTip
                        className="velocity-stat-card__info"
                        ariaLabel="What counts as a level-up"
                        text={`A level-up is one card crossing into a higher mastery band — Unfamiliar → Target → Comfortable → Mastered. Counted over the last ${windowDays} days. The terms beside the total split it by which band the card crossed into; a card that jumped two bands at once counts in both.`}
                    />
                </>
            }
            value={
                <>
                    {velocity}
                    {showEquation && <VelocityEquation counts={boundaryCounts!} />}
                </>
            }
        />
    );
};

export default VelocityStatCard;
