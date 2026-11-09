import React, { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { Box } from "@mui/material";
import { type CPCDSize } from "../../../components/ForeignText";
import { sheetEdgeFadeSx, TAB_SWIPE_TRANSITION } from "../../../components/sheet/sheetStyled";
import { trackScrollEdgeFade } from "../../../components/scrollEdgeFade";
import OverlayScrollbar, { hiddenNativeScrollbarSx } from "../../../components/OverlayScrollbar";
import InfoCardTabContent from "./InfoCardTabContent";
import { tabAvailability } from "./infoCardTabAvailability";
import SheetSegmentedTabs from "../../../components/sheet/SheetSegmentedTabs";
import { restingTabTransform, useTabSwipeTrack } from "../../../components/sheet/useTabSwipeTrack";
import { TAB_LABELS } from "../constants";
import EipEntryHeader from "./EipEntryHeader";
import { useEipColors } from "./useEipPalette";
import type { LearningToggleState } from "../../../hooks/useLearningToggle";
import type { VocabEntry, BreakdownItem, UsedInItem } from "../types";

// Resting track offset for a tab: the track is (N·100%) wide with N equal
// panes, so showing tab k means shifting the track left by exactly k panes,
// i.e. k·(100/N)% of the track's own width.
const restingTransform = (tab: number) => restingTabTransform(tab, TAB_LABELS.length);

export interface InfoCardPanelBodyProps {
    currentEntry: VocabEntry | null;
    selectedTab: number;
    onTabChange: (tab: number) => void;
    breakdownItems: BreakdownItem[];
    // No `showPinyin` prop: the eip is reference info and ALWAYS shows pinyin (2026-10-04).
    // A study surface's pinyin toggle (the flp chip) must never reach it.
    showPinyinColor?: boolean;
    isFlipped: boolean;
    onBreakdownItemClick?: (item: BreakdownItem) => void;
    onUsedInItemClick?: (item: UsedInItem) => void;
    // When provided, tapping a segment's definition popup in the Examples tab
    // opens the eip for that segment's headword. Omit to keep the popup a
    // passive tooltip.
    onExampleSegmentClick?: (segment: string) => void;
    onSpeak?: (entry: VocabEntry) => void;
    // The Learning TOGGLE (glowing "+" ⇄ "Added!") under the speaker — the eip's only
    // add control outside the Dictionary eip. The dictionary cdp's inline panel only; the Dictionary page's eip
    // draws its Learning key in the sheet's trail row instead (EipAddKey).
    learning?: LearningToggleState;
    // Skip the entry header: the eip SHEET draws it in its upper panel (EipUpperPanel),
    // above the tab shelf. Inline hosts (the cdps) leave it off and get the header here.
    hideEntryHeader?: boolean;
    // Speaker callback for an example sentence. When provided, each sentence
    // block in the Examples tab renders a SpeakerButton in its top-right
    // corner. Undefined hides the buttons (TTS disabled in settings).
    onSpeakSentence?: (text: string, pronunciation?: string) => void;
    // Text currently being narrated by useTTS, or null when idle. The header
    // speaker spins when it matches the current entry; each sentence speaker
    // spins when it matches that sentence's Chinese text.
    speakingKey?: string | null;
    // Size of the headword CPCD in the entry header. Defaults to "md" (bottom-
    // sheet variant); the centered popup variant passes "sm" for a tighter card.
    headerCpcdSize?: CPCDSize;
    // The scrollable content area's touchAction. Bottom-sheet variant passes
    // "pan-y": SheetPanel decides resize-vs-scroll on the gesture's first move
    // and expresses "scroll" by letting the browser pan the pane natively, which
    // `none` would forbid outright (see InfoCardSection). The popup variant
    // leaves it "auto" — nothing intercepts its touchmoves at all.
    scrollTouchAction?: React.CSSProperties["touchAction"];
    // When provided, the props returned by this call are spread onto the entry
    // header so it shares the grabber's drag-to-resize gesture. useDrag's
    // filterTaps keeps icon taps (speaker, +, etc.) working normally.
    headerDragBind?: () => Record<string, unknown>;
    // Which definitionClusters sense the panel is showing — an index into
    // sortedSenseClusters(currentEntry), owned by the host (useEipTabs, per entry tab)
    // so it survives tab switches. Drives the header's underlined sense + pronunciation
    // and the definition tab's long definition / commonality. Display-only here: the
    // pick is made on the card face's SensePicker.
    selectedSenseIndex?: number;
    // Appends Synonyms + Related Words to the definition tab. cdps only — see
    // InfoCardTabContent's `showSynonymsRelated` for why it is a section and not a tab.
    showSynonymsRelated?: boolean;
    // Content pinned to the bottom of the definition tab — see InfoCardTabContent's
    // `definitionFooter`. Dictionary cdp only (its word-tools rail).
    definitionFooter?: React.ReactNode;
}

// Imperative handle exposing the two elements the bottom-sheet wrapper needs:
// `root` is the gesture target (covers header + tabs + tab body so swipes
// anywhere on the panel feed the resize/scroll coupling), and `scroll` is the
// ACTIVE tab's pane — each tab pane is its own overflow:auto scroller — whose
// `scrollTop` decides between resize and content scroll. Wrappers that cache
// `scroll` must re-read it when the tab changes (see InfoCardSection bodyKey).
export interface InfoCardPanelBodyHandle {
    root: HTMLDivElement | null;
    scroll: HTMLDivElement | null;
}

/**
 * Shared inner content of the EIP: entry header (CPCD + English + sense picker +
 * speaker), underline tab strip, and the scrollable tab body (definition / examples /
 * breakdown-or-used-in). Hosted by InfoCardSection (the bottom-sheet wrapper on the
 * flp/acp/saved-card cdp) and mounted inline by DictionaryCardDetailPage — anything
 * that changes here shows up on every host.
 *
 * The forwarded ref exposes both the gesture-root wrapper and the inner
 * scrollable Box so wrappers that need to hook scroll mechanics (sheet does)
 * can attach listeners to the whole panel while still querying scrollTop on
 * the actual overflow container.
 */
/**
 * How long after the panel mounts its OFF-SCREEN tab panes get their content, ms. Just
 * past SheetPanel's open slide (SNAP_DURATION_MS, 220): mounting them during the slide
 * would drop its frames, and mounting them in the opening commit is what made the eip
 * slow to appear (every pane's example sentences / breakdown rows on one frame).
 */
const OFFSCREEN_PANES_WARM_MS = 260;

const InfoCardPanelBody = forwardRef<InfoCardPanelBodyHandle, InfoCardPanelBodyProps>(function InfoCardPanelBody({
    currentEntry,
    selectedTab,
    onTabChange,
    breakdownItems,
    showPinyinColor = true,
    onBreakdownItemClick,
    onUsedInItemClick,
    onExampleSegmentClick,
    onSpeak,
    learning,
    onSpeakSentence,
    speakingKey,
    headerCpcdSize = "md",
    scrollTouchAction = "auto",
    headerDragBind,
    selectedSenseIndex,
    showSynonymsRelated,
    definitionFooter,
    hideEntryHeader,
}, ref) {
    const rootRef = useRef<HTMLDivElement | null>(null);
    // Clipping viewport around the sliding tab track. NOT itself scrollable —
    // each tab pane inside the track is its own vertical scroller.
    const clipRef = useRef<HTMLDivElement | null>(null);
    const trackRef = useRef<HTMLDivElement | null>(null);
    // One scroll container per tab pane, indexed by tab. Every pane's SCROLLER is always
    // mounted (see the track JSX), so these are stable for the panel's life — only the
    // off-screen panes' CONTENT is deferred (panesWarm).
    const paneRefs = useRef<(HTMLDivElement | null)[]>([]);
    // True for the single frame in which an entry change is repositioning the sub-tab
    // track with its transition off (see the entry-jump layout effect below).
    const entryJumpRef = useRef(false);
    // Entry key the sub-tab track is currently positioned for; see the entry-jump effect.
    const lastEntryKeyRef = useRef(currentEntry?.entryKey);
    // --- Swipe-to-change-tab ------------------------------------------------
    // All three tab panes are ALWAYS mounted (their content once panesWarm) side by side
    // on a permanent (N·100%)-wide track (see the JSX below); a tab change — by tap or by
    // swipe — only moves the track's transform. The gesture itself is the shared
    // useTabSwipeTrack (src/components/sheet/useTabSwipeTrack.ts — the Account panel
    // swipes through the same code). Because every pane is its own scroller, tabs also
    // stop sharing scroll state: each tab remembers its own scroll position.
    //
    // `selectedTabRef` mirrors selectedTab for the imperative handle's getter below;
    // `dragDxRef` (non-null = finger on the track) gates the entry-jump effect below.
    const { selectedTabRef, dragDxRef } = useTabSwipeTrack({
        clipRef,
        trackRef,
        tabCount: TAB_LABELS.length,
        selectedTab,
        onTabChange,
        // A swipe may be starting: its neighbour pane has to be drawn (panesWarm).
        // (warmPanesRef is declared below; the arrow only reads it on a touch.)
        onGestureStart: () => warmPanesRef.current(),
        // The entry-jump effect pins the track itself for one frame.
        pinnedRef: entryJumpRef,
    });

    useImperativeHandle(ref, () => ({
        get root() { return rootRef.current; },
        // The scrollable element is the ACTIVE tab's pane. SheetPanel captures
        // this once per bodyKey, so InfoCardSection folds selectedTab into its
        // bodyKey to re-bind the scroll/resize coupling on every tab change.
        get scroll() { return paneRefs.current[selectedTabRef.current] ?? null; },
    }), [selectedTabRef]); // a stable ref from useTabSwipeTrack — never re-runs

    const colors = useEipColors();

    // DEFERRED OFF-SCREEN PANES. The opening commit renders only the ACTIVE pane's content;
    // the other panes' scrollers are there (empty) and fill in OFFSCREEN_PANES_WARM_MS
    // later, or at once when a finger lands on the track (a swipe must find its
    // neighbour drawn) — whichever comes first. A tapped tab needs no warming: the active
    // pane always renders, so it fills in the same commit that starts its slide. One-way:
    // once warm, every pane stays mounted for the panel's life (the swipe section's
    // "nothing mounts on a tab change" holds from then on).
    const [panesWarm, setPanesWarm] = useState(false);
    const warmPanesRef = useRef(() => setPanesWarm(true));
    useEffect(() => {
        const t = window.setTimeout(warmPanesRef.current, OFFSCREEN_PANES_WARM_MS);
        return () => window.clearTimeout(t);
    }, []);

    // Per-tab emptiness + the entry-derived values the tab bodies render. Derived ONCE
    // and shared with InfoCardTabContent so the strip's tab-2 label and the panes can
    // never disagree. Empty tabs are NOT dimmed in the strip (2026-11-03) — the pane's
    // own empty state says "nothing here". See InfoCardTabContent.tsx.
    const avail = tabAvailability(currentEntry, breakdownItems, selectedSenseIndex);
    const { breakdownTabLabel } = avail;


    // Every pane is its own scroller with its own edge-fade mask (sheetEdgeFadeSx), so
    // each one feeds its own scroll-aware bands. The panes are mounted for the panel's
    // whole life (see paneRefs), so attaching once on mount covers them all.
    useLayoutEffect(() => {
        const cleanups = paneRefs.current
            .filter((pane): pane is HTMLDivElement => pane !== null)
            .map(trackScrollEdgeFade);
        return () => cleanups.forEach((cleanup) => cleanup());
    }, []);

    // New entry in the same panel (entry-tab switch / breakdown drill-in):
    // start every pane back at its top — scroll positions are per-pane now.
    useEffect(() => {
        for (const pane of paneRefs.current) {
            if (pane) pane.scrollTop = 0;
        }
    }, [currentEntry?.entryKey]);

    // ENTRY CHANGE = a silent jump of the sub-tab track, never a slide.
    //
    // A drill-in opens a NEW entry tab whose sub-tab starts at Definitions, so the track's
    // declarative transform changes from (say) Breakdown back to Definitions in the same
    // commit that swaps the word. Left to the persistent transition that animated
    // BACKWARDS through the sub-tabs of a word the user had already left — motion that
    // said "you went back" while the trail said "you went forward". The forward motion is
    // now the entry pager in InfoCardSection; this one just has to get out of its way.
    //
    // Done by pinning the inline transform with transition:none for one frame, then
    // handing the position back to the declarative style. Same inline-override-then-clear
    // discipline the drag path uses, so nothing can wedge: the very next tab change or
    // touchstart re-normalizes the track regardless.
    useLayoutEffect(() => {
        // Fires on a sub-tab change too (selectedTab has to be in the deps to be read
        // here without going stale), so gate on the entry key actually having moved —
        // a plain tab tap must keep its slide. Seeded with the mounting entry, so the
        // first render is not treated as a change.
        const entryKey = currentEntry?.entryKey;
        if (lastEntryKeyRef.current === entryKey) return;
        lastEntryKeyRef.current = entryKey;
        const track = trackRef.current;
        // A finger is on the track — leave the drag's own inline styles alone.
        if (!track || dragDxRef.current !== null) return;
        entryJumpRef.current = true;
        track.style.transition = "none";
        track.style.transform = restingTransform(selectedTab);
        void track.offsetWidth; // flush, so the no-transition position is what gets painted
        const raf = requestAnimationFrame(() => {
            entryJumpRef.current = false;
            if (dragDxRef.current !== null) return;
            track.style.transition = "";
            track.style.transform = "";
        });
        // Torn down before the rAF ran (a second drill-in in the same frame): clear the
        // pin here instead, or the track would be left with transition:none AND a stale
        // inline transform — every later tab tap would jump to the wrong pane, silently.
        return () => {
            cancelAnimationFrame(raf);
            entryJumpRef.current = false;
            // Deliberately the LIVE value: a finger that landed since must keep its styles.
            // eslint-disable-next-line react-hooks/exhaustive-deps
            if (dragDxRef.current === null) {
                track.style.transition = "";
                track.style.transform = "";
            }
        };
    }, [currentEntry?.entryKey, selectedTab, dragDxRef]);

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
            {/* Entry header: headword + English translation + speaker icon. When the bottom-sheet wrapper passes headerDragBind, this row also acts
                as a drag-to-resize handle (useDrag's filterTaps keeps taps on
                speaker/+ icons working). */}
            {!hideEntryHeader && (
            <EipEntryHeader
                entry={currentEntry}
                showPinyinColor={showPinyinColor}
                cpcdSize={headerCpcdSize}
                onSpeak={onSpeak}
                speakingKey={speakingKey}
                learning={learning}
                selectedSenseIndex={selectedSenseIndex}
                {...(headerDragBind ? headerDragBind() : {})}
                sx={headerDragBind ? { touchAction: "none", cursor: "grab" } : undefined}
            />
            )}

            {/* Content tab strip — the design's sunken segmented track. Also acts as a drag-to-resize handle
                (same bindHeaderDrag as the header) so a vertical drag started
                on the tabs resizes the sheet on desktop too — on touch the
                root's raw resize listeners already cover it. useDrag's
                filterTaps keeps tab-selection taps working. */}
            <SheetSegmentedTabs
                className="mobile-demo-tabs"
                tabs={TAB_LABELS.map((label, index) => {
                    // Tab index 2 is the breakdown slot — relabeled to "Used In" for single-char zh.
                    const displayLabel = index === 2 ? breakdownTabLabel : label;
                    return {
                        label: displayLabel,
                        className: `mobile-demo-tab mobile-demo-tab-${displayLabel.replace(/\s+/g, '-')}`,
                    };
                })}
                selected={selectedTab}
                onSelect={onTabChange}
                colors={{
                    track: colors.tabWell,
                    trackShadow: colors.tabWellShadow,
                    chip: colors.tabOn,
                    ink: colors.ink,
                    muted: colors.muted,
                }}
                dragBind={headerDragBind}
            />

            {/* Tab body: a clipping viewport over a permanent 3-pane track.
                Every pane's scroller is always mounted (its content is deferred
                until panesWarm — see above) and is its own vertical scroller,
                so a tab change moves ONLY the track's transform — nothing
                mounts, resizes, or shares scroll state (see the swipe section
                comment above). Gesture listeners are attached imperatively
                (see the useEffect above) rather than as JSX onTouch* props —
                see that effect's comment for why. */}
            <Box
                ref={clipRef}
                className="mobile-demo-eic-clip"
                sx={{
                    flex: 1,
                    minHeight: 0,
                    overflow: "hidden",
                    touchAction: scrollTouchAction,
                }}
            >
                <Box
                    ref={trackRef}
                    className="mobile-demo-tab-slide-track"
                    sx={{
                        display: "flex",
                        width: `${TAB_LABELS.length * 100}%`,
                        height: "100%",
                        transform: restingTransform(selectedTab),
                        // Persistent transition: a tapped tab change animates
                        // purely through this declarative transform changing.
                        // Finger drags override transform/transition inline
                        // and clear the overrides on release (gesture effect).
                        transition: TAB_SWIPE_TRANSITION,
                    }}
                >
                    {TAB_LABELS.map((_, index) => (
                        // Non-scrolling slot per pane: the positioning context for the
                        // OverlayScrollbar thumb, which must sit OUTSIDE the scroller so it
                        // neither scrolls away nor gets clipped by the edge-fade mask.
                        <Box
                            key={index}
                            className="mobile-demo-tab-pane-slot"
                            sx={{
                                flex: `0 0 ${100 / TAB_LABELS.length}%`,
                                minWidth: 0,
                                height: "100%",
                                position: "relative",
                            }}
                        >
                            <Box
                                ref={(node: HTMLDivElement | null) => { paneRefs.current[index] = node; }}
                                className="mobile-demo-eic-scroll mobile-demo-tab-pane"
                                sx={{
                                    height: "100%",
                                    overflowX: "hidden",
                                    overflowY: "auto",
                                    // No native scrollbar: a classic desktop bar takes ~15px
                                    // of width (or, with a reserved gutter, pushes the content
                                    // off-centre). The thumb is drawn over the content by the
                                    // OverlayScrollbar sibling instead, and the content width
                                    // never depends on whether the pane overflows.
                                    ...hiddenNativeScrollbarSx,
                                    padding: "16px 18px 8px",
                                    overscrollBehavior: "contain",
                                    touchAction: scrollTouchAction,
                                    // Each pane fades out at its own bottom edge, so a
                                    // long definition dissolves into the panel's edge
                                    // rather than being sliced by it. The mask is anchored
                                    // to the pane's box, so the band stays parked at the
                                    // bottom while the content scrolls under it.
                                    // (sheetStyled § Sheet bottom edge fade.)
                                    ...sheetEdgeFadeSx,
                                }}
                            >
                                {(panesWarm || index === selectedTab) && <InfoCardTabContent
                                    tabIndex={index}
                                    currentEntry={currentEntry}
                                    breakdownItems={breakdownItems}
                                    avail={avail}
                                    showPinyinColor={showPinyinColor}
                                    onBreakdownItemClick={onBreakdownItemClick}
                                    onUsedInItemClick={onUsedInItemClick}
                                    onExampleSegmentClick={onExampleSegmentClick}
                                    onSpeakSentence={onSpeakSentence}
                                    speakingKey={speakingKey}
                                    selectedSenseIndex={selectedSenseIndex}
                                    showSynonymsRelated={showSynonymsRelated}
                                    definitionFooter={definitionFooter}
                                />}
                            </Box>
                            <OverlayScrollbar
                                className="mobile-demo-tab-pane-scrollbar"
                                getScroller={() => paneRefs.current[index] ?? null}
                            />
                        </Box>
                    ))}
                </Box>
            </Box>
        </Box>
    );
});

export default InfoCardPanelBody;
