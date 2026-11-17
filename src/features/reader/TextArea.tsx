import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { Box, TextField } from "@mui/material";
import { selectRelativeSpan, type SegmentSpan } from "./documentSegmentation";
import { FONTS } from "../../theme/fonts";
import { SIZE } from "../../theme/scale";
import { COLORS } from "../../theme/colors";
import type { Text } from "../../types";
import { READER_CARD_RADIUS } from "./readerStyles";


interface TextAreaProps {
    selectedText: Text | null;
    autoSelectEnabled: boolean;
    // GSA word spans for the current document (docs/READER_SEGMENTATION.md) —
    // arrow keys (and ReaderTapOverlay's synthetic arrows) step through these.
    segmentSpans: SegmentSpan[];
    selectionColors: {
        backgroundColor: string;
    };
    onTextChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
    onAutoWordSelect: (event: React.SyntheticEvent<HTMLDivElement>) => void;
    onTextSelectionChange: (event: React.SyntheticEvent<HTMLDivElement>) => void;
    // Forwarded to the underlying <textarea> so the page can manage focus.
    inputRef: React.RefObject<HTMLTextAreaElement | null>;
    // Re-asserts focus when the reading box is blurred.
    onBlur: React.FocusEventHandler<HTMLInputElement | HTMLTextAreaElement>;
    // A real learner gesture in the reading box (key press, pointer down — incl.
    // ReaderTapOverlay's synthetic arrows and its long-press pointerdown). Lets
    // useTextSelection leave its NOTHING-SELECTED MODE on the next selection.
    onUserInteraction?: () => void;
    // Edit mode (see ReaderEditToolbar / useReaderContentEditor): swaps the reading
    // box (tap-to-navigate, auto-select, no typing) for a plain editable textarea
    // bound to the in-progress draft rather than the saved document content.
    editMode?: boolean;
    draftContent?: string;
    onDraftChange?: (value: string) => void;
    // PINYIN DISPLAY MODE (useReaderSettings → displayMode). When given (reading mode
    // only — the page passes nothing while editing), this view (ReaderCpcdView) is drawn
    // inside the reading box's card and the textarea's own text goes invisible. The
    // textarea stays mounted, focused and navigable underneath: it is still the one
    // selection model, the view only paints its range. See ReaderCpcdView's header.
    cpcdView?: ReactNode;
}

function TextArea({
    selectedText,
    autoSelectEnabled,
    segmentSpans,
    selectionColors,
    onTextChange,
    onAutoWordSelect,
    onTextSelectionChange,
    inputRef,
    onBlur,
    onUserInteraction,
    editMode = false,
    draftContent = '',
    onDraftChange,
    cpcdView,
}: TextAreaProps) {
    // The cpcd view only ever replaces the READING box; edit mode is always the plain field.
    const showCpcd = !editMode && !!cpcdView;
    // ── Read ⇄ edit hand-off ────────────────────────────────────────────────
    // The two modes render DIFFERENT <textarea> elements (see the `key` on the
    // TextField below), so the reader's place would be lost on every toggle. On
    // the render where `editMode` flips, `inputRef` still points at the OUTGOING
    // element (the swap only happens at commit), so snapshot its scroll offset and
    // caret here and hand them to the incoming one in the effect below. Reading the
    // DOM during render is idempotent, so a StrictMode double render is harmless.
    const prevEditModeRef = useRef(editMode);
    const handoffRef = useRef<{ scrollTop: number; caret: number } | null>(null);
    if (prevEditModeRef.current !== editMode) {
        const outgoing = inputRef.current;
        handoffRef.current = outgoing
            ? { scrollTop: outgoing.scrollTop, caret: outgoing.selectionStart ?? 0 }
            : null;
        prevEditModeRef.current = editMode;
    }

    // Entering edit mode focuses the fresh editable textarea. That focus is the
    // keyboard trigger: the BeginnerKeyboardProvider listens for `focusin`, and a
    // tap on an ALREADY-focused field fires none, so without this the learner would
    // have to tap away and back before any keyboard appeared. Leaving edit mode
    // needs nothing here — ReaderDocumentPage's dialog-close effect refocuses the
    // reading box and restores its word highlight.
    useEffect(() => {
        const handoff = handoffRef.current;
        handoffRef.current = null;
        if (!editMode) return;
        const field = inputRef.current;
        if (!field) return;
        if (handoff) {
            field.scrollTop = handoff.scrollTop;
            field.setSelectionRange(handoff.caret, handoff.caret);
        }
        field.focus({ preventScroll: true });
    }, [editMode, inputRef]);

    // Memoized text field - isolated from vocab card updates (and from the cpcd view's
    // highlight, which re-renders on every selection step and so lives outside it).
    const memoizedTextField = useMemo(() => {
        if (!selectedText) return null;

        return (
                <TextField
                    // ⚠️ One element per mode, NOT one element toggled. The beginner
                    // keyboard writes `inputMode` on the field it drives and resets it
                    // to '' when it closes (BeginnerKeyboardHost), and that close lands
                    // AFTER the exit-edit re-render — so a shared element came back to
                    // reading mode stripped of its `inputMode="none"` and raised the OS
                    // keyboard on every refocus. Remounting gives reading mode a clean
                    // element and leaves the keyboard's cleanup on the detached one
                    // (the provider closes itself once its field is disconnected).
                    key={editMode ? 'reader-edit-field' : 'reader-read-field'}
                    className={editMode ? "reader-page-text-field reader-page-text-field--editing" : "reader-page-text-field"}
                    multiline
                    fullWidth
                    value={editMode ? draftContent : selectedText.content}
                    inputRef={inputRef}
                    onBlur={editMode ? undefined : onBlur}
                    onChange={editMode
                        ? (e) => onDraftChange?.(e.target.value)
                        : onTextChange}
                    onSelect={editMode ? undefined : (e) => {
                        // Handle both auto word selection and vocabulary card lookup
                        onAutoWordSelect(e);
                        onTextSelectionChange(e);
                    }}
                    onPointerDown={editMode ? undefined : onUserInteraction}
                    onKeyDown={editMode ? undefined : (e) => {
                        onUserInteraction?.();
                        // Directional word navigation when auto-select is enabled:
                        // step the selection through the document's gsa word spans.
                        // ReaderTapOverlay's forward/back taps dispatch synthetic
                        // ArrowLeft/ArrowRight keydowns into this same handler, so
                        // keyboard and tap navigation share one code path.
                        if (autoSelectEnabled && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
                            // Use e.target directly as it should be the textarea element
                            const textarea = e.target as HTMLTextAreaElement;
                            if (!textarea || textarea.tagName !== 'TEXTAREA') {
                                return;
                            }

                            e.preventDefault(); // Arrows navigate whole words; never move the raw caret
                            selectRelativeSpan(textarea, segmentSpans, e.key === 'ArrowRight' ? 'next' : 'prev');
                            return;
                        }

                        // Allow navigation keys but prevent text modification
                        const allowedKeys = [
                            'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
                            'Home', 'End', 'PageUp', 'PageDown',
                            'Tab', 'Escape'
                        ];

                        // Allow Ctrl+A (select all), Ctrl+C (copy)
                        if (e.ctrlKey && (e.key === 'a' || e.key === 'c' || e.key === 'A' || e.key === 'C')) {
                            return;
                        }

                        // Prevent all other key inputs except navigation
                        if (!allowedKeys.includes(e.key)) {
                            e.preventDefault();
                        }
                    }}
                    variant="outlined"
                    // The reading box is focused on purpose (it drives word selection +
                    // arrow-key navigation), so mobile browsers would normally raise the
                    // soft keyboard. This box is not for typing, so inputMode="none"
                    // suppresses the OS virtual keyboard while keeping focus/selection
                    // (the caret + word highlight) intact. `data-beginner-keyboard="off"`
                    // does the same for the app's own handwriting keyboard, which would
                    // otherwise open on every focus — the reading box re-asserts focus
                    // constantly (useTextSelection → handleTextAreaBlur), so it popped up
                    // all the time. In edit mode this is a normal editable textarea and
                    // both keyboards are allowed (no overrides).
                    inputProps={editMode ? undefined : { inputMode: 'none', 'data-beginner-keyboard': 'off' }}
                    InputProps={{
                        sx: {
                            lineHeight: 2,
                            fontSize: SIZE.subtitle,
                            fontFamily: FONTS.cjk,
                            letterSpacing: '0.02em',
                            color: COLORS.onSurface,
                            // No padding on the outlined root: padding here would sit
                            // OUTSIDE the textarea's scroll surface, so scrolled text
                            // was cut off 16px short of the box's border. The gutter
                            // lives on the textarea itself instead (below), so text
                            // scrolls through it and clips exactly at the border.
                            padding: 0,
                            overflow: 'hidden',
                            cursor: 'text',
                            '& .MuiInputBase-input': {
                                // 16px gutter all round (SectionCard's horizontal 16).
                                padding: 2,
                                // border-box so the padding stays inside the
                                // `height: 100%` (MUI's input is content-box, which
                                // would push the textarea past the box's bottom edge).
                                boxSizing: 'border-box',
                                lineHeight: 2,
                                fontSize: SIZE.subtitle,
                                fontFamily: FONTS.cjk,
                                letterSpacing: '0.02em',
                                cursor: 'text',
                                userSelect: 'text',
                                // Pinyin mode: the text (and its native selection tint)
                                // goes invisible but the element keeps its focus, caret
                                // and layout — the card behind and the hairline stay.
                                ...(showCpcd && { opacity: 0 }),
                                // Custom text selection styling based on theme
                                '&::selection': {
                                    backgroundColor: selectionColors.backgroundColor,
                                },
                                '&::-moz-selection': {
                                    backgroundColor: selectionColors.backgroundColor,
                                },
                                '&::placeholder': {
                                    color: COLORS.textFaint,
                                    opacity: 1,
                                },
                            }
                        }
                    }}
                    sx={{
                        // Fill the wrapper so the text box always grows to the bottom of the page.
                        flexGrow: 1,
                        minHeight: 0,
                        display: 'flex',
                        '& .MuiOutlinedInput-root': {
                            flexGrow: 1,
                            minHeight: 0,
                            alignItems: 'stretch',
                            // Inner textarea is the scroll surface — overflow auto so only it scrolls.
                            // overscrollBehavior 'contain' stops a touch-drag that hits the
                            // textarea's scroll boundary from chaining up and scrolling the whole
                            // page on mobile; touchAction 'pan-y' keeps vertical panning inside it.
                            '& textarea': {
                                height: '100% !important',
                                overflow: 'auto !important',
                                overscrollBehavior: 'contain',
                                touchAction: 'pan-y',
                            },
                            // Flat look (readerStyles.ts): the box is a white card on the
                            // paper ground — SectionCard's 18px radius and `rowBorder`
                            // hairline. The reading box is focused the whole time it is
                            // open (it drives word selection), so a focus ring would be a
                            // permanent heavy border: reading mode keeps the hairline, and
                            // only edit mode — a real text field — firms it to the input
                            // outline (`border`, --line2). No hover change.
                            // (Until 2026-11-16: markOutline at rest, `wood` on hover, an
                            // ink ring when focused.)
                            backgroundColor: COLORS.white,
                            borderRadius: READER_CARD_RADIUS,
                            '& fieldset': {
                                borderColor: COLORS.rowBorder,
                                borderWidth: '1px',
                            },
                            '&:hover fieldset': {
                                borderColor: COLORS.rowBorder,
                            },
                            '&.Mui-focused fieldset': {
                                borderColor: editMode ? COLORS.border : COLORS.rowBorder,
                                borderWidth: '1px',
                            },
                        },
                    }}
                    minRows={2}
                    placeholder={editMode ? "Paste or write your text here…" : "Select a text to begin reading…"}
                />
        );
    }, [selectedText, onTextChange, onAutoWordSelect, onTextSelectionChange, autoSelectEnabled, segmentSpans, selectionColors, inputRef, onBlur, onUserInteraction, editMode, draftContent, onDraftChange, showCpcd]);

    if (!memoizedTextField) return null;

    return (
        <Box className="reader-page-text-field-wrapper" sx={{
            flexGrow: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            position: 'relative',
        }}>
            {memoizedTextField}
            {/* Inset 1px so it sits INSIDE the card's hairline, and rounded to the card's
            curve so scrolled lines clip at the corners like the textarea's do. */}
            {showCpcd && (
                <Box
                    className="reader-page-cpcd-view-frame"
                    sx={{ position: 'absolute', inset: '1px', borderRadius: READER_CARD_RADIUS, overflow: 'hidden' }}
                >
                    {cpcdView}
                </Box>
            )}
        </Box>
    );
}

export default TextArea;
