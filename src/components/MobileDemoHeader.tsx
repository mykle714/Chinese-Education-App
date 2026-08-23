import { type ReactNode } from "react";
import PageHeader, { type PageHeaderSize } from "./PageHeader";

// Shared header for mobile-demo surfaces. Composes the base `PageHeader`.
//
// There is no longer a hamburger/nav drawer — global navigation lives entirely
// in the footer tabs (Flashcards / Discover / Home / Account) and the Home menu.
// This header therefore only owns: the title, an optional back button
// (`showBack`), and page-specific `extraActions` rendered flush-right.
//
// ⚠️ THE LEFT TAB BADGE IS GONE (shelf redesign A2b). Hub headers used to draw the
// active footer tab's icon to the left of the title as a page-identity badge; no
// artboard has one — every `.hd` is title-then-right-slot, on the bare paper ground.
// It was also redundant with the footer, which already marks the active tab, and
// with the title, which already names the page. Its four `@mui/icons-material`
// imports went with it, continuing the icon retirement started in A2a (decision D5).

interface MobileDemoHeaderProps {
    title: string;
    showBack?: boolean;
    onBack?: () => void;
    extraActions?: ReactNode;
    // Back-chevron direction, forwarded to PageHeader. "down" (default) for leaf
    // drill-ins; "left" for node pages. Also selects the title size, since
    // PageHeader derives `size` from it. See docs/LEAF_NODE_PAGES.md.
    arrowDirection?: "down" | "left";
    // Title scale override. Only "dense" is ever worth passing — see PageHeader.
    size?: PageHeaderSize;
}

const MobileDemoHeader: React.FC<MobileDemoHeaderProps> = ({
    title,
    showBack = false,
    onBack,
    extraActions,
    arrowDirection = "down",
    size,
}) => (
    <PageHeader
        title={title}
        showBack={showBack}
        onBack={onBack}
        arrowDirection={arrowDirection}
        size={size}
        rightContent={extraActions}
    />
);

export default MobileDemoHeader;
