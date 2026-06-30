import { type ReactNode } from "react";
import { COLORS } from "../theme/colors";
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
    flashcards: <StyleIcon sx={{ fontSize: 22, color: COLORS.iconColor }} />,
    discover: <LanguageIcon sx={{ fontSize: 22, color: COLORS.iconColor }} />,
    home: <HomeIcon sx={{ fontSize: 22, color: COLORS.iconColor }} />,
    account: <AccountCircleIcon sx={{ fontSize: 22, color: COLORS.iconColor }} />,
};

interface MobileDemoHeaderProps {
    title: string;
    showBack?: boolean;
    onBack?: () => void;
    extraActions?: ReactNode;
    activePage?: FooterTab;
    // Back-chevron direction, forwarded to PageHeader. "down" (default) for leaf
    // drill-ins; "left" for node pages. See docs/LEAF_NODE_PAGES.md.
    arrowDirection?: "down" | "left";
}

const MobileDemoHeader: React.FC<MobileDemoHeaderProps> = ({
    title,
    showBack = false,
    onBack,
    extraActions,
    activePage,
    arrowDirection = "down",
}) => (
    <PageHeader
        title={title}
        showBack={showBack}
        onBack={onBack}
        arrowDirection={arrowDirection}
        leftIcon={activePage ? ACTIVE_PAGE_ICON[activePage] : undefined}
        rightContent={extraActions}
    />
);

export default MobileDemoHeader;
