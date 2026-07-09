import React, { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { Box, IconButton, Typography, useTheme } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import CompareArrowsIcon from "@mui/icons-material/CompareArrows";
import { stripParentheses } from "../../../utils/definitionUtils";
import ForeignText, { type CPCDSize } from "../../../components/ForeignText";
import PosBadge from "../../../components/PosBadge";
import PracticeWritingButton from "../../../components/handwriting/PracticeWritingButton";
import LongDefinitionDisplay from "../../../components/LongDefinitionDisplay";
import VernacularScoreDots from "../../../components/VernacularScoreDots";
import { aiGeneratedSurfaceSx } from "../../../theme/aiGeneratedStyling";
import { AiGeneratedBadge } from "../../../components/AiGeneratedBadge";
import InfoCardListRow from "./InfoCardListRow";
import {
    InfoSheetEntryHeader,
    InfoSheetTabStrip,
    InfoSheetTab,
    SharedCharsLabel,
} from "./styled";
import {
    TAB_LABELS,
    FC_FONT,
    TAB_SWIPE_AXIS_LOCK_PX,
    TAB_SWIPE_COMMIT_RATIO,
    TAB_SWIPE_TRANSITION,
} from "./constants";
import { SIZE, WEIGHT, LEADING, TRACKING } from "../../../theme/scale";
import { SpeakerButton } from "./FlashCardSection";
import ExampleSentenceList from "../ExampleSentenceList";
import type { VocabEntry, BreakdownItem, UsedInItem } from "./types";

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
    // When provided, tapping a segment's definition popup in the Examples tab
    // opens the eip for that segment's headword. Omit to keep the popup a
    // passive tooltip.
    onExampleSegmentClick?: (segment: string) => void;
    onSpeak?: (entry: VocabEntry) => void;
    // When provided, renders a "+" button immediately after the SpeakerButton
    // in the entry header. Used only by the dictionary EIP — flashcards EIP
    // omits it because those cards are already in the library by definition.
    onAddToLibrary?: (entry: VocabEntry) => void;
    // Opens (or focuses/refills) the singleton Compare tab for the current entry
    // (docs/WORD_COMPARE_FEATURE.md). Renders the Compare icon button in the header
    // actions column; undefined hides it.
    onOpenCompare?: (entry: VocabEntry) => void;
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
    onBreakdownItemClick,
    onUsedInItemClick,
    onExampleSegmentClick,
    onSpeak,
    onAddToLibrary,
    onOpenCompare,
    onSpeakSentence,
    speakingKey,
    headerCpcdSize = "md",
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
        currentEntry?.difficulty ||
        (currentEntry?.partsOfSpeech?.length ?? 0) > 0
    );
    const examplesTabHasContent = !!(currentEntry?.exampleSentences?.length);
    // Single-char zh cards swap the breakdown tab for a "used in" list (see usedIn enrichment in OnDeckVocabService).
    const isSingleChar = !!currentEntry && [...currentEntry.entryKey].length === 1;
    const usedInItems: UsedInItem[] = (isSingleChar && currentEntry?.usedIn) ? currentEntry.usedIn : [];
    // Only characters that actually abbreviate a fuller word are shown — chars with an
    // empty impliedWord ("") are omitted entirely (char-by-char basis). The section
    // renders only when at least one character qualifies.
    // Guard `impliedWord` — legacy v1 rows use a `reason` key (no `impliedWord`),
    // so item.impliedWord can be undefined; `?? ''` keeps those from crashing (they
    // filter out) until re-enriched to the v2 shape.
    const rationaleItems = (currentEntry?.characterRationale ?? []).filter((item) => (item.impliedWord ?? '').trim().length > 0);
    const hasRationale = rationaleItems.length > 0;
    const breakdownTabHasContent = isSingleChar
        ? (usedInItems.length > 0 || hasRationale)
        : (breakdownItems.length > 0 || hasRationale);
    const breakdownTabLabel = isSingleChar ? "used in" : TAB_LABELS[2];

    const tabIsEmpty = [!definitionTabHasContent, !examplesTabHasContent, !breakdownTabHasContent];

    // --- Swipe-to-change-tab + tap-animation -------------------------------
    // While `slide` is set, the scroll body renders TWO adjacent panes
    // side-by-side (from/to) inside one flex track and animates the track
    // between their resting positions — used both for a live finger-driven
    // swipe and for a duration-based slide when a tab is tapped. When null,
    // the fast path (single mounted pane) renders, matching prior behavior.
    //
    // The track's LAYOUT is purely relative (width 200%, two 50% panes) so it
    // can never disagree with the scroll box's true content width — earlier
    // versions sized panes from a measured pixel width, and any moment that
    // measurement was stale (scrollbar toggling when both panes mount,
    // sub-pixel rounding, measuring mid-open-animation) the panes laid out a
    // few px off and visibly snapped when the track unmounted. The position
    // is expressed as `basePercent` (0 = showing the left pane, -50 = showing
    // the right pane — a percentage of the 200%-wide track, i.e. one pane
    // width) plus a live `offsetPx` finger delta, combined via CSS calc().
    const [slide, setSlide] = useState<{ from: number; to: number; basePercent: number; offsetPx: number; animated: boolean } | null>(null);
    // Measured content width of the scroll box, in px. Used ONLY for gesture
    // math (commit threshold + drag clamp) — never for layout — so small
    // measurement error is harmless.
    const paneWidthRef = useRef(0);
    const touchStartRef = useRef<{ x: number; y: number } | null>(null);
    // null = undecided (within the axis-lock slop), "x" = swipe owns the
    // gesture, "y" = handed off untouched to SheetPanel's vertical listener.
    const swipeAxisRef = useRef<"x" | "y" | null>(null);
    // Set right before a committed swipe calls onTabChange, so the
    // selectedTab-watching effect below knows that change was already
    // animated by the gesture and shouldn't start a second, duplicate slide.
    const justCommittedSwipeToRef = useRef<number | null>(null);

    useLayoutEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        const update = () => {
            // Content width available to a pane: clientWidth minus this box's
            // own horizontal padding (panes render inside that padding). This
            // now feeds ONLY the gesture threshold/clamp math — layout uses a
            // relative 50%/200% track — so it never has to be pixel-perfect.
            const style = getComputedStyle(el);
            const horizontalPadding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
            paneWidthRef.current = el.clientWidth - horizontalPadding;
        };
        update();
        const ro = new ResizeObserver(update);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    // Animate a tap-driven tab change (any index → any index, not just
    // adjacent — the two tapped tabs simply slide past each other). Skips
    // the change already visually completed by a swipe gesture, and skips
    // the initial measurement-frame jump (see hasMeasured above).
    const prevSelectedTabRef = useRef(selectedTab);
    useEffect(() => {
        const prev = prevSelectedTabRef.current;
        prevSelectedTabRef.current = selectedTab;
        if (prev === selectedTab) return;
        if (justCommittedSwipeToRef.current === selectedTab) {
            justCommittedSwipeToRef.current = null;
            return;
        }
        if (!hasMeasured) return;
        // basePercent: 0 shows the left (lower-index) pane, -50 shows the right
        // pane — a percentage of the 200%-wide track, i.e. exactly one pane.
        const leftPane = Math.min(prev, selectedTab);
        const fromBase = prev === leftPane ? 0 : -50;
        const toBase = selectedTab === leftPane ? 0 : -50;
        setSlide({ from: prev, to: selectedTab, basePercent: fromBase, offsetPx: 0, animated: false });
        requestAnimationFrame(() => {
            setSlide((s) => (s && s.from === prev && s.to === selectedTab) ? { ...s, basePercent: toBase, animated: true } : s);
        });
    }, [selectedTab, hasMeasured]);

    // Kept in sync every render so the gesture listener below (registered
    // once, via a mount-only effect — see why below) always reads the
    // latest value instead of a stale closure.
    const effectiveTabRef = useRef(effectiveTab);
    effectiveTabRef.current = effectiveTab;
    const onTabChangeRef = useRef(onTabChange);
    onTabChangeRef.current = onTabChange;
    // Source of truth for the in-flight gesture, read/written only inside
    // the listener below — deliberately NOT the `slide` state itself, so a
    // fast finger generating several touchmoves before React gets a chance
    // to flush a render never reads a stale value (`slide` is written from
    // here purely to drive the visual track; see liveSlideRef reads).
    const liveSlideRef = useRef<{ from: number; to: number; basePercent: number; offsetPx: number } | null>(null);

    // Gesture listeners are raw `addEventListener`s (not React onTouch* JSX
    // props) attached directly to the scroll box, mirroring SheetPanel's own
    // pattern (SheetPanel.tsx's touchstart/touchmove/touchend effect). This
    // is required, not stylistic: SheetPanel's resize/scroll listener is
    // itself a raw addEventListener on an ANCESTOR (rootRef). Native touch
    // events reach that ancestor's raw listener DURING REAL DOM BUBBLING —
    // which completes before React ever gets to dispatch a synthetic
    // onTouchMove prop (React delegates to a single listener at its own root
    // container, higher up than rootRef, and only starts its synthetic
    // dispatch once the real bubble reaches THAT point). So a React
    // onTouchMove handler's stopPropagation() is always too late to stop
    // SheetPanel's listener — it has already run. Registering our own raw
    // listener on the scroll box (a descendant of rootRef) puts us earlier
    // in the real bubble order, so our stopPropagation() actually works.
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;

        const onTouchStart = (e: TouchEvent) => {
            if (e.touches.length !== 1) return;
            touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            swipeAxisRef.current = null;
        };

        const onTouchMove = (e: TouchEvent) => {
            const start = touchStartRef.current;
            if (!start || e.touches.length !== 1 || !paneWidthRef.current) return;
            const dx = e.touches[0].clientX - start.x;
            const dy = e.touches[0].clientY - start.y;
            if (swipeAxisRef.current === null) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) < TAB_SWIPE_AXIS_LOCK_PX) {
                    // Still ambiguous. Block SheetPanel from seeing this
                    // event too, not just events after the axis is decided —
                    // otherwise a few px of pre-lock vertical noise leaks
                    // into SheetPanel's own touchmove handler, which shrinks
                    // the sheet slightly AND sets its internal
                    // `touchConsumedAny` flag. If the gesture then resolves
                    // "x" here, SheetPanel's touchend handler (which we don't
                    // otherwise touch) reads that leftover flag + the
                    // now-slightly-shorter height as "user dragged the sheet
                    // down and released," and DISMISSES the panel out from
                    // under the swipe. Blocking from the very first event
                    // avoids this entirely: SheetPanel's touchConsumedAny
                    // simply never gets set for a gesture that turns out
                    // horizontal. (No preventDefault yet — if this resolves
                    // "y", we want the browser's native vertical scroll, if
                    // any, to engage normally from its own first event.)
                    e.stopPropagation();
                    return;
                }
                // Biased toward horizontal: real touches are jittery, and a
                // straight horizontal swipe very often has a few px of
                // vertical noise at the very start (the initial press-down
                // wobble). A plain dx>dy comparison would misfire "y" on
                // that noise and — since the axis then stays locked for the
                // rest of the gesture — the whole swipe would fall through
                // to SheetPanel's vertical resize/scroll instead of
                // changing tabs. Only lock "y" when vertical movement is
                // clearly (30%+) ahead of horizontal.
                swipeAxisRef.current = Math.abs(dy) > Math.abs(dx) * 1.3 ? "y" : "x";
                if (swipeAxisRef.current === "y") {
                    // Vertical intent: hand the gesture off to SheetPanel's
                    // own resize/scroll listener from here on. Its
                    // lastTouchY is still the value from touchstart (we
                    // blocked every event up to now), so the very next event
                    // it sees computes one correct, larger delta covering
                    // the whole gesture so far — no motion is lost.
                    return;
                }
            }
            if (swipeAxisRef.current !== "x") return;
            // Horizontal intent: block SheetPanel's vertical resize/scroll
            // listener from seeing this gesture at all, and stop the
            // browser's own scroll/edge-swipe from firing.
            e.stopPropagation();
            e.preventDefault();
            const tab = effectiveTabRef.current;
            const targetTab = dx < 0 ? tab + 1 : tab - 1;
            if (targetTab < 0 || targetTab > TAB_LABELS.length - 1) return; // no neighbor that direction — ignore
            const leftPane = Math.min(tab, targetTab);
            const fromBase = tab === leftPane ? 0 : -50;
            // Clamp the finger delta so the track can't be dragged past either
            // resting edge (revealing blank space beyond a pane).
            const clampedDx = tab === leftPane
                ? Math.max(-paneWidthRef.current, Math.min(0, dx))
                : Math.max(0, Math.min(paneWidthRef.current, dx));
            const next = { from: tab, to: targetTab, basePercent: fromBase, offsetPx: clampedDx };
            liveSlideRef.current = next;
            setSlide({ ...next, animated: false });
        };

        const onTouchEnd = () => {
            touchStartRef.current = null;
            const axis = swipeAxisRef.current;
            swipeAxisRef.current = null;
            const current = liveSlideRef.current;
            liveSlideRef.current = null;
            if (axis !== "x" || !current) return;
            const leftPane = Math.min(current.from, current.to);
            const fromBase = current.from === leftPane ? 0 : -50;
            const toBase = current.to === leftPane ? 0 : -50;
            // offsetPx is the px traveled from the resting position, so its
            // magnitude is exactly the swipe distance to test against the
            // commit threshold.
            const committed = Math.abs(current.offsetPx) > paneWidthRef.current * TAB_SWIPE_COMMIT_RATIO;
            if (committed) {
                justCommittedSwipeToRef.current = current.to;
                onTabChangeRef.current(current.to);
            }
            // Animate to the committed tab's resting position (or snap back to
            // the origin), dropping the live px offset entirely.
            setSlide({ from: current.from, to: current.to, basePercent: committed ? toBase : fromBase, offsetPx: 0, animated: true });
        };

        el.addEventListener("touchstart", onTouchStart, { passive: false });
        el.addEventListener("touchmove", onTouchMove, { passive: false });
        el.addEventListener("touchend", onTouchEnd);
        el.addEventListener("touchcancel", onTouchEnd);
        return () => {
            el.removeEventListener("touchstart", onTouchStart);
            el.removeEventListener("touchmove", onTouchMove);
            el.removeEventListener("touchend", onTouchEnd);
            el.removeEventListener("touchcancel", onTouchEnd);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Definition / examples / breakdown-or-used-in content for one tab
    // index, factored out so both the resting (single-pane) render and the
    // sliding two-pane track can render either tab on demand.
    const renderTabContent = (tabIndex: number): React.ReactNode => {
        if (tabIndex === 0) {
            return definitionTabHasContent ? (
                <Box className="mobile-demo-definition-wrapper" sx={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                    {(currentEntry?.longDefinition || currentEntry?.longDefinitionParts?.length) && (
                        <LongDefinitionDisplay
                            className="mobile-demo-long-definition-text"
                            longDefinition={currentEntry?.longDefinition}
                            longDefinitionParts={currentEntry?.longDefinitionParts}
                            showPinyin={showPinyin}
                            showPinyinColor={showPinyinColor}
                            onSegmentOpen={onExampleSegmentClick}
                            aiGenerated={!currentEntry?.definitionsApproved}
                            sx={{
                                fontSize: SIZE.body,
                                color: fc.onSurface,
                                fontFamily: FC_FONT,
                                lineHeight: 1.6,
                            }}
                        />
                    )}
                    {(currentEntry?.difficulty || (currentEntry?.partsOfSpeech?.length ?? 0) > 0 || currentEntry?.vernacularScore != null) && (
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
                            {/* HSK meta: only for zh, whose 1–6 difficulty integers ARE HSK
                                levels; es uses the same scale but it is not an HSK label. */}
                            {currentEntry?.language === 'zh' && currentEntry.difficulty && (
                                // HSK/difficulty is AI-classified (backfill-hsk-level.js) with no
                                // validation field, so it always carries the AI-generated box (no
                                // badge — a small value chip, like the Type chip below).
                                <Box
                                    className="mobile-demo-hsk-chip--ai-generated"
                                    sx={{ display: "flex", flexDirection: "column", gap: "3px", ...aiGeneratedSurfaceSx, borderRadius: "8px", padding: "4px 8px" }}
                                >
                                    <Typography sx={{ fontSize: SIZE.micro, fontWeight: WEIGHT.bold, color: fc.textSecondary, letterSpacing: TRACKING.caps, textTransform: "uppercase", fontFamily: FC_FONT }}>
                                        HSK
                                    </Typography>
                                    <Typography sx={{ fontSize: SIZE.body, fontWeight: WEIGHT.semibold, color: fc.onSurface, fontFamily: FC_FONT, whiteSpace: "nowrap" }}>
                                        {`HSK ${currentEntry.difficulty}`}
                                    </Typography>
                                </Box>
                            )}
                            {(currentEntry?.partsOfSpeech?.length ?? 0) > 0 && (
                                <Box
                                    className={currentEntry?.definitionsApproved ? undefined : "mobile-demo-pos-chip--ai-generated"}
                                    sx={{
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: "3px",
                                        // Orange border/tint only (no badge) when the definitions
                                        // bundle hasn't been human-approved (docs/DATA_VALIDATION_SYSTEM.md).
                                        ...(currentEntry?.definitionsApproved ? {} : { ...aiGeneratedSurfaceSx, borderRadius: "8px", padding: "4px 8px" }),
                                    }}
                                >
                                    <Typography sx={{ fontSize: SIZE.micro, fontWeight: WEIGHT.bold, color: fc.textSecondary, letterSpacing: TRACKING.caps, textTransform: "uppercase", fontFamily: FC_FONT }}>
                                        Type
                                    </Typography>
                                    <Typography sx={{ fontSize: SIZE.body, fontWeight: WEIGHT.semibold, color: fc.onSurface, fontFamily: FC_FONT }}>
                                        {currentEntry!.partsOfSpeech!.join(', ')}
                                    </Typography>
                                </Box>
                            )}
                            {currentEntry?.vernacularScore != null && (
                                // vernacularScore is AI-scored (backfill-vernacular-score.js) with no
                                // validation field, so it always carries the AI-generated box (no
                                // badge — a small value chip, like the Type chip above).
                                <Box
                                    className="mobile-demo-vernacular-meta mobile-demo-vernacular-meta--ai-generated"
                                    sx={{ display: "flex", flexDirection: "column", gap: "3px", ...aiGeneratedSurfaceSx, borderRadius: "8px", padding: "4px 8px" }}
                                >
                                    <Typography sx={{ fontSize: SIZE.micro, fontWeight: WEIGHT.bold, color: fc.textSecondary, letterSpacing: TRACKING.caps, textTransform: "uppercase", fontFamily: FC_FONT }}>
                                        Commonality
                                    </Typography>
                                    <Box className="mobile-demo-vernacular-dots" sx={{ display: "flex", alignItems: "center", gap: "5px", height: 19 }}>
                                        <VernacularScoreDots
                                            score={currentEntry.vernacularScore!}
                                            filledColor={fc.onSurface}
                                            emptyBorderColor={fc.border}
                                        />
                                        <Typography sx={{ fontSize: SIZE.micro, fontWeight: WEIGHT.bold, color: fc.onSurface, fontFamily: FC_FONT, lineHeight: 1 }}>
                                            {currentEntry.vernacularScore}/5
                                        </Typography>
                                    </Box>
                                </Box>
                            )}
                        </Box>
                    )}
                </Box>
            ) : (
                <Box className="mobile-demo-tab-empty" sx={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 2 }}>
                    <Typography sx={{ fontSize: SIZE.body, color: fc.textSecondary, textAlign: "center", fontFamily: FC_FONT }}>
                        No definition available for this card
                    </Typography>
                </Box>
            );
        }

        if (tabIndex === 1) {
            // Examples — shared est renderer (see ExampleSentenceList).
            return examplesTabHasContent ? (
                <ExampleSentenceList
                    sentences={currentEntry!.exampleSentences!}
                    vocabWord={currentEntry?.entryKey}
                    language={currentEntry?.language}
                    showPinyin={showPinyin}
                    showPinyinColor={showPinyinColor}
                    showSegmentSpaces={showSegmentSpaces}
                    onSegmentOpen={onExampleSegmentClick}
                    onSpeakSentence={onSpeakSentence}
                    speakingKey={speakingKey}
                />
            ) : (
                <Box className="mobile-demo-tab-empty" sx={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 2 }}>
                    <Typography sx={{ fontSize: SIZE.body, color: fc.textSecondary, textAlign: "center", fontFamily: FC_FONT }}>
                        No example sentences available
                    </Typography>
                </Box>
            );
        }

        // tabIndex === 2: Breakdown (multi-char) or Used In (single-char)
        return breakdownTabHasContent ? (
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
                {/* "Why These Characters": one row per character that abbreviates a
                    fuller word. Renders only when at least one such character exists. */}
                {hasRationale && (
                    // No validation field covers characterRationale yet (docs/DATA_VALIDATION_SYSTEM.md),
                    // so it can never be human-approved — always renders the AI-generated treatment.
                    <Box
                        className="mobile-demo-character-rationale-section mobile-demo-character-rationale-section--ai-generated"
                        sx={{
                            ...aiGeneratedSurfaceSx,
                            borderRadius: "10px",
                            padding: "12px 14px",
                            display: "flex",
                            flexDirection: "column",
                            gap: "8px",
                        }}
                    >
                        <AiGeneratedBadge className="mobile-demo-character-rationale-ai-badge" label="AI GENERATED" />
                        <SharedCharsLabel className="mobile-demo-character-rationale-label">
                            Why These Characters
                        </SharedCharsLabel>
                        <Box className="mobile-demo-character-rationale-list" sx={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                            {rationaleItems.map((item, index) => (
                                <Box
                                    key={index}
                                    className="mobile-demo-character-rationale-row"
                                    sx={{ display: "flex", alignItems: "baseline", gap: "10px" }}
                                >
                                    <ForeignText
                                        size="sm"
                                        justifyContent="flex-start"
                                        className="mobile-demo-character-rationale-char"
                                        text={item.char}
                                        showPinyin={false}
                                        useToneColor={showPinyinColor}
                                    />
                                    <Typography
                                        className="mobile-demo-character-rationale-arrow"
                                        sx={{ fontSize: SIZE.body, color: fc.textSecondary, lineHeight: LEADING.normal }}
                                    >
                                        →
                                    </Typography>
                                    <ForeignText
                                        size="sm"
                                        justifyContent="flex-start"
                                        className="mobile-demo-character-rationale-implied-word"
                                        text={item.impliedWord}
                                        showPinyin={false}
                                        useToneColor={showPinyinColor}
                                    />
                                </Box>
                            ))}
                        </Box>
                    </Box>
                )}
            </Box>
        ) : (
            <Box className="mobile-demo-tab-empty" sx={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 2 }}>
                <Typography sx={{ fontSize: SIZE.body, color: fc.textSecondary, textAlign: "center", fontFamily: FC_FONT }}>
                    {isSingleChar ? "No words use this character yet" : "Breakdown not available for this card"}
                </Typography>
            </Box>
        );
    };

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
                        size={headerCpcdSize}
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
                            fontSize: SIZE.bodyLg,
                            fontWeight: WEIGHT.medium,
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
                {/* Only discoverable entries can be added to Learn Now —
                    lookup-only (undiscoverable) dictionary words hide the button. */}
                {onAddToLibrary && currentEntry && currentEntry.discoverable && (
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
                {/* Writing-practice + audio + compare icons stacked vertically. Any may be
                    absent (non-zh / no onSpeak / no onOpenCompare), in which case the column
                    simply holds whichever render. */}
                {currentEntry && (onSpeak || currentEntry.language === "zh" || onOpenCompare) && (
                    <Box
                        className="mobile-demo-eic-actions"
                        sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0.25 }}
                    >
                        <PracticeWritingButton
                            character={currentEntry.entryKey}
                            language={currentEntry.language}
                            vocabEntryId={currentEntry.id}
                            iconOnly
                        />
                        {onSpeak && (
                            <SpeakerButton
                                onClick={() => onSpeak(currentEntry)}
                                isLoading={speakingKey === currentEntry.entryKey}
                            />
                        )}
                        {onOpenCompare && (
                            <IconButton
                                className="mobile-demo-eic-compare"
                                size="small"
                                aria-label="Compare with another word"
                                onClick={(e) => {
                                    // Match SpeakerButton's stop-propagation pattern so taps
                                    // don't bubble to flip/drag handlers in any wrapping card.
                                    e.stopPropagation();
                                    onOpenCompare(currentEntry);
                                }}
                                onMouseDown={(e) => e.stopPropagation()}
                                onTouchStart={(e) => e.stopPropagation()}
                                onTouchEnd={(e) => e.stopPropagation()}
                                sx={{
                                    color: fc.textSecondary,
                                    '&:hover': { color: fc.onSurface },
                                }}
                            >
                                <CompareArrowsIcon fontSize="small" />
                            </IconButton>
                        )}
                    </Box>
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
                                fontSize: SIZE.caption,
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

            {/* Scrollable tab body. Swipe-to-change-tab gesture listeners are
                attached imperatively (see the useEffect above) rather than
                as JSX onTouch* props — see that effect's comment for why. */}
            <Box
                ref={scrollRef}
                className="mobile-demo-eic-scroll"
                sx={{
                    flex: 1,
                    minHeight: 0,
                    // Split from a single `overflow: "auto"`: the sliding
                    // track below is deliberately 200% wide (two panes) and
                    // overflows this box horizontally by design — overflowX
                    // must stay hidden so that never shows a scrollbar or
                    // becomes natively scrollable, while overflowY stays auto
                    // for normal vertical content scroll within whichever pane
                    // is showing.
                    // Permanently reserve the vertical-scrollbar gutter. Without
                    // this, on platforms with classic (space-consuming)
                    // scrollbars — Windows/WSL browsers — the scrollbar that
                    // appears mid-slide (two panes mounted ⇒ taller track ⇒
                    // vertical overflow) steals ~15px of content width. Because
                    // the track/panes are sized in percentages (200%/50%) of
                    // that content box, every pane and its CPCD/example children
                    // re-layout narrower while the scrollbar is present, then
                    // snap back wider when it disappears at settle — the visible
                    // "grow then shrink." Reserving the gutter keeps the content
                    // width constant across the 1-pane⇄2-pane transition, so the
                    // percentages resolve to the same px the whole time.
                    // (Overlay-scrollbar platforms never had the bug; this is a
                    // no-op there.)
                    scrollbarGutter: "stable",
                    overflowX: "hidden",
                    overflowY: "auto",
                    padding: "16px 18px 8px",
                    overscrollBehavior: "contain",
                    touchAction: scrollTouchAction,
                }}
            >
                {(() => {
                    // The track is rendered ALWAYS (idle and mid-slide) with a
                    // STABLE structure — this is the crux of the no-reflow fix.
                    // Earlier the idle state rendered the tab content as a bare
                    // child of the scroll box and only wrapped it in track/pane
                    // Boxes during a slide; that structural swap made React
                    // unmount + remount the visible subtree at both the start
                    // AND the end of every slide, and each fresh mount re-ran
                    // the layout effects inside its CPCD / definition / example
                    // children, which settle their size on mount — the visible
                    // "grow then shrink." Keeping the track permanent, and
                    // KEYING each pane by its tab index, lets React preserve the
                    // currently-visible pane's DOM instance across the
                    // rest↔slide transitions: only the incoming pane mounts
                    // (off-screen, while sliding in), never the one you're
                    // looking at.
                    //
                    // Idle: one pane (the current tab) filling the box (100%
                    // track, 100% pane). Mid-slide: two panes ordered [min,max]
                    // on a 200% track, each 50%; basePercent (% of the track,
                    // one pane = 50%) + the live offsetPx finger delta position
                    // it via calc(). All widths are relative, so a pane can
                    // never disagree with the resting width either.
                    const twoPane = !!slide;
                    const paneIndices = slide
                        ? [Math.min(slide.from, slide.to), Math.max(slide.from, slide.to)]
                        : [effectiveTab];
                    return (
                        <Box
                            className="mobile-demo-tab-slide-track"
                            onTransitionEnd={(e) => {
                                if (e.propertyName === "transform") setSlide(null);
                            }}
                            sx={{
                                display: "flex",
                                width: twoPane ? "200%" : "100%",
                                transform: slide
                                    ? `translateX(calc(${slide.basePercent}% + ${slide.offsetPx}px))`
                                    : "none",
                                transition: slide?.animated ? TAB_SWIPE_TRANSITION : "none",
                            }}
                        >
                            {paneIndices.map((idx) => (
                                <Box key={idx} sx={{ flex: twoPane ? "0 0 50%" : "0 0 100%", minWidth: 0 }}>
                                    {renderTabContent(idx)}
                                </Box>
                            ))}
                        </Box>
                    );
                })()}
            </Box>
        </Box>
    );
});

export default InfoCardPanelBody;
