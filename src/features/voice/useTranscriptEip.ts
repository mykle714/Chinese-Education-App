import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { lookupVocabEntry } from "../../api/dictionary";
import { useTTS } from "../../hooks/useTTS";
import { useLearningToggle } from "../../hooks/useLearningToggle";
import { useNotificationFor } from "../../components/notifications/useNotify";
import { useEipTabs } from "../flashcards/FlashcardsLearnPage/useEipTabs";
import type { Language, VocabEntry } from "../../types";

/**
 * Tap a transcript word → its eip (the deip) → Add (docs/VOICE_ASSISTANT.md § 9, "adding cards
 * is UI, not a tool").
 *
 * `openWord(word)` looks the word up (the full det row, as the Dictionary page does) and opens
 * it as the root of an eip. The eip's Learning key for that ROOT word is this hook's own
 * `useLearningToggle`, handed to EipSheet as `sharedLearning`, so the hook can see the moment
 * the learner adds it and call `onAdded(word)` — the live sheet turns that into the socket's
 * `cardAdded`, and the review page ignores it. (A word drilled into from the root runs the
 * eip's own toggle; such adds are not reported live, but the end card's "words added" reads
 * the database, so it still counts them.)
 *
 * The same reach into src/features/flashcards for the eip that src/reading/useReaderWordActions
 * makes (useEipTabs / EipSheet live there; tracked in docs/DEFERRED_WORK.md).
 *
 * Layer: feature hook (src/features/voice). Used by VoiceSessionSheet and VoiceReviewPage.
 */
export function useTranscriptEip(language: Language, onAdded?: (word: string) => void) {
    const tts = useTTS();
    const eip = useEipTabs({ language });
    const [open, setOpen] = useState(false);
    const [root, setRoot] = useState<VocabEntry | null>(null);
    const pendingRef = useRef<string | null>(null);
    const { openForRoot } = eip;

    const learning = useLearningToggle(root, language);
    useNotificationFor(learning.error, learning.clearError, { id: "voice-learning-error", tone: "error", autoHideMs: 2500 });
    const sharedLearning = useMemo(
        () => (root && learning.available ? { entryKey: root.entryKey, state: learning } : null),
        [root, learning],
    );

    // Report an add: the root word was NOT in Learning when loaded and now is.
    const reportedRef = useRef(new Set<string>());
    useEffect(() => {
        if (!root || !onAdded) return;
        if (learning.inLibraryOnLoad === false && learning.inLibrary === true && !reportedRef.current.has(root.entryKey)) {
            reportedRef.current.add(root.entryKey);
            onAdded(root.entryKey);
        }
    }, [root, learning.inLibrary, learning.inLibraryOnLoad, onAdded]);

    const openWord = useCallback(async (word: string) => {
        pendingRef.current = word;
        try {
            const entry = await lookupVocabEntry(word, language);
            if (pendingRef.current !== word) return;
            setRoot(entry);
            openForRoot(entry);
            setOpen(true);
        } catch (err) {
            console.error(`Voice transcript: failed to look up "${word}"`, err);
        } finally {
            if (pendingRef.current === word) pendingRef.current = null;
        }
    }, [language, openForRoot]);

    const close = useCallback(() => setOpen(false), []);

    return { eip, open, openWord, close, sharedLearning, tts };
}
