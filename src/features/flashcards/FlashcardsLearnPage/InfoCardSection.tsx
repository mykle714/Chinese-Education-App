import { useRef, useEffect, forwardRef } from "react";
import { Box } from "@mui/material";
import SheetPanel, { type SheetPanelHandle } from "../../../components/sheet/SheetPanel";
import InfoCardPanelBody, { type InfoCardPanelBodyHandle } from "./InfoCardPanelBody";
import CompareWorkspace from "../../../components/CompareWorkspace";
import type { VocabEntry, BreakdownItem, UsedInItem } from "../types";
import type { CompareEipTab } from "./useEipTabs";
import type { LongDefinitionPart } from "../../../types";

interface InfoCardSectionProps {
    currentEntry: VocabEntry | null;
    selectedTab: number;
    onTabChange: (tab: number) => void;
    breakdownItems: BreakdownItem[];
    showPinyin: boolean;
    showPinyinColor?: boolean;
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
    // Compare tab (docs/WORD_COMPARE_FEATURE.md). `compareTab` set ⇒ the panel renders
    // CompareWorkspace instead of InfoCardPanelBody's normal definition/examples/breakdown
    // content — the Compare tab has no entry/breakdown/sub-tab of its own.
    //
    // There is no `onOpenCompare` here any more: the panel no longer OPENS the Compare
    // tab, it only hosts it. The entry point is `WordToolsRail` on the page above the
    // card (artboards 19–25), because comparing is something you do with the WORD and
    // the panel is information-only. The flp still owns the tab itself.
    compareTab?: CompareEipTab | null;
    onSetCompareSlot?: (slot: "A" | "B", entry: VocabEntry | null) => void;
    onCompareResult?: (comparison: string | null, comparisonParts?: LongDefinitionPart[] | null) => void;
    // The definitionClusters sense the panel is showing, and the header picker's
    // callback (docs/DEFINITION_CLUSTERS.md). Owned by the host page's useEipTabs so the
    // pick survives entry-tab switches; the host also persists it to the vet row.
    selectedSenseIndex?: number;
    onSelectSense?: (index: number) => void;
    // Optional content slot rendered above the grabber. Used by the entry-tabs
    // feature (see EipTabStrip + useEipTabs) — undefined renders nothing extra.
    tabStrip?: React.ReactNode;
    // What the sheet's ✕ does. Hosts WITH a word trail pass the trail's rule (close the
    // showing word; return false on the last one so SheetPanel dismisses); the cdp, which
    // has no trail, passes nothing and the ✕ just closes the panel. See SheetPanel.
    onCloseX?: () => boolean | void;
    // Draw the minute-points flame beside the ✕. True on every STUDY surface that mounts
    // this panel (flp, scp, cdp) — the panel covers the page header, flame included.
    showMinutePoints?: boolean;
    // Identity + strip position of the ACTIVE entry tab (useEipTabs: `activeTab.id` /
    // `activeIndex`). Only used to drive the pager slide below — a change of id means the
    // panel is now showing a DIFFERENT word, and the sign of the index delta says which
    // way the trail moved. Undefined (cdp, which has no trail) disables the animation.
    entryTabId?: string;
    entryTabIndex?: number;
    // Appends Synonyms + Related Words to the definition tab. Passed by the cdp only,
    // which uses this panel as its whole extra-info body and would otherwise lose the
    // two lists its old stacked-SectionCard body showed (see InfoCardTabContent).
    showSynonymsRelated?: boolean;
}

// Entry-tab pager slide (see the effect in the component). Duration/easing match
// TAB_SWIPE_TRANSITION so the two horizontal motions in this panel — sub-tab track and
// entry pager — feel like the same gesture at two scales.
const ENTRY_SLIDE_TRAVEL_PCT = 34;
const ENTRY_SLIDE_MS = 280;
const ENTRY_SLIDE_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

// Re-export the handle under the original name so callers don't need to update.
export type InfoCardSectionHandle = SheetPanelHandle;

const InfoCardSection = forwardRef<InfoCardSectionHandle, InfoCardSectionProps>(({
    currentEntry,
    selectedTab,
    onTabChange,
    breakdownItems,
    showPinyin,
    showPinyinColor = true,
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
    compareTab,
    onSetCompareSlot,
    onCompareResult,
    selectedSenseIndex,
    onSelectSense,
    tabStrip,
    onCloseX,
    showMinutePoints,
    entryTabId,
    entryTabIndex,
    showSynonymsRelated,
}, ref) => {
    const panelRef = useRef<InfoCardPanelBodyHandle | null>(null);
    const slideRef = useRef<HTMLDivElement | null>(null);
    // Last (id, index) we animated FROM. Held in a ref rather than state: nothing renders
    // from it, and writing it during the effect keeps the comparison to exactly one place.
    const prevEntryTabRef = useRef<{ id: string | undefined; index: number } | null>(null);

    // PAGER SLIDE between entry tabs (the word trail). Drilling into a link pushes a new
    // pill and shows its panel; before this, the only motion was the sub-tab track sliding
    // BACK to Definitions (the new tab starts on sub-tab 0), which read as "we went
    // backwards" when we had in fact gone forwards to another word. So: the sub-tab track
    // now jumps silently on an entry change (see InfoCardPanelBody), and the whole panel
    // body slides in from the side the trail grew towards instead.
    //
    // Imperative (WAAPI) and NOT keyed remount: remounting the body would tear down the
    // three always-mounted tab panes, re-bind SheetPanel's scroll coupling, and throw away
    // per-pane scroll — the exact mount/unmount churn InfoCardPanelBody's track comment
    // warns about. Animating the existing element costs one composited transform.
    //
    // Enter-only (the outgoing word's panel is already gone by the time we run, since one
    // body serves every tab), so the travel is a fraction of the panel width rather than a
    // full page: a full 100% with nothing leaving beside it reads as a glitch.
    useEffect(() => {
        const prev = prevEntryTabRef.current;
        prevEntryTabRef.current = { id: entryTabId, index: entryTabIndex ?? 0 };
        // First render, or a host that doesn't use entry tabs at all: nothing to animate.
        if (!prev || entryTabId === undefined || prev.id === entryTabId) return;
        const el = slideRef.current;
        if (!el) return;

        // Trail order decides the direction: a pushed tab is appended, so a drill-in always
        // enters from the right; tapping a pill to the left of the current one enters from
        // the left, matching the direction the eye just travelled.
        const dir = (entryTabIndex ?? 0) >= prev.index ? 1 : -1;
        // Clip only for the duration of the slide: leaving overflow hidden permanently
        // would cut off anything the panel legitimately overhangs with (menus/popovers).
        el.style.overflow = "hidden";
        const anim = el.animate(
            [
                { transform: `translateX(${dir * ENTRY_SLIDE_TRAVEL_PCT}%)`, opacity: 0 },
                { transform: "translateX(0)", opacity: 1 },
            ],
            { duration: ENTRY_SLIDE_MS, easing: ENTRY_SLIDE_EASING },
        );
        const clearClip = () => { el.style.overflow = ""; };
        anim.addEventListener("finish", clearClip);
        anim.addEventListener("cancel", clearClip);
        // A second drill-in mid-slide cancels the first, which fires `cancel` → clip cleared.
        return () => anim.cancel();
    }, [entryTabId, entryTabIndex]);

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
            onCloseX={onCloseX}
            showMinutePoints={showMinutePoints}
            // Title for the panel header, which is up at every height (SheetPanel) and
            // carries the ✕. Named for the ENTRY POINT rather than the word on
            // screen — the pill that opens it says "More Info", and the entry header
            // right below already carries the headword, so repeating it would be the
            // only thing on screen twice.
            title={compareTab ? "Compare" : "More Info"}
        >
            {({ bindHeaderDrag }) => (
                // Slide wrapper for the entry-tab pager (see the effect above). Transparent
                // to layout: it repeats the body's own flex sizing so the panel measures and
                // scrolls exactly as it did before.
                <Box
                    ref={slideRef}
                    className="eip-entry-slide"
                    sx={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
                >
                {compareTab ? (
                    <CompareWorkspace
                        ref={panelRef}
                        state={compareTab}
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
                        isFlipped={isFlipped}
                        onBreakdownItemClick={onBreakdownItemClick}
                        onUsedInItemClick={onUsedInItemClick}
                        onExampleSegmentClick={onExampleSegmentClick}
                        onSpeak={onSpeak}
                        onSpeakSentence={onSpeakSentence}
                        speakingKey={speakingKey}
                        onAddToLibrary={onAddToLibrary}
                        selectedSenseIndex={selectedSenseIndex}
                        onSelectSense={onSelectSense}
                        showSynonymsRelated={showSynonymsRelated}
                        // `pan-y`, NOT `none`. SheetPanel decides between growing the sheet
                        // and scrolling the pane on the gesture's first committed move, and
                        // it expresses "scroll" by NOT calling preventDefault — the browser
                        // pans the pane natively. With `none` the browser refuses that pan
                        // and nothing scrolls once the sheet is at max height (the est tab,
                        // the only pane tall enough to notice, just froze). Horizontal is
                        // still ours: `pan-y` leaves the tab-swipe free to preventDefault.
                        scrollTouchAction="pan-y"
                        headerDragBind={bindHeaderDrag}
                    />
                )}
                </Box>
            )}
        </SheetPanel>
    );
});

InfoCardSection.displayName = "InfoCardSection";

export default InfoCardSection;
