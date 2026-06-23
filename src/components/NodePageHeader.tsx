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
}

const NodePageHeader: React.FC<NodePageHeaderProps> = ({ title, onBack, rightContent }) => (
    <PageHeader title={title} showBack arrowDirection="left" onBack={onBack} rightContent={rightContent} />
);

export default NodePageHeader;
