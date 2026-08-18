import type { ChallengeCandidate } from "../../api/studyChallenges";
import type { ChallengeWord, Language } from "../../types";

/**
 * One tile in the challenge review list (docs/STUDY_CHALLENGE.md § 3.2).
 *
 * THE POINT OF THIS TYPE IS THAT BOTH SIDES OF THE FLOW COLLAPSE INTO IT. The
 * challenger reviews `ChallengeCandidate`s (no challenge row exists yet); the
 * challengee reviews the challenge's own stored `ChallengeWord`s. Since the server
 * resolves a stored word's det fields on the way out (`findDisplayFieldsByWords`),
 * the two shapes now carry the same information and one card component draws both.
 *
 * `dictionaryEntryId` stays nullable: a word whose det row has been un-flagged or
 * removed by a data deploy resolves to nothing, and the strike then names it by
 * `word1` instead — which is the handle the challenge stores anyway (Q49).
 */
export interface ChallengeReviewWord {
    word1: string;
    language: Language;
    pronunciation: string | null;
    definition: string | null;
    frequencyScore: number | null;
    iconId: string | null;
    dictionaryEntryId: number | null;
}

/** A candidate — the challenger's initial list, and every replacement — as a tile. */
export function candidateToReviewWord(candidate: ChallengeCandidate): ChallengeReviewWord {
    return {
        word1: candidate.word1,
        language: candidate.language,
        pronunciation: candidate.pronunciation,
        definition: candidate.definition,
        frequencyScore: candidate.frequencyScore,
        iconId: candidate.iconId ?? null,
        dictionaryEntryId: candidate.dictionaryEntryId,
    };
}

/** A stored challenge word, with whatever det fields the read path resolved, as a tile. */
export function storedWordToReviewWord(word: ChallengeWord): ChallengeReviewWord {
    return {
        word1: word.word1,
        language: word.language,
        pronunciation: word.pronunciation ?? null,
        definition: word.definition ?? null,
        frequencyScore: word.frequencyScore ?? null,
        iconId: word.iconId ?? null,
        dictionaryEntryId: word.dictionaryEntryId ?? null,
    };
}
