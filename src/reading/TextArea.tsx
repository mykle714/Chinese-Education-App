import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { Box, TextField } from "@mui/material";
import { selectRelativeSpan, type SegmentSpan } from "./documentSegmentation";
import { FONTS } from "../theme/fonts";
import { LEADING, SIZE } from "../theme/scale";
import type { Text } from "../types";
import type { Tier2Look } from "../timeOfDay/tier2Look";
import { READER_TEXT_PADDING_SX } from "./readerStyles";
import ReaderSearchHighlights from "./ReaderSearchHighlights";
import type { ReaderSearchColors, ReaderSearchMatch } from "./readerStyles";
import { useComfortableCaretScroll } from "../hooks/useComfortableCaretScroll";

// Edit mode's empty run-out below the last line. The comfortable-caret rule
// (src/hooks/useComfortableCaretScroll.ts) holds the line being written at 60% of the
// box, which needs ≥ 40% of the box scrollable BELOW the end of the text — otherwise
// writing at the end of a document leaves the caret pinned to the box's bottom edge,
// against the keyboard. 40vh is always ≥ 40% of the box (the box is never taller than
// the screen); vh's iOS instability (src/hooks/useAppHeight.ts) only changes how much
// spare run-out there is, never whether there is enough.
const EDIT_TAIL_SPACE = '40vh';


interface TextAreaProps {
    // The page's time-of-day look (ReaderDocumentPage → useTier2Look): the text ink and
    // placeholder colour (the reading area has no card of its own since 2026-11-20).
    look: Tier2Look;
    // The text read (only its content is used — a cyoa passage or choice label passes
    // `{ content }`); null renders nothing.
    selectedText: Pick<Text, 'content'> | null;
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
    // ReaderTapOverlay's synthetic arrows). Lets useTextSelection leave its
    // NOTHING-SELECTED MODE on the next selection.
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
    // The search bar's matches (useReaderSearch), painted over the TEXT mode's reading
    // box by ReaderSearchHighlights. Ignored in edit mode and in the Pinyin mode (the
    // cpcd view paints its own).
    searchMatches?: ReaderSearchMatch[];
    currentMatchIndex?: number;
    // Their highlight washes (readerStyles → readerSearchColors).
    searchColors?: ReaderSearchColors;
    // Desktop double-click in the TEXT mode: select the sentence containing the clicked
    // character (useTextSelection → selectSentenceAtOffset). The Pinyin mode handles its
    // own double-click (ReaderCpcdView). On mobile the tap overlay covers the box, so this
    // never fires there — the overlay's second-tier long-press is the mobile gesture.
    onSelectSentenceAtOffset?: (offset: number) => void;
    // SIZE. "page" (default) — the full reading box: fills its column, scrolls inside, the
    // reading gutter, the Reader's 2× line height. "inline" — a few lines read in place
    // inside another control (cyoa's inspected choice label, docs/CYOA_FEATURE.md § 3.2):
    // as tall as its text, no gutter, no scrolling, set in the label's own type so the
    // words do not move when the label turns into a reading pane.
    size?: 'page' | 'inline';
}

function TextArea({
    look,
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
    searchMatches,
    currentMatchIndex = -1,
    searchColors,
    onSelectSentenceAtOffset,
    size = 'page',
}: TextAreaProps) {
    const inline = size === 'inline';
    // The type: the Reader's reading face, or (inline) the cyoa choice label's
    // (StoryChoiceStack → story-choice__label).
    const typeSx = inline
        ? { lineHeight: LEADING.normal, fontSize: SIZE.bodyLg, fontFamily: FONTS.cjk, letterSpacing: 'normal' }
        : { lineHeight: 2, fontSize: SIZE.subtitle, fontFamily: FONTS.cjk, letterSpacing: '0.02em' };
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

    // While writing, keep the caret's line at a comfortable height above the keyboard.
    // The page already ends this box at the keyboard's top (ReaderDocumentPage → KEYBOARD
    // LIFT), so the hook only has to scroll the textarea itself.
    useComfortableCaretScroll({ fieldRef: inputRef, value: draftContent, enabled: editMode });

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
                    onDoubleClick={editMode || !onSelectSentenceAtOffset ? undefined : (e) => {
                        // The browser's own double-click has just selected a word; widen it
                        // to the sentence it sits in.
                        const textarea = e.target as HTMLTextAreaElement;
                        if (textarea.tagName !== 'TEXTAREA') return;
                        onSelectSentenceAtOffset(textarea.selectionStart);
                    }}
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
                            // Leaving SENTENCE MODE needs no special case: the textarea's
                            // selection IS the sentence, so "next" lands on the unit after the
                            // sentence's end and "prev" on the unit before its start, exactly
                            // as for a word or phrase (owner's call 2026-11-23; it used to
                            // park the caret at the sentence start and land on its first word).
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
                            ...typeSx,
                            color: look.ink,
                            // No padding on the outlined root: padding here would sit
                            // OUTSIDE the textarea's scroll surface, so scrolled text
                            // would stop short of the margin. The gutter lives on the
                            // textarea itself instead (below), so text scrolls through it.
                            padding: 0,
                            overflow: 'hidden',
                            cursor: 'text',
                            '& .MuiInputBase-input': {
                                // The shared reading padding (readerStyles → READER_TEXT_PADDING_SX):
                                // gutter + the page's side padding, since the pane runs full-bleed
                                // so the scrollbar sits on the screen's edge.
                                // Inline: none — the host control's own padding is the margin.
                                ...(inline ? { padding: 0 } : READER_TEXT_PADDING_SX),
                                // Edit mode: run-out below the last line (EDIT_TAIL_SPACE).
                                ...(editMode && { paddingBottom: EDIT_TAIL_SPACE }),
                                // border-box so the padding stays inside the
                                // `height: 100%` (MUI's input is content-box, which
                                // would push the textarea past the box's bottom edge).
                                boxSizing: 'border-box',
                                ...typeSx,
                                cursor: 'text',
                                userSelect: 'text',
                                // Pinyin mode: the text (and its native selection tint)
                                // goes invisible but the element keeps its focus, caret
                                // and layout.
                                ...(showCpcd && { opacity: 0 }),
                                // Custom text selection styling based on theme
                                '&::selection': {
                                    backgroundColor: selectionColors.backgroundColor,
                                },
                                '&::-moz-selection': {
                                    backgroundColor: selectionColors.backgroundColor,
                                },
                                '&::placeholder': {
                                    color: look.muted,
                                    opacity: 1,
                                },
                            }
                        }
                    }}
                    sx={{
                        // Fill the wrapper so the text box always grows to the bottom of the page
                        // (inline: as tall as its text).
                        flexGrow: inline ? 0 : 1,
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
                            // Inline: MUI's autosize sets the height to the text's, and a few
                            // lines never scroll.
                            '& textarea': inline ? { overflow: 'hidden !important' } : {
                                height: '100% !important',
                                overflow: 'auto !important',
                                overscrollBehavior: 'contain',
                                touchAction: 'pan-y',
                            },
                            // NO BOX (owner's call 2026-11-20): the words sit straight on the
                            // page ground with a wide side margin (READER_TEXT_GUTTER_PX) — no
                            // card face, hairline or radius, in reading AND edit mode. Edit
                            // mode is told apart by the drop-down ReaderEditToolbar and the
                            // caret. The reading box is focused the whole time it is open
                            // (it drives word selection), so there is no focus ring either.
                            // (Until 2026-11-20: a look.surface card with SectionCard's 18px
                            // radius and a look.line hairline, firmed to look.outline while
                            // editing. Before 2026-11-16: markOutline / wood hover / ink ring.)
                            backgroundColor: 'transparent',
                            borderRadius: 0,
                            '& fieldset, &:hover fieldset, &.Mui-focused fieldset': {
                                border: 'none',
                            },
                        },
                    }}
                    minRows={inline ? 1 : 2}
                    placeholder={inline ? undefined : editMode ? "Paste or write your text here…" : "Select a text to begin reading…"}
                />
        );
        // typeSx is derived from `inline` alone, so `inline` stands in for it.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedText, onTextChange, onAutoWordSelect, onTextSelectionChange, autoSelectEnabled, segmentSpans, selectionColors, inputRef, onBlur, onUserInteraction, editMode, draftContent, onDraftChange, showCpcd, look, onSelectSentenceAtOffset, inline]);

    if (!memoizedTextField) return null;

    return (
        <Box className="reader-page-text-field-wrapper" sx={{
            flexGrow: inline ? 0 : 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            position: 'relative',
        }}>
            {memoizedTextField}
            {/* Outside the memoised field, so a step through the matches re-renders only
            this layer. */}
            {!editMode && !showCpcd && selectedText && searchColors && searchMatches && searchMatches.length > 0 && (
                <ReaderSearchHighlights
                    inputRef={inputRef}
                    content={selectedText.content}
                    matches={searchMatches}
                    currentIndex={currentMatchIndex}
                    colors={searchColors}
                />
            )}
            {/* Laid exactly over the textarea, which it paints for (same gutter). */}
            {showCpcd && (
                <Box
                    className="reader-page-cpcd-view-frame"
                    sx={{ position: 'absolute', inset: 0, overflow: 'hidden' }}
                >
                    {cpcdView}
                </Box>
            )}
        </Box>
    );
}

export default TextArea;
