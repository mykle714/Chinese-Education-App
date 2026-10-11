import { useRef } from "react";
import { Box } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import DeckBuckets from "../DeckBuckets";
import { COLORS } from "../../theme/colors";
import VelocityStatCard from "./VelocityStatCard";

/**
 * `LibraryShelfWithVelocity` — the four utcm band spines (`DeckBuckets`) with the
 * Velocity card under them, its boundary arrows hanging from the spines.
 * Shelf System v2, artboard 5.
 *
 * ── WHY ONE COMPONENT ─────────────────────────────────────────────────────────
 * Each velocity arrow leaves one band's spine and climbs into the next one's
 * (`VelocityArrows`), so the card is only correct relative to the shelf above it. This
 * component owns both halves and the ref between them. A host cannot put the card
 * under some other row, or render it without its shelf, and the alignment cannot break
 * in one host while working in the other.
 *
 * Section headers ("Your library") stay with the host. Each host already has its own
 * header style, and the profile panel's title is not a shelf header.
 *
 * ── LOADING ───────────────────────────────────────────────────────────────────
 * The two halves load independently on the Account page (`useCategoryCounts`,
 * `useVelocity`). Each half is held back until its data arrives (`null`), so a 0 never
 * flashes before the real number. Each slot reserves its height up front so nothing
 * below shifts when it fills. The arrows wait for BOTH halves: they need the spines to
 * measure.
 *
 * Hosts: `src/pages/AccountSheet.tsx` (the signed-in user, with the shelf's page
 * gutter); `src/features/profile/ProfileStatsCard.tsx` (one per language, inside a
 * panel that already pads itself, so `gutter={false}` and `cardSx={{ mx: 0 }}`).
 *
 * Referenced by: docs/VELOCITY.md § 4; docs/USER_PROFILE_PAGE.md.
 */

/**
 * Reserved height of the shelf slot while the counts load, in px: the tallest spine
 * (140) plus the row's 9px top margin. The row has no board; the divider under it is
 * outside this slot.
 *
 * Applied ONLY while loading. Once the spines are in, the row sizes to its tallest
 * spine. A permanent minimum would leave a gap between the spines and the Velocity card
 * whenever no band is tall enough for the `tall` spine.
 */
const SHELF_RESERVE = 149;

/**
 * Reserved height of the velocity slot while velocity loads, in px. The 6px top margin,
 * the arrows (-6 + 44 + 6), the 18px "Velocity" heading, the 38px figure, and the
 * closing divider (12 + 1). The card has no padding or border (see
 * `FRAMELESS_CARD_SX`). This is approximate: the heading's height depends on the ⓘ
 * icon. It only has to be close enough that the goals below
 * barely move.
 */
const VELOCITY_RESERVE = 128;

/** Space between a divider and the content it closes off, in px. */
const DIVIDER_GAP = 12;

/**
 * The app's normal section divider: a 1px `--line` hairline (`COLORS.rowBorder`, the
 * same rule `SectionRule` draws), with no shadow and no overhang. Two of them frame the
 * Velocity block, one under the spines and one under the figure. They replaced the
 * wooden shelf boards (user, 2026-10-10: too heavy around the velocity figure). Inset by
 * the shelf's 22px gutter, or by nothing when the host already pads itself.
 */
const SectionDivider: React.FC<{ gutter: boolean; className: string }> = ({ gutter, className }) => (
    <Box
        className={className}
        sx={{
            mt: `${DIVIDER_GAP}px`,
            mx: gutter ? "22px" : 0,
            height: "1px",
            backgroundColor: COLORS.rowBorder,
        }}
    />
);

/**
 * Strips `SectionCard`'s shell (white fill, hairline, 14/16 padding) off the velocity
 * card, so the figure stands directly on the page under the shelf (user, 2026-10-10).
 * The arrows then read as hanging from the divider rather than sitting in a box.
 * `StatCard` is still used for its overline and figure typography, so the 38px figure
 * keeps one definition. The horizontal margin stays, so a host's `cardSx` can still
 * zero it.
 */
const FRAMELESS_CARD_SX = {
    mt: "6px",
    padding: 0,
    border: "none",
    backgroundColor: "transparent",
    borderRadius: 0,
    textAlign: "center",
} as const;

export interface LibraryShelfVelocity {
    velocity: number;
    windowDays: number;
    boundaryCounts?: number[];
}

export interface LibraryShelfWithVelocityProps {
    /** Card count per band, keyed by band name. `null` while loading. */
    counts: Record<string, number> | null;
    /** The velocity figure and its boundary split. `null` while loading. */
    velocity: LibraryShelfVelocity | null;
    /** Keep the shelf's 22px page gutter (default); see `DeckBuckets`. */
    gutter?: boolean;
    /** Placement overrides for the velocity card's shell. */
    cardSx?: SxProps<Theme>;
    className?: string;
}

const LibraryShelfWithVelocity: React.FC<LibraryShelfWithVelocityProps> = ({
    counts,
    velocity,
    gutter = true,
    cardSx,
    className,
}) => {
    // The element the arrows look inside for the spines. It wraps `DeckBuckets`
    // instead of being passed into it, so DeckBuckets stays a plain display row.
    const shelfRef = useRef<HTMLDivElement | null>(null);

    return (
        <Box className={className ? `library-shelf-velocity ${className}` : "library-shelf-velocity"}>
            <Box className="library-shelf-velocity__shelf" ref={shelfRef} sx={{ minHeight: counts ? undefined : SHELF_RESERVE }}>
                {counts && <DeckBuckets counts={counts} gutter={gutter} />}
            </Box>
            <SectionDivider gutter={gutter} className="library-shelf-velocity__divider library-shelf-velocity__divider--top" />
            <Box className="library-shelf-velocity__velocity" sx={{ minHeight: VELOCITY_RESERVE }}>
                {velocity && (
                    <>
                        <VelocityStatCard
                            className="library-shelf-velocity__card"
                            velocity={velocity.velocity}
                            windowDays={velocity.windowDays}
                            boundaryCounts={velocity.boundaryCounts}
                            spineRowRef={shelfRef}
                            spinesReady={counts !== null}
                            // 6px top margin is the artboard's `.card` margin: the arrows
                            // sit close under the divider they hang from.
                            sx={[FRAMELESS_CARD_SX, ...(Array.isArray(cardSx) ? cardSx : [cardSx])]}
                        />
                        <SectionDivider
                            gutter={gutter}
                            className="library-shelf-velocity__divider library-shelf-velocity__divider--bottom"
                        />
                    </>
                )}
            </Box>
        </Box>
    );
};

export default LibraryShelfWithVelocity;
