import React, { useState, useCallback, useRef, useLayoutEffect, useEffect, useImperativeHandle, forwardRef } from "react";
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
import { SpeakerButton } from "./FlashCardSection";
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

interface InfoCardSectionProps {
    currentEntry: VocabEntry | null;
    selectedTab: number;
    onTabChange: (tab: number) => void;
    breakdownItems: BreakdownItem[];
    showPinyin: boolean;
    showSegmentSpaces?: boolean;
    isFlipped: boolean;
    onClose: () => void;
    // When provided, panel animates 0 → initialHeight on open instead of
    // 0 → natural-content height. Used by child panels (opened from a
    // breakdown-item tap) so they match the parent panel's current height.
    initialHeight?: number | null;
    // Tap handler for breakdown rows. When omitted, rows are not clickable.
    onBreakdownItemClick?: (item: BreakdownItem) => void;
    // Tap handler for used-in rows. When omitted, rows are not clickable.
    onUsedInItemClick?: (item: UsedInItem) => void;
    // Stack depth (0 = root panel). Used to bump z-index so child panels
    // and their scrims render above their parent.
    depth?: number;
    // Speaker callback. When provided, the header renders a speaker icon
    // identical to the flashcard's that triggers narration playback for
    // currentEntry. Undefined hides the icon (TTS disabled in settings).
    onSpeak?: (entry: VocabEntry) => void;
}

// Imperative handle exposed via ref so the parent can read the panel's
// live height when opening a child panel that should match it.
export interface InfoCardSectionHandle {
    getCurrentHeight: () => number | null;
}

// Sheet snaps to one of three stops on drag release: max height, the initial
// (natural-content) height, or 0 height. Snapping to 0 dismisses after the
// shrink animation finishes.
const SNAP_DURATION_MS = 220;

// Module-level set of currently mounted panel depths. The window-level wheel
// listener installed by each panel checks this set so only the top-most depth
// reacts to a given gesture (touch is already top-only via DOM hit-testing).
const mountedDepths = new Set<number>();

const InfoCardSection = forwardRef<InfoCardSectionHandle, InfoCardSectionProps>(({
    currentEntry,
    selectedTab,
    onTabChange,
    breakdownItems,
    showPinyin,
    showSegmentSpaces = false,
    isFlipped,
    onClose,
    initialHeight,
    onBreakdownItemClick,
    onUsedInItemClick,
    depth = 0,
    onSpeak,
}, ref) => {
    const theme = useTheme();
    const fc = theme.palette.flashcard;

    const sheetContainerRef = useRef<HTMLDivElement | null>(null);
    const scrollElRef = useRef<HTMLDivElement | null>(null);
    // Sheet height in px. null until measured after first render.
    const [sheetHeight, setSheetHeight] = useState<number | null>(null);
    // Ref kept in sync with state so the drag handler always reads the latest value.
    const sheetHeightRef = useRef<number | null>(null);
    const dragStartHeightRef = useRef<number>(0);
    // Parent container height used as the cap for resize drags.
    const parentHeightRef = useRef<number>(0);
    // Natural content height measured on first paint — one of the snap stops.
    const initialHeightRef = useRef<number>(0);
    // True only while a release-snap animation is playing.
    const [isSnapping, setIsSnapping] = useState(false);
    // Flag set when the chosen snap target is 0; the transitionend handler
    // reads this to know it should call handleClose after the shrink finishes.
    const pendingDismissRef = useRef(false);

    // Measure the sheet's natural height on first render (definition tab is active
    // on open), then play an open animation from 0 → measured height.
    //   - useLayoutEffect runs synchronously before paint, so the first painted
    //     frame already has height: 0 — no flash of full-height content.
    //   - requestAnimationFrame defers the target-height update to the next
    //     frame, with the transition enabled, so the browser animates the change.
    useLayoutEffect(() => {
        if (!sheetContainerRef.current) return;
        const measured = sheetContainerRef.current.offsetHeight;
        const parentH = sheetContainerRef.current.parentElement?.clientHeight ?? window.innerHeight;
        parentHeightRef.current = parentH;
        initialHeightRef.current = measured;
        // Child panels (initialHeight provided) animate to the parent panel's
        // current height instead of the measured natural height — they should
        // appear at the same vertical extent as the panel underneath them.
        const targetHeight = initialHeight != null ? Math.min(initialHeight, parentH * 0.92) : measured;
        sheetHeightRef.current = 0;
        setSheetHeight(0);
        requestAnimationFrame(() => {
            setIsSnapping(true);
            sheetHeightRef.current = targetHeight;
            setSheetHeight(targetHeight);
        });
        // initialHeight is captured once on mount — child panels are mounted
        // fresh each push, so we don't want to re-run the open animation if
        // it changes mid-life.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Expose the live sheet height to the parent so it can pass that height
    // as `initialHeight` to a freshly mounted child panel.
    useImperativeHandle(ref, () => ({
        getCurrentHeight: () => sheetHeightRef.current,
    }), []);

    const handleClose = useCallback(() => {
        onClose();
    }, [onClose]);

    // Drag the grabber to resize the sheet (drag up = taller, drag down = shorter).
    // While the finger is down the height tracks 1:1; on release the height snaps
    // to whichever of {0, initial, max} is nearest. Snapping to 0 dismisses.
    const bindHeaderDrag = useDrag(
        ({ first, last, movement: [, my] }) => {
            if (first) {
                dragStartHeightRef.current = sheetHeightRef.current ?? 0;
                setIsSnapping(false);
            }

            const maxH = parentHeightRef.current * 0.92;
            // Positive my = dragged down → sheet shrinks; negative = dragged up → grows.
            const newH = dragStartHeightRef.current - my;
            const clampedH = Math.max(0, Math.min(maxH, newH));

            if (!last) {
                sheetHeightRef.current = clampedH;
                setSheetHeight(clampedH);
                return;
            }

            // Release: snap to nearest of {0, initial, max} by pixel distance.
            const stops = [0, initialHeightRef.current, maxH];
            const target = stops.reduce((best, s) =>
                Math.abs(s - clampedH) < Math.abs(best - clampedH) ? s : best
            );
            if (target === 0) pendingDismissRef.current = true;
            setIsSnapping(true);
            sheetHeightRef.current = target;
            setSheetHeight(target);
        },
        { axis: "y", filterTaps: true }
    );

    // After a snap-to-0, dismiss the sheet once the height transition ends.
    // Falls back to a timeout in case transitionend doesn't fire (e.g., target
    // height equals current, so no transition occurs).
    useEffect(() => {
        if (!isSnapping) return;
        const el = sheetContainerRef.current;
        if (!el) return;
        const finish = () => {
            setIsSnapping(false);
            if (pendingDismissRef.current) {
                pendingDismissRef.current = false;
                handleClose();
            }
        };
        const onEnd = (e: TransitionEvent) => {
            if (e.propertyName !== "height") return;
            finish();
        };
        el.addEventListener("transitionend", onEnd);
        const timeout = window.setTimeout(finish, SNAP_DURATION_MS + 80);
        return () => {
            el.removeEventListener("transitionend", onEnd);
            window.clearTimeout(timeout);
        };
    }, [isSnapping, handleClose]);

    // Couple content scroll to sheet resize. While the content is at scrollTop=0
    // and the sheet isn't at its max, vertical scroll gestures grow/shrink the
    // sheet instead of scrolling content. Only once the sheet hits max do scroll
    // deltas pass through to native content scroll. Mirrors the drag handle:
    // shrinking past 0 dismisses via the existing snap-to-0 path.
    //
    // Sign convention for `dy`: positive = "user wants content to scroll down"
    // → grow the sheet. Negative = "scroll up" → shrink (only when scrollTop=0).
    useEffect(() => {
        const el = scrollElRef.current;
        if (!el) return;

        // Register this panel's depth so the wheel handler can tell whether
        // it's the top-most mounted panel. Removed on unmount.
        mountedDepths.add(depth);
        const isTopmost = () => {
            let max = -Infinity;
            mountedDepths.forEach(d => { if (d > max) max = d; });
            return depth === max;
        };

        // Returns true if we consumed the delta (caller should preventDefault).
        // Returns false if the caller should let the gesture through to native
        // scroll (which we apply manually for touch since touchAction is "none").
        const applyDelta = (dy: number): boolean => {
            const maxH = parentHeightRef.current * 0.92;
            const h = sheetHeightRef.current ?? 0;
            const st = el.scrollTop;
            if (dy > 0) {
                if (h < maxH) {
                    const next = Math.min(h + dy, maxH);
                    sheetHeightRef.current = next;
                    setSheetHeight(next);
                    return true;
                }
                return false;
            }
            if (dy < 0) {
                if (st > 0) return false;
                if (h > 0) {
                    const next = Math.max(h + dy, 0);
                    sheetHeightRef.current = next;
                    setSheetHeight(next);
                    return true;
                }
            }
            return false;
        };

        // Desktop wheel direction is inverted relative to the scroll-intent
        // convention so it matches the touch gesture (fingers UP on a trackpad
        // grow the sheet, mirroring finger-up on a phone).
        //
        // Wheel has no gesture-end event, so we can't piggyback dismiss on a
        // touchend-style hook. Instead, if a shrink wheel event would bring
        // the sheet below half its initial height, snap to 0 and dismiss in
        // one motion. Without this, trackpad deltas taper before reaching 0
        // and the sheet ends up visibly tiny but undismissed.
        const onWheel = (e: WheelEvent) => {
            // Only the top-most mounted panel reacts to wheel; lower panels in
            // a multi-panel stack stay inert until they become top-most again.
            if (!isTopmost()) return;
            // Ignore further wheel events once a dismiss snap is in flight,
            // so they don't race the snap-to-0 animation.
            if (pendingDismissRef.current) {
                e.preventDefault();
                return;
            }
            const dy = -e.deltaY;
            if (dy < 0) {
                // Shrink path: check the half-initial threshold first.
                const st = el.scrollTop;
                const h = sheetHeightRef.current ?? 0;
                if (st === 0 && h > 0) {
                    const next = Math.max(h + dy, 0);
                    const dismissThreshold = initialHeightRef.current / 2;
                    if (next < dismissThreshold) {
                        sheetHeightRef.current = 0;
                        setSheetHeight(0);
                        pendingDismissRef.current = true;
                        setIsSnapping(true);
                        e.preventDefault();
                        return;
                    }
                    sheetHeightRef.current = next;
                    setSheetHeight(next);
                    e.preventDefault();
                    return;
                }
                // scrollTop > 0 or already at 0 height — fall through to native scroll.
                return;
            }
            // Grow path or no-op: defer to the shared rule.
            if (applyDelta(dy)) e.preventDefault();
        };

        let lastTouchY: number | null = null;
        let touchConsumedAny = false;
        const onTouchStart = (e: TouchEvent) => {
            if (e.touches.length !== 1) return;
            lastTouchY = e.touches[0].clientY;
            touchConsumedAny = false;
        };
        const onTouchMove = (e: TouchEvent) => {
            if (lastTouchY === null || e.touches.length !== 1) return;
            const y = e.touches[0].clientY;
            const dy = lastTouchY - y; // finger up = positive dy
            lastTouchY = y;
            if (applyDelta(dy)) {
                touchConsumedAny = true;
                e.preventDefault();
            } else {
                // touchAction is "none" on this element, so the browser will not
                // scroll for us. Apply the delta to scrollTop manually.
                el.scrollTop += dy;
                e.preventDefault();
            }
        };
        const onTouchEnd = () => {
            lastTouchY = null;
            // If the gesture left the sheet at 0, trigger the existing dismiss path.
            if (touchConsumedAny && (sheetHeightRef.current ?? 0) <= 0) {
                pendingDismissRef.current = true;
                setIsSnapping(true);
            }
            touchConsumedAny = false;
        };

        // Wheel is bound to the window (not just the sheet) so the resize
        // gesture fires no matter where the mouse is on the page while the
        // EIP is open. The component is only mounted while the EIP is open,
        // so the listener auto-cleans on close.
        window.addEventListener("wheel", onWheel, { passive: false });
        el.addEventListener("touchstart", onTouchStart, { passive: false });
        el.addEventListener("touchmove", onTouchMove, { passive: false });
        el.addEventListener("touchend", onTouchEnd);
        el.addEventListener("touchcancel", onTouchEnd);
        return () => {
            mountedDepths.delete(depth);
            window.removeEventListener("wheel", onWheel);
            el.removeEventListener("touchstart", onTouchStart);
            el.removeEventListener("touchmove", onTouchMove);
            el.removeEventListener("touchend", onTouchEnd);
            el.removeEventListener("touchcancel", onTouchEnd);
        };
    }, []);

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

    // Apply locked height once measured; before measurement the sheet sizes naturally
    // so offsetHeight returns the correct content height for the definition tab.
    // Transition is only enabled during snap so finger-drag tracks 1:1.
    // Child panels (depth > 0) layer above their parent. EicScrim is z=10 and
    // InfoSheetContainer is z=11 in styled.ts; we offset by 2*depth so depth 1
    // sits cleanly above depth 0 with the same scrim-under-sheet ordering.
    const stackZ = depth * 2;
    const scrimStyle: React.CSSProperties = depth > 0 ? { zIndex: 10 + stackZ } : {};
    const sheetStyle: React.CSSProperties = sheetHeight !== null
        ? {
            height: sheetHeight,
            transition: isSnapping ? `height ${SNAP_DURATION_MS}ms ease-out` : "none",
            ...(depth > 0 ? { zIndex: 11 + stackZ } : {}),
        }
        : (depth > 0 ? { zIndex: 11 + stackZ } : {});

    return (
        <>
            {/* Scrim — tap to close */}
            <EicScrim
                className="mobile-demo-eic-scrim"
                onClick={handleClose}
                style={scrimStyle}
            />

            {/* Modal sheet */}
            <InfoSheetContainer
                ref={sheetContainerRef}
                className="mobile-demo-eic-sheet"
                style={sheetStyle}
            >
                {/* Draggable zone: grabber pill only.
                    The entry header and tab strip are intentionally OUTSIDE this
                    zone — taps on the speaker icon (and previously tabs) were
                    being processed by useDrag (@use-gesture/react intercepts
                    pointerdown natively, so React-level stopPropagation in a
                    descendant doesn't reliably prevent it). Restricting the drag
                    zone to the grabber decouples header interactions from
                    resize/dismiss gestures. */}
                <Box
                    className="mobile-demo-eic-drag-zone"
                    {...bindHeaderDrag()}
                    sx={{ touchAction: "none", userSelect: "none", display: "flex", justifyContent: "center", padding: "4px 0 8px" }}
                >
                    <InfoSheetGrabber className="mobile-demo-drag-handle" />
                </Box>

                {/* Entry header: headword + English translation + speaker icon.
                    Lives outside the drag zone so the speaker tap reliably
                    fires onClick without useDrag intercepting pointerdown. */}
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
                            {stripParentheses(currentEntry.definition ?? '')}
                        </Typography>
                    )}
                    {/* Speaker icon — same component used by the flashcard,
                        wired to the same TTS callback. Hidden when TTS is
                        disabled (onSpeak undefined). */}
                    {onSpeak && currentEntry && (
                        <SpeakerButton onClick={() => onSpeak(currentEntry)} />
                    )}
                </InfoSheetEntryHeader>

                {/* Underline tab strip — outside the drag zone so tab taps
                    can't be misread as resize gestures. */}
                <InfoSheetTabStrip className="mobile-demo-tabs">
                    {TAB_LABELS.map((label, index) => {
                        // Tab index 2 is the breakdown slot — relabeled to "Used In" for single-char zh.
                        const displayLabel = index === 2 ? breakdownTabLabel : label;
                        return (
                            <InfoSheetTab
                                key={index}
                                isActive={selectedTab === index}
                                isEmpty={tabIsEmpty[index]}
                                onClick={() => {
                                    if (!tabIsEmpty[index]) onTabChange(index);
                                }}
                                className={`mobile-demo-tab mobile-demo-tab-${displayLabel.replace(/\s+/g, '-')}`}
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
                                    {displayLabel.charAt(0).toUpperCase() + displayLabel.slice(1)}
                                </Typography>
                            </InfoSheetTab>
                        );
                    })}
                </InfoSheetTabStrip>

                {/* Scrollable tab body — touchAction pan-y so native scroll works here */}
                <Box
                    ref={scrollElRef}
                    className="mobile-demo-eic-scroll"
                    sx={{
                        flex: 1,
                        minHeight: 0,
                        overflow: "auto",
                        padding: "16px 18px 8px",
                        overscrollBehavior: "contain",
                        // touchAction "none" so our native touchmove handler can
                        // decide each event between sheet-resize and content-scroll.
                        touchAction: "none",
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

                    {/* Tab 2: Breakdown (multi-char) or Used In (single-char) */}
                    {selectedTab === 2 && breakdownTabHasContent ? (
                        <Box className="mobile-demo-breakdown-wrapper" sx={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                            <Box sx={{ display: "flex", flexDirection: "column" }}>
                                {isSingleChar
                                    ? usedInItems.map((item, index) => (
                                        <Box
                                            key={index}
                                            component={onUsedInItemClick ? "button" : "div"}
                                            className="mobile-demo-used-in-row-button"
                                            onClick={onUsedInItemClick ? () => onUsedInItemClick(item) : undefined}
                                            sx={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: "14px",
                                                padding: "10px 4px",
                                                borderBottom: index < usedInItems.length - 1
                                                    ? `1px solid ${fc.border}`
                                                    : "none",
                                                // Reset native button styles when rendered as <button>
                                                background: "transparent",
                                                border: "none",
                                                borderRadius: "8px",
                                                width: "100%",
                                                textAlign: "left",
                                                font: "inherit",
                                                color: "inherit",
                                                cursor: onUsedInItemClick ? "pointer" : "default",
                                                transition: "background-color 0.12s ease-out",
                                                "&:hover": onUsedInItemClick ? { background: fc.subtleBg } : undefined,
                                                "&:active": onUsedInItemClick ? { background: fc.subtleBg } : undefined,
                                            }}
                                        >
                                            <CharacterPinyinColorDisplay
                                                character={item.entryKey}
                                                pinyin={item.pronunciation ?? ""}
                                                size="md"
                                                useToneColor={true}
                                                showPinyin={showPinyin}
                                            />
                                            <Typography sx={{ fontSize: 14, color: fc.onSurface, flex: 1, fontFamily: '"Inter", sans-serif' }}>
                                                {item.definition ?? ""}
                                            </Typography>
                                            {onUsedInItemClick && (
                                                <Typography sx={{ fontSize: 14, color: fc.textSecondary, flexShrink: 0 }}>›</Typography>
                                            )}
                                        </Box>
                                    ))
                                    : breakdownItems.map((item, index) => (
                                    <Box
                                        key={index}
                                        component={onBreakdownItemClick ? "button" : "div"}
                                        className="mobile-demo-breakdown-row-button"
                                        onClick={onBreakdownItemClick ? () => onBreakdownItemClick(item) : undefined}
                                        sx={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "14px",
                                            padding: "10px 4px",
                                            borderBottom: index < breakdownItems.length - 1
                                                ? `1px solid ${fc.border}`
                                                : "none",
                                            // Reset native button styles when rendered as <button>
                                            background: "transparent",
                                            border: "none",
                                            borderRadius: "8px",
                                            width: "100%",
                                            textAlign: "left",
                                            font: "inherit",
                                            color: "inherit",
                                            cursor: onBreakdownItemClick ? "pointer" : "default",
                                            transition: "background-color 0.12s ease-out",
                                            "&:hover": onBreakdownItemClick ? { background: fc.subtleBg } : undefined,
                                            "&:active": onBreakdownItemClick ? { background: fc.subtleBg } : undefined,
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
                                {isSingleChar ? "No words use this character yet" : "Breakdown not available for this card"}
                            </Typography>
                        </Box>
                    ) : null}
                </Box>
            </InfoSheetContainer>
        </>
    );
});

InfoCardSection.displayName = "InfoCardSection";

export default InfoCardSection;
