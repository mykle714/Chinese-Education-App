import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box } from "@mui/material";
import EipAddKey from "../features/flashcards/FlashcardsLearnPage/EipAddKey";
import { EIP_ADD_KEY_SIZES } from "../features/flashcards/FlashcardsLearnPage/eipAddKeySizes";
import type { DictionaryEntry, Language } from "../types";
import ReaderMoreInfoKey from "./ReaderMoreInfoKey";
import ReaderTapHint from "./ReaderTapHint";
import ReaderKeycapPawn from "./ReaderKeycapPawn";
import ReaderSentenceFace from "./ReaderSentenceFace";
import ReaderPhraseSplitFace from "./ReaderPhraseSplitFace";
import { wordsCoveringRange } from "./phraseChunking";
import { pickPhraseWords, type PhraseWord } from "./phrasePick";
import { resolveDisplayPronunciation } from "../utils/definitionUtils";
import type { SegmentSpan } from "./documentSegmentation";
import type { TapZoneFlash, TapZoneSide } from "./ReaderTapOverlay";
import { useReaderWordActions } from "./useReaderWordActions";
import { useReaderAudioPreload } from "./useReaderAudioPreload";
import { findDictionaryMatch } from "./textSelection";
import type { ReadingText } from "./useReadingText";
import { readingOptionsFor, NO_OVERRIDE_LOOKUP, type OverrideLookup, type OverrideTarget } from "./pronunciationOverrides";

// The minimum visible space above, between and below the dictionary keycap's two STACKED
// header controls, px (they otherwise spread evenly from the face's top edge to the divider).
const KEYCAP_ACTIONS_GAP_PX = 6;

interface UseReadingKeycapOptions {
    /** The text the keycap follows right now (useReadingText). */
    text: Pick<ReadingText, "spans" | "selection">;
    /** Its content — the selected sentence is sliced from it (Sentence Explain). */
    content: string;
    /**
     * Which text `text` is, when a page reads several (cyoa: "passage" / the inspected
     * choice's id). A switch is not a move: tap-to-hear stays quiet across it, so leaving
     * inspect mode does not speak the passage word it restores.
     */
    activeKey?: string;
    language: Language;
    /** The vocabulary the words resolve against, and whether its lookup is still running. */
    dictionaryCards: DictionaryEntry[];
    vocabLoading: boolean;
    /** useEnglishTranslations: an English word's Chinese entry, and its Learning status. */
    translateEnglish: (selectedText: string) => DictionaryEntry | null;
    translationInLearning: (word1: string) => boolean | undefined;
    /** Tap-to-hear is on (useReaderAudioSettings → `autoplay`: the chip on default / media). */
    autoplay: boolean;
    /** The Reader's read-aloud is stepping the selection (it is already speaking). */
    readAloudPlaying?: boolean;
    /** The text is being edited: no tap-to-hear, no preloading. */
    editing?: boolean;
    /** Extra moments tap-to-hear must stay quiet (the Reader: the search field has focus). */
    isQuiet?: () => boolean;
    /**
     * READING CHOICES (usePronunciationOverrides; docs/USER_DOCUMENT_FEATURE_SUMMARY.md
     * § "Reading choices"). Given, a tap on the headword of a word with several readings
     * cycles the selected occurrence's reading, and the headword, speaker, tap-to-hear and
     * preloading all use the chosen one. Omitted (cyoa), the headword only copies.
     */
    readingChoices?: {
        lookup: OverrideLookup;
        cycle: (target: OverrideTarget, entry: DictionaryEntry | null | undefined) => boolean;
    };
}

/**
 * useReadingKeycap — the reading engine's DICTIONARY KEYCAP (the rdb) for the text being
 * read: everything VocabDisplayCard is handed, plus the word actions behind its keys.
 *
 *   • the face — the selected word's det entry; the tap-to-navigate demo while nothing is
 *     selected (ReaderTapHint, its finger demo played only the first time); a resting pawn
 *     for a word with no entry (ReaderKeycapPawn); the Sentence Explain face while a whole
 *     sentence is selected (ReaderSentenceFace); the SPLIT-SCREEN face while a phrase of two
 *     or more words is selected (ReaderPhraseSplitFace — the two words phrasePick.ts keeps);
 *   • the keys — speaker, Add ⇄ Added! (EipAddKey, seeded from the vocabulary lookup) and
 *     More Info → the eip (useReaderWordActions; mount the sheet with ReadingEipHost);
 *   • TAP-TO-HEAR — moving the selection to a new word speaks it while `autoplay` is on (a
 *     selected phrase speaks the WHOLE phrase — owner's call 2026-11-23),
 *     and PRELOADING of the next words' clips (useReaderAudioPreload);
 *   • ZONE FLASH — the demo's zone taps, for the page's ReaderTapOverlay (`tapZoneFlash`);
 *   • READING CHOICES — with `readingChoices`, a tap on the headword of a word with several
 *     readings cycles the selected occurrence's reading (one reading → tap-to-copy), and
 *     the headword, speaker, tap-to-hear and preloading use the chosen reading.
 *
 * Lifted unchanged out of ReaderDocumentPage (2026-11-21) so the cyoa play page shows the
 * same rdb (docs/CYOA_FEATURE.md § 4). The page's stand-downs come in as options
 * (`readAloudPlaying` — both pages; `editing`, `isQuiet` — the Reader only).
 *
 * Layer: shared client state + presentation glue (src/reading). Depended on by
 * src/features/reader/ReaderDocumentPage.tsx, src/features/cyoa/StoryPlayPage.tsx.
 * Docs: docs/USER_DOCUMENT_FEATURE_SUMMARY.md § Look (Dictionary keycap), § Tap-to-hear,
 * § Sentence Explain; docs/CYOA_FEATURE.md § 3.1, § 4.2.
 */
export function useReadingKeycap({
    text,
    content,
    activeKey = "",
    language,
    dictionaryCards,
    vocabLoading,
    translateEnglish,
    translationInLearning,
    autoplay,
    readAloudPlaying = false,
    editing = false,
    isQuiet,
    readingChoices,
}: UseReadingKeycapOptions) {
    const { selection, spans } = text;
    const readingLookup = readingChoices?.lookup ?? NO_OVERRIDE_LOOKUP;

    // The tap-to-navigate hint lives IN the dictionary keycap while nothing is selected
    // (NOTHING-SELECTED MODE, useTextSelection) — it replaced the 5 s `reader-tap-hint`
    // app notification (2026-11-17), so it stays up exactly as long as it is useful.
    const showNavigationHint = selection.awaitingFirstSelection;
    // Tapping the demo flashes the matching REAL zone over the reading box
    // (ReaderTapOverlay → ZONE FLASH); the bumped id replays it on a repeat tap. Cleared
    // once it has played (`clearTapZoneFlash`): an overlay that unmounts and remounts
    // (Reader edit mode) would otherwise flash again.
    const [tapZoneFlash, setTapZoneFlash] = useState<TapZoneFlash | null>(null);
    const flashTapZone = useCallback((side: TapZoneSide) => {
        setTapZoneFlash((prev) => ({ side, id: (prev?.id ?? 0) + 1 }));
    }, []);
    const clearTapZoneFlash = useCallback(() => setTapZoneFlash(null), []);
    // The finger demo plays only the FIRST time the hint shows on this page. A long-press
    // on empty space brings the hint back (ReaderTapOverlay → `onClearSelection`), and
    // there it appears at rest (owner's call 2026-11-17).
    const [tapDemoPlayed, setTapDemoPlayed] = useState(false);
    useEffect(() => {
        if (!showNavigationHint) setTapDemoPlayed(true);
    }, [showNavigationHint]);
    // Faces are built once — VocabDisplayCard's memo compares them by identity.
    const navigationHint = useMemo(
        () => <ReaderTapHint onZoneTap={flashTapZone} playDemo={!tapDemoPlayed} />,
        [flashTapZone, tapDemoPlayed]
    );
    const keycapEmptyFace = useMemo(() => <ReaderKeycapPawn />, []);
    // SENTENCE MODE (docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "Sentence Explain"): while a
    // whole sentence is highlighted the face becomes the sentence face — the Explain key and
    // its AI answer. Memoised on the sentence text, so the card only sees a new face for a
    // new sentence.
    const selectedSentence = selection.selectedSentence;
    const selectedSentenceText = selectedSentence ? content.slice(selectedSentence.start, selectedSentence.end) : null;
    const sentenceFace = useMemo(
        () => (selectedSentenceText ? <ReaderSentenceFace sentence={selectedSentenceText} language={language} /> : undefined),
        [selectedSentenceText, language]
    );

    // PHRASE (docs/READER_SEGMENTATION.md § "Phrase stepping"): a selection that is exactly a
    // run of two or more whole gsa words — what a forward tap selects with the Phrase pill on,
    // or a search match across words — has no det row of its own. The keycap splits instead:
    // two compact entries, the words phrasePick.ts keeps. Not in SENTENCE MODE (the sentence
    // face owns the keycap there). Each word resolves exactly as a lone word would: its det
    // row, else (an English word) the Chinese entry it translates to.
    const { start: rangeStart, end: rangeEnd } = selection.selectionRange;
    const phraseWords = useMemo<PhraseWord[] | null>(() => {
        if (selectedSentence) return null;
        const words = wordsCoveringRange(spans, rangeStart, rangeEnd);
        if (!words || words.length < 2) return null;
        return words.map((span) => ({
            span,
            entry: findDictionaryMatch(span.text, dictionaryCards) ?? translateEnglish(span.text),
        }));
    }, [selectedSentence, spans, rangeStart, rangeEnd, dictionaryCards, translateEnglish]);
    // A tap on a half selects that word in the text — the same narrowing as tapping it there.
    const { selectRange } = selection;
    const selectPhraseWord = useCallback((span: SegmentSpan) => selectRange(span.start, span.end), [selectRange]);
    const splitFace = useMemo(
        () => (phraseWords
            ? <ReaderPhraseSplitFace words={pickPhraseWords(phraseWords)} language={language} onSelectWord={selectPhraseWord} />
            : undefined),
        [phraseWords, language, selectPhraseWord]
    );
    // The whole phrase for tap-to-hear: its text, and its reading when every word has one.
    const phraseSpeech = useMemo(() => {
        if (!phraseWords) return null;
        // Each word's chosen reading (READING CHOICES), else its default.
        const readings = phraseWords.map((word) => (
            word.entry ? readingLookup(word.span) ?? resolveDisplayPronunciation(word.entry) : null
        ));
        const text = content.slice(rangeStart, rangeEnd);
        return { text, pronunciation: readings.every(Boolean) ? readings.join(" ") : undefined };
    }, [phraseWords, content, rangeStart, rangeEnd, readingLookup]);

    // The Add key's seed: the vocabulary lookup returns exactly the learner's Learning cards
    // among the text's words, so a selected word with a matching personal card is "Added!"
    // and one without is "Add" — known with no fetch. Undefined until that lookup has
    // finished (useLearningToggle then waits for its own). An English word's translation is
    // usually not among the loaded cards, so a miss there proves nothing: its seed comes from
    // the English lookup itself (useEnglishTranslations → translationInLearning).
    const selectedDict = selection.selectedDictionaryCard;

    // READING CHOICES: the selected occurrence, when it is exactly one gsa word of the
    // text's own script (not an English word showing its translation, not a drilled-into
    // part of a word — neither has a reading of its own to switch). `selectedReading` is
    // its chosen reading (toned), undefined = the default.
    const selectedTarget = useMemo<OverrideTarget | null>(() => {
        if (!readingChoices || !selectedDict || selection.selectedByTranslation || rangeEnd <= rangeStart) return null;
        const span = spans.find((s) => s.start === rangeStart && s.end === rangeEnd);
        return span ? { start: span.start, end: span.end, text: span.text } : null;
    }, [readingChoices, selectedDict, selection.selectedByTranslation, spans, rangeStart, rangeEnd]);
    const selectedReading = selectedTarget ? readingLookup(selectedTarget) : undefined;
    // Several readings → the headword cycles them; one → it keeps tap-to-copy (owner's
    // call 2026-11-23).
    const canCycleReading = !!selectedTarget && readingOptionsFor(selectedDict).length > 1;
    const cycleReading = readingChoices?.cycle;
    const handleHeadwordTap = useCallback(() => {
        if (selectedTarget && cycleReading) cycleReading(selectedTarget, selectedDict);
    }, [selectedTarget, cycleReading, selectedDict]);
    const selectedInLibrary = !selectedDict
        ? undefined
        : selection.selectedByTranslation && !selection.selectedPersonalCard
            ? translationInLearning(selectedDict.word1)
            : vocabLoading
                ? undefined
                : selection.selectedPersonalCard?.entryKey === selectedDict.word1;
    // The read-aloud selects a new word ~4×/s; the Add key's per-word status fetch stands
    // down until it stops (the key reappears on the word it stopped on).
    const wordActions = useReaderWordActions(selectedDict, language, selectedInLibrary, readAloudPlaying, selectedReading);
    const { openMoreInfo, learning: keycapLearning } = wordActions;

    // TAP-TO-HEAR (docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "Tap-to-hear"): moving the
    // selection to a NEW word speaks it, as if the keycap's speaker were pressed (an English
    // word speaks its Chinese translation — the keycap's word).
    //
    // Keyed on the selection RANGE only, so it fires on a move and never on a re-render: the
    // blur → refocus loop and leaving the eip restore the same range (no change), and a text
    // opens with nothing selected, so the first sound is the learner's first tap. Toggling
    // the audio setting speaks nothing (it is not in the deps) — the app-wide rule that
    // changing an audio mode never makes a sound (useTTS → wasAutoplayOnRef). A switch of
    // ACTIVE text (`activeKey`) is not a move either. The latest values are read through a
    // ref so they need not be deps.
    // A phrase speaks as one clip (useTTS → surfaceAutoSpeakText), not word by word.
    const { surfaceAutoSpeakText } = wordActions.tts;
    const speakSelection = phraseSpeech
        ? () => { void surfaceAutoSpeakText(phraseSpeech.text, phraseSpeech.pronunciation); }
        : wordActions.autoSpeakSelected;
    const tapToHearRef = useRef({ autoplay, readAloudPlaying, editing, isQuiet, speak: speakSelection });
    tapToHearRef.current = { autoplay, readAloudPlaying, editing, isQuiet, speak: speakSelection };
    const { start: selectionStart, end: selectionEnd } = selection.selectionRange;
    const lastActiveKeyRef = useRef(activeKey);
    useEffect(() => {
        const switched = lastActiveKeyRef.current !== activeKey;
        lastActiveKeyRef.current = activeKey;
        if (switched || selectionStart === selectionEnd) return;
        const current = tapToHearRef.current;
        if (!current.autoplay || current.readAloudPlaying || current.editing || current.isQuiet?.()) return;
        current.speak();
    }, [selectionStart, selectionEnd, activeKey]);
    // PRELOADING for tap-to-hear (useReaderAudioPreload): the server synthesizes the text's
    // words on open, and each move fetches the next few words into the browser. A span
    // resolves to the keycap's word exactly as useTextSelection does: its det row, else (an
    // English word) the Chinese entry it translates to.
    const resolveKeycapEntry = useCallback(
        (spanText: string) => findDictionaryMatch(spanText, dictionaryCards) ?? translateEnglish(spanText),
        [dictionaryCards, translateEnglish],
    );
    useReaderAudioPreload({
        enabled: autoplay && !editing,
        language,
        spans,
        resolveEntry: resolveKeycapEntry,
        selectionStart,
        readAloudPlaying,
        prefetch: wordActions.tts.prefetch,
        prefetchText: wordActions.tts.prefetchSentence,
        readingAt: readingLookup,
    });
    // Muting stops a tapped word mid-clip, edge-triggered so a speaker press while muted is
    // not cut off (useTTS does the same for the app-wide chip).
    const wasAutoplayRef = useRef(autoplay);
    const cancelSpeech = wordActions.tts.cancel;
    useEffect(() => {
        if (wasAutoplayRef.current && !autoplay) cancelSpeech();
        wasAutoplayRef.current = autoplay;
    }, [autoplay, cancelSpeech]);

    // The keycap's right-edge controls: the eip's Add ⇄ Added! key and the More Info keycap
    // (the flp's, arrowless) — side by side with More Info rightmost, or both in their
    // compact size when the keycap stacks them under a long headword (VocabDisplayCard →
    // ACTION LAYOUT). A word already in Learning shows "Added!", and a tap removes it (the
    // full toggle, not the flp's add-only key); EipAddKey renders nothing for an
    // undiscoverable word or while its status loads. Memoised: the card compares it by identity.
    const renderKeycapActions = useCallback((stacked: boolean) => {
        const size = stacked ? 'compact' : 'regular';
        const moreInfo = <ReaderMoreInfoKey size={size} onClick={() => { void openMoreInfo(); }} />;
        const addKey = <EipAddKey state={keycapLearning} size={size} />;
        // Side by side: Add, then More Info at the far right (owner's call 2026-11-17).
        if (!stacked) return <>{addKey}{moreInfo}</>;
        // Stacked: More Info on top, over Add, spread EVENLY over the column VocabDisplayCard
        // gives them (face top edge → divider): equal space above, between and below. Three
        // equal flex spacers do the spreading, each with a KEYCAP_ACTIONS_GAP_PX floor; not
        // `space-evenly` + `gap`, which adds the gap to the middle space only.
        // Each key's margin box is set to its DRAWN extent: lifted `restAddY` (−1px) above
        // its box, and its lip hanging lip + restAddY (4 − 1 = 3px) below it
        // (EIP_ADD_KEY_SIZES.compact), so the spaces are even to the eye, not to the boxes.
        const compact = EIP_ADD_KEY_SIZES.compact;
        const addKeyDrawn = keycapLearning.available && keycapLearning.inLibrary !== undefined;
        const spacer = (key: string) => (
            <Box key={key} className="reader-keycap__actions-stack-spacer" sx={{ flex: '1 1 0', minHeight: `${KEYCAP_ACTIONS_GAP_PX}px` }} />
        );
        return (
            <Box
                className="reader-keycap__actions-stack"
                sx={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-end',
                    '& > :not(.reader-keycap__actions-stack-spacer)': {
                        mt: `${-compact.restAddY}px`,
                        mb: `${compact.lipAdd + compact.restAddY}px`,
                    },
                }}
            >
                {spacer('above')}
                {moreInfo}
                {/* EipAddKey draws nothing for an undiscoverable word or while its status
                    loads; drop its spacer too so More Info stays centred alone. */}
                {addKeyDrawn && spacer('between')}
                {addKeyDrawn && addKey}
                {spacer('below')}
            </Box>
        );
    }, [openMoreInfo, keycapLearning]);

    /** Spread onto VocabDisplayCard. */
    const cardProps = {
        dictionaryEntry: selectedDict,
        idleHint: showNavigationHint ? navigationHint : null,
        emptyFace: keycapEmptyFace,
        customFace: sentenceFace ?? splitFace,
        // The chosen reading, and the tap that changes it (absent → tap-to-copy).
        headwordPronunciation: selectedReading,
        onHeadwordTap: canCycleReading ? handleHeadwordTap : undefined,
        onSpeak: wordActions.speakSelected,
        isSpeaking: wordActions.isSpeaking,
        renderHeaderActions: renderKeycapActions,
    };

    return { wordActions, cardProps, tapZoneFlash, clearTapZoneFlash };
}
