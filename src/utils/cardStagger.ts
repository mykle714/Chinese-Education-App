// Staggered pop-in timing for MiniVocabCard previews (/decks, /flashcards/mastered).
//
// Only the first ANIMATED_CARD_COUNT cards play the entrance animation, each
// offset by CARD_STAGGER_STEP ms to produce a left-to-right cascade. Cards past
// that count render with NO animation (returns undefined → MiniVocabCard skips
// the `cardPopIn` animation entirely). This bounds the animation work: a large
// deck (hundreds of cards on real accounts) would otherwise fire a continuous
// 10s+ cascade that pins the main thread and swallows the first taps.
export const CARD_STAGGER_STEP = 50;
export const ANIMATED_CARD_COUNT = 15;

export const cardStaggerDelayMs = (index: number): number | undefined =>
    index < ANIMATED_CARD_COUNT ? index * CARD_STAGGER_STEP : undefined;
