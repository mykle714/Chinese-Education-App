import React, { useRef, useEffect } from "react";
import { stripParentheses } from "../../utils/definitionUtils";
import { Box, CardContent, Typography } from "@mui/material";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import { useDrag } from "@use-gesture/react";
import CharacterPinyinColorDisplay from "../../components/CharacterPinyinColorDisplay";
import CPCDRow from "../../components/CPCDRow";
import SegmentedSentenceDisplay from "../../components/SegmentedSentenceDisplay";
import {
    InfoCard,
    TabsContainer,
    Tab,
    ArrowIndicator,
    BreakdownLineItem,
    DefinitionColumn,
    DefinitionText,
} from "./styled";
import { COLORS, TAB_COLORS, TAB_LABELS } from "./constants";
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
}

const InfoCardSection: React.FC<InfoCardSectionProps> = ({
    currentEntry,
    selectedTab,
    onTabChange,
    breakdownItems,
    showPinyin,
}) => {
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    // Reset scroll position to top whenever a new card is loaded
    useEffect(() => {
        if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = 0;
        }
    }, [currentEntry]);

    // Swipe handler for tab navigation on the info card
    const bindInfoCard = useDrag(
        ({ swipe: [swipeX], event }) => {
            if (event) {
                event.preventDefault();
            }

            if (swipeX !== 0) {
                if (swipeX < 0) {
                    // Swiped left - move to previous tab (with wrap-around)
                    onTabChange(selectedTab === 0 ? 4 : selectedTab - 1);
                } else if (swipeX > 0) {
                    // Swiped right - move to next tab (with wrap-around)
                    onTabChange(selectedTab === 4 ? 0 : selectedTab + 1);
                }
            }
        },
        {
            swipe: {
                distance: 50, // Minimum distance to trigger swipe
                velocity: 0.3,
            },
            preventDefault: true,
            filterTaps: true, // Don't trigger on simple taps
            eventOptions: { passive: false }, // Required so preventDefault() is honoured on touch events
        }
    );

    return (
        <Box className="mobile-demo-info-card-wrapper" sx={{ position: "relative", width: "calc(100% - 80px)" }}>
            {/* Left Arrow Indicator */}
            <ArrowIndicator
                className="mobile-demo-left-arrow"
                sx={{ left: -32 }}
                onClick={() => onTabChange(selectedTab === 0 ? 4 : selectedTab - 1)}
            >
                <ChevronLeftIcon className="mobile-demo-chevron-left" sx={{ fontSize: 24 }} />
            </ArrowIndicator>

            {/* Tabs are siblings of InfoCard so z-index layering works correctly */}
            <TabsContainer className="mobile-demo-tabs">
                {TAB_COLORS.map((color, index) => (
                    <Tab
                        key={index}
                        isSelected={selectedTab === index}
                        color={color}
                        onClick={() => onTabChange(index)}
                    >
                        <Typography
                            sx={{
                                fontSize: "8px",
                                fontWeight: 500,
                                color: "text.primary",
                                lineHeight: 1,
                                userSelect: "none",
                                letterSpacing: "0.02em",
                            }}
                        >
                            {TAB_LABELS[index]}
                        </Typography>
                    </Tab>
                ))}
            </TabsContainer>

            <InfoCard
                className="mobile-demo-info-card"
                sx={{ width: "100%", aspectRatio: "295 / 203" }}
                {...bindInfoCard()}
            >
                <CardContent
                    className="mobile-demo-card-content"
                    sx={{
                        display: "flex",
                        flexDirection: "column",
                        height: "100%",
                        padding: 0,
                        "&:last-child": {
                            paddingBottom: 0,
                        },
                    }}
                >
                    <Box ref={scrollContainerRef} className="mobile-demo-breakdown-list" sx={{ flex: 1, overflow: "auto", padding: "8px" }}>
                        {/* Tab 0: Breakdown */}
                        {selectedTab === 0 && breakdownItems.length > 0 ? (
                            breakdownItems.map((item, index) => (
                                <BreakdownLineItemComponent
                                    key={index}
                                    character={item.character}
                                    pinyin={item.pinyin}
                                    definition={item.definition}
                                    showPinyin={showPinyin}
                                />
                            ))
                        ) : selectedTab === 0 ? (
                            <Box className="mobile-demo-tab-empty" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 2 }}>
                                <Typography className="mobile-demo-tab-empty-text" sx={{ fontSize: 14, color: COLORS.gray, textAlign: 'center', fontFamily: '"Inter", sans-serif' }}>
                                    Breakdown not available for this card
                                </Typography>
                            </Box>
                        ) : null}

                        {/* Tab 1: Related Words */}
                        {selectedTab === 1 && currentEntry?.relatedWords && currentEntry.relatedWords.length > 0 ? (
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
                        ) : selectedTab === 1 ? (
                            <Box className="mobile-demo-tab-empty" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 2 }}>
                                <Typography className="mobile-demo-tab-empty-text" sx={{ fontSize: 14, color: COLORS.gray, textAlign: 'center', fontFamily: '"Inter", sans-serif' }}>
                                    No related words found
                                </Typography>
                            </Box>
                        ) : null}

                        {/* Tab 2: Long Definition */}
                        {selectedTab === 2 && currentEntry?.longDefinition ? (
                            <Box
                                className="mobile-demo-long-definition-wrapper"
                                sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 2 }}
                            >
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
                            </Box>
                        ) : selectedTab === 2 ? (
                            <Box className="mobile-demo-tab-empty" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 2 }}>
                                <Typography className="mobile-demo-tab-empty-text" sx={{ fontSize: 14, color: COLORS.gray, textAlign: 'center', fontFamily: '"Inter", sans-serif' }}>
                                    No extended definition available
                                </Typography>
                            </Box>
                        ) : null}

                        {/* Tab 3: Example Sentences */}
                        {selectedTab === 3 && currentEntry?.exampleSentences && currentEntry.exampleSentences.length > 0 ? (
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
                                            size="xs"
                                            flexWrap="wrap"
                                            showPinyin={showPinyin}
                                            vocabWord={currentEntry?.entryKey}
                                        />
                                        <Typography className="mobile-demo-sentence-english" sx={{ fontSize: 11, color: COLORS.gray, fontFamily: '"Inter", sans-serif', lineHeight: 1.3 }}>
                                            {renderEnglishWithVocabUnderline(sentence.english, sentence.translatedVocab)}
                                        </Typography>
                                    </Box>
                                ))}
                            </Box>
                        ) : selectedTab === 3 ? (
                            <Box className="mobile-demo-tab-empty" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 2 }}>
                                <Typography className="mobile-demo-tab-empty-text" sx={{ fontSize: 14, color: COLORS.gray, textAlign: 'center', fontFamily: '"Inter", sans-serif' }}>
                                    No example sentences available
                                </Typography>
                            </Box>
                        ) : null}

                        {/* Tab 4: Expansion */}
                        {selectedTab === 4 && currentEntry?.expansion ? (
                            <Box className="mobile-demo-expansion-wrapper" sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 2, gap: 2 }}>
                                <Typography className="mobile-demo-expansion-label" sx={{ fontSize: 12, color: COLORS.gray, fontFamily: '"Inter", sans-serif', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                    Expanded Form
                                </Typography>
                                <SegmentedSentenceDisplay
                                    sentence={{
                                        chinese: currentEntry.expansion,
                                        _segments: [...currentEntry.expansion],
                                        segmentMetadata: currentEntry.expansionMetadata ?? undefined,
                                    }}
                                    size="md"
                                    compact
                                    flexWrap="wrap"
                                    justifyContent="center"
                                    className="mobile-demo-expansion-chars"
                                    showPinyin={showPinyin}
                                />
                                {/* Literal translation: segment definitions strung together */}
                                {currentEntry.expansionLiteralTranslation && (
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
                        ) : selectedTab === 4 ? (
                            <Box className="mobile-demo-tab-empty" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 2 }}>
                                <Typography className="mobile-demo-tab-empty-text" sx={{ fontSize: 14, color: COLORS.gray, textAlign: 'center', fontFamily: '"Inter", sans-serif' }}>
                                    No expansion available
                                </Typography>
                            </Box>
                        ) : null}
                    </Box>
                </CardContent>
            </InfoCard>

            {/* Right Arrow Indicator */}
            <ArrowIndicator
                className="mobile-demo-right-arrow"
                sx={{ right: -32 }}
                onClick={() => onTabChange(selectedTab === 4 ? 0 : selectedTab + 1)}
            >
                <ChevronRightIcon className="mobile-demo-chevron-right" sx={{ fontSize: 24 }} />
            </ArrowIndicator>
        </Box>
    );
};

export default InfoCardSection;
