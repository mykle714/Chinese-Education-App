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

// The mastery mark type a review produces (docs/MASTERY_REWORK.md). In the flp,
// a foreign-first prompt is a recognition review; an English-first prompt is a
// production review.
export type MarkType = 'recognition' | 'production' | 'reading' | 'writing';

export interface MarkCardResult {
    /**
     * The server declined to record the mark because the card's track had not
     * finished cooling down (docs/FLASHCARD_REVIEW_HISTORY_IMPLEMENTATION.md § "Cooldown is a hard next-markable-at"). Nothing was written, so
     * `markTimestamp` is null, `displacedMarks` is empty and there is nothing to undo.
     */
    suppressed: boolean;
    newCard: VocabEntry | null;
    /** Null only when `suppressed` — the one case where no mark exists to undo. */
    markTimestamp: string | null;
    markType: MarkType;
    /** Marks this review pushed out of the 8-slot window, oldest first (0–2). */
    displacedMarks: ReviewMark[];
}

// Per-card randomized choice of which language is shown on Side 1 of the card.
// Side 2 always shows both languages.
export type SideOneLanguage = 'en' | 'zh';

/**
 * The server's key for one written mark — what `POST /api/flashcards/undoLastMark` needs
 * to revert it.
 */
export interface WrittenMarkKey {
    markTimestamp: string;
    displacedMarks: ReviewMark[];
}

/**
 * Everything needed to undo the flp's last swipe. It is taken AT THE SWIPE, not when the
 * mark's reply comes back, so the undo button lights up at once (docs/FLP_CARD_GESTURES.md
 * § "Undo"). The server half of the key arrives later, through `markWritten`.
 *
 * Used by: src/features/flashcards/FlashcardsLearnPage/useWorkingLoop.ts (built in
 * `handleCardDismiss`, consumed by `handleUndoLastMark`), TowerStudyHeader (enables the button).
 */
export interface LastMarkUndoSnapshot {
    /**
     * Set by the undo; read by this swipe's mark reply. A reply landing after the undo
     * must leave the loop alone (no refill patch over the restored card, no wind-down).
     */
    undone: { current: boolean };
    cardId: number;
    markType: MarkType;
    /**
     * Resolves once the mark's reply is in: the key to revert, or null when the server
     * wrote nothing (a suppressed mark, or a request that failed after its retries) —
     * then there is nothing to revert server-side and the undo is local only.
     */
    markWritten: Promise<WrittenMarkKey | null>;
    workingLoop: VocabEntry[];
    currentIndex: number;
    currentSideOneLanguage: SideOneLanguage;
    nextSideOneLanguage: SideOneLanguage;
    /** Whether the undone mark was CORRECT (a right swipe) — the Deck Tower regrows a card only for those. */
    isCorrect: boolean;
}
