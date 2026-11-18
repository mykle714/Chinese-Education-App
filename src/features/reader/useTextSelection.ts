import { useState, useCallback, useRef } from "react";
import { findExactMatch, findDictionaryMatch, getSelectedText } from "./textSelection";
import { spanContaining, type SegmentSpan } from "./documentSegmentation";
import type { VocabEntry, DictionaryEntry } from "../../types";

interface UseTextSelectionReturn {
    selectedPersonalCard: VocabEntry | null;
    selectedDictionaryCard: DictionaryEntry | null;
    setSelectedPersonalCard: React.Dispatch<React.SetStateAction<VocabEntry | null>>;
    setSelectedDictionaryCard: React.Dispatch<React.SetStateAction<DictionaryEntry | null>>;
    handleTextChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
    handleTextSelectionChange: (event?: React.SyntheticEvent<HTMLDivElement>) => void;
    handleAutoWordSelect: (event?: React.SyntheticEvent<HTMLDivElement>) => void;
    // Focus management: the reading box should always hold focus so word
    // navigation/selection stays live.
    inputRef: React.RefObject<HTMLTextAreaElement | null>;
    focusTextArea: (restoreSelection?: boolean) => void;
    handleTextAreaBlur: React.FocusEventHandler<HTMLInputElement | HTMLTextAreaElement>;
    // NOTHING-SELECTED MODE (see `awaitingFirstSelection` below). True from mount
    // until the learner's first word selection, and again after `clearSelection`.
    awaitingFirstSelection: boolean;
    // Call on a real learner gesture in the reading box (key press, pointer down) —
    // it is what lets selection logic run while `awaitingFirstSelection` holds.
    noteUserInteraction: () => void;
    // The reading box's last recorded caret/selection, as STATE (lastSelectionRef's
    // reactive twin). The Pinyin display mode (ReaderCpcdView) paints its own highlight
    // from this, since its textarea is invisible. Collapsed (start === end) = no word.
    selectionRange: { start: number; end: number };
    // Select [start, end) in the reading box as if the learner had placed it there —
    // the Pinyin view's desktop click-on-a-word. Counts as a learner gesture.
    selectRange: (start: number, end: number) => void;
    // Select the gsa word containing the character at `offset` (ReaderTapOverlay's
    // text-mode WORD JUMP). Returns that span's start, or null when the offset is in no
    // word (whitespace / punctuation), in which case nothing changes.
    selectSpanAtOffset: (offset: number) => number | null;
    // Back to NOTHING-SELECTED MODE (a long-press on empty space — ReaderTapOverlay):
    // drop the highlight and the keycap's entry, and park the caret at `caretOffset`
    // (default: where the old selection began) so the next forward tap steps on from there.
    clearSelection: (caretOffset?: number) => void;
    // True when `selectedDictionaryCard` came from the English → Chinese lookup (the
    // selection is an English word), so `selectedPersonalCard` is only the translation's
    // card if the document's vocab lookup happened to load it — the page then lets the Add
    // key fetch its own status instead of trusting a miss.
    selectedByTranslation: boolean;
}

export function useTextSelection(
    loadedPersonalCards: VocabEntry[],
    loadedDictionaryCards: DictionaryEntry[],
    autoSelectEnabled: boolean,
    // GSA word spans for the current document (docs/READER_SEGMENTATION.md) —
    // drives auto word selection so a tapped caret expands to a dictionary word.
    segmentSpans: SegmentSpan[],
    // The English → Chinese fallback (useEnglishTranslations): a selection with no det row
    // of its own that is an English word resolves to the Chinese entry it translates to.
    translateEnglish?: (selectedText: string) => DictionaryEntry | null,
): UseTextSelectionReturn {
    // Text selection card state
    const [selectedPersonalCard, setSelectedPersonalCard] = useState<VocabEntry | null>(null);
    const [selectedDictionaryCard, setSelectedDictionaryCard] = useState<DictionaryEntry | null>(null);
    const [selectedByTranslation, setSelectedByTranslation] = useState(false);

    // Live handle to the underlying <textarea> (forwarded via MUI TextField's
    // inputRef). Used for both focus management and reading the caret/selection,
    // replacing the previous querySelector('textarea') lookups.
    const inputRef = useRef<HTMLTextAreaElement | null>(null);

    // The most recent caret/selection range, persisted so we can restore the
    // user's place whenever focus returns to the reading box.
    const lastSelectionRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
    // Reactive copy for the Pinyin view's highlight (see `selectionRange` above). Only
    // set when the range actually changes, so the frequent `select` events that land
    // on the same word cost no re-render.
    const [selectionRange, setSelectionRangeState] = useState<{ start: number; end: number }>({ start: 0, end: 0 });

    // ── NOTHING-SELECTED MODE ──────────────────────────────────────────────
    // A document opens with NO word highlighted (owner's call 2026-11-17; it used to
    // auto-highlight the first word): the caret is parked at the top and the
    // dictionary keycap shows the how-to-navigate hint instead of an entry.
    //
    // The mode ends on the first selection the LEARNER makes (a tap / arrow / click
    // that lands on a word). It comes back only through `clearSelection` (a long-press
    // on empty space — ReaderTapOverlay) or a remount (leaving the document and coming back).
    //
    // Why a separate interaction flag: focusing the box fires `select` on its own
    // (programmatic focus, the blur→refocus loop, leaving edit mode), and auto
    // word-select would expand the parked caret at 0 into the first word — ending
    // the mode with no learner action. So until the learner has touched the box,
    // auto-select and the card lookup stand down. A gesture that selects nothing
    // (a back-tap at the very top, a click in whitespace) keeps the mode.
    const [awaitingFirstSelection, setAwaitingFirstSelection] = useState(true);
    const awaitingFirstSelectionRef = useRef(true);
    const userHasInteractedRef = useRef(false);
    const noteUserInteraction = useCallback(() => {
        userHasInteractedRef.current = true;
    }, []);
    // True while selection work must be skipped: still in the mode and the learner
    // has not touched the box yet.
    const isPassiveWhileAwaiting = useCallback(
        () => awaitingFirstSelectionRef.current && !userHasInteractedRef.current,
        []
    );

    // Handle text change - prevent modifications while maintaining cursor functionality
    const handleTextChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        // Prevent any changes to the text content
        event.preventDefault();
        return false;
    }, []);

    // Handle text selection changes for vocabulary card lookup
    const handleTextSelectionChange = useCallback(() => {
        const textarea = inputRef.current;
        if (!textarea) return;
        if (isPassiveWhileAwaiting()) return;

        // Persist the live caret/selection so focus restoration returns the user
        // to their place (this fires after handleAutoWordSelect, so it captures
        // the auto-selected word range when auto-select is enabled).
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        lastSelectionRef.current = { start, end };
        setSelectionRangeState(prev => (prev.start === start && prev.end === end ? prev : { start, end }));

        // Get the currently selected text
        const selectedTextContent = getSelectedText(textarea);

        // Find matching cards in both personal and dictionary
        let matchingPersonalCard = findExactMatch(selectedTextContent, loadedPersonalCards);
        let matchingDictionaryCard = findDictionaryMatch(selectedTextContent, loadedDictionaryCards);

        // No det row of its own → maybe an English word: show the Chinese entry it
        // translates to, exactly as if that word were highlighted (owner's call 2026-11-17:
        // no marker). Its personal card is the TRANSLATION's (keyed by the Chinese word).
        let byTranslation = false;
        if (!matchingDictionaryCard && translateEnglish && selectedTextContent) {
            const translated = translateEnglish(selectedTextContent);
            if (translated) {
                matchingDictionaryCard = translated;
                matchingPersonalCard = findExactMatch(translated.word1, loadedPersonalCards);
                byTranslation = true;
            }
        }

        // Update the selected card states
        setSelectedPersonalCard(matchingPersonalCard);
        setSelectedDictionaryCard(matchingDictionaryCard);
        setSelectedByTranslation(byTranslation);

        // The learner's first real selection ends NOTHING-SELECTED MODE, for good.
        if (awaitingFirstSelectionRef.current && selectedTextContent.length > 0) {
            awaitingFirstSelectionRef.current = false;
            setAwaitingFirstSelection(false);
        }
    }, [loadedPersonalCards, loadedDictionaryCards, isPassiveWhileAwaiting, translateEnglish]);

    // Auto word selection: expand a tapped/placed caret to the gsa word span
    // containing it (docs/READER_SEGMENTATION.md). Replaces the old pairwise
    // isWordBoundary character scan — spans are precomputed per document, so a
    // caret in whitespace/punctuation (no span) simply selects nothing.
    const handleAutoWordSelect = useCallback(() => {
        if (!autoSelectEnabled) return;
        // NOTHING-SELECTED MODE: a focus-driven `select` must not grow the parked caret
        // into the first word.
        if (isPassiveWhileAwaiting()) return;

        // The underlying textarea, forwarded via inputRef
        const textarea = inputRef.current;
        if (!textarea) return;

        // Only auto-select if no text is currently selected (just cursor placement);
        // a real drag-selection must not be clobbered.
        const cursorStart = textarea.selectionStart;
        if (cursorStart !== textarea.selectionEnd) return;

        const span = spanContaining(segmentSpans, cursorStart);
        if (span) {
            textarea.setSelectionRange(span.start, span.end);
        }
    }, [autoSelectEnabled, segmentSpans, isPassiveWhileAwaiting]);

    // Focus the reading box. By default we restore the last saved selection;
    // pass restoreSelection=false on a fresh document to park the caret at the top.
    //
    // After focusing we re-run the auto-highlighter so a word is always selected
    // (when auto-select is on): if the restored range is a collapsed caret,
    // handleAutoWordSelect expands it to the word at that position; if it's
    // already a word range it's left intact. handleTextSelectionChange then
    // persists the resulting range and refreshes the vocab card. Programmatic
    // setSelectionRange doesn't reliably fire the textarea's `select` event, so
    // these must be invoked explicitly rather than relied upon to fire. An empty
    // document yields no word (handleAutoWordSelect bails on empty content).
    // While NOTHING-SELECTED MODE holds (before the learner's first gesture) both
    // calls stand down, so focusing only parks the caret and highlights nothing.
    const focusTextArea = useCallback((restoreSelection = true) => {
        const textarea = inputRef.current;
        if (!textarea) return;

        textarea.focus();

        if (restoreSelection) {
            const { start, end } = lastSelectionRef.current;
            textarea.setSelectionRange(start, end);
        } else {
            lastSelectionRef.current = { start: 0, end: 0 };
            textarea.setSelectionRange(0, 0);
        }

        handleAutoWordSelect();
        handleTextSelectionChange();
    }, [handleAutoWordSelect, handleTextSelectionChange]);

    // Programmatic selection on the learner's behalf (Pinyin view, desktop click). The
    // range is already a whole gsa span, so auto word-select has nothing to expand;
    // only the card lookup + bookkeeping run.
    const selectRange = useCallback((start: number, end: number) => {
        const textarea = inputRef.current;
        if (!textarea) return;
        userHasInteractedRef.current = true;
        if (document.activeElement !== textarea) textarea.focus({ preventScroll: true });
        textarea.setSelectionRange(start, end);
        handleTextSelectionChange();
    }, [handleTextSelectionChange]);

    // Select the word under a long-press in the text display mode (ReaderTapOverlay →
    // WORD JUMP). The caller resolves the screen point to a character offset.
    const selectSpanAtOffset = useCallback((offset: number): number | null => {
        const span = spanContaining(segmentSpans, offset);
        if (!span) return null;
        selectRange(span.start, span.end);
        return span.start;
    }, [segmentSpans, selectRange]);

    // Return to NOTHING-SELECTED MODE. The interaction flag is reset too, so the
    // focus-driven `select` events (blur → refocus loop) stand down again exactly as
    // they do on a fresh mount; the learner's next key / tap sets it once more
    // (TextArea → `onUserInteraction`), and the arrow then steps from the parked caret.
    const clearSelection = useCallback((caretOffset?: number) => {
        const textarea = inputRef.current;
        if (!textarea) return;
        const caret = caretOffset ?? textarea.selectionStart;
        userHasInteractedRef.current = false;
        awaitingFirstSelectionRef.current = true;
        setAwaitingFirstSelection(true);
        if (document.activeElement !== textarea) textarea.focus({ preventScroll: true });
        textarea.setSelectionRange(caret, caret);
        lastSelectionRef.current = { start: caret, end: caret };
        setSelectionRangeState({ start: caret, end: caret });
        setSelectedPersonalCard(null);
        setSelectedDictionaryCard(null);
        setSelectedByTranslation(false);
    }, []);

    // When the reading box loses focus we re-assert it on the next frame so the
    // box is always focused after the user taps elsewhere (vocab card, settings,
    // displayed text). Two exceptions keep this from fighting legitimate inputs:
    //   1. focus moving to a real editable field (future-proofing), and
    //   2. an open modal dialog (create/edit/delete), which needs its own inputs.
    const handleTextAreaBlur = useCallback((event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const nextTarget = event.relatedTarget as HTMLElement | null;
        if (nextTarget && (
            nextTarget.tagName === 'TEXTAREA' ||
            nextTarget.isContentEditable ||
            (nextTarget.tagName === 'INPUT' &&
                /^(text|search|email|password|number|url|tel)$/.test((nextTarget as HTMLInputElement).type))
        )) {
            return;
        }

        requestAnimationFrame(() => {
            // A MUI Dialog renders role="dialog"; if one is open, let it keep focus.
            if (document.querySelector('[role="dialog"]')) return;
            focusTextArea(true);
        });
    }, [focusTextArea]);

    return {
        selectedPersonalCard,
        selectedDictionaryCard,
        setSelectedPersonalCard,
        setSelectedDictionaryCard,
        handleTextChange,
        handleTextSelectionChange,
        handleAutoWordSelect,
        inputRef,
        focusTextArea,
        handleTextAreaBlur,
        awaitingFirstSelection,
        noteUserInteraction,
        selectionRange,
        selectRange,
        selectSpanAtOffset,
        clearSelection,
        selectedByTranslation,
    };
}
