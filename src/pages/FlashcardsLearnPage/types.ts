export type HskLevel = "HSK1" | "HSK2" | "HSK3" | "HSK4" | "HSK5" | "HSK6";

export interface VocabEntry {
    id: number;
    entryKey: string;
    entryValue: string;
    pronunciation?: string | null;
    hskLevelTag?: HskLevel | null;
    breakdown?: Record<string, { definition: string }> | null;
    synonyms?: string[];
    synonymsMetadata?: Record<string, { definition: string; pronunciation: string }> | null;
    expansion?: string | null;
    expansionMetadata?: Record<string, { pronunciation?: string; definition?: string }> | null;
    expansionLiteralTranslation?: string | null;
    exampleSentences?: Array<{
      chinese: string;
      english: string;
      _segments?: string[];
      segmentMetadata?: Record<string, { pronunciation?: string; definition?: string }>;
    }>;
    relatedWords?: Array<{ id: number; entryKey: string; pronunciation: string | null; definition: string | null }>;
    createdAt: string;
}

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

export interface LastMarkUndoSnapshot {
    cardId: number;
    markTimestamp: string;
    displacedMark: ReviewMark | null;
    workingLoop: VocabEntry[];
    currentIndex: number;
    isFlipped: boolean;
    selectedTab: number;
}
