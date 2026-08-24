import { COLORS } from "../theme/colors";

/**
 * The shared look of one pill on the word-tools rail (`.wtl b` in `shelf-system.css`;
 * artboards 18–25).
 *
 * Its own module, and not a constant inside `WordToolsRail`, because the rail's two
 * pills are rendered by two different components: `Compare` is the rail's own markup
 * while `Write it` is `PracticeWritingButton` in its `rail` appearance (that component
 * owns the star fetch, the popup and the Writing mark, so it cannot be inlined). With
 * the constant living in `WordToolsRail` the two files import each other in a cycle —
 * harmless as written, but a cycle nobody should have to reason about for a style
 * object. Anything that needs to look like a rail pill imports this.
 */
export const WORD_TOOL_PILL_SX = {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "7px",
    padding: "11px 0",
    borderRadius: "999px",
    backgroundColor: COLORS.white,
    border: `1px solid ${COLORS.border}`,
    fontSize: 12.5,
    fontWeight: 600,
    letterSpacing: "-0.012em",
    color: COLORS.iconColor,
    cursor: "pointer",
    userSelect: "none",
    whiteSpace: "nowrap",
} as const;
