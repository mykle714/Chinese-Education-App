import { useRef, useEffect, forwardRef } from "react";
import { Box } from "@mui/material";
import SheetPanel, { type SheetPanelHandle, type SheetTelescopeHandle } from "../../../components/sheet/SheetPanel";
import type { LearningToggleState } from "../../../hooks/useLearningToggle";
import InfoCardPanelBody, { type InfoCardPanelBodyHandle } from "./InfoCardPanelBody";
import CompareWorkspace from "../../../components/CompareWorkspace";
import type { VocabEntry, BreakdownItem, UsedInItem } from "../types";
import type { CompareEipTab } from "./useEipTabs";
import type { LongDefinitionPart } from "../../../types";
import { resolveDisplayPronunciation } from "../../../utils/definitionUtils";
import EipUpperPanel from "./EipUpperPanel";
import { SpeakerButton } from "../../../components/SpeakerButton";
import EipEntryHeader from "./EipEntryHeader";
import EipAddKey from "./EipAddKey";
import { EipPaletteProvider } from "./EipPaletteContext";
import { useEipPalette } from "./useEipPalette";
import { InfoSheetGrabber } from "../../../components/sheet/sheetStyled";

interface InfoCardSectionProps {
    currentEntry: VocabEntry | null;
    selectedTab: number;
    onTabChange: (tab: number) => void;
    breakdownItems: BreakdownItem[];
    // No `showPinyin` prop: the eip is reference info and ALWAYS shows pinyin (2026-10-04).
    // A study surface's pinyin toggle (the flp chip) must never reach it.
    showPinyinColor?: boolean;
    isFlipped: boolean;
    onClose: () => void;
    initialHeight?: number | null;
    // Open height / resting stop as a fraction of the frame — forwarded to SheetPanel
    // (`defaultHeightRatio`). Omitted = SheetPanel's 0.6. The Dictionary page passes 0.8.
    defaultHeightRatio?: number;
    onBreakdownItemClick?: (item: BreakdownItem) => void;
    onUsedInItemClick?: (item: UsedInItem) => void;
    onExampleSegmentClick?: (segment: string) => void;
    depth?: number;
    onSpeak?: (entry: VocabEntry) => void;
    onSpeakSentence?: (text: string, pronunciation?: string) => void;
    speakingKey?: string | null;
    // The Learning state for the Dictionary eip's Add key (EipAddKey) — drawn in the
    // word-trail row's right end, NOT under the header speaker (the cdp's inline panel
    // keeps that placement). Today: the Dictionary page's eip, via EipSheet.
    learning?: LearningToggleState;
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
    // The definitionClusters sense the panel is showing (docs/DEFINITION_CLUSTERS.md).
    // Owned by the host page's useEipTabs, seeded from the entry's persisted pick. The
    // header only DISPLAYS it (underlined in its sense list); picks happen on the card face.
    selectedSenseIndex?: number;
    // The word trail (EipTabStrip + useEipTabs), drawn in the upper panel's trail row
    // beside the ✕. Undefined (the saved-card cdp's sheet) leaves the row with just the ✕.
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
    // Appends Synonyms + Related Words to the definition tab. Passed by the saved-card cdp
    // (which uses this panel as its whole extra-info body) and by the Dictionary page's
    // eip (via EipSheet) — see InfoCardTabContent.
    showSynonymsRelated?: boolean;
    // Content pinned to the bottom of the definition tab (InfoCardTabContent
    // `definitionFooter`). Today: the Dictionary page eip's word-tools rail, via EipSheet.
    definitionFooter?: React.ReactNode;
    // The Dictionary eip's all-definitions mode (EipSheet `showAllDefinitions`): the header
    // gloss is the whole joined list (EipEntryHeader).
    showAllDefinitions?: boolean;
    // SUPPRESSES the missing-pinyin warning (see `useMissingPinyinWarning` below). The eip
    // always shows pinyin, so a Chinese entry with none to show is presumed to be a bug in
    // the data or in what the host handed in. A host whose entries GENUINELY have no
    // pinyin must pass a reason string here — the reason documents the exception at the
    // call site. As of 2026-10-04 no host has one, so nothing passes it.
    missingPinyinReason?: string;
}

/** Han-script test, for entries whose `language` was not stamped by the read that produced them. */
const HAN_RE = /\p{Script=Han}/u;

/** entryKeys already warned about, so a re-render or reopen does not spam the console. */
const warnedMissingPinyin = new Set<string>();

/**
 * Warns (console) when the panel is about to show a Chinese entry WITHOUT pinyin. The
 * panel no longer takes a `showPinyin` flag, so the only way left is the entry resolving
 * to no pronunciation at all — a data/read-path gap (a host handing in a thin entry, a
 * det row missing `pronunciation`, a cluster reading the resolver rejected).
 * Silenced by the host's `missingPinyinReason`. Spanish (and the Compare tab) never warn.
 */
function useMissingPinyinWarning(
    entry: VocabEntry | null,
    selectedSenseIndex: number | undefined,
    suppressed: boolean,
): void {
    const entryKey = entry?.entryKey ?? null;
    const isChinese = !!entry && (entry.language ? entry.language === "zh" : HAN_RE.test(entry.entryKey ?? ""));
    const pronunciation = entry && isChinese ? resolveDisplayPronunciation(entry, selectedSenseIndex) : null;
    useEffect(() => {
        if (suppressed || !entryKey || !isChinese) return;
        if (pronunciation) return;
        if (warnedMissingPinyin.has(entryKey)) return;
        warnedMissingPinyin.add(entryKey);
        console.warn(
            `[eip] "${entryKey}" is showing no pinyin (the entry resolved to no pronunciation). The eip is reference info and ` +
            `should always show pinyin for Chinese — if this host genuinely wants it hidden, ` +
            `pass \`missingPinyinReason\` to InfoCardSection.`
        );
    }, [suppressed, entryKey, isChinese, pronunciation]);
}

// Entry-tab pager slide (see the effect in the component). Duration/easing match
// TAB_SWIPE_TRANSITION so the two horizontal motions in this panel — sub-tab track and
// entry pager — feel like the same gesture at two scales.
const ENTRY_SLIDE_TRAVEL_PCT = 34;
const ENTRY_SLIDE_MS = 280;
const ENTRY_SLIDE_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

// Where, between the open height and the max, an eip release flips from "spring back to
// the open height" to "grow to max" — forwarded to SheetPanel's `collapseThresholdRatio`.
// 0.25 = a quarter of the way up (0.6 → 0.7 of the screen at the default open height), so a
// short upward pull maximizes. SheetPanel's 0.5 midpoint made the pull up feel like it
// wasn't taking. The same line governs the way down: from max, the sheet must come below
// it before a release collapses to the open height. Docs: docs/EIP_SHEET_GESTURES.md.
const EIP_COLLAPSE_THRESHOLD_RATIO = 0.25;

// Re-export the handle under the original name so callers don't need to update.
export type InfoCardSectionHandle = SheetPanelHandle;

const InfoCardSection = forwardRef<InfoCardSectionHandle, InfoCardSectionProps>(({
    currentEntry,
    selectedTab,
    onTabChange,
    breakdownItems,
    showPinyinColor = true,
    isFlipped,
    onClose,
    initialHeight,
    defaultHeightRatio,
    onBreakdownItemClick,
    onUsedInItemClick,
    onExampleSegmentClick,
    depth = 0,
    onSpeak,
    onSpeakSentence,
    speakingKey,
    learning,
    compareTab,
    onSetCompareSlot,
    onCompareResult,
    selectedSenseIndex,
    tabStrip,
    onCloseX,
    showMinutePoints,
    entryTabId,
    entryTabIndex,
    showSynonymsRelated,
    definitionFooter,
    showAllDefinitions,
    missingPinyinReason,
}, ref) => {
    useMissingPinyinWarning(compareTab ? null : currentEntry, selectedSenseIndex, !!missingPinyinReason);
    const panelRef = useRef<InfoCardPanelBodyHandle | null>(null);
    const slideRef = useRef<HTMLDivElement | null>(null);
    // The entry header lives in the UPPER panel now (EipUpperPanel), so the pager slide
    // moves it alongside the body below — the trail row between them stays put.
    const headerSlideRef = useRef<HTMLDivElement | null>(null);
    // SheetPanel drives the upper panel's height from the sheet's (the telescope).
    const telescopeRef = useRef<SheetTelescopeHandle | null>(null);
    // The time-of-day palette (dawn / day / sunset tint, night inverts the panel).
    const palette = useEipPalette();
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
        const els = [headerSlideRef.current, slideRef.current].filter((el): el is HTMLDivElement => el !== null);
        if (els.length === 0) return;

        // Trail order decides the direction: a pushed tab is appended, so a drill-in always
        // enters from the right; tapping a pill to the left of the current one enters from
        // the left, matching the direction the eye just travelled.
        const dir = (entryTabIndex ?? 0) >= prev.index ? 1 : -1;
        // Clip only for the duration of the slide: leaving overflow hidden permanently
        // would cut off anything the panel legitimately overhangs with (menus/popovers).
        const anims = els.map((el) => {
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
            return anim;
        });
        // A second drill-in mid-slide cancels the first, which fires `cancel` → clip cleared.
        return () => anims.forEach((anim) => anim.cancel());
    }, [entryTabId, entryTabIndex]);

    return (
        <EipPaletteProvider palette={palette}>
        <SheetPanel
            ref={ref}
            onClose={onClose}
            depth={depth}
            initialHeight={initialHeight}
            defaultHeightRatio={defaultHeightRatio}
            collapseThresholdRatio={EIP_COLLAPSE_THRESHOLD_RATIO}
            bodyRef={panelRef}
            // Fold selectedTab into the key: InfoCardPanelBody's scrollable
            // element is the ACTIVE tab's pane (each pane scrolls on its own),
            // and SheetPanel captures the scroll element once per bodyKey — so
            // every tab change must re-bind the scroll/resize coupling.
            bodyKey={compareTab ? "compare" : `info-${selectedTab}`}
            // With no ✕ on the eip, `onCloseX` now drives only the Escape key (desktop):
            // Escape pops the showing word, and closes the panel from the root.
            onCloseX={onCloseX}
            // No SheetPanel title/header and no SheetPanel ✕: the eip draws its own header
            // in its upper panel (EipUpperPanel) — the title row telescopes in toward max,
            // and a down caret (SheetPanel's `dismiss`) replaces the ✕.
            showClose={false}
            telescopeRef={telescopeRef}
            surface={palette.ground}
            // No top grabber: the whole upper panel is the resize handle, and the shelf
            // below keeps its own small pill.
            showGrabber={false}
            // No sheet padding above the upper panel or below the shelf: the ground would
            // show as a band at both edges, and the telescope measures from the very top.
            edgePadding={false}
        >
            {({ bindHeaderDrag, dismiss }) => (
                <>
                <EipUpperPanel
                    ref={telescopeRef}
                    // Named for the ENTRY POINT rather than the word on screen — the pill
                    // that opens it says "More Info", and the header right below already
                    // carries the headword.
                    title={compareTab ? "Compare" : "More Info"}
                    trail={tabStrip}
                    // The speaker leads the trail row, beside the caret. The header below
                    // therefore gets no onSpeak (only the cdps' inline panels draw it there).
                    speaker={!compareTab && currentEntry && onSpeak ? (
                        <SpeakerButton
                            onClick={() => onSpeak(currentEntry)}
                            isLoading={speakingKey === currentEntry.entryKey}
                        />
                    ) : undefined}
                    addKey={learning && !compareTab ? <EipAddKey state={learning} /> : undefined}
                    header={!compareTab && currentEntry ? (
                        <Box ref={headerSlideRef} className="eip-entry-slide-header">
                            <EipEntryHeader
                                entry={currentEntry}
                                showPinyinColor={showPinyinColor}
                                selectedSenseIndex={selectedSenseIndex}
                                showAllDefinitions={showAllDefinitions}
                                glossToScreenEdge
                                // In the upper panel the band's own rhythm spaces it: no rule
                                // under it (the shelf's edge is the divide), no side padding,
                                // and no gap, so the gloss box starts at the keycap's edge.
                                sx={{ padding: "0 0 17px", borderBottom: "none", gap: 0 }}
                            />
                        </Box>
                    ) : undefined}
                    // The down caret closes the whole panel (not a pop — see EipUpperPanel).
                    onClose={dismiss}
                    showMinutePoints={showMinutePoints}
                    bindHeaderDrag={bindHeaderDrag}
                />
                {/* LOWER panel — the white SHELF (design `.tabw` + `.body`): rounded top,
                    a solid 3px `edge` lip above it, its own small grabber, then the content
                    tabs and the tab body. The sheet's ground shows in its corners. */}
                <Box
                    className="eip-shelf"
                    sx={{
                        display: "flex",
                        flexDirection: "column",
                        flex: 1,
                        minHeight: 0,
                        background: palette.shelf,
                        borderRadius: "24px 24px 0 0",
                        boxShadow: `0 -3px 0 ${palette.edge}`,
                        paddingTop: "8px",
                    }}
                >
                    <Box
                        className="eip-shelf__drag-zone"
                        {...bindHeaderDrag()}
                        sx={{ display: "flex", justifyContent: "center", paddingBottom: "11px", touchAction: "none", flexShrink: 0 }}
                    >
                        <InfoSheetGrabber
                            className="eip-shelf__grabber"
                            style={{ width: 40, background: palette.shelfGrab }}
                        />
                    </Box>
                    {/* Slide wrapper for the entry-tab pager (see the effect above).
                        Transparent to layout: it repeats the body's own flex sizing. */}
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
                            showPinyin
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
                            showPinyinColor={showPinyinColor}
                            isFlipped={isFlipped}
                            onBreakdownItemClick={onBreakdownItemClick}
                            onUsedInItemClick={onUsedInItemClick}
                            onExampleSegmentClick={onExampleSegmentClick}
                            onSpeakSentence={onSpeakSentence}
                            speakingKey={speakingKey}
                            selectedSenseIndex={selectedSenseIndex}
                            showSynonymsRelated={showSynonymsRelated}
                            definitionFooter={definitionFooter}
                            // The entry header is drawn in the upper panel (above).
                            hideEntryHeader
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
                </Box>
                </>
            )}
        </SheetPanel>
        </EipPaletteProvider>
    );
});

InfoCardSection.displayName = "InfoCardSection";

export default InfoCardSection;
