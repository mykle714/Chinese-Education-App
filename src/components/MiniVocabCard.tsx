import { memo } from "react";
import { Box, Typography, IconButton, useTheme } from "@mui/material";
import ForeignText from "./ForeignText";
import CardIconLayer from "../cardIcons/CardIconLayer";
import { iconImageUrl, isAdvancedLayout } from "../cardIcons/cardIconLayout";
import { resolveDisplayDefinition, resolveDisplayPronunciation } from "../utils/definitionUtils";
import { resolveTextColor } from "../utils/cardTextColor";
import { resolveCardColor } from "../utils/cardColor";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import RepeatIcon from "@mui/icons-material/Repeat";
import type { VocabEntry } from "../types";
import { masteryBar, masteryWindowCells, PBH_FULL, BAR_LABELS, MARK_TYPE_LABELS, type MasteryBarId } from "../utils/masteryCompute";
import { getBandInk } from "../utils/categoryColors";
import { COLORS } from "../theme/colors";
import { SIZE } from "../theme/scale";
import { SHADOW } from "../theme/shadows";
import { miniCardFaceSx, MINI_CARD_RING } from "./miniCardFace";

interface MiniVocabCardProps {
    entry: VocabEntry;
    onClick?: (entry: VocabEntry) => void;
    onDelete?: (entry: VocabEntry) => void;
    onCycle?: (entry: VocabEntry) => void;
    /**
     * Draw the bottom mastery window strip. Default true — every deck/collection surface
     * wants it, because there the card's job is partly to report progress.
     *
     * Set false where the card is a PREVIEW of a word rather than a readout of the
     * learner's standing on it (the provisional lent-card notice and sort offer): a
     * borrowed card's bars are either empty or a half-round's worth of marks, so the
     * strip is noise at best and a discouraging "you know nothing" mark at worst, in a
     * dialog whose only question is "do you want this word?". Suppressing it also drops
     * the strip's reserved height, so the definition sits lower and the card breathes.
     *
     * This prop is now the ONLY mastery switch on the card. It used to leak: the corner
     * utcm letter badge was never gated by it, so a suppressed card still got stamped
     * with a `U`. The badge is gone (frame 17), so "false" now means what it says.
     */
    showMasteryStrip?: boolean;
    /**
     * The surface's mastery LENS (docs/DECKS_FEATURE.md § "Mastery Centers").
     *
     * ALWAYS exactly one bar — the card carries a single eight-cell window for the lens
     * it is shown under, and nothing else. Defaults to `core`, so a card on any
     * recognition/production surface (the fdp, search, the sort offer) reports
     * recognition and production only; a Reading Center card passes `reading` and
     * reports that instead.
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

// ── Mastery window strip (docs/MASTERY_REWORK.md § "Mini cards") ────────────────
// The cdp's eight-mark window (`MasteryWindow`, the design's `.msb .cells`) shrunk to a
// hairline along the bottom of the card: **`PBH_FULL` discrete cells, one per mark**, for
// the surface's lens bar. Same shape, same `masteryWindowCells` geometry, same partial
// trailing cell — so a learner who has read the cdp already knows how to read this.
//
// Cells rather than a continuous fill because pbh IS a count, not a percentage. One bad
// mark turns a cell off; it does not drain a fraction of a tank. The thumbnail should not
// invite an estimate the detail page spent a whole component refusing to invite.
//
// COLOR is the lens bar's utcm band (`getBandInk`), one hue for every filled cell —
// unlike the cdp, which colors each cell by the mark type that owns it. At this size a
// two-hue fill inside 8 cells of ~8px is mush, and the band is the question a thumbnail
// is actually asked ("how well do I know this?"). The per-type split survives in the
// tooltip.
//
// ⚠️ `getBandInk`, NOT `getCategoryColor`. The band's normal value is a ~1.15:1 PASTEL
// legible only behind a 1px `COLORS.markOutline` ring, and a 3px cell cannot carry one —
// the ring would eat two thirds of it. See the BAND_INK note in `utils/categoryColors.ts`,
// which also explains why this is not the pre-redesign saturated band palette (those
// hexes ARE the mark-type colors).
//
// LINEAGE. Frame 17 draws this strip as one pip per mark type painted Recognition blue /
// Production green. Two later decisions moved off it — color onto the band, then the row
// onto the cdp's 8 cells — so only the strip's PLACEMENT (full width, 8px inset, 3px tall,
// bottom of the card) is still the frame's.
const BAR_STRIP = {
    height: 3,        // frame 17's hairline
    cellGap: 1.5,     // the cdp's 3px gap does not survive the scale down; half of it does
    inset: 8,         // left AND right — the window spans the card
    bottom: 8,
};

/** Vertical space the strip occupies — one hairline row, or nothing when suppressed. */
const barStripHeight = (visible: boolean): number => (visible ? BAR_STRIP.height : 0);

const MiniVocabCardComponent: React.FC<MiniVocabCardProps> = ({ entry, onClick, onDelete, onCycle, animationDelayMs, showMasteryStrip = true, lens = "core" }) => {
    const fc = useTheme().palette.flashcard;
    // The lens bar, or null when the strip is suppressed. Its `category` is the band the
    // window is painted with, and its `pbh` drives the cells — both computed here from
    // `typedMarkHistory` rather than read off `entry.category`, because that column is the
    // CORE band by definition and would be the wrong answer inside a Reading/Writing Center.
    const bar = showMasteryStrip ? masteryBar(entry.typedMarkHistory, lens) : null;
    // The same eight-cell geometry the cdp window draws, from the same helper — the two
    // surfaces must not drift on where the partial cell falls.
    const cells = bar ? masteryWindowCells(bar) : [];
    const bandInk = getBandInk(bar?.category);
    // The per-mark-type split the cells no longer show, kept on hover: "Know 4.3/8 ·
    // Comfortable · Recognition 5, Production 2". Costs nothing visually and means the
    // detail is still reachable without opening the cdp.
    const stripTitle = bar
        ? `${BAR_LABELS[bar.id]} ${Number.isInteger(bar.pbh) ? bar.pbh : bar.pbh.toFixed(1)}/${PBH_FULL} · ${bar.category}` +
          ` · ${bar.segments.map((seg) => `${MARK_TYPE_LABELS[seg.type]} ${seg.positive}`).join(", ")}`
        : "";
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
    // Falls back to the THEME's card face, not to a fixed token. It used to fall back to
    // `COLORS.card`, which was the same value as the light theme's face and so looked
    // right — but it meant a mini card ignored the theme entirely, staying light-grey on
    // Dark / Ocean / Nature while the full-size face beside it changed. Frame 17 of the
    // design turns on these two being the same surface ("the preview is literally the
    // card"), so they now read the same source. Matches `CardFace`'s `faceBg`.
    const faceBg = (isUsingAdvancedLayout ? resolveCardColor(entry.cardColor) : undefined) ?? fc.flashCard;
    return (
        <Box
            className="mini-vocab-card"
            onClick={() => onClick?.(entry)}
            sx={{
                // The shared face — size, radius, hairline ring, elevation, containment
                // and the pop-in (src/components/miniCardFace.ts). This card, the Quick
                // Mark card and the challenge word card all draw the SAME tile; only
                // what fills it differs.
                ...miniCardFaceSx({ background: faceBg, hoverLift: !!onClick, animationDelayMs }),
                cursor: onClick ? 'pointer' : 'default',
                // The hover state additionally reveals the corner action buttons, which
                // is this card's alone — the shared face only steps the elevation.
                '&:hover': {
                    ...(onClick ? { boxShadow: `${MINI_CARD_RING}, ${SHADOW.float}` } : {}),
                    '& .action-buttons': { opacity: 1 },
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
                            boxShadow: SHADOW.chip,
                            '&:hover': {
                                backgroundColor: '#1976d2',
                                boxShadow: SHADOW.float,
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
                            boxShadow: SHADOW.chip,
                            '&:hover': {
                                backgroundColor: '#d32f2f',
                                boxShadow: SHADOW.float,
                            },
                        }}
                    >
                        <DeleteOutlineIcon className="mini-vocab-card__delete-icon" sx={{ fontSize: 18, color: 'white' }} />
                    </IconButton>
                )}
            </Box>
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
                    bottom: BAR_STRIP.bottom + barStripHeight(!!bar) + 5,
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

            {/* Mastery window: the cdp's eight-mark window at thumbnail scale, spanning
                the card's width. One shared `title` rather than one per cell — eight
                native tooltips along a 3px strip would fight each other, and the useful
                reading is the whole window anyway. */}
            {cells.length > 0 && <Box
                className="mini-vocab-card__mastery-window"
                title={stripTitle}
                sx={{
                    position: 'absolute',
                    bottom: BAR_STRIP.bottom,
                    left: BAR_STRIP.inset,
                    right: BAR_STRIP.inset,
                    display: 'flex',
                    gap: `${BAR_STRIP.cellGap}px`,
                    zIndex: 1,
                }}
            >
                {cells.map((cell, i) => (
                    <Box
                        key={i}
                        className={`mini-vocab-card__mastery-cell${cell.fill > 0 ? " mini-vocab-card__mastery-cell--filled" : ""}`}
                        sx={{
                            // Equal share of the row, so the eight cells always span the
                            // card whatever its width — no pixel math to keep in step
                            // with the 92px face.
                            flex: 1,
                            height: BAR_STRIP.height,
                            borderRadius: BAR_STRIP.height / 2,
                            // Frame 17's empty-track tint. Deliberately NOT the cdp's
                            // 6% fill + 12% inset ring: at 3px tall that ring would be
                            // most of the cell, so the empty state is carried by a single
                            // slightly stronger flat tint instead.
                            backgroundColor: 'rgba(23, 22, 26, 0.13)',
                            overflow: 'hidden',
                        }}
                    >
                        {/* A partial trailing cell is rendered partial, not rounded —
                            rounding would make two genuinely different cards read the
                            same. Every filled cell takes the band ink; the mark type
                            that owns it (`cell.type`) is what the CDP colors by, and is
                            deliberately unused here. */}
                        {cell.fill > 0 && (
                            <Box
                                className="mini-vocab-card__mastery-cell-fill"
                                sx={{
                                    width: `${cell.fill * 100}%`,
                                    height: '100%',
                                    backgroundColor: bandInk,
                                    // Color transitions too: crossing a band boundary
                                    // should read as the strip changing state, not just
                                    // one more cell lighting up.
                                    transition: 'width 240ms ease, background-color 240ms ease',
                                }}
                            />
                        )}
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
