import { memo, useLayoutEffect, useRef } from "react";
import { Box } from "@mui/material";
import { copyTextareaTypography } from "../utils/textareaMirror";
import type { ReaderSearchColors, ReaderSearchMatch } from "./readerStyles";

/**
 * ReaderSearchHighlights — paints the search bar's matches over the Reader's TEXT mode
 * reading box (TextArea), yellow like a browser's find.
 *
 * A <textarea> cannot style ranges of its own text, so this is a LIVE MIRROR: a div laid
 * exactly over the textarea's box, copying its typography and wrapping
 * (src/utils/textareaMirror.ts → copyTextareaTypography), holding the same text, and kept at
 * the textarea's scroll offset. All its text is transparent; each match is a <mark>
 * whose translucent yellow wash lies over the textarea's own glyphs (the textarea paints
 * an opaque surface, so the wash can't go behind it), tinting them lightly without
 * hiding them. `pointer-events: none`, so taps and the caret still go to the textarea.
 *
 * Colours: readerStyles → readerSearchColors (`match` / `current`), the same pair
 * ReaderCpcdView paints in the Pinyin mode.
 *
 * Layer: shared presentational component (src/reading — the reading engine shared by the Reader and cyoa, docs/CYOA_FEATURE.md § 4); match state lives in
 * useReaderSearch. Rendered by TextArea.tsx (reading mode, Text display mode, search open).
 * Docs: docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "Search".
 */
interface ReaderSearchHighlightsProps {
    // The reading textarea this layer mirrors.
    inputRef: React.RefObject<HTMLTextAreaElement | null>;
    content: string;
    matches: ReaderSearchMatch[];
    currentIndex: number;
    colors: ReaderSearchColors;
}

function ReaderSearchHighlights({ inputRef, content, matches, currentIndex, colors }: ReaderSearchHighlightsProps) {
    const layerRef = useRef<HTMLDivElement | null>(null);

    // Fit the layer to the textarea: same typography, same CLIENT box (so a desktop
    // scrollbar's width is excluded from both and the lines wrap identically), same
    // position inside the shared wrapper, same scroll offset. Re-fitted when the
    // textarea resizes (keyboard lift, rotation) and on every scroll.
    useLayoutEffect(() => {
        const textarea = inputRef.current;
        const layer = layerRef.current;
        if (!textarea || !layer) return;
        const fit = () => {
            copyTextareaTypography(window.getComputedStyle(textarea), layer);
            layer.style.boxSizing = "border-box";
            layer.style.width = `${textarea.clientWidth}px`;
            layer.style.height = `${textarea.clientHeight}px`;
            const parent = layer.offsetParent as HTMLElement | null;
            const parentRect = parent?.getBoundingClientRect();
            const rect = textarea.getBoundingClientRect();
            layer.style.top = `${rect.top - (parentRect?.top ?? 0) + textarea.clientTop}px`;
            layer.style.left = `${rect.left - (parentRect?.left ?? 0) + textarea.clientLeft}px`;
            layer.scrollTop = textarea.scrollTop;
        };
        const syncScroll = () => {
            layer.scrollTop = textarea.scrollTop;
        };
        fit();
        const observer = new ResizeObserver(fit);
        observer.observe(textarea);
        textarea.addEventListener("scroll", syncScroll, { passive: true });
        return () => {
            observer.disconnect();
            textarea.removeEventListener("scroll", syncScroll);
        };
    }, [inputRef]);

    // New highlights may change nothing about the scroll, but the textarea may have
    // scrolled in the same commit (the current match brought into view): re-sync.
    useLayoutEffect(() => {
        const textarea = inputRef.current;
        const layer = layerRef.current;
        if (textarea && layer) layer.scrollTop = textarea.scrollTop;
    });

    // Plain text between matches, a <mark> per match.
    const pieces: React.ReactNode[] = [];
    let cursor = 0;
    matches.forEach((match, index) => {
        if (match.start > cursor) pieces.push(content.slice(cursor, match.start));
        const current = index === currentIndex;
        pieces.push(
            <Box
                component="mark"
                key={match.start}
                className={`reader-search-highlights__match${current ? " reader-search-highlights__match--current" : ""}`}
                sx={{
                    // No padding/margin: the mark must not move a single glyph.
                    padding: 0,
                    margin: 0,
                    borderRadius: "3px",
                    backgroundColor: current ? colors.current : colors.match,
                    color: "transparent",
                    boxDecorationBreak: "clone",
                    WebkitBoxDecorationBreak: "clone",
                }}
            >
                {content.slice(match.start, match.end)}
            </Box>
        );
        cursor = match.end;
    });
    if (cursor < content.length) pieces.push(content.slice(cursor));
    // A textarea keeps a trailing newline's empty last line; a div drops it. A
    // zero-width space holds it so the two scroll heights agree.
    if (content.endsWith("\n")) pieces.push("​");

    return (
        <Box
            ref={layerRef}
            className="reader-search-highlights"
            aria-hidden
            sx={{
                position: "absolute",
                pointerEvents: "none",
                overflow: "hidden",
                whiteSpace: "pre-wrap",
                overflowWrap: "break-word",
                color: "transparent",
                userSelect: "none",
            }}
        >
            {pieces}
        </Box>
    );
}

export default memo(ReaderSearchHighlights);
