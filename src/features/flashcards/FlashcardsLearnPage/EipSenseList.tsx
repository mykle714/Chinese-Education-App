import React, { useMemo } from "react";
import { Box, useTheme } from "@mui/material";
import { sortedSenseClusters } from "../../../utils/definitionUtils";
import { buildSenseSegments, senseSelectedUnderlineSx } from "../../../components/senseListSegments";
import { ddTextColor } from "../../../utils/cardTextColor";
import { FC_FONT_CJK } from "../constants";
import { SIZE, WEIGHT } from "../../../theme/scale";
import type { VocabEntry } from "../types";

/**
 * EipSenseList — a multi-sense word's dd list as a SINGLE-COLUMN list at the top of the eip's
 * Definition tab, on EVERY eip host (owner's call 2026-11-05: Dictionary first, then all
 * eips). It replaced the swipeable dot-separated list the eip header used to draw; the header
 * now shows one dd (EipEntryHeader). Mounted by InfoCardTabContent (tab 0).
 *
 * Same senses, order and stars as the card face's SensePicker and Memory Map's prompt — the
 * cells are built by the shared `buildSenseSegments`, the pick marked by the shared
 * `senseSelectedUnderlineSx`. One sense per row, the default first (owner's call 2026-11-05;
 * briefly a two-column grid the same day).
 * Display-only, like the header list: the pick is made on a card face's SensePicker.
 *
 * Renders nothing for a single-sense / unclustered word (sortedSenseClusters → null): the
 * header's one dd already says everything.
 *
 * Layer: feature component (src/features/flashcards). Docs: docs/SHELF_REDESIGN.md § 7b,
 * docs/DEFINITION_CLUSTERS.md (eip sense list).
 */

interface EipSenseListProps {
    entry: VocabEntry;
    // Index into sortedSenseClusters(entry) to underline. Undefined → nothing underlined
    // (the host has no pick to name; EipEntryHeader's `selectedSenseIndex` rule).
    selectedSenseIndex?: number;
}

const EipSenseList: React.FC<EipSenseListProps> = ({ entry, selectedSenseIndex }) => {
    const theme = useTheme();
    const fc = theme.palette.flashcard;
    const segments = useMemo(() => {
        const clusters = sortedSenseClusters(entry);
        return clusters ? buildSenseSegments(clusters, selectedSenseIndex ?? null, "eip-sense-list__sense") : null;
    }, [entry, selectedSenseIndex]);
    if (!segments) return null;

    return (
        <Box
            className="eip-sense-list"
            component="ul"
            sx={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                // One sense per row; a long dd wraps within its row.
                display: "flex",
                flexDirection: "column",
                gap: "8px",
                // Ruled off from the definition paragraph below, the way the Synonyms +
                // Related section is ruled off from the facts above it.
                paddingBottom: "13px",
                marginBottom: "13px",
                borderBottom: `1px solid ${fc.border}`,
                // The dd's type (EipEntryHeader's `.eid`), one step smaller for a list.
                fontFamily: FC_FONT_CJK,
                fontSize: SIZE.bodyLg,
                fontWeight: WEIGHT.regular,
                lineHeight: 1.3,
                color: ddTextColor(entry.language, undefined, fc),
                "& .eip-sense-list__sense--selected .eip-sense-list__gloss": senseSelectedUnderlineSx(fc.textSecondary),
            }}
        >
            {segments.map((segment, index) => (
                <Box
                    component="li"
                    key={index}
                    className={`eip-sense-list__row ${segment.className ?? ""}`}
                    sx={{ minWidth: 0, overflowWrap: "anywhere" }}
                >
                    {segment.leading}
                    <span className="eip-sense-list__gloss">{segment.content ?? segment.text}</span>
                </Box>
            ))}
        </Box>
    );
};

export default EipSenseList;
