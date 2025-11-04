import type { VocabEntry, DictionaryEntry } from '../types';

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
    
    // Return first match or null
    return matches.length > 0 ? matches[0] : null;
};

/**
 * Finds exact matches for selected text in the loaded dictionary entries
 * @param selectedText The text that was selected by the user
 * @param loadedDictionaryCards Array of dictionary entries to search through
 * @returns The first matching DictionaryEntry or null if no match found
 */
export const findDictionaryMatch = (selectedText: string, loadedDictionaryCards: DictionaryEntry[]): DictionaryEntry | null => {
    const trimmedText = selectedText.trim();
    
    // Return null if no text selected or no cards loaded
    if (!trimmedText || loadedDictionaryCards.length === 0) {
        return null;
    }
    
    // Find all exact matches based on word1 (primary) or word2 (secondary)
    // For Chinese: word1=simplified, word2=traditional
    // For Japanese: word1=kanji, word2=kana
    const matches = loadedDictionaryCards.filter(card => 
        card.word1 === trimmedText || card.word2 === trimmedText
    );
    
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
