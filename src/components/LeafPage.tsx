import { type ReactNode } from "react";
import { Box } from "@mui/material";
import { styled } from "@mui/material/styles";
import type { SxProps, Theme } from "@mui/material/styles";
import LeafPageHeader from "./LeafPageHeader";
import { usePageSlide } from "../hooks/usePageSlide";
import { COLORS } from "../theme/colors";

// LEAF PAGE — terminal drill-in surface. See docs/LEAF_NODE_PAGES.md.
//
// Design rules encoded here (do not break without updating that doc):
//   • NO FOOTER. A leaf page never renders MobileFooter.
//   • The DOWN-arrow back button is the ONLY way to leave a leaf page — there is
//     no lateral nav. The wrapper fully owns the exit: tapping back navigates
//     (mounting the destination beneath) while a clone of this page slides DOWN
//     away on top, so the incoming page is already there beneath it.
//   • Motion: slides UP into place on enter, DOWN out on exit (vertical axis).
//
// The whole surface is absolutely positioned to fill MobileDemoFrame (which is
// position:relative + overflow:hidden), so the slide stays inside the phone card.

const Surface = styled(Box)(() => ({
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    backgroundColor: COLORS.background,
    overflow: "hidden",
}));

// Body fills the area beneath the header; per-page styling comes via contentSx.
const Body = styled(Box)(() => ({
    flex: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    width: "100%",
}));

interface LeafPageProps {
    title: string;
    // Where the back arrow goes. Invoked AFTER the slide-down completes.
    onBack: () => void;
    // Header right slot (e.g. a badge / toggle).
    rightContent?: ReactNode;
    surfaceColor?: string;
    contentSx?: SxProps<Theme>;
    contentClassName?: string;
    className?: string;
    children: ReactNode;
}

const LeafPage: React.FC<LeafPageProps> = ({
    title,
    onBack,
    rightContent,
    surfaceColor,
    contentSx,
    contentClassName,
    className,
    children,
}) => {
    const { surfaceRef, style, exit } = usePageSlide({ axis: "y" });

    // Back arrow is the only exit: navigate (destination mounts beneath) while a
    // clone of this page slides down away on top.
    const handleBack = () => exit(onBack);

    return (
        <Surface
            ref={surfaceRef}
            className={className ? `leaf-page ${className}` : "leaf-page"}
            style={style}
            sx={surfaceColor ? { backgroundColor: surfaceColor } : undefined}
        >
            <LeafPageHeader title={title} onBack={handleBack} rightContent={rightContent} />
            <Body className={contentClassName} sx={contentSx}>
                {children}
            </Body>
        </Surface>
    );
};

export default LeafPage;
