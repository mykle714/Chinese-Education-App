import React, { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { Box, IconButton, Typography, useTheme } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { stripParentheses } from "../../utils/definitionUtils";
import ForeignText from "../../components/ForeignText";
import PosBadge from "../../components/PosBadge";
import SegmentedSentenceDisplay from "../../components/SegmentedSentenceDisplay";
import InfoCardListRow from "./InfoCardListRow";
import {
    InfoSheetEntryHeader,
    InfoSheetTabStrip,
    InfoSheetTab,
    SharedCharsLabel,
} from "./styled";
import { TAB_LABELS, FC_FONT } from "./constants";
import { SpeakerButton } from "./FlashCardSection";
import { buildSentencePronunciation } from "./sentencePronunciation";
import type { VocabEntry, BreakdownItem, UsedInItem } from "./types";

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

export interface InfoCardPanelBodyProps {
    currentEntry: VocabEntry | null;
    selectedTab: number;
    onTabChange: (tab: number) => void;
    breakdownItems: BreakdownItem[];
    showPinyin: boolean;
    showPinyinColor?: boolean;
    showSegmentSpaces?: boolean;
    isFlipped: boolean;
    onBreakdownItemClick?: (item: BreakdownItem) => void;
    onUsedInItemClick?: (item: UsedInItem) => void;
    onSpeak?: (entry: VocabEntry) => void;
    // When provided, renders a "+" button immediately after the SpeakerButton
    // in the entry header. Used only by the dictionary EIP — flashcards EIP
    // omits it because those cards are already in the library by definition.
    onAddToLibrary?: (entry: VocabEntry) => void;
    // Speaker callback for an example sentence. When provided, each sentence
    // block in the Examples tab renders a SpeakerButton in its top-right
    // corner. Undefined hides the buttons (TTS disabled in settings).
    onSpeakSentence?: (text: string, pronunciation?: string) => void;
    // Text currently being narrated by useTTS, or null when idle. The header
    // speaker spins when it matches the current entry; each sentence speaker
    // spins when it matches that sentence's Chinese text.
    speakingKey?: string | null;
    // The scrollable content area's touchAction. Bottom-sheet variant sets
    // "none" so it can route touchmove between sheet-resize and content-scroll;
    // popup variant leaves it "auto" for native scrolling.
    scrollTouchAction?: React.CSSProperties["touchAction"];
    // When provided, the props returned by this call are spread onto the entry
    // header so it shares the grabber's drag-to-resize gesture. useDrag's
    // filterTaps keeps icon taps (speaker, +, etc.) working normally.
    headerDragBind?: () => Record<string, unknown>;
}

// Imperative handle exposing the two elements the bottom-sheet wrapper needs:
// `root` is the gesture target (covers header + tabs + scroll body so swipes
// anywhere on the panel feed the resize/scroll coupling), and `scroll` is the
// inner overflow:auto container whose `scrollTop` decides between resize and
// content scroll.
export interface InfoCardPanelBodyHandle {
    root: HTMLDivElement | null;
    scroll: HTMLDivElement | null;
}

/**
 * Shared inner content of the EIP: entry header (CPCD + English + speaker),
 * underline tab strip, and the scrollable tab body (definition / examples /
 * breakdown-or-used-in). Reused by InfoCardSection (bottom-sheet wrapper)
 * and InfoCardPopup (centered-popup wrapper) — anything that changes here
 * shows up in both variants.
 *
 * The forwarded ref exposes both the gesture-root wrapper and the inner
 * scrollable Box so wrappers that need to hook scroll mechanics (sheet does)
 * can attach listeners to the whole panel while still querying scrollTop on
 * the actual overflow container.
 */
const InfoCardPanelBody = forwardRef<InfoCardPanelBodyHandle, InfoCardPanelBodyProps>(function InfoCardPanelBody({
    currentEntry,
    selectedTab,
    onTabChange,
    breakdownItems,
    showPinyin,
    showPinyinColor = true,
    showSegmentSpaces = false,
    isFlipped,
    onBreakdownItemClick,
    onUsedInItemClick,
    onSpeak,
    onAddToLibrary,
    onSpeakSentence,
    speakingKey,
    scrollTouchAction = "auto",
    headerDragBind,
}, ref) {
    const rootRef = useRef<HTMLDivElement | null>(null);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    useImperativeHandle(ref, () => ({
        get root() { return rootRef.current; },
        get scroll() { return scrollRef.current; },
    }), []);

    // First-frame measurement override: SheetPanel measures our offsetHeight in
    // its own useLayoutEffect on mount and uses that as the open-animation
    // target. To make the panel always open to the Definitions tab's natural
    // height — regardless of which tab the user last left selected — we render
    // the Definitions tab on the very first paint, then flip to the user's
    // actual selectedTab on the next animation frame. SheetPanel pins the
    // panel to the measured height via an inline style after that, so swapping
    // tab content after measurement does not resize the panel.
    const [hasMeasured, setHasMeasured] = useState(false);
    useLayoutEffect(() => {
        const raf = requestAnimationFrame(() => setHasMeasured(true));
        return () => cancelAnimationFrame(raf);
    }, []);
    const effectiveTab = hasMeasured ? selectedTab : 0;

    const theme = useTheme();
    const fc = theme.palette.flashcard;

    // Tab content availability — order matches TAB_LABELS: definition, examples, breakdown
    const definitionTabHasContent = !!(
        currentEntry?.longDefinition ||
        currentEntry?.hskLevel ||
        (currentEntry?.partsOfSpeech?.length ?? 0) > 0
    );
    const examplesTabHasContent = !!(currentEntry?.exampleSentences?.length);
    // Single-char zh cards swap the breakdown tab for a "used in" list (see usedIn enrichment in OnDeckVocabService).
    const isSingleChar = !!currentEntry && [...currentEntry.entryKey].length === 1;
    const usedInItems: UsedInItem[] = (isSingleChar && currentEntry?.usedIn) ? currentEntry.usedIn : [];
    const breakdownTabHasContent = isSingleChar
        ? (usedInItems.length > 0 || !!currentEntry?.expansion)
        : (breakdownItems.length > 0 || !!currentEntry?.expansion);
    const breakdownTabLabel = isSingleChar ? "used in" : TAB_LABELS[2];

    const tabIsEmpty = [!definitionTabHasContent, !examplesTabHasContent, !breakdownTabHasContent];

    return (
        <Box
            ref={rootRef}
            className="mobile-demo-eic-panel-body"
            sx={{
                display: "flex",
                flexDirection: "column",
                flex: 1,
                minHeight: 0,
                // Mirrored on the inner scroll box too — touch-action doesn't
                // inherit, but setting it here ensures the browser doesn't
                // pre-commit native scroll/zoom on touches that start over the
                // header or tab strip before our gesture listener can react.
                touchAction: scrollTouchAction,
                // Non-CPCD text within the EIP is unselectable. CPCD chars/pinyin
                // remain selectable so users can copy individual characters.
                userSelect: "none",
                WebkitUserSelect: "none",
                // CPCD char + pinyin cells live as siblings under cpcd-row, so we
                // re-enable selection on anything with a cpcd-row__ or
                // char-pinyin-display class (and their descendants).
                "& [class*='cpcd-row__'], & [class*='cpcd-row__'] *, & [class*='char-pinyin-display'], & [class*='char-pinyin-display'] *": {
                    userSelect: "text",
                    WebkitUserSelect: "text",
                },
            }}
        >
            {/* Entry header: headword + English translation + speaker icon.
                When the bottom-sheet wrapper passes headerDragBind, this row
                also acts as a drag-to-resize handle (useDrag's filterTaps keeps
                taps on speaker/+ icons working). */}
            <InfoSheetEntryHeader
                className="mobile-demo-eic-header"
                {...(headerDragBind ? headerDragBind() : {})}
                sx={headerDragBind ? { touchAction: "none", cursor: "grab" } : undefined}
            >
                {currentEntry && (
                    <ForeignText
                        size="md"
                        justifyContent="flex-start"
                        className="mobile-demo-eic-header-cpcd"
                        text={currentEntry.entryKey}
                        pronunciation={currentEntry.pronunciation}
                        useToneColor={showPinyinColor}
                        showPinyin={showPinyin}
                    />
                )}
                {/* "(v)"/"(n)" badge for Spanish words with multiple discoverable POS */}
                {currentEntry && (
                    <PosBadge pos={currentEntry.pos} hasMultiplePos={currentEntry.hasMultiplePos} />
                )}
                {currentEntry && (
                    <Typography
                        className="mobile-demo-eic-header-english"
                        sx={{
                            fontSize: 15,
                            fontWeight: 500,
                            color: fc.onSurface,
                            fontFamily: FC_FONT,
                            lineHeight: 1.3,
                            flex: 1,
                            minWidth: 0,
                        }}
                    >
                        {stripParentheses(currentEntry.definition ?? '')}
                    </Typography>
                )}
                {onSpeak && currentEntry && (
                    <SpeakerButton
                        onClick={() => onSpeak(currentEntry)}
                        isLoading={speakingKey === currentEntry.entryKey}
                    />
                )}
                {onAddToLibrary && currentEntry && (
                    <IconButton
                        className="mobile-demo-eic-add-to-library"
                        size="small"
                        aria-label="Add to Learn Now"
                        onClick={(e) => {
                            // Match SpeakerButton's stop-propagation pattern so
                            // taps don't bubble to flip/drag handlers in any
                            // wrapping card.
                            e.stopPropagation();
                            onAddToLibrary(currentEntry);
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                        onTouchStart={(e) => e.stopPropagation()}
                        onTouchEnd={(e) => e.stopPropagation()}
                        sx={{
                            color: fc.textSecondary,
                            '&:hover': { color: fc.onSurface },
                        }}
                    >
                        <AddIcon fontSize="small" />
                    </IconButton>
                )}
            </InfoSheetEntryHeader>

            {/* Underline tab strip */}
            <InfoSheetTabStrip className="mobile-demo-tabs">
                {TAB_LABELS.map((label, index) => {
                    // Tab index 2 is the breakdown slot — relabeled to "Used In" for single-char zh.
                    const displayLabel = index === 2 ? breakdownTabLabel : label;
                    return (
                        <InfoSheetTab
                            key={index}
                            isActive={selectedTab === index}
                            isEmpty={tabIsEmpty[index]}
                            onClick={() => onTabChange(index)}
                            className={`mobile-demo-tab mobile-demo-tab-${displayLabel.replace(/\s+/g, '-')}`}
                        >
                            <Typography sx={{
                                fontSize: 12,
                                fontWeight: selectedTab === index ? 700 : 500,
                                color: selectedTab === index ? fc.onSurface : fc.textSecondary,
                                fontFamily: FC_FONT,
                                userSelect: "none",
                                textTransform: "capitalize",
                                lineHeight: 1,
                            }}>
                                {displayLabel.charAt(0).toUpperCase() + displayLabel.slice(1)}
                            </Typography>
                        </InfoSheetTab>
                    );
                })}
            </InfoSheetTabStrip>

            {/* Scrollable tab body */}
            <Box
                ref={scrollRef}
                className="mobile-demo-eic-scroll"
                sx={{
                    flex: 1,
                    minHeight: 0,
                    overflow: "auto",
                    padding: "16px 18px 8px",
                    overscrollBehavior: "contain",
                    touchAction: scrollTouchAction,
                }}
            >
                {/* Tab 0: Definition */}
                {effectiveTab === 0 && definitionTabHasContent ? (
                    <Box className="mobile-demo-definition-wrapper" sx={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                        {currentEntry?.longDefinition && (
                            <Typography
                                className="mobile-demo-long-definition-text"
                                sx={{
                                    fontSize: 14,
                                    color: fc.onSurface,
                                    fontFamily: FC_FONT,
                                    lineHeight: 1.6,
                                }}
                            >
                                {stripParentheses(currentEntry.longDefinition)}
                            </Typography>
                        )}
                        {(currentEntry?.hskLevel || (currentEntry?.partsOfSpeech?.length ?? 0) > 0 || currentEntry?.vernacularScore != null) && (
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
                                        <Typography sx={{ fontSize: 9, fontWeight: 700, color: fc.textSecondary, letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: FC_FONT }}>
                                            HSK
                                        </Typography>
                                        <Typography sx={{ fontSize: 13, fontWeight: 600, color: fc.onSurface, fontFamily: FC_FONT }}>
                                            {currentEntry.hskLevel.replace(/^HSK/, 'HSK ')}
                                        </Typography>
                                    </Box>
                                )}
                                {(currentEntry?.partsOfSpeech?.length ?? 0) > 0 && (
                                    <Box sx={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                                        <Typography sx={{ fontSize: 9, fontWeight: 700, color: fc.textSecondary, letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: FC_FONT }}>
                                            Type
                                        </Typography>
                                        <Typography sx={{ fontSize: 13, fontWeight: 600, color: fc.onSurface, fontFamily: FC_FONT }}>
                                            {currentEntry!.partsOfSpeech!.join(', ')}
                                        </Typography>
                                    </Box>
                                )}
                                {currentEntry?.vernacularScore != null && (
                                    <Box className="mobile-demo-vernacular-meta" sx={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                                        <Typography sx={{ fontSize: 9, fontWeight: 700, color: fc.textSecondary, letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: FC_FONT }}>
                                            Vernacular
                                        </Typography>
                                        <Box className="mobile-demo-vernacular-dots" sx={{ display: "flex", alignItems: "center", gap: "4px", height: 19 }}>
                                            {[1, 2, 3, 4, 5].map((level) => {
                                                const filled = level <= currentEntry.vernacularScore!;
                                                return (
                                                    <Box
                                                        key={level}
                                                        sx={{
                                                            width: 8,
                                                            height: 8,
                                                            borderRadius: "50%",
                                                            background: filled ? fc.onSurface : "transparent",
                                                            border: `1.5px solid ${filled ? fc.onSurface : fc.border}`,
                                                        }}
                                                    />
                                                );
                                            })}
                                        </Box>
                                    </Box>
                                )}
                            </Box>
                        )}
                    </Box>
                ) : effectiveTab === 0 ? (
                    <Box className="mobile-demo-tab-empty" sx={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 2 }}>
                        <Typography sx={{ fontSize: 14, color: fc.textSecondary, textAlign: "center", fontFamily: FC_FONT }}>
                            No definition available for this card
                        </Typography>
                    </Box>
                ) : null}

                {/* Tab 1: Examples */}
                {effectiveTab === 1 && examplesTabHasContent ? (
                    <Box className="mobile-demo-sentences-list" sx={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                        {currentEntry!.exampleSentences!.map((sentence, index) => (
                            <Box
                                key={index}
                                className="mobile-demo-sentence-item"
                                sx={{
                                    position: "relative",
                                    background: fc.subtleBg,
                                    borderRadius: "10px",
                                    padding: "12px 14px",
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: "8px",
                                }}
                            >
                                {onSpeakSentence && (
                                    // zIndex keeps the speaker above SegmentedSentenceDisplay's
                                    // position:relative root, which would otherwise paint over
                                    // (and steal clicks from) this absolutely-positioned button
                                    // because it follows in DOM order.
                                    <Box
                                        className="mobile-demo-sentence-speaker"
                                        sx={{ position: "absolute", top: 0, right: 0, zIndex: 2, padding: "4px" }}
                                    >
                                        <SpeakerButton
                                            onClick={() =>
                                                onSpeakSentence(
                                                    sentence.foreignText,
                                                    buildSentencePronunciation(sentence),
                                                )
                                            }
                                            isLoading={speakingKey === sentence.foreignText}
                                        />
                                    </Box>
                                )}
                                <SegmentedSentenceDisplay
                                    sentence={sentence}
                                    size="sm"
                                    flexWrap="wrap"
                                    showPinyin={showPinyin}
                                    showPinyinColor={showPinyinColor}
                                    showSegmentSpaces={showSegmentSpaces}
                                    vocabWord={currentEntry?.entryKey}
                                    language={currentEntry?.language}
                                />
                                <Typography className="mobile-demo-sentence-english" sx={{ fontSize: 12, color: fc.textSecondary, fontFamily: FC_FONT, lineHeight: 1.4 }}>
                                    {renderEnglishWithVocabUnderline(sentence.english, sentence.translatedVocab)}
                                </Typography>
                            </Box>
                        ))}
                    </Box>
                ) : effectiveTab === 1 ? (
                    <Box className="mobile-demo-tab-empty" sx={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 2 }}>
                        <Typography sx={{ fontSize: 14, color: fc.textSecondary, textAlign: "center", fontFamily: FC_FONT }}>
                            No example sentences available
                        </Typography>
                    </Box>
                ) : null}

                {/* Tab 2: Breakdown (multi-char) or Used In (single-char) */}
                {effectiveTab === 2 && breakdownTabHasContent ? (
                    <Box className="mobile-demo-breakdown-wrapper" sx={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                        <Box sx={{ display: "flex", flexDirection: "column" }}>
                            {isSingleChar
                                ? usedInItems.map((item, index) => (
                                    <InfoCardListRow
                                        key={index}
                                        className="mobile-demo-used-in-row-button"
                                        character={item.entryKey}
                                        pinyin={item.pronunciation ?? ""}
                                        definition={item.definition ?? ""}
                                        size="sm"
                                        showPinyin={showPinyin}
                                        showPinyinColor={showPinyinColor}
                                        isLast={index === usedInItems.length - 1}
                                        onClick={onUsedInItemClick ? () => onUsedInItemClick(item) : undefined}
                                    />
                                ))
                                : breakdownItems.map((item, index) => (
                                    <InfoCardListRow
                                        key={index}
                                        className="mobile-demo-breakdown-row-button"
                                        character={item.character}
                                        pinyin={item.pinyin}
                                        definition={item.definition}
                                        size="md"
                                        showPinyin={showPinyin}
                                        showPinyinColor={showPinyinColor}
                                        isLast={index === breakdownItems.length - 1}
                                        onClick={onBreakdownItemClick ? () => onBreakdownItemClick(item) : undefined}
                                    />
                                ))}
                        </Box>
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
                                {currentEntry?.expansion ? (
                                    <>
                                        <SegmentedSentenceDisplay
                                            sentence={{
                                                foreignText: currentEntry.expansion,
                                                _segments: currentEntry.expansionSegments ?? [...currentEntry.expansion],
                                                segmentMetadata: currentEntry.expansionMetadata ?? undefined,
                                            }}
                                            size="md"
                                            compact
                                            flexWrap="wrap"
                                            justifyContent="center"
                                            className="mobile-demo-expansion-chars"
                                            showPinyin={showPinyin}
                                            showPinyinColor={showPinyinColor}
                                            showSegmentSpaces={showSegmentSpaces}
                                        />
                                        {currentEntry.expansionLiteralTranslation && isFlipped && (
                                            <Typography sx={{
                                                fontSize: 11,
                                                color: fc.textSecondary,
                                                fontFamily: FC_FONT,
                                                fontStyle: "italic",
                                                textAlign: "center",
                                                lineHeight: 1.4,
                                            }}>
                                                "{stripParentheses(currentEntry.expansionLiteralTranslation)}"
                                            </Typography>
                                        )}
                                    </>
                                ) : (
                                    <Typography
                                        className="mobile-demo-expansion-empty"
                                        sx={{
                                            fontSize: 14,
                                            color: fc.textSecondary,
                                            textAlign: "center",
                                            fontFamily: FC_FONT,
                                        }}
                                    >
                                        No expansion available
                                    </Typography>
                                )}
                            </Box>
                        </Box>
                    </Box>
                ) : effectiveTab === 2 ? (
                    <Box className="mobile-demo-tab-empty" sx={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 2 }}>
                        <Typography sx={{ fontSize: 14, color: fc.textSecondary, textAlign: "center", fontFamily: FC_FONT }}>
                            {isSingleChar ? "No words use this character yet" : "Breakdown not available for this card"}
                        </Typography>
                    </Box>
                ) : null}
            </Box>
        </Box>
    );
});

export default InfoCardPanelBody;
