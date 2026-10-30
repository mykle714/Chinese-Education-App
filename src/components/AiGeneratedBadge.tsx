import { Box, Typography } from '@mui/material';
import type { SxProps, Theme } from '@mui/material';
import { AutoAwesome } from '@mui/icons-material';
import { SIZE, WEIGHT } from '../theme/scale';
import { COLORS } from '../theme/colors';
import { FONTS } from '../theme/fonts';

// The sparkle + label badge that marks a block of AI-generated content. Pairs with
// the aiGeneratedSurfaceSx border/tint (src/theme/aiGeneratedStyling.ts) — see that
// file for the full treatment + consumer list.

interface AiGeneratedBadgeProps {
    // Badge text; "AI SUGGESTION" fits synthesized entries, "AI GENERATED" plain AI content.
    label: string;
    className?: string;
    // Layout-only additions (margins etc.); the badge owns its color/typography.
    sx?: SxProps<Theme>;
    // 'inline' (default): orange sparkle + label, laid out in its container's flow.
    // 'tag': the Tower Tier 2 `.aib` — a small filled tag ringed in the AI orange that the
    // caller pins over its card's bottom-right edge (example sentences in the eip). `face`
    // is the tag's fill, so it masks the card edge it straddles; text stays `ink`.
    variant?: 'inline' | 'tag';
    face?: string;
    ink?: string;
}

export function AiGeneratedBadge({ label, className, sx, variant = 'inline', face = COLORS.white, ink = COLORS.onSurface }: AiGeneratedBadgeProps) {
    if (variant === 'tag') {
        return (
            <Box
                className={className ?? 'ai-generated-badge ai-generated-badge--tag'}
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '3px',
                    padding: '2px 6px',
                    borderRadius: '6px',
                    whiteSpace: 'nowrap',
                    backgroundColor: face,
                    boxShadow: `inset 0 0 0 1px ${COLORS.aiGenerated}`,
                    color: ink,
                    ...sx,
                }}
            >
                <AutoAwesome sx={{ fontSize: 12, color: COLORS.aiGenerated }} />
                <Typography
                    component="span"
                    sx={{ fontFamily: FONTS.label, fontSize: 9.5, fontWeight: WEIGHT.bold, letterSpacing: '0.06em', lineHeight: 1.3, color: 'inherit' }}
                >
                    {label}
                </Typography>
            </Box>
        );
    }
    return (
        <Box
            className={className ?? 'ai-generated-badge'}
            sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: COLORS.aiGenerated, ...sx }}
        >
            <AutoAwesome sx={{ fontSize: SIZE.body }} />
            <Typography sx={{ fontSize: SIZE.caption, fontWeight: WEIGHT.bold, letterSpacing: 0.5 }}>
                {label}
            </Typography>
        </Box>
    );
}
