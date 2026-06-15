// VocabEntry, UsedInItem and DifficultyLevel are canonical in src/types; re-exported
// here so existing `from "./types"` imports across the flashcards page keep
// working. (FlashcardCategory/ParticleOrClassifierInfo also live in src/types —
// import them from there directly if needed.)
import type { VocabEntry, UsedInItem, DifficultyLevel } from "../../types";
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

export interface MarkCardResult {
    newCard: VocabEntry | null;
    markTimestamp: string;
    displacedMark: ReviewMark | null;
}

// Per-card randomized choice of which language is shown on Side 1 of the card.
// Side 2 always shows both languages.
export type SideOneLanguage = 'en' | 'zh';

export interface LastMarkUndoSnapshot {
    cardId: number;
    markTimestamp: string;
    displacedMark: ReviewMark | null;
    workingLoop: VocabEntry[];
    currentIndex: number;
    isFlipped: boolean;
    currentSideOneLanguage: SideOneLanguage;
    nextSideOneLanguage: SideOneLanguage;
}
