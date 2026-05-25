import { type ReactNode } from "react";
import PageHeader from "./PageHeader";
import MobileNavDrawer from "./MobileNavDrawer";

// Hamburger-parent header used by every mobile-demo footer tab (Decks /
// Discover / Games / Account). Composes the base `PageHeader` and pins the
// `MobileNavDrawer` into the rightmost slot. Page-specific extras (e.g. the
// undo button on Discover) go in `extraActions`, which sits to the LEFT of
// the hamburger.
//
// Specialty headers that don't want a hamburger (e.g. FlashcardsLearnHeader's
// fire icon + seconds counter, or the card-detail back-button view) should
// compose `PageHeader` directly instead of this component.

interface MobileDemoHeaderProps {
    title: string;
    showBack?: boolean;
    onBack?: () => void;
    extraActions?: ReactNode;
}

const MobileDemoHeader: React.FC<MobileDemoHeaderProps> = ({
    title,
    showBack = false,
    onBack,
    extraActions,
}) => (
    <PageHeader
        title={title}
        showBack={showBack}
        onBack={onBack}
        rightContent={
            <>
                {extraActions}
                <MobileNavDrawer />
            </>
        }
    />
);

export default MobileDemoHeader;
