/**
 * Text selection utilities for the Reader component
 * Contains helper functions for word boundary detection and text selection
 */

/**
 * Helper function to determine word boundaries using native browser logic
 */
export const isWordBoundary = (char: string, nextChar: string): boolean => {
    if (!char || !nextChar) return true;

    // Use Intl.Segmenter if available (modern browsers)
    if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
        try {
            type IntlWithSegmenter = typeof Intl & {
                Segmenter: new (locale: string, options?: { granularity?: string }) => {
                    segment: (str: string) => Iterable<unknown>;
                };
            };
            const segmenter = new (Intl as IntlWithSegmenter).Segmenter('en', { granularity: 'word' });
            const segments = Array.from(segmenter.segment(char + nextChar));
            return segments.length > 1;
        } catch {
            // Fall back to simpler logic
        }
    }

    // Fallback: Use basic character classification
    const isWordChar = (c: string) => /\p{L}|\p{N}/u.test(c);
    const isWhitespace = (c: string) => /\s/u.test(c);
    const isPunctuation = (c: string) => /\p{P}/u.test(c);

    // Boundary conditions
    if (isWhitespace(char) || isWhitespace(nextChar)) return true;
    if (isPunctuation(char) || isPunctuation(nextChar)) return true;
    if (isWordChar(char) !== isWordChar(nextChar)) return true;

    return false;
};

/**
 * Helper functions for character type checking at cursor position
 */
export const isWhitespaceAtPosition = (textarea: HTMLTextAreaElement, position: number): boolean => {
    if (position < 0 || position >= textarea.value.length) return false;
    return /\s/.test(textarea.value[position]);
};

export const isPunctuationAtPosition = (textarea: HTMLTextAreaElement, position: number): boolean => {
    if (position < 0 || position >= textarea.value.length) return false;
    return /\p{P}/u.test(textarea.value[position]);
};

/**
 * Move cursor left from given position, skipping whitespace and punctuation
 */
export const moveCursorLeftFromPosition = (textarea: HTMLTextAreaElement, startPosition: number): void => {
    let newPosition = startPosition;

    // Skip whitespace characters moving left
    while (newPosition > 0 && isWhitespaceAtPosition(textarea, newPosition)) {
        newPosition--;
    }

    // Skip punctuation characters moving left
    while (newPosition > 0 && isPunctuationAtPosition(textarea, newPosition)) {
        newPosition--;
    }

    textarea.setSelectionRange(newPosition, newPosition);
    scrollSelectionIntoView(textarea);
};

/**
 * Move cursor right from given position, skipping punctuation and whitespace
 */
export const moveCursorRightFromPosition = (textarea: HTMLTextAreaElement, startPosition: number): void => {
    let newPosition = startPosition;

    // Skip punctuation characters moving right
    while (newPosition < textarea.value.length && isPunctuationAtPosition(textarea, newPosition)) {
        newPosition++;
    }

    // Skip whitespace characters moving right
    while (newPosition < textarea.value.length && isWhitespaceAtPosition(textarea, newPosition)) {
        newPosition++;
    }

    // If we move past the end, select the last selectable position
    if (newPosition >= textarea.value.length) {
        moveCursorLeftFromPosition(textarea, --newPosition);
    } else {
        textarea.setSelectionRange(newPosition, newPosition);
    }
    scrollSelectionIntoView(textarea);
};

/**
 * Scroll the textarea so the current selection is visible. Programmatic
 * setSelectionRange does not trigger the browser's "scroll-into-view" behavior
 * that real keyboard navigation gets, so we measure the selection's vertical
 * offset with a mirror div (matching the textarea's typography + wrapping) and
 * nudge scrollTop only when the selection is outside the visible band.
 */
export const scrollSelectionIntoView = (textarea: HTMLTextAreaElement): void => {
    const { selectionStart, selectionEnd } = textarea;
    const style = window.getComputedStyle(textarea);

    const mirror = document.createElement('div');
    const props: Array<keyof CSSStyleDeclaration> = [
        'boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
        'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
        'borderStyle', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing',
        'lineHeight', 'textTransform', 'wordSpacing', 'tabSize', 'textIndent',
    ];
    for (const p of props) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mirror.style as any)[p] = (style as any)[p];
    }
    mirror.style.position = 'absolute';
    mirror.style.visibility = 'hidden';
    mirror.style.whiteSpace = 'pre-wrap';
    mirror.style.wordWrap = 'break-word';
    mirror.style.overflow = 'hidden';
    mirror.style.top = '0';
    mirror.style.left = '-9999px';
    mirror.style.height = 'auto';

    const text = textarea.value;
    const before = document.createTextNode(text.substring(0, selectionStart));
    const marker = document.createElement('span');
    marker.textContent = text.substring(selectionStart, Math.max(selectionEnd, selectionStart + 1)) || '.';
    const after = document.createTextNode(text.substring(Math.max(selectionEnd, selectionStart + 1)));

    mirror.appendChild(before);
    mirror.appendChild(marker);
    mirror.appendChild(after);
    document.body.appendChild(mirror);

    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
    const markerTop = marker.offsetTop;
    const markerBottom = markerTop + (marker.offsetHeight || lineHeight);

    document.body.removeChild(mirror);

    const viewTop = textarea.scrollTop;
    const viewBottom = viewTop + textarea.clientHeight;
    const padding = lineHeight; // keep one line of breathing room

    if (markerTop < viewTop + padding) {
        textarea.scrollTop = Math.max(0, markerTop - padding);
    } else if (markerBottom > viewBottom - padding) {
        textarea.scrollTop = markerBottom - textarea.clientHeight + padding;
    }
};

/**
 * Find previous word: mirror the selectNextWord logic but in reverse direction
 */
export const selectPreviousWord = (textarea: HTMLTextAreaElement): void => {
    const text = textarea.value;
    const cursorPos = textarea.selectionStart;

    // Start from cursor position and move backwards
    let pos = cursorPos - 1; // Start one position back from cursor

    // Skip whitespace/punctuation to find the previous word (moving backwards)
    while (pos >= 0) {
        const char = text[pos];
        const nextChar = text[pos + 1];
        if (!isWordBoundary(char, nextChar)) {
            break; // Found a word character
        }
        pos--;
    }

    if (pos < 0) return; // No previous word found

    // Now we're at the end of the previous word, find its start
    let wordStart = pos;
    const wordEnd = pos + 1; // End is one position after the last character

    // Find word start by moving backwards from current position
    for (let i = pos; i >= 0; i--) {
        const char = text[i];
        const prevChar = text[i - 1];
        if (i === 0 || isWordBoundary(prevChar, char)) {
            wordStart = i;
            break;
        }
    }

    // Select the previous word
    textarea.setSelectionRange(wordStart, wordEnd);
    scrollSelectionIntoView(textarea);
};

/**
 * Reuse existing word boundary logic to find next word
 */
export const selectNextWord = (textarea: HTMLTextAreaElement): void => {
    const text = textarea.value;
    const cursorPos = textarea.selectionStart;

    // Cursor default position for a selected text is the end of the selected text
    let pos = cursorPos;

    // Skip whitespace/punctuation to find the next word
    while (pos < text.length) {
        const char = text[pos];
        const nextChar = text[pos + 1];
        if (!isWordBoundary(char, nextChar)) {
            break; // Found a word character
        }
        pos++;
    }

    if (pos >= text.length) return; // No next word found

    // Now find the full word boundaries using existing logic
    const wordStart = pos;
    let wordEnd = pos;

    // Find word end (reusing existing boundary logic)
    for (let i = pos; i < text.length; i++) {
        const char = text[i];
        const nextChar = text[i + 1];
        if (isWordBoundary(char, nextChar) || i === text.length - 1) {
            wordEnd = i + 1;
            break;
        }
    }

    textarea.setSelectionRange(wordStart, wordEnd);
    scrollSelectionIntoView(textarea);
};
