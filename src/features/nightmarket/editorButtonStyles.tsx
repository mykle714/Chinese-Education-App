import { Box } from '@mui/material';
import { WEIGHT } from '../../theme/scale';

/**
 * Shared chrome for the two night-market authoring tools (Template Editor + Template Sandbox)
 * so their toolbars read as one system: the square icon "palette" button, its corner hotkey
 * badge, and the outlined header-button styling used over the dark scene.
 *
 * Referenced by TemplateEditorPage.tsx and TemplateSandboxPage.tsx.
 * Docs: docs/NIGHT_MARKET_TEMPLATE_EDITOR.md, docs/NIGHT_MARKET_TEMPLATE_SANDBOX.md.
 */

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

/** Outlined text-button styling for buttons floating over the dark scene (page headers). */
export const headerBtnSx = {
  color: 'rgba(255,255,255,0.9)', borderColor: 'rgba(255,255,255,0.5)',
  backgroundColor: 'rgba(0,0,0,0.3)',
  '&:hover': { borderColor: 'white', backgroundColor: 'rgba(0,0,0,0.5)' },
  '&.Mui-disabled': { color: 'rgba(255,255,255,0.35)', borderColor: 'rgba(255,255,255,0.2)' },
} as const;

/**
 * The 40×40 square icon button. `accent` is an "r,g,b" triplet colouring the ACTIVE state so a
 * lit button reads as belonging to its group; defaults to the palette yellow for ungrouped
 * toggles. The idle state stays neutral (white-ish border) so groups are distinguished by their
 * panel tint, not by idle button colour.
 */
export const paletteBtnSx = (active: boolean, accent = '255,224,102') => ({
  minWidth: 0, width: 40, height: 40, p: 0,
  color: active ? 'black' : 'rgba(255,255,255,0.8)',
  borderColor: active ? `rgba(${accent},0.6)` : 'rgba(255,255,255,0.4)',
  backgroundColor: active ? `rgba(${accent},0.95)` : 'rgba(0,0,0,0.35)',
  '&:hover': { borderColor: active ? `rgba(${accent},1)` : 'white', backgroundColor: active ? `rgba(${accent},1)` : 'rgba(0,0,0,0.55)' },
  '&.Mui-disabled': { color: 'rgba(255,255,255,0.3)', borderColor: 'rgba(255,255,255,0.15)', backgroundColor: 'rgba(0,0,0,0.25)' },
});
