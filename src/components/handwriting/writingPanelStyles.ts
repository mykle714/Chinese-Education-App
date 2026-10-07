/**
 * writingPanelStyles — the writing rectangle's shared look: shell, header / footer
 * bands and footer action buttons. Shared by WritingPanel (the canvas) and
 * WritingSelectorPanel (the multi-character selector) so the two read as the same
 * object, plus the hosts that build footer buttons (PracticeWritingPopup,
 * WritingFocusEditor). Kept out of WritingPanel.tsx so that file only exports
 * components (fast refresh).
 * Docs: docs/PRACTICE_WRITING.md § "The writing panel".
 */
import { COLORS } from "../../theme";

/** Corner radius of the panel (px). Kept literal: the clip-path keyframes need a px value. */
export const PANEL_RADIUS = 16;
/**
 * The headerless panel's top corners (px) — the Writing Notebook's canvas, which grows
 * out of a sharp copybook cell, so it only softens the corner rather than rounding it.
 */
export const PANEL_SQUARE_TOP_RADIUS = 4;
/** Fixed footer height, so an assist button appearing never resizes the panel. */
export const WRITING_PANEL_FOOTER_HEIGHT = 52;

/** Shared look for the footer's action buttons (assist, Verify) — outlined per the buttons rule. */
export const WRITING_PANEL_ACTION_SX = {
  minWidth: 64,
  height: 36,
  px: 1.5,
  borderRadius: 2.5,
  textTransform: "none",
  border: `1px solid ${COLORS.border}`,
  // Disabled = solid, clearly-visible light grey (not the faint MUI default).
  "&.Mui-disabled": { backgroundColor: COLORS.card, color: COLORS.textSecondary, opacity: 1 },
} as const;

/**
 * The rectangle's shell and its two bands — shared with WritingSelectorPanel so the
 * selector and the canvas panel read as the same object at two zoom levels.
 */
export const WRITING_PANEL_SHELL_SX = {
  position: "relative",
  bgcolor: COLORS.white,
  border: `1px solid ${COLORS.border}`,
  borderRadius: `${PANEL_RADIUS}px`,
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  flexShrink: 0,
  willChange: "transform",
} as const;
export const WRITING_PANEL_HEADER_SX = {
  bgcolor: COLORS.header,
  borderBottom: `1px solid ${COLORS.border}`,
  minHeight: 44,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
} as const;
export const WRITING_PANEL_FOOTER_SX = {
  height: WRITING_PANEL_FOOTER_HEIGHT,
  bgcolor: COLORS.header,
  borderTop: `1px solid ${COLORS.border}`,
  display: "flex",
  alignItems: "center",
  gap: 0.5,
  px: 1,
  boxSizing: "border-box",
} as const;
