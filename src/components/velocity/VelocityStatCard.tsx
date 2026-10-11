import { Box } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import InfoTip from "../InfoTip";
import { StatCard } from "../primitives";
import { CATEGORY_BOUNDARIES } from "../../../server/contracts/mastery";
import VelocityArrows from "./VelocityArrows";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { LEADING, SIZE, WEIGHT } from "../../theme/scale";

/**
 * `VelocityStatCard` — the Velocity figure as a `StatCard`. Three parts, top to bottom:
 * the boundary arrows that hang under the library shelf, the "VELOCITY ⓘ" overline,
 * and the total. Shelf System v2, artboard 5.
 *
 * Private to `components/velocity/`: the arrows must line up with the shelf's spines,
 * so the card is rendered only through `LibraryShelfWithVelocity`, which owns both
 * halves and hands this card the spine row's ref.
 *
 * ── THE BREAKDOWN IS A PICTURE, NOT AN EQUATION ──────────────────────────────────
 * The boundary split (docs/VELOCITY.md § 2b) used to be the one-line equation
 * `9 = 4 U→T + 3 T→C + 2 C→M`. v2 draws it instead: each boundary is a U-arrow from
 * one spine to the next, carrying `+N` (`VelocityArrows`). The arrows still sum to the
 * headline, since a two-band jump counts at both boundaries it crosses. That is no
 * longer spelled out with `=` and `+`. The ⓘ says it instead.
 *
 * ── NO CAPTION ────────────────────────────────────────────────────────────────
 * The artboard draws "Mastery level-ups in the last 7 days" as body copy. It is
 * deliberately NOT rendered: the window and the definition of a level-up live in the
 * ⓘ, so the figure stays the loudest thing in the card. **The ⓘ sentence lives here
 * and only here**. Velocity cannot be read without the definition, and a second host
 * writing its own copy is a copy that will drift.
 *
 * Referenced by: docs/VELOCITY.md § 4; docs/USER_PROFILE_PAGE.md.
 */

export interface VelocityStatCardProps {
    /** Level-ups in the window. */
    velocity: number;
    /** The window the figure covers, in days — the server decides it, not the client. */
    windowDays: number;
    /**
     * `velocity` split per band boundary, ascending and aligned with
     * `CATEGORY_BOUNDARIES`. The server always sends a full-length array. If it is
     * missing and `velocity` is 0, the arrows draw as +0. If it is missing or the wrong
     * length while `velocity` is non-zero, the arrows are dropped rather than labelling
     * a count with the wrong boundary.
     */
    boundaryCounts?: number[];
    /** The shelf the arrows hang from (see `VelocityArrows`). */
    spineRowRef: React.RefObject<HTMLElement | null>;
    /** True once the shelf's spines are mounted. */
    spinesReady: boolean;
    className?: string;
    /** Placement overrides for the underlying `SectionCard` shell, e.g. `{ mx: 0 }`. */
    sx?: SxProps<Theme>;
}

const VelocityStatCard: React.FC<VelocityStatCardProps> = ({
    velocity,
    windowDays,
    boundaryCounts,
    spineRowRef,
    spinesReady,
    className,
    sx,
}) => {
    // The arrows ALWAYS draw when the split is knowable (user, 2026-10-10: a week with
    // no level-ups still shows three arrows reading +0):
    //   - a full-length `boundaryCounts` is used as sent (the server sends [0,0,0] for
    //     an empty window);
    //   - when it is missing but the total is 0, three zeros is the only split that
    //     sums to 0, so drawing them is true rather than a guess. This covers a failed
    //     fetch, where `useVelocity` falls back to velocity 0.
    // Only a missing or wrong-length split with a NON-zero total drops the arrows,
    // because there is no honest way to label those counts.
    const arrowCounts =
        boundaryCounts?.length === CATEGORY_BOUNDARIES.length
            ? boundaryCounts
            : velocity === 0
              ? CATEGORY_BOUNDARIES.map(() => 0)
              : null;

    return (
        <StatCard
            className={className ? `velocity-stat-card ${className}` : "velocity-stat-card"}
            sx={sx}
            lead={
                arrowCounts && (
                    <VelocityArrows
                        boundaryCounts={arrowCounts}
                        spineRowRef={spineRowRef}
                        spinesReady={spinesReady}
                    />
                )
            }
            label={
                // Set as a HEADING, not an overline (user, 2026-10-10). StatCard wraps
                // `label` in the 10px uppercase `Label`, so this span overrides every
                // property that recipe sets. It is the app's heading voice
                // (`FONTS.sans`, semibold, sentence case, tight tracking) at
                // `SIZE.subtitle`. The WORD is centred over the figure, and the ⓘ
                // hangs off its right edge out of flow. Inline, the ⓘ would be centred
                // as part of the unit and push the word left of the figure's axis.
                <Box
                    component="span"
                    className="velocity-stat-card__label"
                    sx={{
                        position: "relative",
                        display: "inline-block",
                        fontFamily: FONTS.sans,
                        fontSize: SIZE.subtitle,
                        fontWeight: WEIGHT.semibold,
                        letterSpacing: "-0.015em",
                        lineHeight: LEADING.tight,
                        textTransform: "none",
                        color: COLORS.onSurface,
                    }}
                >
                    Velocity
                    <Box
                        component="span"
                        className="velocity-stat-card__info-anchor"
                        sx={{ position: "absolute", left: "100%", top: "50%", transform: "translateY(-50%)", ml: "6px", lineHeight: 0 }}
                    >
                        <InfoTip
                            className="velocity-stat-card__info"
                            ariaLabel="What counts as a level-up"
                            text={`A level-up is one card crossing into a higher mastery band — Unfamiliar → Target → Comfortable → Mastered. Counted over the last ${windowDays} days. Each arrow under your library counts the cards that crossed from one band into the next; a card that jumped two bands at once counts on both arrows.`}
                        />
                    </Box>
                </Box>
            }
            value={velocity}
        />
    );
};

export default VelocityStatCard;
