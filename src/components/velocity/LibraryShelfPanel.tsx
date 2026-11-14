import { Box } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import LibraryShelfWithVelocity, { type LibraryShelfVelocity } from "./LibraryShelfWithVelocity";

/**
 * `LibraryShelfPanel` — the progress panel: an optional title block and corner figure,
 * the four utcm band spines, and the Velocity card directly under them
 * (`LibraryShelfWithVelocity`). NOTHING is boxed: the velocity came out of the old
 * `SectionCard` box first, and the spines followed on 2026-11-14 (user), so the whole
 * panel now stands directly on the page / row background.
 *
 * ── ONE PANEL, TWO HOSTS ──────────────────────────────────────────────────────
 * A friend's expanded leaderboard row and the signed-in user's own Account tab both show
 * "how is this learner's library doing", and they present it the same way so the two
 * read as the same thing:
 *   * `src/features/friends/FriendExpandedDetail.tsx` — one panel, for the friend's active
 *     language, filling `header` (flag over language name) and `corner` (the banked-
 *     minutes flame), because the numbers are in THEIR language and the panel must say so.
 *   * `src/pages/account/AccountPane.tsx` — one panel, NO header and NO corner: the sheet
 *     is already about one language (the selected one) and the minute bank has its own
 *     `BankBanner` directly above, so both slots would only repeat it.
 *
 * ── WHY THE SHELF RUNS GUTTERLESS IN HERE ─────────────────────────────────────
 * The panel root carries the page margin (`PANEL_MARGIN`, or the host's `sx`), so the
 * shelf's own 22px page gutter would inset the spines a second time and push them out of
 * the velocity card's column. `gutter={false}` drops it (the spines size to fit —
 * `fittedSpineWidth` in components/DeckBuckets; the arrows follow them, since they
 * measure the spines rather than assume an inset). `cardSx={{ mx: 0 }}` cancels the
 * velocity card's own page margin for the same reason.
 *
 * ── THE CORNER IS ABSOLUTE ────────────────────────────────────────────────────
 * The header is centred. A corner figure sharing its row would push it off-centre by half
 * the figure's width — by a different amount per panel when the figures differ — so the
 * corner is taken out of flow and pinned top-right of the panel root instead (the root is
 * `position: relative` for it).
 *
 * LAYER: shared presentational component (src/components). No data fetching; hosts pass
 * the counts/velocity they loaded (`null` while loading — see LibraryShelfWithVelocity's
 * LOADING note).
 *
 * Referenced by: docs/VELOCITY.md § 4; docs/USER_PROFILE_PAGE.md; docs/FRIENDS_FEATURE.md.
 */

export interface LibraryShelfPanelProps {
    /** Card count per band, keyed by band name. `null` while loading. */
    counts: Record<string, number> | null;
    /** The velocity figure and its boundary split. `null` while loading. */
    velocity: LibraryShelfVelocity | null;
    /** Optional centred title block above the shelf (a friend's flag + language name). */
    header?: React.ReactNode;
    /** Optional figure pinned to the panel's top-right corner (a friend's minutes flame). */
    corner?: React.ReactNode;
    /** Overrides for the panel root — e.g. `{ m: 0 }` when the host column already insets it. */
    sx?: SxProps<Theme>;
    className?: string;
}

/**
 * The page margin (`14px 18px 0`, the same as `SectionCard`'s, so the panel lines up with
 * the cards around it — e.g. `BankBanner` above it on the Account tab). A host's `sx`
 * (e.g. `{ m: 0 }`) overrides it.
 */
const PANEL_MARGIN = "14px 18px 0";

/** Space between the header block and the spines, in px (was the old box's 10px flex gap). */
const HEADER_TO_SHELF_GAP = 10;

const LibraryShelfPanel: React.FC<LibraryShelfPanelProps> = ({ counts, velocity, header, corner, sx, className }) => (
    <Box
        className={className ? `library-shelf-panel ${className}` : "library-shelf-panel"}
        sx={[{ margin: PANEL_MARGIN, position: "relative" }, ...(Array.isArray(sx) ? sx : [sx])]}
    >
        {corner && (
            <Box className="library-shelf-panel__corner" sx={{ position: "absolute", top: 0, right: 0 }}>
                {corner}
            </Box>
        )}
        {header && (
            <Box
                className="library-shelf-panel__header"
                sx={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 0.25,
                    mb: `${HEADER_TO_SHELF_GAP}px`,
                }}
            >
                {header}
            </Box>
        )}
        <LibraryShelfWithVelocity
            className="library-shelf-panel__shelf"
            counts={counts}
            velocity={velocity}
            gutter={false}
            cardSx={{ mx: 0 }}
        />
    </Box>
);

export default LibraryShelfPanel;
