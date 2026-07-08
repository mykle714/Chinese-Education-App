import { Card, CardContent, Typography } from '@mui/material';
import type { AiDictionaryEntry } from '../types';
import { hasChinese } from '../utils/textUtils';
import { FONTS } from '../theme/fonts';
import { SIZE, WEIGHT } from '../theme/scale';
import { aiGeneratedSurfaceSx } from '../theme/aiGeneratedStyling';
import { AiGeneratedBadge } from './AiGeneratedBadge';

interface AiDictionaryEntryCardProps {
    entry: AiDictionaryEntry;
}

/**
 * Display-only AI-synthesized dictionary entry (docs/DICTIONARY_AI_FALLBACK_SEARCH.md). Rendered in
 * the shared AI-generated treatment (aiGeneratedStyling — orange border/tint + sparkle badge) to
 * distinguish it from real dictionary rows, and intentionally NOT clickable — it carries no
 * id/metadata, so there is no detail view to open.
 */
function AiDictionaryEntryCard({ entry }: AiDictionaryEntryCardProps) {
    return (
        <Card
            className="ai-dictionary-entry-card"
            sx={{ ...aiGeneratedSurfaceSx, height: '100%' }}
        >
            <CardContent className="ai-dictionary-entry-card__content">
                <AiGeneratedBadge
                    className="ai-dictionary-entry-card__badge"
                    label="AI SUGGESTION"
                    sx={{ mb: 1 }}
                />

                <Typography
                    className="ai-dictionary-entry-card__word"
                    variant="h6"
                    component="h3"
                    gutterBottom
                    // The headword is CJK only for the Chinese fallback; a Spanish (Latin) headword
                    // must use the Latin UI font, so pick the stack from the word's own script.
                    sx={{ fontWeight: WEIGHT.bold, fontFamily: hasChinese(entry.word1) ? FONTS.cjk : FONTS.sans, fontSize: SIZE.title }}
                >
                    {entry.word1}
                </Typography>

                {entry.pronunciation && (
                    <Typography
                        className="ai-dictionary-entry-card__pronunciation"
                        variant="body2"
                        color="text.secondary"
                        sx={{ fontStyle: 'italic', mb: 1 }}
                    >
                        {entry.pronunciation}
                    </Typography>
                )}

                <Typography className="ai-dictionary-entry-card__definition" variant="body2" color="text.primary">
                    {entry.definition || 'No definition available.'}
                </Typography>
            </CardContent>
        </Card>
    );
}

export default AiDictionaryEntryCard;
