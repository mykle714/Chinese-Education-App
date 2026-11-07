import React, { useMemo } from "react";
import { Box, useTheme } from "@mui/material";
import { sortedSenseClusters } from "../../../utils/definitionUtils";
import { buildSenseSegments, senseSelectedUnderlineSx, SENSE_STAR_GAP } from "../../../components/senseListSegments";
import { ddTextColor } from "../../../utils/cardTextColor";
import { FC_FONT_CJK } from "../constants";
import EipSectionLabel from "../EipSectionLabel";
import { SIZE, WEIGHT } from "../../../theme/scale";
import type { VocabEntry } from "../types";

/**
 * EipSenseList — a multi-sense word's dd list ("Other Translations") as a NUMBERED list at the top of the eip's
 * Definition tab, on EVERY eip host (owner's call 2026-11-05: Dictionary first, then all
 * eips). It replaced the swipeable dot-separated list the eip header used to draw; the header
 * now shows one dd (EipEntryHeader). Mounted by InfoCardTabContent (tab 0).
 *
 * Same senses, order and stars as the card face's SensePicker and Memory Map's prompt — the
 * cells are built by the shared `buildSenseSegments`, the pick marked by the shared
 * `senseSelectedUnderlineSx`. Numbered 1…n in `sortedSenseClusters` order and filled
 * column-major — DOWN the left column, then the right, like a printed dictionary — so the
 * default and the most common senses sit together in the left column (owner's call
 * 2026-11-07; before that one sense per row, 2026-11-05). Titled "Other Translations" in
 * the eip's shared section-label style (`EipSectionLabel`, the Synonyms + Related labels'
 * treatment; owner's call 2026-11-07). Two columns only from 5 senses up
 * (`TWO_COLUMN_MIN_SENSES`); a 2–4-sense list stays one numbered column. A starred sense
 * keeps its star, TRAILING the gloss here (owner's call 2026-11-07) — `buildSenseSegments` hands it over as
 * `leading`, so this list moves it to the end and flips its gap (Memory Map's prompt still
 * leads with it). The number is the position; the star still means "default or very common".
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

// The sense count at which the list splits into two columns; below it, one sense per row.
const TWO_COLUMN_MIN_SENSES = 5;

const EipSenseList: React.FC<EipSenseListProps> = ({ entry, selectedSenseIndex }) => {
    const theme = useTheme();
    const fc = theme.palette.flashcard;
    const segments = useMemo(() => {
        const clusters = sortedSenseClusters(entry);
        return clusters ? buildSenseSegments(clusters, selectedSenseIndex ?? null, "eip-sense-list__sense") : null;
    }, [entry, selectedSenseIndex]);
    if (!segments) return null;

    // Two columns only from TWO_COLUMN_MIN_SENSES senses up; a 2–4-sense list stays one
    // column (owner's call 2026-11-07). Column-major fill: a fixed row count (the left
    // column takes the odd one out) with `gridAutoFlow: "column"` sends items down the left
    // column before the right.
    const columnCount = segments.length >= TWO_COLUMN_MIN_SENSES ? 2 : 1;
    const rowCount = Math.ceil(segments.length / columnCount);
    // Every number gets the same width (widest label, tabular digits), so the glosses start
    // on one edge within each column even once the count reaches two digits.
    const numberWidth = `${String(segments.length).length + 1}ch`;

    return (
        // The section: title + list, ruled off from the definition paragraph below, the way
        // the Synonyms + Related section is ruled off from the facts above it.
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
            <Box
                className="eip-sense-list"
                component="ol"
                sx={{
                    listStyle: "none",
                    margin: 0,
                    padding: 0,
                    display: "grid",
                    gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
                    gridTemplateRows: `repeat(${rowCount}, auto)`,
                    gridAutoFlow: "column",
                    columnGap: "16px",
                    rowGap: "8px",
                    alignItems: "start",
                    // The dd's type (EipEntryHeader's `.eid`), one step smaller for a list.
                    fontFamily: FC_FONT_CJK,
                    fontSize: SIZE.bodyLg,
                    fontWeight: WEIGHT.regular,
                    lineHeight: 1.3,
                    color: ddTextColor(entry.language, undefined, fc),
                    "& .eip-sense-list__sense--selected .eip-sense-list__gloss": senseSelectedUnderlineSx(
                        fc.textSecondary
                    ),
                    // The star trails the gloss in this list, so its gap moves from its right
                    // (the shared leading-star margin) to its left.
                    "& .eip-sense-list__sense-star": { marginRight: 0, marginLeft: `${SENSE_STAR_GAP}px` },
                }}
            >
                {segments.map((segment, index) => (
                    <Box
                        component="li"
                        key={index}
                        className={`eip-sense-list__row ${segment.className ?? ""}`}
                        // Hanging indent: the number is its own column, so a wrapped gloss's
                        // second line aligns under the first line's text, not under the number.
                        sx={{ display: "flex", alignItems: "baseline", minWidth: 0 }}
                    >
                        <Box
                            component="span"
                            className="eip-sense-list__number"
                            aria-hidden
                            sx={{
                                flexShrink: 0,
                                width: numberWidth,
                                marginRight: "4px",
                                textAlign: "right",
                                fontVariantNumeric: "tabular-nums",
                                // Muted ink, like the pick's underline: the number is a position
                                // marker, quieter than the gloss it labels.
                                color: fc.textSecondary,
                            }}
                        >
                            {index + 1}.
                        </Box>
                        <Box
                            component="span"
                            className="eip-sense-list__body"
                            sx={{ minWidth: 0, overflowWrap: "anywhere" }}
                        >
                            <span className="eip-sense-list__gloss">{segment.content ?? segment.text}</span>
                            {/* The star AFTER the word (see the header comment). */}
                            {segment.leading}
                        </Box>
                    </Box>
                ))}
            </Box>
        </Box>
    );
};

export default EipSenseList;
