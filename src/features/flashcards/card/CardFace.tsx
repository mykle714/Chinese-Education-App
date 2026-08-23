import React from "react";
import { Box, CardContent, Typography, useTheme } from "@mui/material";
import { sortedSenseClusters, resolveDisplayDefinition, resolveDisplayPronunciation } from "../../../utils/definitionUtils";
import {
    CARD_FACE_JUSTIFY,
    CARD_FLIP_MS,
    FC_FONT,
    FC_FONT_CJK,
} from "../constants";
import { SIZE, WEIGHT, LEADING, TRACKING } from "../../../theme/scale";
import type { VocabEntry } from "../types";
import type { IconLayoutItem, TextLayout } from "../../../types";
import CardIconLayer from "../../../cardIcons/CardIconLayer";
import { defaultLayoutForIcon } from "../../../cardIcons/cardIconLayout";
import { resolveTextLayout, textItemTransform, defaultEnglishTopAnchorTransform } from "../../../cardIcons/cardTextLayout";
import ForeignText from "../../../components/ForeignText";
import SensePicker from "./SensePicker";
import { SpeakerButton } from "../../../components/SpeakerButton";
import PracticeWritingButton from "../../../components/handwriting/PracticeWritingButton";
import { getCategoryColor } from "../../../utils/categoryColors";
import { resolveTextColor, DD_TONES } from "../../../utils/cardTextColor";
import { resolveCardColor } from "../../../utils/cardColor";
import { COLORS } from "../../../theme/colors";

/**
 * The reusable flashcard FACE — the visual card itself, independent of the drill.
 *
 * ── Why this is its own module ────────────────────────────────────────────────
 * `ChineseBlock`, `EnglishBlock` and `CardFaceSide` render a card face and nothing
 * else; the swipe/flip/fly-out DRILL that consumes them lives in
 * `features/flashcards/FlashcardsLearnPage/FlashCardSection.tsx`. Five surfaces
 * outside the flp render a card face without the drill — VocabCardDetailPage (cdp),
 * DictionaryCardDetailPage, CommunityCardView, ExampleSentenceList and
 * InfoCardPanelBody — and each of them used to reach INTO the flp page folder to get
 * these, which made a page-specific folder a de-facto shared module.
 * See docs/ARCHITECTURE_REVIEW.md finding 9.
 *
 * FlashCardSection.tsx re-exports every symbol here, so existing import sites are
 * unchanged.
 *
 * Referenced by docs/CARD_ICON_LAYOUT.md (icon/text layout rendering) and
 * docs/FLASHCARD_REVIEW_HISTORY_IMPLEMENTATION.md.
 */

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
    // When true the speaker/writing actions are laid out IN-FLOW (a column to the right of
    // the text) instead of absolutely positioned off the text's right edge. In-flow makes the
    // actions part of the block's measured box, so the fie selection outline + on-card clamp
    // include them (the movable-text case). Default (false) keeps the actions absolute so they
    // don't shift the centered text in the normal lower-third layout. See docs/CARD_ICON_LAYOUT.md.
    inlineActions?: boolean;
    // Which sense the card is currently on (index into `sortedSenseClusters`). The
    // pinyin over the characters is per-SENSE for a heteronym (过去 guò qù / guò qu),
    // so this block must resolve its pronunciation from the same pick EnglishBlock
    // resolves its gloss from — see resolveDisplayPronunciation. Omit to fall back to
    // the entry's persisted `selectedSense`.
    selectedSenseIndex?: number;
}> = ({ entry, showPinyin, showPinyinColor, onSpeak, speakingKey, showWriting = false, inlineActions = false, selectedSenseIndex }) => {
    const showWritingButton = showWriting && entry.language === "zh";
    // Per-card Contrast override for the foreign-word GLYPHS only (pinyin is untouched).
    // Undefined = theme default. See docs/CARD_ICON_LAYOUT.md.
    const characterColor = resolveTextColor(entry.textColors?.foreign);
    // The writing + audio buttons, stacked vertically (writing on top, speaker below),
    // mirroring the eip header stack. Either may be absent (non-zh hides writing; no onSpeak
    // hides audio). Rendered the same whether absolute or in-flow — only the wrapper differs.
    const actions = (onSpeak || showWritingButton) ? (
        <Box
            className="mobile-demo-flashcard-actions"
            sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.25 }}
        >
            {showWritingButton && (
                <PracticeWritingButton
                    character={entry.entryKey}
                    language={entry.language}
                    vocabEntryId={entry.id}
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
    ) : null;
    return (
        // Outer row fills the width and centers the Chinese text within the card.
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }} className="mobile-demo-flashcard-chinese-block">
            {/* Inner wrapper shrinks to the whole assembly's width. In the default (non-inline)
                layout the actions are absolutely positioned off the text's right edge, so they
                don't affect this wrapper's hugged width at all — centering it centers the row.
                In inlineActions mode the actions sit in-flow (so the fie selection outline +
                on-card clamp include them), which would otherwise pull the row's visual center
                to the left; a same-width HIDDEN spacer mirrors them on the left so the row
                (cpcd-row) stays the true center of the assembly regardless. */}
            <Box
                sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
                className="mobile-demo-flashcard-chinese-inner"
            >
                {inlineActions && actions && (
                    <Box aria-hidden sx={{ visibility: 'hidden', mr: 1 }}>{actions}</Box>
                )}
                <ForeignText
                    size="md"
                    justifyContent="center"
                    className="mobile-demo-flashcard-cpcd-row"
                    text={entry.entryKey}
                    pronunciation={resolveDisplayPronunciation(entry, selectedSenseIndex)}
                    showPinyin={showPinyin}
                    useToneColor={showPinyinColor}
                    characterColor={characterColor}
                />
                {actions && (
                    inlineActions ? (
                        // In-flow: a column to the right of the text, part of the measured box.
                        // Balanced by the hidden spacer above so the row itself stays centered.
                        <Box sx={{ ml: 1, display: 'flex' }}>{actions}</Box>
                    ) : (
                        // Absolute: hangs off the text's right edge without shifting it.
                        <Box sx={{ position: 'absolute', left: '100%', top: '50%', transform: 'translateY(-50%)', ml: 1 }}>
                            {actions}
                        </Box>
                    )
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
// When the entry has zh orthogonal sense clusters (definitionClusters, migration 90 —
// see docs/DEFINITION_CLUSTERS.md), the shared SensePicker (SensePicker.tsx) renders a
// small triangle trigger beside the text, opening a menu of the word's other senses —
// the same picker the eip definition header mounts. Undiscoverable/unclustered entries
// (definitionClusters null or a single cluster) render exactly as before — no trigger,
// no picker.
export const EnglishBlock: React.FC<{
    entry: VocabEntry;
    // Index into the frequency-sorted cluster list currently shown. Owned by CardFace
    // (per-entry state) so both faces (Side 1 English mode + Side 2) stay in sync and
    // the pick resets to the top (starred) sense whenever the card changes.
    selectedSenseIndex?: number;
    onSelectSense?: (index: number) => void;
    // When true, the sense-trigger renders IN-FLOW (mirrors ChineseBlock's inlineActions):
    // Side 2's movable-text editor measures the text block's own (width: max-content) box
    // for its selection outline + clamp, so an absolutely-positioned trigger would escape
    // that measurement. Side 1 (front, English mode) omits this — same asymmetry as
    // ChineseBlock. See docs/CARD_ICON_LAYOUT.md "Movable text".
    inlineActions?: boolean;
    // When true, the picker's zh reading headings are replaced by neutral "Group N"
    // labels. Used on the FRONT/question side, where the card shows only English and the
    // learner is supposed to produce the Chinese — a tone-colored pinyin heading in the
    // sense menu would hand them the pronunciation (and the tones) for free. The grouping
    // itself is still useful (it shows which senses share a reading), so only the label is
    // censored; the back/answer side and all non-quiz surfaces show the real pinyin.
    censorReadings?: boolean;
}> = ({ entry, selectedSenseIndex = 0, onSelectSense, inlineActions = false, censorReadings = false }) => {
    const theme = useTheme();
    // The dd draws from DD_TONES (dark grey / muted light grey) rather than the foreign
    // glyphs' pure black/white — it is supporting text, so it sits one step off full
    // contrast. Which of the two tones is used is either the card theme's pick (the `dd`
    // token) or, when the learner has made an explicit per-card Contrast pick, the tone
    // they chose from that same pair.
    const englishColor =
        resolveTextColor(entry.textColors?.english, DD_TONES) ?? theme.palette.flashcard.dd;

    // A picker only makes sense with a real choice — a single-cluster (or unclustered)
    // entry falls back to the plain definitions[0] dd, unchanged from before this feature.
    // Sorted highest conversation-frequency first (nulls last) so index 0 is always the
    // starred/default sense.
    const sortedClusters = React.useMemo(() => sortedSenseClusters(entry), [entry]);

    // The card face's dd goes through the shared resolver like every other dd surface;
    // the live `selectedSenseIndex` is passed as the override so a pick made this session
    // shows immediately, before the persisted `selectedSense` round-trips back.
    const text = resolveDisplayDefinition(entry, selectedSenseIndex);

    // The sense-picker trigger, structured exactly like ChineseBlock's `actions`
    // (writing + speaker buttons): a small column Box, so the two blocks stay
    // visually/structurally consistent even though English currently has only
    // one action. The trigger + menu themselves are the shared SensePicker, which
    // the eip definition header mounts too (see SensePicker.tsx). The
    // `sortedClusters` gate is duplicated here — not to decide whether the picker
    // renders (SensePicker self-hides) but because the whole `actions` column, and
    // the hidden spacer that balances it, must collapse when there is no choice.
    const actions = sortedClusters ? (
        <Box
            className="mobile-demo-flashcard-actions"
            sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.25 }}
        >
            <SensePicker
                entry={entry}
                selectedSenseIndex={selectedSenseIndex}
                onSelectSense={onSelectSense}
                color={englishColor}
                censorReadings={censorReadings}
            />
        </Box>
    ) : null;

    return (
        // Outer row fills the width and centers the English text within the card —
        // mirrors ChineseBlock's outer row exactly.
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }} className="mobile-demo-flashcard-english-block">
            {/* Inner wrapper shrinks to the whole assembly's width — same role as
                ChineseBlock's inner wrapper (see its comment for the centering rationale). */}
            <Box
                sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
                className="mobile-demo-flashcard-english-inner"
            >
                {inlineActions && actions && (
                    <Box aria-hidden sx={{ visibility: 'hidden', mr: 1 }}>{actions}</Box>
                )}
                {/* Dedicated row layer around just the text — mirrors CPCDRow's own root Box
                    (position:relative, distinct from ForeignText's enclosing "-inner" flex
                    container). Keeps English structurally parallel to Chinese: a plain
                    text/glyph layer as one sibling, the actions box as the other. This is the
                    layer that stays the true visual center of the assembly — the hidden spacer
                    above balances the in-flow actions below so centering the "-inner" wrapper
                    (via "-block"'s justifyContent:center) centers THIS row, not the row+actions
                    group. */}
                <Box className="mobile-demo-flashcard-english-row" sx={{ position: 'relative' }}>
                    <Typography sx={{
                        fontSize: englishFontSize(text),
                        fontWeight: WEIGHT.regular,
                        color: englishColor,
                        fontFamily: FC_FONT_CJK,
                        textAlign: 'center',
                        lineHeight: 1.25,
                    }}>
                        {text}
                    </Typography>
                </Box>
                {actions && (
                    inlineActions ? (
                        // In-flow: part of the measured box, so the fie selection/clamp include it.
                        // Balanced by the hidden spacer above so the row itself stays centered.
                        <Box sx={{ ml: 1, display: 'flex' }}>{actions}</Box>
                    ) : (
                        // Absolute: hangs off the text's right edge without shifting it —
                        // same positioning ChineseBlock uses for its (non-inline) actions.
                        <Box sx={{ position: 'absolute', left: '100%', top: '50%', transform: 'translateY(-50%)', ml: 1 }}>
                            {actions}
                        </Box>
                    )
                )}
            </Box>
        </Box>
    );
};

// Progress-category chip shown in the top-left corner of Side 2 when the setting
// is enabled. Absolutely positioned within the card face (matching MiniVocabCard's
// top-left badge). Tinted with the shared category color. Renders only when a
// category is present on the entry.
export const CategoryChip: React.FC<{ category?: string }> = ({ category }) => {
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
                // The category colors are PASTELS post-redesign (docs/SHELF_REDESIGN.md,
                // D2). The chip sits on the card's beige face, so it needs the ramp's
                // inset ring to hold an edge, and ink rather than white for its label.
                boxShadow: `inset 0 0 0 1px ${COLORS.markOutline}`,
            }}
        >
            <Typography sx={{ fontSize: SIZE.caption, fontWeight: WEIGHT.semibold, color: COLORS.onSurface, fontFamily: FC_FONT, lineHeight: LEADING.normal, letterSpacing: TRACKING.wide }}>
                {category}
            </Typography>
        </Box>
    );
};

// Shared scaffold for a single card face: the absolutely-positioned, backface-
// hidden face box + its CardContent + the inner flex column holding the image
// placeholder and a content slot. `rotated` flips the face to the back (Side 2);
// `contentGap` differs between the single-block front and the stacked back.
export const CardFaceSide: React.FC<{
    rotated: boolean;
    // Whether this face is rendering the entry's ADVANCED layout (a saved multi-icon /
    // moved-icon arrangement OR custom text placement). It is the single gate for the
    // advanced-only per-card background fill. The CALLER decides it per face — the back/answer
    // face passes the entry-level verdict directly, while the flp's Chinese front deliberately
    // passes false so the question side stays a plain basic card (see the call sites). Kept
    // independent of `rotated` (the 180° flip transform) on purpose: the card-detail hero is an
    // un-rotated back face and still needs the fill.
    isUsingAdvancedLayout?: boolean;
    contentGap: number;
    contentClassName?: string;
    // Optional: the front face passes a single block here. The back face uses `textBlocks`
    // instead and omits children (see textBlocks note below).
    children?: React.ReactNode;
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
    // Saved movable-text placement (migration 91). When present, the two back-face text
    // blocks render absolutely at their stored centers/scale/rotation instead of the default
    // lower-third flex column. Back-face only — the front face ignores it.
    textLayout?: TextLayout | null;
    // The back face supplies its two text blocks SEPARATELY (foreign + english) so each can be
    // positioned independently when textLayout is set. The front face uses `children` instead
    // (a single block). When `textBlocks` is given it owns text rendering and `children` is
    // ignored. While the edit canvas is mounted (advanced edit) the back-face text is
    // suppressed — the canvas renders it live instead.
    textBlocks?: { foreign: React.ReactNode; english: React.ReactNode };
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
    // Per-card background fill (vet.cardColor, migration 94). Painted only when this face is
    // rendering the advanced layout (`isUsingAdvancedLayout`); otherwise the theme default is
    // used. When it applies it overrides the theme's default face color; null/undefined =
    // follow the theme. Only a vetted palette hex reaches here (resolveCardColor). See
    // docs/CARD_ICON_LAYOUT.md.
    cardColor?: string | null;
}> = ({ rotated, isUsingAdvancedLayout, contentGap, contentClassName, children, iconId, showIcon, iconLayout, textLayout, textBlocks, editCanvas, inert, cornerBadge, cardColor }) => {
    const theme = useTheme();
    const fc = theme.palette.flashcard;
    // Per-card background fill is a decoration that belongs to the ADVANCED layout: it paints
    // its custom color exactly when this face is rendering that advanced layout
    // (`isUsingAdvancedLayout`, decided per face by the caller). A basic card, and any face the
    // caller has gated off (the flp Chinese front), ignores cardColor and follows the theme.
    // Resolve to a concrete hex, or undefined to keep the theme default.
    const faceBg = (isUsingAdvancedLayout ? resolveCardColor(cardColor) : undefined) ?? fc.flashCard;
    const hasCustom = showIcon && !!iconLayout && iconLayout.length > 0;
    const editing = !!editCanvas;
    // The back face renders its two text blocks one of two ways:
    //  - editing (advanced canvas mounted): suppress — the canvas renders the live text.
    //  - otherwise: position each block ABSOLUTELY at its center/scale/rotation. This is used
    //    for BOTH a custom textLayout and the DEFAULT (resolveTextLayout fills absent/null with
    //    the grid-aligned DEFAULT_TEXT_CENTER), so the default display sits exactly on the
    //    snap grid and matches the fie 1:1. See docs/CARD_ICON_LAYOUT.md "Movable text".
    const resolvedText = resolveTextLayout(textLayout);
    return (
        // OUTER face box — carries the 3D flip transform, backface culling, and the
        // away-face visibility/inert logic, but is OVERFLOW:VISIBLE. This lets the edit
        // canvas's selection overlay (outline + resize handle) overflow the card edge into
        // the surrounding padding (see docs/CARD_ICON_LAYOUT.md). The card-boundary clipping
        // is done by the INNER box below, not here.
        <Box sx={{
            position: "absolute",
            top: 0, left: 0, width: "100%", height: "100%",
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
            ...(rotated && { transform: "rotateY(180deg)" }),
            backgroundColor: faceBg,
            borderRadius: "12px",
            // NOT clipped here — see the inner clip box. The edit canvas (a child of this
            // outer box) needs overflow:visible so its selection indicators can poke past
            // the card edge into the surrounding padding.
            overflow: "visible",
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
            transition: `visibility 0s ${inert ? CARD_FLIP_MS / 2 : 0}ms`,
            ...(inert && { pointerEvents: "none" }),
        }}>
            {/* Edit canvas lives in the OUTER (overflow:visible) box so its selection
                overlay can escape the card boundary. The canvas clips its OWN icons to the
                card internally, so partially-off-card icons are still cut off. */}
            {editing && editCanvas}
            {/* INNER clip box — clips the static icon layer + content to the card boundary
                (icons partially off the card are cut off and never paint outside it). Carries
                the rounded corners and the centered-content flex layout that used to live on
                the face box.
                While editing it MUST be `pointerEvents: none`: it is a sibling painted ABOVE
                the edit canvas (the canvas is zIndex 0, this box is later in DOM order), so as
                an opaque-to-hit-testing wrapper it would otherwise intercept every press over
                the card — blocking icon select/drag AND the overlay's resize handle. Making it
                inert while editing lets presses fall through to the canvas below. (Its
                CardContent is already inert via the editing gate; nothing inside needs pointer
                events during an edit.) */}
            <Box sx={{
                position: "absolute",
                inset: 0,
                overflow: "hidden",
                borderRadius: "12px",
                display: "flex",
                alignItems: "center",
                justifyContent: CARD_FACE_JUSTIFY,
                ...(editing && { pointerEvents: "none" }),
            }}>
                {cornerBadge}
                {/* Icon layer sits BEHIND the content (cpcd / English / buttons) so the
                    card info always reads on top — for a saved arrangement. (While editing the
                    live canvas in the outer box replaces this static layer; the content below
                    is made non-interactive so pointer events fall through to the canvas even
                    where they overlap the text.) */}
                {!editing && hasCustom && <CardIconLayer layout={iconLayout!} />}
                {/* Default single icon — rendered through the SAME CardIconLayer geometry as
                    the editor's seeded basic icon (defaultLayoutForIcon: centered upper-third,
                    default scale), so its on-screen size is identical whether or not the editor
                    is open. When the entry has no icon at all, render nothing (no placeholder box).
                    zIndex 0 keeps it behind the text. */}
                {showIcon && !hasCustom && !editing && iconId && (
                    <CardIconLayer layout={defaultLayoutForIcon(iconId)} />
                )}
                {textBlocks ? (
                    // Back face — MOVABLE TEXT. Rendered in a FULL-CARD layer (inset:0, no
                    // padding) so the two blocks share the EXACT coordinate system the fie canvas
                    // uses (CardIconCanvas's text layer is also full-card inset:0), making the
                    // default (and any saved) placement identical on the card and in the editor.
                    // Nesting it inside the padded CardContent — as it used to be — made `x`/`y`
                    // percentages resolve against the PADDED content box, so the same normalized
                    // center landed in a different spot on the card than in the fie. While the
                    // advanced canvas is mounted the text is owned by the canvas (suppress here).
                    // See docs/CARD_ICON_LAYOUT.md "Movable text".
                    editing ? null : (
                        <Box
                            className="mobile-demo-flashcard-text-layer"
                            sx={{ position: "absolute", inset: 0, zIndex: 1 }}
                        >
                            {([
                                ["foreign", textBlocks.foreign] as const,
                                ["english", textBlocks.english] as const,
                            ]).map(([block, node]) => {
                                const it = resolvedText[block];
                                // Basic (unsaved) English only: anchor by top edge so a
                                // multi-line definition grows downward, not up into the Chinese
                                // word above it. A saved/custom position (set via the advanced
                                // fie editor) keeps the normal center anchor — see
                                // defaultEnglishTopAnchorTransform's doc comment.
                                const isDefaultEnglish = block === "english" && !textLayout?.english;
                                return (
                                    <Box
                                        key={block}
                                        className={`mobile-demo-flashcard-text-block mobile-demo-flashcard-text-block--${block}`}
                                        sx={{
                                            position: "absolute",
                                            left: `${it.x * 100}%`,
                                            top: `${it.y * 100}%`,
                                            // Hug the content (inner blocks are width:100%),
                                            // centered + scaled + rotated about the center.
                                            width: "max-content",
                                            maxWidth: "92%",
                                            transform: isDefaultEnglish ? defaultEnglishTopAnchorTransform(it) : textItemTransform(it),
                                            transformOrigin: "center center",
                                            // english paints above foreign if they overlap.
                                            zIndex: block === "english" ? 2 : 1,
                                        }}
                                    >
                                        {node}
                                    </Box>
                                );
                            })}
                        </Box>
                    )
                ) : (
                    // Front face — a single block (children) in a PADDED, centered column.
                    <CardContent
                        className={rotated ? undefined : "mobile-demo-flashcard-content"}
                        sx={{
                            width: "100%",
                            height: "100%",
                            padding: "clamp(16px, 7%, 72px) 30px",
                            boxSizing: "border-box",
                            // Content sits above the icon layer.
                            position: "relative",
                            zIndex: 1,
                        }}
                    >
                        <Box
                            className={rotated ? undefined : "mobile-demo-flashcard-inner"}
                            sx={{ position: "relative", height: "100%", width: "100%", minHeight: 0 }}
                        >
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
                )}
            </Box>
        </Box>
    );
};
