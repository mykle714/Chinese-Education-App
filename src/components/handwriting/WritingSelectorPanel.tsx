/**
 * WritingSelectorPanel — the character-selector rectangle a multi-character word opens
 * into, one zoom level above WritingPanel:
 *
 *   word tile ──project──▶ ┌──────────────────────┐
 *                          │  level picker        │  ← header band (as WritingPanel)
 *                          ├──────────────────────┤
 *                          │  ┌────┐  ┌────┐      │
 *                          │  │ 你 │  │ 好 │      │  ← `children`: the 2×2 slot grid (the anchor)
 *                          │  └────┘  └────┘      │
 *                          ├──────────────────────┤
 *                          │              [Verify]│  ← footer band (as WritingPanel)
 *                          └──────────────────────┘
 *                                   │ tap a slot
 *                                   └──project──▶ WritingPanel (the canvas)
 *
 * It grows out of the tapped launcher (`origin`) with the slot grid laid over it —
 * header + footer clipped away — and `collapse()` shrinks it back on close. Same
 * shell, bands, width and motion (`useProjectionMorph`) as WritingPanel, so tile →
 * selector → canvas reads as one object being zoomed into twice.
 *
 * Presentation only: the host (PracticeWritingPopup) owns the slots, ink and grading.
 * Docs: docs/PRACTICE_WRITING.md § "The writing panel".
 */
import { forwardRef, useRef, type ReactNode, type RefObject } from "react";
import { Box } from "@mui/material";
import { PANEL_RADIUS, WRITING_PANEL_FOOTER_SX, WRITING_PANEL_HEADER_SX, WRITING_PANEL_SHELL_SX } from "./writingPanelStyles";
import { useProjectionMorph, type ProjectionHandle } from "./useProjectionMorph";

/** Padding between the panel's bands and the slot grid (px). */
const SELECTOR_BODY_PADDING = 16;

interface WritingSelectorPanelProps {
  /** Inner width (px) — matches the canvas panel's `size`, so the two never jump in width. */
  width: number;
  header: ReactNode;
  /** The slot grid. It is the projection anchor: what lands on the origin. */
  children: ReactNode;
  /** The Verify button, right-anchored in the footer (where the canvas panel keeps it). */
  verify: ReactNode;
  /** The element the selector grows out of and shrinks back into. */
  origin?: HTMLElement | null;
  /** Host layers (the dialog backdrop) that fade in / out with the morph. */
  companions?: RefObject<HTMLElement | null>[];
  className?: string;
}

const WritingSelectorPanel = forwardRef<ProjectionHandle, WritingSelectorPanelProps>(function WritingSelectorPanel(
  { width, header, children, verify, origin, companions = [], className },
  ref,
) {
  const panelRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  useProjectionMorph({ ref, panelRef, anchorRef: gridRef, origin, companions, restRadius: PANEL_RADIUS });

  return (
    <Box
      ref={panelRef}
      className={`writing-selector-panel${className ? ` ${className}` : ""}`}
      sx={{ ...WRITING_PANEL_SHELL_SX, width: width + 2 }}
    >
      <Box className="writing-selector-panel__header" sx={WRITING_PANEL_HEADER_SX}>
        {header}
      </Box>

      <Box
        className="writing-selector-panel__body"
        sx={{ display: "flex", justifyContent: "center", p: `${SELECTOR_BODY_PADDING}px` }}
      >
        {/* Shrink-wrapped, so the anchor is the grid itself and not the padded body. */}
        <Box ref={gridRef} className="writing-selector-panel__grid-anchor" sx={{ display: "inline-flex" }}>
          {children}
        </Box>
      </Box>

      <Box className="writing-selector-panel__footer" sx={{ ...WRITING_PANEL_FOOTER_SX, justifyContent: "flex-end" }}>
        {verify}
      </Box>
    </Box>
  );
});

export default WritingSelectorPanel;
