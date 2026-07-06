import { useRef, forwardRef } from "react";
import SheetPanel, { type SheetPanelHandle } from "./SheetPanel";
import InfoCardPanelBody, { type InfoCardPanelBodyHandle } from "./InfoCardPanelBody";
import type { VocabEntry, BreakdownItem, UsedInItem } from "./types";

interface InfoCardSectionProps {
    currentEntry: VocabEntry | null;
    selectedTab: number;
    onTabChange: (tab: number) => void;
    breakdownItems: BreakdownItem[];
    showPinyin: boolean;
    showPinyinColor?: boolean;
    showSegmentSpaces?: boolean;
    isFlipped: boolean;
    onClose: () => void;
    initialHeight?: number | null;
    onBreakdownItemClick?: (item: BreakdownItem) => void;
    onUsedInItemClick?: (item: UsedInItem) => void;
    onExampleSegmentClick?: (segment: string) => void;
    depth?: number;
    onSpeak?: (entry: VocabEntry) => void;
    onSpeakSentence?: (text: string, pronunciation?: string) => void;
    speakingKey?: string | null;
    // Optional content slot rendered above the grabber. Used by the entry-tabs
    // feature (see EipTabStrip + useEipTabs) — undefined renders nothing extra.
    tabStrip?: React.ReactNode;
}

// Re-export the handle under the original name so callers don't need to update.
export type InfoCardSectionHandle = SheetPanelHandle;

const InfoCardSection = forwardRef<InfoCardSectionHandle, InfoCardSectionProps>(({
    currentEntry,
    selectedTab,
    onTabChange,
    breakdownItems,
    showPinyin,
    showPinyinColor = true,
    showSegmentSpaces = false,
    isFlipped,
    onClose,
    initialHeight,
    onBreakdownItemClick,
    onUsedInItemClick,
    onExampleSegmentClick,
    depth = 0,
    onSpeak,
    onSpeakSentence,
    speakingKey,
    tabStrip,
}, ref) => {
    const panelRef = useRef<InfoCardPanelBodyHandle | null>(null);
    return (
        <SheetPanel
            ref={ref}
            onClose={onClose}
            depth={depth}
            initialHeight={initialHeight}
            bodyRef={panelRef}
            tabStrip={tabStrip}
        >
            {({ bindHeaderDrag }) => (
                <InfoCardPanelBody
                    ref={panelRef}
                    currentEntry={currentEntry}
                    selectedTab={selectedTab}
                    onTabChange={onTabChange}
                    breakdownItems={breakdownItems}
                    showPinyin={showPinyin}
                    showPinyinColor={showPinyinColor}
                    showSegmentSpaces={showSegmentSpaces}
                    isFlipped={isFlipped}
                    onBreakdownItemClick={onBreakdownItemClick}
                    onUsedInItemClick={onUsedInItemClick}
                    onExampleSegmentClick={onExampleSegmentClick}
                    onSpeak={onSpeak}
                    onSpeakSentence={onSpeakSentence}
                    speakingKey={speakingKey}
                    scrollTouchAction="none"
                    headerDragBind={bindHeaderDrag}
                />
            )}
        </SheetPanel>
    );
});

InfoCardSection.displayName = "InfoCardSection";

export default InfoCardSection;
