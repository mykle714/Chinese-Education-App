// Design tokens from Figma
export const COLORS = {
    background: "#F9F7F2",
    header: "#D7D7D4",
    infoCard: "#F5EBE0",
    flashCard: "#D6CCC2",
    border: "#625F63",
    onSurface: "#1D1B20",
    green: "#05C793",
    orange: "#FF8E47",
    pink: "#EF476F",
    blue: "#779BE7",
    gray: "#625F63",
    textSecondary: "#625F63",
    correct: "#05C793",
    incorrect: "#EF476F",
    fireActive: "#E65100",
};

// Controls vertical alignment of content within both card faces (front + back)
export const CARD_FACE_JUSTIFY = 'flex-start';

// Fraction of viewport width the card must be dragged before the color overlay appears
// and the mark is triggered. Single source of truth for both thresholds.
// ~15% of vw → ≈59px on a 393px iPhone frame.
export const CARD_DISMISS_THRESHOLD_VW = 0.15;

// Original card dimensions — source size used for scaling math.
export const CARD_BASE_WIDTH = 295;
export const CARD_BASE_HEIGHT = 426;

// Tab config — order matches: info, bt, est
// "info" consolidates the long definition, HSK level, parts of speech, and the shared-characters list.
// "breakdown" also shows the expansion / literal-translation block (formerly its own "literal" tab).
export const TAB_COLORS = [COLORS.blue, COLORS.pink, COLORS.orange];
export const TAB_LABELS = ["info", "breakdown", "examples"];
// Human-readable function label rendered in each tab's title component.
// Indexed parallel to TAB_LABELS.
export const TAB_FUNCTION_LABELS = ["Overview", "Character Breakdown", "Example Sentences"];

// EIC bottom-sheet snap stops as a fraction of ContentArea height.
// HALF: first stop after FAB tap. FULL: reached by scrolling further.
export const EIC_HALF_RATIO = 0.7;
export const EIC_FULL_RATIO = 0.9;
// Sheet snaps closed if the user drags it below HALF * this ratio on release.
export const EIC_DISMISS_THRESHOLD_RATIO = 0.4;
// Idle gap (ms) between wheel events that splits one wheel "burst" from the next.
// A fresh burst at scrollTop=0 begins to close the sheet, while continuous momentum stops.
export const EIC_WHEEL_BURST_IDLE_MS = 150;
// Min cumulative downward delta (px) of a fresh gesture at scrollTop=0 before the
// sheet starts shrinking. Prevents tiny accidental scrolls from triggering dismiss.
export const EIC_DISMISS_FRESH_GESTURE_DELTA_PX = 20;
