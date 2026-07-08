import { type ReactNode } from "react";
import { Box } from "@mui/material";
import { styled } from "@mui/material/styles";
import NodePageHeader from "../../components/NodePageHeader";
import { usePageSlide } from "../../hooks/usePageSlide";
import { COLORS } from "../../theme/colors";

// READER DOCUMENT SURFACE — the open-document view of the Reader, routed at
// `/reader/:id` (ReaderDocumentPage.tsx) and presented as a footerless NODE-STYLE
// drill-in from the `/reader` list (docs/LEAF_NODE_PAGES.md § "Reader: leaf list +
// node-style document surface").
//
// Why this is NOT the shared `NodePage`: NodePage is built on MobileTabScreen,
// which reserves FLOATING_FOOTER_CLEARANCE for the footer pill and provides a
// scroll-away header — neither fits here. `/reader` shows no nav footer (it is
// not registered in FooterPresenter's route maps), and the reader is a fixed,
// non-scrolling layout. So this composes the same primitives directly, per the
// "compose, don't fork" header hierarchy: `NodePageHeader` (LEFT arrow) +
// `usePageSlide({ axis: "x" })` (node motion: in from the right, out to the
// right on back).
//
// Being a real route, it behaves like any other node page: `useSlideNavigate`
// drives the forward transition from the list (registered in `NODE_PREFIXES`,
// src/utils/pageTransition.ts), and the back arrow's `usePageSlide.exit()` navigates
// to `/reader` while a clone of this surface slides out to the right — the route
// change lets `Layout`'s pathname effect clear the skip-enter latch normally, same
// as every other routed leaf/node page.

const Surface = styled(Box)(() => ({
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    backgroundColor: COLORS.background,
    // Painted above the list LeafPage purely by DOM order (it renders after the
    // list surface); usePageSlide's exit clone sits above both at zIndex 50.
    overflow: "hidden",
}));

// Body fills the area beneath the header; per-view styling comes from children.
const Body = styled(Box)(() => ({
    flex: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    width: "100%",
}));

interface ReaderDocumentSurfaceProps {
    title: string;
    // Invoked by the back arrow. Called IMMEDIATELY when the exit starts (the
    // list beneath must be current while the clone slides away), not after.
    onBack: () => void;
    // Header right slot: Edit/Delete icon buttons + the validator download
    // button + streak fire badge (docHeaderRightContent in ReaderPage).
    rightContent?: ReactNode;
    children: ReactNode;
}

const ReaderDocumentSurface: React.FC<ReaderDocumentSurfaceProps> = ({
    title,
    onBack,
    rightContent,
    children,
}) => {
    const { surfaceRef, style, exit } = usePageSlide({ axis: "x" });

    // Node-style back: reveal the (already mounted) list beneath while a clone
    // of this surface slides out to the right.
    const handleBack = () => exit(onBack);

    return (
        <Surface
            ref={surfaceRef}
            className="reader-document-surface"
            style={style}
        >
            <NodePageHeader title={title} onBack={handleBack} rightContent={rightContent} />
            <Body className="reader-document-surface__body">{children}</Body>
        </Surface>
    );
};

export default ReaderDocumentSurface;
