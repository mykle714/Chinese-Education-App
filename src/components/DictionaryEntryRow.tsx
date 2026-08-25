import { Box, Typography } from '@mui/material';
import type { DictionaryEntry, Language } from '../types';
import { stripParentheses } from '../utils/definitionUtils';
import ForeignText, { isLatinScriptLang } from './ForeignText';
import Icon from './Icon';
import { COLORS } from '../theme/colors';
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
}

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
function DictionaryEntryRow({ entry, onClick, language, inset = 22 }: DictionaryEntryRowProps) {
    // The artboard's gloss is a single ellipsized line carrying as many senses as
    // fit ("time; period"), not just the first one — the row has a fixed height
    // either way, so a second gloss is free information rather than extra space.
    const gloss = entry.definitions && entry.definitions.length > 0
        ? entry.definitions.map(stripParentheses).filter(Boolean).join('; ')
        : 'No definition available';

    const isLatin = isLatinScriptLang(language);

    // `.df` — the gloss. One line, ellipsized. Shared by both branches.
    const glossNode = (
        <Typography
            className="dictionary-entry-row__definition"
            sx={{
                fontFamily: FONTS.sans,
                fontSize: '12.5px',
                color: COLORS.textSecondary,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
            }}
        >
            {gloss}
        </Typography>
    );

    return (
        <Box
            className="dictionary-entry-row"
            component="button"
            onClick={() => onClick(entry)}
            sx={{
                // A real <button>: the whole row is one tap target and reaches the
                // keyboard without a role/tabIndex/onKeyDown trio bolted on.
                display: 'flex',
                alignItems: 'center',
                gap: '15px',
                width: '100%',
                textAlign: 'left',
                padding: `12px ${inset}px`,
                border: 'none',
                borderBottom: `1px solid ${COLORS.rowBorder}`,
                borderRadius: 0,
                background: 'transparent',
                font: 'inherit',
                color: 'inherit',
                cursor: 'pointer',
                '&:active': { backgroundColor: COLORS.rowHoverBg },
                '@media (hover: hover)': {
                    '&:hover': { backgroundColor: COLORS.rowHoverBg },
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
                    />
                    {glossNode}
                </Box>
            ) : (
                <>
                    {/* `.hw` — the anchor: characters with their tone-coloured pinyin
                        beneath, which is exactly what a `sm` cpcd row renders. */}
                    <Box className="dictionary-entry-row__headword-block" sx={{ flexShrink: 0 }}>
                        <ForeignText
                            className="dictionary-entry-row__headword"
                            language={language}
                            text={entry.word1}
                            pronunciation={entry.pronunciation}
                            size="sm"
                            bold
                        />
                    </Box>
                    <Box className="dictionary-entry-row__text" sx={{ flex: 1, minWidth: 0 }}>
                        {glossNode}
                    </Box>
                </>
            )}

            <Icon
                name="chevron_right"
                size={16}
                color={COLORS.textFaint}
                className="dictionary-entry-row__chevron"
                sx={{ alignSelf: 'center', flexShrink: 0 }}
            />
        </Box>
    );
}

export default DictionaryEntryRow;
