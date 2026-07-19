import { useRef, forwardRef } from "react";
import SheetPanel, { type SheetPanelHandle } from "./SheetPanel";
import InfoCardPanelBody, { type InfoCardPanelBodyHandle } from "./InfoCardPanelBody";
import CompareTabBody from "./CompareTabBody";
import type { VocabEntry, BreakdownItem, UsedInItem } from "./types";
import type { CompareEipTab } from "./useEipTabs";
import type { LongDefinitionPart } from "../../../types";

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
    // Renders the header's "Add to Learn Now" (+) button in the 2×2 action grid,
    // gated on `currentEntry.discoverable`. Wired by the flp so drilled-in words
    // (breakdown chars / example segments) that aren't yet in the library can be
    // added; undefined hides the button (see InfoCardPanelBody).
    onAddToLibrary?: (entry: VocabEntry) => void;
    // Compare tab (docs/WORD_COMPARE_FEATURE.md). `onOpenCompare` renders the header's Compare
    // button (undefined hides it). `compareTab` set ⇒ the panel renders CompareTabBody instead of
    // InfoCardPanelBody's normal definition/examples/breakdown content — the Compare tab has no
    // entry/breakdown/sub-tab of its own.
    onOpenCompare?: (entry: VocabEntry) => void;
    compareTab?: CompareEipTab | null;
    onSetCompareSlot?: (slot: "A" | "B", entry: VocabEntry | null) => void;
    onCompareResult?: (comparison: string | null, comparisonParts?: LongDefinitionPart[] | null) => void;
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
    onAddToLibrary,
    onOpenCompare,
    compareTab,
    onSetCompareSlot,
    onCompareResult,
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
            // Fold selectedTab into the key: InfoCardPanelBody's scrollable
            // element is the ACTIVE tab's pane (each pane scrolls on its own),
            // and SheetPanel captures the scroll element once per bodyKey — so
            // every tab change must re-bind the scroll/resize coupling.
            bodyKey={compareTab ? "compare" : `info-${selectedTab}`}
            tabStrip={tabStrip}
        >
            {({ bindHeaderDrag }) => (
                compareTab ? (
                    <CompareTabBody
                        ref={panelRef}
                        tab={compareTab}
                        onSetSlot={onSetCompareSlot ?? (() => {})}
                        onResult={onCompareResult ?? (() => {})}
                        showPinyin={showPinyin}
                        showPinyinColor={showPinyinColor}
                        onSegmentOpen={onExampleSegmentClick}
                    />
                ) : (
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
                        onAddToLibrary={onAddToLibrary}
                        onOpenCompare={onOpenCompare}
                        scrollTouchAction="none"
                        headerDragBind={bindHeaderDrag}
                    />
                )
            )}
        </SheetPanel>
    );
});

InfoCardSection.displayName = "InfoCardSection";

export default InfoCardSection;
