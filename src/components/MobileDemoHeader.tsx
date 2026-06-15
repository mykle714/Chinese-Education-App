import { type ReactNode } from "react";
import HomeIcon from "@mui/icons-material/Home";
import StyleIcon from "@mui/icons-material/Style";
import LanguageIcon from "@mui/icons-material/Language";
import AccountCircleIcon from "@mui/icons-material/AccountCircle";
import PageHeader from "./PageHeader";
import type { FooterTab } from "./MobileFooter";

// Shared header for mobile-demo surfaces. Composes the base `PageHeader`.
//
// There is no longer a hamburger/nav drawer — global navigation lives entirely
// in the footer tabs (Flashcards / Discover / Home / Account) and the Home menu.
// This header therefore only owns: the title, an optional back button
// (`showBack`), an optional active-tab identity badge in the left slot
// (`activePage`, shown only when there's no back button), and page-specific
// `extraActions` rendered flush-right.

const ACTIVE_PAGE_ICON: Record<FooterTab, ReactNode> = {
    flashcards: <StyleIcon sx={{ fontSize: 22, color: "#323232" }} />,
    discover: <LanguageIcon sx={{ fontSize: 22, color: "#323232" }} />,
    home: <HomeIcon sx={{ fontSize: 22, color: "#323232" }} />,
    account: <AccountCircleIcon sx={{ fontSize: 22, color: "#323232" }} />,
};

interface MobileDemoHeaderProps {
    title: string;
    showBack?: boolean;
    onBack?: () => void;
    extraActions?: ReactNode;
    activePage?: FooterTab;
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
        rightContent={extraActions}
    />
);

export default MobileDemoHeader;
