import React from "react";
import { Box, Card, CardContent, Typography } from "@mui/material";
import { DraggableCardContainer } from "./styled";
import { COLORS, CARD_FACE_JUSTIFY } from "./constants";
import type { VocabEntry } from "./types";

interface FlashCardSectionProps {
    currentEntry: VocabEntry | null;
    cardRef: React.RefObject<HTMLDivElement | null>;
    dragPosition: { x: number; y: number };
    isDragging: boolean;
    isFlipped: boolean;
    selectedCategory: string | null;
    handlers: {
        onTouchStart: (e: React.TouchEvent) => void;
        onTouchEnd: (e: React.TouchEvent) => void;
        onMouseDown: (e: React.MouseEvent) => void;
        onMouseMove: (e: React.MouseEvent) => void;
        onMouseUp: () => void;
        onMouseLeave: () => void;
    };
}

const FlashCardSection: React.FC<FlashCardSectionProps> = ({
    currentEntry,
    cardRef,
    dragPosition,
    isDragging,
    isFlipped,
    selectedCategory,
    handlers,
}) => {
    const rotation = dragPosition.x * 0.05;
    const opacity = 1 - Math.abs(dragPosition.x) / 400;

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
                        <Card
                            className="mobile-demo-flashcard"
                            ref={cardRef}
                            onTouchStart={handlers.onTouchStart}
                            onTouchEnd={handlers.onTouchEnd}
                            onMouseDown={handlers.onMouseDown}
                            onMouseMove={handlers.onMouseMove}
                            onMouseUp={handlers.onMouseUp}
                            onMouseLeave={handlers.onMouseLeave}
                            sx={{
                                backgroundColor: 'transparent',
                                background: 'none',
                                borderRadius: "12px",
                                boxShadow: "2px 4px 4px rgba(0, 0, 0, 0.25)",
                                cursor: "pointer",
                                position: "absolute",
                                inset: 0,
                                transformStyle: "preserve-3d",
                                transform: `translate(${dragPosition.x}px, ${dragPosition.y}px) rotate(${rotation}deg) rotateY(${isFlipped ? 180 : 0}deg)`,
                                transition: isDragging ? 'none' : 'transform 0.45s ease',
                                opacity: opacity,
                                overflow: 'visible',
                            }}
                        >
                            {/* Front face */}
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
                                        <Box className="mobile-demo-flashcard-text" sx={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'center', width: '100%' }}>
                                            <Typography
                                                className="mobile-demo-flashcard-word"
                                                sx={{
                                                    fontSize: 30,
                                                    fontWeight: 400,
                                                    color: COLORS.onSurface,
                                                    fontFamily: '"Inter", "Noto Sans JP", sans-serif',
                                                }}
                                            >
                                                {currentEntry.entryKey}
                                            </Typography>
                                            {currentEntry.pronunciation && (
                                                <Typography
                                                    className="mobile-demo-flashcard-pronunciation"
                                                    sx={{
                                                        fontSize: 16,
                                                        color: COLORS.onSurface,
                                                        opacity: 0.8,
                                                        fontFamily: '"Inter", sans-serif',
                                                        fontStyle: 'italic',
                                                    }}
                                                >
                                                    {currentEntry.pronunciation}
                                                </Typography>
                                            )}
                                        </Box>
                                    </Box>
                                </CardContent>
                            </Box>

                            {/* Back face */}
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
                                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'center', width: '100%' }}>
                                            <Typography sx={{
                                                fontSize: 30,
                                                fontWeight: 400,
                                                color: COLORS.onSurface,
                                                fontFamily: '"Inter", "Noto Sans JP", sans-serif',
                                            }}>
                                                {currentEntry.entryValue}
                                            </Typography>
                                        </Box>
                                    </Box>
                                </CardContent>
                            </Box>

                            {/* Drag overlay — above flip faces */}
                            <Box sx={{
                                position: 'absolute',
                                top: 0, left: 0, right: 0, bottom: 0,
                                backgroundColor: dragPosition.x > 50 ? COLORS.correct : dragPosition.x < -50 ? COLORS.incorrect : 'transparent',
                                opacity: Math.min(Math.abs(dragPosition.x) / 150, 0.3),
                                borderRadius: "12px",
                                pointerEvents: 'none',
                                zIndex: 3,
                            }} />
                        </Card>
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
