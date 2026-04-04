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

// Original card dimensions — source size used for scaling math.
export const CARD_BASE_WIDTH = 295;
export const CARD_BASE_HEIGHT = 426;

// Tab config — order matches: bt, sct, st, est, et
export const TAB_COLORS = [COLORS.pink, COLORS.green, COLORS.blue, COLORS.orange, COLORS.gray];
export const TAB_LABELS = ["breakdown", "similar", "synonyms", "examples", "literal"];
