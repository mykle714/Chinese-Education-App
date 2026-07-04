import { Card, CardContent, Typography, Box } from '@mui/material';
import { AutoAwesome } from '@mui/icons-material';
import type { AiDictionaryEntry } from '../types';
import { FONTS } from '../theme/fonts';
import { SIZE, WEIGHT } from '../theme/scale';
import { COLORS } from '../theme/colors';

interface AiDictionaryEntryCardProps {
    entry: AiDictionaryEntry;
}

/**
 * Display-only AI-synthesized dictionary entry (docs/DICTIONARY_AI_FALLBACK_SEARCH.md). Rendered in
 * the app's orange (COLORS.yellowMain) to distinguish it from real dictionary rows, and
 * intentionally NOT clickable — it carries no id/metadata, so there is no detail view to open.
 */
function AiDictionaryEntryCard({ entry }: AiDictionaryEntryCardProps) {
    return (
        <Card
            className="ai-dictionary-entry-card"
            sx={{
                border: '1px solid',
                borderColor: COLORS.yellowMain,
                backgroundColor: `${COLORS.yellowMain}14`, // ~8% orange tint
                height: '100%',
            }}
        >
            <CardContent className="ai-dictionary-entry-card__content">
                <Box
                    className="ai-dictionary-entry-card__badge"
                    sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1, color: COLORS.yellowMain }}
                >
                    <AutoAwesome sx={{ fontSize: SIZE.body }} />
                    <Typography sx={{ fontSize: SIZE.caption, fontWeight: WEIGHT.bold, letterSpacing: 0.5 }}>
                        AI SUGGESTION
                    </Typography>
                </Box>

                <Typography
                    className="ai-dictionary-entry-card__word"
                    variant="h6"
                    component="h3"
                    gutterBottom
                    sx={{ fontWeight: WEIGHT.bold, fontFamily: FONTS.cjk, fontSize: SIZE.title }}
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
