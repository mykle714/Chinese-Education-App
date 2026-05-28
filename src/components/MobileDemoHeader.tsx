import { type ReactNode } from "react";
import HomeIcon from "@mui/icons-material/Home";
import LanguageIcon from "@mui/icons-material/Language";
import SportsEsportsIcon from "@mui/icons-material/SportsEsports";
import AccountCircleIcon from "@mui/icons-material/AccountCircle";
import PageHeader from "./PageHeader";
import MobileNavDrawer from "./MobileNavDrawer";

// Hamburger-parent header used by every mobile-demo footer tab (Decks /
// Discover / Games / Account). Composes the base `PageHeader` and pins the
// `MobileNavDrawer` into the rightmost slot. Page-specific extras (e.g. the
// undo button on Discover) go in `extraActions`, which sits to the LEFT of
// the hamburger.
//
// When `activePage` is provided AND no back button is shown, the matching
// footer-tab icon is rendered in the left slot of the header as a
// page-identity badge (mirrors `MobileFooter`'s active tab).
//
// Specialty headers that don't want a hamburger (e.g. FlashcardsLearnHeader's
// fire icon + seconds counter, or the card-detail back-button view) should
// compose `PageHeader` directly instead of this component.

type ActivePage = "home" | "discover" | "games" | "account";

const ACTIVE_PAGE_ICON: Record<ActivePage, ReactNode> = {
    home: <HomeIcon sx={{ fontSize: 22, color: "#323232" }} />,
    discover: <LanguageIcon sx={{ fontSize: 22, color: "#323232" }} />,
    games: <SportsEsportsIcon sx={{ fontSize: 22, color: "#323232" }} />,
    account: <AccountCircleIcon sx={{ fontSize: 22, color: "#323232" }} />,
};

interface MobileDemoHeaderProps {
    title: string;
    showBack?: boolean;
    onBack?: () => void;
    extraActions?: ReactNode;
    activePage?: ActivePage;
}

const MobileDemoHeader: React.FC<MobileDemoHeaderProps> = ({
    title,
    showBack = false,
    onBack,
    extraActions,
    activePage,
}) => (
    <PageHeader
        title={title}
        showBack={showBack}
        onBack={onBack}
        leftIcon={activePage ? ACTIVE_PAGE_ICON[activePage] : undefined}
        rightContent={
            <>
                {extraActions}
                <MobileNavDrawer />
            </>
        }
    />
);

export default MobileDemoHeader;
