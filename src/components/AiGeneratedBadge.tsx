import { Box, Typography } from '@mui/material';
import type { SxProps, Theme } from '@mui/material';
import { AutoAwesome } from '@mui/icons-material';
import { SIZE, WEIGHT } from '../theme/scale';
import { COLORS } from '../theme/colors';

// The sparkle + label badge that marks a block of AI-generated content. Pairs with
// the aiGeneratedSurfaceSx border/tint (src/theme/aiGeneratedStyling.ts) — see that
// file for the full treatment + consumer list.

interface AiGeneratedBadgeProps {
    // Badge text; "AI SUGGESTION" fits synthesized entries, "AI GENERATED" plain AI content.
    label: string;
    className?: string;
    // Layout-only additions (margins etc.); the badge owns its color/typography.
    sx?: SxProps<Theme>;
}

export function AiGeneratedBadge({ label, className, sx }: AiGeneratedBadgeProps) {
    return (
        <Box
            className={className ?? 'ai-generated-badge'}
            sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: COLORS.yellowMain, ...sx }}
        >
            <AutoAwesome sx={{ fontSize: SIZE.body }} />
            <Typography sx={{ fontSize: SIZE.caption, fontWeight: WEIGHT.bold, letterSpacing: 0.5 }}>
                {label}
            </Typography>
        </Box>
    );
}
