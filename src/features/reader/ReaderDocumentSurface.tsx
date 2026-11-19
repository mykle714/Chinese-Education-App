import { type ReactNode } from "react";
import { Box } from "@mui/material";
import { styled } from "@mui/material/styles";
import NodePageHeader from "../../components/NodePageHeader";
import type { PageHeaderEditableTitle } from "../../components/PageHeader";
import { usePageSlide } from "../../hooks/usePageSlide";
import type { Tier2Look } from "../../timeOfDay/tier2Look";

// READER DOCUMENT SURFACE — the open-document view of the Reader, routed at
// `/reader/:id` (ReaderDocumentPage.tsx) and presented as a footerless NODE-STYLE
// drill-in from the `/reader` list (docs/LEAF_NODE_PAGES.md § "Reader: leaf list +
// node-style document surface").
//
// Why this is NOT the shared `NodePage`: NodePage is built on MobileTabScreen,
// which reserves the footer slab's clearance and provides a scroll-away header —
// neither fits here. `/reader/:id` shows no nav footer (its routeMeta row has no
// `footerTab`), and the reader is a fixed, non-scrolling layout. So this composes the same primitives directly, per the
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
//
// TIME OF DAY: the surface is painted with the page's Tier 2 look (`look.ground`, from
// ReaderDocumentPage → useTier2Look — docs/SHELF_REDESIGN.md § 7b): the sky tint by day,
// slate at night; the header's title and back arrow take `look.ink`.

// The ground colour is set inline (it follows the clock); everything else is static.
const Surface = styled(Box)(() => ({
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
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
    /** The page's time-of-day look: the ground and the header ink. */
    look: Tier2Look;
    title: string;
    // Invoked by the back arrow. Called IMMEDIATELY when the exit starts (the
    // list beneath must be current while the clone slides away), not after.
    onBack: () => void;
    // Header right slot: the Edit/Delete icon buttons
    // (docHeaderRightContent in ReaderDocumentPage).
    rightContent?: ReactNode;
    // Set while the document editor is open: the header title becomes a text field
    // (draftTitle in ReaderDocumentPage). Undefined = the static `title`.
    editableTitle?: PageHeaderEditableTitle;
    children: ReactNode;
}

const ReaderDocumentSurface: React.FC<ReaderDocumentSurfaceProps> = ({
    look,
    title,
    onBack,
    rightContent,
    editableTitle,
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
            style={{ ...style, backgroundColor: look.ground }}
        >
            <NodePageHeader title={title} onBack={handleBack} rightContent={rightContent} titleColor={look.ink} editableTitle={editableTitle} />
            <Body className="reader-document-surface__body">{children}</Body>
        </Surface>
    );
};

export default ReaderDocumentSurface;
