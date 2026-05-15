// Semantic indicator colors — theme-invariant (functional, not surface)
export const CORRECT_COLOR   = "#05C793";
export const INCORRECT_COLOR = "#EF476F";
export const FIRE_ACTIVE_COLOR = "#E65100";

// Tab accent colors — decorative, consistent across all themes
const TAB_BLUE   = "#779BE7";
const TAB_ORANGE = "#FF8E47";
const TAB_PINK   = "#EF476F";

// Controls vertical alignment of content within both card faces (front + back)
export const CARD_FACE_JUSTIFY = 'flex-start';

// Fraction of viewport width the card must be dragged before the color overlay appears
// and the mark is triggered. Single source of truth for both thresholds.
// ~15% of vw → ≈59px on a 393px iPhone frame.
export const CARD_DISMISS_THRESHOLD_VW = 0.15;

// Original card dimensions — source size used for scaling math.
export const CARD_BASE_WIDTH = 295;
export const CARD_BASE_HEIGHT = 426;

// Tab config — order matches: definition, examples, breakdown
// "definition" shows the long definition + HSK level + parts of speech (default tab).
// "examples" shows example sentences.
// "breakdown" shows per-character rows + expansion / literal-translation block.
export const TAB_COLORS = [TAB_BLUE, TAB_ORANGE, TAB_PINK];
export const TAB_LABELS = ["definition", "examples", "breakdown"];

// Max sheet height as a fraction of ContentArea height. The sheet at
// translateY=0 occupies this much of the container — i.e. how close the
// "maximized" panel gets to the page header above it.
export const EIC_FULL_RATIO = 0.9;
