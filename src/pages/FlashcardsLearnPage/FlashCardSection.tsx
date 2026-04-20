import React from "react";
import { Box, Card, CardContent, Typography } from "@mui/material";
import { stripParentheses } from "../../utils/definitionUtils";
import { DraggableCardContainer } from "./styled";
import { COLORS, CARD_FACE_JUSTIFY, CARD_DISMISS_THRESHOLD_VW } from "./constants";
import type { VocabEntry, SideOneLanguage } from "./types";
import CharacterPinyinColorDisplay from "../../components/CharacterPinyinColorDisplay";
import CPCDRow from "../../components/CPCDRow";

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
    showPinyin: boolean;
    // Side 1 language for the front-slot card. Side 2 always shows both.
    sideOneLanguage: SideOneLanguage;
    // Side 1 language for the back-slot (peeking) card — different random value
    // so promoting it on dismiss doesn't flash the wrong language.
    nextSideOneLanguage: SideOneLanguage;
    handlers: {
        onTouchStart: (e: React.TouchEvent) => void;
        onTouchEnd: (e: React.TouchEvent) => void;
        onMouseDown: (e: React.MouseEvent) => void;
    };
}

// Chinese (CPCD) row block reused on both Side 1 (when Chinese) and Side 2.
const ChineseBlock: React.FC<{ entry: VocabEntry; showPinyin: boolean }> = ({ entry, showPinyin }) => (
    <CPCDRow size="md" justifyContent="center" className="mobile-demo-flashcard-cpcd-row">
        {[...entry.entryKey].map((char, i) => (
            <CharacterPinyinColorDisplay
                key={i}
                character={char}
                pinyin={entry.pronunciation?.split(' ')[i] ?? ''}
                size="md"
                useToneColor={true}
                showPinyin={showPinyin}
            />
        ))}
    </CPCDRow>
);

// English definition Typography reused on both Side 1 (when English) and Side 2.
const EnglishBlock: React.FC<{ entry: VocabEntry }> = ({ entry }) => (
    <Typography sx={{
        fontSize: 30,
        fontWeight: 400,
        color: COLORS.onSurface,
        fontFamily: '"Inter", "Noto Sans JP", sans-serif',
        textAlign: 'center',
    }}>
        {stripParentheses(entry.entryValue)}
    </Typography>
);

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
    sideOneLanguage: SideOneLanguage;
    dragPosition: { x: number; y: number };
    dismissThreshold: number;
    isFront: boolean;
    // True for both the active front card and the card currently flying off screen —
    // both should show the full shadow and the green/red drag overlay.
    isProminent: boolean;
}> = ({ entry, isFlipped, isAnimating, showPinyin, sideOneLanguage, dragPosition, dismissThreshold, isProminent }) => (
    <Card
        className="mobile-demo-flashcard"
        sx={{
            backgroundColor: 'transparent',
            background: 'none',
            borderRadius: "12px",
            // Prominent cards (front + flying-out) get full shadow; back card gets a softer one for depth.
            boxShadow: isProminent
                ? "2px 4px 4px rgba(0, 0, 0, 0.25)"
                : "1px 2px 3px rgba(0, 0, 0, 0.15)",
            cursor: "pointer",
            position: "absolute",
            inset: 0,
            transformStyle: "preserve-3d",
            transform: `rotateY(${isFlipped ? 180 : 0}deg)`,
            transition: isAnimating ? 'none' : 'transform 0.45s ease',
            overflow: 'visible',
        }}
    >
        {/* Side 1 — shows only one language, chosen randomly per card */}
        <Box sx={{
            position: "absolute",
            top: 0, left: 0, width: "100%", height: "100%",
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
            backgroundColor: COLORS.flashCard,
            borderRadius: "12px",
            display: "flex",
            alignItems: "center",
            justifyContent: CARD_FACE_JUSTIFY,
        }}>
            <CardContent
                className="mobile-demo-flashcard-content"
                sx={{
                    width: "100%",
                    height: "100%",
                    padding: "clamp(16px, 7%, 72px) 30px",
                    boxSizing: "border-box",
                }}
            >
                <Box
                    className="mobile-demo-flashcard-inner"
                    sx={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "space-between",
                        height: "100%",
                        minHeight: 0,
                        gap: "clamp(8px, 2.2vh, 20px)",
                    }}
                >
                    <Box className="mobile-demo-flashcard-image" sx={{ width: 106, height: 83, backgroundColor: '#ffffff', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Typography sx={{ fontSize: 11, color: COLORS.gray, fontFamily: '"Inter", sans-serif', textAlign: 'center' }}>insert image here</Typography>
                    </Box>
                    <Box className="mobile-demo-flashcard-text mobile-demo-flashcard-side-one" sx={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'center', width: '100%' }}>
                        {sideOneLanguage === 'zh'
                            ? <ChineseBlock entry={entry} showPinyin={showPinyin} />
                            : <EnglishBlock entry={entry} />}
                    </Box>
                </Box>
            </CardContent>
        </Box>

        {/* Side 2 — always shows both Chinese and English */}
        <Box sx={{
            position: "absolute",
            top: 0, left: 0, width: "100%", height: "100%",
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
            transform: "rotateY(180deg)",
            backgroundColor: COLORS.flashCard,
            borderRadius: "12px",
            display: "flex",
            alignItems: "center",
            justifyContent: CARD_FACE_JUSTIFY,
        }}>
            <CardContent
                sx={{
                    width: "100%",
                    height: "100%",
                    padding: "clamp(16px, 7%, 72px) 30px",
                    boxSizing: "border-box",
                }}
            >
                <Box
                    sx={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "space-between",
                        height: "100%",
                        minHeight: 0,
                        gap: "clamp(8px, 2.2vh, 20px)",
                    }}
                >
                    <Box sx={{ width: 106, height: 83, backgroundColor: '#ffffff', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Typography sx={{ fontSize: 11, color: COLORS.gray, fontFamily: '"Inter", sans-serif', textAlign: 'center' }}>insert image here</Typography>
                    </Box>
                    <Box className="mobile-demo-flashcard-side-two" sx={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center', width: '100%' }}>
                        <ChineseBlock entry={entry} showPinyin={showPinyin} />
                        <EnglishBlock entry={entry} />
                    </Box>
                </Box>
            </CardContent>
        </Box>

        {/* Drag overlay — shown on the front card and the card currently flying off */}
        {isProminent && (
            <Box sx={{
                position: 'absolute',
                top: 0, left: 0, right: 0, bottom: 0,
                backgroundColor: dragPosition.x > dismissThreshold ? COLORS.correct : dragPosition.x < -dismissThreshold ? COLORS.incorrect : 'transparent',
                opacity: Math.min(Math.abs(dragPosition.x) / (dismissThreshold * 3), 0.3),
                borderRadius: "12px",
                pointerEvents: 'none',
                zIndex: 3,
            }} />
        )}
    </Card>
);

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
    showPinyin,
    sideOneLanguage,
    nextSideOneLanguage,
    handlers,
}) => {
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
            }}
        >
            {/* Fills the slot. DraggableCardContainer has definite px dimensions because
                it is absolutely positioned — this is what makes height:100% on
                CardAspectWrapper resolve correctly (flex-grown heights are not definite). */}
            <DraggableCardContainer className="mobile-demo-draggable-container">
                {/* CardAspectWrapper: height:100% resolves against DraggableCardContainer's
                    definite height. aspect-ratio derives the width. max-width:100% constrains
                    it when the slot is narrower than the aspect-ratio-derived width. */}
                <Box
                    sx={{
                        height: "100%",
                        aspectRatio: "295 / 426",
                        maxWidth: "calc(100% - 80px)",
                        position: "relative",
                        flexShrink: 0,
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
                                    transition = 'transform 0.45s ease';
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
                                    transition = isDragging ? 'none' : 'transform 0.45s ease';
                                    opacity = 1 - Math.abs(dragPosition.x) / 400;
                                } else {
                                    // Back card: slight scale-down for depth; transition:none so it snaps
                                    // back to center instantly (while hidden) after being the fly-out slot.
                                    transform = 'scale(0.97)';
                                    transition = 'none';
                                    opacity = 0.9;
                                }

                                return (
                                    <Box
                                        key={slot}
                                        ref={isFront ? cardRef : undefined}
                                        {...(isFront ? {
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
                                        }}
                                    >
                                        {entry && (
                                            <CardFace
                                                entry={entry}
                                                isFlipped={isFront ? isFlipped : false}
                                                isAnimating={isAnimating}
                                                showPinyin={showPinyin}
                                                sideOneLanguage={slotSideOneLanguages[slot]}
                                                // Suppress the drag overlay on the newly promoted card while
                                                // the previous card is still flying out (isAnimating window).
                                                dragPosition={(isFront && isAnimating) ? { x: 0, y: 0 } : dragPosition}
                                                dismissThreshold={dismissThreshold}
                                                isFront={isFront}
                                                isProminent={isFront || isThisSlotFlyingOut}
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
                                backgroundColor: COLORS.flashCard,
                                borderRadius: "12px",
                                boxShadow: "2px 4px 4px rgba(0, 0, 0, 0.25)",
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
                                        fontSize: 20,
                                        fontWeight: 400,
                                        color: COLORS.onSurface,
                                        fontFamily: '"Inter", sans-serif',
                                        lineHeight: 1.5,
                                    }}
                                >
                                    {selectedCategory
                                        ? `No cards in the ${selectedCategory} category yet. Cards will appear here as you study!`
                                        : 'No library cards available. Add cards from the Discover page!'}
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
