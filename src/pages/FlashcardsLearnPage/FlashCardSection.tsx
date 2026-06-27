import React from "react";
import { Box, Card, CardContent, Typography, useTheme } from "@mui/material";
import { stripParentheses } from "../../utils/definitionUtils";
import { DraggableCardContainer, SwipeHintLabel, FlipHintLabel } from "./styled";
import {
    CORRECT_COLOR,
    INCORRECT_COLOR,
    CARD_FACE_JUSTIFY,
    CARD_DISMISS_THRESHOLD_VW,
    CARD_FLY_OUT_MS,
    CARD_FLY_OUT_TRANSITION,
    CARD_FLIP_TRANSITION,
    FC_FONT,
    FC_FONT_CJK,
} from "./constants";
import { SIZE, WEIGHT, LEADING, TRACKING } from "../../theme/scale";
import type { VocabEntry, SideOneLanguage } from "./types";
import type { IconLayoutItem } from "../../types";
import CardIconLayer from "./CardIconLayer";
import { defaultLayoutForIcon } from "./cardIconLayout";
import ForeignText from "../../components/ForeignText";
import { SpeakerButton } from "../../components/SpeakerButton";
import PracticeWritingButton from "../../components/handwriting/PracticeWritingButton";
import { getCategoryColor } from "../../utils/categoryColors";

// Re-exported so existing imports `from './FlashCardSection'` keep working.
export { SpeakerButton };

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
    // When true, the card's progress category renders as a colored chip on Side 2.
    showProgressCategory: boolean;
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
    onSpeak?: (entry: VocabEntry) => void;
    // The text currently being narrated by useTTS, or null when idle. Forwarded
    // to the speaker button so only the active card's icon shows the loading
    // spinner during playback.
    speakingKey?: string | null;
    // The live icon-layout edit canvas, built by the page when edit mode is on. It is
    // applied only to the ACTIVE FRONT card's back face. See docs/CARD_ICON_LAYOUT.md.
    editCanvas?: React.ReactNode;
    // True while the icon-layout editor is open. Locks the card: drag/flip handlers
    // are not attached so the card can't be swiped away or flipped mid-edit.
    editMode?: boolean;
    // True when the editor is in ADVANCED mode. Drives the card push-down: the advanced
    // toolbar grows to three rows, so the card is shifted down to clear it. Basic mode
    // keeps its single static row and the card stays centered.
    advMode?: boolean;
}

// Chinese (CPCD) row block reused on both Side 1 (when Chinese) and Side 2.
// When onSpeak is provided, a speaker icon renders alongside the row for
// manual narration playback.
export const ChineseBlock: React.FC<{
    entry: VocabEntry;
    showPinyin: boolean;
    showPinyinColor: boolean;
    onSpeak?: (entry: VocabEntry) => void;
    speakingKey?: string | null;
    // The practice-writing button exists on the SECOND side (back) only — the front
    // passes false so it never appears there.
    showWriting?: boolean;
}> = ({ entry, showPinyin, showPinyinColor, onSpeak, speakingKey, showWriting = false }) => {
    const showWritingButton = showWriting && entry.language === "zh";
    return (
        // Outer row fills the width and centers the Chinese text within the card.
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }} className="mobile-demo-flashcard-chinese-block">
            {/* Inner wrapper shrinks to the text width so the Chinese stays truly
                centered in the card. The speaker icon is absolutely positioned just
                off the text's right edge, so it doesn't shift the text off-center. */}
            <Box sx={{ position: 'relative', display: 'inline-flex' }} className="mobile-demo-flashcard-chinese-inner">
                <ForeignText
                    size="md"
                    justifyContent="center"
                    className="mobile-demo-flashcard-cpcd-row"
                    text={entry.entryKey}
                    pronunciation={entry.pronunciation}
                    showPinyin={showPinyin}
                    useToneColor={showPinyinColor}
                />
                {/* Writing-practice + audio icons stacked vertically (writing on
                    top, speaker below), mirroring the eip header stack. The column
                    is absolutely positioned just off the text's right edge so it
                    doesn't shift the centered Chinese. Either icon may be absent
                    (non-zh hides writing; no onSpeak hides audio). */}
                {(onSpeak || showWritingButton) && (
                    <Box sx={{ position: 'absolute', left: '100%', top: '50%', transform: 'translateY(-50%)', ml: 1 }}>
                        <Box
                            className="mobile-demo-flashcard-actions"
                            sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.25 }}
                        >
                            {showWritingButton && (
                                <PracticeWritingButton
                                    character={entry.entryKey}
                                    language={entry.language}
                                    iconOnly
                                    hideStarBadge
                                />
                            )}
                            {onSpeak && (
                                <SpeakerButton
                                    onClick={() => onSpeak(entry)}
                                    isLoading={speakingKey === entry.entryKey}
                                />
                            )}
                        </Box>
                    </Box>
                )}
            </Box>
        </Box>
    );
};

// Length-based font scale for the English definition. A fixed 30px overflowed
// the card for long definitions, so we step the size down as the string grows.
// Returns px. Thresholds chosen to keep the longest common definitions on ≤3
// lines within the 295px card face.
const englishFontSize = (text: string): number => {
    const len = text.length;
    if (len > 48) return 18;
    if (len > 32) return 22;
    if (len > 18) return 26;
    return 30;
};

// English definition Typography reused on both Side 1 (when English) and Side 2.
export const EnglishBlock: React.FC<{ entry: VocabEntry }> = ({ entry }) => {
    const theme = useTheme();
    const text = stripParentheses(entry.definition ?? '');
    return (
        <Typography sx={{
            fontSize: englishFontSize(text),
            fontWeight: WEIGHT.regular,
            color: theme.palette.flashcard.onSurface,
            fontFamily: FC_FONT_CJK,
            textAlign: 'center',
            lineHeight: 1.25,
        }}>
            {text}
        </Typography>
    );
};

// Progress-category chip shown in the top-left corner of Side 2 when the setting
// is enabled. Absolutely positioned within the card face (matching MiniVocabCard's
// top-left badge). Tinted with the shared category color. Renders only when a
// category is present on the entry.
const CategoryChip: React.FC<{ category?: string }> = ({ category }) => {
    if (!category) return null;
    const color = getCategoryColor(category);
    return (
        <Box
            className="mobile-demo-flashcard-category-chip"
            sx={{
                position: 'absolute',
                top: 12,
                left: 12,
                zIndex: 2,
                display: 'inline-flex',
                alignItems: 'center',
                px: 1.25,
                py: 0.25,
                borderRadius: '999px',
                backgroundColor: color,
            }}
        >
            <Typography sx={{ fontSize: SIZE.caption, fontWeight: WEIGHT.semibold, color: '#FFFFFF', fontFamily: FC_FONT, lineHeight: LEADING.normal, letterSpacing: TRACKING.wide }}>
                {category}
            </Typography>
        </Box>
    );
};

// Empty-icon placeholder box shown at the top of a face when the entry has no
// representative icon assigned, so the card layout stays consistent across cards.
// (Cards that DO have an icon — default or custom — render it through CardIconLayer
// instead, so the icon's on-screen size matches the edit-mode editor exactly.)
const CardImage: React.FC<{ iconId?: string | null }> = () => {
    const theme = useTheme();
    const fc = theme.palette.flashcard;
    return (
        <Box
            className="mobile-demo-flashcard-image"
            sx={{ width: 106, height: 83, backgroundColor: fc.imagePlaceholder, borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}
        />
    );
};

// Shared scaffold for a single card face: the absolutely-positioned, backface-
// hidden face box + its CardContent + the inner flex column holding the image
// placeholder and a content slot. `rotated` flips the face to the back (Side 2);
// `contentGap` differs between the single-block front and the stacked back.
const CardFaceSide: React.FC<{
    rotated: boolean;
    contentGap: number;
    contentClassName?: string;
    children: React.ReactNode;
    // The entry's representative icon, rendered in the image block at the top of
    // the face. Undefined/null -> empty placeholder box (layout preserved).
    iconId?: string | null;
    // Whether THIS face displays the English block. Icons (default or custom) render
    // only on English-bearing faces (docs/CARD_ICON_LAYOUT.md): back face always,
    // front face only when Side 1 is English.
    showIcon: boolean;
    // Saved custom icon arrangement for the entry. When present (and showIcon), it
    // replaces the single default icon with a clipped layer drawn BEHIND the content.
    iconLayout?: IconLayoutItem[] | null;
    // When provided, this face is being edited: render the gesture canvas (above a
    // dimmed content layer) instead of the static icon layer / default icon.
    editCanvas?: React.ReactNode;
    // Make this face non-interactive. Used to silence the away-facing (front) face
    // while editing the back face — CSS 3D backface culling does not reliably exclude
    // the rotated-away face from hit-testing, so it would otherwise capture the
    // canvas's pointer events.
    inert?: boolean;
    // Optional absolutely-positioned element (e.g. the category chip) rendered as
    // a direct child of the face box so it can sit in a corner, outside the
    // centered content column.
    cornerBadge?: React.ReactNode;
}> = ({ rotated, contentGap, contentClassName, children, iconId, showIcon, iconLayout, editCanvas, inert, cornerBadge }) => {
    const theme = useTheme();
    const fc = theme.palette.flashcard;
    const hasCustom = showIcon && !!iconLayout && iconLayout.length > 0;
    const editing = !!editCanvas;
    return (
        <Box sx={{
            position: "absolute",
            top: 0, left: 0, width: "100%", height: "100%",
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
            ...(rotated && { transform: "rotateY(180deg)" }),
            backgroundColor: fc.flashCard,
            borderRadius: "12px",
            // Clip the custom icon layer / edit canvas to the card boundary so icons
            // partially off the card are cut off and never paint outside it.
            overflow: "hidden",
            // Explicit visual hiding of the away-facing face. `backfaceVisibility:hidden`
            // alone is unreliable on some mobile WebKit/Blink builds (prod bug: the
            // rotated-away Side 1 bled through the back, mirrored by the parent's
            // rotateY(180deg)), so we don't trust it for the visual. `inert` already
            // tracks "this face is facing away"; when so, force visibility:hidden but
            // DELAY it to exactly the mid-flip point — which, because the flip curve is
            // LINEAR (CARD_FLIP_TRANSITION), is precisely 90° / edge-on, so the face
            // vanishes at zero projected width with no mirror flash. The incoming face
            // is revealed immediately (no delay) on the way in.
            visibility: inert ? "hidden" : "visible",
            transition: `visibility 0s ${inert ? CARD_FLY_OUT_MS / 2 : 0}ms`,
            ...(inert && { pointerEvents: "none" }),
            display: "flex",
            alignItems: "center",
            justifyContent: CARD_FACE_JUSTIFY,
        }}>
            {cornerBadge}
            {/* Icon layer sits BEHIND the content (cpcd / English / buttons) so the
                card info always reads on top — for a saved arrangement AND while
                editing. During edit the live canvas replaces the static layer; the
                content above is made non-interactive so pointer events fall through to
                the canvas even where they overlap the text. */}
            {editing ? editCanvas : (hasCustom && <CardIconLayer layout={iconLayout!} />)}
            {/* Default single icon — rendered through the SAME CardIconLayer geometry as
                the editor's seeded basic icon (defaultLayoutForIcon: centered upper-third,
                default scale), so its on-screen size is identical whether or not the editor
                is open. When the entry has no icon at all, fall back to the empty
                placeholder box (positioned at the same 33.33% spot). zIndex 0 keeps it
                behind the text. */}
            {showIcon && !hasCustom && !editing && (
                iconId
                    ? <CardIconLayer layout={defaultLayoutForIcon(iconId)} />
                    : (
                        <Box sx={{ position: "absolute", top: "33.33%", left: "50%", transform: "translate(-50%, -50%)", zIndex: 0 }}>
                            <CardImage iconId={null} />
                        </Box>
                    )
            )}
            <CardContent
                className={rotated ? undefined : "mobile-demo-flashcard-content"}
                sx={{
                    width: "100%",
                    height: "100%",
                    padding: "clamp(16px, 7%, 72px) 30px",
                    boxSizing: "border-box",
                    // Content sits above the icon layer. While editing it stays fully
                    // visible but non-interactive, so the icons (canvas) below can be
                    // manipulated through it.
                    position: "relative",
                    zIndex: 1,
                    ...(editing && { pointerEvents: "none" }),
                }}
            >
                <Box
                    className={rotated ? undefined : "mobile-demo-flashcard-inner"}
                    sx={{ position: "relative", height: "100%", width: "100%", minHeight: 0 }}
                >
                    {/* Card text — lower third of the card (≈1/3 up from the bottom). */}
                    <Box
                        className={contentClassName}
                        sx={{
                            position: "absolute",
                            top: "66.67%",
                            left: "50%",
                            transform: "translate(-50%, -50%)",
                            width: "100%",
                            display: "flex",
                            flexDirection: "column",
                            gap: contentGap,
                            alignItems: "center",
                            boxSizing: "border-box",
                        }}
                    >
                        {children}
                    </Box>
                </Box>
            </CardContent>
        </Box>
    );
};

// How far off-screen to throw the card (px). 900px safely clears the 393px frame on all viewports.
const FLY_OUT_X = 900;
// Rotation (deg) applied when the card flies off — more dramatic than the gentle drag tilt.
const FLY_OUT_ROTATION = 30;

/** Renders the card face (Side 1 + Side 2 + drag overlay) for a given entry.
 *  Side 1 shows only one language (determined by sideOneLanguage).
 *  Side 2 always shows both Chinese and English stacked. */
const CardFace: React.FC<{
    entry: VocabEntry;
    isFlipped: boolean;
    isAnimating: boolean;
    showPinyin: boolean;
    showPinyinColor: boolean;
    showProgressCategory: boolean;
    sideOneLanguage: SideOneLanguage;
    dragPosition: { x: number; y: number };
    dismissThreshold: number;
    isFront: boolean;
    // True for both the active front card and the card currently flying off screen —
    // both should show the full shadow and the green/red drag overlay.
    isProminent: boolean;
    onSpeak?: (entry: VocabEntry) => void;
    speakingKey?: string | null;
    // The live icon-layout edit canvas for THIS card's back face. Only the active
    // front card supplies one (and only while edit mode is on); it replaces the back
    // face's static icon layer. See docs/CARD_ICON_LAYOUT.md.
    editCanvas?: React.ReactNode;
}> = ({ entry, isFlipped, isAnimating, showPinyin, showPinyinColor, showProgressCategory, sideOneLanguage, dragPosition, dismissThreshold, isProminent, onSpeak, speakingKey, editCanvas }) => {
    const theme = useTheme();
    const fc = theme.palette.flashcard;

    return (
        <Card
            className="mobile-demo-flashcard"
            sx={{
                backgroundColor: 'transparent',
                background: 'none',
                borderRadius: "12px",
                // Prominent cards (front + flying-out) get full shadow; back card gets a softer one for depth.
                boxShadow: isProminent ? fc.cardShadow : fc.cardShadowSubtle,
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
                // CSS 3D backface culling does NOT reliably exclude the rotated-away
                // face from hit-testing, so the away face must be made inert or it
                // intercepts taps meant for the visible face (e.g. the writing/audio
                // buttons on the back). Side 1 faces away whenever the card is flipped.
                inert={isFlipped}
            >
                {sideOneLanguage === 'zh'
                    ? <ChineseBlock entry={entry} showPinyin={showPinyin} showPinyinColor={showPinyinColor} onSpeak={onSpeak} speakingKey={speakingKey} showWriting={false} />
                    : <EnglishBlock entry={entry} />}
            </CardFaceSide>

            {/* Side 2 — always shows both Chinese and English, and the icon arrangement. */}
            <CardFaceSide
                rotated
                contentGap={2}
                contentClassName="mobile-demo-flashcard-side-two"
                iconId={entry.iconId}
                showIcon
                iconLayout={entry.iconLayout}
                editCanvas={editCanvas}
                // Side 2 faces away when the card is showing its front.
                inert={!isFlipped}
                cornerBadge={showProgressCategory ? <CategoryChip category={entry.category} /> : undefined}
            >
                <ChineseBlock entry={entry} showPinyin={showPinyin} showPinyinColor={showPinyinColor} onSpeak={onSpeak} speakingKey={speakingKey} showWriting />
                <EnglishBlock entry={entry} />
            </CardFaceSide>

            {/* Drag overlay — shown on the front card and the card currently flying off */}
            {isProminent && (
                <Box sx={{
                    position: 'absolute',
                    top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: dragPosition.x > dismissThreshold ? CORRECT_COLOR : dragPosition.x < -dismissThreshold ? INCORRECT_COLOR : 'transparent',
                    opacity: Math.min(Math.abs(dragPosition.x) / (dismissThreshold * 3), 0.3),
                    borderRadius: "12px",
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
    showProgressCategory,
    sideOneLanguage,
    nextSideOneLanguage,
    showSwipeHint,
    showTapToFlipHint,
    shakeNonce,
    handlers,
    onSpeak,
    speakingKey,
    editCanvas,
    editMode,
    advMode,
}) => {
    const theme = useTheme();
    const fc = theme.palette.flashcard;

    // Threshold in px, computed against card's actual rendered width for desktop consistency.
    const dismissThreshold = CARD_DISMISS_THRESHOLD_VW * (cardRef.current?.offsetWidth ?? window.innerWidth);

    // Each slot gets its entry: the front slot shows currentEntry, back slot shows nextEntry.
    const slotEntries: [VocabEntry | null, VocabEntry | null] =
        activeFrontSlot === 0
            ? [currentEntry, nextEntry]
            : [nextEntry, currentEntry];

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
            sx={{
                flex: 1,
                minHeight: 0,
                overflow: "hidden",
                position: "relative",
                width: "100%",
                // While advanced-editing the card slides DOWN over the greyed More Info pill
                // (zIndex 2). Lift the whole slot above it so the card paints over the pill
                // (kept below the edit toolbar's zIndex 20). Otherwise the pill floats on top.
                ...(editMode && advMode ? { zIndex: 3 } : {}),
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
            <DraggableCardContainer className="mobile-demo-draggable-container" pushDown={editMode && advMode}>
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
                                const entry = slotEntries[slot];
                                const isFront = slot === activeFrontSlot;
                                const isThisSlotFlyingOut = flyOut?.slot === slot;

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
                                    transition = CARD_FLY_OUT_TRANSITION;
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
                                        {...(isFront && !editMode ? {
                                            onTouchStart: handlers.onTouchStart,
                                            onTouchEnd: handlers.onTouchEnd,
                                            onMouseDown: handlers.onMouseDown,
                                        } : {})}
                                        sx={{
                                            position: "absolute",
                                            inset: 0,
                                            zIndex: isFront ? 2 : 1,
                                            transform,
                                            transition,
                                            opacity,
                                            // Back card should never capture pointer events
                                            ...(!isFront && { pointerEvents: 'none', userSelect: 'none' }),
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
                                                isFlipped={isFront ? isFlipped : false}
                                                isAnimating={isAnimating}
                                                showPinyin={showPinyin}
                                                showPinyinColor={showPinyinColor}
                                                showProgressCategory={showProgressCategory}
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
                                borderRadius: "12px",
                                boxShadow: fc.cardShadow,
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
