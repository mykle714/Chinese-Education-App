import { useMemo } from "react";
import { Box, TextField } from "@mui/material";
import {
    selectPreviousWord,
    selectNextWord,
    moveCursorLeftFromPosition,
    moveCursorRightFromPosition
} from "../utils/textSelectionUtils";

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
    selectionColors: {
        backgroundColor: string;
    };
    onTextChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
    onAutoWordSelect: (event: React.SyntheticEvent<HTMLDivElement>) => void;
    onTextSelectionChange: (event: React.SyntheticEvent<HTMLDivElement>) => void;
}

function TextArea({
    selectedText,
    autoSelectEnabled,
    selectionColors,
    onTextChange,
    onAutoWordSelect,
    onTextSelectionChange
}: TextAreaProps) {
    // Memoized Text Area Component - isolated from vocab card updates
    const MemoizedTextArea = useMemo(() => {
        if (!selectedText) return null;

        return (
            <Box className="reader-page-text-field-wrapper" sx={{ flexGrow: 1 }}>
                <TextField
                    className="reader-page-text-field"
                    multiline
                    fullWidth
                    value={selectedText.content}
                    onChange={onTextChange}
                    onSelect={(e) => {
                        // Handle both auto word selection and vocabulary card lookup
                        onAutoWordSelect(e);
                        onTextSelectionChange(e);
                    }}
                    onKeyDown={(e) => {
                        // Handle directional word selection when auto-select is enabled
                        if (autoSelectEnabled && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
                            // Use e.target directly as it should be the textarea element
                            const textarea = e.target as HTMLTextAreaElement;
                            if (!textarea || textarea.tagName !== 'TEXTAREA') {
                                return;
                            }

                            // Only handle if no text is currently selected
                            if (textarea.selectionStart === textarea.selectionEnd) {
                                e.preventDefault(); // Prevent default arrow behavior

                                if (e.key === 'ArrowLeft') {
                                    selectPreviousWord(textarea);
                                } else if (e.key === 'ArrowRight') {
                                    selectNextWord(textarea);
                                }
                                return;
                            } else {
                                // Handle arrow keys when text is selected
                                if (e.key === 'ArrowLeft') {
                                    e.preventDefault();
                                    const startPosition = Math.max(0, textarea.selectionStart - 1);
                                    moveCursorLeftFromPosition(textarea, startPosition);
                                    return;
                                } else if (e.key === 'ArrowRight') {
                                    e.preventDefault();
                                    const startPosition = textarea.selectionEnd;
                                    moveCursorRightFromPosition(textarea, startPosition);
                                    return;
                                }

                                return;
                            }
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
                    InputProps={{
                        sx: {
                            lineHeight: 2,
                            fontSize: '1.1rem',
                            fontFamily: '"Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
                            letterSpacing: '0.02em',
                            padding: 2,
                            cursor: 'text',
                            '& .MuiInputBase-input': {
                                lineHeight: 2,
                                fontSize: '1.1rem',
                                fontFamily: '"Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
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
                        '& .MuiOutlinedInput-root': {
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
                        minHeight: '400px'
                    }}
                    rows={20}
                    placeholder="Select a text to begin reading..."
                />
            </Box>
        );
    }, [selectedText, onTextChange, onAutoWordSelect, onTextSelectionChange, autoSelectEnabled, selectionColors]);

    return MemoizedTextArea;
}

export default TextArea;
