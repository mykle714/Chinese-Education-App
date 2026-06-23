import React from "react";
import PageHeader from "./PageHeader";

// Leaf-page header — a thin specialization of the base `PageHeader` (see the
// composition hierarchy in docs/LEAF_NODE_PAGES.md). Forces the drill-in DOWN
// chevron and an always-present back button. Used by `LeafPage`.

interface LeafPageHeaderProps {
    title: string;
    onBack: () => void;
    rightContent?: React.ReactNode;
}

const LeafPageHeader: React.FC<LeafPageHeaderProps> = ({ title, onBack, rightContent }) => (
    <PageHeader title={title} showBack arrowDirection="down" onBack={onBack} rightContent={rightContent} />
);

export default LeafPageHeader;
