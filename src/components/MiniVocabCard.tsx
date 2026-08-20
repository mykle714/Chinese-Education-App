import { memo } from "react";
import { Box, Typography, IconButton } from "@mui/material";
import ForeignText from "./ForeignText";
import CardIconLayer from "../cardIcons/CardIconLayer";
import { iconImageUrl, isAdvancedLayout } from "../cardIcons/cardIconLayout";
import { resolveDisplayDefinition, resolveDisplayPronunciation } from "../utils/definitionUtils";
import { resolveTextColor } from "../utils/cardTextColor";
import { resolveCardColor } from "../utils/cardColor";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import RepeatIcon from "@mui/icons-material/Repeat";
import type { VocabEntry } from "../types";
import { getCategoryColor } from "../utils/categoryColors";
import { masteryBar, BAR_LABELS, MARK_TYPE_COLORS, type MasteryBarId } from "../utils/masteryCompute";
import { COLORS } from "../theme/colors";
import { SIZE, WEIGHT } from "../theme/scale";

interface MiniVocabCardProps {
    entry: VocabEntry;
    onClick?: (entry: VocabEntry) => void;
    onDelete?: (entry: VocabEntry) => void;
    onCycle?: (entry: VocabEntry) => void;
    /**
     * Draw the bottom-left mastery strip. Default true — every deck/collection surface
     * wants it, because there the card's job is partly to report progress.
     *
     * Set false where the card is a PREVIEW of a word rather than a readout of the
     * learner's standing on it (the provisional lent-card notice and sort offer): a
     * borrowed card's bars are either empty or a half-round's worth of marks, so the
     * strip is noise at best and a discouraging "you know nothing" mark at worst, in a
     * dialog whose only question is "do you want this word?". Suppressing it also drops
     * the strip's reserved height, so the definition sits lower and the card breathes.
     */
    showMasteryStrip?: boolean;
    /**
     * The surface's mastery LENS (docs/DECKS_FEATURE.md § "Mastery Centers").
     *
     * ALWAYS exactly one bar — the card carries a single hairline track and a band
     * badge for the lens it is shown under, and nothing else. Defaults to `core`, so a
     * card on any recognition/production surface (the fdp, search, the sort offer)
     * reports recognition and production only; a Reading Center card passes `reading`
     * and reports that instead.
     *
     * The strip used to draw one track per goal the account pursued, which put reading
     * and writing progress onto pages that were not asking about them — the whole
     * reason the Centers exist. One surface, one question, one bar.
     */
    lens?: MasteryBarId;
    // When set, the card plays the shared `cardPopIn` animation on mount, delayed
    // by this many ms. Callers (e.g. the /decks card previews) pass `index * step`
    // to stagger a freshly-loaded row into a left-to-right cascade. Omit elsewhere
    // (card detail page, flashcard back) to render with no entrance animation.
    animationDelayMs?: number;
}

// Category color mapping lives in src/utils/categoryColors (shared with the
// card detail page and the flashcard-learn back-of-card chip).

// ── Mastery bar strip (docs/MASTERY_REWORK.md § "Three bars") ────────────────────
// ONE hairline bar in the card's bottom-left corner: the surface's lens bar (core on
// every recognition/production surface, the skill's inside a Mastery Center — see the
// `lens` prop). Deliberately tiny and unlabelled: at 92x132 there is no room for a
// legend, and the strip is meant to be read as a glanceable shape across a grid of
// cards. The cdp is where a learner goes for the detail.
//
// The geometry below is still written for `n` bars. Kept general on purpose: the strip
// stacked up to three before the lens rule, and nothing here needs to know it is now
// always one.
const BAR_STRIP = {
    height: 3,        // hairline — three of these still read as one small block
    width: 30,        // ~1/3 of the card width, so the strip stays a corner mark
    gap: 2,
    left: 10,         // the "margin" the strip is left-justified against
    bottom: 6,
};

/** Total vertical space the strip occupies, for `n` bars (0 when there are none). */
const barStripHeight = (n: number): number =>
    n === 0 ? 0 : n * BAR_STRIP.height + (n - 1) * BAR_STRIP.gap;

const MiniVocabCardComponent: React.FC<MiniVocabCardProps> = ({ entry, onClick, onDelete, onCycle, animationDelayMs, showMasteryStrip = true, lens = "core" }) => {
    // An empty list when the strip is suppressed, so the ONE array drives both the
    // rendering below and the definition's bottom offset — there is no second way for
    // the two to disagree about how much room the strip takes. Otherwise exactly one
    // bar: the lens's. The strip's height is therefore the same on every card of every
    // surface, and the definition sits at one fixed offset.
    const bars = !showMasteryStrip ? [] : [masteryBar(entry.typedMarkHistory, lens)];
    // Which band the corner badge reports: the lens's band, computed here from
    // `typedMarkHistory` rather than fetched. `entry.category` is the CORE band by
    // definition (CORE_CATEGORY_SELECT) and every bar is derivable from the history
    // already on the row, so under core the two agree and under a skill lens only this
    // one is right. See docs/MASTERY_REWORK.md § "Which bar does a whole-card question
    // mean".
    const badgeCategory = bars[0]?.category ?? entry.category;
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
                icon instead.

                Colored by the surface's bar: the CORE band by default (`entry.category`
                since migration 143, the same thing every other whole-card readout —
                deck counts, the Review gate — reports), or the LENS bar's band inside a
                Mastery Center. The bands the badge is not showing are in the strip at
                the bottom. */}
            {badgeCategory && (
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
                        backgroundColor: getCategoryColor(badgeCategory),
                        color: 'white',
                        fontSize: SIZE.micro,
                        fontWeight: WEIGHT.bold,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 1px 2px rgba(0, 0, 0, 0.3)',
                    }}
                >
                    {badgeCategory.charAt(0)}
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
                    // Sense-resolved, matching the dd this card prints below the word.
                    pronunciation={resolveDisplayPronunciation(entry)}
                    characterColor={characterColor}
                    // Latin-script (es) only: a Spanish headword is many glyphs wide where a
                    // Chinese one is 1–2, so the shared xs size (18px) overruns this 76px-wide
                    // card body. Drop it to 14px; zh is unaffected (ForeignText ignores this
                    // for character-based languages).
                    plainFontSize="14px"
                />
            </Box>

            {/* Entry Value (Definition). Anchored to the bottom independently of the icon
                slot / word above — it keeps its original resting spot no matter how those
                are nudged. Lifted clear of the mastery strip below it, so adding a
                reading/writing goal pushes the text up rather than colliding with it. */}
            <Typography
                className="mini-vocab-card__entry-value"
                sx={{
                    position: 'absolute',
                    bottom: BAR_STRIP.bottom + barStripHeight(bars.length) + 5,
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
                {/* dd via the shared resolver so the thumbnail matches the card face's
                    chosen sense (vet.selectedSense) rather than det's definitions[0]. */}
                {resolveDisplayDefinition(entry)}
            </Typography>

            {/* Mastery strip: one hairline track for the lens bar, filled to that bar's
                pbh. Left-justified against BAR_STRIP.left rather than centered, so the
                strip reads as a margin annotation and does not compete with the
                centered word and definition above it. */}
            {bars.length > 0 && <Box
                className="mini-vocab-card__mastery-strip"
                sx={{
                    position: 'absolute',
                    bottom: BAR_STRIP.bottom,
                    left: BAR_STRIP.left,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: `${BAR_STRIP.gap}px`,
                    zIndex: 1,
                }}
            >
                {bars.map((bar) => (
                    <Box
                        key={bar.id}
                        className={`mini-vocab-card__mastery-bar mini-vocab-card__mastery-bar--${bar.id}`}
                        // Native title rather than a MUI Tooltip: these are decorative
                        // at this size, and three tooltip wrappers per card across a
                        // long grid is real render cost for a hover affordance that
                        // does not exist on touch anyway.
                        title={`${BAR_LABELS[bar.id]}: ${bar.category}`}
                        sx={{
                            width: BAR_STRIP.width,
                            height: BAR_STRIP.height,
                            borderRadius: BAR_STRIP.height / 2,
                            backgroundColor: 'rgba(0, 0, 0, 0.13)',
                            overflow: 'hidden',
                        }}
                    >
                        {/* The fill carries the SAME per-type breakdown as the cdp bar
                            (MasteryProgressBar's BarTrack): the core bar splits its
                            length between recognition blue and production green in
                            proportion to their positive counts, so a card that is
                            strong one way and weak the other reads that way at
                            thumbnail size too. Laid out left-to-right here rather than
                            the cdp's bottom-up column, so the first type sits at the
                            track's origin in both. */}
                        <Box
                            className="mini-vocab-card__mastery-bar-fill"
                            sx={{
                                width: `${bar.heightFraction * 100}%`,
                                height: '100%',
                                borderRadius: BAR_STRIP.height / 2,
                                display: 'flex',
                                overflow: 'hidden',
                                transition: 'width 240ms ease',
                            }}
                        >
                            {bar.segments
                                .filter((seg) => seg.positive > 0)
                                .map((seg) => (
                                    <Box
                                        key={seg.type}
                                        className={`mini-vocab-card__mastery-segment mini-vocab-card__mastery-segment--${seg.type}`}
                                        sx={{
                                            width: `${seg.fraction * 100}%`,
                                            height: '100%',
                                            backgroundColor: MARK_TYPE_COLORS[seg.type],
                                        }}
                                    />
                                ))}
                        </Box>
                    </Box>
                ))}
            </Box>}
        </Box>
    );
};

// Memoized: the /decks previews render long lists of these, and unrelated
// parent state (e.g. toggling a snackbar) must not re-render every card. Props
// are primitives + a stable `entry`, so referential equality is sufficient.
const MiniVocabCard = memo(MiniVocabCardComponent);

export default MiniVocabCard;
