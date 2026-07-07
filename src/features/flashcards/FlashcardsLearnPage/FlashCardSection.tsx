import React from "react";
import { Box, Card, CardContent, IconButton, ListItemIcon, ListItemText, ListSubheader, Menu, MenuItem, Typography, useTheme } from "@mui/material";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import StarIcon from "@mui/icons-material/Star";
import { ddt, stripParentheses, sortedSenseClusters, resolveSelectedSenseIndex } from "../../../utils/definitionUtils";
import { numberedToTonedPinyin } from "../../../utils/textUtils";
import { getToneColor } from "../../../utils/toneColors";
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
import { SIZE, WEIGHT, LEADING, TRACKING } from "../../../theme/scale";
import type { VocabEntry, SideOneLanguage } from "./types";
import type { IconLayoutItem, TextLayout } from "../../../types";
import CardIconLayer from "../../../cardIcons/CardIconLayer";
import { defaultLayoutForIcon, isAdvancedLayout } from "../../../cardIcons/cardIconLayout";
import { resolveTextLayout, textItemTransform, defaultEnglishTopAnchorTransform } from "../../../cardIcons/cardTextLayout";
import ForeignText from "../../../components/ForeignText";
import { SpeakerButton } from "../../../components/SpeakerButton";
import PracticeWritingButton from "../../../components/handwriting/PracticeWritingButton";
import { getCategoryColor } from "../../../utils/categoryColors";
import { resolveTextColor } from "../../../utils/cardTextColor";
import { resolveCardColor } from "../../../utils/cardColor";

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
    // Persist a card's definition-cluster sense pick per account (migration 99). Threaded to
    // each CardFace; the page supplies the PATCH-backed handler. See docs/DEFINITION_CLUSTERS.md.
    onPersistSense?: (entry: VocabEntry, sense: string | null) => void;
    // True while the icon-layout editor is open. Locks the card: drag/flip handlers
    // are not attached so the card can't be swiped away or flipped mid-edit.
    editMode?: boolean;
    // True when the card should be pushed down (and lifted over the More Info pill): advanced
    // edit mode AND the toolbar would actually overlap the card. Computed by the page via
    // useToolbarOverlap so a roomy viewport (toolbar clears the card) leaves it centered.
    pushDown?: boolean;
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
    // When true the speaker/writing actions are laid out IN-FLOW (a column to the right of
    // the text) instead of absolutely positioned off the text's right edge. In-flow makes the
    // actions part of the block's measured box, so the fie selection outline + on-card clamp
    // include them (the movable-text case). Default (false) keeps the actions absolute so they
    // don't shift the centered text in the normal lower-third layout. See docs/CARD_ICON_LAYOUT.md.
    inlineActions?: boolean;
}> = ({ entry, showPinyin, showPinyinColor, onSpeak, speakingKey, showWriting = false, inlineActions = false }) => {
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
                    pronunciation={entry.pronunciation}
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
// see docs/DEFINITION_CLUSTERS.md), a small triangle trigger appears beside the text,
// opening a menu of the word's other senses (one item per cluster, via the ddt display
// transformation). Undiscoverable/unclustered entries (definitionClusters null or a
// single cluster) render exactly as before — no trigger, no picker.
export const EnglishBlock: React.FC<{
    entry: VocabEntry;
    // Index into the vernacular-sorted cluster list currently shown. Owned by CardFace
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
}> = ({ entry, selectedSenseIndex = 0, onSelectSense, inlineActions = false }) => {
    const theme = useTheme();
    // Per-card Contrast override for the English definition; theme default otherwise.
    const englishColor = resolveTextColor(entry.textColors?.english) ?? theme.palette.flashcard.onSurface;

    // A picker only makes sense with a real choice — a single-cluster (or unclustered)
    // entry falls back to the plain definitions[0] dd, unchanged from before this feature.
    // Sorted highest vernacular register first (nulls last) so index 0 is always the
    // starred/default sense.
    const sortedClusters = React.useMemo(() => sortedSenseClusters(entry), [entry]);

    // The picker groups the vernacular-sorted clusters into reading sections so the
    // menu reads as "these senses share this pinyin". Grouping preserves the sort:
    // readings appear in the order their first (highest-vernacular) cluster does, and
    // clusters stay vernacular-ordered within a section — so the starred default (the
    // global index 0) always heads the first section. Each entry keeps its original
    // index into `sortedClusters` so `selectedSenseIndex` addressing is unchanged.
    const senseSections = React.useMemo(() => {
        if (!sortedClusters) return null;
        const sections: { reading: string; items: { cluster: typeof sortedClusters[number]; index: number }[] }[] = [];
        sortedClusters.forEach((cluster, index) => {
            const reading = cluster.reading ?? '';
            let section = sections.find((s) => s.reading === reading);
            if (!section) {
                section = { reading, items: [] };
                sections.push(section);
            }
            section.items.push({ cluster, index });
        });
        return sections;
    }, [sortedClusters]);

    const text = sortedClusters
        ? ddt(sortedClusters[selectedSenseIndex] ?? sortedClusters[0])
        : stripParentheses(entry.definition ?? '');

    const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
    // Mirrors SpeakerButton: the trigger sits inside the draggable/flippable card, so
    // press events must not bubble to the card's own touch/mouse handlers.
    const stopCardHandlers = (e: React.SyntheticEvent) => e.stopPropagation();

    // The sense-picker trigger, structured exactly like ChineseBlock's `actions`
    // (writing + speaker buttons): a small column Box, so the two blocks stay
    // visually/structurally consistent even though English currently has only
    // one action.
    const actions = sortedClusters ? (
        <Box
            className="mobile-demo-flashcard-actions"
            sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.25 }}
        >
            <IconButton
                className="mobile-demo-flashcard-sense-trigger"
                size="small"
                aria-label="Switch definition"
                onClick={(e) => { stopCardHandlers(e); setAnchorEl(e.currentTarget); }}
                onMouseDown={stopCardHandlers}
                onTouchStart={stopCardHandlers}
                onTouchEnd={stopCardHandlers}
                sx={{ color: englishColor }}
            >
                <ArrowDropDownIcon fontSize="small" />
            </IconButton>
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
                {senseSections && (
                    <Menu
                        className="mobile-demo-flashcard-sense-menu"
                        anchorEl={anchorEl}
                        open={Boolean(anchorEl)}
                        onClose={() => setAnchorEl(null)}
                        MenuListProps={{ sx: { py: 0.5 } }}
                        // Backdrop/paper taps also bubble through the portal to the card's
                        // flip handlers — swallow them at the Menu root too.
                        onClick={stopCardHandlers}
                        onMouseDown={stopCardHandlers}
                        onTouchStart={stopCardHandlers}
                        onTouchEnd={stopCardHandlers}
                    >
                        {/* One pinyin-labelled section per distinct reading; MUI's Menu flattens
                            this array of fragments, so ListSubheader + MenuItems render inline. */}
                        {senseSections.map((section) => [
                            <ListSubheader
                                key={`heading-${section.reading}`}
                                className="mobile-demo-flashcard-sense-reading"
                                disableSticky
                                sx={{
                                    lineHeight: 1.6,
                                    fontWeight: WEIGHT.semibold,
                                    bgcolor: 'transparent',
                                }}
                            >
                                {/* Per-syllable tone coloring, matching cpcd/pinyin elsewhere. An
                                    empty reading (should not happen for a clustered zh entry) falls
                                    back to a neutral em dash. */}
                                {section.reading
                                    ? numberedToTonedPinyin(section.reading).split(/\s+/).filter(Boolean).map((syllable, si) => (
                                        <React.Fragment key={si}>
                                            {si > 0 && ' '}
                                            <span style={{ color: getToneColor(syllable) }}>{syllable}</span>
                                        </React.Fragment>
                                    ))
                                    : <span style={{ color: theme.palette.text.secondary }}>—</span>}
                            </ListSubheader>,
                            ...section.items.map(({ cluster, index }) => (
                                <MenuItem
                                    key={`${cluster.reading}-${index}`}
                                    selected={index === selectedSenseIndex}
                                    // The Menu renders in a portal, but React synthetic events bubble
                                    // through the React tree — so a tap here would otherwise reach the
                                    // card's flip handlers. Stop every press event, same as the trigger.
                                    onClick={(e) => { stopCardHandlers(e); onSelectSense?.(index); setAnchorEl(null); }}
                                    onMouseDown={stopCardHandlers}
                                    onTouchStart={stopCardHandlers}
                                    onTouchEnd={stopCardHandlers}
                                >
                                    {index === 0 && (
                                        <ListItemIcon sx={{ minWidth: 28 }}>
                                            <StarIcon fontSize="small" sx={{ color: theme.palette.warning.main }} />
                                        </ListItemIcon>
                                    )}
                                    <ListItemText inset={index !== 0} primary={ddt(cluster)} />
                                </MenuItem>
                            )),
                        ])}
                    </Menu>
                )}
            </Box>
        </Box>
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
            transition: `visibility 0s ${inert ? CARD_FLY_OUT_MS / 2 : 0}ms`,
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
    // Persist the learner's sense pick for THIS card (migration 99). Given the chosen
    // cluster's `sense` label (or null for the default/starred sense). Absent when there's no
    // user context to save into (e.g. the read-only dictionary cdp uses local-only state).
    onPersistSense?: (entry: VocabEntry, sense: string | null) => void;
}> = ({ entry, isFlipped, isAnimating, showPinyin, showPinyinColor, showProgressCategory, sideOneLanguage, dragPosition, dismissThreshold, isProminent, onSpeak, speakingKey, editCanvas, onPersistSense }) => {
    const theme = useTheme();
    const fc = theme.palette.flashcard;

    // Which definitionClusters sense EnglishBlock currently displays (index into its
    // vernacular-sorted list). Lives here — not inside EnglishBlock — so Side 1 (English
    // mode) and Side 2 stay in sync on the same pick. On a card change it re-seeds from the
    // entry's PERSISTED choice (`selectedSense` label → sorted index, migration 99), falling
    // back to the top/starred sense when there's no saved pick.
    const [selectedSenseIndex, setSelectedSenseIndex] = React.useState(() => resolveSelectedSenseIndex(entry));
    React.useEffect(() => { setSelectedSenseIndex(resolveSelectedSenseIndex(entry)); }, [entry.id]); // eslint-disable-line react-hooks/exhaustive-deps

    // A pick updates the in-sync display index immediately (both faces) AND persists the
    // chosen cluster's `sense` LABEL. Index 0 is the default/starred sense, stored as null so
    // an unchosen/default card keeps a clean NULL row (matching the migration's semantics).
    const handleSelectSense = React.useCallback((index: number) => {
        setSelectedSenseIndex(index);
        if (!onPersistSense) return;
        const sorted = sortedSenseClusters(entry);
        const label = index === 0 ? null : sorted?.[index]?.sense ?? null;
        onPersistSense(entry, label);
    }, [entry, onPersistSense]);

    // Whether this entry is saved (in this account) with an ADVANCED layout — a multi-icon /
    // moved-icon arrangement OR a custom text placement. Gates the advanced-only per-card
    // background fill. The BACK/answer side always renders the advanced layout, so it gets this
    // verdict directly. The FRONT/question side only renders it when Side 1 is English; the
    // Chinese question side is deliberately kept a plain basic card, so it is additionally
    // gated by `sideOneLanguage === 'en'` (this is the flp's "stop the Chinese front" gate,
    // matching the icon layer, which is likewise gated to English-bearing faces via showIcon).
    const isUsingAdvancedLayout = isAdvancedLayout(entry.iconLayout, entry.textLayout);

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
                // Front/question side renders the advanced layout (and its background fill) ONLY
                // when it is the English side; the Chinese question side stays a plain basic card.
                isUsingAdvancedLayout={isUsingAdvancedLayout && sideOneLanguage === 'en'}
                cardColor={entry.cardColor}
                // CSS 3D backface culling does NOT reliably exclude the rotated-away
                // face from hit-testing, so the away face must be made inert or it
                // intercepts taps meant for the visible face (e.g. the writing/audio
                // buttons on the back). Side 1 faces away whenever the card is flipped.
                inert={isFlipped}
            >
                {sideOneLanguage === 'zh'
                    ? <ChineseBlock entry={entry} showPinyin={showPinyin} showPinyinColor={showPinyinColor} onSpeak={onSpeak} speakingKey={speakingKey} showWriting={false} />
                    : <EnglishBlock entry={entry} selectedSenseIndex={selectedSenseIndex} onSelectSense={handleSelectSense} />}
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
                // the canvas renders these instead. The foreign block's action buttons render
                // IN-FLOW (inlineActions) so they're part of the block's box, matching the fie
                // canvas (whose selection/clamp include them) 1:1.
                textBlocks={{
                    foreign: (
                        <ChineseBlock
                            entry={entry}
                            showPinyin={showPinyin}
                            showPinyinColor={showPinyinColor}
                            onSpeak={onSpeak}
                            speakingKey={speakingKey}
                            showWriting
                            inlineActions
                        />
                    ),
                    english: <EnglishBlock entry={entry} selectedSenseIndex={selectedSenseIndex} onSelectSense={handleSelectSense} inlineActions />,
                }}
                editCanvas={editCanvas}
                // Side 2 faces away when the card is showing its front.
                inert={!isFlipped}
                cornerBadge={showProgressCategory ? <CategoryChip category={entry.category} /> : undefined}
            />

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
    onPersistSense,
    editMode,
    pushDown,
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
                // When pushed down the card slides over the greyed More Info pill (zIndex 2).
                // Lift the whole slot above it so the card paints over the pill (kept below the
                // edit toolbar's zIndex 20). Only when pushed — a centered card doesn't reach
                // the pill, so it must not steal the pill's stacking. Otherwise pill floats on top.
                ...(pushDown ? { zIndex: 3 } : {}),
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
            <DraggableCardContainer className="mobile-demo-draggable-container" pushDown={pushDown}>
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
                                                // Only the active front card is interactive, so only it persists picks.
                                                onPersistSense={isFront ? onPersistSense : undefined}
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
