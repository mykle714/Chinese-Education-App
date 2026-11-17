import React from "react";
import { Box, useTheme } from "@mui/material";
import SenseList from "../../../components/SenseList";
import EipSectionLabel from "../EipSectionLabel";
import type { VocabEntry } from "../types";

/**
 * EipSenseList — the eip's "Other Translations" section at the top of the Definition tab,
 * on EVERY eip host (owner's call 2026-11-05). Mounted by InfoCardTabContent (tab 0).
 *
 * Since 2026-11-17 this is only the eip's SECTION around the shared list: the title in the
 * eip's section-label style (`EipSectionLabel`, the Synonyms + Related labels' treatment;
 * owner's call 2026-11-07) and the rule that separates it from the definition paragraph
 * below. The list itself — rows, numbering, two columns, the trailing star, inline
 * alternate pinyin, the tap-for-commonality popup — is `SenseList`
 * (src/components/SenseList.tsx), shared with the Reader's dictionary keycap.
 *
 * Since that move a SINGLE-SENSE word shows its gloss list here too (it used to render
 * nothing; see SenseList's "Which rows"). `SenseList` calls `wrap` only when it has rows,
 * so a word with no glosses still leaves no orphaned label.
 *
 * Layer: feature component (src/features/flashcards). Docs: docs/SHELF_REDESIGN.md § 7b,
 * docs/DEFINITION_CLUSTERS.md (eip sense list).
 */

interface EipSenseListProps {
    entry: VocabEntry;
    // Index into sortedSenseClusters(entry) to underline. Undefined → nothing underlined
    // (the host has no pick to name; EipEntryHeader's `selectedSenseIndex` rule).
    selectedSenseIndex?: number;
    // The learner's tone-colour setting (the header cpcd's `useToneColor`). Default on,
    // matching EipEntryHeader's `showPinyinColor` default.
    showPinyinColor?: boolean;
}

const EipSenseList: React.FC<EipSenseListProps> = ({ entry, selectedSenseIndex, showPinyinColor = true }) => {
    const fc = useTheme().palette.flashcard;
    return (
        <SenseList
            entry={entry}
            wordKey={`${entry.language ?? ""}:${entry.entryKey}`}
            selectedSenseIndex={selectedSenseIndex}
            showPinyinColor={showPinyinColor}
            wrap={(list) => (
                // The section: title + list, ruled off from the definition paragraph below, the
                // way the Synonyms + Related section is ruled off from the facts above it.
                <Box
                    component="section"
                    className="eip-sense-list-section"
                    sx={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "8px",
                        paddingBottom: "13px",
                        marginBottom: "13px",
                        borderBottom: `1px solid ${fc.border}`,
                    }}
                >
                    <EipSectionLabel className="eip-sense-list__title">Other Translations</EipSectionLabel>
                    {list}
                </Box>
            )}
        />
    );
};

export default EipSenseList;
