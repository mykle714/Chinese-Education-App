import React from "react";
import { Box, CircularProgress, IconButton, useTheme } from "@mui/material";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";

interface SpeakerButtonProps {
    onClick: () => void;
    // When true, render a thin spinning ring around the speaker icon to
    // indicate the audio request is in flight or playing. The parent owns the
    // computation (typically `tts.speakingKey === thisButtonsText`) so only
    // the clicked button spins when multiple buttons are visible at once.
    isLoading?: boolean;
}

/**
 * The speaker's hit-target size, in px — pinned explicitly (not left to MUI's
 * `size="small"` padding + rem-based icon) because LearningToggle centers its "+"
 * under the speaker using this number. It used to hard-code 32 while the real
 * button rendered at 30, leaving the "+" 1px off the speaker's axis.
 */
export const SPEAKER_BUTTON_SIZE = 30;

/**
 * Speaker icon button used across the flashcards/dictionary UI. Stops pointer
 * event propagation so taps don't bubble up to enclosing flip/drag handlers.
 *
 * When `isLoading` is true, an MUI CircularProgress is overlaid around the
 * icon at the same visual size as the IconButton's hit target.
 */
export const SpeakerButton: React.FC<SpeakerButtonProps> = ({ onClick, isLoading }) => {
    const theme = useTheme();
    const stop = (e: React.SyntheticEvent) => {
        e.stopPropagation();
    };
    return (
        <Box
            className="speaker-button-wrapper"
            sx={{ position: "relative", display: "inline-flex" }}
        >
            <IconButton
                className="flashcard-speaker-button"
                size="small"
                onClick={(e) => { stop(e); onClick(); }}
                onMouseDown={stop}
                onTouchStart={stop}
                onTouchEnd={stop}
                aria-label="Play narration"
                sx={{
                    width: SPEAKER_BUTTON_SIZE,
                    height: SPEAKER_BUTTON_SIZE,
                    color: theme.palette.flashcard.textSecondary,
                    '&:hover': { color: theme.palette.flashcard.onSurface },
                }}
            >
                <VolumeUpIcon fontSize="small" />
            </IconButton>
            {isLoading && (
                // Rings the button: 1px larger than SPEAKER_BUTTON_SIZE on every side.
                // pointerEvents:none keeps the underlying button clickable
                // (so a rapid retap can cancel + restart playback).
                <CircularProgress
                    className="speaker-button-spinner"
                    size={SPEAKER_BUTTON_SIZE + 2}
                    thickness={3}
                    sx={{
                        position: "absolute",
                        top: "50%",
                        left: "50%",
                        // Negative margins, not translate(-50%,-50%): the indeterminate
                        // spinner animates `transform` on this same element.
                        marginTop: `-${(SPEAKER_BUTTON_SIZE + 2) / 2}px`,
                        marginLeft: `-${(SPEAKER_BUTTON_SIZE + 2) / 2}px`,
                        color: theme.palette.flashcard.onSurface,
                        pointerEvents: "none",
                    }}
                />
            )}
        </Box>
    );
};

export default SpeakerButton;
