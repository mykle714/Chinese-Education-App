import React from "react";
import { Box, Typography, useTheme } from "@mui/material";
import LongDefinitionDisplay from "../../../components/LongDefinitionDisplay";
import FrequencyScoreDots from "../../../components/FrequencyScoreDots";
import { aiGeneratedSurfaceSx } from "../../../theme/aiGeneratedStyling";
import InfoCardBlockButton from "./InfoCardBlockButton";
import UsedInPaginatedList from "../UsedInPaginatedList";
import ExampleSentenceList from "../ExampleSentenceList";
import MetaChipLabel from "../MetaChipLabel";
import { FC_FONT } from "../constants";
import { SIZE, WEIGHT } from "../../../theme/scale";
import { resolveCommonality } from "../../../utils/definitionUtils";
import type { VocabEntry, BreakdownItem, UsedInItem } from "../types";
import type { TabAvailability } from "./infoCardTabAvailability";

/**
 * The BODY of one eip tab — definition (0), examples (1), or breakdown/used-in (2).
 *
 * ── Why this is its own module ────────────────────────────────────────────────
 * `InfoCardPanelBody` owns three unrelated jobs: the entry header, the swipe/track
 * gesture machinery, and the per-tab content. Only the first two are coupled (both
 * are about the panel as a surface); the content is pure presentation driven by the
 * current entry. Splitting it out took InfoCardPanelBody from 889 lines to ~670 and
 * makes the gesture code readable without scrolling past 220 lines of chips.
 * See docs/ARCHITECTURE_REVIEW.md finding 9.
 *
 * `tabAvailability` is exported alongside it because the panel needs the SAME
 * emptiness answers to grey out tab labels — deriving them twice is how the strip
 * and the body drift apart.
 *
 * Referenced by docs/EXAMPLE_SENTENCES.md (est tab), docs/BREAKDOWN_FEATURE_IMPLEMENTATION.md
 * (bt tab), docs/DATA_VALIDATION_SYSTEM.md (the AI-generated chip treatment).
 */

export interface InfoCardTabContentProps {
    /** 0 = definition, 1 = examples, 2 = breakdown / used-in. */
    tabIndex: number;
    currentEntry: VocabEntry | null;
    breakdownItems: BreakdownItem[];
    /** Precomputed by the panel so the strip and the body agree. */
    avail: TabAvailability;
    showPinyin: boolean;
    showPinyinColor?: boolean;
    onBreakdownItemClick?: (item: BreakdownItem) => void;
    onUsedInItemClick?: (item: UsedInItem) => void;
    onExampleSegmentClick?: (segment: string) => void;
    onSpeakSentence?: (text: string, pronunciation?: string) => void;
    speakingKey?: string | null;
}

const InfoCardTabContent: React.FC<InfoCardTabContentProps> = ({
    tabIndex,
    currentEntry,
    breakdownItems,
    avail,
    showPinyin,
    showPinyinColor = true,
    onBreakdownItemClick,
    onUsedInItemClick,
    onExampleSegmentClick,
    onSpeakSentence,
    speakingKey,
}) => {
    const theme = useTheme();
    const fc = theme.palette.flashcard;
    // Commonality follows the SENSE the card is on, not the entry: a polyseme's word-level
    // score contradicts the definition printed right above it. No index override is needed
    // — the tab's entry snapshot is re-seeded on every sense pick (useEipTabs.syncEntry),
    // exactly as the long definition below resolves. See docs/DEFINITION_CLUSTERS.md.
    const commonality = currentEntry
        ? resolveCommonality(currentEntry)
        : { score: null, senseLabel: null, approved: false };
    const {
        longDefinition,
        longDefinitionParts,
        isSingleChar,
        usedInItems,
        definition: definitionTabHasContent,
        examples: examplesTabHasContent,
        breakdown: breakdownTabHasContent,
    } = avail;

        if (tabIndex === 0) {
            return definitionTabHasContent ? (
                <Box className="mobile-demo-definition-wrapper" sx={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                    {(longDefinition || longDefinitionParts?.length) && (
                        <LongDefinitionDisplay
                            className="mobile-demo-long-definition-text"
                            longDefinition={longDefinition}
                            longDefinitionParts={longDefinitionParts}
                            showPinyin={showPinyin}
                            showPinyinColor={showPinyinColor}
                            onSegmentOpen={onExampleSegmentClick}
                            aiGenerated={!currentEntry?.definitionsApproved}
                            word1={currentEntry?.entryKey}
                            language={currentEntry?.language}
                            sx={{
                                fontSize: SIZE.body,
                                color: fc.onSurface,
                                fontFamily: FC_FONT,
                                lineHeight: 1.6,
                            }}
                        />
                    )}
                    {(currentEntry?.difficulty || (currentEntry?.partsOfSpeech?.length ?? 0) > 0 || commonality.score != null) && (
                        <Box
                            className="mobile-demo-definition-meta-strip"
                            sx={{
                                // Two stacked rows: Difficulty + Commonality share a centered
                                // top row, Parts of Speech gets a full-width row below them
                                // (its value can be long, so it needs the whole line).
                                display: "flex",
                                flexDirection: "column",
                                gap: "10px",
                                padding: "10px 0",
                                borderTop: `1px solid ${fc.border}`,
                                borderBottom: `1px solid ${fc.border}`,
                            }}
                        >
                          {/* Top row renders only when it has a chip — otherwise its empty
                              box would still contribute the column gap above the POS row. */}
                          {((currentEntry?.language === 'zh' && !!currentEntry?.difficulty) || commonality.score != null) && (
                          <Box
                            className="mobile-demo-definition-meta-row"
                            sx={{ display: "flex", gap: "18px", alignItems: "center", justifyContent: "center" }}
                          >
                            {/* Difficulty meta: only for zh, whose 1–6 difficulty integers ARE HSK
                                levels; es uses the same scale but never names it HSK. */}
                            {currentEntry?.language === 'zh' && currentEntry.difficulty && (
                                // AI-classified (backfill-hsk-level.js), so it carries the AI-generated
                                // box (no badge — a small value chip) until the 'difficulty' validation
                                // field is human-approved (docs/DATA_VALIDATION_SYSTEM.md).
                                <Box
                                    className={currentEntry.difficultyApproved ? "mobile-demo-hsk-chip" : "mobile-demo-hsk-chip mobile-demo-hsk-chip--ai-generated"}
                                    sx={{
                                        // position:relative anchors MetaChipLabel's absolutely-positioned
                                        // validator overlay to THIS chip's corner.
                                        position: "relative",
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: "3px",
                                        ...(currentEntry.difficultyApproved ? {} : { ...aiGeneratedSurfaceSx, borderRadius: "8px", padding: "4px 8px" }),
                                    }}
                                >
                                    <MetaChipLabel label="Difficulty" field="difficulty" word1={currentEntry!.entryKey} language={currentEntry?.language} approved={currentEntry?.difficultyApproved} classPrefix="mobile-demo" />
                                    <Typography sx={{ fontSize: SIZE.body, fontWeight: WEIGHT.semibold, color: fc.onSurface, fontFamily: FC_FONT, whiteSpace: "nowrap" }}>
                                        {`HSK ${currentEntry.difficulty}`}
                                    </Typography>
                                </Box>
                            )}
                            {commonality.score != null && (
                                // AI-scored (the clusterer for a per-sense score, backfill-frequency-score.js
                                // for the entry-level one), so it carries the AI-generated box until THAT
                                // value's validation field is human-approved.
                                <Box
                                    className={commonality.approved ? "mobile-demo-frequency-meta" : "mobile-demo-frequency-meta mobile-demo-frequency-meta--ai-generated"}
                                    sx={{
                                        // position:relative anchors MetaChipLabel's absolutely-positioned
                                        // validator overlay to THIS chip's corner.
                                        position: "relative",
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: "3px",
                                        ...(commonality.approved ? {} : { ...aiGeneratedSurfaceSx, borderRadius: "8px", padding: "4px 8px" }),
                                    }}
                                >
                                    {/* A per-sense score validates the cluster ('senseFrequencyScore' +
                                        senseLabel, migration 139); the entry-level fallback validates the
                                        det column, exactly as before. */}
                                    <MetaChipLabel
                                        label="Commonality"
                                        field={commonality.senseLabel ? "senseFrequencyScore" : "frequencyScore"}
                                        word1={currentEntry!.entryKey}
                                        language={currentEntry?.language}
                                        senseLabel={commonality.senseLabel}
                                        approved={commonality.approved}
                                        classPrefix="mobile-demo"
                                    />
                                    <Box className="mobile-demo-frequency-dots" sx={{ display: "flex", alignItems: "center", gap: "5px", height: 19 }}>
                                        <FrequencyScoreDots
                                            score={commonality.score}
                                            filledColor={fc.onSurface}
                                            emptyBorderColor={fc.border}
                                        />
                                        <Typography sx={{ fontSize: SIZE.micro, fontWeight: WEIGHT.bold, color: fc.onSurface, fontFamily: FC_FONT, lineHeight: 1 }}>
                                            {commonality.score}/5
                                        </Typography>
                                    </Box>
                                </Box>
                            )}
                          </Box>
                          )}
                          {/* Parts of Speech — its own full-width row under the pair above. */}
                          {(currentEntry?.partsOfSpeech?.length ?? 0) > 0 && (
                            <Box
                                className={currentEntry?.partsOfSpeechApproved ? "mobile-demo-pos-chip" : "mobile-demo-pos-chip mobile-demo-pos-chip--ai-generated"}
                                sx={{
                                    // position:relative anchors MetaChipLabel's absolutely-positioned
                                    // validator overlay to THIS chip's corner.
                                    position: "relative",
                                    display: "flex",
                                    flexDirection: "column",
                                    alignItems: "center",
                                    gap: "3px",
                                    // Spans the strip's full width — the value (a comma-joined POS
                                    // list) is the longest of the three metas.
                                    width: "100%",
                                    // Orange border/tint only (no badge) until the 'partsOfSpeech'
                                    // field is human-approved — its own field since migration 132,
                                    // so definitions churn no longer clears it.
                                    ...(currentEntry?.partsOfSpeechApproved ? {} : { ...aiGeneratedSurfaceSx, borderRadius: "8px", padding: "4px 8px" }),
                                }}
                            >
                                <MetaChipLabel label="Parts of Speech" field="partsOfSpeech" word1={currentEntry!.entryKey} language={currentEntry?.language} approved={currentEntry?.partsOfSpeechApproved} classPrefix="mobile-demo" />
                                <Typography sx={{ fontSize: SIZE.body, fontWeight: WEIGHT.semibold, color: fc.onSurface, fontFamily: FC_FONT, textAlign: "center" }}>
                                    {currentEntry!.partsOfSpeech!.join(', ')}
                                </Typography>
                            </Box>
                          )}
                        </Box>
                    )}
                </Box>
            ) : (
                <Box className="mobile-demo-tab-empty" sx={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 2 }}>
                    <Typography sx={{ fontSize: SIZE.body, color: fc.textSecondary, textAlign: "center", fontFamily: FC_FONT }}>
                        No definition available for this card
                    </Typography>
                </Box>
            );
        }

        if (tabIndex === 1) {
            // Examples — shared est renderer (see ExampleSentenceList).
            return examplesTabHasContent ? (
                <ExampleSentenceList
                    sentences={currentEntry!.exampleSentences!}
                    vocabWord={currentEntry?.entryKey}
                    language={currentEntry?.language}
                    showPinyin={showPinyin}
                    showPinyinColor={showPinyinColor}
                    onSegmentOpen={onExampleSegmentClick}
                    onSpeakSentence={onSpeakSentence}
                    speakingKey={speakingKey}
                />
            ) : (
                <Box className="mobile-demo-tab-empty" sx={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 2 }}>
                    <Typography sx={{ fontSize: SIZE.body, color: fc.textSecondary, textAlign: "center", fontFamily: FC_FONT }}>
                        No example sentences available
                    </Typography>
                </Box>
            );
        }

        // tabIndex === 2: Breakdown (multi-char) or Used In (single-char)
        return breakdownTabHasContent ? (
            <Box className="mobile-demo-breakdown-wrapper" sx={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                {isSingleChar ? (
                    // Infinite-scroll list: seeds from the card's ≤4 preview (usedInItems),
                    // pages the rest via /api/dictionary/usedIn.
                    <UsedInPaginatedList
                        character={currentEntry!.entryKey}
                        language={currentEntry!.language ?? 'zh'}
                        initialItems={usedInItems}
                        showPinyin={showPinyin}
                        showPinyinColor={showPinyinColor}
                        onItemClick={onUsedInItemClick}
                        rowClassName="mobile-demo-used-in-row-button"
                    />
                ) : (
                    // Extra inset layer: pads the block-button grid away from the
                    // tab's edges and centers it, so the buttons (which flex to
                    // fill the width) sit as a balanced group. Mirrored in the cdp
                    // (VocabCardDetailBody) so both breakdown surfaces match.
                    <Box
                        className="mobile-demo-breakdown-grid-layer"
                        sx={{ display: "flex", justifyContent: "center", padding: "16px" }}
                    >
                        {/* auto-fit tracks: as many equal 1fr columns as fit at
                            ≥116px each, so buttons stay IDENTICAL in size and flow
                            left-to-right then wrap top-down (a short last row keeps
                            the same cell width instead of stretching). */}
                        <Box
                            className="mobile-demo-breakdown-grid"
                            sx={{
                                display: "grid",
                                gridTemplateColumns: "repeat(auto-fit, minmax(min(116px, 100%), 1fr))",
                                gap: "10px",
                                width: "100%",
                            }}
                        >
                        {breakdownItems.map((item, index) => (
                            <InfoCardBlockButton
                                key={index}
                                className="mobile-demo-breakdown-row-button"
                                character={item.character}
                                pinyin={item.pinyin}
                                definition={item.definition}
                                showPinyin={showPinyin}
                                showPinyinColor={showPinyinColor}
                                onClick={onBreakdownItemClick ? () => onBreakdownItemClick(item) : undefined}
                            />
                        ))}
                        </Box>
                    </Box>
                )}
            </Box>
        ) : (
            <Box className="mobile-demo-tab-empty" sx={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 2 }}>
                <Typography sx={{ fontSize: SIZE.body, color: fc.textSecondary, textAlign: "center", fontFamily: FC_FONT }}>
                    {isSingleChar ? "No words use this character yet" : "Breakdown not available for this card"}
                </Typography>
            </Box>
        );
};

export default InfoCardTabContent;
