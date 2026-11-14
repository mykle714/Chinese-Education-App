import { useRef } from "react";
import { Box } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import DeckBuckets from "../DeckBuckets";
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
 * Titles stay outside this component: `LibraryShelfPanel` owns the optional header
 * slot (a friend's flag + language name) and corner figure. The arrows measure the
 * spines' horizontal centres (`VelocityArrows` → `useSpineCenters`), so they stay
 * aligned however the spines are sized or inset.
 *
 * ── LOADING ───────────────────────────────────────────────────────────────────
 * The two halves load independently on the Account page (`useCategoryCounts`,
 * `useVelocity`). Each half is held back until its data arrives (`null`), so a 0 never
 * flashes before the real number. Each slot reserves its height up front so nothing
 * below shifts when it fills. The arrows wait for BOTH halves: they need the spines to
 * measure.
 *
 * Host: `LibraryShelfPanel` (passes `gutter={false}` and `cardSx={{ mx: 0 }}` because
 * its root already carries the page margin; nothing is boxed since 2026-11-14). The
 * panel is in turn hosted by
 * `src/pages/account/AccountPane.tsx` (the signed-in user) and
 * `src/features/friends/FriendExpandedDetail.tsx` (a friend's expanded leaderboard row). The `gutter={true}`
 * default currently has no caller — it was the Account page's unboxed shelf until
 * 2026-11-13.
 *
 * Referenced by: docs/VELOCITY.md § 4; docs/FRIENDS_FEATURE.md § "Expand in place".
 */

/**
 * Reserved height of the shelf slot while the counts load, in px: the tallest spine
 * (140) plus the row's 9px top margin. The row has no board, and nothing closes it off
 * (the hairline dividers were dropped 2026-11-13).
 *
 * Applied ONLY while loading. Once the spines are in, the row sizes to its tallest
 * spine. A permanent minimum would leave a gap between the spines and the Velocity card
 * whenever no band is tall enough for the `tall` spine.
 */
const SHELF_RESERVE = 149;

/**
 * Reserved height of the velocity slot while velocity loads, in px. The 6px top margin,
 * the arrows (-6 + 44 + 6), the 18px "Velocity" heading and the 38px figure. (The
 * 12px gap above the slot is its margin, outside this reserve; the closing divider's
 * 12 + 1 left with the dividers on 2026-11-13.) The card has no padding or border (see
 * `FRAMELESS_CARD_SX`). This is approximate: the heading's height depends on the ⓘ
 * icon. It only has to be close enough that the goals below
 * barely move.
 */
const VELOCITY_RESERVE = 115;

/**
 * Space between the spines and the velocity block, in px. It used to be the gap above a
 * 1px hairline divider; the two dividers that framed the velocity block were dropped
 * 2026-11-13 (user), and this gap keeps the arrows from crowding the spines' feet.
 */
const SHELF_TO_VELOCITY_GAP = 12;

/**
 * Strips `SectionCard`'s shell (white fill, hairline, 14/16 padding) off the velocity
 * card, so the figure stands directly on the page under the shelf (user, 2026-10-10).
 * The arrows then read as hanging from the spines rather than sitting in a box.
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
    /** The window `velocity` counts over, in days — server-sent; shown in the ⓘ. */
    windowDays: number;
    boundaryCounts?: number[];
}

export interface LibraryShelfWithVelocityProps {
    /** Card count per band, keyed by band name. `null` while loading. */
    counts: Record<string, number> | null;
    /** The velocity figure and its boundary split. `null` while loading. */
    velocity: LibraryShelfVelocity | null;
    /** Keep the spine row's 22px page gutter (default); see `DeckBuckets`. */
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
            <Box
                className="library-shelf-velocity__velocity"
                sx={{ mt: `${SHELF_TO_VELOCITY_GAP}px`, minHeight: VELOCITY_RESERVE }}
            >
                {velocity && (
                    <VelocityStatCard
                        className="library-shelf-velocity__card"
                        velocity={velocity.velocity}
                        windowDays={velocity.windowDays}
                        boundaryCounts={velocity.boundaryCounts}
                        spineRowRef={shelfRef}
                        spinesReady={counts !== null}
                        // 6px top margin is the artboard's `.card` margin: the arrows
                        // sit close under the spines they hang from.
                        sx={[FRAMELESS_CARD_SX, ...(Array.isArray(cardSx) ? cardSx : [cardSx])]}
                    />
                )}
            </Box>
        </Box>
    );
};

export default LibraryShelfWithVelocity;
