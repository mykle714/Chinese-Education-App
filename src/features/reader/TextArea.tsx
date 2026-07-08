import { useMemo } from "react";
import { Box, TextField } from "@mui/material";
import { selectRelativeSpan, type SegmentSpan } from "./documentSegmentation";
import ReaderTapOverlay from "./ReaderTapOverlay";
import { FONTS } from "../../theme/fonts";
import { SIZE } from "../../theme/scale";

// Text interface for TypeScript
interface Text {
    id: string;
    title: string;
    description: string;
    content: string;
    createdAt: string;
    characterCount: number;
}

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
    // Edit mode (see ReaderEditToolbar / useReaderContentEditor): swaps the reading
    // box (tap-to-navigate, auto-select, no typing) for a plain editable textarea
    // bound to the in-progress draft rather than the saved document content.
    editMode?: boolean;
    draftContent?: string;
    onDraftChange?: (value: string) => void;
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
    editMode = false,
    draftContent = '',
    onDraftChange,
}: TextAreaProps) {
    // Memoized Text Area Component - isolated from vocab card updates
    const MemoizedTextArea = useMemo(() => {
        if (!selectedText) return null;

        return (
            <Box className="reader-page-text-field-wrapper" sx={{
                flexGrow: 1,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
                position: 'relative',
            }}>
                <TextField
                    className="reader-page-text-field"
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
                    onKeyDown={editMode ? undefined : (e) => {
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
                    // suppresses the virtual keyboard while keeping focus/selection intact.
                    // In edit mode this is a normal editable textarea, so the keyboard is
                    // allowed to appear (no inputMode override).
                    inputProps={editMode ? undefined : { inputMode: 'none' }}
                    InputProps={{
                        sx: {
                            lineHeight: 2,
                            fontSize: SIZE.subtitle,
                            fontFamily: FONTS.cjk,
                            letterSpacing: '0.02em',
                            padding: 2,
                            cursor: 'text',
                            '& .MuiInputBase-input': {
                                lineHeight: 2,
                                fontSize: SIZE.subtitle,
                                fontFamily: FONTS.cjk,
                                letterSpacing: '0.02em',
                                cursor: 'text',
                                userSelect: 'text',
                                // Custom text selection styling based on theme
                                '&::selection': {
                                    backgroundColor: selectionColors.backgroundColor,
                                },
                                '&::-moz-selection': {
                                    backgroundColor: selectionColors.backgroundColor,
                                }
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
                            '& fieldset': {
                                borderColor: 'rgba(0, 0, 0, 0.12)',
                            },
                            '&:hover fieldset': {
                                borderColor: 'rgba(0, 0, 0, 0.23)',
                            },
                            '&.Mui-focused fieldset': {
                                borderColor: 'primary.main',
                            },
                        },
                    }}
                    minRows={2}
                    placeholder={editMode ? "Edit your text content here..." : "Select a text to begin reading..."}
                />
                {/* Tap-to-navigate is a reading-mode affordance; edit mode is a plain
                editable textarea, so no overlay. */}
                {!editMode && <ReaderTapOverlay inputRef={inputRef} />}
            </Box>
        );
    }, [selectedText, onTextChange, onAutoWordSelect, onTextSelectionChange, autoSelectEnabled, segmentSpans, selectionColors, inputRef, onBlur, editMode, draftContent, onDraftChange]);

    return MemoizedTextArea;
}

export default TextArea;
