import React from "react";
import { Box, CardContent, Typography, useTheme } from "@mui/material";
import { sortedSenseClusters, resolveDisplayDefinition, resolveDisplayPronunciation } from "../../../utils/definitionUtils";
import {
    CARD_FACE_JUSTIFY,
    CARD_FLIP_MS,
    FC_FONT_CJK,
} from "../constants";
import { WEIGHT } from "../../../theme/scale";
import { COLORS } from "../../../theme/colors";
import { CARD_SURFACE, CARD_SURFACE_CLIP_RADIUS } from "../../../theme/surfaces";
import type { VocabEntry } from "../types";
import type { IconLayoutItem, TextLayout } from "../../../types";
import CardIconLayer from "../../../cardIcons/CardIconLayer";
import { defaultLayoutForIcon } from "../../../cardIcons/cardIconLayout";
import { resolveTextLayout, textBlockMaxWidth, textItemTransform, defaultEnglishTopAnchorTransform } from "../../../cardIcons/cardTextLayout";
import ForeignText from "../../../components/ForeignText";
import SensePicker from "./SensePicker";
import { useShrinkWrapWrappedText } from "./useShrinkWrapWrappedText";
import { useSenseChipPlacement } from "./useSenseChipPlacement";
import { SpeakerButton } from "../../../components/SpeakerButton";
import { resolveTextColor, DD_TONES } from "../../../utils/cardTextColor";
import { resolveCardColor } from "../../../utils/cardColor";

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
    // When true the speaker action is laid out IN-FLOW (a column to the right of
    // the text) instead of absolutely positioned off the text's right edge. In-flow makes the
    // actions part of the block's measured box, so the fie selection outline + on-card clamp
    // include them, and keeps them inside the width the card gives the block, so a long word
    // can't push them across the Deck Tower stock's clip at the panel edge. Both flp faces
    // use it; false remains for surfaces that hang the actions outside the box.
    // See docs/CARD_ICON_LAYOUT.md.
    inlineActions?: boolean;
    // Which sense the card is currently on (index into `sortedSenseClusters`). The
    // pinyin over the characters is per-SENSE for a heteronym (过去 guò qù / guò qu),
    // so this block must resolve its pronunciation from the same pick EnglishBlock
    // resolves its gloss from — see resolveDisplayPronunciation. Omit to fall back to
    // the entry's persisted `selectedSense`.
    selectedSenseIndex?: number;
}> = ({ entry, showPinyin, showPinyinColor, onSpeak, speakingKey, inlineActions = false, selectedSenseIndex }) => {
    // Per-card Contrast override for the foreign-word GLYPHS only (pinyin is untouched).
    // Undefined = theme default. See docs/CARD_ICON_LAYOUT.md.
    const characterColor = resolveTextColor(entry.textColors?.foreign);
    // The audio button. Practice Writing used to sit above it here (an on-card relic);
    // that entry point now lives ONLY on `WordToolsRail` above the card — see
    // docs/PRACTICE_WRITING.md ("Entry points"). Absent when no onSpeak is passed.
    // Rendered the same whether absolute or in-flow — only the wrapper differs.
    const actions = onSpeak ? (
        <Box
            className="mobile-demo-flashcard-actions"
            sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.25 }}
        >
            <SpeakerButton
                onClick={() => onSpeak(entry)}
                isLoading={speakingKey === entry.entryKey}
            />
        </Box>
    ) : null;
    // Long words wrap at the width the card gives this block (flexWrap) rather than
    // running under the panel clip. See docs/CARD_ICON_LAYOUT.md "Movable text".
    const foreignRow = (
        <ForeignText
            size="md"
            justifyContent="center"
            flexWrap="wrap"
            className="mobile-demo-flashcard-cpcd-row"
            text={entry.entryKey}
            pronunciation={resolveDisplayPronunciation(entry, selectedSenseIndex)}
            showPinyin={showPinyin}
            useToneColor={showPinyinColor}
            characterColor={characterColor}
        />
    );
    return (
        // Outer row fills the width and centers the Chinese text within the card.
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }} className="mobile-demo-flashcard-chinese-block">
            {inlineActions ? (
                // A [spacer | text | action] grid. `auto` text grows to max-content; the action
                // column never drops below the speaker; the spacer may collapse to 0. So the
                // word stays centered while it fits, then borrows the left spacer, and only
                // wraps once that is spent. A fixed hidden twin would cost the word the
                // speaker's width twice and wrap four-character words.
                <Box
                    sx={{
                        position: 'relative',
                        display: 'grid',
                        gridTemplateColumns: 'minmax(0, 1fr) auto minmax(min-content, 1fr)',
                        alignItems: 'center',
                        width: '100%',
                    }}
                    className="mobile-demo-flashcard-chinese-inner"
                >
                    {actions && (
                        <Box
                            aria-hidden
                            className="mobile-demo-flashcard-chinese-actions-spacer"
                            sx={{ gridColumn: 1, visibility: 'hidden', minWidth: 0, overflow: 'hidden', display: 'flex', justifyContent: 'flex-end' }}
                        >
                            <Box sx={{ mr: 1, display: 'flex', flexShrink: 0 }}>{actions}</Box>
                        </Box>
                    )}
                    <Box className="mobile-demo-flashcard-chinese-row" sx={{ gridColumn: 2, minWidth: 0 }}>
                        {foreignRow}
                    </Box>
                    {actions && (
                        <Box className="mobile-demo-flashcard-chinese-actions" sx={{ gridColumn: 3, justifySelf: 'start', ml: 1, display: 'flex' }}>{actions}</Box>
                    )}
                </Box>
            ) : (
                // Shrinks to the row's width. The actions hang off its right edge without
                // affecting that width, so centering this wrapper centers the row.
                <Box
                    sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
                    className="mobile-demo-flashcard-chinese-inner"
                >
                    {foreignRow}
                    {actions && (
                        <Box sx={{ position: 'absolute', left: '100%', top: '50%', transform: 'translateY(-50%)', ml: 1 }}>
                            {actions}
                        </Box>
                    )}
                </Box>
            )}
        </Box>
    );
};

// Gap between the gloss and the sense chip beside it, px.
const SENSE_CHIP_GAP_PX = 10;

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
// small trigger beside or below the text, opening a menu of the word's other senses —
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
    // NOTE: EnglishBlock has no `inlineActions` prop (ChineseBlock still does). Its sense
    // trigger is ALWAYS out of flow, so the gloss centers and wraps as if it did not exist;
    // useSenseChipPlacement then places it beside or below the centered gloss.
    // See docs/CARD_ICON_LAYOUT.md "Movable text".
    // When true, the picker's zh reading headings are replaced by neutral "-pinyin N-"
    // labels. Used on the FRONT/question side, where the card shows only English and the
    // learner is supposed to produce the Chinese — a tone-colored pinyin heading in the
    // sense menu would hand them the pronunciation (and the tones) for free. The grouping
    // itself is still useful (it shows which senses share a reading), so only the label is
    // censored; the back/answer side and all non-quiz surfaces show the real pinyin.
    censorReadings?: boolean;
}> = ({ entry, selectedSenseIndex = 0, onSelectSense, censorReadings = false }) => {
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

    // Once the gloss wraps, its box would stay as wide as the block. Shrink-wrapping it to
    // its wrapped width lets the row hug the lines, so the chip sits beside the text rather
    // than beside the empty width. See useShrinkWrapWrappedText.
    const englishBlockRef = React.useRef<HTMLDivElement>(null);
    const englishTextRef = React.useRef<HTMLParagraphElement>(null);
    useShrinkWrapWrappedText(englishTextRef, englishBlockRef, text);

    // Runs after the shrink-wrap above, so it reads the gloss's final width.
    const englishRowRef = React.useRef<HTMLDivElement>(null);
    const senseChipRef = React.useRef<HTMLDivElement>(null);
    useSenseChipPlacement(englishTextRef, englishRowRef, senseChipRef, englishBlockRef, SENSE_CHIP_GAP_PX);

    // Shared by the gloss and the chip's wrapper, so the wrapper's line box matches the
    // gloss's first line (see the "right" placement below).
    const glossLineMetrics = {
        fontSize: englishFontSize(text),
        fontFamily: FC_FONT_CJK,
        lineHeight: 1.25,
    };

    return (
        // Outer row fills the width and centers the text row inside it.
        // Class name kept parallel to ChineseBlock's outer row.
        <Box ref={englishBlockRef} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }} className="mobile-demo-flashcard-english-block">
            {/* Hugs the gloss (`minWidth: 0` lets it shrink so long text wraps, and
                `overflowWrap` breaks a single word wider than the block). It is also the
                chip's positioning box. */}
            <Box ref={englishRowRef} className="mobile-demo-flashcard-english-row" sx={{ position: 'relative', minWidth: 0 }}>
                <Typography ref={englishTextRef} className="mobile-demo-flashcard-english-text" sx={{
                    ...glossLineMetrics,
                    margin: '0 auto',
                    fontWeight: WEIGHT.regular,
                    color: englishColor,
                    textAlign: 'center',
                    overflowWrap: 'break-word',
                }}>
                    {text}
                </Typography>
                {/* Out of flow in both placements: it must never move or narrow the gloss.
                    The `sortedClusters` gate stops an empty box being measured; SensePicker
                    hides itself by the same test. */}
                {sortedClusters && (
                    <Box
                        ref={senseChipRef}
                        className="mobile-demo-flashcard-english-actions"
                        data-placement="right"
                        sx={{
                            ...glossLineMetrics,
                            position: 'absolute',
                            // Beside the FIRST line, centered on its lowercase letters. This
                            // wrapper reproduces that line box, and `vertical-align: middle`
                            // is by definition the baseline + half the font's x-height, so no
                            // font metrics need measuring.
                            '&[data-placement="right"]': {
                                display: 'block',
                                whiteSpace: 'nowrap',
                                left: '100%',
                                top: 0,
                                ml: `${SENSE_CHIP_GAP_PX}px`,
                                '& > .mobile-demo-flashcard-sense-trigger': { verticalAlign: 'middle' },
                            },
                            '&[data-placement="below"]': {
                                display: 'flex',
                                top: '100%',
                                left: '50%',
                                transform: 'translateX(-50%)',
                                mt: '6px',
                            },
                        }}
                    >
                        <SensePicker
                            entry={entry}
                            selectedSenseIndex={selectedSenseIndex}
                            onSelectSense={onSelectSense}
                            color={englishColor}
                            censorReadings={censorReadings}
                        />
                    </Box>
                )}
            </Box>
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
    // A control anchored to the face's TOP EDGE, over everything else on it — the flp's
    // card-operations rail (`CardOpsRail`, artboard 21).
    //
    // It is interactive, has to paint over the icon layer and the text blocks, and
    // positions itself against the face's own edge — so it renders in the OUTER face
    // box, after the content, at the top of the stacking order. Absent everywhere but
    // the flp. (It used to be contrasted here with a passive `cornerBadge` slot, whose
    // only user was the progress-category chip; both were removed on 2026-08-28 when
    // the mastery category came off the card back.)
    topRail?: React.ReactNode;
    // A strip anchored to the face's TOP EDGE, left of the `•••` — the learner's own note
    // on this card (`CardNote`, vet.note, migration 155). It shares the top edge with
    // `topRail`'s dot rather than the bottom edge, because the face's own content grows
    // downward (see CardNote). Like `topRail` it renders in the OUTER face
    // box so it paints over the icon layer and the text blocks, and like `topRail` it is
    // passed as a node so this shared face stays ignorant of what a note is (and of who is
    // allowed to edit one). Answer face only — see CardNote's doc comment. Renders nothing
    // when the card has no note and no edit is open. See docs/CARD_NOTES.md.
    noteSlot?: React.ReactNode;
    // Per-card background fill (vet.cardColor, migration 94). Painted only when this face is
    // rendering the advanced layout (`isUsingAdvancedLayout`); otherwise the theme default is
    // used. When it applies it overrides the theme's default face color; null/undefined =
    // follow the theme. Only a vetted palette hex reaches here (resolveCardColor). See
    // docs/CARD_ICON_LAYOUT.md.
    cardColor?: string | null;
    // Blank the face's CONTENT while keeping its SURFACE (background fill + rounded corners).
    // Used by the flp's card stack: the 3D flip takes the front card edge-on at the halfway
    // point, and for those frames the peeking back card is fully exposed — so its content is
    // hidden for the duration of the flip while the card itself keeps holding the stack's
    // shape. Applied to the face's direct children (icon layer, text, rail, note) rather than
    // to this box, so the fill survives.
    contentHidden?: boolean;
    // A FULL-CARD content layer (inset: 0, no padding) that replaces both `children` and
    // `textBlocks`. For faces whose content is a whole layout of its own rather than a
    // word block — the writing flp's prompt + character grid + Submit
    // (WritingCardFace, docs/WRITING_PRACTICE_REWORK.md § 3). The face's surface, edge,
    // flip culling and `contentHidden` behave exactly as for any other face.
    fill?: React.ReactNode;
    // The flip's duration (ms) the away-face hide is timed against — the Deck Tower's
    // slower flip passes TOWER_CARD_FLIP_MS.
    flipMs?: number;
    // The Deck Tower's CARD STOCK (the tower-hosted flp, FlashCard `towerStock`): the face is
    // the tower's IsoCard — a cream rim (`COLORS.cardFace`) around a beige printed panel
    // (`COLORS.cardBeige`), no hairline. A custom `cardColor` fills the PANEL (the rim stays
    // cream), and everything printed on the face is clipped to the panel (`--card-panel-clip`,
    // read by the inner clip box and the fie canvas's icon layer) and wraps at its width
    // (`--card-panel-width`, read by `textBlockMaxWidth`). The rim's width and the panel's corner come from the card frame's
    // `--card-stock-inset` / `--card-panel-radius` (FlashCardSection `TOWER_STOCK_VARS`).
    // Fixed tokens, not the theme's `flashCard`: the tower is one lit scene in every theme,
    // and its time-of-day wash is applied over the study layer by the page.
    // See docs/TOWER_STYLE_SHIFT.md § "Card stock".
    towerStock?: boolean;
}> = ({ rotated, isUsingAdvancedLayout, contentGap, contentClassName, children, iconId, showIcon, iconLayout, textLayout, textBlocks, editCanvas, inert, topRail, noteSlot, cardColor, contentHidden, fill, flipMs = CARD_FLIP_MS, towerStock = false }) => {
    const theme = useTheme();
    const fc = theme.palette.flashcard;
    // Per-card background fill is a decoration that belongs to the ADVANCED layout: it paints
    // its custom color exactly when this face is rendering that advanced layout
    // (`isUsingAdvancedLayout`, decided per face by the caller). A basic card, and any face the
    // caller has gated off (the flp Chinese front), ignores cardColor and follows the theme.
    // Resolve to a concrete hex, or undefined to keep the theme default.
    const customBg = isUsingAdvancedLayout ? resolveCardColor(cardColor) : undefined;
    // Tower stock: the face itself is the cream rim and the colour (custom or beige) moves
    // onto the inset panel. Otherwise the whole face takes it.
    const faceBg = towerStock ? COLORS.cardFace : customBg ?? fc.flashCard;
    const panelBg = customBg ?? COLORS.cardBeige;
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
        <Box className="card-face" sx={{
            position: "absolute",
            top: 0, left: 0, width: "100%", height: "100%",
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
            ...(rotated && { transform: "rotateY(180deg)" }),
            backgroundColor: faceBg,
            // The card's EDGE. Border + radius come from `CARD_SURFACE` (theme/surfaces.ts)
            // so a flashcard face, the cdp hero card and the Decks page's Mastery Center
            // tiles are one object family; the elevation half of that recipe is NOT taken
            // here, because the face is inset inside a wrapper that already casts the
            // shadow (FlashCardSection's Card, the cdp's `*__hero-card` box) — applying it
            // on both would double it. `border-box` so the hairline eats into the face
            // rather than pushing it past the wrapper's 100% width.
            // Tower stock has no hairline: the tower's own cards are unoutlined, and this
            // face lies exactly over one (a documented exception to the outline rule —
            // docs/TOWER_STYLE_SHIFT.md).
            border: towerStock ? "none" : CARD_SURFACE.border,
            borderRadius: CARD_SURFACE.borderRadius,
            boxSizing: "border-box",
            // On tower stock the card's content stops at the panel's edge, not the card's.
            ...(towerStock && {
                "--card-panel-clip": "inset(var(--card-stock-inset) round var(--card-panel-radius))",
                "--card-panel-width": "calc(100% - 2 * var(--card-stock-inset))",
            }),
            // NOT clipped here — see the inner clip box. The edit canvas (a child of this
            // outer box) needs overflow:visible so its selection indicators can poke past
            // the card edge into the surrounding padding.
            overflow: "visible",
            // Explicit visual hiding of the away-facing face. `backfaceVisibility:hidden`
            // alone is unreliable on some mobile WebKit/Blink builds (PPE bug: the
            // rotated-away Side 1 bled through the back, mirrored by the parent's
            // rotateY(180deg)), so we don't trust it for the visual. `inert` already
            // tracks "this face is facing away"; when so, force visibility:hidden but
            // DELAY it to exactly the mid-flip point — which, because the flip curve is
            // LINEAR (cardFlipTransition), is precisely 90° / edge-on, so the face
            // vanishes at zero projected width with no mirror flash. The incoming face
            // is revealed immediately (no delay) on the way in.
            visibility: inert ? "hidden" : "visible",
            transition: `visibility 0s ${inert ? flipMs / 2 : 0}ms`,
            ...(inert && { pointerEvents: "none" }),
            // See `contentHidden`: hide everything painted ON the face, keep the face itself.
            // The tower stock's panel is SURFACE, not content, so it stays.
            ...(contentHidden && { "& > *:not(.card-face__stock-panel)": { visibility: "hidden" } }),
        }}>
            {/* Tower stock's printed panel — FIRST, so the edit canvas, icons and text all
                paint over it. Decorative: the face's content keeps the full-card layout. */}
            {towerStock && (
                <Box
                    className="card-face__stock-panel"
                    sx={{
                        position: "absolute",
                        inset: "var(--card-stock-inset)",
                        borderRadius: "var(--card-panel-radius)",
                        backgroundColor: panelBg,
                        pointerEvents: "none",
                    }}
                />
            )}
            {/* The area content may occupy, as a measurable box: the printed panel on tower
                stock, the whole face elsewhere. Read by useSenseChipPlacement, because
                `--card-stock-inset` is a container-unit calc() script can't read as a number. */}
            <Box
                aria-hidden
                className="card-face__panel-bounds"
                sx={{ position: "absolute", inset: "var(--card-stock-inset, 0px)", visibility: "hidden", pointerEvents: "none" }}
            />
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
                // Clips content to the SAME curve the face draws, minus the hairline it
                // sits inside — one less pixel of radius, or the icon layer shows a sliver
                // of square corner outside the border.
                borderRadius: CARD_SURFACE_CLIP_RADIUS,
                // Tower stock narrows the clip to the printed panel, so no icon, gloss or
                // sense chip can paint on the cream rim. Unset elsewhere → `none`.
                clipPath: "var(--card-panel-clip, none)",
                display: "flex",
                alignItems: "center",
                justifyContent: CARD_FACE_JUSTIFY,
                ...(editing && { pointerEvents: "none" }),
            }}>
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
                {fill !== undefined ? (
                    <Box className="card-face__fill" sx={{ position: "absolute", inset: 0, zIndex: 1 }}>
                        {fill}
                    </Box>
                ) : textBlocks ? (
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
                                            maxWidth: textBlockMaxWidth(it.scale),
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
                            // Sideways the content reaches the tower stock's panel edge, so
                            // the front wraps where the back does; the plain card keeps 30px.
                            padding: "clamp(16px, 7%, 72px) var(--card-stock-inset, 30px)",
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
            {/* Top-edge control rail, LAST in the outer box so it paints over the inner
                clip box (the icon layer + text) without needing a z-index war. It sits in
                the OUTER box, not the inner one, so `overflow: visible` lets an open rail
                extend to the card's own corner radius rather than being clipped by it. */}
            {topRail}
            {/* Top-edge note strip, sharing the edge with the rail's `•••` (it stops short
                of it). In the OUTER box for the same reasons the rail is: it must paint over
                the inner clip box (icon layer + text blocks), and while it is being edited its
                own controls sit at the card's very edge. Rendered AFTER the rail so an open
                note editor stacks above an open rail — which is also why the editor may run
                under an EXPANDED rail's row: opening the note editor closes the rail. */}
            {noteSlot}
        </Box>
    );
};
