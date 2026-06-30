import { FONTS } from "../../../theme/fonts";

// Semantic indicator colors — theme-invariant (functional, not surface)
export const CORRECT_COLOR   = "#05C793";
export const INCORRECT_COLOR = "#EF476F";
// (The streak-flame "fire active" color moved to theme/colors.ts → COLORS.fireActive,
// since only MinutePointsFireBadge used it — it was never a flashcard color.)

// Shared font stacks for the learn page. These now alias the app-wide tokens
// (src/theme/fonts.ts) so the learn page and the rest of the app stay in sync.
// FC_FONT — Latin UI text (labels, definitions, chips).
// FC_FONT_CJK — Latin text that may need a CJK fallback glyph (English block).
export const FC_FONT = FONTS.sans;
export const FC_FONT_CJK = FONTS.cjk;

// Card fly-out animation duration. The JS dismiss timeout (FlashcardsLearnPage)
// and the CSS transform transition (FlashCardSection) MUST stay in lock-step,
// so both derive from this single constant. Changing it here changes both.
export const CARD_FLY_OUT_MS = 450;
export const CARD_FLY_OUT_TRANSITION = `transform ${CARD_FLY_OUT_MS}ms ease`;

// The 3D flip (rotateY) uses a LINEAR curve, NOT `ease`, on purpose: the away-facing
// face is hidden (visibility) at the time-midpoint to defeat the mobile
// backface-visibility bug (see CardFaceSide). With `ease`, the card reaches 90°
// (edge-on) well before the time-midpoint, so the rotated-away face's mirrored
// backside would flash between edge-on and the hide. `linear` makes 90° land exactly
// at CARD_FLY_OUT_MS / 2, so the hide fires precisely at edge-on — no flash. Same
// duration as the fly-out so the two stay visually consistent.
export const CARD_FLIP_TRANSITION = `transform ${CARD_FLY_OUT_MS}ms linear`;

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
