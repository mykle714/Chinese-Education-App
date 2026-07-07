// VocabEntry, UsedInItem and DifficultyLevel are canonical in src/types; re-exported
// here so existing `from "./types"` imports across the flashcards page keep
// working. (FlashcardCategory/ParticleOrClassifierInfo also live in src/types —
// import them from there directly if needed.)
import type { VocabEntry, UsedInItem, DifficultyLevel } from "../../../types";
export type { VocabEntry, UsedInItem, DifficultyLevel };

export interface BreakdownItem {
    character: string;
    pinyin: string;
    definition: string;
}

export interface ReviewMark {
    timestamp: string;
    isCorrect: boolean;
}

// The mastery mark type a review produces (docs/MASTERY_REWORK.md). In the flp,
// a foreign-first prompt is a recognition review; an English-first prompt is a
// production review.
export type MarkType = 'recognition' | 'production' | 'reading' | 'writing';

export interface MarkCardResult {
    newCard: VocabEntry | null;
    markTimestamp: string;
    markType: MarkType;
    displacedMark: ReviewMark | null;
}

// Per-card randomized choice of which language is shown on Side 1 of the card.
// Side 2 always shows both languages.
export type SideOneLanguage = 'en' | 'zh';

export interface LastMarkUndoSnapshot {
    cardId: number;
    markTimestamp: string;
    markType: MarkType;
    displacedMark: ReviewMark | null;
    workingLoop: VocabEntry[];
    currentIndex: number;
    isFlipped: boolean;
    currentSideOneLanguage: SideOneLanguage;
    nextSideOneLanguage: SideOneLanguage;
}
