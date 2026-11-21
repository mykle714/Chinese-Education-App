import EipSheet from "../features/flashcards/FlashcardsLearnPage/EipSheet";
import type { useReaderWordActions } from "./useReaderWordActions";

interface ReadingEipHostProps {
    /** The keycap's word actions (useReadingKeycap → `wordActions`). */
    wordActions: ReturnType<typeof useReaderWordActions>;
}

/**
 * ReadingEipHost — the eip behind the reading keycap's More Info key: the word's eip in the
 * Dictionary page's configuration (Synonyms + Related, the word-tools rail, the Learning
 * key). Portals its own scrim + sheet (SheetPanel), so it can be mounted anywhere on the page.
 *
 * ⚠️ LAYERING: EipSheet still lives in src/features/flashcards, so this shared file reaches
 * into a feature (as the Reader did before the move). Tracked in docs/DEFERRED_WORK.md.
 *
 * Layer: shared presentation (src/reading). Rendered by ReaderDocumentPage and StoryPlayPage.
 * Docs: docs/USER_DOCUMENT_FEATURE_SUMMARY.md § Look (Dictionary keycap), docs/CYOA_FEATURE.md § 4.2.
 */
function ReadingEipHost({ wordActions }: ReadingEipHostProps) {
    return (
        <EipSheet
            eip={wordActions.eip}
            open={wordActions.eipOpen}
            onClose={wordActions.closeEip}
            onSpeak={wordActions.tts.speak}
            onSpeakSentence={wordActions.tts.speakSentence}
            speakingKey={wordActions.tts.speakingKey}
            showSynonymsRelated
            showWordTools
            showLearning
            // The keycap's own Learning toggle: while the eip shows the selected word its Add
            // key IS the keycap's, so a tap updates both (useReaderWordActions).
            sharedLearning={wordActions.sharedLearning}
        />
    );
}

export default ReadingEipHost;
