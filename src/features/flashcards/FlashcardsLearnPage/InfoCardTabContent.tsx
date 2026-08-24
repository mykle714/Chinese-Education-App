import React from "react";
import { Box, Typography, useTheme } from "@mui/material";
import LongDefinitionDisplay from "../../../components/LongDefinitionDisplay";
import BreakdownRow from "../BreakdownRow";
import DefinitionFacts from "../DefinitionFacts";
import UsedInPaginatedList from "../UsedInPaginatedList";
import ExampleSentenceList from "../ExampleSentenceList";
import { FC_FONT } from "../constants";
import { SIZE } from "../../../theme/scale";
import type { VocabEntry, BreakdownItem, UsedInItem } from "../types";
import type { TabAvailability } from "./infoCardTabAvailability";
import { sortedSenseClusters, hasSynonymsOrRelated } from "../../../utils/definitionUtils";
import SynonymsRelatedSection, { EipSectionLabel } from "../SynonymsRelatedSection";
import { Label } from "../../../components/primitives";

/**
 * `.shelfhd` inside an eip tab: what the tab is showing on the left, and a fact about
 * it on the right. Local to this file — it is two `Label`s in a row, and hoisting it
 * would be a shared component whose only job is to remember the padding.
 */
const TabCaption: React.FC<{ left: string; right: string; className?: string }> = ({ left, right, className }) => (
    <Box
        className={className}
        sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "13px 18px 0" }}
    >
        <Label>{left}</Label>
        <Label>{right}</Label>
    </Box>
);

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
    /**
     * The panel's live sense pick (eip header SensePicker) — an index into
     * sortedSenseClusters(currentEntry). Passed straight through to the per-sense
     * resolvers so the tab body follows the tap immediately.
     */
    selectedSenseIndex?: number;
    /**
     * Append the Synonyms + Related Words lists to the bottom of the DEFINITION tab.
     *
     * Only the cdp passes this. The eip has three tabs and none of them is synonyms, but
     * the cdp's sheet body IS this panel now (VocabCardDetailPage), and those two lists
     * are the one thing its old stacked-`SectionCard` body showed that the panel does
     * not. They ride under the definition rather than becoming a fourth tab because a
     * tab is a promise of content and most entries have neither list — an empty tab in
     * the strip on every card is a worse trade than a section that simply is not there.
     *
     * The flp and scp leave it undefined: on those surfaces the panel is the reading
     * view for a word in a drill, and the lists are reference material the cdp is for.
     */
    showSynonymsRelated?: boolean;
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
    selectedSenseIndex,
    showSynonymsRelated = false,
}) => {
    const theme = useTheme();
    const fc = theme.palette.flashcard;
    // Commonality moved into DefinitionFacts, which resolves it per SENSE from the
    // `selectedSenseIndex` threaded below — see that component and
    // docs/DEFINITION_CLUSTERS.md.
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
            // ⚠️ NO ACTION BAR any more. `InfoCardActionBar` (Add to Deck / Compare To /
            // Practice Writing) used to ride at the end of this tab and is DELETED:
            // artboards 20 and 20b make the panel information-only, and its three
            // actions moved to where they belong. Practice Writing and Compare are word
            // tools, so they are on `WordToolsRail` above the card; Add to Deck is a card
            // operation, so it is on `CardOpsRail` behind the card's `•••`.
            //
            // One consequence, accepted rather than overlooked: those rails act on the
            // CARD's word, not on a word the learner has DRILLED INTO from the breakdown
            // rows. To file or compare a drilled-in word you now open its own page (the
            // rows are tappable, which is how you get there). The alternative was a
            // per-tab action bar inside a panel the design deliberately emptied.

            // The definition paragraph. Handed to DefinitionFacts as a renderer so ONE
            // AI treatment can wrap the paragraph and the facts together when nothing in
            // the block is human-approved (artboard 20b) — `grouped` tells the paragraph
            // to stand down its own orange box in that case, or the panel shows two.
            const paragraph = (longDefinition || longDefinitionParts?.length)
                ? ({ grouped }: { grouped: boolean }) => (
                    <LongDefinitionDisplay
                        className="mobile-demo-long-definition-text"
                        longDefinition={longDefinition}
                        longDefinitionParts={longDefinitionParts}
                        showPinyin={showPinyin}
                        showPinyinColor={showPinyinColor}
                        onSegmentOpen={onExampleSegmentClick}
                        aiGenerated={!grouped && !currentEntry?.definitionsApproved}
                        word1={currentEntry?.entryKey}
                        language={currentEntry?.language}
                        sx={{
                            fontSize: SIZE.body,
                            color: fc.onSurface,
                            fontFamily: FC_FONT,
                            lineHeight: 1.6,
                        }}
                    />
                )
                : undefined;

            // Synonyms + Related Words, cdp only (see showSynonymsRelated). Rendered as a
            // ruled-off section below the facts, using the panel's own label treatment —
            // the eip has no SectionCard, so the rule is what separates it from the
            // definition above rather than a second box.
            const synonymsSection = showSynonymsRelated && hasSynonymsOrRelated(currentEntry) ? (
                <Box
                    className="mobile-demo-synonyms-related"
                    sx={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "8px",
                        marginTop: "13px",
                        paddingTop: "13px",
                        borderTop: `1px solid ${fc.border}`,
                    }}
                >
                    <SynonymsRelatedSection
                        entry={currentEntry!}
                        classPrefix="mobile-demo"
                        renderLabel={(text, extra) => (
                            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                                <EipSectionLabel>{text}</EipSectionLabel>
                                {extra}
                            </Box>
                        )}
                    />
                </Box>
            ) : null;

            return definitionTabHasContent && currentEntry ? (
                <Box className="mobile-demo-definition-wrapper" sx={{ display: "flex", flexDirection: "column" }}>
                    {/* The paragraph plus the three measured facts — one shared component
                        with the cdp (DefinitionFacts / `.dfx`). This used to be ~90 lines
                        of centred chips duplicated verbatim in VocabCardDetailBody. */}
                    <DefinitionFacts
                        entry={currentEntry}
                        selectedSenseIndex={selectedSenseIndex}
                        paragraph={paragraph}
                        paragraphApproved={currentEntry.definitionsApproved}
                        classPrefix="mobile-demo"
                    />
                    {synonymsSection}
                </Box>
            ) : (
                // No definition — but an entry can still carry synonyms/related, and on the
                // cdp swallowing them behind an empty-state would lose content the page used
                // to show. Show the message AND whatever the section has.
                <Box className="mobile-demo-definition-wrapper" sx={{ display: "flex", flexDirection: "column" }}>
                    <Box className="mobile-demo-tab-empty" sx={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 2 }}>
                        <Typography sx={{ fontSize: SIZE.body, color: fc.textSecondary, textAlign: "center", fontFamily: FC_FONT }}>
                            No definition available for this card
                        </Typography>
                    </Box>
                    {synonymsSection}
                </Box>
            );
        }

        if (tabIndex === 1) {
            // Examples — shared est renderer (see ExampleSentenceList), under a caption
            // naming WHICH SENSE these sentences illustrate (artboard 24). The sense
            // matters here more than anywhere else in the panel: the sentences change
            // with the pick, and without the caption a learner who has switched senses
            // has no way to tell whether they are looking at the new set or the old one.
            const senseCaption = currentEntry
                ? sortedSenseClusters(currentEntry)?.[selectedSenseIndex ?? 0]?.sense
                : undefined;
            return examplesTabHasContent ? (
                <>
                    <TabCaption
                        className="mobile-demo-examples-caption"
                        left={senseCaption
                            ? `sense ${(selectedSenseIndex ?? 0) + 1} · ${senseCaption}`
                            : "examples"}
                        right={`${currentEntry!.exampleSentences!.length} ${currentEntry!.exampleSentences!.length === 1 ? "example" : "examples"}`}
                    />
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
                </>
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
            <Box className="mobile-demo-breakdown-wrapper" sx={{ display: "flex", flexDirection: "column" }}>
                {/* What this tab is answering, and that the rows go somewhere (artboard
                    25). "tap to open" rather than a bare chevron caption: the rows drill
                    into their own entries, and the word trail above is how you come back
                    — both worth saying once, at the top, instead of per row. */}
                <TabCaption
                    className="mobile-demo-breakdown-caption"
                    left={isSingleChar
                        ? `${currentEntry?.entryKey ?? ""} · used in`
                        : `${currentEntry?.entryKey ?? ""} · ${breakdownItems.length} characters`}
                    right="tap to open"
                />
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
                    // One `.bkr` row per component character, in the word's own order
                    // (BreakdownRow). This was a wrapping grid of 1:1 block buttons; see
                    // that component's header for why the shape changed.
                    <Box className="mobile-demo-breakdown-list">
                        {breakdownItems.map((item, index) => (
                            <BreakdownRow
                                key={index}
                                className="mobile-demo-breakdown-row-button"
                                character={item.character}
                                pinyin={item.pinyin}
                                definition={item.definition}
                                language={currentEntry?.language}
                                showPinyin={showPinyin}
                                showPinyinColor={showPinyinColor}
                                onClick={onBreakdownItemClick ? () => onBreakdownItemClick(item) : undefined}
                            />
                        ))}
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
