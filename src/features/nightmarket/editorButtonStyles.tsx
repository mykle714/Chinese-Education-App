import type { ReactNode } from 'react';
import { Box, Button, Tooltip } from '@mui/material';
import type { SxProps, Theme } from '@mui/material';
import { WEIGHT } from '../../theme/scale';

/**
 * Shared chrome for the authoring tools, so their toolbars read as one system: the square
 * icon "palette" button, its corner hotkey badge, the accent-tinted group box, and the
 * outlined header-button styling used over the dark scene.
 *
 * SIZING CONTRACT — every button here is a FIXED size that never reflows:
 *  - palette buttons are locked to exactly 40×40 (`flex: '0 0 auto'` + min/max width & height),
 *    so a crowded toolbar row overflows instead of squeezing individual buttons;
 *  - header buttons are locked to 32px tall with `whiteSpace: 'nowrap'`, so a long label
 *    ("Delete Template") can never wrap to a second line and grow taller than its neighbours;
 *  - nothing here uses MUI's `contained` variant. `contained` and `outlined` have different
 *    paddings (4px/10px vs 3px/9px + a 1px border) and `contained` adds a box-shadow, so
 *    toggling `variant` on an active state shifted the icon by 1px and changed the button's
 *    visual weight. Active/idle is expressed purely through `paletteBtnSx` colours instead.
 *
 * Referenced by TemplateEditorPage.tsx, TemplateSandboxPage.tsx and — for the PALETTE half
 * only — the immersive world's IWSceneMapPanel.tsx, which reuses `PaletteButton` /
 * `toolGroupSx` / `HotkeyBadge` so an author who has learned one board has learned both.
 * It deliberately does NOT reuse `headerBtnSx` and friends: those are drawn to float over
 * a dark Pixi canvas, and the iw editor's toolbar sits on the app's ordinary paper ground.
 * Docs: docs/NIGHT_MARKET_TEMPLATE_EDITOR.md, docs/NIGHT_MARKET_TEMPLATE_SANDBOX.md,
 * docs/IMMERSIVE_WORLD.md § 12 phase 1d.
 */

/** Default palette accent (yellow) for ungrouped toggles. */
export const DEFAULT_ACCENT = '255,224,102';

/** Uniform height for every text button floating in a page header. */
const HEADER_BTN_HEIGHT = 32;
/** Uniform edge length for every square icon button in a tool palette. */
const PALETTE_BTN_SIZE = 40;

/**
 * Small corner badge showing a button's keyboard hotkey. Absolutely anchored to the
 * bottom-right of the (position:relative) MUI ButtonBase; multi-char labels ("Space")
 * shrink to fit the 40px button. Non-interactive so it never eats the button's clicks.
 */
export const HotkeyBadge = ({ label }: { label: string }) => (
  <Box
    component="span"
    className="template-editor-hotkey-badge"
    sx={{
      position: 'absolute', bottom: 1, right: 3,
      fontSize: label.length > 1 ? 7 : 9, lineHeight: 1,
      fontWeight: WEIGHT.bold, letterSpacing: '0.02em',
      opacity: 0.9, pointerEvents: 'none',
    }}
  >
    {label}
  </Box>
);

/**
 * The accent-tinted box wrapping one group of palette buttons. Passing no accent gives the
 * neutral (white) group used for view toggles, which is deliberately dimmer than an accent
 * group so an accent still reads as a colour.
 */
export const toolGroupSx = (accent?: string) => ({
  display: 'flex', flexDirection: 'row', flexWrap: 'nowrap' as const, gap: 0.75,
  p: 0.75, borderRadius: 1.5,
  backgroundColor: accent ? `rgba(${accent},0.14)` : 'rgba(255,255,255,0.06)',
  border: `1px solid rgba(${accent ?? '255,255,255'},${accent ? 0.4 : 0.2})`,
});

/**
 * Outlined text-button styling for buttons floating over the dark scene (page headers).
 * Locks the height and forbids label wrapping so a row of these always shares one baseline.
 */
export const headerBtnSx = {
  height: HEADER_BTN_HEIGHT,
  flex: '0 0 auto',
  whiteSpace: 'nowrap',
  boxShadow: 'none',
  borderWidth: 1, borderStyle: 'solid',
  color: 'rgba(255,255,255,0.9)', borderColor: 'rgba(255,255,255,0.5)',
  backgroundColor: 'rgba(0,0,0,0.3)',
  '&:hover': { borderWidth: 1, boxShadow: 'none', borderColor: 'white', backgroundColor: 'rgba(0,0,0,0.5)' },
  '&.Mui-disabled': { color: 'rgba(255,255,255,0.35)', borderColor: 'rgba(255,255,255,0.2)' },
} as const;

/** Header button for a destructive action (Delete Version / Delete Template). */
export const headerBtnDangerSx = {
  ...headerBtnSx,
  color: 'rgba(255,140,140,0.95)', borderColor: 'rgba(255,140,140,0.5)',
  '&:hover': { ...headerBtnSx['&:hover'], borderColor: 'rgb(255,140,140)', backgroundColor: 'rgba(80,0,0,0.4)' },
} as const;

/** Header button for the one primary/confirming action per page (Save). */
export const headerBtnPrimarySx = {
  ...headerBtnSx,
  color: 'black',
  borderColor: `rgba(${DEFAULT_ACCENT},0.95)`,
  backgroundColor: `rgba(${DEFAULT_ACCENT},0.95)`,
  '&:hover': { ...headerBtnSx['&:hover'], borderColor: `rgb(${DEFAULT_ACCENT})`, backgroundColor: `rgb(${DEFAULT_ACCENT})` },
} as const;

/** Row of header buttons — wraps to a new line rather than squeezing its buttons. */
export const headerActionsSx = {
  display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end',
  gap: 1, rowGap: 1, alignItems: 'center',
} as const;

/**
 * The 40×40 square icon button. `accent` is an "r,g,b" triplet colouring the ACTIVE state so a
 * lit button reads as belonging to its group; defaults to the palette yellow for ungrouped
 * toggles. The idle state stays neutral (white-ish border) so groups are distinguished by their
 * panel tint, not by idle button colour.
 *
 * Prefer the `PaletteButton` component below over applying this directly — it also supplies the
 * tooltip wrapper and hotkey badge that make every palette button lay out identically.
 */
export const paletteBtnSx = (active: boolean, accent = DEFAULT_ACCENT) => ({
  // Hard-pinned box: a palette row must overflow, never resize its buttons.
  flex: '0 0 auto',
  width: PALETTE_BTN_SIZE, minWidth: PALETTE_BTN_SIZE, maxWidth: PALETTE_BTN_SIZE,
  height: PALETTE_BTN_SIZE, minHeight: PALETTE_BTN_SIZE, maxHeight: PALETTE_BTN_SIZE,
  p: 0, borderWidth: 1, borderStyle: 'solid', boxShadow: 'none',
  '& .MuiSvgIcon-root': { fontSize: 20 },
  color: active ? 'black' : 'rgba(255,255,255,0.8)',
  borderColor: active ? `rgba(${accent},0.6)` : 'rgba(255,255,255,0.4)',
  backgroundColor: active ? `rgba(${accent},0.95)` : 'rgba(0,0,0,0.35)',
  '&:hover': {
    borderWidth: 1, boxShadow: 'none',
    borderColor: active ? `rgba(${accent},1)` : 'white',
    backgroundColor: active ? `rgba(${accent},1)` : 'rgba(0,0,0,0.55)',
  },
  '&.Mui-disabled': { color: 'rgba(255,255,255,0.3)', borderColor: 'rgba(255,255,255,0.15)', backgroundColor: 'rgba(0,0,0,0.25)' },
});

interface PaletteButtonProps {
  /** Descriptive class name for this specific button (e.g. "template-editor-tool-undo"). */
  className: string;
  /** Tooltip copy — always present; a palette button is icon-only so it needs one. */
  title: NonNullable<ReactNode>;
  /** Tooltip side. Left-edge palettes point up; header toolbars point down. */
  placement?: 'top' | 'bottom';
  /** Single keyboard key badged in the corner. Omit for the few actions with no hotkey. */
  hotkey?: string;
  /** Lit state (a toggle that is on, or the currently-selected tool). */
  active?: boolean;
  /** "r,g,b" triplet tinting the lit state; defaults to the palette yellow. */
  accent?: string;
  disabled?: boolean;
  onClick: () => void;
  /** Extra styling layered over `paletteBtnSx` (e.g. Copy's "clipboard loaded" ring). */
  sx?: SxProps<Theme>;
  /** The icon (or short text) filling the button face. */
  children: ReactNode;
}

/**
 * The single way to render a night-market palette button.
 *
 * Every instance gets the same wrapper `<span>` — required so the tooltip still fires while the
 * button is disabled, and, just as importantly, so that enabling/disabling a button does not
 * change the flex box that lays it out. (Previously only the sometimes-disabled buttons had the
 * span, so a row mixed two different flex items and its buttons shrank inconsistently.)
 */
export const PaletteButton = ({
  className, title, placement = 'top', hotkey, active = false, accent,
  disabled = false, onClick, sx, children,
}: PaletteButtonProps) => (
  <Tooltip title={title} placement={placement}>
    {/* inline-flex + flex:'0 0 auto' so the span is exactly the button's 40×40 and never shrinks */}
    <Box component="span" className={`${className}-wrap`} sx={{ display: 'inline-flex', flex: '0 0 auto' }}>
      <Button
        className={className}
        variant="outlined"
        size="small"
        disabled={disabled}
        onClick={onClick}
        sx={[paletteBtnSx(active, accent), ...(Array.isArray(sx) ? sx : [sx])] as SxProps<Theme>}
      >
        {children}
        {hotkey && <HotkeyBadge label={hotkey} />}
      </Button>
    </Box>
  </Tooltip>
);
