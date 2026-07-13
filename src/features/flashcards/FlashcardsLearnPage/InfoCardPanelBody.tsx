import React, { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from "react";
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

// Resting track offset for a tab: the track is (N·100%) wide with N equal
// panes, so showing tab k means shifting the track left by exactly k panes,
// i.e. k·(100/N)% of the track's own width.
const restingTransform = (tab: number) => `translateX(${(-tab * 100) / TAB_LABELS.length}%)`;

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
    // Clipping viewport around the sliding tab track. NOT itself scrollable —
    // each tab pane inside the track is its own vertical scroller.
    const clipRef = useRef<HTMLDivElement | null>(null);
    const trackRef = useRef<HTMLDivElement | null>(null);
    // One scroll container per tab pane, indexed by tab. Every pane is always
    // mounted (see the track JSX), so these are stable for the panel's life.
    const paneRefs = useRef<(HTMLDivElement | null)[]>([]);
    // Mirror of selectedTab readable from the mount-once gesture listeners and
    // the imperative handle getter (both live outside the render cycle).
    const selectedTabRef = useRef(selectedTab);
    useImperativeHandle(ref, () => ({
        get root() { return rootRef.current; },
        // The scrollable element is the ACTIVE tab's pane. SheetPanel captures
        // this once per bodyKey, so InfoCardSection folds selectedTab into its
        // bodyKey to re-bind the scroll/resize coupling on every tab change.
        get scroll() { return paneRefs.current[selectedTabRef.current] ?? null; },
    }), []);

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

    // --- Swipe-to-change-tab ------------------------------------------------
    // All three tab panes are ALWAYS mounted side by side on a permanent
    // (N·100%)-wide track (see the JSX below); changing tabs — by tap or by
    // swipe — never mounts, unmounts, restyles, or resizes anything. It only
    // moves the track's transform:
    //
    //   · Tap: purely declarative. selectedTab changes → the sx transform
    //     changes → the track's persistent CSS transition animates it. No JS
    //     animation lifecycle at all.
    //   · Finger drag: the raw listeners below override transform/transition
    //     via INLINE styles only (no React state per touchmove), then hand
    //     control back to the declarative value on release.
    //
    // This is deliberately NOT a state machine. Earlier designs mounted a
    // temporary two-pane track per slide and tore it down on transitionend;
    // a dropped touch sequence (native-scroll intervention) or a missed
    // transitionend left the panel visibly frozen mid-slide, and the mount/
    // unmount cycles caused settling reflows. Inline overrides that are
    // cleared on release, on the next tab render, AND on the next touchstart
    // (see the self-heal notes below) cannot wedge that way — the resting
    // position always belongs to plain CSS.
    //
    // Because every pane is its own scroller, tabs also stop sharing scroll
    // state: switching tabs can't clamp/jump scrollTop when a tall tab's
    // content leaves, and each tab remembers its own scroll position.
    // Pane width in px (= clip-box width; pane padding lives inside the
    // pane). Feeds only the gesture threshold/clamp math — layout is purely
    // percentage-based, so this never has to be pixel-perfect.
    const paneWidthRef = useRef(0);
    const touchStartRef = useRef<{ x: number; y: number } | null>(null);
    // null = undecided (within the axis-lock slop), "x" = swipe owns the
    // gesture, "y" = handed off untouched to SheetPanel's vertical listener.
    const swipeAxisRef = useRef<"x" | "y" | null>(null);
    // Live finger delta of an in-flight horizontal drag; null = no drag.
    // Doubles as the "drag in flight" flag for the self-heal paths.
    const dragDxRef = useRef<number | null>(null);
    const onTabChangeRef = useRef(onTabChange);
    onTabChangeRef.current = onTabChange;

    useLayoutEffect(() => {
        const el = clipRef.current;
        if (!el) return;
        const update = () => { paneWidthRef.current = el.clientWidth; };
        update();
        const ro = new ResizeObserver(update);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    // Keep selectedTabRef in sync, and clear any inline transform/transition
    // a drag left behind once the declarative resting transform owns the
    // position again. On a committed swipe the inline transform was already
    // set to this tab's resting value, so removing it here is visually a
    // no-op and the in-flight CSS transition continues undisturbed. This is
    // also a self-heal: even if a drag's release was swallowed entirely, the
    // next tab change re-normalizes the track.
    useEffect(() => {
        selectedTabRef.current = selectedTab;
        const track = trackRef.current;
        if (track && dragDxRef.current === null) {
            track.style.transition = "";
            track.style.transform = "";
        }
    }, [selectedTab]);

    // New entry in the same panel (entry-tab switch / breakdown drill-in):
    // start every pane back at its top — scroll positions are per-pane now.
    useEffect(() => {
        for (const pane of paneRefs.current) {
            if (pane) pane.scrollTop = 0;
        }
    }, [currentEntry?.entryKey]);

    // Gesture listeners are raw `addEventListener`s (not React onTouch* JSX
    // props) attached directly to the clip box, mirroring SheetPanel's own
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
    // listener on the clip box (a descendant of rootRef) puts us earlier
    // in the real bubble order, so our stopPropagation() actually works.
    useEffect(() => {
        const el = clipRef.current;
        if (!el) return;

        // Settle an in-flight drag to a resting position: commit the tab
        // change when the finger traveled past the commit threshold, else
        // snap back. Restores the persistent CSS transition first so the
        // remaining travel animates. Called from touchend/touchcancel, and
        // from touchstart if a previous drag's release was swallowed by the
        // browser (native-scroll intervention) — so a dropped gesture can
        // freeze the track only until the next touch or tab change.
        const settleDrag = () => {
            const dx = dragDxRef.current;
            dragDxRef.current = null;
            const track = trackRef.current;
            if (track === null || dx === null) return;
            const tab = selectedTabRef.current;
            const target = dx < 0 ? tab + 1 : tab - 1;
            const committed =
                target >= 0 &&
                target <= TAB_LABELS.length - 1 &&
                Math.abs(dx) > paneWidthRef.current * TAB_SWIPE_COMMIT_RATIO;
            track.style.transition = ""; // back to the sx transition
            if (committed) {
                // Aim the inline transform at the target immediately so the
                // snap animation starts this frame; the declarative transform
                // catches up to the SAME value when onTabChange re-renders,
                // and the selectedTab effect above then clears the (now
                // redundant) inline override without disturbing the motion.
                track.style.transform = restingTransform(target);
                onTabChangeRef.current(target);
            } else {
                // Not committed: drop the override — the computed style falls
                // back to the current tab's resting transform and animates back.
                track.style.transform = "";
            }
        };

        const onTouchStart = (e: TouchEvent) => {
            if (e.touches.length !== 1) return;
            if (dragDxRef.current !== null) settleDrag(); // self-heal a swallowed release
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
            const track = trackRef.current;
            if (!track) return;
            const tab = selectedTabRef.current;
            // Clamp the finger delta to at most one pane in either direction,
            // and to zero toward a direction with no neighboring tab — the
            // track can never be dragged past a resting edge.
            const min = tab >= TAB_LABELS.length - 1 ? 0 : -paneWidthRef.current;
            const max = tab <= 0 ? 0 : paneWidthRef.current;
            const clampedDx = Math.max(min, Math.min(max, dx));
            dragDxRef.current = clampedDx;
            // Drive the drag with inline styles only — no React work per move.
            track.style.transition = "none";
            track.style.transform = `translateX(calc(${(-tab * 100) / TAB_LABELS.length}% + ${clampedDx}px))`;
        };

        const onTouchEnd = () => {
            touchStartRef.current = null;
            swipeAxisRef.current = null;
            if (dragDxRef.current !== null) settleDrag();
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
    // index — rendered once per tab into that tab's permanently-mounted pane
    // on the slide track.
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
                            word1={currentEntry?.entryKey}
                            language={currentEntry?.language}
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

            {/* Tab body: a clipping viewport over a permanent 3-pane track.
                Every pane is always mounted and is its own vertical scroller,
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
                        <Box
                            key={index}
                            ref={(node: HTMLDivElement | null) => { paneRefs.current[index] = node; }}
                            className="mobile-demo-eic-scroll mobile-demo-tab-pane"
                            sx={{
                                flex: `0 0 ${100 / TAB_LABELS.length}%`,
                                minWidth: 0,
                                height: "100%",
                                overflowX: "hidden",
                                overflowY: "auto",
                                // Reserve the scrollbar gutter permanently so a
                                // pane's content width never depends on whether
                                // it currently overflows (classic-scrollbar
                                // platforms would otherwise reflow content when
                                // the scrollbar toggles).
                                scrollbarGutter: "stable",
                                padding: "16px 18px 8px",
                                overscrollBehavior: "contain",
                                touchAction: scrollTouchAction,
                            }}
                        >
                            {renderTabContent(index)}
                        </Box>
                    ))}
                </Box>
            </Box>
        </Box>
    );
});

export default InfoCardPanelBody;
