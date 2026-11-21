import { useCallback, useMemo, useRef, useState } from "react";
import { lookupVocabEntry } from "../api/dictionary";
import { useTTS } from "../hooks/useTTS";
import { useLearningToggle } from "../hooks/useLearningToggle";
import { useNotificationFor } from "../components/notifications/useNotify";
import { dictionaryEntryToVocabEntry } from "../utils/dictEntryAdapter";
import { useEipTabs } from "../features/flashcards/FlashcardsLearnPage/useEipTabs";
import type { DictionaryEntry, Language } from "../types";

/**
 * The Reader dictionary keycap's three word actions, for the word the caret is on
 * (`selected` = useTextSelection's `selectedDictionaryCard`):
 *
 *   - **Speak** — `useTTS().speak` on the det row adapted to a VocabEntry
 *     (`dictionaryEntryToVocabEntry`); `isSpeaking` drives the speaker's ring.
 *     `autoSpeakSelected` is the tap-to-hear variant (`useTTS().surfaceAutoSpeak`), which
 *     the page gates on its own audio chip (useReaderAudioSettings).
 *   - **More Info** — fetches the full det row (`lookupVocabEntry`, as the Dictionary
 *     page's result tap does — the Reader's cached rows lack breakdown / examples /
 *     usedIn) and opens it as the root of an eip (`useEipTabs` + the page's `EipSheet`).
 *     A later tap supersedes a lookup still in flight.
 *   - **Add ⇄ Added!** — `useLearningToggle` on the same adapted entry, SEEDED from the
 *     document's vocab lookup so the key is there the moment a word is selected (the status
 *     fetch then confirms it); inert (no key) for an undiscoverable word, and while the
 *     read-aloud is running (`suspendLearningStatus`). Failures raise a notification.
 *     The same toggle is shared with the eip (`sharedLearning` → EipSheet), so the eip's
 *     Add key and the keycap's are one state for the selected word.
 *
 * Layer: shared hook (src/reading — the reading engine shared by the Reader and cyoa, docs/CYOA_FEATURE.md § 4). Reaches into src/features/flashcards for the
 * eip (useEipTabs), as the Dictionary page does. Depended on by ReaderDocumentPage.
 * Docs: docs/USER_DOCUMENT_FEATURE_SUMMARY.md § Look (Dictionary keycap).
 */
export function useReaderWordActions(
    selected: DictionaryEntry | null,
    language: Language,
    // Whether `selected` is in the learner's Learning, from the document's vocab lookup
    // (see the page); undefined while that lookup is still running. Seeds the Add key so it
    // is drawn the moment a word is selected (useLearningToggle `seedInLibrary`).
    selectedInLibrary?: boolean,
    // True while the read-aloud is stepping the selection word by word
    // (useReaderReadAloud): the Add key's per-word status fetch would fire ~4×/s, so it
    // stands down (the key is not drawn) until reading stops.
    suspendLearningStatus = false,
) {
    const tts = useTTS();
    const vocabEntry = useMemo(() => (selected ? dictionaryEntryToVocabEntry(selected) : null), [selected]);

    const { speak, surfaceAutoSpeak } = tts;
    const speakSelected = useCallback(() => {
        if (vocabEntry) void speak(vocabEntry);
    }, [speak, vocabEntry]);
    // Tap-to-hear: the same word, spoken automatically — gated by the CALLER on the Reader's
    // own audio chip (useReaderAudioSettings), not on the app-wide autoplay flag.
    const autoSpeakSelected = useCallback(() => {
        if (vocabEntry) void surfaceAutoSpeak(vocabEntry);
    }, [surfaceAutoSpeak, vocabEntry]);

    const eip = useEipTabs({ language });
    const [eipOpen, setEipOpen] = useState(false);
    // ONE Learning toggle for the selected word, live while the eip is open too: the page
    // hands it to the eip (EipSheet `sharedLearning`), which uses it — instead of its own
    // hook — whenever the eip is showing this same word. So a tap on the eip's Add key
    // flips the keycap's key in the background at once, and vice versa; there is no
    // second copy of the word's status to fall out of step. A drilled-into word is a
    // different entry, so the eip runs its own toggle for it.
    // Stands down (no key) while the read-aloud steps the selection.
    const learning = useLearningToggle(suspendLearningStatus ? null : vocabEntry, language, selectedInLibrary);
    useNotificationFor(learning.error, learning.clearError, { id: "reader-learning-error", tone: "error", autoHideMs: 2500 });
    // What the page passes to EipSheet `sharedLearning`; null when there is no live toggle
    // to share (no word, or the read-aloud has it standing down), so the eip uses its own.
    const sharedLearning = useMemo(
        () => (vocabEntry && learning.available ? { entryKey: vocabEntry.entryKey, state: learning } : null),
        [vocabEntry, learning],
    );
    // The word whose lookup is in flight; a later More Info tap supersedes it.
    const pendingLookupRef = useRef<string | null>(null);
    const { openForRoot } = eip;
    const openMoreInfo = useCallback(async () => {
        if (!selected) return;
        const word = selected.word1;
        pendingLookupRef.current = word;
        try {
            const full = await lookupVocabEntry(word, language);
            if (pendingLookupRef.current !== word) return;
            openForRoot(full);
            setEipOpen(true);
        } catch (err) {
            console.error(`Reader: failed to look up "${word}" for the eip:`, err);
        } finally {
            if (pendingLookupRef.current === word) pendingLookupRef.current = null;
        }
    }, [selected, language, openForRoot]);
    const closeEip = useCallback(() => setEipOpen(false), []);

    return {
        tts,
        speakSelected,
        autoSpeakSelected,
        isSpeaking: !!selected && tts.speakingKey === selected.word1,
        learning,
        sharedLearning,
        eip,
        eipOpen,
        openMoreInfo,
        closeEip,
    };
}
