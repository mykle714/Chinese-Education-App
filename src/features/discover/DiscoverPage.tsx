import MobileTabScreen from "../../components/MobileTabScreen";
import { Bento, BentoTile } from "../../components/bento";
import { FooterSpacer, ScrollPastSpacer } from "../../components/MobileFooter";
import TipBox from "../../components/TipBox";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useDiscoverNavigation } from "../../hooks/useDiscoverNavigation";

// Discover hub (`/discover`) — the landing surface for the footer's Discover tab.
// A BENTO mosaic of the discover activities (docs/SHELF_REDESIGN.md § A4, entry 3),
// replacing the vertical HubMenu of equal-weight rows.
//
// Sort Cards is the HERO: it is the activity the other two exist to support, and with
// only three destinations a flat list of three identical rows made the page look like
// it was still being built. Phone-frame sizing comes from MobileDemoFrame; the
// scroll-away header + floating footer come from MobileTabScreen.
//
// Activities (in order): Sort Cards (drag-to-sort, keyed by the user's language),
// Quick Mark (bulk-triage grid, docs/QUICK_MARK.md), Skipped Cards.
//
// ⚠️ NOT BUILT FROM ARTBOARD 3 — two pieces of it need data this client cannot get:
//
//   1. The tile PINS ("184 waiting" on Sort Cards, "31" on Skipped Cards). There is no
//      unsorted-card or skipped-card count on the client: `useCategoryCounts` counts
//      the user's LIBRARY by band, which is a different number, and nothing exposes
//      "cards awaiting sort". Showing a wrong count is worse than showing none.
//   2. The "Waiting to be sorted" SHELF beneath the grid — four spines whose heights
//      encode the unsorted queue by band. Same missing data, times four.
//
// Both want one endpoint returning the unsorted queue counted by band. Until it
// exists this page is the bento alone, which is complete and correct on its own.

const DiscoverPage: React.FC = () => {
    usePageTitle("Discover");
    // Tiles link to the language-keyed sort / quick-mark / skipped pages.
    const { sortPath, quickMarkPath, skippedPath } = useDiscoverNavigation();

    return (
        <MobileTabScreen title="Discover" contentClassName="discover-page__content">
            <Bento className="discover-page__bento">
                <BentoTile
                    to={sortPath}
                    className="discover-page__tile discover-page__tile--sort"
                    title="Sort Cards"
                    subtitle="Sort new cards into your decks"
                    hue="grn"
                    icon="style"
                    variant="hero"
                />
                <BentoTile
                    to={quickMarkPath}
                    className="discover-page__tile discover-page__tile--quick-mark"
                    title="Quick Mark"
                    subtitle="Bulk-triage by level"
                    hue="pur"
                    icon="playlist_add_check"
                />
                <BentoTile
                    to={skippedPath}
                    className="discover-page__tile discover-page__tile--skipped"
                    title="Skipped Cards"
                    subtitle="Revisit skipped words"
                    hue="org"
                    icon="skip_next"
                />
            </Bento>
            <TipBox className="discover-page__tip-box" />
            <FooterSpacer />
            <ScrollPastSpacer />
        </MobileTabScreen>
    );
};

export default DiscoverPage;
