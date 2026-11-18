import { Box, Button } from "@mui/material";
import { HeaderIconButton } from "../../components/PageHeader";
import { COLORS } from "../../theme/colors";
import ReaderSortMenu from "./ReaderSortMenu";
import { readerPillButtonSx } from "./readerStyles";
import type { Tier2Look } from "../../timeOfDay/tier2Look";
import type { ReaderListView } from "./useReaderListView";
import type { ReaderSortKey } from "./readerListOrder";

/**
 * The `/reader` list TOOLBAR — one row under the Documents / Journal selector
 * (ReaderCollectionTiles), on the page's 16px gutters so its ends line up with the tiles:
 *
 *   [ New document ]                                [ sort ] [ grid/list ]
 *
 *   - LEFT — New document, a blue filled pill (readerPillButtonSx, `COLORS.bluM` — the
 *     ramp's blue MID, the edit toolbar's Save fill). Text only: an `edit_note` glyph made
 *     it too long (owner, 2026-11-17). Reads "New entry" while the Journal
 *     tile is selected, when it opens a journal draft (ReaderPage → handleCreateNew).
 *   - RIGHT — the sort menu (ReaderSortMenu) and the grid ⇄ list toggle, both the
 *     `outlined` HeaderIconButton skin (36px box, --line2 ring): a button off the header
 *     needs its own edge (CLAUDE.md § Buttons & cards). The toggle's glyph names the view
 *     a tap switches TO.
 *
 * Colours: the pill is a pastel and stays one at night; the two icon buttons take the
 * page's time-of-day `look` (ink2 glyph, `outline` ring) so they read on the night slate.
 *
 * Every control is 36px tall (TOOLBAR_CONTROL_PX) so the pill and the icon boxes share
 * one baseline. (History: until 2026-11-17 sort and view sat in the page header and New
 * document was a Bento tile.)
 *
 * Docs: docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "List toolbar".
 * Layer: feature view (src/features/reader). Rendered by: ReaderPage.tsx.
 */

/** The outlined HeaderIconButton's box (PageHeader → HEADER_OUTLINED_BTN_PX); the pill matches it. */
const TOOLBAR_CONTROL_PX = 36;

interface ReaderListToolbarProps {
    /** The page's time-of-day look (ReaderPage → useTier2Look). */
    look: Tier2Look;
    /** True while the Journal tile is selected: the pill reads "New entry". */
    journalSelected: boolean;
    onCreateNew: () => void;
    sortKey: ReaderSortKey;
    onSortChange: (key: ReaderSortKey) => void;
    view: ReaderListView;
    onViewChange: (view: ReaderListView) => void;
}

function ReaderListToolbar({
    look,
    journalSelected,
    onCreateNew,
    sortKey,
    onSortChange,
    view,
    onViewChange,
}: ReaderListToolbarProps) {
    return (
        <Box
            className="reader-page__toolbar"
            sx={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "12px 16px 0",
            }}
        >
            <Button
                className="reader-page__toolbar-new-document"
                onClick={onCreateNew}
                sx={{
                    ...readerPillButtonSx(look, COLORS.bluM),
                    height: TOOLBAR_CONTROL_PX,
                    px: 2,
                }}
            >
                {journalSelected ? "New entry" : "New document"}
            </Button>

            {/* Pushes the two icon buttons to the right edge. */}
            <Box className="reader-page__toolbar-spacer" sx={{ flex: 1 }} />

            <ReaderSortMenu look={look} sortKey={sortKey} onChange={onSortChange} />
            <HeaderIconButton
                className="reader-page__view-toggle"
                variant="outlined"
                color={look.ink2}
                outlineColor={look.outline}
                icon={view === "grid" ? "view_list" : "grid_view"}
                label={view === "grid" ? "Show as list" : "Show as grid"}
                onClick={() => onViewChange(view === "grid" ? "list" : "grid")}
            />
        </Box>
    );
}

export default ReaderListToolbar;
