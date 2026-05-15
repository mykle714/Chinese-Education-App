import React, { useState, useCallback, useRef, useLayoutEffect } from "react";
import { stripParentheses } from "../../utils/definitionUtils";
import { Box, Typography, useTheme } from "@mui/material";
import { useDrag } from "@use-gesture/react";
import CharacterPinyinColorDisplay from "../../components/CharacterPinyinColorDisplay";
import CPCDRow from "../../components/CPCDRow";
import SegmentedSentenceDisplay from "../../components/SegmentedSentenceDisplay";
import {
    EicScrim,
    InfoSheetContainer,
    InfoSheetGrabber,
    InfoSheetEntryHeader,
    InfoSheetTabStrip,
    InfoSheetTab,
    SharedCharsLabel,
} from "./styled";
import { TAB_LABELS } from "./constants";
import type { VocabEntry, BreakdownItem } from "./types";

// Renders the English translation with the translatedVocab word/phrase underlined.
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
    showSegmentSpaces?: boolean;
    isFlipped: boolean;
    onClose: () => void;
}

// Height below which releasing the drag triggers sheet dismissal.
const DISMISS_HEIGHT_PX = 80;
// Minimum downward drag distance (px) required before a fast-flick dismisses.
const DISMISS_MIN_DRAG_PX = 20;
// Velocity (px/ms) above which a downward flick counts as a dismiss gesture.
const DISMISS_VELOCITY_THRESHOLD = 0.5;

const InfoCardSection: React.FC<InfoCardSectionProps> = ({
    currentEntry,
    selectedTab,
    onTabChange,
    breakdownItems,
    showPinyin,
    showSegmentSpaces = false,
    isFlipped,
    onClose,
}) => {
    const theme = useTheme();
    const fc = theme.palette.flashcard;

    const sheetContainerRef = useRef<HTMLDivElement | null>(null);
    // Sheet height in px. null until measured after first render.
    const [sheetHeight, setSheetHeight] = useState<number | null>(null);
    // Ref kept in sync with state so the drag handler always reads the latest value.
    const sheetHeightRef = useRef<number | null>(null);
    const dragStartHeightRef = useRef<number>(0);
    // Parent container height used as the cap for resize drags.
    const parentHeightRef = useRef<number>(0);

    // Measure the sheet's natural height on first render (definition tab is active on open)
    // and lock it as a fixed height. useLayoutEffect ensures the lock is applied before the
    // browser's first paint, so there is no visible jump.
    useLayoutEffect(() => {
        if (sheetContainerRef.current) {
            const measured = sheetContainerRef.current.offsetHeight;
            const parentH = sheetContainerRef.current.parentElement?.clientHeight ?? window.innerHeight;
            parentHeightRef.current = parentH;
            sheetHeightRef.current = measured;
            setSheetHeight(measured);
        }
    }, []);

    const handleClose = useCallback(() => {
        onClose();
    }, [onClose]);

    // Drag the grabber to resize the sheet (drag up = taller, drag down = shorter).
    // Releasing below DISMISS_HEIGHT_PX or with a fast downward flick dismisses.
    const bindHeaderDrag = useDrag(
        ({ first, last, movement: [, my], velocity: [, vy] }) => {
            if (first) {
                dragStartHeightRef.current = sheetHeightRef.current ?? 0;
            }

            const maxH = parentHeightRef.current * 0.92;
            // Positive my = dragged down → sheet shrinks; negative = dragged up → grows.
            const newH = dragStartHeightRef.current - my;
            const clampedH = Math.max(DISMISS_HEIGHT_PX, Math.min(maxH, newH));

            if (last) {
                if (newH < DISMISS_HEIGHT_PX || (my > DISMISS_MIN_DRAG_PX && vy > DISMISS_VELOCITY_THRESHOLD)) {
                    handleClose();
                    return;
                }
                sheetHeightRef.current = clampedH;
                setSheetHeight(clampedH);
            } else {
                sheetHeightRef.current = clampedH;
                setSheetHeight(clampedH);
            }
        },
        { axis: "y", filterTaps: true }
    );

    // Tab content availability — order matches TAB_LABELS: definition, examples, breakdown
    const definitionTabHasContent = !!(
        currentEntry?.longDefinition ||
        currentEntry?.hskLevel ||
        (currentEntry?.partsOfSpeech?.length ?? 0) > 0
    );
    const examplesTabHasContent = !!(currentEntry?.exampleSentences?.length);
    const breakdownTabHasContent = breakdownItems.length > 0 || !!currentEntry?.expansion;

    const tabIsEmpty = [!definitionTabHasContent, !examplesTabHasContent, !breakdownTabHasContent];

    // Apply locked height once measured; before measurement the sheet sizes naturally
    // so offsetHeight returns the correct content height for the definition tab.
    const sheetStyle: React.CSSProperties = sheetHeight !== null ? { height: sheetHeight } : {};

    return (
        <>
            {/* Scrim — tap to close */}
            <EicScrim
                className="mobile-demo-eic-scrim"
                onClick={handleClose}
            />

            {/* Modal sheet */}
            <InfoSheetContainer
                ref={sheetContainerRef}
                className="mobile-demo-eic-sheet"
                style={sheetStyle}
            >
                {/* Draggable header zone: grabber + entry header + tab strip */}
                <Box
                    className="mobile-demo-eic-drag-zone"
                    {...bindHeaderDrag()}
                    sx={{ touchAction: "none", userSelect: "none" }}
                >
                    {/* Grabber */}
                    <Box sx={{ display: "flex", justifyContent: "center", padding: "4px 0 8px" }}>
                        <InfoSheetGrabber className="mobile-demo-drag-handle" />
                    </Box>

                    {/* Entry header: headword + English translation + audio placeholder */}
                    <InfoSheetEntryHeader className="mobile-demo-eic-header">
                        {currentEntry && (
                            <CPCDRow size="md" justifyContent="flex-start" className="mobile-demo-eic-header-cpcd">
                                {[...currentEntry.entryKey].map((char, i) => (
                                    <CharacterPinyinColorDisplay
                                        key={i}
                                        character={char}
                                        pinyin={currentEntry.pronunciation?.split(' ')[i] ?? ''}
                                        size="md"
                                        useToneColor={true}
                                        showPinyin={showPinyin}
                                    />
                                ))}
                            </CPCDRow>
                        )}
                        {currentEntry && (
                            <Typography
                                className="mobile-demo-eic-header-english"
                                sx={{
                                    fontSize: 15,
                                    fontWeight: 500,
                                    color: fc.onSurface,
                                    fontFamily: '"Inter", sans-serif',
                                    lineHeight: 1.3,
                                    flex: 1,
                                    minWidth: 0,
                                }}
                            >
                                {stripParentheses(currentEntry.entryValue)}
                            </Typography>
                        )}
                        {/* Audio button — visual placeholder */}
                        <Box
                            className="mobile-demo-eic-audio-btn"
                            sx={{
                                width: 34,
                                height: 34,
                                borderRadius: 34,
                                background: fc.audioBtn,
                                border: "none",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                flexShrink: 0,
                                cursor: "pointer",
                            }}
                        >
                            <Typography sx={{ fontSize: 12, color: fc.onSurface, lineHeight: 1, ml: "2px" }}>▶</Typography>
                        </Box>
                    </InfoSheetEntryHeader>

                    {/* Underline tab strip */}
                    <InfoSheetTabStrip className="mobile-demo-tabs">
                        {TAB_LABELS.map((label, index) => (
                            <InfoSheetTab
                                key={index}
                                isActive={selectedTab === index}
                                isEmpty={tabIsEmpty[index]}
                                // Stop propagation so tab taps don't register as drag starts.
                                onClick={(e: React.MouseEvent) => {
                                    e.stopPropagation();
                                    if (!tabIsEmpty[index]) onTabChange(index);
                                }}
                                className={`mobile-demo-tab mobile-demo-tab-${label}`}
                            >
                                <Typography sx={{
                                    fontSize: 12,
                                    fontWeight: selectedTab === index ? 700 : 500,
                                    color: selectedTab === index ? fc.onSurface : fc.textSecondary,
                                    fontFamily: '"Inter", sans-serif',
                                    userSelect: "none",
                                    textTransform: "capitalize",
                                    lineHeight: 1,
                                }}>
                                    {label.charAt(0).toUpperCase() + label.slice(1)}
                                </Typography>
                            </InfoSheetTab>
                        ))}
                    </InfoSheetTabStrip>
                </Box>

                {/* Scrollable tab body — touchAction pan-y so native scroll works here */}
                <Box
                    className="mobile-demo-eic-scroll"
                    sx={{
                        flex: 1,
                        minHeight: 0,
                        overflow: "auto",
                        padding: "16px 18px 8px",
                        overscrollBehavior: "contain",
                        touchAction: "pan-y",
                    }}
                >
                    {/* Tab 0: Definition */}
                    {selectedTab === 0 && definitionTabHasContent ? (
                        <Box className="mobile-demo-definition-wrapper" sx={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                            {currentEntry?.longDefinition && (
                                <Typography
                                    className="mobile-demo-long-definition-text"
                                    sx={{
                                        fontSize: 14,
                                        color: fc.onSurface,
                                        fontFamily: '"Inter", sans-serif',
                                        lineHeight: 1.6,
                                    }}
                                >
                                    {stripParentheses(currentEntry.longDefinition)}
                                </Typography>
                            )}
                            {(currentEntry?.hskLevel || (currentEntry?.partsOfSpeech?.length ?? 0) > 0) && (
                                <Box
                                    className="mobile-demo-definition-meta-strip"
                                    sx={{
                                        display: "flex",
                                        gap: "18px",
                                        alignItems: "center",
                                        padding: "10px 0",
                                        borderTop: `1px solid ${fc.border}`,
                                        borderBottom: `1px solid ${fc.border}`,
                                    }}
                                >
                                    {currentEntry?.hskLevel && (
                                        <Box sx={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                                            <Typography sx={{ fontSize: 9, fontWeight: 700, color: fc.textSecondary, letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: '"Inter", sans-serif' }}>
                                                HSK
                                            </Typography>
                                            <Typography sx={{ fontSize: 13, fontWeight: 600, color: fc.onSurface, fontFamily: '"Inter", sans-serif' }}>
                                                {currentEntry.hskLevel.replace(/^HSK/, 'HSK ')}
                                            </Typography>
                                        </Box>
                                    )}
                                    {(currentEntry?.partsOfSpeech?.length ?? 0) > 0 && (
                                        <Box sx={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                                            <Typography sx={{ fontSize: 9, fontWeight: 700, color: fc.textSecondary, letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: '"Inter", sans-serif' }}>
                                                Type
                                            </Typography>
                                            <Typography sx={{ fontSize: 13, fontWeight: 600, color: fc.onSurface, fontFamily: '"Inter", sans-serif' }}>
                                                {currentEntry!.partsOfSpeech!.join(', ')}
                                            </Typography>
                                        </Box>
                                    )}
                                </Box>
                            )}
                        </Box>
                    ) : selectedTab === 0 ? (
                        <Box className="mobile-demo-tab-empty" sx={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 2 }}>
                            <Typography sx={{ fontSize: 14, color: fc.textSecondary, textAlign: "center", fontFamily: '"Inter", sans-serif' }}>
                                No definition available for this card
                            </Typography>
                        </Box>
                    ) : null}

                    {/* Tab 1: Examples */}
                    {selectedTab === 1 && examplesTabHasContent ? (
                        <Box className="mobile-demo-sentences-list" sx={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                            {currentEntry!.exampleSentences!.map((sentence, index) => (
                                <Box
                                    key={index}
                                    className="mobile-demo-sentence-item"
                                    sx={{
                                        background: fc.subtleBg,
                                        borderRadius: "10px",
                                        padding: "12px 14px",
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: "8px",
                                    }}
                                >
                                    <SegmentedSentenceDisplay
                                        sentence={sentence}
                                        size="sm"
                                        flexWrap="wrap"
                                        showPinyin={showPinyin}
                                        showSegmentSpaces={showSegmentSpaces}
                                        vocabWord={currentEntry?.entryKey}
                                    />
                                    <Typography className="mobile-demo-sentence-english" sx={{ fontSize: 12, color: fc.textSecondary, fontFamily: '"Inter", sans-serif', lineHeight: 1.4 }}>
                                        {renderEnglishWithVocabUnderline(sentence.english, sentence.translatedVocab)}
                                    </Typography>
                                </Box>
                            ))}
                        </Box>
                    ) : selectedTab === 1 ? (
                        <Box className="mobile-demo-tab-empty" sx={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 2 }}>
                            <Typography sx={{ fontSize: 14, color: fc.textSecondary, textAlign: "center", fontFamily: '"Inter", sans-serif' }}>
                                No example sentences available
                            </Typography>
                        </Box>
                    ) : null}

                    {/* Tab 2: Breakdown */}
                    {selectedTab === 2 && breakdownTabHasContent ? (
                        <Box className="mobile-demo-breakdown-wrapper" sx={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                            <Box sx={{ display: "flex", flexDirection: "column" }}>
                                {breakdownItems.map((item, index) => (
                                    <Box
                                        key={index}
                                        className="mobile-demo-breakdown-row"
                                        sx={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "14px",
                                            padding: "10px 4px",
                                            borderBottom: index < breakdownItems.length - 1
                                                ? `1px solid ${fc.border}`
                                                : "none",
                                        }}
                                    >
                                        <CharacterPinyinColorDisplay
                                            character={item.character}
                                            pinyin={item.pinyin}
                                            size="md"
                                            useToneColor={true}
                                            showPinyin={showPinyin}
                                        />
                                        <Typography sx={{ fontSize: 14, color: fc.onSurface, flex: 1, fontFamily: '"Inter", sans-serif' }}>
                                            {item.definition}
                                        </Typography>
                                        <Typography sx={{ fontSize: 14, color: fc.textSecondary, flexShrink: 0 }}>›</Typography>
                                    </Box>
                                ))}
                            </Box>
                            {currentEntry?.expansion && (
                                <Box
                                    className="mobile-demo-expansion-section"
                                    sx={{
                                        background: fc.subtleBg,
                                        borderRadius: "10px",
                                        padding: "12px 14px",
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: "8px",
                                    }}
                                >
                                    <SharedCharsLabel className="mobile-demo-expansion-label">
                                        Expanded Form
                                    </SharedCharsLabel>
                                    <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
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
                                            showSegmentSpaces={showSegmentSpaces}
                                        />
                                        {currentEntry.expansionLiteralTranslation && isFlipped && (
                                            <Typography sx={{
                                                fontSize: 11,
                                                color: fc.textSecondary,
                                                fontFamily: '"Inter", sans-serif',
                                                fontStyle: "italic",
                                                textAlign: "center",
                                                lineHeight: 1.4,
                                            }}>
                                                "{stripParentheses(currentEntry.expansionLiteralTranslation)}"
                                            </Typography>
                                        )}
                                    </Box>
                                </Box>
                            )}
                        </Box>
                    ) : selectedTab === 2 ? (
                        <Box className="mobile-demo-tab-empty" sx={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 2 }}>
                            <Typography sx={{ fontSize: 14, color: fc.textSecondary, textAlign: "center", fontFamily: '"Inter", sans-serif' }}>
                                Breakdown not available for this card
                            </Typography>
                        </Box>
                    ) : null}
                </Box>
            </InfoSheetContainer>
        </>
    );
};

export default InfoCardSection;
