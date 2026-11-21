/**
 * Textarea MIRROR DIV geometry — the one way to learn where a <textarea> draws a given
 * character. A textarea exposes no per-character geometry of its own, so a div copies its
 * box + typography + wrapping; text laid out in that div lands where the textarea draws it.
 *
 * LAYER: shared DOM util (feature-agnostic — docs/FRONTEND_LAYERING.md).
 *
 * - `copyTextareaTypography` — the style copy itself. Also used by the Reader's LIVE
 *   search mirror (src/reading/ReaderSearchHighlights.tsx).
 * - `buildTextareaMirror` — a detached, styled mirror div; the caller positions and
 *   appends it (src/reading/textSelectionUtils.ts → `textareaOffsetAtPoint`).
 * - `measureTextareaRange` — the vertical extent of a character range, in the textarea's
 *   CONTENT coordinates (scroll-independent). Used by
 *   src/reading/textSelectionUtils.ts → `scrollSelectionIntoView` and
 *   src/hooks/useComfortableCaretScroll.ts.
 *
 * Docs: docs/USER_DOCUMENT_FEATURE_SUMMARY.md § Display modes (WORD JUMP), § Editing
 * (comfortable caret scroll); docs/CYOA_FEATURE.md § 5.
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
 *  onto `target`. */
export function copyTextareaTypography(style: CSSStyleDeclaration, target: HTMLElement): void {
    for (const p of MIRROR_STYLE_PROPS) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (target.style as any)[p] = (style as any)[p];
    }
}

/** A detached div styled like the textarea whose computed `style` is given (the caller
 *  positions + appends it). */
export function buildTextareaMirror(style: CSSStyleDeclaration): HTMLDivElement {
    const mirror = document.createElement('div');
    copyTextareaTypography(style, mirror);
    mirror.style.position = 'absolute';
    mirror.style.whiteSpace = 'pre-wrap';
    mirror.style.overflowWrap = 'break-word';
    mirror.style.overflow = 'hidden';
    mirror.className = 'textarea-mirror';
    return mirror;
}

/** Where a range of a textarea's text is drawn, vertically. */
export interface TextareaRangeBox {
    /** Top of the range's first line, px from the textarea's top padding edge (scrollTop 0). */
    top: number;
    /** Bottom of the range's last line, same coordinates. */
    bottom: number;
    /** The textarea's line height, px — the natural unit of "breathing room". */
    lineHeight: number;
}

/**
 * Measure the range [start, end) of `textarea` (a collapsed range = the caret) in the
 * textarea's CONTENT coordinates: subtract `textarea.scrollTop` to get its position in the
 * visible box. The mirror is added and removed in one synchronous call, so it never paints.
 *
 * A collapsed range is measured as a stand-in glyph slotted in at that offset, i.e. the
 * line the caret is drawn on.
 */
export function measureTextareaRange(textarea: HTMLTextAreaElement, start: number, end: number): TextareaRangeBox {
    const style = window.getComputedStyle(textarea);
    const mirror = buildTextareaMirror(style);
    mirror.style.visibility = 'hidden';
    mirror.style.top = '0';
    mirror.style.left = '-9999px';
    mirror.style.height = 'auto';

    const text = textarea.value;
    // A collapsed range (the caret) consumes no text: a stand-in '.' is slotted in at the
    // caret so it lands on the caret's own line — including the empty line just after a
    // freshly typed Enter, and the end of a line just before a '\n'.
    const markerEnd = end > start ? end : start;
    const marker = document.createElement('span');
    marker.textContent = end > start ? text.substring(start, end) : '.';
    mirror.appendChild(document.createTextNode(text.substring(0, start)));
    mirror.appendChild(marker);
    mirror.appendChild(document.createTextNode(text.substring(markerEnd)));
    document.body.appendChild(mirror);

    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
    const top = marker.offsetTop;
    const bottom = top + (marker.offsetHeight || lineHeight);
    document.body.removeChild(mirror);
    return { top, bottom, lineHeight };
}
