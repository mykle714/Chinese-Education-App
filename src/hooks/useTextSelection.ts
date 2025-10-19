import { useState, useCallback } from "react";
import { findExactMatch, findDictionaryMatch, getSelectedText } from "../utils/textSelection";
import { isWordBoundary } from "../utils/textSelectionUtils";
import type { VocabEntry, DictionaryEntry } from "../types";

interface UseTextSelectionReturn {
    selectedPersonalCard: VocabEntry | null;
    selectedDictionaryCard: DictionaryEntry | null;
    setSelectedPersonalCard: React.Dispatch<React.SetStateAction<VocabEntry | null>>;
    setSelectedDictionaryCard: React.Dispatch<React.SetStateAction<DictionaryEntry | null>>;
    handleTextChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
    handleTextSelectionChange: (event: React.SyntheticEvent<HTMLDivElement>) => void;
    handleAutoWordSelect: (event: React.SyntheticEvent<HTMLDivElement>) => void;
}

export function useTextSelection(
    loadedPersonalCards: VocabEntry[],
    loadedDictionaryCards: DictionaryEntry[],
    autoSelectEnabled: boolean
): UseTextSelectionReturn {
    // Text selection card state
    const [selectedPersonalCard, setSelectedPersonalCard] = useState<VocabEntry | null>(null);
    const [selectedDictionaryCard, setSelectedDictionaryCard] = useState<DictionaryEntry | null>(null);

    // Handle text change - prevent modifications while maintaining cursor functionality
    const handleTextChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        // Prevent any changes to the text content
        event.preventDefault();
        return false;
    }, []);

    // Handle text selection changes for vocabulary card lookup
    const handleTextSelectionChange = useCallback((event: React.SyntheticEvent<HTMLDivElement>) => {
        const textarea = event.currentTarget.querySelector('textarea') as HTMLTextAreaElement;
        if (!textarea) return;

        // Get the currently selected text
        const selectedTextContent = getSelectedText(textarea);

        // Find matching cards in both personal and dictionary
        const matchingPersonalCard = findExactMatch(selectedTextContent, loadedPersonalCards);
        const matchingDictionaryCard = findDictionaryMatch(selectedTextContent, loadedDictionaryCards);

        // Update the selected card states
        setSelectedPersonalCard(matchingPersonalCard);
        setSelectedDictionaryCard(matchingDictionaryCard);

        // Log for debugging
        if (selectedTextContent) {
            console.log(`[TEXT-SELECTION] Selected text: "${selectedTextContent}"`, {
                hasPersonalMatch: !!matchingPersonalCard,
                hasDictionaryMatch: !!matchingDictionaryCard,
                totalPersonalCards: loadedPersonalCards.length,
                totalDictionaryCards: loadedDictionaryCards.length
            });
        }
    }, [loadedPersonalCards, loadedDictionaryCards]);

    // Handle text selection changes for auto word selection using native browser APIs
    const handleAutoWordSelect = useCallback((event: React.SyntheticEvent<HTMLDivElement>) => {
        if (!autoSelectEnabled) return;

        // Find the textarea element within the TextField
        const textarea = event.currentTarget.querySelector('textarea') as HTMLTextAreaElement;
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

    return {
        selectedPersonalCard,
        selectedDictionaryCard,
        setSelectedPersonalCard,
        setSelectedDictionaryCard,
        handleTextChange,
        handleTextSelectionChange,
        handleAutoWordSelect
    };
}
