import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchEnglishDictionaryMatches, type EnglishDictionaryMatch } from "../../api/dictionary";
import type { DictionaryEntry } from "../../types";
import { documentEnglishWords, englishLookupKeys, pickBestEnglishMatch } from "./englishTranslation";

/**
 * useEnglishTranslations — the open document's English words → the Chinese det entry each
 * translates to, for the dictionary keycap (docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "English
 * words").
 *
 * On open (and whenever the saved content's English vocabulary changes) it collects every
 * lookup key of every English word (englishTranslation.ts → `englishLookupKeys`) and makes ONE
 * batch request (`fetchEnglishDictionaryMatches`), so a selection resolves synchronously —
 * paging through English words is as instant as through Chinese ones. `translate(selected)`
 * returns the naive best match across the selection's keys, or null (no match, a grammar
 * word, not English, or the lookup still loading / failed — the keycap then shows its empty
 * face). `translationInLearning(word1)` is that translation's Learning status as of the
 * lookup — the Add key's seed.
 *
 * Chinese documents only (Spanish is paused); other languages never fetch.
 * Keyed on the document's KEY SET, never on the auth token (CLAUDE.md "Never reload on token
 * refresh"): apiPost resolves the Authorization header itself.
 *
 * Layer: feature hook (src/features/reader). Depended on by ReaderDocumentPage, which hands
 * `translate` to useTextSelection.
 */
export function useEnglishTranslations(content: string | undefined, language: string | undefined) {
    // The request's keys as one stable string, so an edit that adds no new English word
    // (or a re-render) doesn't refetch.
    const keySignature = useMemo(() => {
        if (!content || language !== "zh") return "";
        const keys = new Set<string>();
        for (const word of documentEnglishWords(content)) {
            for (const key of englishLookupKeys(word)) keys.add(key);
        }
        return Array.from(keys).sort().join("\n");
    }, [content, language]);

    const [matchesByKey, setMatchesByKey] = useState<ReadonlyMap<string, EnglishDictionaryMatch>>(() => new Map());

    useEffect(() => {
        if (!keySignature || !language) {
            setMatchesByKey(new Map());
            return;
        }
        // A newer document / key set supersedes a response still in flight.
        let cancelled = false;
        fetchEnglishDictionaryMatches(keySignature.split("\n"), language)
            .then((matches) => {
                if (cancelled) return;
                setMatchesByKey(new Map(matches.map((match) => [match.term, match])));
            })
            .catch((err) => {
                // Non-fatal: English words just keep the empty keycap.
                console.error("Reader: English → Chinese lookup failed:", err);
            });
        return () => { cancelled = true; };
    }, [keySignature, language]);

    const translate = useCallback(
        (selectedText: string): DictionaryEntry | null => {
            if (matchesByKey.size === 0) return null;
            return pickBestEnglishMatch(englishLookupKeys(selectedText.trim()), matchesByKey);
        },
        [matchesByKey],
    );

    // The translation's Learning status as of the lookup (the server reads it with the
    // matches), keyed by the det headword. Seeds the keycap's Add key so it is drawn WITH
    // the translated word instead of clipping in when its own status fetch lands;
    // useLearningToggle still fetches and corrects it, and a tap on the key outranks it.
    const learningByWord = useMemo(() => {
        const byWord = new Map<string, boolean>();
        for (const match of matchesByKey.values()) byWord.set(match.entry.word1, match.inLearning);
        return byWord;
    }, [matchesByKey]);
    const translationInLearning = useCallback(
        (word1: string): boolean | undefined => learningByWord.get(word1),
        [learningByWord],
    );

    return useMemo(() => ({ translate, translationInLearning }), [translate, translationInLearning]);
}
