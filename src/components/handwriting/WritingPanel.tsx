/**
 * WritingPanel — the one rectangle every focused writing surface draws in:
 *
 *   ┌──────────────────────────┐
 *   │ header (level picker or  │  ← host-supplied (LevelStepper / level label)
 *   │         level label)     │
 *   ├──────────────────────────┤
 *   │                          │
 *   │          canvas          │  ← host-supplied WritingStage, `size` × `size`
 *   │                          │
 *   ├──────────────────────────┤
 *   │ Clear  Undo [assist][Verify]│ ← fixed-height footer (with Verify)
 *   │   Clear   Undo   [assist]  │ ← …centred, evenly spaced (no Verify)
 *   └──────────────────────────┘
 *
 * It also owns the OPEN / CLOSE MORPH: given the element the learner tapped (`origin` —
 * a preview cell, a 2×2 slot, a word tile, a launcher button), the panel starts drawn
 * over that element and grows into place; `collapse()` shrinks it back before the host
 * unmounts it. The canvas region is what lands on the origin (every preview cell renders
 * the same full-size WritingStage scaled down, so the ink lines up at both ends), the
 * header + footer are clipped away at the small end, and `companions` (the host's scrim,
 * hint text) fade alongside. The morph itself is `useProjectionMorph` (shared with
 * WritingSelectorPanel); this component only names the canvas as its anchor.
 *
 * Presentation only: the host owns the guide, clock, ink and grading.
 * Used by: PracticeWritingPopup (single-char panel + focused 2×2 slot),
 * WritingFocusEditor (Writing Grid game, writing flp card) and NotebookCellEditor
 * (Writing Notebook — no header, `tools` footer).
 * Docs: docs/PRACTICE_WRITING.md § "The writing panel".
 */
import { forwardRef, useRef, type ReactNode, type RefObject } from "react";
import { Box, Button } from "@mui/material";
import { DeleteOutline, Undo } from "@mui/icons-material";
import { COLORS } from "../../theme";
import { PANEL_RADIUS, PANEL_SQUARE_TOP_RADIUS, WRITING_PANEL_FOOTER_SX, WRITING_PANEL_HEADER_SX, WRITING_PANEL_SHELL_SX } from "./writingPanelStyles";
import { useProjectionMorph, type CornerRadii, type ProjectionHandle } from "./useProjectionMorph";

/** `collapse()` shrinks the panel back onto its origin (see useProjectionMorph). */
export type WritingPanelHandle = ProjectionHandle;

interface WritingPanelProps {
  /** Canvas edge (px) — the WritingStage's `size`. */
  size: number;
  /** The header band's content. Absent → no header band (the Writing Notebook's canvas). */
  header?: ReactNode;
  /** The WritingStage (or, on the notebook, a bare WritingCanvas over its guide). */
  children: ReactNode;
  /**
   * A footer that REPLACES the default Clear / Undo / assist / Verify row — the Writing
   * Notebook's pen / eraser toggle (docs/WRITING_NOTEBOOK.md § "Canvas"). When given,
   * `onClear` / `onUndo` / `editDisabled` / `assist` / `verify` are ignored.
   */
  tools?: ReactNode;
  onClear?: () => void;
  onUndo?: () => void;
  /** Disables Clear + Undo (no ink, or the clock ran out). */
  editDisabled?: boolean;
  /** The level's assist button (Show / Next / Retry), when the level has one. */
  assist?: ReactNode;
  /**
   * The Verify button, on surfaces that grade in place (the popup's single-character
   * panel). Its presence picks the footer layout: with Verify, Clear / Undo hold the left
   * and assist + Verify the right; without it (tap-out surfaces), the footer's buttons
   * are centred and evenly spaced.
   */
  verify?: ReactNode;
  /** The element the panel grows out of and shrinks back into. */
  origin?: HTMLElement | null;
  /** Host layers (scrim, hint) that fade in / out with the morph. */
  companions?: RefObject<HTMLElement | null>[];
  className?: string;
}

const WritingPanel = forwardRef<WritingPanelHandle, WritingPanelProps>(function WritingPanel(
  { size, header, children, tools, onClear, onUndo, editDisabled = false, assist, verify, origin, companions = [], className },
  ref,
) {
  const panelRef = useRef<HTMLDivElement>(null);
  const canvasBoxRef = useRef<HTMLDivElement>(null);
  // Headerless (the Writing Notebook): the canvas reaches the panel's top edge, and the
  // notebook's cells are sharp squares, so the top two corners are only lightly rounded
  // (PANEL_SQUARE_TOP_RADIUS) — the tools footer keeps the full rounded bottom.
  const squareTop = header === undefined;
  const restRadius: CornerRadii = squareTop ? [PANEL_SQUARE_TOP_RADIUS, PANEL_SQUARE_TOP_RADIUS, PANEL_RADIUS, PANEL_RADIUS] : [PANEL_RADIUS, PANEL_RADIUS, PANEL_RADIUS, PANEL_RADIUS];
  // The canvas region is what lands on the origin; header + footer clip away.
  useProjectionMorph({ ref, panelRef, anchorRef: canvasBoxRef, origin, companions, restRadius });

  const editButtonSx = { color: COLORS.textSecondary, borderRadius: 999, textTransform: "none", minWidth: 0, px: 1.25 } as const;

  return (
    <Box
      ref={panelRef}
      className={`writing-panel${className ? ` ${className}` : ""}`}
      // + the 1px border each side, so the canvas is exactly `size`
      sx={{ ...WRITING_PANEL_SHELL_SX, width: size + 2, ...(squareTop && { borderTopLeftRadius: `${PANEL_SQUARE_TOP_RADIUS}px`, borderTopRightRadius: `${PANEL_SQUARE_TOP_RADIUS}px` }) }}
    >
      {header !== undefined && (
        <Box
          className="writing-panel__header"
          sx={WRITING_PANEL_HEADER_SX}
        >
          {header}
        </Box>
      )}

      <Box ref={canvasBoxRef} className="writing-panel__canvas" sx={{ position: "relative", width: size, height: size }}>
        {children}
      </Box>

      {tools ? (
        <Box className="writing-panel__footer writing-panel__footer--tools" sx={{ ...WRITING_PANEL_FOOTER_SX, justifyContent: "center" }}>
          {tools}
        </Box>
      ) : (
        <Box
          className="writing-panel__footer"
          sx={{
            ...WRITING_PANEL_FOOTER_SX,
            // No Verify: nothing anchors the right edge, so centre the row instead.
            justifyContent: verify ? "flex-start" : "space-evenly",
          }}
        >
          <Button className="writing-panel__clear" startIcon={<DeleteOutline />} disabled={editDisabled} onClick={onClear} sx={editButtonSx}>
            Clear
          </Button>
          <Button className="writing-panel__undo" startIcon={<Undo />} disabled={editDisabled} onClick={onUndo} sx={editButtonSx}>
            Undo
          </Button>
          {verify ? (
            // Right-anchored, so an assist button appearing / vanishing never moves Clear/Undo.
            <Box className="writing-panel__actions" sx={{ ml: "auto", display: "flex", alignItems: "center", gap: 0.75 }}>
              {assist}
              {verify}
            </Box>
          ) : (
            assist
          )}
        </Box>
      )}
    </Box>
  );
});

export default WritingPanel;

/** "Level N · Name" — the header for surfaces where the level is fixed (no picker). */
export function WritingPanelLevelLabel({ level, name, pinyin }: { level: number; name: string; pinyin?: string | null }) {
  return (
    <Box className="writing-panel__level-label" sx={{ display: "flex", alignItems: "baseline", gap: 1, py: 1 }}>
      <Box component="span" className="writing-panel__level" sx={{ fontWeight: 700, color: COLORS.onSurface }}>
        Level {level}
      </Box>
      <Box component="span" className="writing-panel__level-name" sx={{ fontSize: "0.8rem", color: COLORS.textSecondary }}>
        {name}
      </Box>
      {pinyin && (
        <Box component="span" className="writing-panel__pinyin" sx={{ color: COLORS.onSurface }}>
          · {pinyin}
        </Box>
      )}
    </Box>
  );
}
