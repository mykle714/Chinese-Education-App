import { useState, useCallback, useRef } from "react";
import { findExactMatch, findDictionaryMatch, getSelectedText } from "./textSelection";
import { isWordBoundary } from "./textSelectionUtils";
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
    autoSelectEnabled: boolean
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

    // Handle text selection changes for auto word selection using native browser APIs
    const handleAutoWordSelect = useCallback(() => {
        if (!autoSelectEnabled) return;

        // The underlying textarea, forwarded via inputRef
        const textarea = inputRef.current;
        if (!textarea) return;

        // Get current selection positions
        const cursorStart = textarea.selectionStart;
        const cursorEnd = textarea.selectionEnd;

        // Only auto-select if no text is currently selected (just cursor placement)
        if (cursorStart !== cursorEnd) return;

        const cursorPosition = cursorStart;

        try {
            // Focus the textarea to ensure selection works properly
            textarea.focus();

            // Set cursor position first
            textarea.setSelectionRange(cursorPosition, cursorPosition);

            // Use native browser Selection API for word detection
            const selection = window.getSelection();
            if (!selection) return;

            // Clear any existing selections
            selection.removeAllRanges();

            // For textarea, we need to work with the text content
            // Create a temporary text node to work with Selection API
            const textContent = textarea.value;
            if (!textContent || cursorPosition >= textContent.length) return;

            // Alternative approach: Use the Selection.modify() method
            // This mimics exactly what Ctrl+Right/Ctrl+Shift+Left does

            // First, we need to create a selection at the cursor position
            // Since textarea doesn't work directly with Selection API,
            // we'll use a different approach with textarea's built-in methods

            // Simulate word boundary detection by using the browser's native behavior
            // We'll use the fact that double-clicking selects a word
            const originalStart = textarea.selectionStart;
            const originalEnd = textarea.selectionEnd;

            // Try to find word boundaries by testing character by character
            // But use a smarter approach that leverages browser behavior

            // Move cursor to find word start
            let wordStart = cursorPosition;
            let wordEnd = cursorPosition;

            // Use a more sophisticated approach: simulate Ctrl+Left and Ctrl+Right
            // by checking if we're at word boundaries

            // Find word start by moving left until we hit a word boundary
            for (let i = cursorPosition - 1; i >= 0; i--) {
                textarea.setSelectionRange(i, i);
                // Simulate Ctrl+Right to see if we jump to our original position
                // This is a simplified approach - we'll use character classification
                const char = textContent[i];
                const nextChar = textContent[i + 1];

                // Check if this is a word boundary using Unicode-aware logic
                if (isWordBoundary(char, nextChar)) {
                    wordStart = i + 1;
                    break;
                }
                if (i === 0) {
                    wordStart = 0;
                }
            }

            // Find word end by moving right until we hit a word boundary
            for (let i = cursorPosition; i < textContent.length; i++) {
                const char = textContent[i];
                const nextChar = textContent[i + 1];

                if (isWordBoundary(char, nextChar) || i === textContent.length - 1) {
                    wordEnd = i + 1;
                    break;
                }
            }

            // Select the word if we found valid boundaries
            if (wordStart < wordEnd && wordStart !== wordEnd) {
                textarea.setSelectionRange(wordStart, wordEnd);
            } else {
                // Restore original cursor position if no word found
                textarea.setSelectionRange(originalStart, originalEnd);
            }

        } catch (error) {
            console.error('Native word selection failed:', error);
            // Restore original cursor position on error
            textarea.setSelectionRange(cursorPosition, cursorPosition);
        }
    }, [autoSelectEnabled]);

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
