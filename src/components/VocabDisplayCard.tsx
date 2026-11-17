import React, { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { resolveDisplayPronunciation } from '../utils/definitionUtils';
import { Box } from '@mui/material';
import type { DictionaryEntry } from '../types';
import ForeignText from './ForeignText';
import { VERTICAL_PADDING } from './cpcdLayout';
import SenseList from './SenseList';
import { SpeakerButton, SPEAKER_BUTTON_SIZE } from './SpeakerButton';
import { useFlashcardLearnSettings } from '../hooks/useFlashcardLearnSettings';
import { COLORS } from '../theme/colors';
import { CARD_SURFACE_RADIUS } from '../theme/surfaces';
import { roundedEdgeFilletDown, roundedEdgeRimLightTop } from '../theme/roundedEdge';

interface VocabDisplayCardProps {
    dictionaryEntry: DictionaryEntry | null;
    // Set → the card is in the Reader's NOTHING-SELECTED MODE and shows this node
    // (the page's ReaderTapHint demo) filling the whole face, instead of an entry (or the
    // empty face). Null/absent → normal display.
    idleHint?: ReactNode;
    // What the face shows when a word is highlighted but has no entry (the Reader: a small
    // pawn, ReaderKeycapPawn), centred in the whole face. Absent → the face is left blank.
    // Memoise it: the memo below compares it by identity.
    emptyFace?: ReactNode;
    // The speaker just right of the headword. Absent → no speaker.
    onSpeak?: () => void;
    // Ring the speaker while this word's audio loads / plays.
    isSpeaking?: boolean;
    // The controls at the header's right edge (the Reader: More Info + the Add key),
    // built by the page (feature controls; this file renders only). Called with
    // `stacked`: false → laid side by side, true → stacked under a long headword, where
    // the page should draw smaller versions. See ACTION LAYOUT below.
    renderHeaderActions?: (stacked: boolean) => ReactNode;
}

// Fixed so the reading box below does not jump as the highlighted word changes; a long
// sense list scrolls inside the face instead.
const FIXED_CARD_HEIGHT = 210;

// The keycap's straight drop lip, px — the Dictionary's keycaps' depth
// (DictionaryPageParts.tsx → KEYCAP_LIP) and the Lessons plate's, so raised objects stand
// equally tall across pages.
const KEYCAP_LIP = 4;

// The keycap's colours: the Tier 2 DAY keycap's (src/timeOfDay/tier2Look.ts → day
// surfaces) — a white face, `COLORS.grey` lip, `COLORS.border` outline. Fixed, not the
// time-of-day look: the Reader is on the paper ground, not a Tier 2 page.
const KEYCAP_FACE = COLORS.white;
const KEYCAP_EDGE = COLORS.grey;
const KEYCAP_OUTLINE = COLORS.border;

// The headword's CPCD size. The header pulls up by this size's cell padding-top
// (cpcdLayout → VERTICAL_PADDING): the face already has its own top gutter, so the
// cell's built-in 8px only stacked extra air above the glyph.
const HEADWORD_SIZE = 'md' as const;

// Drops the speaker so its centre meets the headword glyph's: the glyph's line box
// (CHAR_LINE_HEIGHT 1.21 × 2.25rem ≈ 44px) centre, plus the md GLYPH_DROP_PX (3px),
// minus half the button. Measured from the glyph line box's top, which sits the cell's
// padding-top (VERTICAL_PADDING) below the headword row's top — the speaker adds both.
// The face's top padding and the gap above the divider, px — named because the stacked
// header controls reach across both (ACTION LAYOUT).
const FACE_PADDING_TOP_PX = 12;
const DIVIDER_GAP_TOP_PX = 4;

// Minimum gap between the headword group and the controls, px (the header row's `gap`).
// Tight (4, not 8) so a 2-character headword + speaker still leaves the controls room to
// sit side by side on a phone (owner's call 2026-11-17).
const HEADER_GAP_PX = 4;

const SPEAKER_TOP_OFFSET = Math.round(44 / 2 + 3 - SPEAKER_BUTTON_SIZE / 2);

/**
 * The Reader's dictionary keycap (ReaderDocumentPage, above the reading box): the det entry
 * for the word the caret is on.
 *
 *   - **Shape** — a static raised keycap (2026-11-17): white face, the app outline, the
 *     hairline rounded edge (top rim light + fillet, src/theme/roundedEdge.ts) and a 4px
 *     straight lip — the Lessons plate's recipe. Not pressable: it is a display, so no
 *     `keycapPressSx`.
 *   - **Header** — the headword as a tone-coloured CPCD row (`ForeignText`, which renders
 *     the private CPCDRow), the same `md` headword the eip header draws (EipEntryHeader).
 *     Reading = `resolveDisplayPronunciation`, the one `SenseList` compares each sense's
 *     reading against, so an "alternate pinyin" in the list always means "differs from the
 *     header". Tone colours follow the learner's flp setting (`showPinyinColor`), as the eip does.
 *   - **Controls** (2026-11-17) — the eip's speaker (`SpeakerButton`) just right of the
 *     headword (`onSpeak` / `isSpeaking`), and a column at the header's right edge
 *     (`renderHeaderActions`) holding the More Info keycap (opens the eip) and the eip's
 *     Add ⇄ Added! key — side by side when the row has room, stacked (and smaller) under
 *     a long headword. The page owns all three (useReaderWordActions);
 *     this file only places them.
 *   - **Body** — `SenseList` (src/components/SenseList.tsx), the eip's "Other Translations"
 *     list itself: same layout, type and trailing star, minus the eip's section label
 *     (owner's call 2026-11-17: no label here — there is no main translation above it).
 *
 *   - **Empty** — a highlighted word with no entry shows the caller's `emptyFace` centred
 *     in the face (the Reader passes a small resting pawn, ReaderKeycapPawn); it used to be a
 *     "No dictionary entry found." line.
 *   - **Idle** — before the learner's first selection (the Reader's NOTHING-SELECTED
 *     MODE, useTextSelection) the face shows `idleHint` over its whole area — the page's how-to-navigate demo
 *     (src/features/reader/ReaderTapHint.tsx), which replaced a 5 s app notification. Once a word
 *     is selected the page stops passing it and it never returns for that visit.
 *
 * The card never changes shape between words; only its contents do. (Before 2026-11-16 it
 * was an MUI Card with a primary ring + shadow when a word was found; 2026-11-16 → 11-17 a
 * flat white card with a plain numbered definitions list.)
 *
 * Its only caller is the Reader (src/features/reader/ReaderDocumentPage.tsx).
 * Docs: docs/USER_DOCUMENT_FEATURE_SUMMARY.md § Look.
 * Layer: shared component (renders only).
 */
const VocabDisplayCard: React.FC<VocabDisplayCardProps> = React.memo(({ dictionaryEntry, idleHint, emptyFace, onSpeak, isSpeaking, renderHeaderActions }) => {
    // Read-only use of the flp's preferences: only the tone-colour toggle is consulted.
    const { settings } = useFlashcardLearnSettings();
    const showPinyinColor = settings.showPinyinColor;

    // ── ACTION LAYOUT: side by side, or stacked (owner's call 2026-11-17) ──────────
    // Measured, not CSS-wrapped, because the stacked controls are a different (smaller)
    // SIZE, which a flex wrap cannot tell its children. The side-by-side controls'
    // natural width is recorded whenever they are laid out side by side (it does not
    // depend on the word, so it stays valid while stacked); they stack when the header row
    // minus the headword group (which never shrinks) has less room than that.
    // ResizeObserver on all three boxes: the card's width, a new headword, and controls
    // that appear late (the Add key renders nothing until the word's status loads).
    const headerRowRef = useRef<HTMLDivElement>(null);
    const headwordRef = useRef<HTMLDivElement>(null);
    const actionsRef = useRef<HTMLDivElement>(null);
    const sideBySideWidthRef = useRef(0);
    const [stacked, setStacked] = useState(false);
    const hasActions = !!renderHeaderActions && !!dictionaryEntry && !idleHint;
    useLayoutEffect(() => {
        const row = headerRowRef.current;
        const headword = headwordRef.current;
        const actions = actionsRef.current;
        if (!hasActions || !row || !headword || !actions) return;
        const measure = () => {
            if (!stacked) sideBySideWidthRef.current = actions.offsetWidth;
            const room = row.clientWidth - headword.offsetWidth - HEADER_GAP_PX;
            setStacked(sideBySideWidthRef.current > room);
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(row);
        observer.observe(headword);
        observer.observe(actions);
        return () => observer.disconnect();
    }, [hasActions, stacked]);

    return (
        <Box
            className="vocab-display-card__keycap"
            // Never take focus from the reading box. The sense rows are focusable
            // (tabIndex 0), so a tap on one used to blur the textarea, and the Reader's
            // blur → refocus loop (useTextSelection → handleTextAreaBlur → focusTextArea)
            // then re-ran selection and could scroll the textarea — and SenseList closes
            // its commonality popup on any scroll. preventDefault on mousedown (which also
            // covers a touch's compatibility mousedown) keeps focus where it is; the row's
            // click still fires, so the popup opens normally. CAPTURE phase: the speaker
            // and the Add key stopPropagation on mousedown, which would hide it from a
            // bubble-phase handler here.
            onMouseDownCapture={(event) => event.preventDefault()}
            sx={{
                height: FIXED_CARD_HEIGHT,
                // Room for the lip (drawn as a shadow, outside the box) plus a gap above the
                // reading box.
                mb: `${KEYCAP_LIP + 12}px`,
                display: 'flex',
                flexDirection: 'column',
                backgroundColor: KEYCAP_FACE,
                borderRadius: `${CARD_SURFACE_RADIUS}px`,
                // Outline ring first, so the rim light below it is pushed under the ring
                // (`insideRingPx`); then the fillet and the lip — the Lessons plate's order.
                boxShadow: [
                    `inset 0 0 0 1px ${KEYCAP_OUTLINE}`,
                    roundedEdgeRimLightTop(KEYCAP_FACE, 1),
                    roundedEdgeFilletDown(KEYCAP_FACE, KEYCAP_EDGE),
                    `0 ${KEYCAP_LIP}px 0 ${KEYCAP_EDGE}`,
                ].join(', '),
                overflow: 'hidden',
                // Anchors the full-face idle hint layer.
                position: 'relative',
            }}
        >
            <Box
                className="vocab-display-card__content"
                // Bottom 4px, not 12 (owner's call 2026-11-17): the saved height lets four
                // one-line senses fit under FIXED_CARD_HEIGHT without scrolling, and the
                // list's last line box already carries a little air below its glyphs.
                // Sides 12px, not 16: width for the header controls to stay side by side
                // beside a 2-character headword (owner's call 2026-11-17).
                sx={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', px: 1.5, pt: `${FACE_PADDING_TOP_PX}px`, pb: 0.5 }}
            >
                {idleHint ? null : dictionaryEntry ? (
                    <>
                        {/* The header row: the headword (char + pinyin columns, as in the eip
                            header) with the speaker just right of it; the page's action
                            column (More Info over Add) pinned to the right edge. */}
                        <Box
                            ref={headerRowRef}
                            className="vocab-display-card__header"
                            sx={{
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: `${HEADER_GAP_PX}px`,
                                mt: `calc(-1 * ${VERTICAL_PADDING[HEADWORD_SIZE]})`,
                            }}
                        >
                            <Box
                                ref={headwordRef}
                                className="vocab-display-card__headword"
                                // Never shrinks: when the row runs short the controls stack
                                // instead (ACTION LAYOUT).
                                sx={{ display: 'flex', alignItems: 'flex-start', flex: '0 0 auto' }}
                            >
                                <ForeignText
                                    className="vocab-display-card__header-cpcd"
                                    size={HEADWORD_SIZE}
                                    justifyContent="flex-start"
                                    text={dictionaryEntry.word1}
                                    pronunciation={resolveDisplayPronunciation(dictionaryEntry)}
                                    language={dictionaryEntry.language}
                                    useToneColor={showPinyinColor}
                                    showPinyin
                                />
                                {onSpeak && (
                                    <Box
                                        className="vocab-display-card__speaker"
                                        sx={{ flexShrink: 0, mt: `calc(${VERTICAL_PADDING[HEADWORD_SIZE]} + ${SPEAKER_TOP_OFFSET}px)` }}
                                    >
                                        <SpeakerButton onClick={onSpeak} isLoading={isSpeaking} />
                                    </Box>
                                )}
                            </Box>
                            {hasActions && (
                                <Box
                                    ref={actionsRef}
                                    className={`vocab-display-card__header-actions vocab-display-card__header-actions--${stacked ? 'stacked' : 'side-by-side'}`}
                                    // ACTION LAYOUT (above): a no-wrap row at natural width, or
                                    // a column of the smaller controls, right-aligned. The
                                    // column has no gap of its own: raised keys' lips hang
                                    // below their boxes, so the page spaces its stack by eye.
                                    sx={{
                                        ml: 'auto',
                                        flexShrink: 0,
                                        // Stacked, the column spans the header row's full height
                                        // (the headword's char + pinyin), so the page can spread
                                        // its stack over it.
                                        alignSelf: stacked ? 'stretch' : 'flex-start',
                                        display: 'flex',
                                        flexDirection: stacked ? 'column' : 'row',
                                        alignItems: stacked ? 'stretch' : 'center',
                                        gap: stacked ? 0 : 0.75,
                                        // Side by side: back down by the header's pull-up, so the
                                        // controls keep the face's own top gutter. Stacked: the
                                        // column reaches from the FACE'S TOP EDGE to the DIVIDER
                                        // — the span the eye measures the stack against — so
                                        // the page's even spread is even within it. The header
                                        // row starts (face padding − cell padding-top) below the
                                        // face edge and ends the divider's gap above the divider.
                                        mt: stacked
                                            ? `calc(${VERTICAL_PADDING[HEADWORD_SIZE]} - ${FACE_PADDING_TOP_PX}px)`
                                            : VERTICAL_PADDING[HEADWORD_SIZE],
                                        mb: stacked ? `-${DIVIDER_GAP_TOP_PX}px` : 0,
                                    }}
                                >
                                    {renderHeaderActions(stacked)}
                                </Box>
                            )}
                        </Box>

                        <Box
                            className="vocab-display-card__divider"
                            sx={{ height: '1px', backgroundColor: COLORS.rowBorder, mt: `${DIVIDER_GAP_TOP_PX}px`, mb: 1.25 }}
                        />

                        <SenseList
                            entry={dictionaryEntry}
                            wordKey={`${dictionaryEntry.language}:${dictionaryEntry.word1}:${dictionaryEntry.id}`}
                            showPinyinColor={showPinyinColor}
                        />
                    </>
                ) : null}
            </Box>
            {/* NOTHING-SELECTED MODE: the page's demo takes the WHOLE face, edge to edge
                (owner's call 2026-11-17), not the padded content box. Inset 1px so its
                fills stop inside the outline ring (an inset shadow, which children would
                otherwise paint over), with the radius shrunk to match. */}
            {/* No entry: the caller's empty face (the Reader's pawn), centred in the WHOLE
                face, not the padded content box. It replaced a "No dictionary entry found."
                line (owner's call 2026-11-17). */}
            {!idleHint && !dictionaryEntry && emptyFace && (
                <Box
                    className="vocab-display-card__empty-face"
                    sx={{
                        position: 'absolute',
                        inset: '1px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        pointerEvents: 'none',
                    }}
                >
                    {emptyFace}
                </Box>
            )}
            {idleHint && (
                <Box
                    className="vocab-display-card__idle-hint"
                    sx={{
                        position: 'absolute',
                        inset: '1px',
                        borderRadius: `${CARD_SURFACE_RADIUS - 1}px`,
                        overflow: 'hidden',
                    }}
                >
                    {idleHint}
                </Box>
            )}
        </Box>
    );
}, (prevProps, nextProps) => {
    if (prevProps.idleHint !== nextProps.idleHint) return false;
    if (prevProps.emptyFace !== nextProps.emptyFace) return false;
    // The controls: the page memoises `onSpeak` and `renderHeaderActions` (useCallback on
    // the learning state and the lookup), so identity is a fair change signal.
    if (prevProps.isSpeaking !== nextProps.isSpeaking ||
        prevProps.onSpeak !== nextProps.onSpeak ||
        prevProps.renderHeaderActions !== nextProps.renderHeaderActions) return false;
    const prevDict = prevProps.dictionaryEntry;
    const nextDict = nextProps.dictionaryEntry;

    return (prevDict === null && nextDict === null) ||
        (prevDict !== null && nextDict !== null &&
            prevDict.id === nextDict.id &&
            prevDict.word1 === nextDict.word1);
});

VocabDisplayCard.displayName = 'VocabDisplayCard';

export default VocabDisplayCard;
