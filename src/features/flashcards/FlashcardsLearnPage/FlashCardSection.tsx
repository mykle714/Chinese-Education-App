import React from "react";
import { Box, Card, CardContent, Typography, useTheme } from "@mui/material";
import { senseLabelForIndex, resolveSelectedSenseIndex } from "../../../utils/definitionUtils";
import { DraggableCardContainer, SwipeHintLabel, FlipHintLabel, cardSlotPadding, type CardSlotPadding } from "./styled";
import {
    CORRECT_WASH,
    INCORRECT_WASH,
    CARD_DISMISS_THRESHOLD_VW,
    CARD_FLY_OUT_TRANSITION,
    CARD_FLY_OUT_MS,
    CARD_FLIP_TRANSITION,
    CARD_FLIP_MS,
    FC_FONT,
} from "../constants";
import { SIZE, WEIGHT } from "../../../theme/scale";
import { CARD_SURFACE } from "../../../theme/surfaces";
import type { VocabEntry, SideOneLanguage } from "../types";
import { isAdvancedLayout } from "../../../cardIcons/cardIconLayout";
import { SpeakerButton } from "../../../components/SpeakerButton";

// The SpeakerButton passthrough predates this file; kept so callers can keep importing
// it from here.
export { SpeakerButton };

// The card FACE primitives moved to ../card/CardFace.tsx — every non-drill surface in
// the app renders them, so they no longer live inside this page folder. Re-exported
// here so existing `from "./FlashCardSection"` imports keep working.
// See docs/ARCHITECTURE_REVIEW.md finding 9.
export { ChineseBlock, EnglishBlock, CardFaceSide } from "../card/CardFace";
import { CardFaceSide, ChineseBlock, EnglishBlock } from "../card/CardFace";
import CardNote from "../card/CardNote";

interface FlashCardSectionProps {
    currentEntry: VocabEntry | null;
    nextEntry: VocabEntry | null;
    activeFrontSlot: 0 | 1;
    flyOut: { slot: 0 | 1; direction: 'left' | 'right' } | null;
    cardRef: React.RefObject<HTMLDivElement | null>;
    dragPosition: { x: number; y: number };
    isDragging: boolean;
    isFlipped: boolean;
    isAnimating: boolean;
    selectedCategory: string | null;
    // Overrides the default empty-state text when present (e.g. mode run-out:
    // "No more easy cards remaining.").
    emptyMessage?: string;
    showPinyin: boolean;
    showPinyinColor: boolean;
    // The READING flp (`?bar=reading`, any mode, docs/READING_WRITING_CENTERS.md § Phase 4): the
    // question face shows the characters ALONE — no pinyin, no speaker — and the answer
    // face always shows pinyin, whatever the learner's showPinyin setting is.
    readingMode?: boolean;
    // When true, the card's progress category renders as a colored chip on Side 2.
    // Side 1 language for the front-slot card. Side 2 always shows both.
    sideOneLanguage: SideOneLanguage;
    // Side 1 language for the back-slot (peeking) card — different random value
    // so promoting it on dismiss doesn't flash the wrong language.
    nextSideOneLanguage: SideOneLanguage;
    // Swipe-tutorial state from useCardDrag: shake the front card on each new
    // nonce, and fade the ← Incorrect / Correct → labels in/out with showSwipeHint.
    showSwipeHint: boolean;
    // "Tap to flip" hint shown when user attempts to drag a card that hasn't
    // been flipped yet. Mirrors the swipe-direction tutorial.
    showTapToFlipHint: boolean;
    shakeNonce: number;
    handlers: {
        onTouchStart: (e: React.TouchEvent) => void;
        onTouchEnd: (e: React.TouchEvent) => void;
        onMouseDown: (e: React.MouseEvent) => void;
    };
    // Optional speaker callback. When provided, a speaker icon button is
    // rendered on card sides that contain Chinese text. Undefined when narration
    // is disabled in settings — icon is hidden entirely.
    onSpeak?: (entry: VocabEntry, senseIndexOverride?: number) => void;
    // The text currently being narrated by useTTS, or null when idle. Forwarded
    // to the speaker button so only the active card's icon shows the loading
    // spinner during playback.
    speakingKey?: string | null;
    // The live icon-layout edit canvas, built by the page when edit mode is on. It is
    // applied only to the ACTIVE FRONT card's back face. See docs/CARD_ICON_LAYOUT.md.
    editCanvas?: React.ReactNode;
    // Persist a card's definition-cluster sense pick per account (migration 99). Threaded to
    // each CardFace; the page supplies the PATCH-backed handler. See docs/DEFINITION_CLUSTERS.md.
    onPersistSense?: (entry: VocabEntry, sense: string | null) => void;
    // True while the icon-layout editor is open. Locks the card: drag/flip handlers
    // are not attached so the card can't be swiped away or flipped mid-edit.
    editMode?: boolean;
    // Extra top padding (px) the slot reserves for the advanced-edit toolbar — 0 unless the
    // toolbar would actually intrude past the slot's normal top pad. Measured by the page
    // (useToolbarInset); the container just gets shorter and centering re-places the card.
    toolbarInset?: number;
    // The slot's vertical padding — where the card sits, and (when height-bound) how big it
    // is. Computed by the page from the measured slot + More Info pill (useCardSlotPadding)
    // rather than fixed here, because the bottom pad has to reserve the pill's band. Optional
    // so the surfaces that render a card slot without a pill keep the default reservation.
    pad?: CardSlotPadding;
    // Lets the page measure the slot (useCardSlotPadding / useToolbarInset both need its
    // height, and neither can reach it from ContentArea once the word-tools rail is above it).
    slotRef?: React.Ref<HTMLDivElement>;
    // The card-operations rail (`CardOpsRail`, artboard 21), composed by the page and
    // mounted on the ACTIVE FRONT card's answer face. A node rather than three callbacks
    // so this component — which the cdp and three other surfaces also render through —
    // never learns what a card operation is.
    topRail?: React.ReactNode;
    // ── Card note (vet.note, migration 155) ──────────────────────────────────
    // The note itself is read straight off the entry and rendered on the ANSWER face by
    // this component (every card that has one shows it, on every surface). These three
    // props are only about EDITING it in place, which is the flp's business: the page owns
    // "which card's note is open" so the same state can gate the drag handlers.
    // See docs/CARD_NOTES.md.
    noteEditing?: boolean;
    onSaveNote?: (note: string | null) => void;
    onCancelNote?: () => void;
    // ── Writing flp (`?bar=writing`, docs/WRITING_PRACTICE_REWORK.md § 3) ──────────
    // Same card, same stack, same flip and fly-out — only the CONTENT differs. When set,
    // both faces of every card are drawn by this callback (no word blocks, icons, note
    // or card-ops rail). `role` tells the host which card it is drawing: the active
    // FRONT card, the PEEKing card behind it, or the card FLYING out.
    //
    // A writing card is never swiped: the host passes inert drag handlers, flips the
    // card itself on a submit tap, and dismisses it by calling the loop. `onCardClick` is
    // the tap on the front card's body — on the front face it submits (or wiggles the
    // card via the host's `shakeNonce` while a cell is empty); on the back it is the
    // "tap anywhere to continue".
    writingFace?: WritingFaceRenderer;
    onCardClick?: () => void;
}

export type WritingFaceRenderer = (entry: VocabEntry, side: "front" | "back", role: "front" | "peek" | "flying") => React.ReactNode;


// Fallback slot padding for callers that don't measure (no More Info pill on the surface).
// Uses the unmeasured-slot branch: resting top pad + the default affordance reservation.
const DEFAULT_CARD_SLOT_PADDING = cardSlotPadding(0);

// How far off-screen to throw the card (px). 900px safely clears the 402px frame on all viewports.
const FLY_OUT_X = 900;
// Rotation (deg) applied when the card flies off — more dramatic than the gentle drag tilt.
const FLY_OUT_ROTATION = 30;

/**
 * Writing flp's throw — the card is sent off by the SYSTEM (a tap or a swipe attempt on
 * its graded back), never dragged, so there is no release point to fly from. Instead it
 * plays a keyframe "grab and throw": the card lifts (grows to WRITING_THROW_LIFT_SCALE, rises, tilts a touch
 * toward its exit side), then accelerates off along a swiping arc — sideways with a
 * rising-then-falling y and a growing tilt, like a hand flicking it.
 *
 * A keyframe animation (not a transition) on purpose: on dismiss the flying slot's key
 * changes (`front-N` → `slot-X`), so the wrapper remounts — a transition would have no
 * "from" state and the card would jump straight off-screen. An animation plays on mount.
 * Total length is CARD_FLY_OUT_MS so the loop's fly-out timeout still lines up.
 *
 * Per-segment timing: the lift (0 → LIFT) eases out; the throw (LIFT → 100%) eases IN
 * (cubic-bezier(0.5, 0, 0.9, 0.5)), which is what reads as acceleration.
 * Docs: docs/WRITING_PRACTICE_REWORK.md § 3.
 */
const WRITING_THROW_LIFT_PCT = 30;
// How much the card grows as it is "picked up" — held through the throw so it reads as
// still in hand. 1.05 was too subtle to register in a ~110 ms lift.
const WRITING_THROW_LIFT_SCALE = 1.1;
// How far (px) the card rises during the lift. The throw's arc keeps climbing a little
// past it (to 60%) before falling away, so the mid-throw y is derived from this.
const WRITING_THROW_LIFT_RISE_PX = 40;
const writingThrowKeyframes = (sign: 1 | -1) => ({
    "0%": {
        transform: "translate(0px, 0px) rotate(0deg) scale(1)",
        animationTimingFunction: "cubic-bezier(0.2, 0.8, 0.3, 1)",
    },
    [`${WRITING_THROW_LIFT_PCT}%`]: {
        transform: `translate(${sign * 14}px, ${-WRITING_THROW_LIFT_RISE_PX}px) rotate(${sign * 3}deg) scale(${WRITING_THROW_LIFT_SCALE})`,
        animationTimingFunction: "cubic-bezier(0.5, 0, 0.9, 0.5)",
    },
    "60%": {
        transform: `translate(${sign * FLY_OUT_X * 0.3}px, ${-(WRITING_THROW_LIFT_RISE_PX + 16)}px) rotate(${sign * FLY_OUT_ROTATION * 0.45}deg) scale(${WRITING_THROW_LIFT_SCALE})`,
        animationTimingFunction: "cubic-bezier(0.4, 0, 1, 1)",
    },
    "100%": {
        transform: `translate(${sign * FLY_OUT_X}px, 40px) rotate(${sign * FLY_OUT_ROTATION}deg) scale(${WRITING_THROW_LIFT_SCALE})`,
    },
});

/** Renders the card face (Side 1 + Side 2 + drag overlay) for a given entry.
 *  Side 1 shows only one language (determined by sideOneLanguage).
 *  Side 2 always shows both Chinese and English stacked. */
const CardFace: React.FC<{
    entry: VocabEntry;
    isFlipped: boolean;
    isAnimating: boolean;
    showPinyin: boolean;
    showPinyinColor: boolean;
    /** See FlashCardSectionProps.readingMode. */
    readingMode?: boolean;
    sideOneLanguage: SideOneLanguage;
    dragPosition: { x: number; y: number };
    dismissThreshold: number;
    isFront: boolean;
    // True for both the active front card and the card currently flying off screen —
    // both should show the full shadow and the green/red drag overlay.
    isProminent: boolean;
    onSpeak?: (entry: VocabEntry, senseIndexOverride?: number) => void;
    speakingKey?: string | null;
    // The live icon-layout edit canvas for THIS card's back face. Only the active
    // front card supplies one (and only while edit mode is on); it replaces the back
    // face's static icon layer. See docs/CARD_ICON_LAYOUT.md.
    editCanvas?: React.ReactNode;
    // Persist the learner's sense pick for THIS card (migration 99). Given the chosen
    // cluster's `sense` label (or null for the default/starred sense). Absent when there's no
    // user context to save into (e.g. the read-only dictionary cdp uses local-only state).
    onPersistSense?: (entry: VocabEntry, sense: string | null) => void;
    // The card-operations rail (`CardOpsRail`, artboard 21). Rendered on the ANSWER face
    // only, and only for the active front card — the host decides both, the same way it
    // decides `editCanvas`. Threaded as a node rather than as three callbacks so this
    // shared component stays ignorant of what a card operation is.
    topRail?: React.ReactNode;
    // ── Card note (vet.note, migration 155) ──────────────────────────────────
    // The note itself is read straight off the entry and rendered on the ANSWER face by
    // this component (every card that has one shows it, on every surface). These three
    // props are only about EDITING it in place, which is the flp's business: the page owns
    // "which card's note is open" so the same state can gate the drag handlers.
    // See docs/CARD_NOTES.md.
    noteEditing?: boolean;
    onSaveNote?: (note: string | null) => void;
    onCancelNote?: () => void;
    // Blank this card's content (both faces) while keeping its surface. Set on the peeking
    // BACK card while the front card is mid-flip — see `flipInProgress` in FlashCardSection.
    contentHidden?: boolean;
    // The writing flp's face content for this card (FlashCardSectionProps.writingFace),
    // already bound to the card's role. Absent on every other bar.
    writingFace?: (side: "front" | "back") => React.ReactNode;
}> = ({ entry, isFlipped, isAnimating, showPinyin, showPinyinColor, readingMode = false, sideOneLanguage, dragPosition, dismissThreshold, isProminent, onSpeak, speakingKey, editCanvas, onPersistSense, topRail, noteEditing, onSaveNote, onCancelNote, contentHidden, writingFace }) => {
    const theme = useTheme();
    const fc = theme.palette.flashcard;

    // Which definitionClusters sense EnglishBlock currently displays (index into its
    // frequency-sorted list). Lives here — not inside EnglishBlock — so Side 1 (English
    // mode) and Side 2 stay in sync on the same pick. On a card change it re-seeds from the
    // entry's PERSISTED choice (`selectedSense` label → sorted index, migration 99), falling
    // back to the top/starred sense when there's no saved pick.
    //
    // It ALSO re-seeds when `selectedSense` changes on the SAME card, which is what keeps the
    // card in step with a pick made in the eip's own header picker: that pick persists through
    // `persistSelectedSense`, whose optimistic session override lands on this entry within the
    // same flp session (no refetch). Without the `selectedSense` dep this local index would
    // out-rank the fresher label and the face would keep showing the previous sense until the
    // card was cycled. A pick made HERE re-runs it too and resolves to the same index, so the
    // round trip is a no-op rather than a flicker. See docs/DEFINITION_CLUSTERS.md.
    const [selectedSenseIndex, setSelectedSenseIndex] = React.useState(() => resolveSelectedSenseIndex(entry));
    React.useEffect(() => { setSelectedSenseIndex(resolveSelectedSenseIndex(entry)); }, [entry.id, entry.selectedSense]); // eslint-disable-line react-hooks/exhaustive-deps

    // A pick updates the in-sync display index immediately (both faces) AND persists the
    // chosen cluster's `sense` LABEL. Index 0 is the default/starred sense, stored as null so
    // an unchosen/default card keeps a clean NULL row (matching the migration's semantics).
    /**
     * Narrate with the LIVE sense pick, not the persisted one.
     *
     * The card face renders `resolveDisplayPronunciation(entry, selectedSenseIndex)`,
     * and a polyphone's reading changes with the sense (和 is hé on "and" and huó on
     * "to blend"). `selectedSenseIndex` moves the instant the picker is tapped, while
     * `entry.selectedSense` only catches up after the persist round-trips — so without
     * this, tapping a new sense leaves the audio one reading behind the pinyin printed
     * directly above it.
     */
    const speakWithSense = React.useCallback(
        (target: VocabEntry) => onSpeak?.(target, selectedSenseIndex),
        [onSpeak, selectedSenseIndex]
    );

    const handleSelectSense = React.useCallback((index: number) => {
        setSelectedSenseIndex(index);
        if (!onPersistSense) return;
        onPersistSense(entry, senseLabelForIndex(entry, index));
    }, [entry, onPersistSense]);

    // Whether this entry is saved (in this account) with an ADVANCED layout — a multi-icon /
    // moved-icon arrangement OR a custom text placement. Gates the advanced-only per-card
    // background fill. The BACK/answer side always renders the advanced layout, so it gets this
    // verdict directly. The FRONT/question side only renders it when Side 1 is English; the
    // Chinese question side is deliberately kept a plain basic card, so it is additionally
    // gated by `sideOneLanguage === 'en'` (this is the flp's "stop the Chinese front" gate,
    // matching the icon layer, which is likewise gated to English-bearing faces via showIcon).
    const isUsingAdvancedLayout = isAdvancedLayout(entry.iconLayout, entry.textLayout);

    // Writing flp: the same card object (wrapper, flip, faces, drag wash), with the
    // writing layout as each face's full-card content. No icons — the writing face has
    // no room for them and its front is a prompt, not a word.
    if (writingFace) {
        return (
            <Card
                className="mobile-demo-flashcard mobile-demo-flashcard--writing"
                sx={{
                    backgroundColor: 'transparent',
                    background: 'none',
                    borderRadius: CARD_SURFACE.borderRadius,
                    boxShadow: isProminent ? fc.cardShadow : CARD_SURFACE.boxShadow,
                    cursor: "pointer",
                    position: "absolute",
                    inset: 0,
                    transformStyle: "preserve-3d",
                    transform: `rotateY(${isFlipped ? 180 : 0}deg)`,
                    transition: isAnimating ? 'none' : CARD_FLIP_TRANSITION,
                    overflow: 'visible',
                }}
            >
                <CardFaceSide rotated={false} contentGap={1} showIcon={false} inert={isFlipped} contentHidden={contentHidden} fill={writingFace("front")} />
                <CardFaceSide rotated contentGap={1} showIcon={false} inert={!isFlipped} contentHidden={contentHidden} fill={writingFace("back")} />
            </Card>
        );
    }

    return (
        <Card
            className="mobile-demo-flashcard"
            sx={{
                backgroundColor: 'transparent',
                background: 'none',
                // The card object — hairline, radius and RESTING elevation from
                // `CARD_SURFACE` (theme/surfaces.ts), shared with the cdp hero card and the
                // Decks page's Mastery Center tiles. The hairline itself is drawn by each
                // FACE (CardFaceSide), not here: this wrapper is transparent and carries the
                // 3D flip, so a border on it would stay put while the faces rotate.
                borderRadius: CARD_SURFACE.borderRadius,
                // The card being HELD (front + flying-out) is lifted off the one behind it;
                // the card behind rests. Same two-tier reading as the Decks page's hand.
                boxShadow: isProminent ? fc.cardShadow : CARD_SURFACE.boxShadow,
                cursor: "pointer",
                position: "absolute",
                inset: 0,
                transformStyle: "preserve-3d",
                transform: `rotateY(${isFlipped ? 180 : 0}deg)`,
                // LINEAR flip (not the fly-out's ease) so 90° lands exactly at the
                // time-midpoint, matching the away-face visibility hide in CardFaceSide.
                transition: isAnimating ? 'none' : CARD_FLIP_TRANSITION,
                overflow: 'visible',
            }}
        >
            {/* Side 1 — shows only one language, chosen randomly per card. The icon
                renders here only when Side 1 is English; on the back it always renders. */}
            <CardFaceSide
                rotated={false}
                contentGap={1}
                contentClassName="mobile-demo-flashcard-text mobile-demo-flashcard-side-one"
                iconId={entry.iconId}
                showIcon={sideOneLanguage === 'en'}
                iconLayout={entry.iconLayout}
                // Front/question side renders the advanced layout (and its background fill) ONLY
                // when it is the English side; the Chinese question side stays a plain basic card.
                isUsingAdvancedLayout={isUsingAdvancedLayout && sideOneLanguage === 'en'}
                cardColor={entry.cardColor}
                // CSS 3D backface culling does NOT reliably exclude the rotated-away
                // face from hit-testing, so the away face must be made inert or it
                // intercepts taps meant for the visible face (e.g. the writing/audio
                // buttons on the back). Side 1 faces away whenever the card is flipped.
                inert={isFlipped}
                contentHidden={contentHidden}
            >
                {sideOneLanguage === 'zh'
                    // Reading mode: the pinyin and the speaker would both hand over the
                    // reading the card is asking for, so the question face drops them.
                    ? <ChineseBlock entry={entry} showPinyin={readingMode ? false : showPinyin} showPinyinColor={showPinyinColor} onSpeak={readingMode ? undefined : speakWithSense} speakingKey={speakingKey} selectedSenseIndex={selectedSenseIndex} />
                    : <EnglishBlock
                        entry={entry}
                        selectedSenseIndex={selectedSenseIndex}
                        onSelectSense={handleSelectSense}
                        // Question side: censor the sense picker's pinyin headings (see the prop).
                        censorReadings
                    />}
            </CardFaceSide>

            {/* Side 2 — always shows both Chinese and English, and the icon arrangement. */}
            <CardFaceSide
                rotated
                contentGap={2}
                contentClassName="mobile-demo-flashcard-side-two"
                iconId={entry.iconId}
                showIcon
                iconLayout={entry.iconLayout}
                textLayout={entry.textLayout}
                // Back/answer side always renders the advanced layout, so it gets the entry verdict.
                isUsingAdvancedLayout={isUsingAdvancedLayout}
                cardColor={entry.cardColor}
                // Two blocks supplied separately so each is positioned absolutely by its center
                // (migration 91) — default grid spot or saved custom placement. While editing,
                // the canvas renders these instead. The foreign block's speaker button renders
                // IN-FLOW (inlineActions) so it's part of the block's box, matching the fie
                // canvas (whose selection/clamp include them) 1:1.
                textBlocks={{
                    foreign: (
                        <ChineseBlock
                            entry={entry}
                            // Reading mode: the reading IS the answer, so it always shows here.
                            showPinyin={readingMode || showPinyin}
                            showPinyinColor={showPinyinColor}
                            onSpeak={onSpeak}
                            speakingKey={speakingKey}
                            inlineActions
                            selectedSenseIndex={selectedSenseIndex}
                        />
                    ),
                    english: <EnglishBlock entry={entry} selectedSenseIndex={selectedSenseIndex} onSelectSense={handleSelectSense} />,
                }}
                editCanvas={editCanvas}
                topRail={topRail}
                // The learner's note, pinned to the top edge of the ANSWER face only
                // (a note is commentary on the answer — on the question face it would be
                // an unasked-for hint). CardNote renders nothing when there is no note
                // and no edit is open, which is the common case. While the fie canvas owns
                // the face, the note is suppressed: the canvas is a design surface and the
                // note is not part of the design it edits.
                noteSlot={editCanvas ? undefined : (
                    <CardNote
                        entry={entry}
                        editing={noteEditing}
                        onSave={onSaveNote}
                        onCancel={onCancelNote}
                    />
                )}
                // Side 2 faces away when the card is showing its front.
                inert={!isFlipped}
                contentHidden={contentHidden}
            />

            {/* Drag overlay — shown on the front card and the card currently flying off */}
            {isProminent && (
                <Box sx={{
                    position: 'absolute',
                    top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: dragPosition.x > dismissThreshold ? CORRECT_WASH : dragPosition.x < -dismissThreshold ? INCORRECT_WASH : 'transparent',
                    opacity: Math.min(Math.abs(dragPosition.x) / (dismissThreshold * 3), 0.3),
                    borderRadius: CARD_SURFACE.borderRadius,
                    pointerEvents: 'none',
                    zIndex: 3,
                }} />
            )}
        </Card>
    );
};

const FlashCardSection: React.FC<FlashCardSectionProps> = ({
    currentEntry,
    nextEntry,
    activeFrontSlot,
    flyOut,
    cardRef,
    dragPosition,
    isDragging,
    isFlipped,
    isAnimating,
    selectedCategory,
    emptyMessage,
    showPinyin,
    showPinyinColor,
    readingMode = false,
    sideOneLanguage,
    nextSideOneLanguage,
    showSwipeHint,
    showTapToFlipHint,
    shakeNonce,
    handlers,
    onSpeak,
    speakingKey,
    editCanvas,
    onPersistSense,
    editMode,
    toolbarInset,
    pad,
    slotRef,
    topRail,
    noteEditing,
    onSaveNote,
    onCancelNote,
    writingFace,
    onCardClick,
}) => {
    const theme = useTheme();
    const fc = theme.palette.flashcard;

    // Threshold in px, computed against card's actual rendered width for desktop consistency.
    const dismissThreshold = CARD_DISMISS_THRESHOLD_VW * (cardRef.current?.offsetWidth ?? window.innerWidth);

    // True for the duration of a flip animation. The flip is a 3D rotateY on the front card,
    // so at the halfway point that card is edge-on (zero projected width) and the peeking
    // BACK card — which sits behind it holding the stack's shape — is briefly shown in full,
    // leaking the NEXT card's word. While this is true the back card renders its surface only
    // (see CardFaceSide's `contentHidden`).
    //
    // Only a false -> true transition opens the window: the flip is one-way per card, and the
    // reset to false happens on a card CHANGE, where the slots are swapping and no flip
    // animation runs (hiding there would pop the freshly promoted back card's content in).
    const [flipInProgress, setFlipInProgress] = React.useState(false);
    React.useEffect(() => {
        if (!isFlipped) {
            setFlipInProgress(false);
            return;
        }
        setFlipInProgress(true);
        const timer = window.setTimeout(() => setFlipInProgress(false), CARD_FLIP_MS);
        return () => window.clearTimeout(timer);
    }, [isFlipped]);

    // Each slot gets its entry: the front slot shows currentEntry, back slot shows nextEntry.
    const slotEntries: [VocabEntry | null, VocabEntry | null] =
        activeFrontSlot === 0
            ? [currentEntry, nextEntry]
            : [nextEntry, currentEntry];

    // Writing flp only: the card flying out keeps showing the card that was DISMISSED,
    // on its graded back face. The loop advances `currentIndex` in the same batch that
    // starts the fly-out, so by the time the flying slot renders, `slotEntries` already
    // hands it the NEW back card. The outgoing entry is captured while no fly-out is
    // running and held until it ends. (State, not a ref: it is read during render.)
    // Compared by id — the page's entry is an override-merged object whose identity can
    // change every render, which would make this render-time update loop.
    const [outgoingEntry, setOutgoingEntry] = React.useState<VocabEntry | null>(currentEntry);
    if (writingFace && !flyOut && outgoingEntry?.id !== currentEntry?.id) setOutgoingEntry(currentEntry);

    // Side 1 language pairs with its slot's entry — not its slot index — so the
    // peeking card behind shows the correct language before promotion.
    const slotSideOneLanguages: [SideOneLanguage, SideOneLanguage] =
        activeFrontSlot === 0
            ? [sideOneLanguage, nextSideOneLanguage]
            : [nextSideOneLanguage, sideOneLanguage];

    return (
        // Card slot: flex:1 absorbs remaining vertical space, position:relative establishes
        // the containing block for DraggableCardContainer (position:absolute inset:0).
        <Box
            ref={slotRef}
            className="mobile-demo-card-slot"
            sx={{
                flex: 1,
                minHeight: 0,
                overflow: "hidden",
                position: "relative",
                width: "100%",
            }}
        >
            {/* Swipe-direction tutorial labels — sit above the card in the
                container's top padding. Outside DraggableCardContainer so the
                3D perspective / card transforms don't affect them. */}
            <SwipeHintLabel
                className="mobile-demo-swipe-hint-incorrect"
                visible={showSwipeHint}
                side="left"
            >
                ← Incorrect
            </SwipeHintLabel>
            <SwipeHintLabel
                className="mobile-demo-swipe-hint-correct"
                visible={showSwipeHint}
                side="right"
            >
                Correct →
            </SwipeHintLabel>
            {/* "Tap to flip" hint — shown when user tries to swipe before flipping.
                Guarded on !isFlipped so the label disappears the moment the user
                flips, even before the parent resets the flag on next card. */}
            <FlipHintLabel
                className="mobile-demo-flip-hint"
                visible={showTapToFlipHint && !isFlipped}
            >
                Tap to flip
            </FlipHintLabel>
            {/* Fills the slot. DraggableCardContainer has definite px dimensions because
                it is absolutely positioned — this is what makes height:100% on
                CardAspectWrapper resolve correctly (flex-grown heights are not definite). */}
            <DraggableCardContainer className="mobile-demo-draggable-container" toolbarInset={toolbarInset} pad={pad ?? DEFAULT_CARD_SLOT_PADDING}>
                {/* CardAspectWrapper: fills the larger of the two axes while preserving
                    aspect-ratio. Default = height-bound (container is wider than card ratio).
                    The @container rule flips to width-bound when the container is narrower
                    than 295/426, so the card never overflows either axis. */}
                <Box
                    sx={{
                        aspectRatio: "295 / 426",
                        height: "100%",
                        width: "auto",
                        position: "relative",
                        flexShrink: 0,
                        "@container (max-aspect-ratio: 295/426)": {
                            width: "100%",
                            height: "auto",
                        },
                    }}
                >
                    {currentEntry ? (
                        // Two-slot card stack. Slots alternate as front/back card on each dismiss.
                        // The back card is pre-populated with the next card's content so no
                        // content flash occurs when the front card flies off.
                        <>
                            {([0, 1] as const).map((slot) => {
                                const isFront = slot === activeFrontSlot;
                                const isThisSlotFlyingOut = flyOut?.slot === slot;
                                const entry = writingFace && isThisSlotFlyingOut ? outgoingEntry : slotEntries[slot];
                                const writingRole = isThisSlotFlyingOut ? "flying" : isFront ? "front" : "peek";

                                // Compute transform and transition for this slot:
                                // - Flying out: animate to off-screen position
                                // - Active front (not flying): follow drag position
                                // - Back slot: stay centered, no transition (instant reset stays hidden)
                                let transform: string;
                                let transition: string;
                                let opacity: number;

                                if (isThisSlotFlyingOut) {
                                    const targetX = flyOut!.direction === 'right' ? FLY_OUT_X : -FLY_OUT_X;
                                    const targetRotation = flyOut!.direction === 'right' ? FLY_OUT_ROTATION : -FLY_OUT_ROTATION;
                                    transform = `translate(${targetX}px, 0px) rotate(${targetRotation}deg)`;
                                    // The writing card plays its keyframe throw instead (see
                                    // writingThrowKeyframes); the transition would only fight it.
                                    transition = writingFace ? 'none' : CARD_FLY_OUT_TRANSITION;
                                    opacity = 1 - Math.abs(dragPosition.x) / 400;
                                } else if (isFront && isAnimating) {
                                    // Newly promoted back card during the fly-out window: hold at center.
                                    // dragPosition still holds the previous swipe's release position — ignore it
                                    // entirely so this card doesn't inherit the translation, rotation, or overlay.
                                    transform = 'translate(0px, 0px) rotate(0deg)';
                                    transition = 'none';
                                    opacity = 1;
                                } else if (isFront) {
                                    const rotation = dragPosition.x * 0.05;
                                    transform = `translate(${dragPosition.x}px, ${dragPosition.y}px) rotate(${rotation}deg)`;
                                    transition = isDragging ? 'none' : CARD_FLY_OUT_TRANSITION;
                                    opacity = 1 - Math.abs(dragPosition.x) / 400;
                                } else {
                                    // Back card: slight scale-down for depth; transition:none so it snaps
                                    // back to center instantly (while hidden) after being the fly-out slot.
                                    transform = 'scale(0.97)';
                                    transition = 'none';
                                    opacity = 0.9;
                                }

                                // Shake the front card whenever the swipe-tutorial nonce changes.
                                // Re-mount the wrapper by including shakeNonce in the key so the CSS
                                // animation restarts cleanly per trigger. The shake only runs when the
                                // card is at rest (not dragging, not flying out) — otherwise the
                                // animated transform would conflict with the drag-follow transform.
                                const shakeActive = isFront && shakeNonce > 0 && !isAnimating && !isDragging;

                                return (
                                    <Box
                                        key={isFront ? `front-${shakeNonce}` : `slot-${slot}`}
                                        ref={isFront ? cardRef : undefined}
                                        // Handlers are detached while the note editor is open for the
                                        // same reason they are during a fie edit: the card must not flip
                                        // or swipe away under a gesture aimed at the editor. CardNote also
                                        // stops its own events — this covers the ones that START on the
                                        // note and travel off it.
                                        {...(isFront && !editMode && !noteEditing ? {
                                            onTouchStart: handlers.onTouchStart,
                                            onTouchEnd: handlers.onTouchEnd,
                                            onMouseDown: handlers.onMouseDown,
                                        } : {})}
                                        onClick={isFront && !isAnimating ? onCardClick : undefined}
                                        sx={{
                                            position: "absolute",
                                            inset: 0,
                                            // The flying card stays on top of the promoted one: it is no
                                            // longer `isFront` once the slots swap, and a tapped writing
                                            // card starts its throw dead centre, over the new front.
                                            zIndex: isThisSlotFlyingOut ? 3 : isFront ? 2 : 1,
                                            transform,
                                            transition,
                                            opacity,
                                            // Back card should never capture pointer events
                                            ...(!isFront && { pointerEvents: 'none', userSelect: 'none' }),
                                            // Writing flp: the promoted back card grows from its peek pose
                                            // into place under the throw. A keyframe for the same reason as
                                            // the throw — its key changes (`slot-X` → `front-N`) on promotion,
                                            // so it remounts and a transition would snap.
                                            ...(writingFace && isFront && isAnimating ? {
                                                animation: `writingPromote ${CARD_FLY_OUT_MS}ms cubic-bezier(0.2, 0.8, 0.3, 1) both`,
                                                "@keyframes writingPromote": {
                                                    "0%": { transform: "scale(0.97)", opacity: 0.9 },
                                                    "100%": { transform: "translate(0px, 0px) rotate(0deg) scale(1)", opacity: 1 },
                                                },
                                            } : {}),
                                            ...(writingFace && isThisSlotFlyingOut ? {
                                                animation: `writingThrow${flyOut!.direction === 'right' ? 'Right' : 'Left'} ${CARD_FLY_OUT_MS}ms forwards`,
                                                "@keyframes writingThrowRight": writingThrowKeyframes(1),
                                                "@keyframes writingThrowLeft": writingThrowKeyframes(-1),
                                            } : {}),
                                            ...(shakeActive ? {
                                                animation: "cardShake 0.42s ease-in-out",
                                                "@keyframes cardShake": {
                                                    "0%, 100%": { transform: "translate(0px, 0px) rotate(0deg)" },
                                                    "20%": { transform: "translate(-10px, 0) rotate(-1.2deg)" },
                                                    "40%": { transform: "translate(10px, 0) rotate(1.2deg)" },
                                                    "60%": { transform: "translate(-7px, 0) rotate(-0.8deg)" },
                                                    "80%": { transform: "translate(7px, 0) rotate(0.8deg)" },
                                                },
                                            } : {}),
                                        }}
                                    >
                                        {entry && (
                                            <CardFace
                                                entry={entry}
                                                // A flying writing card stays on its graded back face.
                                                isFlipped={isFront ? isFlipped : !!writingFace && isThisSlotFlyingOut}
                                                isAnimating={isAnimating}
                                                showPinyin={showPinyin}
                                                showPinyinColor={showPinyinColor}
                                                readingMode={readingMode}
                                                sideOneLanguage={slotSideOneLanguages[slot]}
                                                // Suppress the drag overlay on the newly promoted card while
                                                // the previous card is still flying out (isAnimating window).
                                                dragPosition={(isFront && isAnimating) ? { x: 0, y: 0 } : dragPosition}
                                                dismissThreshold={dismissThreshold}
                                                isFront={isFront}
                                                isProminent={isFront || isThisSlotFlyingOut}
                                                // Only show the speaker on the active front card —
                                                // tapping it on the back/flying-out card would race the animation.
                                                onSpeak={isFront ? onSpeak : undefined}
                                                speakingKey={isFront ? speakingKey : null}
                                                // Edit canvas applies only to the active front card's back face.
                                                editCanvas={isFront ? editCanvas : undefined}
                                                // Only the active front card is interactive, so only it persists picks.
                                                onPersistSense={isFront ? onPersistSense : undefined}
                                                // Card operations belong to the card the learner is
                                                // looking at; the peeking back card has none.
                                                topRail={isFront ? topRail : undefined}
                                                // The back card is exposed while the front
                                                // card passes edge-on through the flip — blank
                                                // its content for that window.
                                                contentHidden={!isFront && flipInProgress}
                                                // Only the active front card's note is
                                                // editable; the peeking back card still
                                                // RENDERS its note (read-only) so it doesn't
                                                // pop in when the card is promoted.
                                                noteEditing={isFront ? noteEditing : false}
                                                onSaveNote={isFront ? onSaveNote : undefined}
                                                onCancelNote={isFront ? onCancelNote : undefined}
                                                writingFace={writingFace ? (side) => writingFace(entry, side, writingRole) : undefined}
                                            />
                                        )}
                                    </Box>
                                );
                            })}
                        </>
                    ) : (
                        <Card
                            className="mobile-demo-flashcard-empty"
                            sx={{
                                backgroundColor: fc.flashCard,
                                borderRadius: CARD_SURFACE.borderRadius,
                                border: CARD_SURFACE.border,
                                boxShadow: CARD_SURFACE.boxShadow,
                                position: "absolute",
                                inset: 0,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}
                        >
                            <CardContent className="mobile-demo-flashcard-empty-content" sx={{ padding: "32px", textAlign: 'center' }}>
                                <Typography
                                    className="mobile-demo-flashcard-empty-text"
                                    sx={{
                                        fontSize: SIZE.title,
                                        fontWeight: WEIGHT.regular,
                                        color: fc.onSurface,
                                        fontFamily: FC_FONT,
                                        lineHeight: 1.5,
                                    }}
                                >
                                    {emptyMessage
                                        ? emptyMessage
                                        : selectedCategory
                                        ? `No cards in the ${selectedCategory} category yet. Cards will appear here as you study!`
                                        : 'No Learn Now cards available. Add cards from the Discover page!'}
                                </Typography>
                            </CardContent>
                        </Card>
                    )}
                </Box>
            </DraggableCardContainer>
        </Box>
    );
};

export default FlashCardSection;
