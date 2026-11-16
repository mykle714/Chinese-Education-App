/**
 * ScrollArrow — one paging arrow beside a horizontally-overflowing strip of chips.
 *
 * LAYER: shared presentation (`src/components/`, per FRONTEND_LAYERING.md). Importer today:
 * the beginner keyboard's candidate row (Immersive World's hint tray was the second, removed 2026-11-09, archived — docs/ARCHIVED_FEATURES.md).
 * It renders a button and nothing else; the measuring, the desktop gate and the scrolling
 * all live in `useHorizontalScrollArrows`, which is what decides whether to mount this.
 *
 * ⚠️ **KEPT MOUNTED AT THE ENDS OF TRAVEL, NOT UNMOUNTED.** A disabled arrow fades to 25%
 * rather than disappearing, because unmounting it would change the strip's width and shunt
 * the chips sideways underneath the thumb that is paging them.
 *
 * `sx` lets the owner restyle the button's face without this shared component importing
 * feature code: the candidate row passes the beginner keyboard's raised keycap
 * (features/beginnerKeyboard/keycapStyle.ts → whiteKeySx), merged over the defaults below.
 *
 * `accentColor` is a prop rather than a token because the candidate row's arrows take that
 * row's per-MODE accent (blue while drawing, green when idle), so there is no single
 * correct colour to bake in.
 */
import { Box } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { COLORS } from '../theme';

export interface ScrollArrowProps {
  direction: -1 | 1;
  /** False at that end of the travel: visible but inert, so the strip does not reflow. */
  enabled: boolean;
  onClick: () => void;
  /**
   * BEM block for the owning strip, e.g. `beginner-keyboard__candidate`. The rendered
   * element is `<block>-arrow <block>-arrow--left|right`.
   */
  classBlock: string;
  accentColor?: string;
  /** Read by a screen reader in place of the chevron; name what is being scrolled. */
  label: string;
  /** Face overrides, merged last (e.g. a raised keycap). */
  sx?: SxProps<Theme>;
}

export default function ScrollArrow({
  direction,
  enabled,
  onClick,
  classBlock,
  accentColor = COLORS.textSecondary,
  label,
  sx,
}: ScrollArrowProps) {
  const side = direction === -1 ? 'left' : 'right';
  return (
    <Box
      component="button"
      type="button"
      aria-label={label}
      className={`${classBlock}-arrow ${classBlock}-arrow--${side}`}
      disabled={!enabled}
      onClick={onClick}
      sx={[{
        flexShrink: 0,
        width: 28,
        height: 44,
        p: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: 'none',
        borderRadius: 2,
        backgroundColor: 'transparent',
        color: accentColor,
        opacity: enabled ? 1 : 0.25,
        cursor: enabled ? 'pointer' : 'default',
        '&:hover': { backgroundColor: enabled ? COLORS.rowHoverBg : 'transparent' },
      }, ...(Array.isArray(sx) ? sx : [sx])]}
    >
      {direction === -1 ? <ChevronLeftIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
    </Box>
  );
}
