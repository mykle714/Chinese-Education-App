/**
 * Reader textarea scroll helper.
 *
 * Word boundary detection and word navigation moved to
 * ./documentSegmentation.ts (gsa spans — docs/READER_SEGMENTATION.md); only the
 * selection scroll-into-view mirror-div technique remains here.
 */

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

