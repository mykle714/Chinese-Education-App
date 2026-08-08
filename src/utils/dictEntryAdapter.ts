import type { DictionaryEntry, VocabEntry, DifficultyLevel, UsedInItem } from "../types";

// Adapts a dictionaryentries-table record (det) returned by
// /api/dictionary/lookup/:term into the VocabEntry shape that
// InfoSheetPanel consumes. Only fields the panel actually reads
// are mapped — the rest stay undefined.
export function dictionaryEntryToVocabEntry(dict: DictionaryEntry): VocabEntry {
    const anyDict = dict as DictionaryEntry & {
        difficulty?: string | null;
        breakdown?: Record<string, { definition: string; pronunciation?: string }> | null;
        exampleSentences?: VocabEntry["exampleSentences"];
        usedIn?: UsedInItem[] | null;
        iconId?: string | null;
    };

    return {
        id: dict.id,
        entryKey: dict.word1,
        // Representative icons8 icon joined from det (selected by dictJoin, absent
        // from the base client type) — lets the read-only dictionary card-detail
        // hero render the det icon in basic (non-advanced) layout.
        iconId: anyDict.iconId ?? null,
        // Carry the language through so language-gated UI (e.g. the zh-only
        // "Practice Writing Me" button) works on breakdown/dictionary drill-ins.
        language: dict.language,
        pronunciation: dict.pronunciation ?? null,
        definition: dict.definitions?.[0] ?? null,
        // Sense clusters + the requester's saved pick for this word (attached by
        // DictionaryController.lookupTerm when they have it as a card). Together these let
        // resolveDisplayDefinition give a drilled-in eip tab the SAME dd the learner sees on
        // their flashcard, instead of det's default sense. Both are absent for words the user
        // has no card for, which falls back to the default sense. See docs/DEFINITION_CLUSTERS.md.
        definitionClusters: dict.definitionClusters ?? null,
        selectedSense: dict.selectedSense ?? null,
        longDefinition: dict.longDefinition ?? null,
        longDefinitionParts: dict.longDefinitionParts ?? null,
        // Every sense's long definition (zh), so the drill-in resolves the same sense as the
        // dd above — carried for the same reason as definitionClusters/selectedSense.
        longDefinitionSenses: dict.longDefinitionSenses ?? null,
        // Entry-level validator-approval flags — carried through so a drilled-in
        // dictionary eip renders the same approved/AI-generated treatment the
        // flashcard does (docs/DATA_VALIDATION_SYSTEM.md).
        definitionsApproved: dict.definitionsApproved ?? false,
        partsOfSpeechApproved: dict.partsOfSpeechApproved ?? false,
        difficultyApproved: dict.difficultyApproved ?? false,
        frequencyScoreApproved: dict.frequencyScoreApproved ?? false,
        // Per-sense commonality approvals — the Commonality chip shows the SELECTED
        // sense's score on a clustered word, so its approved/AI treatment is per label.
        approvedSenseFrequencyLabels: dict.approvedSenseFrequencyLabels ?? [],
        partsOfSpeech: dict.partsOfSpeech ?? null,
        frequencyScore: dict.frequencyScore ?? null,
        difficulty: (anyDict.difficulty as DifficultyLevel | null | undefined) ?? null,
        breakdown: anyDict.breakdown
            ? Object.fromEntries(
                Object.entries(anyDict.breakdown).map(([k, v]) => [k, { definition: v.definition }])
            )
            : null,
        exampleSentences: anyDict.exampleSentences ?? undefined,
        usedIn: anyDict.usedIn ?? null,
        // Carry discoverability so the dictionary EIP can hide the "+ to Learn
        // Now" button for lookup-only (undiscoverable) entries.
        discoverable: dict.discoverable ?? false,
        createdAt: dict.createdAt,
    };
}
