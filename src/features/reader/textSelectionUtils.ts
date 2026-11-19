/**
 * Reader textarea geometry helpers, built on one MIRROR DIV technique: a div that copies
 * the textarea's box + typography + wrapping, so text laid out in it lands where the
 * textarea draws it. A <textarea> exposes no per-character geometry of its own.
 *
 * - `scrollSelectionIntoView` — nudge scrollTop so the selection is visible.
 * - `textareaOffsetAtPoint` — the character under a screen point (ReaderTapOverlay's
 *   text-mode WORD JUMP: "Tap and hold on a word to jump to it").
 * - `copyTextareaTypography` — the style copy itself, shared with the LIVE mirror that
 *   paints search matches over the textarea (ReaderSearchHighlights).
 *
 * Word boundary detection and word navigation live in ./documentSegmentation.ts (gsa
 * spans — docs/READER_SEGMENTATION.md).
 * Docs: docs/USER_DOCUMENT_FEATURE_SUMMARY.md § Display modes (WORD JUMP).
 */

// The computed-style properties a mirror copies so its text wraps exactly like the
// textarea's.
const MIRROR_STYLE_PROPS: Array<keyof CSSStyleDeclaration> = [
    'boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'borderStyle', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing',
    'lineHeight', 'textTransform', 'wordSpacing', 'tabSize', 'textIndent', 'wordBreak',
];

/** Copy the textarea's box + typography (MIRROR_STYLE_PROPS) from its computed `style`
 *  onto `target`. Also used by the live search highlight layer (ReaderSearchHighlights). */
export function copyTextareaTypography(style: CSSStyleDeclaration, target: HTMLElement): void {
    for (const p of MIRROR_STYLE_PROPS) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (target.style as any)[p] = (style as any)[p];
    }
}

/** A detached div styled like the textarea whose computed `style` is given (the caller
 *  positions + appends it). */
function buildTextareaMirror(style: CSSStyleDeclaration): HTMLDivElement {
    const mirror = document.createElement('div');
    copyTextareaTypography(style, mirror);
    mirror.style.position = 'absolute';
    mirror.style.whiteSpace = 'pre-wrap';
    mirror.style.overflowWrap = 'break-word';
    mirror.style.overflow = 'hidden';
    mirror.className = 'reader-textarea-mirror';
    return mirror;
}

/**
 * Scroll the textarea so the current selection is visible. Programmatic
 * setSelectionRange does not trigger the browser's "scroll-into-view" behavior
 * that real keyboard navigation gets, so we measure the selection's vertical
 * offset with a mirror div and nudge scrollTop only when the selection is
 * outside the visible band.
 *
 * `range` measures that range instead of the textarea's own selection — for a
 * selection recorded while the textarea is unfocused (useTextSelection → selectRange
 * `focus: false`, the search bar's current match), whose DOM selection is not moved.
 */
export const scrollSelectionIntoView = (
    textarea: HTMLTextAreaElement,
    range?: { start: number; end: number },
): void => {
    const selectionStart = range?.start ?? textarea.selectionStart;
    const selectionEnd = range?.end ?? textarea.selectionEnd;
    const style = window.getComputedStyle(textarea);

    const mirror = buildTextareaMirror(style);
    mirror.style.visibility = 'hidden';
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

// Slack around a character's box when deciding the point is "on" it, px — a fingertip
// is wide, so a press just past a glyph's edge still counts.
const CHAR_HIT_SLOP_PX = 4;

/** The caret position nearest a screen point, cross-browser (Firefox: caretPositionFromPoint). */
function caretOffsetFromPoint(clientX: number, clientY: number): { node: Node; offset: number } | null {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = document as any;
    if (typeof doc.caretPositionFromPoint === 'function') {
        const pos = doc.caretPositionFromPoint(clientX, clientY);
        return pos ? { node: pos.offsetNode, offset: pos.offset } : null;
    }
    if (typeof doc.caretRangeFromPoint === 'function') {
        const range: Range | null = doc.caretRangeFromPoint(clientX, clientY);
        return range ? { node: range.startContainer, offset: range.startOffset } : null;
    }
    return null;
}

/**
 * The index of the character drawn under (clientX, clientY) in `textarea`, or null when
 * the point is over EMPTY SPACE — past a line's end, below the last line, in the padding.
 *
 * How: a mirror is laid exactly over the textarea (same rect, same scrollTop) and briefly
 * put on top of everything so the browser's caret hit test (`caretPositionFromPoint` /
 * `caretRangeFromPoint`) resolves inside it. Added and removed in one synchronous call, so
 * it is never painted. The hit test snaps to the NEAREST caret even far from any text, so
 * the character on either side of that caret is then checked to actually contain the point.
 */
export const textareaOffsetAtPoint = (
    textarea: HTMLTextAreaElement,
    clientX: number,
    clientY: number,
): number | null => {
    const text = textarea.value;
    if (text.length === 0) return null;
    const style = window.getComputedStyle(textarea);
    const rect = textarea.getBoundingClientRect();

    const mirror = buildTextareaMirror(style);
    mirror.style.position = 'fixed';
    mirror.style.left = `${rect.left}px`;
    mirror.style.top = `${rect.top}px`;
    mirror.style.boxSizing = 'border-box';
    mirror.style.width = `${rect.width}px`;
    mirror.style.height = `${rect.height}px`;
    // A visible scrollbar narrows the textarea's text column; widen the right padding by
    // the same amount so the mirror wraps at the same place.
    const scrollbarPx = textarea.offsetWidth - textarea.clientWidth
        - (parseFloat(style.borderLeftWidth) || 0) - (parseFloat(style.borderRightWidth) || 0);
    if (scrollbarPx > 0) {
        mirror.style.paddingRight = `${(parseFloat(style.paddingRight) || 0) + scrollbarPx}px`;
    }
    // Hit-testable (not `visibility: hidden` / `pointer-events: none`, which the caret hit
    // test skips) but invisible, and above the tap overlay.
    mirror.style.opacity = '0';
    mirror.style.pointerEvents = 'auto';
    mirror.style.zIndex = '2147483647';
    const textNode = document.createTextNode(text);
    mirror.appendChild(textNode);
    document.body.appendChild(mirror);
    mirror.scrollTop = textarea.scrollTop;

    let hit: number | null = null;
    try {
        const caret = caretOffsetFromPoint(clientX, clientY);
        if (caret && caret.node === textNode) {
            // The caret sits between two characters; the press is on whichever one's box
            // contains it.
            const range = document.createRange();
            for (const index of [caret.offset, caret.offset - 1]) {
                if (index < 0 || index >= text.length || text[index] === '\n') continue;
                range.setStart(textNode, index);
                range.setEnd(textNode, index + 1);
                const box = range.getBoundingClientRect();
                if (
                    clientX >= box.left - CHAR_HIT_SLOP_PX && clientX <= box.right + CHAR_HIT_SLOP_PX
                    && clientY >= box.top - CHAR_HIT_SLOP_PX && clientY <= box.bottom + CHAR_HIT_SLOP_PX
                ) {
                    hit = index;
                    break;
                }
            }
        }
    } finally {
        document.body.removeChild(mirror);
    }
    return hit;
};
