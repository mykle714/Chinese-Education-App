import React, { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from "react";
import { Box, IconButton, Typography, useTheme } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { resolveDisplayDefinition, resolveDisplayPronunciation } from "../../../utils/definitionUtils";
import ForeignText, { type CPCDSize } from "../../../components/ForeignText";
import { sheetEdgeFadeSx } from "../../../components/sheet/sheetStyled";
import SensePicker from "../card/SensePicker";
import { ddTextColor } from "../../../utils/cardTextColor";
import InfoCardTabContent from "./InfoCardTabContent";
import { tabAvailability } from "./infoCardTabAvailability";
import {
    InfoSheetEntryHeader,
    InfoSheetTabStrip,
    InfoSheetTab,
} from "./styled";
import {
    TAB_LABELS,
    FC_FONT,
    TAB_SWIPE_AXIS_LOCK_PX,
    TAB_SWIPE_COMMIT_RATIO,
    TAB_SWIPE_EDGE_RUBBER_MAX_PX,
    TAB_SWIPE_EDGE_RUBBER_RATIO,
    TAB_SWIPE_TRANSITION,
} from "../constants";
import { WEIGHT } from "../../../theme/scale";
import { SpeakerButton } from "./FlashCardSection";
import type { VocabEntry, BreakdownItem, UsedInItem } from "../types";

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
    // so it survives tab switches. Drives the header's SensePicker, the header dd +
    // pronunciation, and the definition tab's long definition / commonality.
    selectedSenseIndex?: number;
    // A pick in the header's SensePicker. The host both records it (so the panel
    // re-renders) and persists it to the vet row when there is one — mirroring the
    // flashcard/cdp pickers. Undefined hides the picker entirely.
    onSelectSense?: (index: number) => void;
    // Appends Synonyms + Related Words to the definition tab. cdp only — see
    // InfoCardTabContent's `showSynonymsRelated` for why it is a section and not a tab.
    showSynonymsRelated?: boolean;
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
    onBreakdownItemClick,
    onUsedInItemClick,
    onExampleSegmentClick,
    onSpeak,
    onAddToLibrary,
    onSpeakSentence,
    speakingKey,
    headerCpcdSize = "md",
    scrollTouchAction = "auto",
    headerDragBind,
    selectedSenseIndex,
    onSelectSense,
    showSynonymsRelated,
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
    // True for the single frame in which an entry change is repositioning the sub-tab
    // track with its transition off (see the entry-jump layout effect below).
    const entryJumpRef = useRef(false);
    // Entry key the sub-tab track is currently positioned for; see the entry-jump effect.
    const lastEntryKeyRef = useRef(currentEntry?.entryKey);
    useImperativeHandle(ref, () => ({
        get root() { return rootRef.current; },
        // The scrollable element is the ACTIVE tab's pane. SheetPanel captures
        // this once per bodyKey, so InfoCardSection folds selectedTab into its
        // bodyKey to re-bind the scroll/resize coupling on every tab change.
        get scroll() { return paneRefs.current[selectedTabRef.current] ?? null; },
    }), []);

    const theme = useTheme();
    const fc = theme.palette.flashcard;

    // Per-tab emptiness + the entry-derived values the tab bodies render. Derived ONCE
    // and shared with InfoCardTabContent so the greyed-out tab labels and the panes
    // can never disagree. See InfoCardTabContent.tsx.
    const avail = tabAvailability(currentEntry, breakdownItems, selectedSenseIndex);
    const { breakdownTabLabel } = avail;

    const tabIsEmpty = [!avail.definition, !avail.examples, !avail.breakdown];

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
        // entryJumpRef: an entry change is repositioning the track this frame with the
        // transition switched off (see the layout effect below). Clearing the inline
        // styles here would put the transition straight back and let the very slide we
        // are suppressing play out.
        if (track && dragDxRef.current === null && !entryJumpRef.current) {
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
            if (dragDxRef.current === null) {
                track.style.transition = "";
                track.style.transform = "";
            }
        };
    }, [currentEntry?.entryKey, selectedTab]);

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
                    // into SheetPanel's own touchmove handler, which locks its
                    // gesture into "resize" mode and shrinks the sheet by those
                    // few px. If the gesture then resolves "x" here, SheetPanel
                    // never sees another move but still gets the touchend, and
                    // reads "resize mode + height now a hair below the default
                    // stop" as "user dragged the sheet down and released" —
                    // DISMISSING the panel out from under the swipe. Blocking
                    // from the very first event avoids this entirely:
                    // SheetPanel's gestureMode simply never gets set for a
                    // gesture that turns out horizontal, and its touchend
                    // handler no-ops on a null mode. (No preventDefault yet — if this resolves
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
            // Toward a neighboring tab: clamp the finger delta to at most one
            // pane, so the track can never be dragged past the next resting
            // position. Toward an END of the strip (left on the last tab, right
            // on the first): rubber-band instead of clamping to zero — a dead
            // track reads as "swipe not supported on this tab" rather than "you
            // are at the end". The damped travel is capped far below the commit
            // threshold, and settleDrag rejects out-of-range targets, so an
            // overscroll always springs back.
            const hasNeighbor = dx < 0 ? tab < TAB_LABELS.length - 1 : tab > 0;
            const clampedDx = hasNeighbor
                ? Math.max(-paneWidthRef.current, Math.min(paneWidthRef.current, dx))
                : Math.sign(dx) *
                  Math.min(TAB_SWIPE_EDGE_RUBBER_MAX_PX, Math.abs(dx) * TAB_SWIPE_EDGE_RUBBER_RATIO);
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
                        // Sense-resolved, like the dd printed beside it. The panel's own live
                        // pick is the override so the reading changes on the tap, ahead of the
                        // persisted `selectedSense` round-tripping back (useEipTabs.syncEntry).
                        pronunciation={resolveDisplayPronunciation(currentEntry, selectedSenseIndex)}
                        useToneColor={showPinyinColor}
                        showPinyin={showPinyin}
                    />
                )}
                {/* Header action buttons laid out as a 2-column grid (reading order:
                    Speaker · Add-to-library). Either cell may be absent — Speaker needs
                    onSpeak and Add needs onAddToLibrary on a discoverable entry — so the
                    grid auto-packs whatever renders and an unused column collapses to
                    zero width.
                    The header keeps ONLY the actions that are about the ENTRY ITSELF —
                    hear it, save it. CARD operations have left the panel for good: the
                    artboards make it information-only, so add-to-deck went onto the card's
                    own `•••` rail and Practice Writing onto the word-tools rail above the
                    card. `InfoCardActionBar`, which used to carry all three at the end of
                    the definition tab, is deleted. Compare lives ONLY on `WordToolsRail`
                    above the card (removed from this header 2026-09-04).

                    Sits immediately after the headword rather than at the far right,
                    because the far right now belongs to the sense chip — reading order
                    is identity (word, how to hear it) → meaning → which sense. */}
                {currentEntry && (
                    onSpeak ||
                    (onAddToLibrary && currentEntry.discoverable)
                ) && (
                    <Box
                        className="mobile-demo-eic-actions"
                        sx={{
                            display: "grid",
                            gridTemplateColumns: "repeat(2, auto)",
                            alignItems: "center",
                            justifyItems: "center",
                            columnGap: 0.25,
                            rowGap: 0.25,
                        }}
                    >
                        {onSpeak && (
                            <SpeakerButton
                                onClick={() => onSpeak(currentEntry)}
                                isLoading={speakingKey === currentEntry.entryKey}
                            />
                        )}
                        {/* Only discoverable entries can be added to Learn Now —
                            lookup-only (undiscoverable) dictionary words hide the button. */}
                        {onAddToLibrary && currentEntry.discoverable && (
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
                    </Box>
                )}
                {/* `.eid` — the gloss of the SHOWING sense, right-aligned into the space
                    between the headword and the sense chip, with the chip pinned to the
                    far edge.

                    Right-aligned on purpose: the chip is what the gloss belongs to, so
                    setting the text against it reads as one statement ("this is what it
                    means · sense 1 of 9") instead of two things at opposite ends of a
                    rule. The chip is the SAME control, in the SAME place, on the card, the
                    card detail and here — a pick made on any of them swaps everything
                    below, which is why the panel needs no sense list of its own. */}
                {currentEntry && (
                    <Box
                        className="mobile-demo-eic-header-english-row"
                        sx={{ display: "flex", alignItems: "center", gap: 1, flex: 1, minWidth: 0, justifyContent: "flex-end" }}
                    >
                    <Typography
                        className="mobile-demo-eic-header-english"
                        sx={{
                            flex: 1,
                            minWidth: 0,
                            textAlign: "right",
                            // Bumped 12.5 → 14.5 (2026-09-04): the gloss is the header's
                            // payload and was reading as a caption. The header row has the
                            // width for it now that the Compare button left the action grid.
                            fontSize: 14.5,
                            letterSpacing: "-0.008em",
                            fontWeight: WEIGHT.regular,
                            // Matches the flp card face via the shared dd color helper: zh
                            // renders at full contrast, other languages are de-emphasized one
                            // step off `onSurface` via the `dd` token.
                            // (No Contrast pick is applied here — as before, this header
                            // follows the card theme only, not the per-card override.)
                            color: ddTextColor(currentEntry.language, undefined, fc),
                            fontFamily: FC_FONT,
                            lineHeight: 1.35,
                        }}
                    >
                        {/* The eip header gloss is a dd: it must agree with the flashcard face,
                            so it resolves through the shared resolver (chosen sense →
                            definitions[0] fallback) instead of reading definitions[0] directly. */}
                        {resolveDisplayDefinition(currentEntry, selectedSenseIndex)}
                    </Typography>
                    {/* Same picker component the card face mounts (docs/DEFINITION_CLUSTERS.md).
                        Self-hides when the entry has no real choice of sense. Readings are
                        never censored here — the eip is a reference surface, not a quiz face. */}
                    {onSelectSense && (
                        <SensePicker
                            entry={currentEntry}
                            selectedSenseIndex={selectedSenseIndex}
                            onSelectSense={onSelectSense}
                            color={fc.textSecondary}
                            classPrefix="mobile-demo-eic"
                        />
                    )}
                    </Box>
                )}
            </InfoSheetEntryHeader>

            {/* Underline tab strip. Also acts as a drag-to-resize handle
                (same bindHeaderDrag as the header) so a vertical drag started
                on the tabs resizes the sheet on desktop too — on touch the
                root's raw resize listeners already cover it. useDrag's
                filterTaps keeps tab-selection taps working. */}
            <InfoSheetTabStrip
                className="mobile-demo-tabs"
                {...(headerDragBind ? headerDragBind() : {})}
                sx={headerDragBind ? { touchAction: "none", cursor: "grab" } : undefined}
            >
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
                            {/* Lower case, as the artboards set it: these are three words
                                in a strip, not three headings, and Title Case here made
                                them compete with the gloss directly above. */}
                            <Typography sx={{
                                fontSize: 12,
                                fontWeight: WEIGHT.semibold,
                                color: selectedTab === index ? fc.onSurface : fc.textSecondary,
                                fontFamily: FC_FONT,
                                userSelect: "none",
                                lineHeight: 1,
                            }}>
                                {displayLabel}
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
                                // Each pane fades out at its own bottom edge, so a
                                // long definition dissolves into the panel's edge
                                // rather than being sliced by it. The mask is anchored
                                // to the pane's box, so the band stays parked at the
                                // bottom while the content scrolls under it.
                                // (sheetStyled § Sheet bottom edge fade.)
                                ...sheetEdgeFadeSx,
                            }}
                        >
                            <InfoCardTabContent
                                tabIndex={index}
                                currentEntry={currentEntry}
                                breakdownItems={breakdownItems}
                                avail={avail}
                                showPinyin={showPinyin}
                                showPinyinColor={showPinyinColor}
                                onBreakdownItemClick={onBreakdownItemClick}
                                onUsedInItemClick={onUsedInItemClick}
                                onExampleSegmentClick={onExampleSegmentClick}
                                onSpeakSentence={onSpeakSentence}
                                speakingKey={speakingKey}
                                selectedSenseIndex={selectedSenseIndex}
                                showSynonymsRelated={showSynonymsRelated}
                            />
                        </Box>
                    ))}
                </Box>
            </Box>
        </Box>
    );
});

export default InfoCardPanelBody;
