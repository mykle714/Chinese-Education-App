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
}

export function useTextSelection(
    loadedPersonalCards: VocabEntry[],
    loadedDictionaryCards: DictionaryEntry[],
    autoSelectEnabled: boolean,
    // GSA word spans for the current document (docs/READER_SEGMENTATION.md) —
    // drives auto word selection so a tapped caret expands to a dictionary word.
    segmentSpans: SegmentSpan[]
): UseTextSelectionReturn {
    // Text selection card state
    const [selectedPersonalCard, setSelectedPersonalCard] = useState<VocabEntry | null>(null);
    const [selectedDictionaryCard, setSelectedDictionaryCard] = useState<DictionaryEntry | null>(null);

    // Live handle to the underlying <textarea> (forwarded via MUI TextField's
    // inputRef). Used for both focus management and reading the caret/selection,
    // replacing the previous querySelector('textarea') lookups.
    const inputRef = useRef<HTMLTextAreaElement | null>(null);

    // The most recent caret/selection range, persisted so we can restore the
    // user's place whenever focus returns to the reading box.
    const lastSelectionRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });

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

        // Persist the live caret/selection so focus restoration returns the user
        // to their place (this fires after handleAutoWordSelect, so it captures
        // the auto-selected word range when auto-select is enabled).
        lastSelectionRef.current = { start: textarea.selectionStart, end: textarea.selectionEnd };

        // Get the currently selected text
        const selectedTextContent = getSelectedText(textarea);

        // Find matching cards in both personal and dictionary
        const matchingPersonalCard = findExactMatch(selectedTextContent, loadedPersonalCards);
        const matchingDictionaryCard = findDictionaryMatch(selectedTextContent, loadedDictionaryCards);

        // Update the selected card states
        setSelectedPersonalCard(matchingPersonalCard);
        setSelectedDictionaryCard(matchingDictionaryCard);
    }, [loadedPersonalCards, loadedDictionaryCards]);

    // Auto word selection: expand a tapped/placed caret to the gsa word span
    // containing it (docs/READER_SEGMENTATION.md). Replaces the old pairwise
    // isWordBoundary character scan — spans are precomputed per document, so a
    // caret in whitespace/punctuation (no span) simply selects nothing.
    const handleAutoWordSelect = useCallback(() => {
        if (!autoSelectEnabled) return;

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
    }, [autoSelectEnabled, segmentSpans]);

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
        handleTextAreaBlur
    };
}
