import StyleIcon from "@mui/icons-material/Style";
import PlaylistAddCheckIcon from "@mui/icons-material/PlaylistAddCheck";
import SkipNextIcon from "@mui/icons-material/SkipNext";
import MobileTabScreen from "../components/MobileTabScreen";
import { HubMenu, HubMenuRow } from "../components/HubMenu";
import { FooterSpacer } from "../components/MobileFooter";
import TipBox from "../components/TipBox";
import { usePageTitle } from "../hooks/usePageTitle";
import { useDiscoverNavigation } from "../hooks/useDiscoverNavigation";
import { COLORS } from "../theme/colors";

// Discover hub (`/discover`) — the landing surface for the footer's Discover tab.
// Mirrors the Games hub: a vertical HubMenu of discover activities (tip-box
// header + spacer footer, see docs/HUB_MENU_SYSTEM.md). Today the only
// activity is Sort Cards (the drag-to-sort page, keyed by the user's language).
// Phone-frame sizing comes from MobileDemoFrame; the scroll-away header + floating
// footer come from MobileTabScreen; the row list comes from the shared HubMenu.
// Activities (in order): Sort Cards (drag-to-sort), Quick Mark (bulk-triage grid,
// docs/QUICK_MARK.md), Skipped Cards (revisit skipped words).

const DiscoverPage: React.FC = () => {
    usePageTitle("Discover");
    // Rows link to the language-keyed sort + skipped pages.
    const { sortPath, quickMarkPath, skippedPath } = useDiscoverNavigation();

    return (
        <MobileTabScreen title="Discover" activePage="discover" contentClassName="discover-page__content">
            <HubMenu
                className="discover-page__menu"
                header={<TipBox className="discover-page__tip-box" />}
                footer={<FooterSpacer />}
            >
                <HubMenuRow
                    to={sortPath}
                    className="discover-page__menu-item discover-page__menu-item--sort"
                    title="Sort Cards"
                    subtitle="Sort new cards into your decks"
                    icon={<StyleIcon sx={{ color: COLORS.textSecondary }} />}
                    bgColor={COLORS.greenAccent}
                />
                <HubMenuRow
                    to={quickMarkPath}
                    className="discover-page__menu-item discover-page__menu-item--quick-mark"
                    title="Quick Mark"
                    subtitle="Bulk-triage new cards by level"
                    icon={<PlaylistAddCheckIcon sx={{ color: COLORS.textSecondary }} />}
                    bgColor={COLORS.purpleAccent}
                />
                <HubMenuRow
                    to={skippedPath}
                    className="discover-page__menu-item discover-page__menu-item--skipped"
                    title="Skipped Cards"
                    subtitle="Revisit cards you skipped"
                    icon={<SkipNextIcon sx={{ color: COLORS.textSecondary }} />}
                    bgColor={COLORS.yellowAccent}
                />
            </HubMenu>
        </MobileTabScreen>
    );
};

export default DiscoverPage;
