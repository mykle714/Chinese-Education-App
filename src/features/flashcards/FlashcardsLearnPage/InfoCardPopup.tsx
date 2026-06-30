import { useCallback } from "react";
import { Box, useTheme } from "@mui/material";
import { EicScrim } from "./styled";
import InfoCardPanelBody from "./InfoCardPanelBody";
import type { VocabEntry, BreakdownItem, UsedInItem } from "./types";

export interface InfoCardPopupProps {
    currentEntry: VocabEntry | null;
    selectedTab: number;
    onTabChange: (tab: number) => void;
    breakdownItems: BreakdownItem[];
    showPinyin: boolean;
    showSegmentSpaces?: boolean;
    isFlipped: boolean;
    onClose: () => void;
    onBreakdownItemClick?: (item: BreakdownItem) => void;
    onUsedInItemClick?: (item: UsedInItem) => void;
    onSpeak?: (entry: VocabEntry) => void;
    onAddToLibrary?: (entry: VocabEntry) => void;
    onSpeakSentence?: (text: string, pronunciation?: string) => void;
    speakingKey?: string | null;
    // Optional content slot rendered above the panel body. Used by the entry-tabs
    // feature (see EipTabStrip + useEipTabs).
    tabStrip?: React.ReactNode;
}

/**
 * Popup-form sibling of InfoCardSection. Shares the entire panel body
 * (header + tabs + tab content) via InfoCardPanelBody so any visual or
 * data change to the panel automatically reflects here. The wrapping
 * container is the only difference: a centered card with a scrim that
 * dismisses on outside click, and no drag/snap/wheel scroll-resize
 * mechanics. The body uses native overflow inside a bounded card.
 */
function InfoCardPopup({
    currentEntry,
    selectedTab,
    onTabChange,
    breakdownItems,
    showPinyin,
    showSegmentSpaces,
    isFlipped,
    onClose,
    onBreakdownItemClick,
    onUsedInItemClick,
    onSpeak,
    onAddToLibrary,
    onSpeakSentence,
    speakingKey,
    tabStrip,
}: InfoCardPopupProps) {
    const theme = useTheme();
    const fc = theme.palette.flashcard;

    // Stop card-internal clicks from bubbling to the scrim's dismiss handler.
    const stopPropagation = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
    }, []);

    return (
        <>
            {/* Scrim — tap anywhere outside the card to close */}
            <EicScrim
                className="info-card-popup-scrim"
                onClick={onClose}
            />

            {/* Centered popup card. Bounded so the body can scroll natively
                when content overflows. */}
            <Box
                className="info-card-popup"
                onClick={stopPropagation}
                sx={{
                    position: "absolute",
                    top: "50%",
                    left: "50%",
                    transform: "translate(-50%, -50%)",
                    width: "min(92%, 420px)",
                    maxHeight: "80%",
                    background: fc.background,
                    borderRadius: "16px",
                    boxShadow: fc.sheetShadow,
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                    zIndex: 11,
                }}
            >
                {tabStrip}
                <InfoCardPanelBody
                    currentEntry={currentEntry}
                    selectedTab={selectedTab}
                    onTabChange={onTabChange}
                    breakdownItems={breakdownItems}
                    showPinyin={showPinyin}
                    showSegmentSpaces={showSegmentSpaces}
                    isFlipped={isFlipped}
                    onBreakdownItemClick={onBreakdownItemClick}
                    onUsedInItemClick={onUsedInItemClick}
                    onSpeak={onSpeak}
                    onAddToLibrary={onAddToLibrary}
                    onSpeakSentence={onSpeakSentence}
                    speakingKey={speakingKey}
                    // Tighter headword in the centered popup than the bottom-sheet EIP.
                    headerCpcdSize="sm"
                />
            </Box>
        </>
    );
}

export default InfoCardPopup;
