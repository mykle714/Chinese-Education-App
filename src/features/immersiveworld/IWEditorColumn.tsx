import type { ReactNode } from 'react';
import { Box, IconButton, Tooltip, Typography } from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { COLORS } from '../../theme/colors';
import { WEIGHT } from '../../theme/scale';

/**
 * IWEditorColumn — one collapsible side column of the scene editor
 * (docs/IMMERSIVE_WORLD.md § 12 phase 1d).
 *
 * LAYER: feature view. Pure chrome: it owns no state at all — the open/closed flag is held
 * (and persisted) by `useIWEditorLayout` and handed down, so the page decides what a reload
 * restores and this component only draws it.
 *
 * WHY SIDEWAYS, NOT DOWNWARD (2026-09-19). The thing an author runs out of in this editor is
 * BOARD WIDTH, not page height: the map is a fixed-aspect isometric canvas squeezed between
 * two fixed-width columns, and collapsing a panel's body downward would give the freed space
 * to nothing. So a collapsed column shrinks to a {@link IW_RAIL_WIDTH}px RAIL and the map —
 * the only `flex: 1` child of the body row — absorbs every pixel it gives up.
 *
 * THE RAIL IS THE WHOLE TARGET. It is one big button: a 34px strip is too narrow to hunt a
 * chevron inside, so the label, the icon and the strip itself all re-open the column. The
 * chevron always points AWAY from the map, i.e. in the direction the column would grow.
 */

/** A collapsed column's width. Wide enough for a rotated label, narrow enough to be a margin. */
export const IW_RAIL_WIDTH = 34;

export interface IWEditorColumnProps {
  /** BEM-ish root class; the rail and body derive their own names from it. */
  className: string;
  /** Which edge of the map this column sits on — decides the border side and chevron direction. */
  side: 'left' | 'right';
  /** The name shown on the rail (and in the expanded header when `header` is omitted). */
  label: string;
  /** Width in px while expanded. Ignored while collapsed. */
  width: number;
  collapsed: boolean;
  onToggleCollapsed: (collapsed: boolean) => void;
  /** Replaces the expanded header's plain title — the left column puts its tab strip here. */
  header?: ReactNode;
  /** Ground for the scrolling body. The tools page overrides it with its dark board chrome. */
  bodyBackground?: string;
  /** Extra styling for the scrolling body (the content column's density rules). */
  bodySx?: Record<string, unknown>;
  children: ReactNode;
}

export default function IWEditorColumn({
  className, side, label, width, collapsed, onToggleCollapsed,
  header, bodyBackground = COLORS.white, bodySx, children,
}: IWEditorColumnProps) {
  // The border always faces the map, so the three columns read as one ruled surface.
  const edge = side === 'left'
    ? { borderRight: `1px solid ${COLORS.border}` }
    : { borderLeft: `1px solid ${COLORS.border}` };

  // Collapsing moves the column AWAY from the map; expanding moves it back toward it.
  const CollapseIcon = side === 'left' ? ChevronLeftIcon : ChevronRightIcon;
  const ExpandIcon = side === 'left' ? ChevronRightIcon : ChevronLeftIcon;

  if (collapsed) {
    return (
      <Tooltip title={`Show ${label}`} placement={side === 'left' ? 'right' : 'left'}>
        <Box
          className={`${className} ${className}--collapsed`}
          role="button"
          tabIndex={0}
          onClick={() => onToggleCollapsed(false)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onToggleCollapsed(false); }}
          sx={{
            width: IW_RAIL_WIDTH, flex: '0 0 auto',
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: 1, pt: 1, cursor: 'pointer', backgroundColor: COLORS.header,
            '&:hover': { backgroundColor: COLORS.rowHoverBg },
            ...edge,
          }}
        >
          <ExpandIcon fontSize="small" sx={{ color: COLORS.iconColor }} />
          {/* Rotated so a long label fits a 34px strip. `vertical-rl` reads top-to-bottom,
              which is the direction the eye already travels down the rail. */}
          <Typography
            className={`${className}__rail-label`}
            sx={{
              writingMode: 'vertical-rl', fontSize: 11, letterSpacing: '0.12em',
              textTransform: 'uppercase', fontWeight: WEIGHT.medium,
              color: COLORS.textSecondary, userSelect: 'none',
            }}
          >
            {label}
          </Typography>
        </Box>
      </Tooltip>
    );
  }

  return (
    <Box
      className={className}
      sx={{
        width, flex: '0 0 auto', minWidth: 0,
        display: 'flex', flexDirection: 'column', minHeight: 0,
        backgroundColor: bodyBackground,
        ...edge,
      }}
    >
      {/* Header: the tab strip (or a plain title) and the one control that hides the column.
          `flex: '0 0 auto'` so it never scrolls away — the collapse control must stay reachable
          however far down the panel the author has scrolled. */}
      <Box
        className={`${className}__header`}
        sx={{
          flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 1,
          pl: side === 'left' ? 1.5 : 0.5, pr: side === 'left' ? 0.5 : 1.5,
          minHeight: 36, borderBottom: `1px solid ${COLORS.rowBorder}`,
          backgroundColor: COLORS.header,
        }}
      >
        {side === 'right' && (
          <Tooltip title={`Hide ${label}`} placement="bottom">
            <IconButton className={`${className}__collapse-btn`} size="small" onClick={() => onToggleCollapsed(true)}>
              <CollapseIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {header ?? (
            <Typography
              className={`${className}__title`}
              sx={{
                fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase',
                fontWeight: WEIGHT.medium, color: COLORS.textSecondary,
              }}
            >
              {label}
            </Typography>
          )}
        </Box>
        {side === 'left' && (
          <Tooltip title={`Hide ${label}`} placement="bottom">
            <IconButton className={`${className}__collapse-btn`} size="small" onClick={() => onToggleCollapsed(true)}>
              <CollapseIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      <Box
        className={`${className}__body`}
        sx={{ flex: 1, minHeight: 0, overflowY: 'auto', backgroundColor: bodyBackground, ...bodySx }}
      >
        {children}
      </Box>
    </Box>
  );
}
