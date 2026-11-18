import React from "react";
import PageHeader from "./PageHeader";

// Node-page header — a thin specialization of the base `PageHeader` (see the
// composition hierarchy in docs/LEAF_NODE_PAGES.md). Forces the lateral LEFT
// arrow and an always-present back button. NodePages keep their footer, so this
// header is normally rendered through `MobileTabScreen` (which threads
// `arrowDirection="left"`); this standalone component exists for parity with
// `LeafPageHeader` and direct use.

interface NodePageHeaderProps {
    title: string;
    onBack: () => void;
    rightContent?: React.ReactNode;
    /**
     * Title and back-arrow ink, forwarded to PageHeader's `titleColor` — for a header over
     * a ground the default ink does not read on (the Reader document's night slate,
     * features/reader/ReaderDocumentSurface.tsx). Undefined = PageHeader's default ink.
     */
    titleColor?: string;
}

const NodePageHeader: React.FC<NodePageHeaderProps> = ({ title, onBack, rightContent, titleColor }) => (
    <PageHeader title={title} showBack arrowDirection="left" onBack={onBack} rightContent={rightContent} titleColor={titleColor} />
);

export default NodePageHeader;
