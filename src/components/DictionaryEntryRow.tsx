import { Box, Typography } from '@mui/material';
import type { DictionaryEntry, Language } from '../types';
import { joinDefinitionList, resolveSearchRowView } from '../utils/definitionUtils';
import ForeignText, { isLatinScriptLang } from './ForeignText';
import Icon from './Icon';
import { COLORS } from '../theme/colors';
import SwipeableTextLine from './SwipeableTextLine';
import { FONTS } from '../theme/fonts';

interface DictionaryEntryRowProps {
    entry: DictionaryEntry;
    onClick: (entry: DictionaryEntry) => void;
    /**
     * Language of the entry. Decides the row's SHAPE (see the two branches below),
     * not just its typography. Defaults to the signed-in user's selection via
     * ForeignText when omitted.
     */
    language?: Language;
    /**
     * Horizontal padding, in px. Defaults to the artboard's 22 — the shelf system's
     * full-bleed page gutter. A row placed inside an already-inset panel (the eip
     * Compare workspace's slot-B search) passes a smaller value so its text does not
     * sit twice-indented.
     */
    inset?: number;
    /**
     * Tap the (Chinese) headword to copy it — characters first, then pinyin on the
     * next tap (CPCDRow.tapToCopy) — INSTEAD of opening the entry. The rest of the
     * row still opens it. Opt-in: the Dictionary page's results turn it on; a
     * picker (the Compare sheet's slot-B search) leaves it off, because there a tap
     * anywhere on the row means "choose this word". Ignored for Latin-script rows
     * (ForeignText's plain branch has no tap-to-copy).
     */
    headwordTapToCopy?: boolean;
    /**
     * `list` (default) — the full-bleed `.dr` row: 22px gutters, a hairline under every
     *   row, a 12.5px faint gloss. Used by the Compare picker and the community search.
     * `slab` — the Dictionary page's row since the 2026-10-29 redesign (design project
     *   "Tower Tier 2 - Time of Day", artboard "Dictionary · search + results"): rows
     *   grouped on one white slab (DictionaryResultSlab), tighter 16/12px insets, a
     *   15px gloss in ink2 and a larger chevron. The slab draws the hairline BETWEEN
     *   rows, so the last row has no rule under it. `inset` is ignored.
     */
    variant?: 'list' | 'slab';
    /**
     * The row's ink and rules when it sits on a themed surface — the Dictionary page
     * passes its time-of-day look (src/timeOfDay/tier2Look.ts), which is slate with
     * light ink at night. Omitted, the row uses the app's day COLORS (every other
     * caller). The headword's characters take `ink`; the tone-coloured pinyin under them
     * is never recoloured.
     */
    tones?: DictionaryEntryRowTones;
    /**
     * Let a gloss that overflows its line be SWIPED sideways to read the senses past the
     * edge, instead of ellipsizing it (owner's request 2026-10-29). The cut-off edge
     * fades rather than showing "…". Opt-in, because a touch pan only works when every
     * ancestor scroller allows `pan-x` — the host page must pass `horizontalPan` to
     * MobileTabScreen (see the touch-action note on its ScrollArea). The Dictionary page
     * turns it on; the Compare picker (inside a dragged sheet) and community search do not.
     */
    swipeGloss?: boolean;
}

/** The colours a themed surface lends the row (a structural subset of Tier2Look). */
export interface DictionaryEntryRowTones {
    ink: string;
    ink2: string;
    muted: string;
    line: string;
    pressed: string;
}

interface DictionaryEntryGlossProps {
    gloss: string;
    isSlab: boolean;
    color: string;
    swipe: boolean;
}

/**
 * `.df` — the gloss. One line.
 *
 * Not swipeable: ellipsized, as the artboard draws it.
 *
 * Swipeable (`swipeGloss`): a SwipeableTextLine — swiped sideways, clipped at the edges,
 * rubber-banding at either end. `pan-x pan-y`, so a vertical drag that starts
 * on the line still scrolls the page; a tap still opens the entry.
 */
function DictionaryEntryGloss({ gloss, isSlab, color, swipe }: DictionaryEntryGlossProps) {
    const textSx = {
        fontFamily: FONTS.sans,
        fontSize: isSlab ? '15px' : '12.5px',
        color,
    } as const;

    if (!swipe) {
        return (
            <Typography className="dictionary-entry-row__definition" sx={{ ...textSx, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {gloss}
            </Typography>
        );
    }
    return (
        <SwipeableTextLine
            className="dictionary-entry-row__definition dictionary-entry-row__definition--swipeable"
            text={gloss}
            sx={textSx}
            touchAction="pan-x pan-y"
        />
    );
}

const DAY_TONES: DictionaryEntryRowTones = {
    ink: COLORS.onSurface,
    ink2: COLORS.iconColor,
    muted: COLORS.textSecondary,
    line: COLORS.rowBorder,
    pressed: COLORS.rowHoverBg,
};

/**
 * `.dr` — one dictionary search hit (docs/SHELF_REDESIGN.md § Part B entry 7).
 *
 * Deliberately NOT the `.rw` Row primitive: the design gives dictionary hits their
 * own class because a hit has no avatar and no leading tile. The headword itself is
 * the visual anchor — there is no icon to source and no first-character tile to
 * invent — so the row is purely typographic: headword, tone-coloured pinyin under
 * it, gloss, chevron.
 *
 * Two shapes, decided by script:
 *
 *   Chinese — the artboard's own layout. The headword is a fixed, narrow anchor
 *     (one or two full-width glyphs), so it takes a shrink-proof left column with
 *     its pinyin beneath, and the gloss takes the rest of the line.
 *
 *   Spanish — the headword goes ON the flexible column, above the gloss. A Latin
 *     headword is variable-width ("extraordinariamente" is 19 glyphs where 时间 is
 *     two), so pinning it to a shrink-proof column would squeeze the gloss off the
 *     row entirely. It also has no pronunciation line to sit under it, which is what
 *     made the two-column split worth having in the first place.
 *
 * The headword renders through `ForeignText` — never `CPCDRow` directly, which is
 * private to it (docs/SHELF_REDESIGN.md § entry 7, "Watch out").
 *
 * Depended on by: docs/SHELF_REDESIGN.md § Part B entry 7,
 * docs/DICTIONARY_NUMBERED_PINYIN_SEARCH.md.
 */
function DictionaryEntryRow({ entry, onClick, language, inset = 22, headwordTapToCopy = false, variant = 'list', tones, swipeGloss = false }: DictionaryEntryRowProps) {
    const isSlab = variant === 'slab';
    const t = tones ?? DAY_TONES;
    // The artboard's gloss is a single ellipsized line carrying as many senses as
    // fit ("time · period"), not just the first one — the row has a fixed height
    // either way, so a second gloss is free information rather than extra space.
    //
    // A hit found through a NON-default sense ("ma2" → 吗's má sense, "row" → 行's háng) shows
    // that sense's pinyin with its glosses leading the line; every other hit renders its
    // default sense exactly as before. See resolveSearchRowView.
    const rowView = resolveSearchRowView(entry);
    // Every sense on one line, middle-dot separated (definitionUtils → joinDefinitionList).
    const gloss = joinDefinitionList(rowView.definitions) || 'No definition available';

    const isLatin = isLatinScriptLang(language);

    // `.df` — the gloss. Shared by both branches; see DictionaryEntryGloss.
    const glossNode = <DictionaryEntryGloss gloss={gloss} isSlab={isSlab} color={isSlab ? t.ink2 : t.muted} swipe={swipeGloss} />;

    return (
        <Box
            className={`dictionary-entry-row dictionary-entry-row--${variant}`}
            component="button"
            onClick={() => onClick(entry)}
            sx={{
                // A real <button>: the whole row is one tap target and reaches the
                // keyboard without a role/tabIndex/onKeyDown trio bolted on.
                display: 'flex',
                alignItems: 'center',
                gap: isSlab ? '14px' : '15px',
                width: '100%',
                minHeight: isSlab ? 44 : undefined,
                textAlign: 'left',
                padding: isSlab ? '10px 12px 10px 16px' : `12px ${inset}px`,
                border: 'none',
                // Slab rows: the hairline sits on TOP of every row but the first, so the
                // slab's rounded bottom edge is never crossed by a rule.
                borderBottom: isSlab ? 'none' : `1px solid ${t.line}`,
                borderTop: isSlab ? `1px solid ${t.line}` : 'none',
                '&:first-of-type': isSlab ? { borderTop: 'none' } : {},
                borderRadius: 0,
                background: 'transparent',
                font: 'inherit',
                color: 'inherit',
                cursor: 'pointer',
                '&:active': { backgroundColor: t.pressed },
                '@media (hover: hover)': {
                    '&:hover': { backgroundColor: t.pressed },
                },
            }}
        >
            {isLatin ? (
                // Spanish: headword and gloss stacked on the one flexible column.
                <Box className="dictionary-entry-row__text" sx={{ flex: 1, minWidth: 0 }}>
                    <ForeignText
                        className="dictionary-entry-row__headword"
                        language={language}
                        text={entry.word1}
                        size="sm"
                        bold
                        // 17px rather than the `sm` plain scale (26px): a Spanish headword
                        // is many glyphs wide where its Chinese counterpart is one or two,
                        // and this row gives it a single line.
                        plainFontSize="17px"
                        characterColor={tones?.ink}
                    />
                    {glossNode}
                </Box>
            ) : (
                <>
                    {/* `.hw` — the anchor: characters with their tone-coloured pinyin
                        beneath, which is exactly what a `sm` cpcd row renders. */}
                    <Box
                        className="dictionary-entry-row__headword-block"
                        // A copying tap is consumed here so it doesn't bubble to the row's
                        // <button> and open the entry. The copy caption (CpcdPopup) is
                        // portalled, but React still bubbles its clicks through this
                        // subtree, so this one guard covers the caption too.
                        onClick={headwordTapToCopy ? (e) => e.stopPropagation() : undefined}
                        sx={{ flexShrink: 0 }}
                    >
                        <ForeignText
                            className="dictionary-entry-row__headword"
                            language={language}
                            text={entry.word1}
                            // Default-sense reading, or the search-matched sense's (resolveSearchRowView).
                            pronunciation={rowView.pronunciation}
                            size="sm"
                            bold
                            tapToCopy={headwordTapToCopy}
                            characterColor={tones?.ink}
                        />
                    </Box>
                    {/* Stretched to the row's full height (gloss centred in it) when the gloss
                        swipes, so the whole body takes the swipe rather than one 15px line. */}
                    <Box
                        className="dictionary-entry-row__text"
                        sx={swipeGloss
                            ? { flex: 1, minWidth: 0, alignSelf: 'stretch', display: 'flex', flexDirection: 'column', justifyContent: 'center' }
                            : { flex: 1, minWidth: 0 }}
                    >
                        {glossNode}
                    </Box>
                </>
            )}

            <Icon
                name="chevron_right"
                size={isSlab ? 22 : 16}
                color={isSlab || tones ? t.muted : COLORS.textFaint}
                className="dictionary-entry-row__chevron"
                sx={{ alignSelf: 'center', flexShrink: 0 }}
            />
        </Box>
    );
}

export default DictionaryEntryRow;
