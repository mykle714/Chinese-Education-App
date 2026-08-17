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
//   • SIDEWAYS pages (`hideHeader`) suppress the header and take the exit-aware
//     back handler through the render-prop form of `children`, so they can draw
//     the header inside their own rotated stage. Everything else — the slide,
//     the clone-on-exit, the no-footer rule — is unchanged. Speed Reading is the
//     only such page today; see docs/SPEED_READING_GAME.md § Sideways rendering.
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

/** Render-prop form of `children`, for pages that draw their own header. */
interface LeafPageChildApi {
    /**
     * The exit-aware back handler — runs the slide-down and THEN `onBack`.
     * A page that hides the header must wire this to its own back control, or
     * there is no way off the page.
     */
    onBack: () => void;
}

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
    /**
     * Suppress the built-in header. Only for pages that render their own — a
     * SIDEWAYS game, whose header has to sit inside the rotated stage rather
     * than upright at the top of a portrait screen.
     */
    hideHeader?: boolean;
    /**
     * Static content, or a function receiving the exit-aware back handler (the
     * form `hideHeader` pages need).
     */
    children: ReactNode | ((api: LeafPageChildApi) => ReactNode);
}

// NOT `React.FC<LeafPageProps>`: React.FC re-declares `children` as plain
// ReactNode, which silently discards the render-prop half of the union declared
// above — so `<LeafPage>{({ onBack }) => …}</LeafPage>` would not typecheck even
// though the implementation supports it. Annotating the props directly keeps the
// union intact.
const LeafPage = ({
    title,
    onBack,
    rightContent,
    surfaceColor,
    contentSx,
    contentClassName,
    className,
    hideHeader = false,
    children,
}: LeafPageProps) => {
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
            {!hideHeader && (
                <LeafPageHeader title={title} onBack={handleBack} rightContent={rightContent} />
            )}
            <Body className={contentClassName} sx={contentSx}>
                {typeof children === "function" ? children({ onBack: handleBack }) : children}
            </Body>
        </Surface>
    );
};

export default LeafPage;
