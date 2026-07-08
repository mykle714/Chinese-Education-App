// Shared color tokens for a card's progress category (FlashcardCategory).
// These match the deck colors used across the app (decks page, discover page).
// Extracted here so MiniVocabCard, VocabCardDetailPage, and the flashcard
// learn-page chip all draw from one source instead of duplicating the map.
export const CATEGORY_COLORS = {
    Unfamiliar: "#EF476F",
    Target: "#FF9E5A",
    Comfortable: "#05C793",
    Mastered: "#779BE7",
    // Fallback for unknown/undefined category.
    default: "#5C5C66",
} as const;

/** Maps a card's progress category to its display color, falling back to a
 *  neutral gray for unknown/undefined categories. */
export const getCategoryColor = (category?: string): string => {
    switch (category) {
        case "Unfamiliar": return CATEGORY_COLORS.Unfamiliar;
        case "Target": return CATEGORY_COLORS.Target;
        case "Comfortable": return CATEGORY_COLORS.Comfortable;
        case "Mastered": return CATEGORY_COLORS.Mastered;
        default: return CATEGORY_COLORS.default;
    }
};
