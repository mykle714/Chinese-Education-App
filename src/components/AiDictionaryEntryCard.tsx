import { Box, CircularProgress, Typography } from '@mui/material';
import type { AiDictionaryEntry } from '../types';
import type { Tier2Look } from '../timeOfDay/tier2Look';
import { hasChinese } from '../utils/textUtils';
import { FONTS } from '../theme/fonts';
import { SIZE, WEIGHT } from '../theme/scale';
import { COLORS } from '../theme/colors';
import { useAnimatedHeight } from '../hooks/useAnimatedHeight';
import { AiGeneratedBadge } from './AiGeneratedBadge';

interface AiDictionaryEntryCardProps {
    // The answer to show. null while the request is in flight → the compact loading row.
    entry: AiDictionaryEntry | null;
    // The dictionary page's time-of-day look (src/timeOfDay/tier2Look.ts). The card is drawn
    // as one more result slab, so it takes the same surface/outline/ink as the slabs below it.
    look: Tier2Look;
}

/**
 * The dictionary's AI-synthesized entry (docs/DICTIONARY_AI_FALLBACK_SEARCH.md), in both of
 * its phases:
 *   1. loading (`entry` null) — a compact row: spinner + "Asking AI…";
 *   2. answer — badge, headword, pronunciation, definition.
 *
 * DictionaryPage keeps ONE instance mounted across the two phases, so the same white card
 * stays on screen and its height eases from the loading row up to the full entry
 * (useAnimatedHeight). A cached answer mounts straight into phase 2, at full height.
 *
 * Drawn as a plain rounded slab matching the page's result slabs
 * (DictionaryPageParts → DictionaryResultSlab: `look.surface` fill — white by day — 18px
 * corner, 1px `look.outline`). The only AI marker is the orange sparkle badge / spinner.
 *
 * Intentionally NOT clickable — it carries no id/metadata, so there is no detail view to open.
 */
function AiDictionaryEntryCard({ entry, look }: AiDictionaryEntryCardProps) {
    const { innerRef, height } = useAnimatedHeight();

    return (
        <Box
            className={`ai-dictionary-entry-card${entry ? '' : ' ai-dictionary-entry-card--loading'}`}
            sx={{
                backgroundColor: look.surface,
                borderRadius: '18px',
                border: `1px solid ${look.outline}`,
                // The measured height is the inner wrapper's (padding included, border not), so
                // the explicit height must exclude the border — content-box, not border-box,
                // or the bottom 2px would clip.
                boxSizing: 'content-box',
                height,
                overflow: 'hidden',
                transition: 'height 280ms cubic-bezier(0.2, 0, 0, 1)',
            }}
        >
            <Box ref={innerRef} className="ai-dictionary-entry-card__inner" sx={{ padding: '14px 16px' }}>
                {entry ? (
                    <Box className="ai-dictionary-entry-card__content">
                        <AiGeneratedBadge
                            className="ai-dictionary-entry-card__badge"
                            label="AI SUGGESTION"
                            sx={{ mb: 1 }}
                        />

                        <Typography
                            className="ai-dictionary-entry-card__word"
                            component="h3"
                            // The headword is CJK only for the Chinese fallback; a Spanish (Latin)
                            // headword must use the Latin UI font, so pick the stack from the word's
                            // own script.
                            sx={{
                                fontWeight: WEIGHT.bold,
                                fontFamily: hasChinese(entry.word1) ? FONTS.cjk : FONTS.sans,
                                fontSize: SIZE.title,
                                color: look.ink,
                                mb: 0.5,
                            }}
                        >
                            {entry.word1}
                        </Typography>

                        {entry.pronunciation && (
                            <Typography
                                className="ai-dictionary-entry-card__pronunciation"
                                variant="body2"
                                sx={{ fontStyle: 'italic', color: look.ink2, mb: 1 }}
                            >
                                {entry.pronunciation}
                            </Typography>
                        )}

                        <Typography
                            className="ai-dictionary-entry-card__definition"
                            variant="body2"
                            sx={{ color: look.ink }}
                        >
                            {entry.definition || 'No definition available.'}
                        </Typography>
                    </Box>
                ) : (
                    <Box
                        className="ai-dictionary-entry-card__loading"
                        sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
                    >
                        <CircularProgress size={18} sx={{ color: COLORS.aiGenerated }} />
                        <Typography variant="body2" sx={{ color: look.ink2 }}>
                            Asking AI…
                        </Typography>
                    </Box>
                )}
            </Box>
        </Box>
    );
}

export default AiDictionaryEntryCard;
