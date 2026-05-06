import React from "react";
import { stripParentheses } from "../../utils/definitionUtils";
import { Box, Typography } from "@mui/material";
import { useDrag } from "@use-gesture/react";
import CharacterPinyinColorDisplay from "../../components/CharacterPinyinColorDisplay";
import CPCDRow from "../../components/CPCDRow";
import SegmentedSentenceDisplay from "../../components/SegmentedSentenceDisplay";
import {
    TabHeader,
    TabPill,
    BreakdownLineItem,
    DefinitionColumn,
    DefinitionText,
    EicSheet,
    DragHandle,
    MetadataChipRow,
    HskPill,
    PosChip,
    SharedCharsLabel,
    SharedCharsSection,
    EicTabTitleSection,
    EicTabTitleEnglish,
    EicTabTitleFunction,
} from "./styled";
import { COLORS, TAB_COLORS, TAB_LABELS, TAB_FUNCTION_LABELS } from "./constants";
import type { VocabEntry, BreakdownItem } from "./types";
import BreakdownLineItemComponent from "./BreakdownLineItemComponent";

// Renders the English translation with the translatedVocab word/phrase underlined.
// Falls back to plain text if translatedVocab is absent or not found in the translation.
function renderEnglishWithVocabUnderline(english: string, translatedVocab?: string): React.ReactNode {
    if (!translatedVocab) return english;
    const idx = english.toLowerCase().indexOf(translatedVocab.toLowerCase());
    if (idx === -1) return english;
    return (
        <>
            {english.slice(0, idx)}
            <span style={{ textDecoration: 'underline' }}>{english.slice(idx, idx + translatedVocab.length)}</span>
            {english.slice(idx + translatedVocab.length)}
        </>
    );
}

interface InfoCardSectionProps {
    currentEntry: VocabEntry | null;
    selectedTab: number;
    onTabChange: (tab: number) => void;
    breakdownItems: BreakdownItem[];
    showPinyin: boolean;
    isFlipped: boolean;
    // Bottom-sheet integration — managed by useEicSheet in the parent.
    sheetRef: (el: HTMLDivElement | null) => void;
    // Ref to the inner scroll container so the parent hook can read scrollTop.
    scrollContainerRef: (el: HTMLDivElement | null) => void;
    // Sheet height (px) and current translateY (0 = fully visible, sheetHeightPx = hidden).
    sheetHeightPx: number;
    translateY: number;
    isAnimating: boolean;
    // Drag binding for the sheet — spread onto the sheet element.
    bindSheetDrag: (...args: unknown[]) => Record<string, unknown>;
    // Whether the sheet has been opened (controls visibility + pointer events).
    isOpen: boolean;
}

const InfoCardSection: React.FC<InfoCardSectionProps> = ({
    currentEntry,
    selectedTab,
    onTabChange,
    breakdownItems,
    showPinyin,
    isFlipped,
    sheetRef,
    scrollContainerRef,
    sheetHeightPx,
    translateY,
    isAnimating,
    bindSheetDrag,
    isOpen,
}) => {
    // Horizontal swipe handler for tab navigation. Constrained to the X axis so
    // it doesn't interfere with vertical sheet-drag gestures (different element).
    const bindInfoCard = useDrag(
        ({ swipe: [swipeX] }) => {
            if (swipeX < 0) {
                onTabChange(selectedTab === 0 ? 2 : selectedTab - 1);
            } else if (swipeX > 0) {
                onTabChange(selectedTab === 2 ? 0 : selectedTab + 1);
            }
        },
        {
            swipe: { distance: 50, velocity: 0.3 },
            axis: "x",
            filterTaps: true,
        }
    );

    // Info tab is empty only when none of its four content sources is populated.
    const infoTabHasContent = !!(
        currentEntry?.longDefinition ||
        currentEntry?.hskLevel ||
        currentEntry?.partsOfSpeech?.length ||
        currentEntry?.relatedWords?.length
    );

    // Breakdown tab merges per-character rows with the expansion/literal block.
    // It's empty only when neither source has content.
    const breakdownTabHasContent = breakdownItems.length > 0 || !!currentEntry?.expansion;

    // Per-tab emptiness — used to grey out pills whose data source has no content
    // for the current card. Mirrors the empty-state guards in each tab body below.
    const tabIsEmpty: boolean[] = [
        !infoTabHasContent,
        !breakdownTabHasContent,
        !currentEntry?.exampleSentences?.length,
    ];

    return (
        <EicSheet
            ref={sheetRef}
            className="mobile-demo-eic-sheet"
            style={{
                height: `${sheetHeightPx}px`,
                transform: `translateY(${translateY}px)`,
                transition: isAnimating ? "transform 0.35s cubic-bezier(0.32, 0.72, 0, 1)" : "none",
                visibility: isOpen ? "visible" : "hidden",
            }}
            {...bindSheetDrag()}
        >
            <TabHeader className="mobile-demo-tabs" {...bindInfoCard()}>
                <DragHandle className="mobile-demo-drag-handle" />
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: "6px", width: "100%", justifyContent: "flex-start" }}>
                    {TAB_COLORS.map((color, index) => (
                        <TabPill
                            key={index}
                            isSelected={selectedTab === index}
                            color={color}
                            isEmpty={tabIsEmpty[index]}
                            onClick={() => !tabIsEmpty[index] && onTabChange(index)}
                            className={`mobile-demo-tab-pill mobile-demo-tab-pill-${TAB_LABELS[index]}`}
                        >
                            <Typography
                                sx={{
                                    fontSize: "10px",
                                    fontWeight: 500,
                                    lineHeight: 1,
                                    userSelect: "none",
                                    letterSpacing: "0.02em",
                                    color: "inherit",
                                }}
                            >
                                {TAB_LABELS[index]}
                            </Typography>
                        </TabPill>
                    ))}
                </Box>
            </TabHeader>
            <Box
                ref={scrollContainerRef}
                className="mobile-demo-eic-scroll"
                sx={{
                    flex: 1,
                    minHeight: 0,
                    overflow: "auto",
                    padding: "8px",
                    // Prevent scroll from chaining to ancestors when this element hits a boundary.
                    overscrollBehavior: "contain",
                    // Native touch scrolling is disabled — the drag handler in useEicSheet owns
                    // both sheet movement and content scroll. Setting touch-action: none here
                    // (in addition to the parent sheet) ensures mobile browsers don't treat this
                    // as a touch-scrollable region. Wheel/trackpad is still routed manually.
                    touchAction: "none",
                }}
            >
                {/* Title block — vocab word (CPCD lg) + English + tab function label.
                    Rendered for every tab, including empty ones (greyed via isEmpty). */}
                {currentEntry && (
                    <EicTabTitleSection
                        className={`mobile-demo-eic-tab-title mobile-demo-eic-tab-title-${TAB_LABELS[selectedTab]}`}
                        isEmpty={tabIsEmpty[selectedTab]}
                    >
                        <CPCDRow size="lg" justifyContent="flex-start" className="mobile-demo-eic-tab-title-cpcd">
                            {[...currentEntry.entryKey].map((char, i) => (
                                <CharacterPinyinColorDisplay
                                    key={i}
                                    character={char}
                                    pinyin={currentEntry.pronunciation?.split(' ')[i] ?? ''}
                                    size="lg"
                                    useToneColor={true}
                                    showPinyin={showPinyin}
                                />
                            ))}
                        </CPCDRow>
                        <EicTabTitleEnglish className="mobile-demo-eic-tab-title-english">
                            {stripParentheses(currentEntry.entryValue)}
                        </EicTabTitleEnglish>
                        <EicTabTitleFunction className="mobile-demo-eic-tab-title-function">
                            {TAB_FUNCTION_LABELS[selectedTab]}
                        </EicTabTitleFunction>
                    </EicTabTitleSection>
                )}

                {/* Tab 1: Breakdown — per-character rows + expansion / literal-translation block */}
                {selectedTab === 1 && breakdownTabHasContent ? (
                    <Box className="mobile-demo-breakdown-wrapper">
                        {breakdownItems.map((item, index) => (
                            <BreakdownLineItemComponent
                                key={index}
                                character={item.character}
                                pinyin={item.pinyin}
                                definition={item.definition}
                                showPinyin={showPinyin}
                            />
                        ))}
                        {currentEntry?.expansion && (
                            <SharedCharsSection className="mobile-demo-expansion-section">
                                <SharedCharsLabel className="mobile-demo-expansion-label">
                                    Expanded Form
                                </SharedCharsLabel>
                                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, padding: 1 }}>
                                    <SegmentedSentenceDisplay
                                        sentence={{
                                            chinese: currentEntry.expansion,
                                            _segments: currentEntry.expansionSegments ?? [...currentEntry.expansion],
                                            segmentMetadata: currentEntry.expansionMetadata ?? undefined,
                                        }}
                                        size="md"
                                        compact
                                        flexWrap="wrap"
                                        justifyContent="center"
                                        className="mobile-demo-expansion-chars"
                                        showPinyin={showPinyin}
                                    />
                                    {currentEntry.expansionLiteralTranslation && isFlipped && (
                                        <Typography sx={{
                                            fontSize: "0.8rem",
                                            color: COLORS.textSecondary,
                                            fontFamily: '"Inter", sans-serif',
                                            mt: 0.5,
                                            lineHeight: 1.4,
                                            wordBreak: 'break-word',
                                            textAlign: 'center',
                                        }}>
                                            {stripParentheses(currentEntry.expansionLiteralTranslation)}
                                        </Typography>
                                    )}
                                </Box>
                            </SharedCharsSection>
                        )}
                    </Box>
                ) : selectedTab === 1 ? (
                    <Box className="mobile-demo-tab-empty" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 2 }}>
                        <Typography className="mobile-demo-tab-empty-text" sx={{ fontSize: 14, color: COLORS.gray, textAlign: 'center', fontFamily: '"Inter", sans-serif' }}>
                            Breakdown not available for this card
                        </Typography>
                    </Box>
                ) : null}

                {/* Tab 0: Info — HSK + parts of speech, long definition, and shared-character words */}
                {selectedTab === 0 && infoTabHasContent ? (
                    <Box
                        className="mobile-demo-info-wrapper"
                        sx={{ display: 'flex', flexDirection: 'column', padding: 2 }}
                    >
                        {(currentEntry?.hskLevel || (currentEntry?.partsOfSpeech?.length ?? 0) > 0) && (
                            <MetadataChipRow className="mobile-demo-info-meta-row">
                                {currentEntry?.hskLevel && (
                                    <HskPill className="mobile-demo-info-hsk-pill">
                                        {currentEntry.hskLevel.replace(/^HSK/, 'HSK ')}
                                    </HskPill>
                                )}
                                {currentEntry?.partsOfSpeech?.map((pos) => (
                                    <PosChip className="mobile-demo-info-pos-chip" key={pos}>
                                        {pos}
                                    </PosChip>
                                ))}
                            </MetadataChipRow>
                        )}
                        {currentEntry?.longDefinition && (
                            <Typography
                                className="mobile-demo-long-definition-text"
                                sx={{
                                    fontSize: 13,
                                    color: 'text.primary',
                                    fontFamily: '"Inter", sans-serif',
                                    lineHeight: 1.6,
                                    textAlign: 'center',
                                }}
                            >
                                {stripParentheses(currentEntry.longDefinition)}
                            </Typography>
                        )}
                        {currentEntry?.relatedWords && currentEntry.relatedWords.length > 0 && (
                            <SharedCharsSection className="mobile-demo-shared-chars-section">
                                <SharedCharsLabel className="mobile-demo-shared-chars-label">
                                    Other words you've studied with shared characters
                                </SharedCharsLabel>
                                <Box className="mobile-demo-related-words-list">
                                    {currentEntry.relatedWords.map((word) => (
                                        <BreakdownLineItem className="mobile-demo-related-word-item" key={word.id}>
                                            <CPCDRow size="sm">
                                                {[...word.entryKey].map((char, i) => (
                                                    <CharacterPinyinColorDisplay
                                                        key={i}
                                                        character={char}
                                                        pinyin={word.pronunciation?.split(' ')[i] ?? ''}
                                                        showPinyin={showPinyin}
                                                        useToneColor={true}
                                                        size="sm"
                                                    />
                                                ))}
                                            </CPCDRow>
                                            {word.definition && (
                                                <DefinitionColumn>
                                                    <DefinitionText>{stripParentheses(word.definition)}</DefinitionText>
                                                </DefinitionColumn>
                                            )}
                                        </BreakdownLineItem>
                                    ))}
                                </Box>
                            </SharedCharsSection>
                        )}
                    </Box>
                ) : selectedTab === 0 ? (
                    <Box className="mobile-demo-tab-empty" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 2 }}>
                        <Typography className="mobile-demo-tab-empty-text" sx={{ fontSize: 14, color: COLORS.gray, textAlign: 'center', fontFamily: '"Inter", sans-serif' }}>
                            No info available for this card
                        </Typography>
                    </Box>
                ) : null}

                {/* Tab 2: Example Sentences */}
                {selectedTab === 2 && currentEntry?.exampleSentences && currentEntry.exampleSentences.length > 0 ? (
                    <Box className="mobile-demo-sentences-list" sx={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {currentEntry.exampleSentences.map((sentence, index) => (
                            <Box
                                className="mobile-demo-sentence-item"
                                key={index}
                                sx={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '4px',
                                    padding: '8px',
                                    backgroundColor: 'rgba(255, 255, 255, 0.5)',
                                    borderRadius: '8px',
                                    borderLeft: `4px solid ${COLORS.orange}`,
                                }}
                            >
                                <SegmentedSentenceDisplay
                                    sentence={sentence}
                                    size="sm"
                                    flexWrap="wrap"
                                    showPinyin={showPinyin}
                                    vocabWord={currentEntry?.entryKey}
                                />
                                <Typography className="mobile-demo-sentence-english" sx={{ fontSize: 13, color: COLORS.gray, fontFamily: '"Inter", sans-serif', lineHeight: 1.3 }}>
                                    {renderEnglishWithVocabUnderline(sentence.english, sentence.translatedVocab)}
                                </Typography>
                            </Box>
                        ))}
                    </Box>
                ) : selectedTab === 2 ? (
                    <Box className="mobile-demo-tab-empty" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 2 }}>
                        <Typography className="mobile-demo-tab-empty-text" sx={{ fontSize: 14, color: COLORS.gray, textAlign: 'center', fontFamily: '"Inter", sans-serif' }}>
                            No example sentences available
                        </Typography>
                    </Box>
                ) : null}
            </Box>
        </EicSheet>
    );
};

export default InfoCardSection;
