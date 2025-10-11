import type { VocabEntry } from '../types';

/**
 * Finds exact matches for selected text in the loaded vocabulary cards
 * @param selectedText The text that was selected by the user
 * @param loadedCards Array of vocabulary entries to search through
 * @returns The first matching VocabEntry or null if no match found
 */
export const findExactMatch = (selectedText: string, loadedCards: VocabEntry[]): VocabEntry | null => {
    const trimmedText = selectedText.trim();
    
    // Return null if no text selected or no cards loaded
    if (!trimmedText || loadedCards.length === 0) {
        return null;
    }
    
    // Find all exact matches
    const matches = loadedCards.filter(card => card.entryKey === trimmedText);
    
    // Log multiple matches to console as requested
    if (matches.length > 1) {
        console.log(`Multiple matches found for "${trimmedText}":`, matches.map(m => ({
            id: m.id,
            entryKey: m.entryKey,
            entryValue: m.entryValue
        })));
    }
    
    // Return first match or null
    return matches.length > 0 ? matches[0] : null;
};

/**
 * Gets the currently selected text from a textarea element
 * @param textarea The textarea element to get selection from
 * @returns The selected text or empty string if no selection
 */
export const getSelectedText = (textarea: HTMLTextAreaElement): string => {
    if (!textarea) return '';
    
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    
    if (start === end) return ''; // No selection
    
    return textarea.value.substring(start, end);
};
