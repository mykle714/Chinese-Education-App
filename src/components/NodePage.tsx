import { type ReactNode } from "react";
import { Box } from "@mui/material";
import { styled } from "@mui/material/styles";
import type { SxProps, Theme } from "@mui/material/styles";
import MobileTabScreen from "./MobileTabScreen";
import type { FooterTab } from "./MobileFooter";
import { usePageSlide } from "../hooks/usePageSlide";

// NODE PAGE — a hub that is still part of lateral navigation. See
// docs/LEAF_NODE_PAGES.md.
//
// Design rules encoded here:
//   • KEEPS THE FOOTER. Built on MobileTabScreen, so it retains the scroll-away
//     header, floating-footer pill, and edge fade. Lateral nav stays available.
//   • LEFT arrow (arrowDirection="left").
//   • Motion: slides IN FROM THE RIGHT on enter (translateX 100% → 0). On exit it
//     slides OUT TO THE RIGHT *only* when the back arrow is used — footer-tab taps
//     navigate normally with no slide (the "iff the arrow" rule). The wrapper only
//     hooks the back arrow, so footer navigation is untouched by design.
//
// The animated container fills MobileDemoFrame (position:relative, overflow:hidden)
// so the horizontal slide stays inside the phone card.

const Surface = styled(Box)(() => ({
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
}));

interface NodePageProps {
    title: string;
    activePage: FooterTab;
    // Where the back arrow goes. Invoked AFTER the slide-right completes.
    onBack: () => void;
    headerExtraActions?: ReactNode;
    surfaceColor?: string;
    contentSx?: SxProps<Theme>;
    contentClassName?: string;
    // Fixed, non-scrolling node pages set this false so content is clipped (not
    // scrolled) — the inner flex column shrinks to fit — and the edge fade is dropped.
    scrollable?: boolean;
    // Drop the soft fade at the TOP edge (keeps the bottom fade). See MobileTabScreen.
    topFade?: boolean;
    children: ReactNode;
}

const NodePage: React.FC<NodePageProps> = ({
    title,
    activePage,
    onBack,
    headerExtraActions,
    surfaceColor,
    contentSx,
    contentClassName,
    scrollable,
    topFade,
    children,
}) => {
    const { surfaceRef, style, exit } = usePageSlide({ axis: "x" });

    // Only the back arrow animates: navigate (destination mounts beneath) while a
    // clone of this page slides out to the right on top. Footer-tab taps inside
    // MobileTabScreen navigate normally (no slide).
    const handleBack = () => exit(onBack);

    return (
        <Surface ref={surfaceRef} className="node-page" style={style}>
            <MobileTabScreen
                title={title}
                activePage={activePage}
                showBack
                arrowDirection="left"
                onBack={handleBack}
                headerExtraActions={headerExtraActions}
                surfaceColor={surfaceColor}
                contentSx={contentSx}
                contentClassName={contentClassName}
                scrollable={scrollable}
                topFade={topFade}
            >
                {children}
            </MobileTabScreen>
        </Surface>
    );
};

export default NodePage;
