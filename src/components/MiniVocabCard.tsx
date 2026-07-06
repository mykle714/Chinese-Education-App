import { memo } from "react";
import { Box, Typography, IconButton } from "@mui/material";
import ForeignText from "./ForeignText";
import CardIconLayer from "../cardIcons/CardIconLayer";
import { iconImageUrl, isAdvancedLayout } from "../cardIcons/cardIconLayout";
import { stripParentheses } from "../utils/definitionUtils";
import { resolveTextColor } from "../utils/cardTextColor";
import { resolveCardColor } from "../utils/cardColor";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import RepeatIcon from "@mui/icons-material/Repeat";
import type { VocabEntry } from "../types";
import { getCategoryColor } from "../utils/categoryColors";
import { COLORS } from "../theme/colors";
import { SIZE, WEIGHT } from "../theme/scale";

interface MiniVocabCardProps {
    entry: VocabEntry;
    onClick?: (entry: VocabEntry) => void;
    onDelete?: (entry: VocabEntry) => void;
    onCycle?: (entry: VocabEntry) => void;
    // When set, the card plays the shared `cardPopIn` animation on mount, delayed
    // by this many ms. Callers (e.g. the /decks card previews) pass `index * step`
    // to stagger a freshly-loaded row into a left-to-right cascade. Omit elsewhere
    // (card detail page, flashcard back) to render with no entrance animation.
    animationDelayMs?: number;
}

// Category color mapping lives in src/utils/categoryColors (shared with the
// card detail page and the flashcard-learn back-of-card chip).

const MiniVocabCardComponent: React.FC<MiniVocabCardProps> = ({ entry, onClick, onDelete, onCycle, animationDelayMs }) => {
    // Render a custom icon arrangement behind the text only for ADVANCED layouts:
    // multiple icons, OR a single icon that has been moved/resized/rotated off its
    // default placement. Plain default-icon cards keep the icon-free thumbnail. Uses
    // the shared isAdvancedLayout() gate (cardIconLayout.ts) rather than a hand-rolled
    // length check so single-icon advanced designs aren't dropped. CardIconLayer is
    // fully percentage-based, so it scales to this 92×132 card with no pixel math.
    // See docs/CARD_ICON_LAYOUT.md.
    const hasAdvancedLayout = isAdvancedLayout(entry.iconLayout);
    // BASIC layout: a single default-placed icon (or none saved yet, but the entry still
    // has a det icon). Rendered as a plain image inside the fixed-height icon slot below
    // (NOT via CardIconLayer's card-wide percentage placement — that geometry puts the
    // default icon ~35% down the full card, which collides with the word at this small
    // size). The slot itself is always rendered, with or without an icon, so every mini
    // card reserves identical vertical space and the word sits at the same height.
    const hasBasicIcon = !hasAdvancedLayout && !!entry.iconId;
    // Per-card Contrast text-color overrides (migration 89): apply the same foreign/English
    // colors the flashcard face uses so the thumbnail matches. Undefined = theme default.
    const characterColor = resolveTextColor(entry.textColors?.foreign);
    const definitionColor = resolveTextColor(entry.textColors?.english);
    // Per-card background fill (migration 94): tint the thumbnail to match the flashcard's BACK
    // face (which this mini mirrors). Applied ONLY when the card is using an advanced layout —
    // same gate the flashcard face uses, INCLUDING a custom text placement (so pass textLayout
    // too), which is why this is a separate check from the icon-only `hasAdvancedLayout` above
    // (that one drives whether the icon layer renders and must not fire for a text-only-advanced
    // card that has no iconLayout). A basic card keeps the default thumbnail color.
    const isUsingAdvancedLayout = isAdvancedLayout(entry.iconLayout, entry.textLayout);
    const faceBg = (isUsingAdvancedLayout ? resolveCardColor(entry.cardColor) : undefined) ?? COLORS.card;
    return (
        <Box
            className="mini-vocab-card"
            onClick={() => onClick?.(entry)}
            sx={{
                width: 92,
                height: 132,
                backgroundColor: faceBg,
                borderRadius: '12px',
                boxShadow: '2px 4px 4px rgba(0, 0, 0, 0.25)',
                cursor: onClick ? 'pointer' : 'default',
                transition: 'transform 0.2s ease-in-out, box-shadow 0.2s ease-in-out',
                // CSS containment: let the browser skip layout/paint for cards
                // scrolled out of view (the /decks previews can hold hundreds of
                // cards on real accounts). They stay in the DOM and tappable;
                // `containIntrinsicSize` reserves the fixed 92×132 footprint so
                // scroll height stays stable while offscreen cards are skipped.
                contentVisibility: 'auto',
                containIntrinsicSize: '92px 132px',
                // Optional staggered entrance. `backwards` fill holds the scaled-down
                // start state during the delay; ending at scale(1) lets the hover-lift
                // transform take over cleanly once the animation finishes.
                ...(typeof animationDelayMs === "number" && {
                    animation: `cardPopIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) ${animationDelayMs}ms backwards`,
                }),
                position: 'relative',
                overflow: 'hidden',
                '&:hover': {
                    ...(onClick ? {
                        transform: 'translateY(-4px)',
                        boxShadow: '2px 6px 8px rgba(0, 0, 0, 0.3)',
                    } : {}),
                    '& .action-buttons': {
                        opacity: 1,
                    },
                },
            }}
        >
            {/* Custom advanced icon arrangement, drawn BEHIND the text (the layer
                sets zIndex 0 and establishes a stacking context confining its
                per-icon z values; the word/definition below are lifted to zIndex 1
                so they always read on top). Decorative + pointer-events: none. */}
            {hasAdvancedLayout && <CardIconLayer layout={entry.iconLayout!} />}

            {/* Action Buttons - Top Corners */}
            <Box
                className="action-buttons"
                sx={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '4px',
                    opacity: 0,
                    transition: 'opacity 0.2s ease-in-out',
                    zIndex: 2,
                }}
            >
                {/* Cycle Button - Top Left */}
                {onCycle && (
                    <IconButton
                        className="mini-vocab-card__cycle-button"
                        size="small"
                        onClick={(e) => {
                            e.stopPropagation();
                            onCycle(entry);
                        }}
                        sx={{
                            backgroundColor: '#2196f3',
                            color: 'white',
                            width: 28,
                            height: 28,
                            boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)',
                            '&:hover': {
                                backgroundColor: '#1976d2',
                                boxShadow: '0 2px 6px rgba(0, 0, 0, 0.3)',
                            },
                        }}
                    >
                        <RepeatIcon className="mini-vocab-card__cycle-icon" sx={{ fontSize: 18, color: 'white' }} />
                    </IconButton>
                )}

                {/* Delete Button - Top Right */}
                {onDelete && (
                    <IconButton
                        className="mini-vocab-card__delete-button"
                        size="small"
                        onClick={(e) => {
                            e.stopPropagation();
                            onDelete(entry);
                        }}
                        sx={{
                            backgroundColor: '#ef5350',
                            color: 'white',
                            width: 28,
                            height: 28,
                            boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)',
                            '&:hover': {
                                backgroundColor: '#d32f2f',
                                boxShadow: '0 2px 6px rgba(0, 0, 0, 0.3)',
                            },
                        }}
                    >
                        <DeleteOutlineIcon className="mini-vocab-card__delete-icon" sx={{ fontSize: 18, color: 'white' }} />
                    </IconButton>
                )}
            </Box>
            {/* UTCM Badge - top left. Shrunk to a single-letter dot (Unfamiliar/Target/
                Comfortable/Mastered) so the freed-up top space can hold the basic-layout
                icon instead. */}
            {entry.category && (
                <Box
                    className="mini-vocab-card__category-badge"
                    sx={{
                        position: 'absolute',
                        top: 8,
                        left: 8,
                        zIndex: 1,
                        width: 18,
                        height: 18,
                        borderRadius: '50%',
                        backgroundColor: getCategoryColor(entry.category),
                        color: 'white',
                        fontSize: SIZE.micro,
                        fontWeight: WEIGHT.bold,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 1px 2px rgba(0, 0, 0, 0.3)',
                    }}
                >
                    {entry.category.charAt(0)}
                </Box>
            )}

            {/* Icon slot - fixed position/height, always rendered (empty when the card has
                no basic icon) so every mini card reserves identical space here regardless
                of icon presence. Positioned absolutely (independent of the word/definition
                below) so nudging it doesn't cascade into their positions. */}
            <Box
                className="mini-vocab-card__icon-slot"
                sx={{
                    position: 'absolute',
                    top: 14,
                    left: 8,
                    right: 8,
                    height: 26,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 1,
                }}
            >
                {hasBasicIcon && (
                    <Box
                        component="img"
                        className="mini-vocab-card__icon"
                        src={iconImageUrl(entry.iconId!)}
                        alt=""
                        draggable={false}
                        sx={{ width: 26, height: 26, objectFit: 'contain', userSelect: 'none' }}
                    />
                )}
            </Box>

            {/* Entry Key (Word/Character) + pronunciation, rendered per-character
                via cpcd (ForeignText): each character carries its tone-colored
                pinyin overlay. For Latin-script languages (es) ForeignText falls
                back to plain text with no pinyin row. Items wrap so multi-character
                phrases reflow within the narrow (~76px) card body. Positioned
                absolutely, below the icon slot, independent of the definition's
                position (see below). */}
            <Box
                className="mini-vocab-card__key-wrapper"
                sx={{
                    position: 'absolute',
                    top: 46,
                    left: 8,
                    right: 8,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minWidth: 0,
                    // Sit above the advanced icon layer (zIndex 0) so the word reads on top.
                    zIndex: 1,
                }}
            >
                <ForeignText
                    className="mini-vocab-card__entry-key"
                    language={entry.language}
                    size="xs"
                    bold
                    flexWrap="wrap"
                    justifyContent="center"
                    text={entry.entryKey}
                    pronunciation={entry.pronunciation}
                    characterColor={characterColor}
                />
            </Box>

            {/* Entry Value (Definition). Anchored to the bottom independently of the icon
                slot / word above — it keeps its original resting spot no matter how those
                are nudged. */}
            <Typography
                className="mini-vocab-card__entry-value"
                sx={{
                    position: 'absolute',
                    bottom: 8,
                    left: 8,
                    right: 8,
                    fontSize: SIZE.caption,
                    color: definitionColor ?? COLORS.textSecondary,
                    textAlign: 'center',
                    lineHeight: 1.2,
                    overflow: 'hidden',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    minHeight: 24,
                    // Above the advanced icon layer (zIndex 0).
                    zIndex: 1,
                }}
            >
                {stripParentheses(entry.definition ?? '')}
            </Typography>
        </Box>
    );
};

// Memoized: the /decks previews render long lists of these, and unrelated
// parent state (e.g. toggling a snackbar) must not re-render every card. Props
// are primitives + a stable `entry`, so referential equality is sufficient.
const MiniVocabCard = memo(MiniVocabCardComponent);

export default MiniVocabCard;
