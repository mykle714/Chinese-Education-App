import { type ReactNode } from "react";
import { Box } from "@mui/material";
import { styled } from "@mui/material/styles";
import type { SxProps, Theme } from "@mui/material/styles";
import MobileTabScreen from "./MobileTabScreen";
import { type PageHeaderSize } from "./PageHeader";
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
    // Where the back arrow goes. Invoked AFTER the slide-right completes.
    onBack: () => void;
    headerExtraActions?: ReactNode;
    // Forwarded to MobileTabScreen -> PageHeader. Pass "dense" on a node page whose
    // header carries three or more right-slot actions (e.g. Card Detail).
    headerSize?: PageHeaderSize;
    surfaceColor?: string;
    contentSx?: SxProps<Theme>;
    contentClassName?: string;
    // Fixed, non-scrolling node pages set this false so content is clipped (not
    // scrolled) — the inner flex column shrinks to fit — and the edge fade is dropped.
    scrollable?: boolean;
    // Drop the soft fade at the TOP edge (keeps the bottom fade). See MobileTabScreen.
    topFade?: boolean;
    // This page owns a horizontal scroller (a pager, a sideways shelf) that must be
    // pannable by touch. Required, not cosmetic: the scroll area's own `touch-action`
    // is a ceiling on its descendants, so without this a sideways swipe inside the page
    // does nothing at all. See the note on MobileTabScreen's ScrollArea.
    horizontalPan?: boolean;
    /**
     * Frame-level furniture rendered as a SIBLING of the scroll area, not inside it:
     * a pull-up `SheetPanel`, a peek lip, a floating overlay.
     *
     * It has to be here rather than in `children` because such a panel is
     * `position: absolute; bottom: 0` and sizes itself from its offset parent's height
     * — put it in the scroll area and it lands inside the scrolled content, scrolls
     * away with it, and measures the content's height instead of the frame's. The
     * `Surface` below is the positioned box that fills the frame, so this slot is the
     * only place on a NodePage where that geometry is correct.
     *
     * The floating footer is rendered above both, at frame level by the app shell.
     */
    overlay?: ReactNode;
    children: ReactNode;
}

const NodePage: React.FC<NodePageProps> = ({
    title,
    onBack,
    headerExtraActions,
    headerSize,
    surfaceColor,
    contentSx,
    contentClassName,
    scrollable,
    topFade,
    horizontalPan,
    overlay,
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
                showBack
                arrowDirection="left"
                onBack={handleBack}
                headerExtraActions={headerExtraActions}
                headerSize={headerSize}
                surfaceColor={surfaceColor}
                contentSx={contentSx}
                contentClassName={contentClassName}
                scrollable={scrollable}
                topFade={topFade}
                horizontalPan={horizontalPan}
            >
                {children}
            </MobileTabScreen>
            {overlay}
        </Surface>
    );
};

export default NodePage;
