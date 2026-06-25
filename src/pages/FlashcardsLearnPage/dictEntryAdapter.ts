import type { DictionaryEntry } from "../../types";
import type { VocabEntry, DifficultyLevel, UsedInItem } from "./types";

// Adapts a dictionaryentries-table record (det) returned by
// /api/dictionary/lookup/:term into the VocabEntry shape that
// InfoSheetPanel consumes. Only fields the panel actually reads
// are mapped — the rest stay undefined.
export function dictionaryEntryToVocabEntry(dict: DictionaryEntry): VocabEntry {
    const anyDict = dict as DictionaryEntry & {
        difficulty?: string | null;
        breakdown?: Record<string, { definition: string; pronunciation?: string }> | null;
        exampleSentences?: VocabEntry["exampleSentences"];
        expansion?: string | null;
        expansionSegments?: string[] | null;
        expansionMetadata?: VocabEntry["expansionMetadata"];
        expansionLiteralTranslation?: string | null;
        usedIn?: UsedInItem[] | null;
    };

    return {
        id: dict.id,
        entryKey: dict.word1,
        // Carry the language through so language-gated UI (e.g. the zh-only
        // "Practice Writing Me" button) works on breakdown/dictionary drill-ins.
        language: dict.language,
        pronunciation: dict.pronunciation ?? null,
        definition: dict.definitions?.[0] ?? null,
        longDefinition: dict.longDefinition ?? null,
        longDefinitionParts: dict.longDefinitionParts ?? null,
        partsOfSpeech: dict.partsOfSpeech ?? null,
        vernacularScore: dict.vernacularScore ?? null,
        difficulty: (anyDict.difficulty as DifficultyLevel | null | undefined) ?? null,
        breakdown: anyDict.breakdown
            ? Object.fromEntries(
                Object.entries(anyDict.breakdown).map(([k, v]) => [k, { definition: v.definition }])
            )
            : null,
        exampleSentences: anyDict.exampleSentences ?? undefined,
        expansion: anyDict.expansion ?? null,
        expansionSegments: anyDict.expansionSegments ?? null,
        expansionMetadata: anyDict.expansionMetadata ?? null,
        expansionLiteralTranslation: anyDict.expansionLiteralTranslation ?? null,
        usedIn: anyDict.usedIn ?? null,
        createdAt: dict.createdAt,
    };
}
